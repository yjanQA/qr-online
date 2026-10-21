// ============================================================
// self_check.js — 심사 점검표 (인증관리 > 심사 지적사항 > 심사 등록/수정)
//
//   심사 등록 창에 점검표를 붙여 항목별로 점수를 매기고, 점수·등급을 계산한다.
//   점검표 종류(TEMPLATES)
//     · supplier : 협력사 품질검증 평가표(supplier.js EVAL_CHECKLIST) — '자체 점검'은 자동으로 펼친다.
//                  항목·배점·등급 컷오프를 협력사 평가와 같이 쓴다(배점 설정을 바꾸면 둘 다 바뀐다).
//     · haccp    : HACCP 심사기준(audit_finding_db.js AUDIT_STANDARDS.HACCP)
//     · sqf      : SQF 심사기준(AUDIT_STANDARDS.SQF)
//     그 밖의 심사 구분은 '점검표 추가'를 누르면 구분에 맞는 점검표를 불러온다(HACCP 계열→HACCP, SQF 계열→SQF).
//
//   · 점수: 5 우수 / 4 양호 / 3 보통 / 1 미흡 / 0 부적합 / 해당없음(배점에서 뺌)
//   · 같은 양식 엑셀을 내려받아 작성한 뒤 올리면 자동으로 읽어 채운다
//   · 미흡·부적합 항목은 지적사항으로 넘겨 조치·개선 이력을 추적한다(audit_finding.js)
//
//   저장: 심사 기록의 checklist = { template, basis, results:[{key,score,memo}], summary }
// ============================================================

