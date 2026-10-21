// ============================================================
// spec.js — 규격(스펙) 관리
//   원료/제품별 리스트업 매트릭스: 행=코드, 열=분석항목, 셀=하한~상한 즉시 편집
//   판정 우선순위 유지: 수동 > 반려공식(petspec) > 등록성분(regspec) > 통계밴드
// ============================================================

const SpecPage = (() => {
  let viewKind = 'prod';                    // 'prod' | 'raw'
  let query = '';
  let editBy = '';                          // 수정자 (세션 유지)
  let editReason = '';                      // 수정사유 (변경 저장 시 필수)
  const extraRows = { raw: [], prod: [] };  // 세션 중 수동 추가한 행(코드)
  const extraCols = { raw: [], prod: [] };  // 세션 중 수동 추가한 열(항목)
  const ROW_CAP = 80;

  // 규격이 없어도 바로 입력할 수 있는 핵심 성분 열
  const CORE_ITEMS = ['moist', 'protein_n', 'protein', 'fat', 'fiber', 'ash', 'ca', 'p'];

  const SRC_META = {
    manual:  { label: '수동',     color: '#3b82f6' },
    petspec: { label: '반려공식', color: '#a78bfa' },
    regspec: { label: '등록성분', color: '#6b7f95' },
  };
  const srcOf = (s) => (s && s.src) ? s.src : 'manual';

  // ── 데이터 헬퍼 ──
  const kindMatch = (s, kind) => s.kind === kind || s.kind === 'ALL';
  const codeSpecs = (kind) => LabDB.getSpecs().filter(s => s.code && kindMatch(s, kind));
  const globalSpecs = () => LabDB.getSpecs().filter(s => !s.code);

  // (kind, code, item)의 유효 규격 — judge()와 동일하게 배열 앞쪽 active 우선
  const specFor = (kind, code, item) => {
    const arr = LabDB.getSpecs().filter(s => s.code === code && s.item === item && kindMatch(s, kind));
    return arr.find(s => s.active && (s.min != null || s.max != null)) || arr.find(s => s.active) || arr[0] || null;
  };

  const columns = (kind) => {
    const used = new Set(CORE_ITEMS.concat(extraCols[kind]));
    codeSpecs(kind).forEach(s => used.add(s.item));
    return LabDB.getItems().filter(it => used.has(it.key));
  };

  const rowsFor = (kind) => {
    const codes = new Set(extraRows[kind]);
    codeSpecs(kind).forEach(s => codes.add(s.code));
    let rows = [...codes].map(code => ({ code, name: LabDB.nameOf(kind, code) || '' }));
    const lq = query.toLowerCase().trim();
    if (lq) rows = rows.filter(r => r.code.toLowerCase().includes(lq) || r.name.toLowerCase().includes(lq));
    rows.sort((a, b) => a.code.localeCompare(b.code));
    return rows;
  };

  // ── 매트릭스 렌더 ──
  const cellHtml = (kind, code, item) => {
    const s = specFor(kind, code, item);
    const src = s ? srcOf(s) : null;
    const meta = src ? SRC_META[src] : null;
    const off = s && !s.active;
    const tip = s
      ? `${meta.label} 규격${off ? ' (중지됨 — 값 수정 시 재사용)' : ''} · ${(s.updatedAt || '').slice(0, 10)}`
      : '값 입력 시 수동 규격 생성';
    const inp = (f, v) => `<input type="number" step="any" id="sp-c-${code}-${item}-${f}"
      value="${v != null ? v : ''}" placeholder="${f === 'min' ? '하한' : '상한'}"
      onchange="SpecPage.cellEdit('${code}','${item}')"
      style="width:60px;padding:3px 5px;font-size:11.5px;text-align:center;background:var(--bg-input,transparent);
      border:1px solid var(--border);border-radius:5px;color:var(--text);${off ? 'opacity:.45;' : ''}" class="mono">`;
    const dot = meta ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${meta.color};flex-shrink:0;${off ? 'opacity:.35;' : ''}"></span>` : '<span style="display:inline-block;width:6px"></span>';
    return `<td style="text-align:center;white-space:nowrap;padding:5px 8px" title="${tip}">
      <div style="display:flex;align-items:center;gap:4px;justify-content:center">
        ${dot}${inp('min', s ? s.min : null)}<span class="text-muted" style="font-size:10px">~</span>${inp('max', s ? s.max : null)}
      </div>
    </td>`;
  };

  const matrixHtml = () => {
    const kind = viewKind;
    const cols = columns(kind);
    const all = rowsFor(kind);
    const rows = all.slice(0, ROW_CAP);
    const kLabel = kind === 'raw' ? '원료' : '제품';
    const head = cols.map(it =>
      `<th style="text-align:center">${esc(it.label)}${it.unit ? `<br><span style="font-weight:400;font-size:10px;color:var(--text-muted)">${esc(it.unit)}</span>` : ''}</th>`).join('');
    const body = rows.length ? rows.map(r => `
      <tr>
        <td class="col-fix">
          <div style="display:flex;flex-direction:column;gap:1px;min-width:150px;max-width:210px">
            <span class="mono" style="font-size:12px">${esc(r.code)}</span>
            <span class="text-muted ellipsis" style="font-size:11px" title="${esc(r.name)}">${esc(r.name) || '-'}</span>
          </div>
        </td>
        ${cols.map(it => cellHtml(kind, r.code, it.key)).join('')}
      </tr>`).join('')
      : `<tr><td colspan="${cols.length + 1}" class="text-muted" style="text-align:center;padding:24px">
          ${query ? '검색 결과가 없습니다' : `등록된 ${kLabel} 규격이 없습니다 — 위 검색창에서 ${kLabel}를 찾아 행을 추가하세요`}
        </td></tr>`;
    const capNote = all.length > ROW_CAP
      ? `<div class="text-muted" style="font-size:12px;margin-top:8px">※ ${all.length}개 중 상위 ${ROW_CAP}개만 표시 — <b>검색</b>으로 대상을 좁혀 수정하세요.</div>` : '';
    return `<div class="xtbl-wrap" style="max-height:min(900px,calc(100vh - 380px))">
      <table class="xtbl">
        <thead><tr><th class="col-fix">코드 · 명칭 <span class="text-muted" style="font-weight:400">(${all.length})</span></th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>${capNote}`;
  };

  const render = () => {
    const globals = globalSpecs();
    const gRows = globals.length ? globals.map(s => `
      <tr class="${s.active ? '' : 'row-dim'}">
        <td><span class="tag tag-${s.kind === 'raw' ? 'blue' : s.kind === 'prod' ? 'green' : 'gray'}">${s.kind === 'raw' ? '원료' : s.kind === 'prod' ? '제품' : '전체'}</span></td>
        <td>${LabDB.itemLabel(s.item)} <span class="text-muted">${LabDB.itemUnit(s.item)}</span></td>
        <td><input type="number" step="any" id="spg-${s.id}-min" value="${s.min != null ? s.min : ''}" onchange="SpecPage.gEdit('${s.id}')" class="form-input form-input-sm mono" style="width:90px"></td>
        <td><input type="number" step="any" id="spg-${s.id}-max" value="${s.max != null ? s.max : ''}" onchange="SpecPage.gEdit('${s.id}')" class="form-input form-input-sm mono" style="width:90px"></td>
        <td>${s.active ? '<span class="verdict verdict-ok">사용</span>' : '<span class="text-muted">중지</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="SpecPage.gToggle('${s.id}')">${s.active ? '중지' : '사용'}</button>
          <button class="btn btn-ghost btn-xs" onclick="SpecPage.gDel('${s.id}')">삭제</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:14px">공통 규격 없음</td></tr>';

    const itemOpts = LabDB.getItems().map(i => `<option value="${i.key}">${i.label} (${i.unit})</option>`).join('');
    const colOpts = LabDB.getItems().filter(i => !columns(viewKind).some(c => c.key === i.key))
      .map(i => `<option value="${i.key}">${i.label} (${i.unit})</option>`).join('');
    const legend = Object.values(SRC_META).map(m =>
      `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text-muted)">
        <span style="width:7px;height:7px;border-radius:50%;background:${m.color};display:inline-block"></span>${m.label}</span>`).join('');

    return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div class="card-title">${viewKind === 'raw' ? '원료' : '제품'}별 규격 매트릭스</div>
        <div style="display:flex;gap:14px;align-items:center">${legend}
          <button class="btn btn-ghost btn-sm" onclick="SpecPage.showLog()">변경 이력 (${LabDB.getSpecLog().length})</button>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm ${viewKind === 'prod' ? 'btn-primary' : 'btn-ghost'}" onclick="SpecPage.setKind('prod')">제품</button>
          <button class="btn btn-sm ${viewKind === 'raw' ? 'btn-primary' : 'btn-ghost'}" onclick="SpecPage.setKind('raw')">원료</button>
        </div>
        <div class="form-group" style="margin:0;width:110px">
          <label class="form-label">수정자 <span style="color:#e05252">*</span></label>
          <input type="text" class="form-input form-input-sm" id="sp-by" value="${esc(editBy)}" placeholder="담당자명" oninput="SpecPage.setBy(this.value)">
        </div>
        <div class="form-group" style="margin:0;min-width:190px">
          <label class="form-label">수정사유 <span style="color:#e05252">*</span> <span class="text-muted">(변경 시 이력에 기록)</span></label>
          <input type="text" class="form-input form-input-sm" id="sp-reason" value="${esc(editReason)}" placeholder="예: 등록성분 변경, 기준 재설정" oninput="SpecPage.setReason(this.value)">
        </div>
        <div class="form-group" style="margin:0;flex:1;min-width:200px">
          <label class="form-label">검색 (코드·명칭)</label>
          <input type="text" class="form-input form-input-sm" id="sp-search" value="${esc(query)}" placeholder="예: 1000010, 슈퍼50" oninput="SpecPage.onSearch(this.value)">
        </div>
        <div class="form-group" style="margin:0;min-width:230px;position:relative">
          <label class="form-label">행 추가 (${viewKind === 'raw' ? '원료' : '제품'} 검색 → 선택)</label>
          <input type="text" class="form-input form-input-sm" id="sp-addrow" placeholder="코드·명칭 입력" oninput="SpecPage.rowSuggest(this.value)" autocomplete="off">
          <div id="sp-addrow-sug" style="position:absolute;top:100%;left:0;right:0;z-index:40;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;max-height:240px;overflow:auto;display:none;box-shadow:0 8px 24px rgba(0,0,0,.35)"></div>
        </div>
        <div class="form-group" style="margin:0;min-width:200px">
          <label class="form-label">열 추가 (분석항목)</label>
          <div style="display:flex;gap:6px">
            <select class="form-input form-input-sm" id="sp-addcol" style="flex:1">${colOpts}</select>
            <button class="btn btn-outline-primary btn-sm" onclick="SpecPage.addCol()">추가</button>
          </div>
        </div>
      </div>
      <div id="sp-matrix">${matrixHtml()}</div>
      <div class="text-muted" style="font-size:12px;margin-top:10px;line-height:1.6">
        · 셀에 <b>하한~상한</b>을 입력하면 즉시 저장됩니다. 반려공식·등록성분 규격을 수정하면 <b>수동 규격으로 전환</b>되어 시드 갱신에도 유지됩니다.<br>
        · 두 값을 모두 지우면 해당 규격이 삭제됩니다. 판정 우선순위: <b>수동</b> → 반려공식 → 등록성분 → 통계밴드(평균±2σ, 표본 5건↑)
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">전체(공통) 규격 <span class="text-muted" style="font-weight:400">— 코드 지정이 없는 기본 기준</span></div></div>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr><th>대상</th><th>항목</th><th>하한</th><th>상한</th><th>상태</th><th></th></tr></thead>
          <tbody>${gRows}</tbody>
        </table>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:12px">
        <div class="form-group" style="margin:0">
          <label class="form-label">대상</label>
          <select class="form-input form-input-sm" id="spg-kind"><option value="ALL">전체</option><option value="raw">원료</option><option value="prod">제품</option></select>
        </div>
        <div class="form-group" style="margin:0;min-width:220px"><label class="form-label">항목</label><select class="form-input form-input-sm" id="spg-item">${itemOpts}</select></div>
        <div class="form-group" style="margin:0"><label class="form-label">하한</label><input type="number" step="any" class="form-input form-input-sm" id="spg-min" style="width:100px"></div>
        <div class="form-group" style="margin:0"><label class="form-label">상한</label><input type="number" step="any" class="form-input form-input-sm" id="spg-max" style="width:100px"></div>
        <button class="btn btn-primary btn-sm" onclick="SpecPage.gAdd()">공통 규격 추가</button>
      </div>
    </div>`;
  };

  // ── 매트릭스 편집 ──
  const flash = (code, item) => {
    ['min', 'max'].forEach(f => {
      const el = document.getElementById(`sp-c-${code}-${item}-${f}`);
      if (!el) return;
      el.style.borderColor = '#2e9e5b';
      setTimeout(() => { el.style.borderColor = 'var(--border)'; }, 700);
    });
  };

  // 변경 전 값으로 셀 입력을 되돌림 (사유 미입력·검증 실패 시)
  const revertCell = (code, item, eff) => {
    const minEl = document.getElementById(`sp-c-${code}-${item}-min`);
    const maxEl = document.getElementById(`sp-c-${code}-${item}-max`);
    if (minEl) minEl.value = eff && eff.min != null ? eff.min : '';
    if (maxEl) maxEl.value = eff && eff.max != null ? eff.max : '';
  };
  const requireReason = () => {
    if (editReason.trim()) return true;
    App.toast('수정사유를 먼저 입력하세요 — 모든 규격 변경은 이력에 기록됩니다', 'warning');
    document.getElementById('sp-reason')?.focus();
    return false;
  };
  const logChange = (action, code, item, from, to) => LabDB.addSpecLog({
    by: editBy.trim(), reason: editReason.trim(), action,
    kind: viewKind, code, name: LabDB.nameOf(viewKind, code), item,
    from, to,
  });

  const cellEdit = (code, item) => {
    const minEl = document.getElementById(`sp-c-${code}-${item}-min`);
    const maxEl = document.getElementById(`sp-c-${code}-${item}-max`);
    if (!minEl || !maxEl) return;
    const minV = minEl.value.trim(), maxV = maxEl.value.trim();
    const matches = LabDB.getSpecs().filter(s => s.code === code && s.item === item && kindMatch(s, viewKind));
    const eff = specFor(viewKind, code, item);
    const fromVals = eff ? { min: eff.min, max: eff.max } : null;

    if (minV === '' && maxV === '') {                       // 모두 비움 → 규격 삭제
      if (!matches.length) return;
      if (!requireReason()) { revertCell(code, item, eff); return; }
      matches.forEach(s => LabDB.deleteSpec(s.id));
      logChange('삭제', code, item, fromVals, null);
      App.toast(`규격 삭제: ${code} · ${LabDB.itemLabel(item)} (이력 기록됨)`, 'info');
      refreshCell(code, item);
      return;
    }
    if (minV !== '' && maxV !== '' && Number(minV) > Number(maxV)) {
      App.toast('하한이 상한보다 큽니다 — 저장하지 않았습니다', 'error');
      revertCell(code, item, eff);
      return;
    }
    // 실제 변경 없으면 종료
    const newMin = minV === '' ? null : Number(minV), newMax = maxV === '' ? null : Number(maxV);
    if (eff && eff.min === newMin && eff.max === newMax) return;
    if (!requireReason()) { revertCell(code, item, eff); return; }
    const manual = matches.find(s => !s.src);
    if (manual) {                                           // 기존 수동 규격 갱신 + 중복 정리
      LabDB.updateSpec(manual.id, { min: minV, max: maxV, active: true });
      matches.filter(s => s.id !== manual.id).forEach(s => LabDB.deleteSpec(s.id));
    } else {                                                // 시드(반려공식/등록성분) → 수동 전환
      matches.forEach(s => LabDB.deleteSpec(s.id));
      LabDB.addSpec({ kind: viewKind, code, item, min: minV, max: maxV });
    }
    logChange(matches.length ? '수정' : '생성', code, item, fromVals, { min: newMin, max: newMax });
    flash(code, item);
    refreshCell(code, item);
  };

  // 셀 하나만 다시 그려 출처 점·툴팁 갱신 (스크롤·포커스 유지)
  const refreshCell = (code, item) => {
    const el = document.getElementById(`sp-c-${code}-${item}-min`);
    const td = el && el.closest('td');
    if (!td) return;
    const tmp = document.createElement('table');
    tmp.innerHTML = `<tr>${cellHtml(viewKind, code, item)}</tr>`;
    td.replaceWith(tmp.querySelector('td'));
    flash(code, item);
  };

  // ── 상단 컨트롤 ──
  const setKind = (k) => { if (viewKind !== k) { viewKind = k; query = ''; App.refreshPage(); } };
  let searchTimer = null;
  const onSearch = (v) => {
    query = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const el = document.getElementById('sp-matrix');
      if (el) el.innerHTML = matrixHtml();
    }, 250);
  };
  const rowSuggest = (v) => {
    const box = document.getElementById('sp-addrow-sug');
    if (!box) return;
    const q = String(v || '').trim();
    if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const hits = LabDB.searchMaster(viewKind, q, 12);
    box.innerHTML = hits.length ? hits.map(m => `
      <div style="padding:7px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)"
        onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''"
        onclick="SpecPage.pickRow('${esc(m.code)}')">
        <span class="mono">${esc(m.code)}</span> <span class="text-muted">${esc(m.name || '')}</span>
      </div>`).join('') : '<div class="text-muted" style="padding:8px 10px;font-size:12px">검색 결과 없음</div>';
    box.style.display = 'block';
  };
  const pickRow = (code) => {
    if (!extraRows[viewKind].includes(code)) extraRows[viewKind].push(code);
    query = code;                                  // 추가한 행이 바로 보이게 검색 고정
    const si = document.getElementById('sp-search'); if (si) si.value = code;
    const ai = document.getElementById('sp-addrow'); if (ai) ai.value = '';
    const box = document.getElementById('sp-addrow-sug'); if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    const el = document.getElementById('sp-matrix'); if (el) el.innerHTML = matrixHtml();
    App.toast(`행 추가: ${code} — 셀에 값을 입력하면 규격이 생성됩니다`, 'success');
  };
  const addCol = () => {
    const sel = document.getElementById('sp-addcol');
    if (!sel || !sel.value) return;
    if (!extraCols[viewKind].includes(sel.value)) extraCols[viewKind].push(sel.value);
    App.refreshPage();
  };

  // ── 전체(공통) 규격 ──  (변경 시 동일하게 사유 필수 + 이력 기록)
  const gLog = (action, s, from, to) => LabDB.addSpecLog({
    by: editBy.trim(), reason: editReason.trim(), action,
    kind: s.kind || 'ALL', code: '', name: '(공통)', item: s.item, from, to,
  });
  const gAdd = () => {
    const item = document.getElementById('spg-item').value;
    const min = document.getElementById('spg-min').value;
    const max = document.getElementById('spg-max').value;
    if (min === '' && max === '') { App.toast('상한 또는 하한 중 하나는 입력하세요', 'warning'); return; }
    if (min !== '' && max !== '' && Number(min) > Number(max)) { App.toast('하한이 상한보다 큽니다', 'error'); return; }
    if (!requireReason()) return;
    const s = LabDB.addSpec({ kind: document.getElementById('spg-kind').value, code: '', item, min, max });
    gLog('생성', s, null, { min: s.min, max: s.max });
    App.toast('공통 규격이 저장되었습니다 (이력 기록됨)', 'success');
    App.refreshPage();
  };
  const gEdit = (id) => {
    const s = LabDB.getSpecs().find(x => x.id === id);
    if (!s) return;
    const minV = document.getElementById(`spg-${id}-min`).value;
    const maxV = document.getElementById(`spg-${id}-max`).value;
    if (minV !== '' && maxV !== '' && Number(minV) > Number(maxV)) { App.toast('하한이 상한보다 큽니다 — 저장하지 않았습니다', 'error'); App.refreshPage(); return; }
    if (!requireReason()) { App.refreshPage(); return; }
    const from = { min: s.min, max: s.max };
    if (minV === '' && maxV === '') {
      LabDB.deleteSpec(id); gLog('삭제', s, from, null);
      App.toast('공통 규격 삭제 (이력 기록됨)', 'info'); App.refreshPage(); return;
    }
    const u = LabDB.updateSpec(id, { min: minV, max: maxV });
    gLog('수정', s, from, { min: u.min, max: u.max });
    App.toast('공통 규격 수정됨 (이력 기록됨)', 'success');
  };
  const gToggle = (id) => {
    const s = LabDB.getSpecs().find(x => x.id === id);
    if (!s) return;
    if (!requireReason()) return;
    LabDB.updateSpec(id, { active: !s.active });
    gLog(s.active ? '중지' : '사용재개', s, { min: s.min, max: s.max }, { min: s.min, max: s.max });
    App.refreshPage();
  };
  const gDel = (id) => {
    const s = LabDB.getSpecs().find(x => x.id === id);
    if (!s) return;
    if (!requireReason()) return;
    if (!confirm('이 규격을 삭제할까요?')) return;
    LabDB.deleteSpec(id);
    gLog('삭제', s, { min: s.min, max: s.max }, null);
    App.refreshPage();
  };

  // ── 변경 이력 뷰어 ──
  const fmtRange = (v) => v == null ? '(없음)' : `${v.min != null ? v.min : '-'} ~ ${v.max != null ? v.max : '-'}`;
  const closeLog = () => { document.getElementById('splog-overlay')?.remove(); };
  const showLog = () => {
    closeLog();
    const log = LabDB.getSpecLog().slice().reverse().slice(0, 300);
    const rows = log.length ? log.map(e => `
      <tr>
        <td style="white-space:nowrap" class="text-muted">${esc(String(e.ts || '').slice(0, 16).replace('T', ' '))}</td>
        <td>${esc(e.by || '-')}</td>
        <td><span class="tag tag-${e.action === '삭제' ? 'red' : e.action === '생성' ? 'green' : 'blue'}">${esc(e.action)}</span></td>
        <td class="mono">${esc(e.code || '(공통)')}<br><span class="text-muted" style="font-size:10px">${esc(e.name || '')}</span></td>
        <td>${esc(LabDB.itemLabel(e.item))}</td>
        <td class="mono" style="white-space:nowrap"><span style="color:#ff8fa3">${esc(fmtRange(e.from))}</span> → <span style="color:#48c78e">${esc(fmtRange(e.to))}</span></td>
        <td style="color:#ffb020">${esc(e.reason || '')}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px">변경 이력이 없습니다</td></tr>';
    const ov = document.createElement('div');
    ov.id = 'splog-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;width:min(960px,96vw);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
          <b>규격 변경 이력 <span class="text-muted" style="font-weight:400;font-size:12px">(최근 ${log.length}건)</span></b>
          <button class="btn btn-ghost btn-sm" onclick="SpecPage.closeLog()">✕ 닫기</button>
        </div>
        <div style="overflow:auto;padding:10px 18px 18px">
          <table class="data-table compact" style="font-size:12px">
            <thead><tr><th>일시</th><th>수정자</th><th>구분</th><th>코드</th><th>항목</th><th>변경 (하한~상한)</th><th>사유</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeLog(); });
    document.body.appendChild(ov);
  };

  const setBy = (v) => { editBy = v; };
  const setReason = (v) => { editReason = v; };

  return { render, setKind, onSearch, cellEdit, rowSuggest, pickRow, addCol, gAdd, gEdit, gToggle, gDel, setBy, setReason, showLog, closeLog };
})();
