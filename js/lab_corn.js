// ============================================================
// lab_corn.js — 양축 · 옥수수 BCFM 등급평가
//   모선·원산지별 Density(g/L)/BCFM(%)/정상립(%) → 점수·총점·등급 자동 + 등급 보고서
//   BCFM(%)는 정선 무게(Cleaned/FM2/BC/FM1)로도 자동 산출.
// ============================================================

const CornPage = (() => {
  let openId = null;

  const S = () => LabSpeciesDB;
  const gradeBadge = (g) => {
    const m = S().GRADE_META[g];
    if (!m) return '<span class="verdict verdict-na">미평가</span>';
    return `<span class="verdict verdict-${m.tone}">${m.label}</span>`;
  };
  const scoreCell = (s) => s == null ? '<td class="text-muted">-</td>' : `<td class="mono"><b>${s}</b></td>`;

  // ── 목록 ──
  const listView = () => {
    const list = S().getCorns();
    const g1 = list.filter(r => S().cornEvaluate(r).grade === '1').length;
    const gBad = list.filter(r => ['3', '4'].includes(S().cornEvaluate(r).grade)).length;
    const avgD = (() => { const v = list.map(r => r.density).filter(x => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; })();

    const rows = list.length ? list.map(r => {
      const ev = S().cornEvaluate(r);
      return `<tr onclick="CornPage.open('${r.id}')" style="cursor:pointer">
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td><b>${esc(r.vessel || '-')}</b></td>
        <td>${esc(r.origin || '-')}</td>
        <td class="text-muted">${r.allocQty != null ? fmtNum(r.allocQty, 0) : '-'}</td>
        <td class="mono">${fmtNum(r.density, 0)}</td>
        <td class="mono">${fmtNum(r.bcfm, 2)}</td>
        <td class="mono">${fmtNum(r.normalPct, 1)}</td>
        <td class="mono"><b>${ev.total ?? '-'}</b></td>
        <td>${gradeBadge(ev.grade)}</td>
        <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="CornPage.report('${r.id}')">보고서</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="10" class="text-muted" style="text-align:center;padding:20px">등록된 옥수수 등급평가가 없습니다. [＋ 등급평가]로 추가하세요.</td></tr>`;

    return `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">평가 건수</div><div class="stat-value">${fmtNum(list.length, 0)}</div><div class="stat-sub">모선별 옥수수</div></div>
      <div class="stat-card ok"><div class="stat-label">1등급</div><div class="stat-value">${fmtNum(g1, 0)}</div><div class="stat-sub">Excellent~Good</div></div>
      <div class="stat-card ${gBad > 0 ? 'danger' : ''}"><div class="stat-label">3·4등급</div><div class="stat-value">${fmtNum(gBad, 0)}</div><div class="stat-sub">Normal~Bad</div></div>
      <div class="stat-card"><div class="stat-label">평균 Density</div><div class="stat-value">${avgD != null ? fmtNum(avgD, 0) : '-'}<span style="font-size:13px"> g/L</span></div><div class="stat-sub">용적중 평균</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">옥수수 등급평가 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="CornPage.open('NEW')">＋ 등급평가</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>분석일</th><th>모선명</th><th>원산지</th><th>배정량(M/T)</th><th>Density(g/L)</th><th>BCFM(%)</th><th>정상립(%)</th><th>총점</th><th>등급</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">
        판정기준 — <b>Density</b>: ≥750(4) ≥720(3) ≥690(2) &lt;690(1) · <b>BCFM</b>: ≤1(4) ≤2(3) ≤4(2) &gt;4(1) · <b>정상립</b>: ≥80(4) ≥75(3) ≥70(2) &lt;70(1) · <b>총점</b>: ≥10 1등급 / ≥8 2등급 / ≥6 3등급 / ≤5 4등급
      </div>
    </div>`;
  };

  // ── 입력/상세 ──
  const detailView = (id) => {
    const isNew = id === 'NEW';
    const r = isNew ? { date: new Date().toISOString().slice(0, 10) } : S().getCorn(id);
    if (!r) return listView();
    const w = r.weights || {};
    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="CornPage.back()">← 목록</button>
        <div class="card-title" style="margin:0">${isNew ? '＋ 옥수수 등급평가' : '' + esc(r.vessel || '등급평가')}</div>
        ${isNew ? '' : `<button class="btn btn-ghost btn-sm" onclick="CornPage.remove('${r.id}')">삭제</button>`}
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">분석일자</label><input type="date" class="form-input" id="cn-date" value="${esc(r.date || '')}"></div>
        <div class="form-group"><label class="form-label">모선명 <span class="req">*</span></label><input type="text" class="form-input" id="cn-vessel" value="${esc(r.vessel || '')}" placeholder="예: PROTEAS"></div>
        <div class="form-group"><label class="form-label">원산지</label><input type="text" class="form-input" id="cn-origin" value="${esc(r.origin || '')}" placeholder="예: 브라질 / 미산"></div>
        <div class="form-group"><label class="form-label">입항일</label><input type="date" class="form-input" id="cn-indate" value="${esc(r.inDate || '')}"></div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">배정량(M/T)</label><input type="number" step="any" class="form-input" id="cn-alloc" value="${r.allocQty ?? ''}"></div>
        <div class="form-group"><label class="form-label">Density(g/L) <span class="req">*</span></label><input type="number" step="any" class="form-input" id="cn-density" value="${r.density ?? ''}" oninput="CornPage.preview()"></div>
        <div class="form-group"><label class="form-label">BCFM(%)</label><input type="number" step="any" class="form-input" id="cn-bcfm" value="${r.bcfm ?? ''}" oninput="CornPage.preview()"></div>
        <div class="form-group"><label class="form-label">정상립(%)</label><input type="number" step="any" class="form-input" id="cn-normal" value="${r.normalPct ?? ''}" oninput="CornPage.preview()"></div>
      </div>

      <div class="card" style="background:var(--bg-soft,#20242e);padding:12px;margin:4px 0 14px">
        <div class="card-title" style="font-size:13px;margin-bottom:8px">BCFM 자동산출 (정선 무게 입력 시 BCFM% 자동계산)</div>
        <div class="form-grid form-grid-4">
          <div class="form-group"><label class="form-label">Cleaned Corn(g)</label><input type="number" step="any" class="form-input" id="cn-w-cleaned" value="${w.cleaned ?? ''}" oninput="CornPage.calcBcfm()"></div>
          <div class="form-group"><label class="form-label">BC(g)</label><input type="number" step="any" class="form-input" id="cn-w-bc" value="${w.bc ?? ''}" oninput="CornPage.calcBcfm()"></div>
          <div class="form-group"><label class="form-label">FM1(g)</label><input type="number" step="any" class="form-input" id="cn-w-fm1" value="${w.fm1 ?? ''}" oninput="CornPage.calcBcfm()"></div>
          <div class="form-group"><label class="form-label">FM2(g)</label><input type="number" step="any" class="form-input" id="cn-w-fm2" value="${w.fm2 ?? ''}" oninput="CornPage.calcBcfm()"></div>
        </div>
        <div class="text-muted" id="cn-bcfm-calc" style="font-size:12px">합계·BCFM%가 여기 표시됩니다.</div>
      </div>

      <div id="cn-preview"></div>

      <div class="form-group"><label class="form-label">비고</label><textarea class="form-input" id="cn-note" rows="2" placeholder="6.7mm ON% · 외관 특이사항">${esc(r.note || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="CornPage.back()">취소</button>
        <button class="btn btn-primary" onclick="CornPage.save('${isNew ? 'NEW' : r.id}')">저장</button>
      </div>
    </div>`;
  };

  const previewHtml = (ev) => {
    if (ev.total == null) return '<div class="text-muted" style="font-size:12px">Density·BCFM·정상립을 입력하면 점수·등급이 계산됩니다.</div>';
    const m = ev.gradeMeta;
    const cell = (lbl, sc) => `<td style="text-align:center"><div class="text-muted" style="font-size:11px">${lbl}</div><div style="font-size:20px;font-weight:800">${sc ?? '-'}</div></td>`;
    return `<div class="card" style="padding:12px;margin-bottom:14px">
      <table style="width:100%"><tr>
        ${cell('Density', ev.densityScore)}${cell('BCFM', ev.bcfmScore)}${cell('정상립', ev.normalScore)}
        <td style="text-align:center;border-left:1px solid var(--border,#333)"><div class="text-muted" style="font-size:11px">총점</div><div style="font-size:20px;font-weight:800">${ev.total}</div></td>
        <td style="text-align:center"><div class="text-muted" style="font-size:11px">등급</div><div style="font-size:20px;font-weight:800;color:${m.tone === 'high' ? '#e05656' : m.tone === 'low' ? '#e0a656' : '#4fd07a'}">${m.label}</div></td>
      </tr></table>
    </div>`;
  };

  // ── 보고서(인쇄) ──
  const reportHtml = (r) => {
    const ev = S().cornEvaluate(r);
    const f = (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(r.factory) : (r.factory || '-');
    const line = (lbl, v, sc) => `<tr><td class="l"><b>${lbl}</b></td><td class="mono">${v}</td><td class="mono"><b>${sc ?? '-'}</b></td></tr>`;
    return `
      <div class="rpt-h1">옥 수 수 등 급 평 가 서</div>
      <div class="rpt-sub">Corn Grade Evaluation · ㈜우성사료 품질보증팀</div>
      <table class="rpt-info">
        <tr><td class="lb">사업장</td><td>${esc(f)}</td><td class="lb">분석일자</td><td>${fmtDate(r.date)}</td></tr>
        <tr><td class="lb">모선명</td><td>${esc(r.vessel || '-')}</td><td class="lb">원산지</td><td>${esc(r.origin || '-')}</td></tr>
        <tr><td class="lb">배정량</td><td>${r.allocQty != null ? fmtNum(r.allocQty, 0) + ' M/T' : '-'}</td><td class="lb">입항일</td><td>${fmtDate(r.inDate) === '-' ? '-' : fmtDate(r.inDate)}</td></tr>
      </table>
      <table class="rpt-tbl">
        <thead><tr><th style="width:40%">평가 항목</th><th>측정값</th><th>점수</th></tr></thead>
        <tbody>
          ${line('1) Density (g/L)', fmtNum(r.density, 0), ev.densityScore)}
          ${line('2) BCFM (%)', fmtNum(r.bcfm, 2), ev.bcfmScore)}
          ${line('3) 외형 정상립 (%)', fmtNum(r.normalPct, 1), ev.normalScore)}
          <tr><td class="l"><b>총점 (Total Score)</b></td><td class="mono">—</td><td class="mono"><b style="font-size:14px">${ev.total ?? '-'}</b></td></tr>
        </tbody>
      </table>
      <div style="text-align:center;margin:18px 0">
        <span style="font-size:13px;color:#444">최종 등급</span><br>
        <span class="rpt-badge" style="font-size:20px;padding:6px 22px;color:#fff;background:${ev.gradeMeta && ev.gradeMeta.tone === 'high' ? '#c62222' : ev.gradeMeta && ev.gradeMeta.tone === 'low' ? '#c67f22' : '#0a7d28'}">${ev.gradeMeta ? ev.gradeMeta.label : '미평가'}</span>
        <div style="font-size:11px;color:#666;margin-top:4px">${ev.gradeMeta ? ev.gradeMeta.desc : ''}</div>
      </div>
      ${r.note ? `<div style="font-size:12px"><b>비고:</b> ${esc(r.note)}</div>` : ''}
      <div class="rpt-foot">
        <div>판정기준: Density ≥750(4)/≥720(3)/≥690(2)/&lt;690(1) · BCFM ≤1(4)/≤2(3)/≤4(2)/&gt;4(1) · 정상립 ≥80(4)/≥75(3)/≥70(2)/&lt;70(1)</div>
        <div>등급: 총점 ≥10 → 1등급 · ≥8 → 2등급 · ≥6 → 3등급 · ≤5 → 4등급</div>
      </div>
      <div class="rpt-sign">품질보증팀 ______________ (인)</div>`;
  };

  const render = () => openId ? detailView(openId) : listView();
  const afterRender = () => { if (openId && openId !== 'NEW') preview(); calcBcfm(); };

  // ── 액션 ──
  const g = (i) => document.getElementById(i);
  const gv = (i) => g(i)?.value ?? '';
  const gn = (i) => { const v = gv(i); return v === '' ? null : parseFloat(v); };

  const preview = () => {
    const ev = S().cornEvaluate({ density: gn('cn-density'), bcfm: gn('cn-bcfm'), normalPct: gn('cn-normal') });
    const el = g('cn-preview'); if (el) el.innerHTML = previewHtml(ev);
  };
  const calcBcfm = () => {
    const res = S().bcfmFromWeights({ cleaned: gn('cn-w-cleaned'), bc: gn('cn-w-bc'), fm1: gn('cn-w-fm1'), fm2: gn('cn-w-fm2') });
    const el = g('cn-bcfm-calc'); if (!el) return;
    if (res.bcfm == null) { el.textContent = '합계·BCFM%가 여기 표시됩니다.'; return; }
    el.innerHTML = `합계 <b>${fmtNum(res.total, 1)}g</b> · BCFM <b style="color:#4f9cff">${fmtNum(res.bcfm, 2)}%</b> (Cleaned ${fmtNum(res.cleanedPct, 1)}% / BC ${fmtNum(res.bcPct, 2)}% / FM1 ${fmtNum(res.fm1Pct, 2)}% / FM2 ${fmtNum(res.fm2Pct, 2)}%) <button class="btn btn-ghost btn-sm" onclick="CornPage.applyBcfm(${res.bcfm})">↑ BCFM칸에 적용</button>`;
  };
  const applyBcfm = (v) => { if (g('cn-bcfm')) { g('cn-bcfm').value = Number(v).toFixed(2); preview(); } };

  const open = (id) => { openId = id; App.refreshPage(); };
  const back = () => { openId = null; App.refreshPage(); };
  const save = (id) => {
    const vessel = gv('cn-vessel').trim();
    if (!vessel) { App.toast('모선명을 입력하세요', 'error'); return; }
    const weights = {
      cleaned: gn('cn-w-cleaned'), bc: gn('cn-w-bc'), fm1: gn('cn-w-fm1'), fm2: gn('cn-w-fm2'),
    };
    const hasW = Object.values(weights).some(x => x != null);
    const rec = {
      id: id === 'NEW' ? null : id,
      date: gv('cn-date'), vessel, origin: gv('cn-origin'), inDate: gv('cn-indate'),
      allocQty: gn('cn-alloc'), density: gn('cn-density'), bcfm: gn('cn-bcfm'), normalPct: gn('cn-normal'),
      note: gv('cn-note'), weights: hasW ? weights : null,
    };
    S().saveCorn(rec);
    App.toast('옥수수 등급평가가 저장되었습니다', 'success');
    openId = null; App.refreshPage();
  };
  const remove = (id) => {
    const r = S().getCorn(id); if (!r) return;
    if (!confirm(`"${r.vessel}" 등급평가를 삭제할까요?`)) return;
    S().deleteCorn(id); App.toast('삭제되었습니다', 'info'); openId = null; App.refreshPage();
  };
  const report = (id) => {
    const r = S().getCorn(id); if (!r) return;
    openReportOverlay(reportHtml(r));
  };

  return { render, afterRender, open, back, save, remove, preview, calcBcfm, applyBcfm, report };
})();

if (typeof window !== 'undefined') window.CornPage = CornPage;
