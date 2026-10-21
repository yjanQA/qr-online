// ============================================================
// lab_matrix.js — 원료 매트릭스 자동작성 (WBS 4.1.4.1 / 4.8.4.1)
//   '논산 원료Matrix' 배합비SPEC 시트를 그대로 옮긴 화면이다.
//   원료 분석대장(lab_records)을 기간별로 모아 원료당 5행으로 낸다.
//
//     최근 N개월 평균   기간 안의 전체 평균 (참고)
//     적용 평균         고른 분석치의 평균          = 양식의 AVERAGE
//     적용 편차         고른 분석치의 표준편차      = 양식의 STDEV (표본, n−1)
//     적용 Matrix       배합에 넘기는 값            = 양식의 적용 Matrix
//     SPEC              확정 기준값                 = 양식의 n월 SPEC (상수)
//
//   양식에 없는 기능은 두지 않는다. 담당자가 정하는 것은 네 가지뿐이다.
//     · 적용 개월수  — 몇 개월치를 볼 것인가 (양식은 3개월)
//     · 분석 데이터  — 그중 어떤 건을 평균에 넣을 것인가 (양식의 적용모선 구간)
//                      체크박스는 그 건 전체, 값 클릭은 그 항목 하나만 뺀다
//     · 적용식       — 적용평균 그대로 / 적용평균 − 적용편차 ÷ 2
//                      뒤엣것은 모선마다 단백이 흔들리는 어분·육골분·갑각류의 Prot 에만 쓴다
//     · SPEC         — 확정 기준값 (비우면 원료스펙·규격관리 값을 그대로)
//   저장은 LabDB.saveMatrixConfig (키 lab_matrix_config, 공장별 분리).
//
//   숫자만으로는 무슨 값인지 알기 어려워 각 항목에 설명 말풍선(?)을 붙였다.
//   + 엑셀 내보내기(WSXlsx) — 원료매트릭스 파일 양식 재현
// ============================================================

