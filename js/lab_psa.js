// ============================================================
// lab_psa.js — 양축 · 입자도 분석 (Particle Size, ASABE S319)
//   제품·체세트 선택 → 체별 Wi(g) 입력 → Dgw(기하평균입경)/Sgw(기하표준편차) 자동
//   계산식은 우성사료 입자도 엑셀(양식#1~#6) 수식 1:1 재현.
// ============================================================

const PSAPage = (() => {
  let openId = null;
  const S = () => LabSpeciesDB;

  // ── 목록 ──
  const listView = () => {
    const list = S().getPSAs();
    const withDgw = list.map(r => {
      const set = S().getPsaSet(r.setId);
      const c = set ? S().psaCompute(set.sieves, r.weights || {}) : null;
      return { r, set, c };
    });
    const valid = withDgw.filter(x => x.c && x.c.valid);
    const avgDgw = valid.length ? valid.reduce((a, x) => a + x.c.DgwMm, 0) / valid.length : null;

    const rows = withDgw.length ? withDgw.map(({ r, set, c }) => `
      <tr onclick="PSAPage.open('${r.id}')" style="cursor:pointer">
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td><b>${esc(r.product || '-')}</b></td>
        <td class="text-muted">${esc(set ? set.name : r.setId || '-')}</td>
        <td class="mono">${c && c.valid ? fmtNum(c.DgwMm, 3) : '-'}</td>
        <td class="mono">${c && c.valid ? fmtNum(c.Dgw, 0) : '-'}</td>
        <td class="mono">${c && c.valid ? fmtNum(c.Sgw, 3) : '-'}</td>
        <td class="text-muted">${r.volWeight != null ? fmtNum(r.volWeight, 0) : '-'}</td>
        <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="PSAPage.report('${r.id}')">분석표</button></td>
      </tr>`).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">등록된 입자도 분석이 없습니다.</td></tr>`;

    return `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">분석 건수</div><div class="stat-value">${fmtNum(list.length, 0)}</div><div class="stat-sub">제품 입자도</div></div>
      <div class="stat-card ok"><div class="stat-label">평균 Dgw</div><div class="stat-value">${avgDgw != null ? fmtNum(avgDgw, 3) : '-'}<span style="font-size:13px"> mm</span></div><div class="stat-sub">기하평균입경</div></div>
      <div class="stat-card"><div class="stat-label">체 세트</div><div class="stat-value">${fmtNum(S().getPsaSets().length, 0)}</div><div class="stat-sub">스크린 규격</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">입자도 분석 (Dgw) <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="PSAPage.open('NEW')">＋ 입자도 분석</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>분석일</th><th>제품</th><th>체 세트</th><th>Dgw(mm)</th><th>Dgw(μm)</th><th>Sgw</th><th>용적중</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">Dgw=기하평균입경(10^(ΣWi·log√(dᵢ₋₁·dᵢ)/ΣWi)), Sgw=기하표준편차 · ASABE S319 표준. 최상단 체는 상단 구경 참조로만 사용.</div>
    </div>`;
  };

  // ── 입력/상세 ──
  const detailView = (id) => {
    const isNew = id === 'NEW';
    const r = isNew ? { date: new Date().toISOString().slice(0, 10), weights: {}, setId: S().getPsaSets()[0]?.id || '' } : S().getPSA(id);
    if (!r) return listView();
    const sets = S().getPsaSets();
    const setOpts = sets.map(s => `<option value="${s.id}" ${s.id === r.setId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="PSAPage.back()">← 목록</button>
        <div class="card-title" style="margin:0">${isNew ? '＋ 입자도 분석' : '' + esc(r.product || '입자도')}</div>
        ${isNew ? '' : `<button class="btn btn-ghost btn-sm" onclick="PSAPage.remove('${r.id}')">삭제</button>`}
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">분석일자</label><input type="date" class="form-input" id="ps-date" value="${esc(r.date || '')}"></div>
        <div class="form-group"><label class="form-label">제품명 <span class="req">*</span></label><input type="text" class="form-input" id="ps-product" value="${esc(r.product || '')}" placeholder="예: 비육우 사료"></div>
        <div class="form-group"><label class="form-label">생산일</label><input type="date" class="form-input" id="ps-proddate" value="${esc(r.prodDate || '')}"></div>
        <div class="form-group"><label class="form-label">용적중(g/L)</label><input type="number" step="any" class="form-input" id="ps-vol" value="${r.volWeight ?? ''}"></div>
      </div>
      <div class="form-group" style="max-width:320px"><label class="form-label">체 세트(스크린 규격)</label><select class="form-input" id="ps-set" onchange="PSAPage.changeSet()">${setOpts}</select></div>

      <div class="card" style="padding:12px;margin:4px 0 14px">
        <div class="card-title" style="font-size:13px;margin-bottom:8px">체별 잔류 무게 Wi (g) 입력</div>
        <div id="ps-sieve-inputs"></div>
        <div class="text-muted" style="font-size:11px;margin-top:6px">※ 최상단 체(오버사이즈)는 기록용이며 Dgw 합계에서 제외됩니다(엑셀 동일).</div>
      </div>

      <div id="ps-preview"></div>

      <div class="form-group"><label class="form-label">비고</label><textarea class="form-input" id="ps-note" rows="2">${esc(r.note || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="PSAPage.back()">취소</button>
        <button class="btn btn-primary" onclick="PSAPage.save('${isNew ? 'NEW' : r.id}')">저장</button>
      </div>
    </div>`;
  };

  const sieveInputsHtml = (set, weights) => {
    if (!set) return '<div class="text-muted">체 세트를 선택하세요.</div>';
    const cells = set.sieves.map((s, i) => `
      <div style="min-width:78px;text-align:center">
        <div class="text-muted" style="font-size:11px">${esc(s.name)}${i === 0 ? ' <span style="color:#c67f22">(상단)</span>' : ''}</div>
        <div class="text-muted" style="font-size:10px">${s.d}μm</div>
        <input type="number" step="any" class="form-input" style="text-align:center;padding:4px" data-sieve="${esc(s.name)}" value="${(weights && weights[s.name] != null) ? weights[s.name] : ''}" oninput="PSAPage.preview()">
      </div>`).join('');
    return `<div style="display:flex;flex-wrap:wrap;gap:8px">${cells}</div>`;
  };

  const previewHtml = (c) => {
    if (!c || !c.valid) return '<div class="text-muted" style="font-size:12px">체별 무게를 입력하면 Dgw·Sgw가 계산됩니다.</div>';
    const cell = (lbl, v, u) => `<td style="text-align:center;padding:6px 14px"><div class="text-muted" style="font-size:11px">${lbl}</div><div style="font-size:20px;font-weight:800">${v}<span style="font-size:12px"> ${u || ''}</span></div></td>`;
    return `<div class="card" style="padding:10px;margin-bottom:14px"><table style="width:100%"><tr>
      ${cell('Dgw', fmtNum(c.DgwMm, 3), 'mm')}${cell('Dgw', fmtNum(c.Dgw, 0), 'μm')}${cell('Sgw', fmtNum(c.Sgw, 3), '')}${cell('시료합계', fmtNum(c.totalWi, 1), 'g')}
    </tr></table></div>`;
  };

  const render = () => openId ? detailView(openId) : listView();
  const afterRender = () => { if (openId) { renderSieves(); preview(); } };

  // ── 액션 ──
  const g = (i) => document.getElementById(i);
  const currentSet = () => S().getPsaSet(g('ps-set')?.value);
  const readWeights = () => {
    const w = {};
    document.querySelectorAll('#ps-sieve-inputs input[data-sieve]').forEach(inp => {
      if (inp.value !== '') w[inp.dataset.sieve] = parseFloat(inp.value);
    });
    return w;
  };
  const renderSieves = () => {
    const set = currentSet();
    const r = openId && openId !== 'NEW' ? S().getPSA(openId) : null;
    const el = g('ps-sieve-inputs'); if (el) el.innerHTML = sieveInputsHtml(set, r ? r.weights : {});
  };
  const changeSet = () => { renderSieves(); preview(); };
  const preview = () => {
    const set = currentSet(); if (!set) return;
    const c = S().psaCompute(set.sieves, readWeights());
    const el = g('ps-preview'); if (el) el.innerHTML = previewHtml(c);
  };

  const open = (id) => { openId = id; App.refreshPage(); };
  const back = () => { openId = null; App.refreshPage(); };
  const save = (id) => {
    const product = g('ps-product')?.value.trim();
    if (!product) { App.toast('제품명을 입력하세요', 'error'); return; }
    const setId = g('ps-set')?.value;
    const weights = readWeights();
    if (Object.keys(weights).length === 0) { App.toast('체별 무게를 1개 이상 입력하세요', 'error'); return; }
    S().savePSA({
      id: id === 'NEW' ? null : id,
      date: g('ps-date')?.value, product, prodDate: g('ps-proddate')?.value,
      setId, volWeight: g('ps-vol')?.value === '' ? null : parseFloat(g('ps-vol')?.value),
      weights, note: g('ps-note')?.value,
    });
    App.toast('입자도 분석이 저장되었습니다', 'success');
    openId = null; App.refreshPage();
  };
  const remove = (id) => {
    const r = S().getPSA(id); if (!r) return;
    if (!confirm(`"${r.product}" 입자도 분석을 삭제할까요?`)) return;
    S().deletePSA(id); App.toast('삭제되었습니다', 'info'); openId = null; App.refreshPage();
  };

  // ── 보고서(인쇄) ──
  const reportHtml = (r) => {
    const set = S().getPsaSet(r.setId);
    const c = set ? S().psaCompute(set.sieves, r.weights || {}) : null;
    const f = (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(r.factory) : (r.factory || '-');
    let bodyRows = '';
    if (c) {
      // 최상단 체 표시(기록용)
      const top = set.sieves[0];
      bodyRows += `<tr><td>${esc(top.name)} <span style="color:#888">(상단)</span></td><td class="mono">${top.d}</td><td class="mono">${c.topWi ? fmtNum(c.topWi, 2) : '-'}</td><td>—</td><td>—</td><td>—</td></tr>`;
      c.rows.forEach(x => {
        bodyRows += `<tr><td>${esc(x.name)}</td><td class="mono">${x.d}</td><td class="mono">${fmtNum(x.wi, 2)}</td><td class="mono">${fmtNum(x.pct, 2)}</td><td class="mono">${fmtNum(x.cumPassing, 2)}</td><td class="mono">${fmtNum(x.logDi, 4)}</td></tr>`;
      });
    }
    const res = (lbl, v, u) => `<td class="lb">${lbl}</td><td class="mono"><b>${v}</b> ${u || ''}</td>`;
    return `
      <div class="rpt-h1">입 자 도 분 석 표</div>
      <div class="rpt-sub">Particle Size Analysis (ASABE S319) · ㈜우성사료 품질보증팀</div>
      <table class="rpt-info">
        <tr><td class="lb">사업장</td><td>${esc(f)}</td><td class="lb">분석일자</td><td>${fmtDate(r.date)}</td></tr>
        <tr><td class="lb">제품명</td><td>${esc(r.product || '-')}</td><td class="lb">생산일</td><td>${fmtDate(r.prodDate) === '-' ? '-' : fmtDate(r.prodDate)}</td></tr>
        <tr><td class="lb">체 세트</td><td>${esc(set ? set.name : '-')}</td><td class="lb">용적중</td><td>${r.volWeight != null ? fmtNum(r.volWeight, 0) + ' g/L' : '-'}</td></tr>
      </table>
      <table class="rpt-tbl">
        <thead><tr><th>체(Sieve)</th><th>구경(μm)</th><th>Wi(g)</th><th>잔류 P(%)</th><th>통과누적(%)</th><th>log Di</th></tr></thead>
        <tbody>${bodyRows || '<tr><td colspan="6">데이터 없음</td></tr>'}</tbody>
      </table>
      ${c && c.valid ? `<table class="rpt-info" style="margin-top:6px"><tr>
        ${res('Dgw(기하평균입경)', fmtNum(c.DgwMm, 3), 'mm')}${res('Dgw', fmtNum(c.Dgw, 0), 'μm')}</tr><tr>
        ${res('Sgw(기하표준편차)', fmtNum(c.Sgw, 3), '')}${res('시료 합계', fmtNum(c.totalWi, 2), 'g')}</tr><tr>
        ${res('입자수(참고)', c.particles != null ? fmtNum(c.particles, 0) : '-', '개/g')}${res('표면적(참고)', c.surface != null ? fmtNum(c.surface, 1) : '-', 'cm²/g')}</tr>
      </table>` : ''}
      ${r.note ? `<div style="font-size:12px;margin-top:8px"><b>비고:</b> ${esc(r.note)}</div>` : ''}
      <div class="rpt-foot"><div>Dgw = 10^(ΣWi·log√(dᵢ₋₁·dᵢ) / ΣWi) · Sgw = 10^√(ΣWi(logDi−logDgw)² / ΣWi) · 최상단 체는 상단 구경 참조로만 사용(합계 제외).</div></div>
      <div class="rpt-sign">품질보증팀 ______________ (인)</div>`;
  };
  const report = (id) => { const r = S().getPSA(id); if (r) openReportOverlay(reportHtml(r)); };

  return { render, afterRender, open, back, save, remove, changeSet, preview, report };
})();

if (typeof window !== 'undefined') window.PSAPage = PSAPage;
