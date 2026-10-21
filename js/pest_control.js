// ============================================================
// pest_control.js — 구서(방서)관리
//   방역업체(방역업체A 등) 월간 결과보고서를 등록·조회, 월별 쥐/벌레 포획 추이와
//   시설점검 특이사항을 한눈에 파악하는 대시보드
// ============================================================

const PestControlPage = (() => {
  let ratChart = null, insectChart = null;
  let detailId = null;   // 선택된 리포트 id (상세보기)
  let showForm = false;  // 새 리포트 등록 폼 표시 여부
  let locFilter = 'ALL'; // 위치 필터: 'ALL' | '공장' | '영업소' | <위치코드>
  let periodN = 6;       // 추세 구간(개월): 1 | 3 | 6 | 12, 0 = 전체
  let factoryView = 'sum'; // 아그리게이트 그래프: 'sum'(합계선+툴팁 위치별) | 'byFactory'(위치별 라인)
  let dateStart = '', dateEnd = ''; // 추세 직접 지정 기간(YYYY-MM). 둘 다 빈값이면 periodN(프리셋) 사용
  let pendingVisits = [];         // PDF 파싱으로 채워진 방문내역(폼에 직접 입력칸 없음 → 저장 시 사용)
  let pendingFacilityCheck = null; // PDF 파싱된 시설점검 전체 항목(신규등록/개선진행중 등)
  let resolvingIdx = null;         // 상세: 현재 개선(해결) 처리 중인 시설 특이사항 index
  let pendingIssuePhotos = [];     // 개선 처리 폼에 첨부된 사진(dataURL)
  let pendingImprovement = '';     // 개선내역 입력값(동기화 재렌더에도 유실 방지)

  // 사진 다운스케일(VOC와 동일) — 첨부 이미지를 최대변 1100px JPEG data URL로 축소
  const downscaleImage = (file, maxDim = 1100, quality = 0.7) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) {
          const s = maxDim / Math.max(width, height);
          width = Math.round(width * s); height = Math.round(height * s);
        }
        const cv = document.createElement('canvas');
        cv.width = width; cv.height = height;
        cv.getContext('2d').drawImage(img, 0, 0, width, height);
        try { resolve(cv.toDataURL('image/jpeg', quality)); } catch (_) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

  const fmt0 = (n) => fmtNum(n, 0);
  const locName = (c) => PestDB.locationName(c);
  const factoryLabel = (f) => PestDB.locationName(f);  // 하위호환 별칭
  // 등록 폼 기본 위치: 필터가 특정 위치면 그대로, 아니면 논산
  const defaultLocation = () => (locFilter && locFilter !== 'ALL' && locFilter !== '공장' && locFilter !== '영업소') ? locFilter : 'NS2';
  // PDF 파일명/본문에서 위치명을 추정(공장 4 + 영업소 6)
  const guessLocation = (text) => {
    const t = String(text || '');
    const hit = PestDB.LOCATIONS.find(l => t.includes(l.name) || t.includes(l.name.replace('공장', '').replace('영업소', '')));
    return hit ? hit.code : null;
  };

  const parseKV = (text) => {
    const out = {};
    String(text || '').split('\n').forEach(line => {
      const m = line.trim().match(/^(.+?)[:：]\s*(-?\d+(?:\.\d+)?)$/);
      if (m) out[m[1].trim()] = Number(m[2]);
    });
    return out;
  };
  const kvToLines = (obj) => Object.entries(obj || {}).map(([k, v]) => `${k}:${v}`).join('\n');

  const breakdownRows = (obj, tone) => {
    const entries = Object.entries(obj || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<tr><td colspan="2" class="text-muted" style="text-align:center;padding:12px">데이터 없음</td></tr>';
    return entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="mono" style="text-align:right"><b class="${tone || ''}">${fmt0(v)}</b></td></tr>`).join('');
  };

  // ── 월별 시계열(오름차순) 생성 + 최근 N개월 창(window) ──
  //   ALL/구분 필터는 같은 달 여러 위치 값을 합산해 월별 총계로, 단일 위치는 그 위치만.
  const buildSeries = (filter) => {
    const reports = PestDB.getReports(filter).slice().sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const aggregate = filter === 'ALL' || filter === '공장' || filter === '영업소';
    let labels, ratData, insectData;
    if (aggregate) {
      const byMonth = new Map();
      reports.forEach(r => { const c = byMonth.get(r.month) || { rat: 0, insect: 0 }; c.rat += PestDB.ratTotal(r); c.insect += PestDB.insectTotal(r); byMonth.set(r.month, c); });
      labels = [...byMonth.keys()].sort();
      ratData = labels.map(m => byMonth.get(m).rat);
      insectData = labels.map(m => byMonth.get(m).insect);
    } else {
      labels = reports.map(r => r.month);
      ratData = reports.map(r => PestDB.ratTotal(r));
      insectData = reports.map(r => PestDB.insectTotal(r));
    }
    return { labels, ratData, insectData };
  };
  const windowSeries = (s, n) => (!n || s.labels.length <= n)
    ? s
    : { labels: s.labels.slice(-n), ratData: s.ratData.slice(-n), insectData: s.insectData.slice(-n) };
  // 직접 지정 기간(YYYY-MM ~ YYYY-MM)으로 시계열 슬라이스 — 월 문자열 사전순 비교
  const rangeSeries = (s, start, end) => {
    const idxs = [];
    s.labels.forEach((m, i) => { if ((!start || m >= start) && (!end || m <= end)) idxs.push(i); });
    const pick = (arr) => idxs.map(i => arr[i]);
    return { labels: pick(s.labels), ratData: pick(s.ratData), insectData: pick(s.insectData) };
  };
  const usingRange = () => !!(dateStart || dateEnd);
  const activeWindow = (s) => usingRange() ? rangeSeries(s, dateStart, dateEnd) : windowSeries(s, periodN);
  const sumArr = (a) => a.reduce((x, y) => x + y, 0);
  const PERIOD_OPTS = [[1, '1개월'], [3, '3개월'], [6, '6개월'], [12, '1년'], [0, '전체']];
  const periodLabelOf = (n) => (PERIOD_OPTS.find(([v]) => v === n) || [0, '전체'])[1];

  // ── 위치별 시계열 매트릭스(아그리게이트 뷰): 합계 툴팁 내역 + 위치별 라인에 공용 ──
  const FACTORY_COLORS = ['#ff6b81', '#4f9cff', '#0a9d55', '#c67f22', '#8b5cf6', '#e4574c', '#0891b2', '#db2777'];
  const shortLoc = (name) => String(name).replace('공장', '').replace('영업소', '');
  const scopeLocations = (filter) => {
    const withData = (code) => PestDB.getReports(code).length > 0;
    if (filter === '공장') return PestDB.getLocations('공장').filter(l => withData(l.code));
    if (filter === '영업소') return PestDB.getLocations('영업소').filter(l => withData(l.code));
    return PestDB.LOCATIONS.filter(l => withData(l.code)); // ALL
  };
  const buildFactoryMatrix = (filter, labels) => {
    const locs = scopeLocations(filter);
    const factories = locs.map(l => {
      const rat = {}, ins = {};
      PestDB.getReports(l.code).forEach(r => { rat[r.month] = PestDB.ratTotal(r); ins[r.month] = PestDB.insectTotal(r); });
      return {
        code: l.code, name: l.name,
        ratData: labels.map(m => (m in rat ? rat[m] : null)),
        insectData: labels.map(m => (m in ins ? ins[m] : null)),
      };
    });
    return { labels, factories };
  };

  // ── 개요 화면 ──
  const renderOverview = () => {
    const filter = locFilter;
    const isGroupOrAll = filter === 'ALL' || filter === '공장' || filter === '영업소';
    const showLocCol = isGroupOrAll;
    const reports = PestDB.getReports(filter); // desc by month

    // 필터 바 (구분 탭 + 위치 선택)
    const groupTabs = [['ALL', '전체'], ['공장', '공장'], ['영업소', '영업소']].map(([v, l]) =>
      `<button class="btn btn-sm ${filter === v ? 'btn-primary' : 'btn-ghost'}" onclick="PestControlPage.setFilter('${v}')">${l}</button>`).join('');
    const locOptions = ['<option value="ALL">위치 전체</option>'].concat(PestDB.GROUPS.map(g =>
      `<optgroup label="${g}">` + PestDB.getLocations(g).map(l => `<option value="${l.code}" ${filter === l.code ? 'selected' : ''}>${esc(l.name)}</option>`).join('') + `</optgroup>`)).join('');
    const filterBar = `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="text-muted" style="font-size:12px">구분</span>${groupTabs}
        <span class="text-muted" style="font-size:12px;margin-left:6px">위치</span>
        <select class="form-input form-input-sm" style="max-width:190px" onchange="PestControlPage.setFilter(this.value)">${locOptions}</select>
        <div style="flex:1"></div>
        <button class="btn btn-primary btn-sm" onclick="PestControlPage.toggleForm()">${showForm ? '✕ 등록 취소' : '＋ 월간 리포트 등록'}</button>
      </div>
    </div>`;

    // 구분별 비교 (공장 vs 영업소) — 하단 추세 구간(프리셋 N개월/직접기간)과 연동해 그 구간만 합산.
    //   값 출처는 월간 리포트 목록과 동일(buildSeries → activeWindow). 1개월 선택 시 최근 1개월치만 표시.
    const periodDispShort = usingRange() ? `직접(${dateStart || '…'}~${dateEnd || '…'})` : periodLabelOf(periodN);
    const groupWindowStats = (g) => {
      const s = activeWindow(buildSeries(g));
      const rat = sumArr(s.ratData), insect = sumArr(s.insectData);
      const monthsInWin = new Set(s.labels);
      const reps = PestDB.getReports(g).filter(r => monthsInWin.has(r.month));
      const openFacility = reps.reduce((a, r) => a + PestDB.facilityOpenCount(r), 0);
      const locs = new Set(reps.map(r => PestDB.locOf(r)));
      return { rat, insect, total: rat + insect, openFacility, locations: locs.size };
    };
    const cmpCard = (g) => { const d = groupWindowStats(g); const active = filter === g;
      const kv = (lbl, v, col) => `<div style="min-width:0"><div class="text-muted" style="font-size:11px;white-space:nowrap">${lbl}</div><div class="mono" style="font-size:17px;font-weight:800;line-height:1.15;white-space:nowrap${col ? ';color:' + col : ''}">${fmt0(v)}</div></div>`;
      return `<div class="card" style="margin:0;cursor:pointer;${active ? 'border-color:var(--accent,#4f9cff)' : ''}" onclick="PestControlPage.setFilter('${g}')">
        <div class="section-label">${g} <span class="text-muted" style="font-size:11px;font-weight:400">· ${d.locations}개소 · ${esc(periodDispShort)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:12px;margin-top:8px">
          ${kv('쥐 포획', d.rat)}${kv('벌레 포획', d.insect)}${kv('합계', d.total)}${kv('시설 미해결', d.openFacility, d.openFacility > 0 ? '#ff6b81' : '')}
        </div>
      </div>`; };
    const groupCompare = isGroupOrAll ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-bottom:14px;align-items:stretch">${cmpCard('공장')}${cmpCard('영업소')}</div>` : '';

    // 구간별 추세: 프리셋(최근 N개월) 또는 직접 지정 기간 기준 요약 + 직전 동기간 대비 증감
    const fullSeries = buildSeries(filter);
    const rangeActive = usingRange();
    const curSeries = activeWindow(fullSeries);
    const curRat = sumArr(curSeries.ratData), curInsect = sumArr(curSeries.insectData), curTotal = curRat + curInsect;
    // 직전 동기간(현재 창과 같은 길이, 바로 앞) 대비 증감
    let prevTotal = null;
    const curLen = curSeries.labels.length;
    if (curLen) {
      const firstIdx = fullSeries.labels.indexOf(curSeries.labels[0]);
      if (firstIdx > 0) {
        const start = Math.max(0, firstIdx - curLen);
        prevTotal = sumArr(fullSeries.ratData.slice(start, firstIdx)) + sumArr(fullSeries.insectData.slice(start, firstIdx));
      }
    }
    const deltaPct = (prevTotal != null && prevTotal > 0) ? Math.round(((curTotal - prevTotal) / prevTotal) * 100) : null;
    const deltaChip = deltaPct == null ? ''
      : `<span class="verdict ${deltaPct > 0 ? 'verdict-high' : 'verdict-ok'}" title="직전 동기간 대비">${deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : ''}${Math.abs(deltaPct)}%</span>`;
    const periodDisp = rangeActive ? `직접(${dateStart || '…'}~${dateEnd || '…'})` : periodLabelOf(periodN);
    const periodTabs = PERIOD_OPTS.map(([v, l]) =>
      `<button class="btn btn-sm ${(!rangeActive && periodN === v) ? 'btn-primary' : 'btn-ghost'}" onclick="PestControlPage.setPeriod(${v})">${l}</button>`).join('');
    // 직접 기간 지정(월 단위)
    const dateControls = `
        <span class="text-muted" style="font-size:12px;margin-left:8px">직접</span>
        <input type="month" class="form-input form-input-sm" style="max-width:128px" id="pc-date-start" value="${dateStart}" onchange="PestControlPage.setDateRange()" title="시작월">
        <span class="text-muted">~</span>
        <input type="month" class="form-input form-input-sm" style="max-width:128px" id="pc-date-end" value="${dateEnd}" onchange="PestControlPage.setDateRange()" title="종료월">
        ${rangeActive ? `<button class="btn btn-ghost btn-sm" onclick="PestControlPage.clearDateRange()" title="프리셋 구간으로 복귀">✕</button>` : ''}`;
    // 합계 ↔ 위치별 그래프 전환(아그리게이트 뷰에서만)
    const viewToggle = isGroupOrAll ? `
        <span class="text-muted" style="font-size:12px;margin-left:8px">그래프</span>
        <button class="btn btn-sm ${factoryView === 'sum' ? 'btn-primary' : 'btn-ghost'}" onclick="PestControlPage.setFactoryView('sum')" title="합계선 · 마우스오버 시 위치별 내역">합계</button>
        <button class="btn btn-sm ${factoryView === 'byFactory' ? 'btn-primary' : 'btn-ghost'}" onclick="PestControlPage.setFactoryView('byFactory')" title="위치별 개별 라인">위치별</button>` : '';
    const kvInline = (lbl, v, chip) => `<div style="min-width:0"><span class="text-muted" style="font-size:11px">${lbl}</span> <b class="mono" style="font-size:15px">${fmt0(v)}</b>${chip || ''}</div>`;
    const periodBar = `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center">
        <span class="text-muted" style="font-size:12px">추세 구간</span>${periodTabs}${dateControls}${viewToggle}
        <div style="flex:1"></div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline">
          <div><span class="text-muted" style="font-size:11px">기간</span> <b>${esc(periodDisp)}</b> <span class="text-muted" style="font-size:11px">· ${curSeries.labels.length}개월</span></div>
          ${kvInline('쥐', curRat)}${kvInline('벌레', curInsect)}${kvInline('합계', curTotal, ' ' + deltaChip)}
        </div>
      </div>
    </div>`;

    // 단일 위치 선택 시: 그 위치 상세 통계 + 이상치 배너
    const s = PestDB.stats(filter);
    const spike = s.spike;
    const singleStats = !isGroupOrAll ? `<div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">등록 월수</div><div class="stat-value">${fmt0(s.months)}</div><div class="stat-sub">${esc(locName(filter))}</div></div>
      <div class="stat-card"><div class="stat-label">최근월 쥐 포획</div><div class="stat-value">${fmt0(s.latestRat)}</div><div class="stat-sub">${s.latest ? esc(s.latest.month) : '-'}</div></div>
      <div class="stat-card ${spike ? 'danger' : ''}"><div class="stat-label">최근월 벌레 포획</div><div class="stat-value">${fmt0(s.latestInsect)}</div><div class="stat-sub">${spike ? `전월 대비 ${spike.ratio}배 급증` : (s.latest ? esc(s.latest.month) : '-')}</div></div>
      <div class="stat-card"><div class="stat-label">최근월 합계</div><div class="stat-value">${fmt0(s.latestTotal)}</div><div class="stat-sub">쥐+벌레 전체</div></div>
      <div class="stat-card ${s.openFacilityAll > 0 ? 'danger' : 'ok'}"><div class="stat-label">시설점검 미해결</div><div class="stat-value">${fmt0(s.openFacilityAll)}</div><div class="stat-sub">개선 완료 시 감소</div></div>
    </div>` : '';
    const spikeBanner = (!isGroupOrAll && spike) ? `
      <div class="card alert-banner alert-danger">
        <b>이상치 경보</b> — ${esc(locName(filter))} ${esc(s.latest.month)} 벌레 포획량이 전월(${esc(spike.prevMonth)}, ${fmt0(spike.prevValue)}마리) 대비
        <b style="color:#ff6b81">${spike.ratio}배(${fmt0(spike.curValue)}마리)</b>로 급증했습니다.
      </div>` : '';

    const reportRows = reports.map(r => {
      const rat = PestDB.ratTotal(r), insect = PestDB.insectTotal(r), total = PestDB.grandTotal(r);
      const open = PestDB.facilityOpenCount(r);
      const sp = PestDB.spikeVsPrevMonth(r);
      return `<tr onclick="PestControlPage.openDetail('${esc(r.id)}')" style="cursor:pointer">
        <td class="mono"><b>${esc(r.month)}</b></td>
        ${showLocCol ? `<td><span class="tag ${PestDB.locationGroup(PestDB.locOf(r)) === '공장' ? 'tag-blue' : 'tag-gray'}">${esc(locName(PestDB.locOf(r)))}</span></td>` : ''}
        <td class="text-muted">${esc(r.periodStart)} ~ ${esc(r.periodEnd)}</td>
        <td class="mono">${(r.visits || []).length}회</td>
        <td class="mono">${fmt0(rat)}</td>
        <td class="mono">${fmt0(insect)}${sp ? ` <span class="verdict verdict-high" title="전월 대비 ${sp.ratio}배">${sp.ratio}x</span>` : ''}</td>
        <td class="mono"><b>${fmt0(total)}</b></td>
        <td>${open > 0 ? `<span class="verdict verdict-high">${open}건 미해결</span>` : '<span class="verdict verdict-ok">양호</span>'}</td>
        <td class="ellipsis" style="max-width:220px">${esc((r.note || '').slice(0, 60))}${(r.note || '').length > 60 ? '…' : ''}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="${showLocCol ? 9 : 8}" class="text-muted" style="text-align:center;padding:20px">${isGroupOrAll ? '등록된 구서관리 리포트가 없습니다.' : `${esc(locName(filter))}에 등록된 리포트가 없습니다.`}</td></tr>`;

    const win = (id, title, extraHead, body) => `
      <div class="win" data-win="${id}" style="position:static;width:auto;height:auto">
        <div class="win-head"><span class="win-title">${title}</span><span class="win-head-actions">${extraHead || ''}</span></div>
        <div class="win-body" style="height:280px">${body}</div>
      </div>`;

    return `
    ${spikeBanner}
    ${filterBar}
    ${showForm ? renderForm() : ''}
    ${groupCompare}
    ${singleStats}
    ${periodBar}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${win('pest-rat', `쥐 포획 추이 · ${esc(periodDisp)}`, '', `<div class="chart-frame" style="height:100%"><canvas id="pest-rat-chart"></canvas></div>`)}
      ${win('pest-insect', `벌레 포획 추이(로그) · ${esc(periodDisp)}`, '', `<div class="chart-frame" style="height:100%"><canvas id="pest-insect-chart"></canvas></div>`)}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="section-label">월간 리포트 목록 ${!isGroupOrAll ? `<span class="tag tag-blue" style="font-size:11px">${esc(locName(filter))}</span>` : ''}</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>월</th>${showLocCol ? '<th>위치</th>' : ''}<th>기간</th><th>방문</th><th>쥐 포획</th><th>벌레 포획</th><th>합계</th><th>시설점검</th><th>특이사항</th></tr></thead>
          <tbody>${reportRows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:8px">행 클릭 시 항목별 상세(쥐/벌레 종류별 마릿수·종합의견·시설점검)를 봅니다. 상단 구분(공장/영업소)·위치로 필터링·비교하세요.</div>
    </div>`;
  };

  const renderForm = () => {
    const today = new Date().toISOString().slice(0, 7);
    return `
    <div class="card" style="margin-top:14px">
      <div class="section-label">＋ 월간 구서관리 리포트 등록</div>

      <div class="card" style="background:var(--bg-surface);border-style:dashed;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <label class="btn btn-primary btn-sm" style="cursor:pointer;margin:0">
            PDF 업로드 · 자동 분석
            <input type="file" accept="application/pdf" id="pc-pdf-file" style="display:none" onchange="PestControlPage.onPdfSelected(this)">
          </label>
          <span class="text-muted" style="font-size:12px">방역업체 월간 결과보고서 PDF를 올리면 기간·방문내역·포획현황·시설점검을 자동으로 채웁니다. 아래 값은 등록 전 확인·수정하세요.</span>
        </div>
        <div id="pc-pdf-status" style="margin-top:8px"></div>
      </div>

      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label">위치 <span class="req">*</span></label>
          <select class="form-input" id="pc-location">
            ${PestDB.GROUPS.map(g => `<optgroup label="${g}">` + PestDB.getLocations(g).map(l => `<option value="${l.code}" ${l.code === defaultLocation() ? 'selected' : ''}>${esc(l.name)}</option>`).join('') + `</optgroup>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">대상 월 <span class="req">*</span></label><input type="month" class="form-input" id="pc-month" value="${today}"></div>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label">기간 시작</label><input type="date" class="form-input" id="pc-start"></div>
        <div class="form-group"><label class="form-label">기간 종료</label><input type="date" class="form-input" id="pc-end"></div>
      </div>
      <div class="form-group"><label class="form-label">출처</label><input type="text" class="form-input" id="pc-source" placeholder="예: 방역업체A 논산계룡지사 결과보고서"></div>
      <div class="form-group">
        <label class="form-label">쥐류 포획 <span class="text-muted" style="font-weight:400">(한 줄에 하나, "종류:마릿수" 형식 — 예: 집쥐:3)</span></label>
        <textarea class="form-input" id="pc-rat" rows="4" placeholder="쥐:1&#10;집쥐:2&#10;시궁쥐:1"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">벌레류 포획 <span class="text-muted" style="font-weight:400">(한 줄에 하나, "종류:마릿수" 형식)</span></label>
        <textarea class="form-input" id="pc-insect" rows="4" placeholder="파리:10&#10;날파리:200&#10;블루스톰포획:800"></textarea>
      </div>
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label">시설점검 신규등록(건)</label><input type="number" class="form-input" id="pc-fac-new" value="0"></div>
        <div class="form-group"><label class="form-label">시설점검 개선미진행(건)</label><input type="number" class="form-input" id="pc-fac-open" value="0"></div>
      </div>
      <div class="form-group">
        <label class="form-label">시설점검 특이사항 <span class="text-muted" style="font-weight:400">(한 줄에 하나)</span></label>
        <textarea class="form-input" id="pc-issues" rows="2" placeholder="출입문 개폐 관리 미흡"></textarea>
      </div>
      <div class="form-group"><label class="form-label">비고 / 종합의견</label><textarea class="form-input" id="pc-note" rows="3" placeholder="이번 달 주요 관찰사항, 조치내역 요약"></textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="PestControlPage.toggleForm()">취소</button>
        <button class="btn btn-primary" onclick="PestControlPage.save()">등록</button>
      </div>
    </div>`;
  };

  // ── 상세 화면 ──
  const renderDetail = (r) => {
    const rat = PestDB.ratTotal(r), insect = PestDB.insectTotal(r), total = PestDB.grandTotal(r);
    const fc = r.facilityCheck || {};
    const facCells = ['신규등록', '개선진행중', '개선예정', '개선완료', '개선미진행', '개선불가', '문제없음']
      .filter(k => fc[k] != null)
      .map(k => `<div><span class="text-muted" style="font-size:11px">${k}</span><div class="mono">${fmt0(fc[k])}</div></div>`).join('');
    const visitRows = (r.visits || []).map(v => `<tr><td>${esc(v.date)}</td><td class="mono">${esc(v.time || '-')}</td><td>${esc(v.type || '-')}</td></tr>`).join('')
      || '<tr><td colspan="3" class="text-muted" style="text-align:center">방문 기록 없음</td></tr>';
    const issues = r.facilityIssues || [];
    const openN = PestDB.facilityOpenCount(r), doneN = PestDB.facilityResolvedCount(r);
    const issuePhotoPreview = pendingIssuePhotos.length
      ? pendingIssuePhotos.map((uri, i) => `<div style="position:relative;width:74px;height:74px"><img src="${uri}" style="width:74px;height:74px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"><button type="button" onclick="PestControlPage.removeIssuePhoto(${i})" title="삭제" style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:0;background:#c62222;color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0">✕</button></div>`).join('')
      : '<span class="text-muted" style="font-size:12px">첨부된 사진 없음</span>';
    const issuesHtml = issues.length ? issues.map((text, idx) => {
      const res = PestDB.issueResolution(r, idx);
      const head = `<div style="display:flex;align-items:flex-start;gap:8px">
          <span class="verdict ${res ? 'verdict-ok' : 'verdict-high'}" style="flex-shrink:0">${res ? '양호' : '미해결'}</span>
          <div style="flex:1;font-size:13px;line-height:1.5">${esc(text)}</div>
        </div>`;
      let body = '';
      if (res) {
        const photos = (res.photos || []).map((src, pi) => `<img src="${src}" onclick="PestControlPage.viewIssuePhoto('${esc(r.id)}',${idx},${pi})" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:zoom-in">`).join('');
        body = `<div style="margin-top:8px;padding:10px;background:rgba(10,157,85,0.06);border:1px solid rgba(10,157,85,0.25);border-radius:8px">
            <div style="font-size:12px"><b style="color:#0a9d55">개선내역</b> <span class="text-muted">· ${esc(res.by || '담당자')} · ${esc((res.resolvedAt || '').slice(0, 10))}</span></div>
            <div style="font-size:13px;line-height:1.5;white-space:pre-wrap;margin-top:4px">${esc(res.improvement || '-')}</div>
            ${photos ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${photos}</div>` : ''}
            <div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="PestControlPage.unresolve('${esc(r.id)}',${idx})">미해결로 되돌리기</button></div>
          </div>`;
      } else if (resolvingIdx === idx) {
        body = `<div style="margin-top:8px;padding:10px;background:var(--bg-surface);border:1px solid var(--border);border-radius:8px">
            <label class="form-label" style="font-size:12px">개선내역 <span class="req">*</span></label>
            <textarea class="form-input" id="pc-improve" rows="2" oninput="PestControlPage.setImprove(this.value)" placeholder="예: 출입문 하단 고무판·틈새 브러쉬 부착하여 해충 유입 차단 완료">${esc(pendingImprovement)}</textarea>
            <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">개선 사진 첨부<input type="file" accept="image/*" capture="environment" multiple style="display:none" onchange="PestControlPage.onIssuePhotos(this)"></label>
              <span class="text-muted" style="font-size:11px">개선 전/후 사진을 남기면 이력으로 보존됩니다.</span>
            </div>
            <div id="pc-issue-photos" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${issuePhotoPreview}</div>
            <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
              <button class="btn btn-ghost btn-sm" onclick="PestControlPage.cancelResolve()">취소</button>
              <button class="btn btn-primary btn-sm" onclick="PestControlPage.saveResolve('${esc(r.id)}',${idx})">개선 완료 저장</button>
            </div>
          </div>`;
      } else {
        body = `<div style="margin-top:6px"><button class="btn btn-primary btn-sm" onclick="PestControlPage.startResolve(${idx})">개선 완료 처리 →</button></div>`;
      }
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">${head}${body}</div>`;
    }).join('') : '<div class="text-muted" style="font-size:13px;padding:8px 0">특이사항 없음</div>';

    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="PestControlPage.backToList()">← 목록으로</button>
        <div class="section-label" style="margin:0">구서관리 상세 — ${esc(r.month)}</div>
        <button class="btn btn-ghost btn-sm" onclick="PestControlPage.remove('${esc(r.id)}')" title="삭제">삭제</button>
      </div>
      <div class="detail-head" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:8px 0">
        <div><span class="text-muted" style="font-size:11px">위치</span><div><span class="tag ${PestDB.locationGroup(PestDB.locOf(r)) === '공장' ? 'tag-blue' : 'tag-gray'}">${esc(locName(PestDB.locOf(r)))}</span></div></div>
        <div><span class="text-muted" style="font-size:11px">기간</span><div>${esc(r.periodStart)} ~ ${esc(r.periodEnd)}</div></div>
        <div><span class="text-muted" style="font-size:11px">쥐 포획 합계</span><div class="mono"><b>${fmt0(rat)}</b></div></div>
        <div><span class="text-muted" style="font-size:11px">벌레 포획 합계</span><div class="mono"><b>${fmt0(insect)}</b></div></div>
        <div><span class="text-muted" style="font-size:11px">전체 합계</span><div class="mono"><b>${fmt0(total)}</b></div></div>
      </div>
      <div class="text-muted" style="font-size:12px;margin-bottom:10px">출처: ${esc(r.source || '-')}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div class="section-label" style="font-size:13px">쥐류 종류별</div>
          <table class="data-table compact"><thead><tr><th>종류</th><th style="text-align:right">마릿수</th></tr></thead><tbody>${breakdownRows(r.ratBreakdown, 'v-high')}</tbody></table>
        </div>
        <div>
          <div class="section-label" style="font-size:13px">벌레류 종류별</div>
          <table class="data-table compact"><thead><tr><th>종류</th><th style="text-align:right">마릿수</th></tr></thead><tbody>${breakdownRows(r.insectBreakdown)}</tbody></table>
        </div>
      </div>

      <hr class="divider">
      <div class="section-label" style="font-size:13px">시설점검 현황
        ${issues.length ? `<span class="verdict ${openN > 0 ? 'verdict-high' : 'verdict-ok'}" style="margin-left:6px">미해결 ${openN}</span><span class="verdict verdict-ok" style="margin-left:4px">개선완료 ${doneN}</span>` : ''}
      </div>
      <div class="detail-head" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:10px;margin-bottom:10px">${facCells || '<span class="text-muted">데이터 없음</span>'}</div>
      <div style="margin:0 0 14px 0">${issuesHtml}</div>
      ${issues.length ? '<div class="text-muted" style="font-size:11px;margin:-6px 0 14px">미해결 항목을 「개선 완료 처리」하면 개선내역·사진이 이력으로 남고 상단 시설 미해결 건수에서 즉시 제외됩니다.</div>' : ''}

      <div class="section-label" style="font-size:13px">서비스 방문 내역</div>
      <table class="data-table compact" style="margin-bottom:14px"><thead><tr><th>방문일</th><th>시간</th><th>구분</th></tr></thead><tbody>${visitRows}</tbody></table>

      <div class="section-label" style="font-size:13px">비고 / 종합의견</div>
      <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px">${esc(r.note || '-')}</div>
    </div>`;
  };

  const render = () => {
    if (detailId) {
      const r = PestDB.getReport(detailId);
      if (!r) { detailId = null; return renderOverview(); }
      return renderDetail(r);
    }
    return renderOverview();
  };

  // ── 차트 ──
  const drawCharts = () => {
    if (typeof Chart === 'undefined') return;
    const filter = locFilter;
    const aggregate = filter === 'ALL' || filter === '공장' || filter === '영업소';
    // 선택 구간(프리셋 N개월 또는 직접 지정 기간)으로 잘라낸 월별 합계 시계열
    const base = activeWindow(buildSeries(filter));
    const labels = base.labels;
    // 아그리게이트 뷰에서만 위치별 매트릭스(합계 툴팁 내역 + 위치별 라인 공용) — base 라벨에 정렬
    const matrix = aggregate ? buildFactoryMatrix(filter, labels) : null;
    const byFactory = aggregate && factoryView === 'byFactory' && matrix && matrix.factories.length > 0;

    // 공용 차트 빌더 — key: 'ratData'|'insectData'
    const build = (canvasId, prevChart, key, totalData, totalColor, totalFill, totalLabel, logScale) => {
      if (prevChart) prevChart.destroy();
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;
      let datasets, tooltip;
      if (byFactory) {
        // 위치별 개별 라인
        datasets = matrix.factories.map((f, i) => {
          const c = FACTORY_COLORS[i % FACTORY_COLORS.length];
          return { label: shortLoc(f.name), data: f[key], borderColor: c, backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, borderWidth: 2, spanGaps: true, fill: false };
        });
        tooltip = { filter: (it) => it.parsed.y != null };  // 데이터 없는 위치는 툴팁에서 숨김
      } else {
        // 합계선 + 마우스오버 시 위치별 내역
        datasets = [{ label: totalLabel, data: totalData, borderColor: totalColor, backgroundColor: totalFill, tension: 0.25, pointRadius: 3, fill: true }];
        tooltip = matrix ? {
          callbacks: {
            afterBody: (items) => {
              if (!items || !items.length) return [];
              const idx = items[0].dataIndex;
              const parts = matrix.factories
                .map(f => ({ n: shortLoc(f.name), v: f[key][idx] }))
                .filter(p => p.v != null && p.v > 0)
                .sort((a, b) => b.v - a.v);
              return parts.length ? ['── 위치별 ──'].concat(parts.map(p => `${p.n}  ${fmt0(p.v)}`)) : [];
            },
          },
        } : {};
      }
      return new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: true, labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } },
            tooltip,
          },
          scales: {
            x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: logScale
              ? { type: 'logarithmic', ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
              : { beginAtZero: true, ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          },
        },
      });
    };

    ratChart = build('pest-rat-chart', ratChart, 'ratData', base.ratData, '#ff6b81', 'rgba(255,107,129,0.12)', '쥐 포획(마리)', false);
    insectChart = build('pest-insect-chart', insectChart, 'insectData', base.insectData, '#4f9cff', 'rgba(79,156,255,0.12)', '벌레 포획(마리)', true);
  };

  const toggleForm = () => {
    showForm = !showForm;
    if (showForm) { pendingVisits = []; pendingFacilityCheck = null; }
    App.refreshPage();
  };

  const save = () => {
    const g = (id) => document.getElementById(id)?.value || '';
    const month = g('pc-month');
    if (!month) { App.toast('대상 월을 선택하세요', 'error'); return; }
    const rat = parseKV(document.getElementById('pc-rat')?.value);
    const insect = parseKV(document.getElementById('pc-insect')?.value);
    if (Object.keys(rat).length === 0 && Object.keys(insect).length === 0) {
      App.toast('쥐류 또는 벌레류 포획 데이터를 1개 이상 입력하세요', 'warning'); return;
    }
    const issues = String(document.getElementById('pc-issues')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const rep = PestDB.addReport({
      month,
      location: g('pc-location') || defaultLocation(),
      periodStart: g('pc-start') || (month + '-01'),
      periodEnd: g('pc-end'),
      visits: pendingVisits,
      ratBreakdown: rat,
      insectBreakdown: insect,
      facilityCheck: pendingFacilityCheck || { 신규등록: Number(g('pc-fac-new')) || 0, 개선미진행: Number(g('pc-fac-open')) || 0 },
      facilityIssues: issues,
      note: g('pc-note'),
      source: g('pc-source'),
      manual: true,
    });
    App.toast(`구서관리 리포트 등록됨 · ${locName(PestDB.locOf(rep))} ${rep.month}`, 'success');
    showForm = false;
    pendingVisits = [];
    pendingFacilityCheck = null;
    App.refreshPage();
  };

  // ── PDF 업로드 자동 분석 ──
  const onPdfSelected = async (inputEl) => {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    const statusEl = document.getElementById('pc-pdf-status');
    if (statusEl) statusEl.innerHTML = '<span class="text-muted">분석 중… (표지·표 구조 인식에 몇 초 걸릴 수 있습니다)</span>';
    try {
      if (typeof PestPdfParser === 'undefined') throw new Error('PDF 분석 모듈을 불러오지 못했습니다');
      const buf = await file.arrayBuffer();
      const parsed = await PestPdfParser.parse(buf);

      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
      // 우선순위: PDF 본문(표지 제목) 인식 > 파일명 키워드 (공장 4 + 영업소 6)
      const factoryGuess = guessLocation(parsed.factoryGuess) || guessLocation(file.name);
      if (factoryGuess) set('pc-location', factoryGuess);
      set('pc-month', parsed.month);
      set('pc-start', parsed.periodStart);
      set('pc-end', parsed.periodEnd);
      set('pc-source', file.name);
      const ratEl = document.getElementById('pc-rat');
      if (ratEl && Object.keys(parsed.ratBreakdown).length) ratEl.value = kvToLines(parsed.ratBreakdown);
      const insectEl = document.getElementById('pc-insect');
      if (insectEl && Object.keys(parsed.insectBreakdown).length) insectEl.value = kvToLines(parsed.insectBreakdown);
      set('pc-fac-new', parsed.facilityCheck?.신규등록 ?? 0);
      set('pc-fac-open', parsed.facilityCheck?.개선미진행 ?? 0);
      set('pc-note', parsed.note);
      pendingVisits = parsed.visits || [];
      pendingFacilityCheck = Object.keys(parsed.facilityCheck || {}).length ? parsed.facilityCheck : null;

      const ratTotal = Object.values(parsed.ratBreakdown).reduce((a, b) => a + b, 0);
      const insectTotal = Object.values(parsed.insectBreakdown).reduce((a, b) => a + b, 0);
      const warnHtml = parsed.warnings.length
        ? `<div style="margin-top:6px">${parsed.warnings.map(w => `<div class="text-muted" style="font-size:11px">${esc(w)}</div>`).join('')}</div>` : '';
      if (statusEl) statusEl.innerHTML = `
        <span class="verdict verdict-ok">분석 완료</span>
        <span style="font-size:12px;margin-left:6px">${factoryGuess ? esc(locName(factoryGuess)) + ' · ' : ''}${esc(parsed.month || '월 미인식')} · 방문 ${parsed.visits.length}회 · 쥐 ${fmt0(ratTotal)}마리 · 벌레 ${fmt0(insectTotal)}마리</span>
        ${!factoryGuess ? '<div class="text-muted" style="font-size:11px">위치명을 자동 인식하지 못했습니다. 위 「위치」 선택을 확인하세요.</div>' : ''}
        ${warnHtml}`;
      App.toast('PDF 분석 완료 — 아래 값을 확인 후 등록하세요', 'success');
    } catch (e) {
      console.error('[PestControl] PDF parse failed', e);
      if (statusEl) statusEl.innerHTML = `<span class="verdict verdict-high">✕ 분석 실패</span> <span class="text-muted" style="font-size:12px">${esc(e.message || '알 수 없는 오류')} — 값을 직접 입력해 주세요.</span>`;
      App.toast('PDF 분석에 실패했습니다. 직접 입력해 주세요', 'error');
    }
  };

  const setFilter = (v) => { locFilter = v; detailId = null; App.refreshPage(); };
  const setPeriod = (n) => { periodN = n; dateStart = ''; dateEnd = ''; App.refreshPage(); };  // 프리셋 선택 시 직접기간 해제
  const setFactoryView = (v) => { factoryView = v; App.refreshPage(); };
  const setDateRange = () => {
    dateStart = document.getElementById('pc-date-start')?.value || '';
    dateEnd = document.getElementById('pc-date-end')?.value || '';
    App.refreshPage();
  };
  const clearDateRange = () => { dateStart = ''; dateEnd = ''; App.refreshPage(); };
  const openDetail = (id) => { detailId = id; resolvingIdx = null; pendingIssuePhotos = []; App.refreshPage(); };
  const backToList = () => { detailId = null; resolvingIdx = null; pendingIssuePhotos = []; App.refreshPage(); };
  const remove = (id) => {
    const r = PestDB.getReport(id);
    if (!r) return;
    if (!confirm(`${r.month} 구서관리 리포트를 삭제할까요?`)) return;
    PestDB.deleteReport(id);
    App.toast('삭제되었습니다', 'info');
    detailId = null;
    App.refreshPage();
  };

  // ── 시설점검 개선(해결) 처리 ──
  const startResolve = (idx) => { resolvingIdx = idx; pendingIssuePhotos = []; pendingImprovement = ''; App.refreshPage(); };
  const cancelResolve = () => { resolvingIdx = null; pendingIssuePhotos = []; pendingImprovement = ''; App.refreshPage(); };
  const setImprove = (v) => { pendingImprovement = v; };  // 입력값 보존(재렌더 대비, 재렌더 트리거 안 함)
  const renderIssuePhotoPreview = () => {
    const el = document.getElementById('pc-issue-photos');
    if (!el) return;
    el.innerHTML = pendingIssuePhotos.length
      ? pendingIssuePhotos.map((uri, i) => `<div style="position:relative;width:74px;height:74px"><img src="${uri}" style="width:74px;height:74px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"><button type="button" onclick="PestControlPage.removeIssuePhoto(${i})" title="삭제" style="position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;border:0;background:#c62222;color:#fff;cursor:pointer;font-size:11px;line-height:1;padding:0">✕</button></div>`).join('')
      : '<span class="text-muted" style="font-size:12px">첨부된 사진 없음</span>';
  };
  const onIssuePhotos = async (input) => {
    const files = Array.from(input.files || []);
    for (const f of files) { const uri = await downscaleImage(f); if (uri) pendingIssuePhotos.push(uri); }
    input.value = '';
    renderIssuePhotoPreview();   // 부분 갱신(전체 재렌더 시 입력 중인 개선내역 텍스트 유실 방지)
  };
  const removeIssuePhoto = (i) => { pendingIssuePhotos.splice(i, 1); renderIssuePhotoPreview(); };
  const saveResolve = (id, idx) => {
    const improvement = String((document.getElementById('pc-improve')?.value ?? pendingImprovement) || '').trim();
    if (!improvement) { App.toast('개선내역을 입력하세요', 'warning'); return; }
    const by = (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : '';
    PestDB.resolveIssue(id, idx, { improvement, photos: pendingIssuePhotos.slice(), by });
    App.toast('시설점검을 개선 완료(양호)로 처리했습니다', 'success');
    resolvingIdx = null; pendingIssuePhotos = []; pendingImprovement = '';
    App.refreshPage();
  };
  const unresolve = (id, idx) => {
    if (!confirm('이 항목을 다시 미해결 상태로 되돌릴까요? 저장된 개선내역·사진은 삭제됩니다.')) return;
    PestDB.unresolveIssue(id, idx);
    App.toast('미해결 상태로 되돌렸습니다', 'info');
    App.refreshPage();
  };
  const viewIssuePhoto = (id, idx, pi) => {
    const rep = PestDB.getReport(id);
    const res = rep && PestDB.issueResolution(rep, idx);
    const src = res && res.photos && res.photos[pi];
    if (!src) return;
    let ov = document.getElementById('pest-photo-lightbox');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'pest-photo-lightbox';
      ov.className = 'no-print';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
      ov.onclick = () => ov.remove();
      document.body.appendChild(ov);
    }
    ov.innerHTML = `<img src="${src}" style="max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px">`;
  };

  const afterRender = () => { if (!detailId) drawCharts(); };

  return { render, afterRender, toggleForm, save, openDetail, backToList, remove, onPdfSelected, setFilter, setPeriod, setFactoryView, setDateRange, clearDateRange,
    startResolve, cancelResolve, setImprove, onIssuePhotos, removeIssuePhoto, saveResolve, unresolve, viewIssuePhoto };
})();
