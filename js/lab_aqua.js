// ============================================================
// lab_aqua.js — 양어 · 물리검사 (부상침강/새우)
//   부상침강%·용적중·직경/길이·밀도 + 흡수율(부상침강) / 붕괴율(새우) 시간별 측정
//   규격(직경·길이·용적중 범위) 대조 → 오차 판정 + 물리검사 보고서
// ============================================================

const AquaPage = (() => {
  let openId = null;
  const S = () => LabSpeciesDB;

  const ABS_TIMES = ['1분', '5분', '30분'];     // 흡수율(부상침강)
  const DIS_TIMES = ['30분', '60분', '120분'];  // 붕괴율(새우)

  const verdictBadge = (v) => {
    const m = { OK: ['적합', 'ok'], HIGH: ['상한초과', 'high'], LOW: ['하한미달', 'low'], PASS: ['적합', 'ok'], FAIL: ['부적합', 'high'], NA: ['-', 'na'] }[v] || ['-', 'na'];
    return `<span class="verdict verdict-${m[1]}">${m[0]}</span>`;
  };

  // ── 목록 ──
  const listView = () => {
    const list = S().getAquas();
    const fail = list.filter(r => S().aquaJudge(r, r.spec).overall === 'FAIL').length;
    const rows = list.length ? list.map(r => {
      const j = S().aquaJudge(r, r.spec);
      return `<tr onclick="AquaPage.open('${r.id}')" style="cursor:pointer">
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td><span class="tag tag-gray">${esc(r.atype)}</span></td>
        <td><b>${esc(r.sample || '-')}</b></td>
        <td class="mono">${fmtNum(r.diaAvg, 2)}</td>
        <td class="mono">${fmtNum(r.lenAvg, 2)}</td>
        <td class="mono">${fmtNum(r.volWeight, 0)}</td>
        <td class="mono">${r.floatSink != null ? fmtNum(r.floatSink, 1) + '%' : '-'}</td>
        <td>${verdictBadge(j.overall)}</td>
        <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="AquaPage.report('${r.id}')">보고서</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="9" class="text-muted" style="text-align:center;padding:20px">등록된 양어 물리검사가 없습니다.</td></tr>`;

    return `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">검사 건수</div><div class="stat-value">${fmtNum(list.length, 0)}</div><div class="stat-sub">부상침강·새우</div></div>
      <div class="stat-card ${fail > 0 ? 'danger' : 'ok'}"><div class="stat-label">규격 부적합</div><div class="stat-value">${fmtNum(fail, 0)}</div><div class="stat-sub">직경·길이·용적중</div></div>
      <div class="stat-card"><div class="stat-label">부상침강사료</div><div class="stat-value">${fmtNum(list.filter(r => r.atype === '부상침강사료').length, 0)}</div><div class="stat-sub">흡수율 측정</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">양어 물리검사 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="AquaPage.open('NEW')">＋ 물리검사</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>분석일</th><th>구분</th><th>시료명</th><th>직경(mm)</th><th>길이(mm)</th><th>용적중</th><th>부상침강</th><th>규격판정</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">부상침강사료=흡수율(1·5·30분), 새우사료=붕괴율(30·60·120분)·크랙수를 측정합니다. 규격(직경·길이·용적중)은 건별 입력·대조.</div>
    </div>`;
  };

  // ── 입력/상세 ──
  const detailView = (id) => {
    const isNew = id === 'NEW';
    const r = isNew ? { date: new Date().toISOString().slice(0, 10), atype: '부상침강사료', spec: {}, absorption: {}, disintegration: {} } : S().getAqua(id);
    if (!r) return listView();
    const isShrimp = r.atype === '새우사료';
    const sp = r.spec || {};
    const typeOpts = S().AQUA_TYPES.map(t => `<option ${t === r.atype ? 'selected' : ''}>${t}</option>`).join('');
    const times = isShrimp ? DIS_TIMES : ABS_TIMES;
    const timeVals = isShrimp ? (r.disintegration || {}) : (r.absorption || {});
    const timeLabel = isShrimp ? '붕괴율(%)' : '흡수율(%)';
    const timeInputs = times.map(t => `
      <div class="form-group"><label class="form-label">${t} ${timeLabel}</label><input type="number" step="any" class="form-input" data-time="${t}" value="${timeVals[t] ?? ''}"></div>`).join('');

    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="AquaPage.back()">← 목록</button>
        <div class="card-title" style="margin:0">${isNew ? '＋ 양어 물리검사' : '' + esc(r.sample || '물리검사')}</div>
        ${isNew ? '' : `<button class="btn btn-ghost btn-sm" onclick="AquaPage.remove('${r.id}')">삭제</button>`}
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">구분</label><select class="form-input" id="aq-type" onchange="AquaPage.changeType()">${typeOpts}</select></div>
        <div class="form-group"><label class="form-label">분석일자</label><input type="date" class="form-input" id="aq-date" value="${esc(r.date || '')}"></div>
        <div class="form-group"><label class="form-label">시료명 <span class="req">*</span></label><input type="text" class="form-input" id="aq-sample" value="${esc(r.sample || '')}" placeholder="예: 강블루칩1호"></div>
        <div class="form-group"><label class="form-label">생산일</label><input type="date" class="form-input" id="aq-proddate" value="${esc(r.prodDate || '')}"></div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">EXT</label><input type="text" class="form-input" id="aq-ext" value="${esc(r.ext || '')}"></div>
        <div class="form-group"><label class="form-label">부상/침강(%)</label><input type="number" step="any" class="form-input" id="aq-floatsink" value="${r.floatSink ?? ''}"></div>
        <div class="form-group"><label class="form-label">용적중(g/L)</label><input type="number" step="any" class="form-input" id="aq-vol" value="${r.volWeight ?? ''}"></div>
        <div class="form-group"><label class="form-label">밀도(mg/㎣)</label><input type="number" step="any" class="form-input" id="aq-density" value="${r.density ?? ''}"></div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">직경 평균(mm)</label><input type="number" step="any" class="form-input" id="aq-dia" value="${r.diaAvg ?? ''}"></div>
        <div class="form-group"><label class="form-label">길이 평균(mm)</label><input type="number" step="any" class="form-input" id="aq-len" value="${r.lenAvg ?? ''}"></div>
        <div class="form-group"><label class="form-label">무게(g)</label><input type="number" step="any" class="form-input" id="aq-weight" value="${r.weight ?? ''}"></div>
        ${isShrimp ? `<div class="form-group"><label class="form-label">크랙수</label><input type="number" step="any" class="form-input" data-time="cracks" value="${(r.disintegration || {}).cracks ?? ''}"></div>` : '<div></div>'}
      </div>

      <div class="card" style="padding:12px;margin:4px 0 14px">
        <div class="card-title" style="font-size:13px;margin-bottom:8px" id="aq-time-title">${isShrimp ? '붕괴율' : '흡수율'} 시간별 측정</div>
        <div class="form-grid form-grid-4" id="aq-time-inputs">${timeInputs}</div>
      </div>

      <div class="card" style="padding:12px;margin:4px 0 14px">
        <div class="card-title" style="font-size:13px;margin-bottom:8px">규격 대조 (직경·길이·용적중 범위)</div>
        <div class="form-grid form-grid-4">
          <div class="form-group"><label class="form-label">직경 min</label><input type="number" step="any" class="form-input" id="aq-sp-diamin" value="${sp.diaMin ?? ''}"></div>
          <div class="form-group"><label class="form-label">직경 max</label><input type="number" step="any" class="form-input" id="aq-sp-diamax" value="${sp.diaMax ?? ''}"></div>
          <div class="form-group"><label class="form-label">길이 min</label><input type="number" step="any" class="form-input" id="aq-sp-lenmin" value="${sp.lenMin ?? ''}"></div>
          <div class="form-group"><label class="form-label">길이 max</label><input type="number" step="any" class="form-input" id="aq-sp-lenmax" value="${sp.lenMax ?? ''}"></div>
        </div>
        <div class="form-grid form-grid-4">
          <div class="form-group"><label class="form-label">용적중 min</label><input type="number" step="any" class="form-input" id="aq-sp-volmin" value="${sp.volMin ?? ''}"></div>
          <div class="form-group"><label class="form-label">용적중 max</label><input type="number" step="any" class="form-input" id="aq-sp-volmax" value="${sp.volMax ?? ''}"></div>
          <div></div><div></div>
        </div>
      </div>

      <div class="form-group"><label class="form-label">비고</label><textarea class="form-input" id="aq-note" rows="2">${esc(r.note || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="AquaPage.back()">취소</button>
        <button class="btn btn-primary" onclick="AquaPage.save('${isNew ? 'NEW' : r.id}')">저장</button>
      </div>
    </div>`;
  };

  const render = () => openId ? detailView(openId) : listView();

  const g = (i) => document.getElementById(i);
  const gv = (i) => g(i)?.value ?? '';
  const gn = (i) => { const v = gv(i); return v === '' ? null : parseFloat(v); };

  const changeType = () => {
    const isShrimp = gv('aq-type') === '새우사료';
    const times = isShrimp ? DIS_TIMES : ABS_TIMES;
    const label = isShrimp ? '붕괴율(%)' : '흡수율(%)';
    g('aq-time-title').textContent = `${isShrimp ? '붕괴율' : '흡수율'} 시간별 측정`;
    g('aq-time-inputs').innerHTML = times.map(t => `<div class="form-group"><label class="form-label">${t} ${label}</label><input type="number" step="any" class="form-input" data-time="${t}" value=""></div>`).join('');
  };

  const readTimes = () => {
    const obj = {};
    document.querySelectorAll('[data-time]').forEach(inp => { if (inp.value !== '') obj[inp.dataset.time] = parseFloat(inp.value); });
    return obj;
  };

  const open = (id) => { openId = id; App.refreshPage(); };
  const back = () => { openId = null; App.refreshPage(); };
  const save = (id) => {
    const sample = gv('aq-sample').trim();
    if (!sample) { App.toast('시료명을 입력하세요', 'error'); return; }
    const isShrimp = gv('aq-type') === '새우사료';
    const timeObj = readTimes();
    const spec = {
      diaMin: gn('aq-sp-diamin'), diaMax: gn('aq-sp-diamax'), lenMin: gn('aq-sp-lenmin'), lenMax: gn('aq-sp-lenmax'),
      volMin: gn('aq-sp-volmin'), volMax: gn('aq-sp-volmax'),
    };
    S().saveAqua({
      id: id === 'NEW' ? null : id,
      atype: gv('aq-type'), date: gv('aq-date'), sample, prodDate: gv('aq-proddate'),
      ext: gv('aq-ext'), floatSink: gn('aq-floatsink'), volWeight: gn('aq-vol'), density: gn('aq-density'),
      diaAvg: gn('aq-dia'), lenAvg: gn('aq-len'), weight: gn('aq-weight'),
      absorption: isShrimp ? null : timeObj, disintegration: isShrimp ? timeObj : null,
      spec, note: gv('aq-note'),
    });
    App.toast('양어 물리검사가 저장되었습니다', 'success');
    openId = null; App.refreshPage();
  };
  const remove = (id) => {
    const r = S().getAqua(id); if (!r) return;
    if (!confirm(`"${r.sample}" 물리검사를 삭제할까요?`)) return;
    S().deleteAqua(id); App.toast('삭제되었습니다', 'info'); openId = null; App.refreshPage();
  };

  // ── 보고서 ──
  const reportHtml = (r) => {
    const j = S().aquaJudge(r, r.spec);
    const sp = r.spec || {};
    const f = (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(r.factory) : (r.factory || '-');
    const isShrimp = r.atype === '새우사료';
    const times = isShrimp ? DIS_TIMES : ABS_TIMES;
    const timeVals = isShrimp ? (r.disintegration || {}) : (r.absorption || {});
    const rangeStr = (mn, mx) => (mn != null || mx != null) ? `${mn ?? ''}~${mx ?? ''}` : '-';
    const jr = (lbl, v, u, min, max, verdict) => `<tr><td class="l"><b>${lbl}</b></td><td class="mono">${v}</td><td class="mono">${rangeStr(min, max)} ${u || ''}</td><td>${vBadge(verdict)}</td></tr>`;
    const timeRows = times.map(t => `<tr><td class="l">${t}</td><td class="mono" colspan="3">${timeVals[t] != null ? fmtNum(timeVals[t], 2) + ' %' : '-'}</td></tr>`).join('');
    return `
      <div class="rpt-h1">양 어 물 리 검 사 성 적 서</div>
      <div class="rpt-sub">${esc(r.atype)} · ㈜우성사료 품질보증팀</div>
      <table class="rpt-info">
        <tr><td class="lb">사업장</td><td>${esc(f)}</td><td class="lb">분석일자</td><td>${fmtDate(r.date)}</td></tr>
        <tr><td class="lb">시료명</td><td>${esc(r.sample || '-')}</td><td class="lb">생산일</td><td>${fmtDate(r.prodDate) === '-' ? '-' : fmtDate(r.prodDate)}</td></tr>
        <tr><td class="lb">EXT</td><td>${esc(r.ext || '-')}</td><td class="lb">부상/침강</td><td>${r.floatSink != null ? fmtNum(r.floatSink, 1) + ' %' : '-'}</td></tr>
      </table>
      <table class="rpt-tbl">
        <thead><tr><th style="width:34%">측정 항목</th><th>측정값</th><th>규격</th><th>판정</th></tr></thead>
        <tbody>
          ${jr('직경(mm)', fmtNum(r.diaAvg, 2), 'mm', sp.diaMin, sp.diaMax, j.dia)}
          ${jr('길이(mm)', fmtNum(r.lenAvg, 2), 'mm', sp.lenMin, sp.lenMax, j.len)}
          ${jr('용적중(g/L)', fmtNum(r.volWeight, 0), 'g/L', sp.volMin, sp.volMax, j.vol)}
          <tr><td class="l">밀도(mg/㎣)</td><td class="mono">${fmtNum(r.density, 3)}</td><td>-</td><td>-</td></tr>
          <tr><td class="l">무게(g)</td><td class="mono">${fmtNum(r.weight, 3)}</td><td>-</td><td>-</td></tr>
        </tbody>
      </table>
      <table class="rpt-tbl">
        <thead><tr><th style="width:34%">${isShrimp ? '붕괴율' : '흡수율'} 시간별</th><th colspan="3">측정값</th></tr></thead>
        <tbody>${timeRows}${isShrimp && timeVals.cracks != null ? `<tr><td class="l">크랙수</td><td class="mono" colspan="3">${fmtNum(timeVals.cracks, 0)}</td></tr>` : ''}</tbody>
      </table>
      <div style="text-align:center;margin:14px 0"><span style="font-size:13px;color:#444">종합 판정 </span> ${vBadge(j.overall)}</div>
      ${r.note ? `<div style="font-size:12px"><b>비고:</b> ${esc(r.note)}</div>` : ''}
      <div class="rpt-sign">품질보증팀 ______________ (인)</div>`;
  };
  const report = (id) => { const r = S().getAqua(id); if (r) openReportOverlay(reportHtml(r)); };

  return { render, open, back, save, remove, changeType, report };
})();

if (typeof window !== 'undefined') window.AquaPage = AquaPage;