const RawMatrixPage = (() => {
  let baseDate = '';        // 기준일(YYYY-MM-DD) — 적용 기간의 끝
  let baseMonths = 3;       // 기본 적용 개월수 (원료별 지정이 없을 때)
  let query = '';
  let hideEmpty = true;     // 값 전혀 없는 항목열 숨김
  let lastRows = [];        // 기준값 모달이 자동값을 보여주기 위해 참조

  // 매트릭스 항목 = 원료Matrix 컬럼 순서.
  //   key    = 분석대장 항목키, alt = 대체키, derived='drymat'
  //   cfgKey = 기준값 지정 키
  //   수분 열은 논산 양식과 같게 다룬다 — 평균·편차는 수분 그대로 보고,
  //   적용 Matrix 만 건물(100−수분)로 뒤집는다. 수분 산포를 보려는 것이지 건물 산포가 아니다.
  const COLS = [
    { label: 'Moist', key: 'moist', derived: 'drymat', cfgKey: 'drymat', dig: 2 },
    { label: 'Prot',   key: 'protein_n', alt: 'protein', dig: 2 },
    { label: 'Fat',    key: 'fat',    dig: 2 },
    { label: 'Fib',    key: 'fiber',  alt: 'fiber_c', dig: 2 },
    { label: 'Ash',    key: 'ash',    dig: 2 },
    { label: 'Ca',     key: 'ca',     dig: 2 },
    { label: 'P',      key: 'p',      dig: 2 },
    { label: 'ADF',    key: 'adf',    dig: 2 },
    { label: 'NDF',    key: 'ndf',    dig: 2 },
    { label: 'Starch', key: 'starch', dig: 2 },
    { label: 'KOH',    key: 'koh',    dig: 1 },
    { label: 'PD',     key: 'pd_0_0002', dig: 2 },
    { label: 'Cu',     key: 'cu_ppm', dig: 1 },
    { label: 'Zn',     key: 'zn_ppm', dig: 1 },
  ];
  const cfgKeyOf = (col) => col.cfgKey || col.key;

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fmtDate = (s) => {
    if (!s) return '';
    const str = String(s);
    return str.length >= 10 ? str.slice(0, 10) : str;
  };

  // 개월 빼기 — 말일 보정(3/31 에서 1개월 전은 2/28)
  const minusMonths = (dateStr, months) => {
    const p = String(dateStr || '').split('-').map(Number);
    if (p.length < 3 || !p[0]) return dateStr;
    const tm = p[1] - months;                       // 1-based
    const ty = p[0] + Math.floor((tm - 1) / 12);
    const tmo = ((tm - 1) % 12 + 12) % 12;          // 0-based
    const last = new Date(ty, tmo + 1, 0).getDate();
    return ty + '-' + pad(tmo + 1) + '-' + pad(Math.min(p[2], last));
  };

  const ensureRange = () => { if (!baseDate) baseDate = ymd(new Date()); };

  const quick = (m) => { baseMonths = m; rerender(); };

  const LDB = () => (typeof LabDB !== 'undefined') ? LabDB : null;
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  // 적용 편차 — 엑셀 STDEV 과 같은 표본표준편차(n−1)
  const stdev = (arr) => {
    const db = LDB();
    if (db && db.matrixSd) return db.matrixSd(arr);
    if (arr.length < 2) return null;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1));
  };
  // 이 레코드에서 이 컬럼이 보는 값 (alt 는 대체 항목키)
  const valOf = (r, col) => {
    const v = r.vals || {};
    const a = num(v[col.key]);
    if (a != null) return a;
    return col.alt ? num(v[col.alt]) : null;
  };
  const isExcluded = (db, cfg, recId, itemKey) =>
    !!(db && db.matrixExcluded && db.matrixExcluded(cfg, recId, itemKey));
  const fmt = (v, dig) => (v == null || !isFinite(v)) ? '' : (+v).toFixed(dig);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const curFactory = () => { try { return (App.getFactory && App.getFactory()) || 'ALL'; } catch (_) { return 'ALL'; } };

  // ── 설명 말풍선 ──
  //   숫자만 봐서는 이 값이 무슨 뜻인지, 바꾸면 뭐가 달라지는지 알기 어렵다.
  //   표 안에서도 잘리지 않게 body 에 띄우고 좌표로 붙인다(스크롤 영역이 잘라내기 때문).
  const HELP = {
    base: {
      t: '기준일',
      b: `<p>분석치를 모으는 <b>구간의 끝</b>입니다. 여기서 개월수만큼 거슬러 올라간 기간의 분석치를 씁니다.</p>
          <p class="hb-eg">기준일 8월 14일 · 3개월 → <b>5월 14일 ~ 8월 14일</b> 분석치</p>
          <p>지난달 기준으로 다시 뽑아보고 싶으면 날짜만 바꾸면 됩니다.</p>`,
    },
    months: {
      t: '기본 적용 개월수',
      b: `<p>몇 개월치 분석치로 평균을 낼지 정합니다.</p>
          <p><b>짧게 잡으면</b> 최근 상태를 빨리 따라가지만 건수가 적어 흔들립니다.<br>
             <b>길게 잡으면</b> 안정적이지만 최근 변화가 늦게 반영됩니다.</p>
          <p>분석이 뜸한 원료는 각 원료의 <b>[설정]</b> 에서 따로 늘려 잡을 수 있습니다.</p>`,
    },
    mean: {
      t: '적용 평균',
      b: `<p>고른 분석치들의 <b>평균</b>입니다. 엑셀의 <code>적용모선평균</code> 자리입니다.</p>
          <p>기간 안의 모든 건이 아니라 <b>앞 탭에서 체크한 건들만</b> 들어갑니다.
             값이 튀는 건을 빼면 이 숫자가 바로 바뀝니다.</p>`,
    },
    sd: {
      t: '적용 편차 (표준편차)',
      b: `<p>고른 분석치들이 평균에서 <b>얼마나 흩어져 있는지</b>를 나타내는 값입니다.
             평균만 봐서는 "일정한 원료"인지 "들쭉날쭉한 원료"인지 알 수 없습니다.</p>
          <p><b>작다</b> → 모선마다 성분이 비슷하다 (평균을 믿어도 된다)<br>
             <b>크다</b> → 모선마다 차이가 크다 (평균만 믿으면 낮은 로트에서 미달)</p>
          <p class="hb-eg">조단백 평균이 같은 64% 라도<br>
             편차 <b>1.0</b> → 대부분 63~65% 안<br>
             편차 <b>5.0</b> → 59~69% 까지 벌어짐</p>
          <p>엑셀 <code>STDEV</code> 와 같은 식(표본표준편차)으로 자동 계산됩니다.
             앞 탭에서 건을 빼거나 넣으면 <b>즉시 다시 계산</b>되고, 그에 따라 적용 Matrix 도 같이 움직입니다.</p>`,
    },
    apply: {
      t: '적용식',
      b: `<p>적용 Matrix 를 어떻게 낼지 고릅니다. 논산 양식에 있는 두 가지뿐입니다.</p>
          <p><b>적용평균 그대로</b> — 대부분의 원료<br>
             <b>평균 − 편차 ÷ N</b> — 어분·육골분·갑각류의 조단백</p>
          <p>편차를 빼는 이유: 모선마다 조단백이 크게 흔들리는 원료를 평균대로 배합하면
             낮은 로트가 들어올 때 제품이 기준에 못 미칩니다. 그만큼 <b>낮춰 잡아 안전하게</b> 갑니다.</p>
          <p><b>÷ N 을 바꾸면</b> 얼마나 낮춰 잡을지 조절됩니다. 양식 기본은 2(= 편차의 절반).
             <b>N 을 작게</b> 하면 더 많이 빼서 보수적으로, <b>크게</b> 하면 덜 빼서 평균에 가깝게 갑니다.</p>
          <p class="hb-eg">평균 63.91 · 편차 3.50 일 때<br>
             ÷ 2 → 63.91 − 1.75 = <b>62.16</b><br>
             ÷ 1 → 63.91 − 3.50 = <b>60.41</b> (더 보수적)<br>
             ÷ 4 → 63.91 − 0.88 = <b>63.03</b> (평균에 가깝게)</p>`,
    },
    matrix: {
      t: '적용 Matrix',
      b: `<p>배합에 <b>실제로 넘기는 값</b>입니다. 적용 평균과 적용 편차에서 계산됩니다.</p>
          <p><b>수분</b> = 100 − 적용평균 (건물 기준으로 뒤집습니다)<br>
             <b>일반</b> = 적용평균<br>
             <b>어분·육골분 조단백</b> = 적용평균 − 적용편차 ÷ 2</p>
          <p><b>밑줄</b>이 그어진 칸은 '평균 − 편차 ÷ 2' 가 걸린 항목입니다. 칸에 커서를 올리면 어떤 식으로 냈는지 나옵니다.</p>
          <p>SPEC 과 차이가 크면 색으로 표시됩니다. <span class="hb-hi">빨강</span> 상한초과 ·
             <span class="hb-lo">파랑</span> 하한미달 · <span class="hb-warn">노랑</span> 기준값 대비 15% 초과.</p>`,
    },
    spec: {
      t: 'SPEC 지정',
      b: `<p>확정 기준값입니다. 엑셀의 <code>n월 SPEC</code> 자리로, 수식이 아니라 <b>사람이 정하는 상수</b>입니다.</p>
          <p>비워두면 원료스펙·규격관리에 등록된 값을 그대로 씁니다(왼쪽 자동값).
             이번 달 기준을 따로 정했다면 여기에 넣습니다.</p>`,
    },
  };
  const help = (key) => `<span class="mx-help" data-help="${key}">?</span>`;

  const closeBubble = () => { document.getElementById('mx-bubble')?.remove(); };
  const openBubble = (el) => {
    closeBubble();
    const h = HELP[el.dataset.help];
    if (!h) return;
    const box = document.createElement('div');
    box.id = 'mx-bubble';
    box.className = 'mx-bubble';
    box.innerHTML = `<div class="hb-t">${h.t}</div>${h.b}`;
    // 페이지 컨테이너 안에 붙인다 — 다른 화면으로 넘어가면 page-content 가 통째로 바뀌면서
    // 말풍선도 같이 사라진다(body 에 붙이면 프로그램 이동 때 남아 다른 화면 위에 뜬다).
    // page-content 에는 containing block 을 만드는 속성이 없어 fixed 가 잘리지 않는다.
    (document.getElementById('page-content') || document.body).appendChild(box);
    // 화면 밖으로 나가지 않게 좌우·상하를 뒤집어 붙인다
    const r = el.getBoundingClientRect();
    const w = box.offsetWidth, ht = box.offsetHeight, pad = 10;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    const above = r.top > ht + 16;
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(above ? r.top - ht - 10 : r.bottom + 10) + 'px';
    box.classList.add(above ? 'hb-up' : 'hb-down');
  };
  const bindHelp = () => {
    if (window.__mxHelpBound) return;
    window.__mxHelpBound = true;
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest && e.target.closest('.mx-help');
      if (el) openBubble(el); else if (!e.target.closest('#mx-bubble')) closeBubble();
    });
    // 마우스가 배지에서 완전히 벗어나면 닫는다(요소가 다시 그려져 mouseout 이 안 떠도 안전하게)
    document.addEventListener('mouseout', (e) => {
      if (e.target.closest && e.target.closest('.mx-help')) closeBubble();
    });
    // 스크롤·클릭·화면 이동 시 좌표가 어긋나거나 남을 수 있으므로 무조건 닫는다
    window.addEventListener('scroll', closeBubble, true);
    document.addEventListener('mousedown', closeBubble, true);
  };

  // 원료 설계 기준값(원료스펙 시트 임포트) — 매트릭스 SPEC 의 자동 소스
  const RAW = () => (typeof window !== 'undefined' && window.RAW_SPECS && window.RAW_SPECS.specs) ? window.RAW_SPECS.specs : null;
  const refSpec = (code, key) => {
    const r = RAW();
    const v = r && r[code] ? r[code][key] : null;
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  };

  // 규격 기준값: 원료스펙(단일 기준값) 우선 → 없으면 규격관리 수동규격(min·max)
  const specTarget = (code, key) => {
    const rv = refSpec(code, key);
    if (rv != null) return { t: rv, source: 'ref' };
    const db = LDB();
    if (db && db.resolveSpec) {
      const sp = db.resolveSpec('raw', code, key);
      if (sp && sp.source === 'manual') {
        if (sp.min != null && sp.max != null) return { t: (sp.min + sp.max) / 2, min: sp.min, max: sp.max, source: 'manual' };
        if (sp.max != null) return { t: sp.max, min: sp.min, max: sp.max, source: 'manual' };
        if (sp.min != null) return { t: sp.min, min: sp.min, max: sp.max, source: 'manual' };
      }
    }
    return null;
  };
  const verdict = (code, key, val) => {
    const db = LDB(); if (!db || !db.judge || val == null) return 'NA';
    return db.judge('raw', code, key, val);
  };

  // 이 원료에 적용할 기간 — 기간 직접 지정이 켜져 있으면 전 원료 공통
  const windowFor = (cfg) => {
    const m = (cfg && cfg.months) ? cfg.months : baseMonths;
    return { f: minusMonths(baseDate, m), t: baseDate, months: m, custom: !!(cfg && cfg.months) };
  };

  // 기간 내 원료 레코드 → 코드별 그룹 → 매트릭스 행 데이터
  const build = () => {
    ensureRange();
    const db = LDB();
    const empty = { rows: [], usedCols: COLS, total: 0, codes: 0, refCount: (RAW() ? Object.keys(RAW()).length : 0), setCount: 0 };
    if (!db || !db.getRecords) return empty;

    const fac = curFactory();
    // 공장 필터만 먼저 걸고, 기간은 원료마다 다를 수 있으므로 그룹을 나눈 뒤에 자른다
    const byCode = new Map();
    db.getRecords('raw').forEach(r => {
      if (fac && fac !== 'ALL' && r.factory && r.factory !== fac) return;
      const c = String(r.code || '').trim();
      if (!c) return;
      if (!byCode.has(c)) byCode.set(c, []);
      byCode.get(c).push(r);
    });

    const rows = [];
    byCode.forEach((all, code) => {
      const cfg = db.getMatrixConfig ? db.getMatrixConfig(code, fac) : null;
      const win = windowFor(cfg);
      const list = all.filter(r => {
        const d = fmtDate(r.date || r.inDate);
        return d && d >= win.f && d <= win.t;
      });
      // 기간 안에 기록이 없으면 계산할 게 없다.
      //   단, 값을 직접 박아둔 원료(SPEC·평균·적용값)는 그 값이라도 보여준다.
      //   계산식만 걸어둔 원료는 데이터가 없으면 빈 줄이라 내보내지 않는다.
      if (!list.length) {
        const fixed = Object.keys((cfg && cfg.items) || {}).some(k => {
          const it = cfg.items[k];
          return it && it.spec != null;
        });
        if (!fixed) return;
      }

      list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      const latest = list[0] || {};
      const name = latest.name || (db.nameOf ? db.nameOf('raw', code) : '') || '';
      const origin = (list.find(r => r.origin) || {}).origin || '';
      const supplier = (list.find(r => r.supplier) || {}).supplier || '';
      const note = (cfg && cfg.note) || (list.find(r => r.note) || {}).note || '';

      const cells = COLS.map(col => {
        const ck = cfgKeyOf(col);
        const ic = db.matrixItemCfg ? db.matrixItemCfg(cfg, ck) : null;

        // ── 측정평균: 고른 분석치의 평균, 지정값이 있으면 그것 ──
        //   제외한 건은 여기서 빠진다. nAll 은 기간 안의 전체, n 은 실제로 평균에 들어간 수.
        const picked = [], dropped = [];
        list.forEach(r => {
          const v = valOf(r, col);
          if (v == null) return;
          if (isExcluded(db, cfg, r.id, ck)) dropped.push(v); else picked.push(v);
        });
        const nAll = picked.length + dropped.length;
        const n = picked.length;
        // 최근 N개월 평균 = 기간 안의 전체(제외한 것까지 포함) — 참고용
        const allVals = picked.concat(dropped);
        const histMean = allVals.length ? avg(allVals) : null;
        const autoMean = picked.length ? avg(picked) : null;
        const autoDevRaw = stdev(picked);
        const spread = autoDevRaw;                      // 적용 편차 = 고른 분석치의 표준편차
        const measured = autoMean;                      // 적용 평균 = 고른 분석치의 평균

        // ── SPEC: 지정값 우선 → 원료스펙 → 규격관리 ──
        let autoSpec = null, src = '';
        if (col.derived === 'drymat') {
          const stm = specTarget(code, 'moist');
          if (stm) { autoSpec = 100 - stm.t; src = stm.source; }
        } else {
          const st = specTarget(code, col.key);
          if (st) { autoSpec = st.t; src = st.source; }
        }
        const specSet = !!(ic && ic.spec != null);
        const spec = specSet ? ic.spec : autoSpec;
        if (specSet) src = 'set';

        // ── 적용 Matrix: 실제로 쓰는 값. 계산식은 항목마다 고른다 ──
        //   논산 양식 그대로 — 수분은 100−평균(건물), 어분·육골분 Prot 은 평균−편차/2.
        const applyMode = (ic && ic.applyMode) || '';
        const applied = db.matrixApply
          ? db.matrixApply(ic, measured, spread, col.derived === 'drymat')
          : (col.derived === 'drymat' ? (measured == null ? null : 100 - measured) : measured);

        // ── 색상: 적용 Matrix 가 SPEC 에서 얼마나 벗어났는가 ──
        const gap = (applied != null && spec != null) ? applied - spec : null;
        let tone = '';
        if (gap != null) {
          const jv = (col.derived === 'drymat' || applyMode) ? 'NA' : verdict(code, col.key, applied);
          if (jv === 'HIGH') tone = 'hi';
          else if (jv === 'LOW') tone = 'lo';
          else {
            const at = Math.abs(spec);
            tone = (at >= 1 && Math.abs(gap) / at >= 0.15) ? 'warn' : 'ok';
          }
        }
        const applyDiv = (db.applyDivOf ? db.applyDivOf(ic) : 2);
        return { histMean, measured, spec, autoSpec, applied, gap, sd: spread,
                 n, nAll, tone, src, specSet, applyMode, applyDiv };
      });

      const sampleN = Math.max(0, ...cells.map(c => c.n));
      const sampleAll = Math.max(0, ...cells.map(c => c.nAll));
      const exCount = list.filter(r => cfg && cfg.ex && cfg.ex[r.id]).length;
      rows.push({ code, name, origin, supplier, note, cells, sampleN, sampleAll, exCount,
                  recCount: list.length, list, cfg, win });
    });

    rows.sort((a, b) => a.code.localeCompare(b.code));
    const q = query.trim().toLowerCase();
    const shown = q ? rows.filter(r => (r.code + ' ' + r.name).toLowerCase().includes(q)) : rows;

    const usedCols = hideEmpty
      ? COLS.filter((col, i) => shown.some(r => r.cells[i].measured != null || r.cells[i].spec != null))
      : COLS;

    lastRows = shown;
    // 건수는 화면에 보이는 것과 맞춘다(검색으로 걸러낸 원료의 기록까지 세면 숫자가 어긋난다)
    const total = shown.reduce((s, r) => s + r.recCount, 0);
    const setCount = shown.filter(r => r.cfg).length;
    return { rows: shown, usedCols, total, codes: byCode.size, refCount: (RAW() ? Object.keys(RAW()).length : 0), setCount };
  };

  // ── 렌더 ──
  const devClass = (c) => {
    if (c.gap == null) return '';
    if (c.tone === 'hi') return 'mx-hi';
    if (c.tone === 'lo') return 'mx-lo';
    if (c.tone === 'warn') return 'mx-warn';
    return 'mx-ok';
  };

  const render = () => {
    ensureRange();
    const data = build();
    const cols = data.usedCols;
    const colIdx = cols.map(c => COLS.indexOf(c));

    const head = `
      <tr class="mx-head">
        <th class="mx-sticky mx-c-code">코드</th>
        <th class="mx-sticky mx-c-name">원료명</th>
        <th class="mx-c-org">원산지</th>
        <th class="mx-c-sup">모선/공급사</th>
        <th class="mx-c-row"></th>
        ${cols.map(c => `<th class="mx-num">${c.label}</th>`).join('')}
        <th class="mx-c-note">비고</th>
        <th class="mx-num">표본</th>
        <th class="mx-c-act">기준값</th>
      </tr>`;

    // 논산 원료Matrix 양식의 5행 구조 — 최근평균 / 적용평균 / 적용편차 / 적용 Matrix / SPEC
    const body = data.rows.map(r => {
      const cell = (i, kind) => {
        const c = r.cells[i];
        const d = COLS[i].dig;
        if (kind === 'h') return `<td class="mx-num mx-hist">${fmt(c.histMean, d)}</td>`;
        if (kind === 'm') return `<td class="mx-num">${fmt(c.measured, d)}</td>`;
        if (kind === 'd') return `<td class="mx-num mx-dev">${fmt(c.sd, d)}</td>`;
        if (kind === 'a') {
          const bits = [];
          if (c.applyMode === 'minus') bits.push('적용평균 − 적용편차 ÷ ' + c.applyDiv);
          else if (COLS[i].derived === 'drymat') bits.push('100 − 적용평균');
          if (c.gap != null) bits.push('SPEC 대비 ' + (c.gap > 0 ? '+' : '') + fmt(c.gap, d));
          // 적용식이 걸린 칸은 밑줄로 구분한다. 기호를 숫자 앞에 붙이면 읽기만 어렵다.
          const note = bits.length ? ` title="${esc(bits.join(' · '))}"` : '';
          return `<td class="mx-num mx-apply ${devClass(c)} ${c.applyMode ? 'mx-set' : ''}"${note}>${fmt(c.applied, d)}</td>`;
        }
        return `<td class="mx-num mx-spec ${c.specSet ? 'mx-set' : ''}"${c.specSet ? ` title="직접 지정한 값 (자동 ${fmt(c.autoSpec, d) || '없음'})"` : ''}>${c.spec == null ? '' : fmt(c.spec, d)}</td>`;
      };
      const period = `<div class="mx-period ${r.win.custom ? 'mx-period-set' : ''}">${r.win.months}개월</div>`;
      const histLabel = `최근 ${r.win.months}개월 평균`;
      return `
        <tr class="mx-r1">
          <td class="mx-sticky mx-c-code" rowspan="5">${esc(r.code)}</td>
          <td class="mx-sticky mx-c-name" rowspan="5"><b>${esc(r.name) || '-'}</b>${period}</td>
          <td class="mx-c-org" rowspan="5">${esc(r.origin)}</td>
          <td class="mx-c-sup" rowspan="5">${esc(r.supplier)}</td>
          <td class="mx-c-row mx-lbl-h">${histLabel}${help('months')}</td>
          ${colIdx.map(i => cell(i, 'h')).join('')}
          <td class="mx-c-note" rowspan="5">${esc(r.note)}</td>
          <td class="mx-num" rowspan="5">${r.sampleN}${r.sampleN < r.sampleAll ? `<span class="mx-drop" title="${r.sampleAll - r.sampleN}건을 적용에서 뺐습니다">/${r.sampleAll}</span>` : ''}</td>
          <td class="mx-c-act" rowspan="5">
            <button class="mx-btn mx-btn-sm ${r.cfg ? 'mx-btn-on' : ''}" onclick="RawMatrixPage.openConfig('${esc(r.code)}')">${r.cfg ? '지정됨' : '설정'}</button>
          </td>
        </tr>
        <tr class="mx-r2"><td class="mx-c-row mx-lbl-m">적용 평균${help('mean')}</td>${colIdx.map(i => cell(i, 'm')).join('')}</tr>
        <tr class="mx-r3"><td class="mx-c-row mx-lbl-d">적용 편차${help('sd')}</td>${colIdx.map(i => cell(i, 'd')).join('')}</tr>
        <tr class="mx-r4"><td class="mx-c-row mx-lbl-a">적용 Matrix${help('matrix')}</td>${colIdx.map(i => cell(i, 'a')).join('')}</tr>
        <tr class="mx-r5"><td class="mx-c-row mx-lbl-s">SPEC${help('spec')}</td>${colIdx.map(i => cell(i, 's')).join('')}</tr>`;
    }).join('');

    const rangeLabel = `${minusMonths(baseDate, baseMonths)} ~ ${baseDate} (기본 ${baseMonths}개월)`;
    const empty = !data.rows.length
      ? `<div class="mx-empty">적용 기간(${rangeLabel})에 해당하는 원료 분석대장 기록이 없습니다.<br>
         적용 개월수를 늘리거나 기간을 직접 지정해 보세요.</div>`
      : '';

    let facLabel = '';
    try { const f = App.getFactory && App.getFactory(); facLabel = (f && f !== 'ALL') ? ({ NS: '논산', GS: '경산', AS: '아산', HQ: '본사' }[f] || f) : '전체'; } catch (_) {}

    return `
      <style>
        .mx-wrap{max-width:100%;}
        .mx-toolbar{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;
          background:var(--bg-surface,#fff);border:1px solid var(--border,#e3e3e3);border-radius:6px;padding:12px 14px;}
        .mx-fg{display:flex;flex-direction:column;gap:3px;}
        .mx-fg label{font-size:11px;color:var(--text-secondary,#5c5f66);}
        .mx-fg input{border:1px solid var(--border,#d5d5d5);border-radius:4px;padding:6px 8px;font-size:13px;background:var(--bg-input,#fff);color:var(--text-primary,#171a20);}
        .mx-fg input[type=number]{width:88px;}
        .mx-quick{display:flex;gap:4px;}
        .mx-quick button,.mx-btn{border:1px solid var(--border,#d5d5d5);background:var(--bg-soft,#f5f5f5);border-radius:4px;padding:6px 11px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--text-primary,#171a20);}
        .mx-quick button:hover,.mx-btn:hover{border-color:var(--accent,#3E6AE1);}
        .mx-quick button.on{background:var(--accent,#3E6AE1);color:#fff;border-color:var(--accent,#3E6AE1);font-weight:600;}
        .mx-btn-primary{background:var(--accent,#3E6AE1);color:#fff;border-color:var(--accent,#3E6AE1);font-weight:600;}
        .mx-btn-sm{padding:3px 8px;font-size:11px;}
        .mx-btn-on{border-color:var(--accent,#3E6AE1);color:var(--accent,#3E6AE1);font-weight:600;}
        .mx-spacer{flex:1;}
        .mx-chk{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-secondary,#5c5f66);cursor:pointer;}
        .mx-meta{font-size:12px;color:var(--text-secondary,#5c5f66);margin:0 0 10px;line-height:1.6;}
        .mx-meta b{color:var(--accent,#3E6AE1);}
        /* 가로로 긴 표라 고정 열(코드·원료명)이 붙어 있다.
           sticky + rowspan 조합은 스크롤 중 잔상이 남기 쉬워 이 영역을 별도 레이어로 올린다. */
        .mx-scroll{overflow-x:auto;border:1px solid var(--border,#e3e3e3);border-radius:6px;
          will-change:transform;-webkit-overflow-scrolling:touch;}
        table.mx{border-collapse:collapse;font-size:12px;white-space:nowrap;background:var(--bg-surface,#fff);}
        table.mx th,table.mx td{border:1px solid var(--border,#ececec);padding:4px 8px;text-align:center;}
        table.mx th{background:var(--bg-soft,#f4f4f6);font-weight:600;position:sticky;top:0;z-index:2;}
        .mx-num{text-align:right;font-variant-numeric:tabular-nums;min-width:52px;}
        .mx-c-code{min-width:56px;} .mx-c-name{min-width:150px;text-align:left;}
        .mx-c-org{min-width:70px;} .mx-c-sup{min-width:120px;text-align:left;font-size:11px;color:var(--text-secondary,#666);}
        .mx-c-note{min-width:90px;font-size:11px;color:var(--text-secondary,#666);}
        .mx-c-act{min-width:60px;}
        .mx-c-row{min-width:110px;text-align:left;font-size:11px;font-weight:600;color:var(--text-secondary,#5c5f66);background:var(--bg-soft,#fafafb);}
        /* 고정 열은 스크롤되는 셀 위에 겹쳐 그려지므로 배경이 반드시 불투명해야 한다.
           원료명 칸의 왼쪽 위치는 코드 칸의 실제 너비라서 렌더 뒤에 재어 --mx-code-w 로 넣는다
           (56px 처럼 박아두면 코드가 길어질 때 두 열이 서로를 덮는다). */
        .mx-sticky{position:sticky;left:0;background:var(--bg-surface,#f4f4f4);z-index:1;}
        table.mx th.mx-sticky{background:var(--bg-soft,#f4f4f6);z-index:3;}
        .mx-c-name.mx-sticky{left:var(--mx-code-w,68px);
          box-shadow:1px 0 0 var(--border,#e3e3e3), 7px 0 9px -7px rgba(0,0,0,.28);}
        .mx-period{font-size:10px;font-weight:400;color:var(--text-secondary,#8a8f96);margin-top:2px;}
        .mx-period-set{color:var(--accent,#3E6AE1);font-weight:600;}
        .mx-r1 td{background:var(--bg-surface,#f4f4f4);}
        .mx-hist{color:#8a8f96;}
        .mx-dev{color:#5b6470;}
        .mx-spec{color:#5b6470;}
        .mx-apply{font-weight:700;}
        .mx-set{border-bottom:2px solid var(--accent,#3E6AE1) !important;font-weight:700;}
        .mx-lbl-h{color:#a0a4aa;} .mx-lbl-m{color:#171a20;} .mx-lbl-d{color:#5b6470;}
        .mx-lbl-a{color:var(--accent,#3E6AE1);font-weight:700;} .mx-lbl-s{color:#8a8f96;}
        .mx-r4 td{background:#f2f6ff;}
        .mx-r5 td{border-bottom:2px solid var(--border,#d5d5d5);}
        .mx-hi{color:#c0392b;font-weight:700;background:#fdecec !important;}
        .mx-lo{color:#2563eb;font-weight:700;background:#eaf1fe !important;}
        .mx-warn{color:#b8860b;font-weight:700;background:#fff7e6 !important;}
        .mx-ok{color:#16884a;}
        .mx-empty{padding:40px;text-align:center;color:var(--text-secondary,#5c5f66);line-height:1.7;}
        /* 설명 배지 — 가져다 대면 말풍선이 뜬다 */
        .mx-help{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;
          border:1px solid var(--border,#d5d5d5);border-radius:50%;font-size:10px;font-weight:700;
          color:var(--text-secondary,#8a8f96);background:var(--bg-base,#fff);cursor:help;
          margin-left:5px;vertical-align:middle;line-height:1;user-select:none;}
        .mx-help:hover{border-color:var(--accent,#3E6AE1);color:var(--accent,#3E6AE1);}
        /* 말풍선은 body 에 붙는다 — 표 안에 두면 가로 스크롤 영역이 잘라낸다 */
        .mx-bubble{position:fixed;z-index:9999;width:340px;max-width:calc(100vw - 24px);
          background:var(--bg-base,#fff);border:1px solid var(--border,#d5d5d5);border-radius:9px;
          padding:13px 15px;box-shadow:0 10px 30px rgba(0,0,0,.16);
          font-size:12.5px;line-height:1.72;color:var(--text-primary,#171a20);text-align:left;
          white-space:normal;font-weight:400;pointer-events:none;}
        .mx-bubble .hb-t{font-weight:700;font-size:13px;margin-bottom:7px;
          padding-bottom:6px;border-bottom:1px solid var(--border,#ececec);}
        .mx-bubble p{margin:0 0 7px;}
        .mx-bubble p:last-child{margin-bottom:0;}
        .mx-bubble code{font-family:var(--font-mono,monospace);font-size:11.5px;
          background:var(--bg-soft,#f4f4f6);padding:1px 4px;border-radius:3px;}
        .mx-bubble .hb-eg{background:var(--bg-soft,#f7f7f9);border-left:3px solid var(--accent,#3E6AE1);
          border-radius:0 5px 5px 0;padding:7px 10px;color:var(--text-secondary,#5c5f66);}
        .mx-bubble .hb-hi{color:#c0392b;font-weight:600;}
        .mx-bubble .hb-lo{color:#2563eb;font-weight:600;}
        .mx-bubble .hb-warn{color:#b8860b;font-weight:600;}
        /* 꼬리 */
        .mx-bubble::before,.mx-bubble::after{content:'';position:absolute;left:50%;transform:translateX(-50%);
          border:8px solid transparent;}
        .mx-bubble.hb-up::before{top:100%;border-top-color:var(--border,#d5d5d5);}
        .mx-bubble.hb-up::after{top:calc(100% - 1px);border-top-color:var(--bg-base,#fff);}
        .mx-bubble.hb-down::before{bottom:100%;border-bottom-color:var(--border,#d5d5d5);}
        .mx-bubble.hb-down::after{bottom:calc(100% - 1px);border-bottom-color:var(--bg-base,#fff);}
        .mx-drop{font-size:10px;color:var(--text-secondary,#8a8f96);}
        /* 설정 모달 */
        .mxc-body{padding:16px;display:flex;flex-direction:column;gap:12px;max-height:72vh;overflow:auto;}
        .mxc-top{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;}
        .mxc-hint{font-size:12px;color:var(--text-secondary,#5c5f66);line-height:1.6;
          background:var(--bg-soft,#f7f7f9);border:1px solid var(--border,#e9e9ec);border-radius:5px;padding:9px 11px;}
        .mxc-tabs{display:flex;gap:6px;border-bottom:1px solid var(--border,#e3e3e3);padding-bottom:0;}
        .mxc-tabs button{border:1px solid transparent;border-bottom:none;background:transparent;cursor:pointer;
          font-family:inherit;font-size:12.5px;padding:7px 13px;border-radius:5px 5px 0 0;margin-bottom:-1px;
          color:var(--text-secondary,#5c5f66);}
        .mxc-tabs button.on{background:var(--bg-surface,#fff);border-color:var(--border,#e3e3e3);
          color:var(--accent,#3E6AE1);font-weight:600;}
        .mxd-scroll{overflow:auto;max-height:46vh;border:1px solid var(--border,#e3e3e3);border-radius:5px;}
        table.mxc,table.mxd{border-collapse:collapse;font-size:12px;width:100%;}
        table.mxc th,table.mxc td,table.mxd th,table.mxd td{border:1px solid var(--border,#ececec);padding:5px 7px;text-align:center;}
        table.mxc th,table.mxd th{background:var(--bg-soft,#f4f4f6);font-weight:600;font-size:11px;position:sticky;top:0;z-index:2;}
        table.mxc td.mxc-lbl{text-align:left;font-weight:600;}
        table.mxc td.mxc-auto{text-align:right;font-variant-numeric:tabular-nums;color:var(--text-secondary,#8a8f96);}
        table.mxc input,table.mxc select{width:82px;border:1px solid var(--border,#d5d5d5);border-radius:4px;padding:4px 6px;
          font-size:12px;text-align:right;font-family:inherit;background:var(--bg-input,#fff);color:var(--text-primary,#171a20);}
        table.mxc select{width:104px;text-align:left;}
        table.mxc input:focus,table.mxc select:focus{border-color:var(--accent,#3E6AE1);outline:none;}
        table.mxc input:disabled{background:var(--bg-soft,#f4f4f6);color:var(--text-secondary,#a8acb3);}
        /* 적용식 + 편차 나눗값 */
        .mxc-applywrap{display:flex;flex-direction:column;gap:4px;align-items:flex-start;}
        .mxc-div{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--text-secondary,#5c5f66);white-space:nowrap;}
        .mxc-div input{width:48px;}
        .mxc-hide{display:none;}
        /* 로우데이터 선택 */
        table.mxd{white-space:nowrap;}
        .mxd-chk{width:34px;} .mxd-date{width:86px;} .mxd-id{width:120px;font-size:11px;color:var(--text-secondary,#666);}
        .mxd-sup{max-width:150px;overflow:hidden;text-overflow:ellipsis;font-size:11px;text-align:left;color:var(--text-secondary,#666);}
        .mxd-v{cursor:pointer;}
        .mxd-v:hover{background:var(--bg-soft,#eef2fd);}
        .mxd-vout{color:var(--text-secondary,#b0b4ba);text-decoration:line-through;}
        .mxd-far{color:#b8860b;font-weight:700;background:#fff7e6;}
        .mxd-legend{padding:1px 5px;border-radius:3px;}
        .mxd-off td{background:var(--bg-soft,#f7f7f9);color:var(--text-secondary,#b0b4ba);}
        .mxd-off .mxd-v{text-decoration:line-through;}
        /* 합계 두 줄은 겹치지 않게 위아래로 붙인다(둘 다 bottom:0 이면 포개진다) */
        .mxd-sum td{position:sticky;background:var(--bg-soft,#f4f4f6);font-weight:700;z-index:1;}
        .mxd-sum td:first-child{text-align:left;}
        .mxd-mean td{bottom:26px;border-top:2px solid var(--border,#d5d5d5);}
        .mxd-sub td{bottom:0;font-weight:400;color:var(--text-secondary,#5c5f66);}
        .mxd-n{font-size:10px;color:var(--text-secondary,#8a8f96);font-weight:400;}
        /* 앱 전체가 라이트 전용이라 다크 대응은 두지 않는다.
           이 화면만 prefers-color-scheme 을 따르면 흰 배경 위에 어두운 셀이 찍힌다. */
      </style>
      <div class="mx-wrap">
        <div class="mx-toolbar">
          <div class="mx-fg"><label>기준일${help('base')}</label><input type="date" value="${baseDate}" onchange="RawMatrixPage.setBaseDate(this.value)"></div>
          <div class="mx-fg"><label>기본 적용 개월수${help('months')}</label><input type="number" min="1" max="60" step="1" value="${baseMonths}" onchange="RawMatrixPage.setMonths(this.value)"></div>
          <div class="mx-quick">
            ${[1, 3, 6, 12, 24].map(m => `<button class="${baseMonths === m ? 'on' : ''}" onclick="RawMatrixPage.quick(${m})">${m}개월</button>`).join('')}
          </div>
          <div class="mx-fg"><label>원료 검색</label><input type="text" placeholder="코드·원료명" value="${esc(query)}" oninput="RawMatrixPage.setQuery(this.value)"></div>
          <div class="mx-spacer"></div>
          <label class="mx-chk"><input type="checkbox" ${hideEmpty ? 'checked' : ''} onchange="RawMatrixPage.toggleEmpty(this.checked)"> 빈 항목열 숨김</label>
          <button class="mx-btn mx-btn-primary" onclick="RawMatrixPage.exportXlsx()">엑셀 내보내기</button>
        </div>
        <p class="mx-meta">
          적용 기간 <b>${rangeLabel}</b> · 공장 <b>${facLabel}</b> · 원료 <b>${data.rows.length}</b>종 · 분석기록 <b>${data.total}</b>건에서 자동 집계.
원료별로 따로 지정한 원료 <b>${data.setCount}</b>종.
          <br>논산 원료Matrix 양식과 같은 순서입니다 — <b>적용 평균</b>과 <b>적용 편차</b>에서 <b>적용 Matrix</b> 를 내고 SPEC 과 견줍니다.
          수분은 적용 Matrix 에서 건물(100−수분)로 뒤집히고, 어분·육골분처럼 모선마다 단백이 흔들리는 원료는
          Prot 을 <b>적용평균 − 적용편차 ÷ 2</b> 로 낮춰 잡습니다(해당 칸에 밑줄).
          SPEC 대비 상한초과 · 하한미달 · 15% 초과(허용편차를 지정하면 그 폭)를 색으로 표시하며,
          밑줄 친 값은 자동 집계가 아니라 직접 지정한 값입니다.
        </p>
        ${empty}
        <div class="mx-scroll" ${data.rows.length ? '' : 'style="display:none"'}>
          <table class="mx"><thead>${head}</thead><tbody>${body}</tbody></table>
        </div>

        <div class="modal-overlay" id="mx-cfg-modal">
          <div class="modal modal-lg">
            <div class="modal-header">
              <div class="modal-title" id="mx-cfg-title">기준값 설정</div>
              <button class="modal-close" onclick="RawMatrixPage.closeConfig()">✕</button>
            </div>
            <div id="mx-cfg-body"></div>
          </div>
        </div>
      </div>`;
  };

  // 고정 열 두 개가 서로 겹치지 않도록 코드 칸의 실제 너비를 재어 원료명 칸의 left 로 넣는다.
  //   코드 길이·글꼴에 따라 칸 너비가 달라지므로 CSS 에 숫자를 박아둘 수 없다.
  const syncStickyOffset = () => {
    const wrap = document.querySelector('.mx-wrap');
    const th = wrap && wrap.querySelector('table.mx thead th.mx-c-code');
    if (!th) return;
    const w = Math.round(th.getBoundingClientRect().width);
    if (w > 0) wrap.style.setProperty('--mx-code-w', w + 'px');
  };

  const afterRender = () => { closeBubble(); syncStickyOffset(); bindHelp(); };

  const rerender = () => {
    const el = document.getElementById('page-content');
    if (!el) return;
    closeBubble();                                            // 다시 그리기 전에 떠 있는 말풍선 제거
    const y = window.pageYOffset || document.documentElement.scrollTop || 0;   // 스크롤 위치 유지
    el.innerHTML = render();
    try { window.scrollTo({ top: y, left: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, y); }
    syncStickyOffset();
  };

  // ── 설정 모달 ──
  //   여는 동안의 편집 상태를 여기 담아둔다. 체크할 때마다 저장하면 되돌리기가 어렵고,
  //   저장을 눌러야 반영되는 편이 예측 가능하다.
  let editing = null;   // { code, row, cfg, ex, tab }

  const openConfig = (code) => {
    const row = lastRows.find(r => r.code === code);
    if (!row) return;
    const db = LDB();
    const fac = curFactory();
    // 설정은 캐시된 행이 아니라 저장소에서 다시 읽는다.
    // 다른 단말이 고쳤거나 방금 저장한 뒤라면 행에 붙은 값이 이미 옛것이다.
    const cfg = (db && db.getMatrixConfig) ? db.getMatrixConfig(row.code, fac) : row.cfg;
    const ex = {};
    Object.keys((cfg && cfg.ex) || {}).forEach(k => {
      const v = cfg.ex[k];
      if (v === true) ex[k] = true;
      else if (Array.isArray(v) && v.length) ex[k] = v.slice();
    });
    editing = { code, row, cfg: cfg ? { ...cfg } : null, ex, tab: 'data' };
    const title = document.getElementById('mx-cfg-title');
    if (title) title.textContent = `설정 — ${row.code} ${row.name || ''}`;
    drawConfig();
    document.getElementById('mx-cfg-modal').classList.add('open');
  };

  const facHint = () => {
    const fac = curFactory();
    const facName = ({ NS: '논산공장', GS: '경산공장', AS: '아산공장', HQ: '본사' })[fac] || '';
    return fac === 'ALL'
      ? '지금은 <b>전체 공장</b> 기준으로 저장돼 모든 공장에 적용됩니다.'
      : `<b>${facName}</b>에만 적용됩니다. 전 공장 공통으로 두려면 상단 공장을 전체로 바꾸고 저장하세요.`;
  };

  const exHas = (recId, itemKey) => {
    const v = editing.ex[recId];
    if (!v) return false;
    if (v === true) return true;
    return v.indexOf(itemKey) >= 0;
  };

  // 편집 중인 제외 상태·계산식으로 이 항목을 다시 집계 — 모달 안에서 즉시 반영된다
  const liveStat = (col) => {
    const ck = cfgKeyOf(col);
    const picked = [];
    let dropped = 0;
    editing.row.list.forEach(r => {
      const v = valOf(r, col);
      if (v == null) return;
      if (exHas(r.id, ck)) dropped++; else picked.push(v);
    });
    return { mean: picked.length ? avg(picked) : null, sd: stdev(picked), n: picked.length, dropped };
  };

  const drawConfig = () => {
    const body = document.getElementById('mx-cfg-body');
    if (!body || !editing) return;
    const { row, cfg, tab } = editing;
    const exN = Object.keys(editing.ex).length;

    body.innerHTML = `
      <div class="mxc-body">
        <div class="mxc-top">
          <div class="mx-fg">
            <label>적용 개월수 (비우면 기본 ${baseMonths}개월)</label>
            <input type="number" id="mxc-months" min="1" max="60" step="1" value="${cfg && cfg.months ? cfg.months : ''}"
                   placeholder="${baseMonths}" onchange="RawMatrixPage.applyMonths(this.value)">
          </div>
          <div class="mx-fg" style="flex:1;min-width:180px">
            <label>비고</label>
            <input type="text" id="mxc-note" value="${esc(cfg && cfg.note)}" placeholder="매트릭스 비고란에 표시됩니다">
          </div>
        </div>
        <div class="mxc-tabs">
          <button class="${tab === 'data' ? 'on' : ''}" onclick="RawMatrixPage.setTab('data')">분석 데이터 ${row.list.length}건${exN ? ` · ${exN}건 제외` : ''}</button>
          <button class="${tab === 'base' ? 'on' : ''}" onclick="RawMatrixPage.setTab('base')">기준값</button>
        </div>
        ${tab === 'data' ? renderDataTab() : renderBaseTab()}
      </div>
      <div class="modal-footer">
        ${cfg && cfg.id ? `<button class="btn btn-ghost" onclick="RawMatrixPage.resetConfig('${esc(editing.code)}')">지정 해제</button>` : ''}
        <button class="btn btn-ghost" onclick="RawMatrixPage.closeConfig()">취소</button>
        <button class="btn btn-primary" onclick="RawMatrixPage.saveConfig('${esc(editing.code)}')">저장</button>
      </div>`;
  };

  // ── 탭 1: 로우데이터에서 평균에 쓸 것을 고른다 ──
  const renderDataTab = () => {
    const list = editing.row.list;
    if (!list.length) {
      return `<div class="mxc-hint">이 기간에는 분석 기록이 없습니다. 위의 적용 개월수를 늘려보세요.</div>`;
    }
    // 값이 하나라도 있는 항목만 편다(14개를 다 펼치면 읽을 수가 없다)
    const cols = COLS.filter(col => list.some(r => valOf(r, col) != null));
    const stats = cols.map(col => liveStat(col));

    const head = `
      <tr>
        <th class="mxd-chk"><input type="checkbox" ${list.some(r => editing.ex[r.id] !== true) ? 'checked' : ''}
            onchange="RawMatrixPage.pickAll(this.checked)" title="전체 선택 / 해제"></th>
        <th class="mxd-date">분석일</th>
        <th class="mxd-id">접수번호</th>
        <th class="mxd-sup">공급사 · 원산지</th>
        ${cols.map(c => `<th class="mx-num">${c.label}</th>`).join('')}
      </tr>`;

    const body = list.map(r => {
      const whole = editing.ex[r.id] === true;
      return `
        <tr class="${whole ? 'mxd-off' : ''}">
          <td class="mxd-chk"><input type="checkbox" ${whole ? '' : 'checked'} onchange="RawMatrixPage.pickRow('${esc(r.id)}', this.checked)"></td>
          <td class="mxd-date">${esc(fmtDate(r.date || r.inDate))}</td>
          <td class="mxd-id">${esc(r.id)}</td>
          <td class="mxd-sup">${esc(r.supplier || r.origin || '')}</td>
          ${cols.map((col, ci) => {
            const v = valOf(r, col);
            if (v == null) return '<td class="mx-num"></td>';
            const off = exHas(r.id, cfgKeyOf(col));
            const s = stats[ci];
            // 고른 값들의 평균에서 2σ 넘게 떨어진 값은 눈에 띄게 — 뺄지 말지는 사람이 판단한다
            const far = !off && s.mean != null && s.sd && s.sd > 0 && Math.abs(v - s.mean) > 2 * s.sd;
            const cls = ['mx-num', 'mxd-v', off ? 'mxd-vout' : '', far ? 'mxd-far' : ''].filter(Boolean).join(' ');
            const t = off ? '평균에서 뺀 값 — 누르면 되돌립니다' : '누르면 이 값만 평균에서 뺍니다';
            return `<td class="${cls}" title="${t}" onclick="RawMatrixPage.pickVal('${esc(r.id)}','${cfgKeyOf(col)}')">${fmt(v, col.dig)}</td>`;
          }).join('')}
        </tr>`;
    }).join('');

    const foot = `
      <tr class="mxd-sum mxd-mean">
        <td colspan="4">고른 값의 평균</td>
        ${cols.map((c, ci) => `<td class="mx-num">${fmt(stats[ci].mean, c.dig)}</td>`).join('')}
      </tr>
      <tr class="mxd-sum mxd-sub">
        <td colspan="4">적용 편차 (건수)${help('sd')}</td>
        ${cols.map((c, ci) => `<td class="mx-num">${fmt(stats[ci].sd, c.dig)} <span class="mxd-n">(${stats[ci].n}${stats[ci].dropped ? '/' + (stats[ci].n + stats[ci].dropped) : ''})</span></td>`).join('')}
      </tr>`;

    return `
      <div class="mxc-hint">
        체크를 풀면 그 분석 건 <b>전체</b>가 평균에서 빠지고, <b>값을 직접 누르면 그 항목 하나만</b> 빠집니다.
        고른 값의 평균에서 2σ 넘게 떨어진 값은 <span class="mxd-far mxd-legend">이렇게</span> 표시해 두었습니다.
      </div>
      <div class="mxd-scroll">
        <table class="mxd"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>
      </div>`;
  };

  // ── 탭 2: 항목별 기준값 ──
  const renderBaseTab = () => {
    const db = LDB();
    const { row, cfg } = editing;
    const APPLY = (db && db.APPLY_MODES) || [];
    const divBase = (db && db.APPLY_DIV) || 2;   // 양식 기본 나눗값
    const v = (x) => (x == null ? '' : x);
    const rows = COLS.map((col, i) => {
      const c = row.cells[i];
      const ck = cfgKeyOf(col);
      const ic = db && db.matrixItemCfg ? db.matrixItemCfg(cfg, ck) : null;
      const s = liveStat(col);
      const mode = (ic && ic.applyMode) || '';
      const preview = db && db.matrixApply ? db.matrixApply(ic, s.mean, s.sd, col.derived === 'drymat') : null;
      return `
        <tr>
          <td class="mxc-lbl">${col.label}</td>
          <td class="mxc-auto">${fmt(s.mean, col.dig)}${s.n ? ` <span class="mxd-n">(${s.n})</span>` : ''}</td>
          <td class="mxc-auto">${fmt(s.sd, col.dig)}</td>
          <td>
            <div class="mxc-applywrap">
              <select data-k="applyMode" data-item="${ck}" onchange="RawMatrixPage.onApplyMode(this)"
                      ${col.derived === 'drymat' ? 'disabled title="수분은 100−적용평균 으로 고정입니다"' : ''}>
                ${APPLY.map(m => `<option value="${m.key}" ${mode === m.key ? 'selected' : ''}>${m.label}</option>`).join('')}
              </select>
              <span class="mxc-div ${mode === 'minus' ? '' : 'mxc-hide'}">편차 ÷ <input type="number" step="any" min="0.1"
                    data-k="applyDiv" data-item="${ck}" value="${v(ic && ic.applyDiv)}"
                    placeholder="${divBase}" title="편차를 이 값으로 나눠 뺍니다 (기본 ${divBase})"
                    onchange="RawMatrixPage.onApplyMode(this)"></span>
            </div>
          </td>
          <td class="mxc-auto mxc-prev">${fmt(preview, col.dig)}</td>
          <td class="mxc-auto">${fmt(c.autoSpec, col.dig)}</td>
          <td><input type="number" step="any" data-k="spec" data-item="${ck}" value="${v(ic && ic.spec)}" placeholder="자동"></td>
        </tr>`;
    }).join('');

    return `
      <div class="mxc-hint">
        논산 원료Matrix 양식과 같은 순서입니다 — <b>적용 평균</b>과 <b>적용 편차</b>로 <b>적용 Matrix</b> 를 내고 SPEC 과 견줍니다.
        평균·편차는 <b>앞 탭에서 고른 분석치</b>로 자동 계산되며 직접 넣지 않습니다.
        여기서 정하는 것은 <b>적용식</b>과 <b>SPEC</b> 두 가지입니다.
        ${facHint()}
      </div>
      <div class="mxd-scroll">
        <table class="mxc">
          <thead>
            <tr>
              <th style="text-align:left">항목</th>
              <th>적용 평균${help('mean')}</th>
              <th>적용 편차${help('sd')}</th>
              <th>적용식${help('apply')}</th>
              <th>적용 Matrix${help('matrix')}</th>
              <th>SPEC(자동)</th>
              <th>SPEC 지정${help('spec')}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  };

  // 기준값 탭의 입력값은 탭을 옮기거나 개월수를 바꿔도 남아 있어야 한다.
  // 다시 그리기 전에 걷어서 editing.cfg 에 넣어둔다(저장소는 [저장] 을 눌러야 건드린다).
  const stashItems = () => {
    const body = document.getElementById('mx-cfg-body');
    if (!editing || !body || !body.querySelector('[data-item]')) return;
    const raw = {};
    body.querySelectorAll('[data-item]').forEach(el => {
      const it = el.dataset.item;
      if (!raw[it]) raw[it] = {};
      raw[it][el.dataset.k] = el.value;
    });
    const n = (x) => (x === '' || x == null || !isFinite(Number(x))) ? null : Number(x);
    const divBase = (LDB() && LDB().APPLY_DIV) || 2;
    const kept = {};
    Object.keys(raw).forEach(k => {
      const s = raw[k];
      const mode = s.applyMode === 'minus' ? 'minus' : '';
      const one = { spec: n(s.spec), applyMode: mode };
      const div = mode === 'minus' ? n(s.applyDiv) : null;
      if (div != null && div > 0 && div !== divBase) one.applyDiv = div;
      if (one.spec != null || one.applyMode) kept[k] = one;
    });
    editing.cfg = { ...(editing.cfg || {}), items: kept };
  };

  const stashHeader = () => {
    if (!editing) return;
    const note = document.getElementById('mxc-note');
    if (note) editing.cfg = { ...(editing.cfg || {}), note: note.value };
  };

  const setTab = (t) => { if (!editing) return; stashItems(); stashHeader(); editing.tab = t; drawConfig(); };

  const pickRow = (id, on) => {
    if (!editing) return;
    if (on) delete editing.ex[id]; else editing.ex[id] = true;
    stashHeader(); drawConfig();
  };
  const pickAll = (on) => {
    if (!editing) return;
    if (on) editing.ex = {};
    else editing.row.list.forEach(r => { editing.ex[r.id] = true; });
    stashHeader(); drawConfig();
  };
  const pickVal = (id, itemKey) => {
    if (!editing) return;
    const cur = editing.ex[id];
    if (cur === true) return;                    // 건 전체가 빠져 있으면 체크박스로 되돌린다
    const list = Array.isArray(cur) ? cur.slice() : [];
    const i = list.indexOf(itemKey);
    if (i >= 0) list.splice(i, 1); else list.push(itemKey);
    if (list.length) editing.ex[id] = list; else delete editing.ex[id];
    stashHeader(); drawConfig();
  };

  // 적용 개월수를 바꾸면 대상 분석치 자체가 달라지므로 목록을 다시 뽑는다
  const applyMonths = (v) => {
    if (!editing) return;
    stashItems(); stashHeader();
    const db = LDB(); if (!db) return;
    const n = Math.round(Number(v));
    editing.cfg = { ...(editing.cfg || {}), months: (isFinite(n) && n > 0) ? Math.min(n, 60) : null };
    const win = windowFor(editing.cfg);
    const fac = curFactory();
    const list = db.getRecords('raw').filter(r => {
      if (String(r.code || '').trim() !== editing.code) return false;
      if (fac && fac !== 'ALL' && r.factory && r.factory !== fac) return false;
      const d = fmtDate(r.date || r.inDate);
      return d && d >= win.f && d <= win.t;
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    editing.row = { ...editing.row, win, list };
    drawConfig();
  };

  // 적용식을 바꾸면 관련 입력칸만 열고 미리보기를 다시 계산한다
  const onApplyMode = (sel) => {
    if (!editing) return;
    stashItems(); stashHeader();
    drawConfig();
  };

  const closeConfig = () => {
    document.getElementById('mx-cfg-modal')?.classList.remove('open');
    editing = null;
  };

  const saveConfig = (code) => {
    const db = LDB(); if (!db || !db.saveMatrixConfig || !editing) return;
    stashItems();
    let by = '';
    try { by = (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) {}
    const saved = db.saveMatrixConfig({
      code, factory: curFactory(),
      months: document.getElementById('mxc-months')?.value,
      note: document.getElementById('mxc-note')?.value,
      items: (editing.cfg && editing.cfg.items) || {},
      ex: editing.ex,
      updatedBy: by,
    });
    closeConfig();
    rerender();
    try { App.toast(saved ? '저장했습니다.' : '지정값이 없어 자동 집계로 되돌렸습니다.', 'success'); } catch (_) {}
  };

  const resetConfig = (code) => {
    if (!confirm('이 원료의 지정 기준값을 모두 지우고 자동 집계로 되돌릴까요?')) return;
    const db = LDB(); if (!db || !db.deleteMatrixConfig) return;
    db.deleteMatrixConfig(code, curFactory());
    closeConfig();
    rerender();
    try { App.toast('자동 집계로 되돌렸습니다.', 'success'); } catch (_) {}
  };

  // ── 엑셀 내보내기 (원료Matrix 양식 재현) ──
  const exportXlsx = () => {
    if (typeof WSXlsx === 'undefined') { try { App.toast('엑셀 모듈을 불러올 수 없습니다.'); } catch (_) {} return; }
    const data = build();
    const cols = data.usedCols;
    const colIdx = cols.map(c => COLS.indexOf(c));
    const rows = [];
    const rangeLabel = `기준일 ${baseDate} / 기본 ${baseMonths}개월`;
    rows.push([`원료 매트릭스  (${rangeLabel})`]);
    rows.push(['코드', '원료명', '원산지', '모선/공급사', '적용기간', '구분', ...cols.map(c => c.label), '비고', '표본']);
    const KINDS = [
      ['h', (r) => `최근 ${r.win.months}개월 평균`, (c) => c.histMean],
      ['m', () => '적용 평균',   (c) => c.measured],
      ['d', () => '적용 편차',   (c) => c.sd],
      ['a', () => '적용 Matrix', (c) => c.applied],
      ['s', () => 'SPEC',        (c) => c.spec],
    ];
    data.rows.forEach(r => {
      const period = `${r.win.f}~${r.win.t} (${r.win.months}개월${r.win.custom ? ' 지정' : ''})`;
      KINDS.forEach(([kind, label, pick], ki) => {
        const arr = [r.code, r.name, r.origin, r.supplier, ki === 0 ? period : '', label(r)];
        colIdx.forEach(i => {
          const v = pick(r.cells[i]);
          arr.push(v == null ? '' : +(+v).toFixed(COLS[i].dig));
        });
        arr.push(ki === 0 ? r.note : '');
        arr.push(ki === 0 ? r.sampleN : '');
        rows.push(arr);
      });
    });
    const tag = `${baseDate}_${baseMonths}개월`;
    try { WSXlsx.download(`원료매트릭스_${tag}.xlsx`, [{ name: '원료매트릭스', rows }]); App.toast && App.toast('엑셀 파일을 내려받았습니다.'); }
    catch (e) { try { App.toast('내보내기 실패: ' + e.message); } catch (_) {} }
  };

  return {
    render, afterRender,
    setBaseDate: (v) => { baseDate = v || ymd(new Date()); rerender(); },
    setMonths: (v) => { const n = Math.round(Number(v)); baseMonths = (isFinite(n) && n > 0) ? Math.min(n, 60) : 3; rerender(); },
    setQuery: (v) => { query = v; rerender(); },
    toggleEmpty: (v) => { hideEmpty = v; rerender(); },
    quick,
    openConfig, closeConfig, saveConfig, resetConfig,
    setTab, pickRow, pickAll, pickVal, applyMonths, onApplyMode,
    exportXlsx,
  };
})();
