// ============================================================
// lab_formula_trend.js — 배합비(원시배합비) 추이분석
//   ERP '원시배합비 추이분석' 형식:
//     좌측 = 배합비 목록(배합비번호·품명)
//     우측 = 원료 × 날짜(개정일) 배합비율 매트릭스 + 합계
//   + 그 배합비로 생산된 제품의 물리·화학 분석 데이터 연동
//
//   ※ 구성비 데이터: 실데이터(window.FORMULA_COMPOSITION / localStorage)가 있으면 사용,
//      없으면 데모 샘플 비율을 생성(추후 ERP 엑셀 임포트로 교체).
// ============================================================

const FormulaTrendPage = (() => {
  let sel = '';
  let query = '';
  let itemKey = 'moist';
  let chart = null;
  // 매트릭스 필터 상태(null = 전체)
  let selDates = null;   // Set<날짜>
  let selRows = null;    // Set<원료코드>
  let transpose = false; // 행/열 전환
  let panelOpen = false; // 원료 선택 패널 열림 상태(연속 클릭 유지)
  let selRev = null;     // 선택한 배합비 적용일(그 버전 제품 품질 보기)
  let selProd = null;    // 선택한 제품 코드(칩 클릭 → 그 제품 분석결과만 하단 표시)
  let selRawHighlight = null;

  const MAP = () => (typeof window !== 'undefined' && Array.isArray(window.FORMULA_MAP)) ? window.FORMULA_MAP : [];
  const productsOf = (f) => MAP().filter(m => m.formula === String(f));
  const formulaList = () => {
    const seen = new Map();
    MAP().forEach(m => { if (!seen.has(m.formula)) seen.set(m.formula, m); });
    return [...seen.values()];
  };

  // ── 원료 구성 데모 데이터 없음 (2026-09-07 보안 정리) ──
  //   예전에는 ERP 화면의 실제 원료 구성 24종을 데모로 박아두고 배합비 번호로 흔들어 보여줬다.
  //   구성비는 회사 핵심 자산이라 코드에 두지 않는다. 실데이터가 없으면 빈 상태로 안내한다.
  //   실데이터 경로: window.FORMULA_COMPOSITION 또는 localStorage 의 lab_formula_composition.
  const DEMO_DATES = [];
  const DEMO_RAWS = [];
  const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0); };
  const jit = (seed) => ((hash(seed) % 1000) / 1000 - 0.5); // -0.5 ~ 0.5

  // 구성 데이터 조회: 실데이터 우선, 없으면 데모 생성 → {dates:[], rows:[{code,name,byDate:{}}], totals:{}}
  const getComposition = (formula) => {
    const real = (typeof window !== 'undefined' && window.FORMULA_COMPOSITION && window.FORMULA_COMPOSITION[formula])
      || (() => { try { const s = JSON.parse(localStorage.getItem('lab_formula_composition') || 'null'); return s && s[formula]; } catch (_) { return null; } })();
    if (real && Array.isArray(real.rows)) return { ...real, demo: false };

    // ── 데모 생성 (배합비 번호 시드로 결정적) ──
    const dates = DEMO_DATES;
    const rows = DEMO_RAWS.map(([code, name, base]) => {
      const byDate = {};
      dates.forEach(d => {
        // 일부 미량 원료는 특정 날짜에 미사용(빈칸)으로 연출
        const skip = base < 0.05 && (hash(formula + code + d) % 5 === 0);
        if (skip) { byDate[d] = null; return; }
        const v = base * (1 + 0.14 * jit(formula + code + d));
        byDate[d] = Math.max(0, v);
      });
      return { code, name, byDate };
    });
    // 각 날짜 컬럼 합계 100%로 정규화
    const totals = {};
    dates.forEach(d => {
      const sum = rows.reduce((a, r) => a + (r.byDate[d] || 0), 0) || 1;
      const f = 100 / sum;
      rows.forEach(r => { if (r.byDate[d] != null) r.byDate[d] = Math.round(r.byDate[d] * f * 1000) / 1000; });
      totals[d] = Math.round(rows.reduce((a, r) => a + (r.byDate[d] || 0), 0) * 1000) / 1000;
    });
    return { dates, rows, totals, demo: true };
  };

  // ── 제품 분석 레코드(물리·화학) ──
  //   배합비 목록표의 코드(배합코드)와 분석대장의 코드(완제품 코드)가 다르므로
  //   코드 일치 + "정규화된 제품명" 일치 둘 다로 매칭한다.
  //   예: '파트너 메가특수견15(배합)' ↔ 레코드 '파트너 메가특수견15-PO'
  const normName = (s) => String(s || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/\((배합|가공|포장|EA)\)/g, '')
    .replace(/#/g, '')
    .replace(/(-PO|-KG|-EA|-EP|-M|-C)+$/i, '')
    .replace(/\d+KG$/i, '')
    .replace(/(-PO|-KG|-EA|-EP|-M|-C)+$/i, '')
    .toLowerCase();

  let _pidxFormula = null, _pidx = null;   // prodIndex 캐시(같은 배합비 재조회 방지)
  const prodIndex = (formula) => {
    if (_pidxFormula === String(formula) && _pidx) return _pidx;
    const out = productsOf(formula).map(p => ({ code: String(p.code), name: p.name || '', recs: [] }));
    const byCode = new Map(out.map(o => [o.code, o]));
    const byNorm = new Map();
    out.forEach(o => { const k = normName(o.name); if (k && !byNorm.has(k)) byNorm.set(k, o); });
    LabDB.getRecords('prod').forEach(r => {
      const target = byCode.get(String(r.code || '')) || byNorm.get(normName(r.name));
      if (target) target.recs.push(r);
    });
    out.forEach(o => o.recs.sort((a, b) => String(b.date).localeCompare(String(a.date))));
    _pidxFormula = String(formula); _pidx = out;
    return out;
  };

  const recordsOf = (formula) => {
    const idx = prodIndex(formula);
    const use = selProd ? idx.filter(o => o.code === selProd) : idx;
    const seen = new Set();
    const recs = [];
    use.forEach(o => o.recs.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); recs.push(r); } }));
    return recs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  };
  const valOf = (rec, key) => {
    if (rec.vals && typeof rec.vals[key] === 'number') return rec.vals[key];
    if (rec.nirVals && typeof rec.nirVals[key] === 'number') return rec.nirVals[key];
    return null;
  };

  const search = (q) => {
    query = q;
    const box = document.getElementById('ft-list-body');
    if (box) box.innerHTML = listRows();
  };
  const pick = (f) => { sel = String(f); selDates = null; selRows = null; transpose = false; selRev = null; selProd = null; _pidxFormula = null; _pidx = null; App.refreshPage(); };
  // 제품 칩 클릭: 그 제품의 분석결과만 하단(버전 품질·추이)에 표시. 재클릭 시 전체로.
  const setProd = (code) => { selProd = (selProd === String(code)) ? null : String(code); App.refreshPage(); };
  const setItem = (k) => { itemKey = k; drawChart(); document.querySelectorAll('.ft-item-btns button').forEach(b => b.classList.toggle('btn-primary', b.dataset.k === k)); document.querySelectorAll('.ft-item-btns button').forEach(b => b.classList.toggle('btn-ghost', b.dataset.k !== k)); };

  const num = (v) => v == null ? '' : v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const listRows = () => {
    const lq = query.trim().toLowerCase();
    let list = formulaList();
    if (lq) list = list.filter(m => m.formula.includes(lq) || (m.name || '').toLowerCase().includes(lq));
    return list.map(m => `
      <div class="ft-row ${m.formula === sel ? 'sel' : ''}" onclick="FormulaTrendPage.pick('${esc(m.formula)}')">
        <span class="ft-row-code mono">${esc(m.formula)}</span>
        <span class="ft-row-name">${esc(m.name)}</span>
      </div>`).join('');
  };

  // ── 매트릭스 필터 헬퍼 ──
  // 배합비 적용일(개정일) 내림차순
  const revDates = (formula) => getComposition(formula).dates.slice().sort((a, b) => b.localeCompare(a));
  // 생산일에 적용된 배합비 버전(그 이전 최신 개정일)
  const activeRev = (dateStr, revs) => revs.find(r => r <= dateStr) || revs[revs.length - 1];
  // 배합비 버전 적용 기간 [rev, 다음개정 전)
  const versionWindow = (rev, revs) => {
    const i = revs.indexOf(rev);
    const nextLater = i > 0 ? revs[i - 1] : null; // 더 최신 개정일
    return { from: rev, to: nextLater }; // to=null → 이후 전부
  };
  const productsInVersion = (formula, rev) => {
    const revs = revDates(formula);
    const w = versionWindow(rev, revs);
    return recordsOf(formula).filter(r => {
      const d = fmtDate(r.date);
      return d >= w.from && (w.to == null || d < w.to);
    });
  };

  // 제품 분석값 집계: 배합비 버전(개정일) → itemKey → {sum,n,code}
  const analysisAgg = (formula) => {
    const revs = revDates(formula);
    const agg = {};
    recordsOf(formula).forEach(r => {
      const rev = activeRev(fmtDate(r.date), revs);
      agg[rev] = agg[rev] || {};
      LabDB.getItems('prod').forEach(it => {
        const v = valOf(r, it.key); if (v == null) return;
        const c = agg[rev][it.key] = agg[rev][it.key] || { sum: 0, n: 0, code: r.code };
        c.sum += v; c.n += 1;
      });
    });
    return agg;
  };
  const analysisItems = (formula) => {
    const agg = analysisAgg(formula);
    const keys = new Set();
    Object.values(agg).forEach(m => Object.keys(m).forEach(k => keys.add(k)));
    return LabDB.getItems('prod').filter(it => keys.has(it.key));
  };
  const physSet = () => new Set(LabDB.getItems('prod').filter(it => it.group === '물리분석').map(it => it.key));
  // 날짜축 = 원료 개정일 ∪ 제품 분석일 (내림차순)
  const colDates = (comp, formula) => {
    const set = new Set(comp.dates);
    Object.keys(analysisAgg(formula)).forEach(d => set.add(d));
    return [...set].sort((a, b) => b.localeCompare(a));
  };
  const rowKeysOf = (comp, formula) => comp.rows.map(r => r.code);

  const activeDates = (comp) => colDates(comp, sel).filter(d => !selDates || selDates.has(d));

  const refreshMatrix = () => {
    if (!sel) return;
    const el = document.getElementById('ft-matrix');
    if (el) el.innerHTML = renderMatrixInner(getComposition(sel));
  };

  const toggleDate = (d) => {
    const comp = getComposition(sel); const all = colDates(comp, sel);
    if (!selDates) selDates = new Set(all);
    selDates.has(d) ? selDates.delete(d) : selDates.add(d);
    if (selDates.size === all.length) selDates = null;
    refreshMatrix();
  };
  const allDates = (on) => { selDates = on ? null : new Set(); refreshMatrix(); };
  const toggleRow = (key) => {
    const comp = getComposition(sel); const all = rowKeysOf(comp, sel);
    if (!selRows) selRows = new Set(all);
    selRows.has(key) ? selRows.delete(key) : selRows.add(key);
    if (selRows.size === all.length) selRows = null;
    refreshTableOnly();   // 선택 패널은 유지 → 연속 체크 가능
  };
  const allRows = (on) => { selRows = on ? null : new Set(); refreshMatrix(); };
  const onlyUsedRows = () => {
    const comp = getComposition(sel);
    const dates = activeDates(comp);
    const raws = comp.rows.filter(r => dates.some(d => (r.byDate[d] || 0) > 0)).map(r => r.code);
    const items = analysisItems(sel).map(it => 'i:' + it.key); // 분석항목은 값 있는 것만 이미 추림
    selRows = new Set(raws.concat(items));
    refreshMatrix();
  };
  const toggleTranspose = () => { transpose = !transpose; refreshMatrix(); };
  const toggleRowPanel = () => {
    panelOpen = !panelOpen;
    const p = document.getElementById('ft-rowpanel');
    if (p) { p.dataset.open = panelOpen ? '1' : '0'; p.style.display = panelOpen ? 'grid' : 'none'; }
    const b = document.getElementById('ft-panelbtn');
    if (b) b.textContent = `원료·분석항목 선택 ${panelOpen ? '▲' : '▾'}`;
  };

  // 제품 분석 셀(평균값 + 규격 판정색)
  const itemCell = (agg, d, it) => {
    const c = agg[d] && agg[d][it.key];
    if (!c) return { txt: '', cls: '' };
    const v = c.sum / c.n;
    const sp = LabDB.resolveSpec('prod', c.code, it.key);
    const verdict = (sp && (sp.min != null || sp.max != null)) ? LabDB.judge(v, sp) : 'NA';
    const m = VERDICT_META[verdict] || VERDICT_META.NA;
    return { txt: fmtNum(v), cls: 'v-' + m.cls };
  };

  // 표 본문만 생성(원료 구성비 · 배합비 적용일별) — 체크 시 표만 갱신
  const buildTable = (comp) => {
    const dates = activeDates(comp);
    const raws = comp.rows.filter(r => !selRows || selRows.has(r.code));
    if (dates.length === 0) return `<div class="empty-lab">표시할 날짜를 선택하세요</div>`;

    let table;
    if (!transpose) {
      const rawTbody = raws.map(r => `<tr class="${r.code === selRawHighlight ? 'ft-row-hl' : ''}">
        <td class="ft-mtx-fix mono text-muted">${esc(r.code)}</td><td class="ft-mtx-fix2">${esc(r.name)}</td>
        ${dates.map(d => `<td class="mono">${num(r.byDate[d])}</td>`).join('')}</tr>`).join('');
      table = `<table class="ft-mtx">
        <thead><tr><th class="ft-mtx-fix">코드</th><th class="ft-mtx-fix2">원재료명</th>
          ${dates.map(d => `<th class="${d === selRev ? 'ft-col-selrev' : ''}"><button class="ft-th-rev" onclick="FormulaTrendPage.setRev('${d}')" title="이 적용일 제품 보기">${esc(d)}</button></th>`).join('')}</tr></thead>
        <tbody>
          ${rawTbody}
          <tr class="ft-mtx-total"><td class="ft-mtx-fix"></td><td class="ft-mtx-fix2">《구성 합계》</td>${dates.map(d => `<td class="mono">${num(comp.totals[d])}</td>`).join('')}</tr>
        </tbody></table>`;
    } else {
      table = `<table class="ft-mtx">
        <thead><tr><th class="ft-mtx-fix2">개정일</th>
          ${raws.map(r => `<th title="${esc(r.code)}">${esc(r.name)}</th>`).join('')}<th class="ft-col-sum">합계</th></tr></thead>
        <tbody>
          ${dates.map(d => `<tr>
            <td class="ft-mtx-fix2 mono"><button class="ft-th-rev" onclick="FormulaTrendPage.setRev('${d}')">${esc(d)}</button></td>
            ${raws.map(r => `<td class="mono">${num(r.byDate[d])}</td>`).join('')}
            <td class="mono ft-col-sum" style="font-weight:700;color:var(--accent)">${num(comp.totals[d])}</td>
          </tr>`).join('')}
        </tbody></table>`;
    }
    return `<div class="ft-mtx-wrap">${table}</div>`;
  };

  const renderMatrixInner = (comp) => {
    const allDatesArr = colDates(comp, sel);
    const phys = physSet();
    const allRowKeys = rowKeysOf(comp, sel);
    const dSel = (d) => !selDates || selDates.has(d);
    const rSel = (k) => !selRows || selRows.has(k);
    const selDateCnt = selDates ? selDates.size : allDatesArr.length;
    const selRowCnt = selRows ? selRows.size : allRowKeys.length;

    const controls = `
      <div class="ft-controls">
        <div class="ft-ctrl-line">
          <span class="ft-ctrl-label">날짜 <span class="text-muted" id="ft-datecount">(${selDateCnt}/${allDatesArr.length})</span></span>
          <div class="ft-chips">
            ${allDatesArr.map(d => `<button class="ft-chip ${dSel(d) ? 'on' : ''}" onclick="FormulaTrendPage.toggleDate('${d}')">${esc(d.slice(5))}</button>`).join('')}
          </div>
          <button class="btn btn-ghost btn-xs" onclick="FormulaTrendPage.allDates(true)">전체</button>
          <button class="btn btn-ghost btn-xs" onclick="FormulaTrendPage.allDates(false)">해제</button>
        </div>
        <div class="ft-ctrl-line">
          <span class="ft-ctrl-label">원료 <span class="text-muted" id="ft-rowcount">(${selRowCnt}/${allRowKeys.length})</span></span>
          <button class="btn btn-ghost btn-xs" id="ft-panelbtn" onclick="FormulaTrendPage.toggleRowPanel()">원료 선택 ${panelOpen ? '▲' : '▾'}</button>
          <button class="btn btn-ghost btn-xs" onclick="FormulaTrendPage.onlyUsedRows()">값있는 것만</button>
          <button class="btn btn-ghost btn-xs" onclick="FormulaTrendPage.allRows(true)">전체</button>
          <span style="flex:1"></span>
          <button class="btn ${transpose ? 'btn-primary' : 'btn-ghost'} btn-xs" onclick="FormulaTrendPage.toggleTranspose()">⇄ 행/열 전환</button>
        </div>
        <div class="ft-rowpanel" id="ft-rowpanel" data-open="${panelOpen ? '1' : '0'}" style="display:${panelOpen ? 'grid' : 'none'}">
          <div class="ft-rowpanel-head">
            <span>체크한 원료만 표에 표시됩니다</span>
            <button type="button" class="btn btn-ghost btn-xs" onclick="FormulaTrendPage.toggleRowPanel()">✕ 닫기</button>
          </div>
          ${comp.rows.map(r => `<label class="ft-rowpanel-item">
            <input type="checkbox" ${rSel(r.code) ? 'checked' : ''} onchange="FormulaTrendPage.toggleRow('${r.code}')">
            <span class="mono text-muted" style="font-size:10px">${esc(r.code)}</span> ${esc(r.name)}</label>`).join('')}
        </div>
      </div>
      <div class="ft-hint text-muted" style="font-size:11px;margin-bottom:6px">날짜(적용일) 머리글을 클릭하면 그 배합비 버전으로 생산된 제품 품질을 아래에서 확인합니다</div>
      <div id="ft-table">${buildTable(comp)}</div>`;
    return controls;
  };

  // 카운트 라벨만 갱신
  const updateCounts = (comp) => {
    const allDatesArr = colDates(comp, sel);
    const allRowKeys = rowKeysOf(comp, sel);
    const dc = document.getElementById('ft-datecount');
    if (dc) dc.textContent = `(${selDates ? selDates.size : allDatesArr.length}/${allDatesArr.length})`;
    const rc = document.getElementById('ft-rowcount');
    if (rc) rc.textContent = `(${selRows ? selRows.size : allRowKeys.length}/${allRowKeys.length})`;
  };
  // 표 본문만 갱신(선택 패널은 그대로 유지 → 연속 체크 가능)
  const refreshTableOnly = () => {
    if (!sel) return;
    const comp = getComposition(sel);
    const el = document.getElementById('ft-table');
    if (el) el.innerHTML = buildTable(comp);
    updateCounts(comp);
  };

  // ── 배합비 버전(적용일)별 제품 품질 ──
  const stdev = (arr) => { if (arr.length < 2) return 0; const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length); };

  const setRev = (rev) => {
    selRev = rev;
    refreshTableOnly();  // 매트릭스 머리글 하이라이트 갱신
    const v = document.getElementById('ft-version');
    if (v) v.innerHTML = renderVersionProducts(sel);
    const el = document.getElementById('ft-version'); if (el) el.scrollIntoView({ block: 'nearest' });
  };

  const renderVersionProducts = (formula) => {
    const revs = revDates(formula);
    if (!revs.length) return '';
    const rev = (selRev && revs.includes(selRev)) ? selRev : revs[0];
    const w = versionWindow(rev, revs);
    const prods = productsInVersion(formula, rev).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const phys = physSet();
    const prodItems = LabDB.getItems('prod');
    const usedKeys = new Set();
    prods.forEach(r => prodItems.forEach(it => { if (valOf(r, it.key) != null) usedKeys.add(it.key); }));
    const cols = prodItems.filter(it => usedKeys.has(it.key));
    const periodLabel = w.to ? `${rev} ~ ${w.to} 직전` : `${rev} ~ 현재`;

    const revBtns = revs.map(rv => {
      const cnt = productsInVersion(formula, rv).length;
      return `<button class="btn btn-sm ${rv === rev ? 'btn-primary' : 'btn-ghost'}" onclick="FormulaTrendPage.setRev('${rv}')">${rv} <span style="font-size:9px;opacity:.8">(${cnt})</span></button>`;
    }).join('');

    const selProdName = selProd ? ((prodIndex(formula).find(o => o.code === selProd) || {}).name || selProd) : null;
    const head = `<div class="ft-ver-head">배합비 <b>${esc(rev)}</b> 적용 제품 품질${selProdName ? ` · <span style="color:var(--accent)">${esc(selProdName)}</span>` : ''}
      <span class="text-muted" style="font-weight:400">· 적용기간 ${esc(periodLabel)} · ${prods.length}건 생산·분석</span></div>
      <div class="ft-ver-revs">${revBtns}</div>`;

    if (prods.length === 0) {
      return head + `<div class="empty-lab">이 적용기간에 생산·분석된 제품이 없습니다.<br>
        <span class="text-muted" style="font-size:12px">해당 제품코드로 분석을 등록하면 이 버전 품질로 집계됩니다.</span></div>`;
    }

    // 일관성 통계 카드
    const stats = cols.map(it => {
      const vals = prods.map(r => valOf(r, it.key)).filter(v => v != null);
      if (vals.length < 1) return '';
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const mn = Math.min(...vals), mx = Math.max(...vals), sd = stdev(vals);
      const cv = avg ? sd / Math.abs(avg) * 100 : 0;
      const sp = LabDB.resolveSpec('prod', prods[0].code, it.key);
      let fail = 0; if (sp && (sp.min != null || sp.max != null)) fail = vals.filter(v => LabDB.judge(v, sp) !== 'OK').length;
      const tone = fail > 0 ? 'bad' : (cv <= 3 ? 'ok' : 'warn');
      return `<div class="ft-stat ${tone}">
        <div class="ft-stat-lbl">${esc(it.label)}${phys.has(it.key) ? ' 物' : ''}</div>
        <div class="ft-stat-avg">${fmtNum(avg)} <span>${esc(it.unit || '')}</span></div>
        <div class="ft-stat-sub">범위 ${fmtNum(mn)}~${fmtNum(mx)} · σ${fmtNum(sd)} · CV ${fmtNum(cv, 1)}%${fail > 0 ? ` · <span class="text-danger">이탈 ${fail}</span>` : ''}</div>
      </div>`;
    }).join('');

    const table = `<table class="data-table compact">
      <thead><tr><th>생산·분석일</th><th>제품코드</th><th>시료명</th>
        ${cols.map(c => `<th>${esc(c.label)}<div class="imp-unit">${esc(c.unit || '')}${phys.has(c.key) ? ' 物' : ''}</div></th>`).join('')}</tr></thead>
      <tbody>${prods.map(r => `<tr>
        <td class="mono">${esc(fmtDate(r.date))}</td><td class="mono text-muted">${esc(r.code)}</td>
        <td class="ellipsis" style="max-width:140px">${esc(r.name || '')}</td>
        ${cols.map(c => { const v = valOf(r, c.key); if (v == null) return '<td class="text-muted">-</td>'; const sp = LabDB.resolveSpec('prod', r.code, c.key); const vd = (sp && (sp.min != null || sp.max != null)) ? LabDB.judge(v, sp) : 'NA'; const m = VERDICT_META[vd] || VERDICT_META.NA; return `<td class="mono"><b class="v-${m.cls}">${fmtNum(v)}</b></td>`; }).join('')}
      </tr>`).join('')}</tbody></table>`;

    return head +
      `<div class="ft-ver-note text-muted">CV(변동계수)가 낮을수록 품질이 <b>꾸준</b>합니다 · 초록=안정(≤3%) / 주황=변동 / 빨강=규격이탈</div>
       <div class="ft-stats">${stats}</div>
       <div class="ft-mtx-wrap" style="margin-top:10px">${table}</div>`;
  };

  const render = () => {
    ensureStyle();
    const formulas = formulaList();
    const cur = sel ? formulas.find(m => m.formula === sel) : null;

    return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><div class="card-title">배합비 추이분석</div>
        <div class="text-muted" style="font-size:12px">배합비를 선택하면 원료 구성비의 날짜별(개정일) 추이와, 그 배합비로 생산된 제품의 물리·화학 데이터가 함께 표시됩니다</div>
      </div>
    </div>
    <div class="ft-layout">
      <aside class="ft-list">
        <input type="text" class="form-input form-input-sm" placeholder="배합비·품명 검색" oninput="FormulaTrendPage.search(this.value)" value="${esc(query)}">
        <div class="ft-list-head"><span>배합비</span><span>품명</span></div>
        <div class="ft-list-body" id="ft-list-body">${listRows()}</div>
        <div class="ft-list-foot">전체 ${formulas.length}종</div>
      </aside>
      <section class="ft-detail">
        ${!sel ? `<div class="empty-lab">← 좌측에서 배합비를 선택하세요</div>` : renderDetail(cur)}
      </section>
    </div>`;
  };

  const renderDetail = (cur) => {
    const comp = getComposition(sel);
    const recs = recordsOf(sel);

    // 원료 구성비 매트릭스 (배합비 적용일별)
    const matrix = `
      <div class="ft-block">
        <div class="ft-block-title">원료 구성비 추이 (날짜=배합비 적용일)</div>
        <div id="ft-matrix">${comp.rows.length
          ? renderMatrixInner(comp)
          : '<div class="text-muted" style="padding:18px 4px;font-size:12.5px;line-height:1.8">'
            + '원료 구성비 데이터가 없습니다.<br>배합비 시스템 연동이 열리면 이 자리에 적용일별 구성비가 들어옵니다.'
            + '</div>'}</div>
      </div>`;

    // 배합비 버전(적용일)별 제품 품질
    const versionBlock = `
      <div class="ft-block">
        <div id="ft-version">${renderVersionProducts(sel)}</div>
      </div>`;

    // 추이 차트(제품 분석 항목)
    const usedItems = analysisItems(sel);
    if (usedItems.length && !usedItems.some(c => c.key === itemKey)) itemKey = usedItems[0].key;
    const phys = physSet();
    const chartBlock = usedItems.length === 0 ? '' : `
      <div class="ft-block">
        <div class="ft-block-title"><span>제품 분석 항목 추이</span></div>
        <div class="ft-item-btns">
          ${usedItems.map(c => `<button class="btn btn-sm ${c.key === itemKey ? 'btn-primary' : 'btn-ghost'}" data-k="${c.key}"
            onclick="FormulaTrendPage.setItem('${c.key}')">${esc(c.label)}${phys.has(c.key) ? ' 物' : ''}</button>`).join('')}
        </div>
        <div class="chart-frame" style="min-height:220px;margin:8px 0"><canvas id="ft-chart"></canvas></div>
      </div>`;

    return `
      <div class="ft-detail-head">
        <div><b>배합비 ${esc(sel)}</b> · ${esc(cur ? cur.name : '')}</div>
        <div class="ft-prod-chips">${prodIndex(sel).map(p => `
          <button class="ft-prod-chip ${selProd === p.code ? 'on' : ''}" onclick="FormulaTrendPage.setProd('${esc(p.code)}')"
            title="클릭하면 이 제품의 분석결과만 아래에 표시됩니다 (재클릭 시 전체)">
            <span class="mono">${esc(p.code)}</span> ${esc(p.name)} <b class="ft-prod-cnt">${p.recs.length}</b>
          </button>`).join('')}
          ${selProd ? `<span class="text-muted" style="font-size:11px;align-self:center">← 선택 제품만 표시 중</span>` : ''}</div>
      </div>
      ${matrix}
      ${versionBlock}
      ${chartBlock}`;
  };

  const drawChart = () => {
    const canvas = document.getElementById('ft-chart');
    if (!canvas || typeof Chart === 'undefined' || !sel) return;
    const recs = recordsOf(sel).filter(r => valOf(r, itemKey) != null).slice().reverse();
    const labels = recs.map(r => fmtDate(r.date));
    const data = recs.map(r => valOf(r, itemKey));
    const it = LabDB.getItem(itemKey);
    const firstCode = productsOf(sel)[0]?.code || '';
    const sp = LabDB.resolveSpec('prod', firstCode, itemKey);
    if (chart) { chart.destroy(); chart = null; }
    const ds = [{ label: `${it ? it.label : itemKey}${it && it.unit ? ' (' + it.unit + ')' : ''}`, data, borderColor: '#3E6AE1', backgroundColor: 'rgba(62,106,225,0.10)', tension: 0.25, pointRadius: 3, fill: true }];
    if (sp && sp.max != null) ds.push({ label: '상한', data: labels.map(() => sp.max), borderColor: '#ff5c7a', borderDash: [6, 4], pointRadius: 0, fill: false });
    if (sp && sp.min != null) ds.push({ label: '하한', data: labels.map(() => sp.min), borderColor: '#ffb020', borderDash: [6, 4], pointRadius: 0, fill: false });
    chart = new Chart(canvas, { type: 'line', data: { labels, datasets: ds },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#393C41', boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { ticks: { color: '#5C5E62', maxTicksLimit: 10, font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
                  y: { ticks: { color: '#5C5E62', font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.05)' } } } } });
  };

  const ensureStyle = () => {
    if (document.getElementById('ft-style')) return;
    const st = document.createElement('style'); st.id = 'ft-style';
    st.textContent = `
    .ft-layout{display:grid;grid-template-columns:300px 1fr;gap:12px;align-items:start;}
    @media (max-width:900px){ .ft-layout{grid-template-columns:1fr;} }
    .ft-list{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:10px;display:flex;flex-direction:column;gap:6px;position:sticky;top:12px;}
    .ft-list-head{display:flex;gap:8px;font-size:11px;font-weight:600;color:var(--text-muted);padding:4px 8px;border-bottom:2px solid var(--accent);}
    .ft-list-head span:first-child{width:52px;}
    .ft-list-body{max-height:62vh;overflow:auto;display:flex;flex-direction:column;}
    .ft-row{display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border);}
    .ft-row:hover{background:var(--bg-hover);}
    .ft-row.sel{background:var(--accent);color:#fff;}
    .ft-row.sel .ft-row-code{color:#fff;}
    .ft-row-code{width:52px;flex-shrink:0;color:var(--accent);font-weight:600;}
    .ft-row-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .ft-list-foot{font-size:11px;color:var(--text-muted);text-align:right;padding:2px 6px;}
    .ft-detail{min-width:0;display:flex;flex-direction:column;gap:12px;}
    .ft-detail-head{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;}
    .ft-prod-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
    .ft-prod-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;font-size:11px;background:var(--info-bg);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;font-family:inherit;transition:.12s;}
    .ft-prod-chip:hover{border-color:var(--accent);}
    .ft-prod-chip.on{background:var(--accent);color:#fff;border-color:var(--accent);}
    .ft-prod-chip.on .mono,.ft-prod-chip.on .ft-prod-cnt{color:#fff;}
    .ft-prod-cnt{font-size:10px;background:rgba(62,106,225,.12);border-radius:8px;padding:1px 6px;color:var(--accent);}
    .ft-block{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px;}
    .ft-block-title{font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
    .ft-mtx-wrap{overflow:auto;max-height:60vh;border:1px solid var(--border);border-radius:6px;}
    .ft-mtx{border-collapse:separate;border-spacing:0;white-space:nowrap;font-size:11.5px;min-width:100%;}
    .ft-mtx th,.ft-mtx td{border-bottom:1px solid var(--border);border-right:1px solid var(--border);padding:4px 8px;text-align:right;}
    .ft-mtx thead th{position:sticky;top:0;background:var(--bg-surface);color:var(--text-secondary);font-weight:600;z-index:2;text-align:center;}
    .ft-mtx-fix{position:sticky;left:0;background:var(--bg-card);text-align:left !important;z-index:1;width:70px;}
    .ft-mtx-fix2{position:sticky;left:70px;background:var(--bg-card);text-align:left !important;z-index:1;min-width:150px;}
    .ft-mtx thead .ft-mtx-fix,.ft-mtx thead .ft-mtx-fix2{z-index:3;}
    .ft-mtx tbody tr:hover td{background:var(--bg-hover);}
    .ft-mtx-total td{position:sticky;bottom:0;background:var(--info-bg);font-weight:700;color:var(--accent);border-top:2px solid var(--accent);}
    .ft-mtx-total .ft-mtx-fix,.ft-mtx-total .ft-mtx-fix2{background:var(--info-bg);}
    .ft-item-btns{display:flex;flex-wrap:wrap;gap:6px;}
    .empty-lab{padding:28px;text-align:center;color:var(--text-muted);}
    .ft-controls{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}
    .ft-ctrl-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
    .ft-ctrl-label{font-size:12px;font-weight:600;color:var(--text-secondary);min-width:78px;}
    .ft-chips{display:flex;flex-wrap:wrap;gap:4px;}
    .ft-chip{border:1px solid var(--border);background:var(--bg-card);color:var(--text-muted);
      font-size:11px;padding:3px 8px;border-radius:var(--radius-sm);cursor:pointer;font-family:inherit;}
    .ft-chip.on{background:var(--accent);color:#fff;border-color:var(--accent);}
    .ft-rowpanel{border:1px solid var(--border);border-radius:8px;padding:8px;max-height:220px;overflow:auto;
      display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:2px 10px;background:var(--bg-soft);}
    .ft-rowpanel-item{display:flex;align-items:center;gap:6px;font-size:12px;padding:3px 4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .ft-rowpanel-item input{width:14px;height:14px;accent-color:var(--accent);flex-shrink:0;}
    .ft-rowpanel-head{grid-column:1/-1;position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;
      padding:6px 6px;margin:-8px -8px 2px;background:var(--bg-card);border-bottom:1px solid var(--border);font-size:11px;color:var(--text-muted);}
    .ft-rowpanel-grp{grid-column:1/-1;font-size:11px;font-weight:700;color:var(--text-secondary);padding:6px 4px 2px;border-bottom:1px solid var(--border);margin-top:4px;}
    .ft-sec td{background:var(--bg-soft) !important;font-weight:700;font-size:11px;color:var(--text-secondary);position:sticky;}
    .ft-sec .ft-mtx-fix2{background:var(--bg-soft) !important;}
    .ft-col-sum{background:var(--info-bg);}
    .ft-col-item{background:rgba(62,106,225,0.04);}
    .ft-th-rev{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:2px 4px;border-radius:4px;}
    .ft-th-rev:hover{background:var(--accent);color:#fff;}
    .ft-col-selrev{background:var(--accent) !important;color:#fff !important;}
    .ft-col-selrev .ft-th-rev{color:#fff;}
    .ft-ver-head{font-size:14px;font-weight:700;margin-bottom:8px;}
    .ft-ver-revs{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;}
    .ft-ver-note{font-size:11px;margin-bottom:10px;}
    .ft-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;}
    .ft-stat{border:1px solid var(--border);border-left:3px solid var(--text-muted);border-radius:8px;padding:8px 10px;background:var(--bg-card);}
    .ft-stat.ok{border-left-color:var(--success);} .ft-stat.warn{border-left-color:var(--warning);} .ft-stat.bad{border-left-color:var(--danger);}
    .ft-stat-lbl{font-size:11px;color:var(--text-secondary);}
    .ft-stat-avg{font-size:18px;font-weight:700;} .ft-stat-avg span{font-size:10px;font-weight:400;color:var(--text-muted);}
    .ft-stat-sub{font-size:10px;color:var(--text-muted);margin-top:2px;}`;
    document.head.appendChild(st);
  };

  const afterRender = () => { ensureStyle(); drawChart(); };

  return { render, afterRender, search, pick, setItem, setRev, setProd,
    toggleDate, allDates, toggleRow, allRows, onlyUsedRows, toggleTranspose, toggleRowPanel };
})();