const SelfCheck = (() => {
  const AUTO_TYPES = ['자체 점검'];          // 등록 창을 열면 바로 점검표를 펼치는 심사 구분

  const kit = () => (typeof SupplierPage !== 'undefined' && SupplierPage.evalKit) ? SupplierPage.evalKit : null;
  const stds = () => (typeof AuditFindingDB !== 'undefined' && AuditFindingDB.AUDIT_STANDARDS) ? AuditFindingDB.AUDIT_STANDARDS : {};

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[()·,./\-]/g, '').toLowerCase();

  const MAX = 5;
  const NA = 'NA';
  const SCALE = [
    { v: 5, label: '우수' }, { v: 4, label: '양호' }, { v: 3, label: '보통' }, { v: 1, label: '미흡' }, { v: 0, label: '부적합' },
  ];
  const GRADE = {
    A: { label: '우수', note: '현 수준 유지' },
    B: { label: '양호', note: '경미 보완' },
    C: { label: '조건부', note: '개선계획 수립 필요' },
    D: { label: '부적격', note: '즉시 개선·재점검 필요' },
  };

  // 협력사 평가표 분야 → 지적 분야(HACCP 심사기준) — 지적사항 통계가 한 칸에 몰리지 않게 나눈다
  const SUPPLIER_FINDING_CAT = {
    '기본 정보': '문서·기록관리',
    '품질관리 체계': '문서·기록관리',
    '제조 환경 관리': '제조·가공시설·설비 관리',
    '원료 및 제품관리': '보관·운송 관리',
    '생산 및 검사관리': '검사 관리',
    '시험·법규 적합성': '검사 관리',
    '변경 및 고객 관리': '회수프로그램 관리',
    '안전 및 리스크 관리': '기타',
  };

  // ── 점검표 종류 ──
  //   groups: [{ cat, weight, items:[{ doc, check }] }]. 항목 키는 '분야index-항목index'.
  //   ※ 항목을 늘릴 때는 분야의 '맨 뒤'에만 붙인다 — 위치 키라 중간에 넣으면 지난 점수가 밀린다.
  const fromStandard = (std) => (std && std.groups ? std.groups : []).map(g => ({
    cat: g.title, weight: g.items.length,              // 항목 수만큼 배점 — 항목 하나의 무게가 같다
    items: g.items.map(name => ({ doc: name, check: '', findingCat: name })),   // 항목 이름 = 지적 분야
  }));
  const TEMPLATES = {
    supplier: {
      label: '협력사 품질검증 평가표',
      available: () => !!kit(),
      groups: () => kit().checklist.map(g => ({
        cat: g.cat, weight: kit().config().weights[g.cat],
        items: g.items.map(it => ({ doc: it.doc, check: it.check, findingCat: SUPPLIER_FINDING_CAT[g.cat] || '기타' })),
      })),
      cutoffs: () => kit().config().cutoffs,
    },
    haccp: {
      label: 'HACCP 심사기준',
      available: () => !!(stds().HACCP),
      groups: () => fromStandard(stds().HACCP),
      cutoffs: () => (kit() ? kit().config().cutoffs : { A: 90, B: 80, C: 70 }),
    },
    sqf: {
      label: 'SQF 심사기준',
      available: () => !!(stds().SQF),
      groups: () => fromStandard(stds().SQF),
      cutoffs: () => (kit() ? kit().config().cutoffs : { A: 90, B: 80, C: 70 }),
    },
  };
  const tpl = (id) => TEMPLATES[id] && TEMPLATES[id].available() ? TEMPLATES[id] : null;
  // 심사 구분에 맞는 기본 점검표
  const defaultTemplate = (type) => {
    if (AUTO_TYPES.includes(type)) return 'supplier';
    if (typeof AuditFindingDB !== 'undefined' && AuditFindingDB.standardOf) return AuditFindingDB.standardOf(type) === 'SQF' ? 'sqf' : 'haccp';
    return 'haccp';
  };
  const auto = (type) => AUTO_TYPES.includes(type) && !!tpl('supplier');

  // ── 작성 중인 점검표 ──
  let draft = {};              // key → { score, memo }
  let current = null;          // 펼쳐 둔 점검표 종류(null = 점검표 없음)
  let resultTouched = false;   // 결과 칸을 사람이 직접 고쳤으면 자동으로 덮지 않는다

  const load = (checklist) => {
    draft = {};
    current = checklist ? (checklist.template || 'supplier') : null;   // 템플릿 표시가 없는 예전 기록은 협력사 평가표
    resultTouched = !!checklist;
    (checklist?.results || []).forEach(r => { draft[r.key] = { score: r.score, memo: r.memo || '' }; });
  };
  const touchResult = () => { resultTouched = true; };

  const items = (id) => {
    const out = [];
    const t = tpl(id || current); if (!t) return out;
    t.groups().forEach((g, ci) => g.items.forEach((it, ii) => out.push({
      key: `${ci}-${ii}`, no: out.length + 1, cat: g.cat, doc: it.doc, check: it.check || '', findingCat: it.findingCat,
    })));
    return out;
  };

  const results = () => Object.entries(draft)
    .filter(([, v]) => (v.score !== '' && v.score != null) || v.memo)
    .map(([key, v]) => ({ key, score: (v.score === '' || v.score == null) ? null : v.score, memo: v.memo || '' }));

  // 점수 계산 — 협력사 평가표와 같은 방식(분야별 달성률 × 배점, 전부 해당없음인 분야는 빼고 100점으로 다시 나눔)
  const summarize = (id, res) => {
    const t = tpl(id || current);
    if (!t) return null;
    if ((id || current) === 'supplier') return kit().summarize(res || results());
    const map = {}; (res || results()).forEach(r => { map[r.key] = r; });
    let scored = 0, na = 0;
    const cats = t.groups().map((g, ci) => {
      let sum = 0, n = 0, catNa = 0;
      g.items.forEach((_, ii) => {
        const v = map[`${ci}-${ii}`]?.score;
        if (v === NA) { catNa += 1; na += 1; return; }
        if (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) return;
        sum += Number(v); n += 1; scored += 1;
      });
      return { cat: g.cat, weight: g.weight, n, na: catNa, sum, rate: n ? sum / (n * MAX) : null };
    });
    const wTotal = cats.filter(c => c.rate !== null).reduce((a, c) => a + c.weight, 0);
    cats.forEach(c => {
      c.points = (c.rate === null || wTotal <= 0) ? 0 : c.rate * c.weight * (100 / wTotal);
      c.fullPoints = (c.rate === null || wTotal <= 0) ? 0 : c.weight * (100 / wTotal);
    });
    const score = Math.round(cats.reduce((a, c) => a + c.points, 0) * 10) / 10;
    const cut = t.cutoffs();
    const grade = scored === 0 ? '-' : score >= cut.A ? 'A' : score >= cut.B ? 'B' : score >= cut.C ? 'C' : 'D';
    const total = t.groups().reduce((a, g) => a + g.items.length, 0);
    return { total, scored, na, score, grade, cats, cutoffs: cut };
  };
  const gradeMeta = (id, g) => ((id === 'supplier' && kit()) ? kit().grades[g] : GRADE[g]) || null;

  // 저장할 값 — 점검표를 펼치지 않았거나 하나도 채점하지 않았으면 남기지 않는다
  const value = () => {
    if (!current) return null;
    const res = results();
    if (!res.length) return null;
    return { template: current, basis: tpl(current)?.label || '', results: res, summary: summarize(current, res), savedAt: new Date().toISOString() };
  };
  const resultOf = (grade) => grade === 'A' || grade === 'B' ? '적합' : grade === 'C' ? '조건부 적합' : grade === 'D' ? '부적합' : '';

  // ── 화면 ──
  const scoreOptions = (cur) => {
    const c = (cur === undefined || cur === null) ? '' : String(cur);
    return `<option value="" ${c === '' ? 'selected' : ''}>미채점</option>`
      + SCALE.map(s => `<option value="${s.v}" ${c === String(s.v) ? 'selected' : ''}>${s.v} ${esc(s.label)}</option>`).join('')
      + `<option value="${NA}" ${c === NA ? 'selected' : ''}>해당없음</option>`;
  };

  const sectionHtml = (type) => {
    const t = tpl(current);
    if (!t) return '<div class="info-box info-warning">점검표를 불러오지 못했습니다.</div>';
    let html = '';
    t.groups().forEach((g, ci) => {
      html += `<div class="sc-cat"><span>${esc(g.cat)}</span><span class="text-xs text-muted" id="sc-cat-${ci}"></span></div>`;
      g.items.forEach((it, ii) => {
        const k = `${ci}-${ii}`, d = draft[k] || {};
        const low = d.score !== undefined && d.score !== null && d.score !== '' && d.score !== NA && Number(d.score) <= 1;
        html += `
          <div class="sc-row ${low ? 'low' : ''}" id="sc-row-${k}">
            <div class="sc-item">
              <div class="sc-doc">${esc(it.doc)}</div>
              ${it.check ? `<div class="text-xs text-muted">${esc(it.check)}</div>` : ''}
            </div>
            <select class="form-input form-input-sm sc-score" onchange="SelfCheck.setScore('${k}', this.value)">${scoreOptions(d.score)}</select>
            <input type="text" class="form-input form-input-sm sc-memo" placeholder="확인 내용·근거" value="${esc(d.memo || '')}"
                   oninput="SelfCheck.setMemo('${k}', this.value)">
          </div>`;
      });
    });
    const total = items().length;
    // 자체 점검은 점검표가 기본이라 뺄 수 없다. 다른 구분은 바꾸거나 뺄 수 있다.
    const pick = auto(type) ? '' : `
      <select class="form-input form-input-sm" style="width:auto" onchange="SelfCheck.switchTemplate(this.value)" title="점검표 종류">
        ${Object.keys(TEMPLATES).filter(id => tpl(id)).map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>${esc(TEMPLATES[id].label)}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-ghost btn-sm" onclick="SelfCheck.removeChecklist()">점검표 빼기</button>`;
    return `
      <div class="sc-box" id="sc-box">
        <div class="sc-head">
          <div>
            <div class="sc-title">${auto(type) ? '자체 점검표' : '심사 점검표'} · ${esc(t.label)}</div>
            <div class="text-xs text-muted">${total}개 항목 · 5 우수 · 4 양호 · 3 보통 · 1 미흡 · 0 부적합 · 해당없음은 배점에서 뺌</div>
          </div>
          <div class="sc-actions">
            ${pick}
            <button type="button" class="btn btn-ghost btn-sm" onclick="SelfCheck.downloadTemplate()">엑셀 양식 받기</button>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer">엑셀 불러오기
              <input type="file" accept=".xlsx" style="display:none" onchange="SelfCheck.importFile(this)">
            </label>
          </div>
        </div>
        <div id="sc-summary"></div>
        <div class="sc-list">${html}</div>
      </div>`;
  };

  // 점검표가 없는 심사 구분 — '점검표 추가' 한 줄
  const addBarHtml = (type) => {
    const def = defaultTemplate(type);
    const opts = Object.keys(TEMPLATES).filter(id => tpl(id));
    if (!opts.length) return '';
    return `
      <div class="sc-add">
        <div>
          <div class="sc-title">점검표</div>
          <div class="text-xs text-muted">항목별로 점수를 매기고 미흡 항목을 지적사항으로 넘길 수 있습니다. 엑셀로 작성해 올려도 됩니다.</div>
        </div>
        <div class="sc-actions">
          <select class="form-input form-input-sm" style="width:auto" id="sc-add-tpl">
            ${opts.map(id => `<option value="${id}" ${id === def ? 'selected' : ''}>${esc(TEMPLATES[id].label)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-outline-primary btn-sm" onclick="SelfCheck.addChecklist()">점검표 추가</button>
        </div>
      </div>`;
  };

  // 요약 + 분야별 득점 — 점수·결과 칸도 함께 맞춘다
  const paintSummary = () => {
    const sm = summarize(current);
    if (!sm) return;
    const el = document.getElementById('sc-summary');
    const low = results().filter(r => r.score !== NA && r.score !== null && Number(r.score) <= 1).length;
    if (el) {
      const g = gradeMeta(current, sm.grade);
      el.innerHTML = sm.scored
        ? `<div class="sc-sum">
             <div class="sc-sum-main"><b>${sm.score}</b><span>/ 100</span></div>
             <div class="sc-grade g-${esc(sm.grade)}">${esc(sm.grade)} <em>${esc(g?.label || '')}</em></div>
             <div class="text-xs text-muted">채점 ${sm.scored} / ${sm.total} · 해당없음 ${sm.na}${low ? ` · <b style="color:var(--danger)">미흡·부적합 ${low}건</b>` : ''}<br>
               ${esc(g?.note || '')} · 등급 기준 A ${sm.cutoffs.A}↑ B ${sm.cutoffs.B}↑ C ${sm.cutoffs.C}↑</div>
           </div>`
        : '<div class="text-xs text-muted" style="padding:6px 0">항목별 점수를 고르거나 작성한 엑셀을 불러오세요.</div>';
    }
    sm.cats.forEach((c, ci) => {
      const t = document.getElementById('sc-cat-' + ci);
      if (t) t.textContent = c.rate === null ? `배점 ${Math.round(c.weight * 10) / 10} · 미채점` : `${c.points.toFixed(1)} / ${c.fullPoints.toFixed(1)}점`;
    });
    // 점수 칸은 점검표가 채운다. 결과 칸은 사람이 고치지 않았을 때만 등급에 맞춘다.
    const sc = document.getElementById('af-score');
    if (sc && sm.scored) { sc.value = sm.score; sc.readOnly = true; }
    else if (sc) sc.readOnly = false;
    const rs = document.getElementById('af-result');
    if (rs && sm.scored && !resultTouched && resultOf(sm.grade)) rs.value = resultOf(sm.grade);
  };

  const setScore = (k, v) => {
    draft[k] = { ...(draft[k] || {}), score: v === '' ? '' : (v === NA ? NA : Number(v)) };
    const row = document.getElementById('sc-row-' + k);
    if (row) row.classList.toggle('low', v !== '' && v !== NA && Number(v) <= 1);
    paintSummary();
  };
  const setMemo = (k, v) => { draft[k] = { ...(draft[k] || {}), memo: v }; };

  const typeNow = () => document.getElementById('af-type')?.value || '';

  // 심사 등록 창에 점검표를 붙이거나 '점검표 추가' 줄을 둔다(심사 구분이 바뀔 때마다)
  const mount = (type) => {
    const host = document.getElementById('af-checklist');
    const modal = document.querySelector('#af-audit-modal .modal');
    if (!host) return;
    // 자체 점검은 자동으로 협력사 평가표를 펼친다. 다른 구분은 이미 펼쳐 둔 점검표가 있으면 그대로 둔다.
    if (auto(type) && current !== 'supplier' && !results().length) current = 'supplier';
    if (auto(type) && !current) current = 'supplier';
    if (current && tpl(current)) {
      host.innerHTML = sectionHtml(type);
      if (modal) modal.classList.add('modal-xl');
      paintSummary();
    } else {
      host.innerHTML = addBarHtml(type);
      if (modal) modal.classList.remove('modal-xl');
      const sc = document.getElementById('af-score'); if (sc) sc.readOnly = false;
    }
  };

  const addChecklist = () => {
    const id = document.getElementById('sc-add-tpl')?.value || defaultTemplate(typeNow());
    if (!tpl(id)) return;
    draft = {}; current = id;
    mount(typeNow());
  };
  const switchTemplate = (id) => {
    if (!tpl(id) || id === current) return;
    if (results().length && !confirm('점검표 종류를 바꾸면 지금까지 매긴 점수가 지워집니다. 바꿀까요?')) { mount(typeNow()); return; }
    draft = {}; current = id;
    mount(typeNow());
  };
  const removeChecklist = () => {
    if (results().length && !confirm('점검표를 빼면 매긴 점수가 저장되지 않습니다. 뺄까요?')) return;
    draft = {}; current = null;
    mount(typeNow());
  };

  // ── 엑셀 양식 ──
  const field = (id) => document.getElementById(id)?.value || '';
  const downloadTemplate = () => {
    const t = tpl(current);
    if (typeof WSXlsx === 'undefined' || !t) { App.toast('엑셀 기능을 불러오지 못했습니다', 'error'); return; }
    const fac = (typeof AuditFindingDB !== 'undefined') ? AuditFindingDB.factoryName(field('af-factory')) : field('af-factory');
    const rows = [
      [`${field('af-type') || '심사'} 점검표 — ${t.label}`],
      ['점수 기준', '5 우수 / 4 양호 / 3 보통 / 1 미흡 / 0 부적합 / NA 해당없음 (빈칸 = 미채점)'],
      ['심사일', field('af-date')],
      ['대상 공장', fac],
      ['심사자', field('af-auditor')],
      [],
      ['No', '분야', '항목', '확인사항', '점수', '메모'],
    ];
    items().forEach(it => {
      const d = draft[it.key] || {};
      rows.push([it.no, it.cat, it.doc, it.check, d.score === undefined || d.score === null ? '' : d.score, d.memo || '']);
    });
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]/g, '');
    WSXlsx.download(`점검표_${safe(field('af-type'))}_${safe(field('af-date'))}_${safe(fac)}.xlsx`, [{ name: '점검표', rows }]);
  };

  // 엑셀 일련번호·문자열 날짜 → YYYY-MM-DD
  const excelDay = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(v);
    if (Number.isFinite(n) && n > 20000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    const m = /(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/.exec(String(v));
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
  };

  // 점수 글자 → 값. 숫자·등급말·해당없음 모두 받는다. 못 읽으면 undefined.
  const parseScore = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    if (/^(na|n\/a|해당없음|해당 없음|-)$/i.test(s)) return NA;
    const lab = SCALE.find(x => x.label === s);
    if (lab) return lab.v;
    const n = Number(s.replace(/점$/, ''));
    if (Number.isFinite(n) && SCALE.some(x => x.v === n)) return n;
    return undefined;
  };

  const importFile = async (input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !current) return;
    if (typeof LabImport === 'undefined' || !LabImport._parseXlsx) { App.toast('엑셀 읽기 기능을 불러오지 못했습니다', 'error'); return; }
    let grid;
    try { grid = await LabImport._parseXlsx(await file.arrayBuffer()); }
    catch (e) { App.toast('엑셀을 읽지 못했습니다 — ' + (e.message || e), 'error'); return; }

    // 머리글 행(항목·점수)을 찾는다 — 위쪽 안내 줄 수가 달라도 된다
    const hr = grid.findIndex(r => (r || []).some(c => norm(c) === '항목') && (r || []).some(c => norm(c) === '점수'));
    if (hr < 0) { App.toast('"항목"·"점수" 머리글을 찾지 못했습니다. 이 화면에서 받은 엑셀 양식을 쓰세요.', 'error'); return; }
    const head = grid[hr].map(norm);
    const col = (name) => head.indexOf(norm(name));
    const cCat = col('분야'), cDoc = col('항목'), cScore = col('점수'), cMemo = col('메모');

    // 위쪽 정보 줄 — 심사일·심사자가 적혀 있으면 등록 창에 옮긴다
    grid.slice(0, hr).forEach(r => {
      const k = norm(r && r[0]), v = r && r[1];
      if (k === '심사일' && excelDay(v)) { const el = document.getElementById('af-date'); if (el) el.value = excelDay(v); }
      if (k === '심사자' && v) { const el = document.getElementById('af-auditor'); if (el) el.value = String(v); }
    });

    // 분야+항목 이름으로 맞춘다(행 순서가 바뀌어도 된다). 이름이 겹치지 않으면 항목 이름만으로도 맞춘다.
    const list = items();
    const byPair = {}, byDoc = {};
    list.forEach(it => { byPair[norm(it.cat) + '|' + norm(it.doc)] = it.key; (byDoc[norm(it.doc)] = byDoc[norm(it.doc)] || []).push(it.key); });
    let applied = 0, unknown = 0;
    const bad = [];
    grid.slice(hr + 1).forEach((r, i) => {
      if (!r) return;
      const doc = r[cDoc];
      if (!doc) return;
      const key = byPair[norm(cCat >= 0 ? r[cCat] : '') + '|' + norm(doc)]
        || ((byDoc[norm(doc)] || []).length === 1 ? byDoc[norm(doc)][0] : null);
      if (!key) { unknown += 1; return; }
      const sc = parseScore(r[cScore]);
      if (sc === undefined) { bad.push(`${hr + i + 2}행 "${r[cScore]}"`); return; }
      draft[key] = { score: sc, memo: cMemo >= 0 ? String(r[cMemo] ?? '').trim() : (draft[key]?.memo || '') };
      if (sc !== '' || draft[key].memo) applied += 1;
    });

    mount(typeNow());
    App.toast(`엑셀에서 ${applied}개 항목을 채웠습니다`
      + (unknown ? ` · 이 점검표에 없는 항목 ${unknown}행은 건너뜀` : '')
      + (bad.length ? ` · 점수를 못 읽은 행: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' 외' : ''}` : ''),
      bad.length ? 'warning' : 'success');
  };

  // ── 저장된 점검 결과 ──
  // 미흡(1)·부적합(0) 항목 — 지적사항 후보
  const lowItems = (checklist) => {
    if (!checklist) return [];
    const id = checklist.template || 'supplier';
    if (!tpl(id)) return [];
    const map = {}; (checklist.results || []).forEach(r => { map[r.key] = r; });
    return items(id).filter(it => {
      const r = map[it.key];
      return r && r.score !== null && r.score !== NA && r.score !== '' && Number(r.score) <= 1;
    }).map(it => ({ ...it, score: Number(map[it.key].score), memo: map[it.key].memo || '', category: it.findingCat || '기타' }));
  };

  // 심사 상세 화면 요약 카드
  const detailHtml = (a, pendingFindings) => {
    if (!a.checklist) return '';
    const id = a.checklist.template || 'supplier';
    const sm = (a.checklist.summary && a.checklist.summary.score !== undefined) ? a.checklist.summary : summarize(id, a.checklist.results);
    if (!sm) return '';
    const g = gradeMeta(id, sm.grade);
    return `
      <div class="sc-detail">
        <div class="sc-sum">
          <div class="sc-sum-main"><b>${sm.score}</b><span>/ 100</span></div>
          <div class="sc-grade g-${esc(sm.grade)}">${esc(sm.grade)} <em>${esc(g?.label || '')}</em></div>
          <div class="text-xs text-muted">점검표(${esc(a.checklist.basis || TEMPLATES[id]?.label || '')}) · 채점 ${sm.scored}/${sm.total} · 해당없음 ${sm.na}</div>
          <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
            ${pendingFindings ? `<button class="btn btn-primary btn-sm" onclick="AuditFindingPage.findingsFromChecklist('${esc(a.id)}')">미흡·부적합 ${pendingFindings}건 → 지적사항 등록</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="AuditFindingPage.openAuditModal('${esc(a.id)}')">점검표 보기·수정</button>
          </div>
        </div>
        <div class="sc-bars">
          ${sm.cats.map(c => `<div class="sc-bar">
            <span title="${esc(c.cat)}">${esc(c.cat)}</span>
            <div class="sc-bar-track"><i style="width:${c.rate === null ? 0 : Math.round(c.rate * 100)}%"
              class="${c.rate !== null && c.rate < 0.6 ? 'bad' : ''}"></i></div>
            <em>${c.rate === null ? '해당없음' : c.points.toFixed(1) + ' / ' + c.fullPoints.toFixed(1)}</em>
          </div>`).join('')}
        </div>
      </div>`;
  };

  // 점검표를 펼쳐 둔 상태인가(저장 시 판단)
  const active = () => !!current;

  return { load, value, active, mount, addChecklist, switchTemplate, removeChecklist, setScore, setMemo, touchResult,
           downloadTemplate, importFile, lowItems, detailHtml, resultOf, defaultTemplate };
})();
