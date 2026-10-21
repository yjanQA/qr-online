// ============================================================
// formula_sync.js — 배합비 외부 연동 (API / 파일 임포트)
//
//   ── 왜 이 구조인가 ──
//   외부 시스템 API 가 아직 열리지 않았다. 그래서 "API 가 열리면 코드를 고쳐서 붙인다"가
//   아니라, 지금 붙일 수 있는 형태로 배선만 끝내 두고 주소·인증·필드명만 화면에서
//   채우면 바로 동작하도록 만들었다.
//     · 엔드포인트 · 인증방식 · 필드 매핑 전부 설정값이다(코드 수정 불필요)
//     · 같은 변환 파이프라인을 파일 임포트(JSON/CSV)에도 그대로 쓴다
//       → API 개통 전까지는 내려받은 파일로 동일하게 운영할 수 있다
//     · 불러온 뒤 곧바로 저장하지 않는다. 신규/변경/동일을 구분해 보여주고 고른 것만 반영한다
//       (배합비는 덮어쓰면 되돌릴 수 없는 데이터라 미리보기를 반드시 거친다)
// ============================================================

const FormulaSync = (() => {
  const CFG_KEY = 'formula_sync_config';
  const CFG_ID = 'formula-sync-config';
  const LOG_KEY = 'formula_sync_log';

  const now = () => new Date().toISOString();
  const notify = (k) => { try { if (window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_) { return []; } };
  const write = (k, d) => { localStorage.setItem(k, JSON.stringify(d)); notify(k); };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ── 인증 방식 ──
  const AUTH_TYPES = {
    NONE:   { label: '없음' },
    APIKEY: { label: 'API Key 헤더' },
    BEARER: { label: 'Bearer 토큰' },
    BASIC:  { label: 'Basic 인증' },
  };

  // ── 기본 필드 매핑 ──
  //   외부 시스템 필드명을 모르므로 흔한 이름을 기본값으로 두고 화면에서 바꾸게 한다.
  //   점 표기(a.b.c)와 배열 인덱스(items.0.code)를 지원한다.
  const DEFAULT_MAP = {
    listPath:      'data',            // 응답에서 배합비 배열이 있는 위치 ('' 이면 응답 자체가 배열)
    productCode:   'productCode',
    productName:   'productName',
    version:       'version',
    targetQty:     'targetQty',
    status:        'status',
    createdBy:     'createdBy',
    specialNotes:  'specialNotes',
    caution:       'caution',
    ingredients:   'ingredients',     // 원료 배열 위치
    ingCode:       'materialCode',
    ingName:       'materialName',
    ingPct:        'pct',
    ingNote:       'note',
  };

  // 상태값 매핑 — 외부 코드가 무엇이든 우리 3종으로 떨어뜨린다
  const STATUS_ALIAS = {
    ACTIVE: 'ACTIVE', A: 'ACTIVE', USE: 'ACTIVE', Y: 'ACTIVE', 사용: 'ACTIVE', 사용중: 'ACTIVE',
    DRAFT: 'DRAFT', D: 'DRAFT', 작성: 'DRAFT', 작성중: 'DRAFT',
    HOLD: 'HOLD', H: 'HOLD', 보류: 'HOLD', STOP: 'HOLD', N: 'HOLD',
  };

  // ============================================================
  // 설정
  // ============================================================
  const getConfig = () => {
    const row = read(CFG_KEY).find(x => x.id === CFG_ID);
    return {
      enabled: !!(row && row.enabled),
      baseUrl: (row && row.baseUrl) || '',
      path: (row && row.path) || '/api/formulas',
      method: (row && row.method) || 'GET',
      authType: (row && row.authType) || 'NONE',
      authKeyName: (row && row.authKeyName) || 'X-API-Key',
      authValue: (row && row.authValue) || '',
      queryParams: (row && row.queryParams) || '',
      map: { ...DEFAULT_MAP, ...((row && row.map) || {}) },
      autoStatus: (row && row.autoStatus) || 'DRAFT',   // 임포트 시 강제할 상태 ('' 이면 원본 유지)
      updatedAt: row && row.updatedAt,
      updatedBy: row && row.updatedBy,
    };
  };
  const saveConfig = (patch, by) => {
    const cur = getConfig();
    const row = {
      id: CFG_ID,
      enabled: patch.enabled !== undefined ? !!patch.enabled : cur.enabled,
      baseUrl: patch.baseUrl ?? cur.baseUrl,
      path: patch.path ?? cur.path,
      method: patch.method ?? cur.method,
      authType: patch.authType ?? cur.authType,
      authKeyName: patch.authKeyName ?? cur.authKeyName,
      authValue: patch.authValue ?? cur.authValue,
      queryParams: patch.queryParams ?? cur.queryParams,
      map: { ...cur.map, ...(patch.map || {}) },
      autoStatus: patch.autoStatus ?? cur.autoStatus,
      updatedAt: now(), updatedBy: by || '',
    };
    write(CFG_KEY, read(CFG_KEY).filter(x => x.id !== CFG_ID).concat([row]));
    return row;
  };
  const resetConfig = () => write(CFG_KEY, []);

  // ============================================================
  // 값 추출 — 점 표기 경로
  // ============================================================
  const pick = (obj, path) => {
    if (!path) return obj;
    return String(path).split('.').reduce((o, k) => {
      if (o === null || o === undefined) return undefined;
      return o[k];
    }, obj);
  };

  const numOf = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(String(v).replace(/[, %]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // ============================================================
  // 외부 응답 → 우리 배합비 형태
  // ============================================================
  const normalize = (raw, map) => {
    const m = { ...DEFAULT_MAP, ...(map || {}) };
    const list = m.listPath ? pick(raw, m.listPath) : raw;
    if (!Array.isArray(list)) {
      throw new Error(`배합비 배열을 찾지 못했습니다. 목록 경로("${m.listPath || '(응답 루트)'}")를 확인하십시오.`);
    }
    return list.map((r, i) => {
      const ings = pick(r, m.ingredients);
      const rows = Array.isArray(ings) ? ings : [];
      const rawStatus = String(pick(r, m.status) ?? '').trim().toUpperCase();
      const targetQty = numOf(pick(r, m.targetQty)) || 1000;

      let ingredients = rows.map(x => ({
        materialCode: String(pick(x, m.ingCode) ?? '').trim(),
        materialName: String(pick(x, m.ingName) ?? '').trim(),
        pct: numOf(pick(x, m.ingPct)),
        note: String(pick(x, m.ingNote) ?? '').trim(),
      })).filter(x => x.materialCode || x.materialName || x.pct > 0);

      // 구성비를 %가 아니라 배치당 kg 으로 주는 시스템이 흔하다.
      // 합계가 100 이 아니라 목표 배합량에 가까우면 kg 으로 보고 %로 환산한다.
      // (환산하지 않으면 합계 1000% 로 잡혀 전부 반영 불가가 된다.)
      const sum = ingredients.reduce((a, x) => a + x.pct, 0);
      let unitConverted = '';
      if (ingredients.length && Math.abs(sum - 100) > 1 && targetQty > 0
          && Math.abs(sum - targetQty) / targetQty < 0.02) {
        ingredients = ingredients.map(x => ({ ...x, pct: Math.round(x.pct / sum * 100 * 10000) / 10000 }));
        unitConverted = `kg → % 환산 (배치 ${targetQty}kg 기준)`;
      }

      return {
        _row: i + 1,
        _unitConverted: unitConverted,
        productCode: String(pick(r, m.productCode) ?? '').trim(),
        productName: String(pick(r, m.productName) ?? '').trim(),
        version: String(pick(r, m.version) ?? '').trim() || 'v1',
        targetQty,
        status: STATUS_ALIAS[rawStatus] || STATUS_ALIAS[String(pick(r, m.status) ?? '').trim()] || 'DRAFT',
        createdBy: String(pick(r, m.createdBy) ?? '').trim() || '외부연동',
        specialNotes: String(pick(r, m.specialNotes) ?? '').trim(),
        caution: String(pick(r, m.caution) ?? '').trim(),
        ingredients,
      };
    });
  };

  // ── 검증 ──
  //   여기서 거르지 않으면 합계가 0% 인 배합비나 제품코드 없는 행이 그대로 저장된다.
  const validate = (item) => {
    const issues = [];
    const blockers = [];
    if (!item.productCode) blockers.push('제품코드 없음');
    if (!item.ingredients.length) blockers.push('원료 구성 없음');
    const sum = item.ingredients.reduce((a, x) => a + x.pct, 0);
    // 합계가 100%가 아닌 배합비는 반영을 막는다.
    //   생산에 그대로 쓰이는 값이라 "일단 넣고 나중에 고치자"가 통하지 않는다.
    if (item.ingredients.length && Math.abs(sum - 100) > 0.5) {
      blockers.push(`구성비 합계 ${sum.toFixed(2)}% (100% 아님)`);
    }
    const noCode = item.ingredients.filter(x => !x.materialCode).length;
    if (noCode) issues.push(`원료코드 누락 ${noCode}건`);   // 경고만 — 원료명으로 보정 가능
    if (item._unitConverted) issues.push(item._unitConverted);
    return { sum, issues: blockers.concat(issues), blockers, ok: blockers.length === 0 };
  };

  // ── 기존 배합비와 대조 ──
  const diffAgainstExisting = (items) => {
    let existing = [];
    try { existing = DB.getFormulaRecipes() || []; } catch (_) { existing = []; }
    const key = (c, v) => `${String(c).trim()}|${String(v).trim()}`;
    const byKey = new Map(existing.map(r => [key(r.productCode, r.version), r]));

    return items.map(it => {
      const v = validate(it);
      const prev = byKey.get(key(it.productCode, it.version));
      let kind = 'NEW', changes = [];
      if (prev) {
        const prevIng = (prev.ingredients || []).map(x => `${x.materialCode}:${Number(x.pct).toFixed(2)}`).sort().join(',');
        const nextIng = it.ingredients.map(x => `${x.materialCode}:${Number(x.pct).toFixed(2)}`).sort().join(',');
        if (prevIng !== nextIng) changes.push('원료 구성');
        if (Number(prev.targetQty) !== Number(it.targetQty)) changes.push('목표 배합량');
        if ((prev.productName || '') !== it.productName) changes.push('제품명');
        kind = changes.length ? 'UPDATE' : 'SAME';
      }
      return { ...it, _valid: v, _kind: kind, _changes: changes, _prevId: prev ? prev.id : '' };
    });
  };

  // ============================================================
  // API 호출
  // ============================================================
  const buildUrl = (cfg) => {
    const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
    const path = String(cfg.path || '');
    const url = base + (path.startsWith('/') ? path : '/' + path);
    return cfg.queryParams ? url + (url.includes('?') ? '&' : '?') + cfg.queryParams.replace(/^[?&]/, '') : url;
  };

  const buildHeaders = (cfg) => {
    const h = { 'Accept': 'application/json' };
    if (cfg.authType === 'APIKEY' && cfg.authKeyName) h[cfg.authKeyName] = cfg.authValue || '';
    if (cfg.authType === 'BEARER') h['Authorization'] = 'Bearer ' + (cfg.authValue || '');
    if (cfg.authType === 'BASIC') h['Authorization'] = 'Basic ' + (cfg.authValue || '');
    return h;
  };

  const fetchRaw = async (cfgOverride) => {
    const cfg = { ...getConfig(), ...(cfgOverride || {}) };
    if (!cfg.baseUrl) throw new Error('연동 주소(Base URL)가 설정되지 않았습니다.');
    const url = buildUrl(cfg);
    let res;
    try {
      res = await fetch(url, { method: cfg.method || 'GET', headers: buildHeaders(cfg) });
    } catch (e) {
      // CORS·네트워크 실패는 메시지가 불친절해서 원인을 짚어준다
      throw new Error(`연결 실패: ${e.message}. 주소·사내망 접근 여부와 상대 서버의 CORS 허용을 확인하십시오.`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (_) { throw new Error('JSON 응답이 아닙니다. 반환 형식을 확인하십시오.'); }
  };

  const testConnection = async (cfgOverride) => {
    const started = Date.now();
    const raw = await fetchRaw(cfgOverride);
    const cfg = { ...getConfig(), ...(cfgOverride || {}) };
    const list = cfg.map.listPath ? pick(raw, cfg.map.listPath) : raw;
    return {
      ms: Date.now() - started,
      isArray: Array.isArray(list),
      count: Array.isArray(list) ? list.length : 0,
      sampleKeys: Array.isArray(list) && list[0] && typeof list[0] === 'object' ? Object.keys(list[0]) : [],
      rootKeys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : [],
    };
  };

  const pullFromApi = async (cfgOverride) => {
    const cfg = { ...getConfig(), ...(cfgOverride || {}) };
    const raw = await fetchRaw(cfg);
    return diffAgainstExisting(normalize(raw, cfg.map));
  };

  // ============================================================
  // 파일 임포트 — API 개통 전 대체 경로 (같은 파이프라인)
  // ============================================================
  const parseCsv = (text) => {
    // 한 배합비가 여러 줄(원료별 1줄)로 오는 형태를 가정한다.
    // 제품코드+버전이 같은 줄을 하나의 배합비로 묶는다.
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV 내용이 비어 있습니다.');
    const split = (l) => l.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    const head = split(lines[0]);
    return lines.slice(1).map(l => {
      const cells = split(l);
      const o = {};
      head.forEach((h, i) => { o[h] = cells[i] ?? ''; });
      return o;
    });
  };

  // CSV 평면 행 → 배합비 묶음
  const groupFlatRows = (rows, map) => {
    const m = { ...DEFAULT_MAP, ...(map || {}) };
    const out = new Map();
    rows.forEach(r => {
      const code = String(pick(r, m.productCode) ?? '').trim();
      const ver = String(pick(r, m.version) ?? '').trim() || 'v1';
      const k = code + '|' + ver;
      if (!out.has(k)) {
        out.set(k, {
          [m.productCode]: code, [m.productName]: pick(r, m.productName),
          [m.version]: ver, [m.targetQty]: pick(r, m.targetQty),
          [m.status]: pick(r, m.status), [m.createdBy]: pick(r, m.createdBy),
          [m.specialNotes]: pick(r, m.specialNotes), [m.caution]: pick(r, m.caution),
          [m.ingredients]: [],
        });
      }
      const ing = {
        [m.ingCode]: pick(r, m.ingCode), [m.ingName]: pick(r, m.ingName),
        [m.ingPct]: pick(r, m.ingPct), [m.ingNote]: pick(r, m.ingNote),
      };
      if (ing[m.ingCode] || ing[m.ingName] || numOf(ing[m.ingPct]) > 0) out.get(k)[m.ingredients].push(ing);
    });
    return [...out.values()];
  };

  const importFromText = (text, filename) => {
    const cfg = getConfig();
    const isCsv = /\.csv$/i.test(filename || '') || (!text.trim().startsWith('{') && !text.trim().startsWith('['));
    let list;
    if (isCsv) {
      list = groupFlatRows(parseCsv(text), cfg.map);
      return diffAgainstExisting(normalize(list, { ...cfg.map, listPath: '' }));
    }
    const raw = JSON.parse(text);
    return diffAgainstExisting(normalize(raw, cfg.map));
  };

  // ============================================================
  // 반영
  // ============================================================
  const applyItems = (items, by) => {
    const cfg = getConfig();
    let created = 0, updated = 0, skipped = 0;
    const detail = [];
    items.forEach(it => {
      if (!it._valid.ok) { skipped += 1; detail.push({ code: it.productCode, result: '건너뜀', reason: it._valid.issues.join(', ') }); return; }
      const payload = {
        productCode: it.productCode,
        productName: it.productName,
        version: it.version,
        targetQty: it.targetQty,
        status: cfg.autoStatus || it.status,
        ingredients: it.ingredients,
        specialNotes: it.specialNotes,
        caution: it.caution,
        createdBy: by || it.createdBy,
      };
      try {
        if (it._prevId) { DB.updateFormulaRecipe(it._prevId, payload); updated += 1; detail.push({ code: it.productCode, result: '갱신' }); }
        else { DB.addFormulaRecipe(payload); created += 1; detail.push({ code: it.productCode, result: '신규' }); }
      } catch (e) {
        skipped += 1; detail.push({ code: it.productCode, result: '실패', reason: e.message });
      }
    });
    const log = {
      id: uid('FSL'), at: now(), by: by || '', source: cfg.baseUrl ? 'API' : '파일',
      created, updated, skipped, total: items.length, detail: detail.slice(0, 200),
    };
    write(LOG_KEY, read(LOG_KEY).concat([log]).slice(-50));
    return log;
  };

  const getLogs = () => read(LOG_KEY).slice().reverse();

  // 개통 전 확인용 예시 응답 — 필드 매핑이 맞는지 눈으로 보고 시작하기 위한 것.
  //   구성비는 회사 핵심 자산이라 실제 배합처럼 보이는 값을 쓰지 않는다 (2026-09-07 보안 정리).
  //   원료명·코드·비율은 전부 자리표시자다. 확인할 것은 값이 아니라 필드 이름과 구조.
  const sampleResponse = () => ({
    data: [{
      productCode: '0000000', productName: '예시 제품(자리표시자)', version: 'v0',
      targetQty: 1000, status: 'ACTIVE', createdBy: '배합비팀',
      specialNotes: '특이사항이 여기로 들어옵니다', caution: '',
      ingredients: [
        { materialCode: '0000001', materialName: '원료 A', pct: 50, note: '' },
        { materialCode: '0000002', materialName: '원료 B', pct: 30, note: '' },
        { materialCode: '0000003', materialName: '원료 C', pct: 15, note: '' },
        { materialCode: '0000004', materialName: '원료 D', pct: 5, note: '' },
      ],
    }],
  });

  return {
    AUTH_TYPES, DEFAULT_MAP,
    getConfig, saveConfig, resetConfig,
    normalize, validate, diffAgainstExisting,
    buildUrl, testConnection, pullFromApi,
    importFromText, applyItems, getLogs, sampleResponse,
  };
})();
