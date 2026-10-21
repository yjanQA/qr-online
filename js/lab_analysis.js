// ============================================================
// analysis.js — 원료/제품 분석 이력 (목록 → 코드별 상세·추세)
//   makeAnalysisPage(kind) 로 RawAnalysisPage / ProdAnalysisPage 생성
// ============================================================

function makeAnalysisPage(kind) {
  const isRaw = kind === 'raw';
  const PAGE = isRaw ? 'RawAnalysisPage' : 'ProdAnalysisPage';
  let chart = null;
  let detailItem = null;

  // ── 기간 필터 상태 ──
  let dateFrom = '';
  let dateTo = '';
  let listQuery = '';
  let catFilter = 'ALL';   // 제품 분석대장 축종 필터: ALL | 양축 | 양어 | 반려 | 기타 (원료는 미사용)
  let compactCols = false; // 열 표시: false = 분석항목 관리에 등록된 항목 전체 · true = 값 있는 항목만
  let groupSel = [];       // 선택한 분석항목 그룹(일반성분·아미노산·지방산 …). 빈 배열 = 전체 그룹
  let lastReport = null;
  let _dateInit = false;   // 최초 진입 시 기본 기간 자동설정 여부
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const inRange = (d) => {
    const s = String(d || '').slice(0, 10);
    if (dateFrom && s < dateFrom) return false;
    if (dateTo && s > dateTo) return false;
    return true;
  };
  const filteredRecs = (code) => LabDB.getRecordsByCode(kind, code).filter(r => inRange(r.date));
  const periodText = () => (dateFrom || dateTo) ? `${dateFrom || '처음'} ~ ${dateTo || '오늘'}` : '전체 기간';
  const round2 = (v) => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 100) / 100 : v;
  const sortByDate = (recs) => recs.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // ── 통계 ──
  const stat = (arr) => {
    const n = arr.length; if (!n) return { n: 0, mean: null, min: null, max: null, std: null };
    const mean = arr.reduce((a, c) => a + c, 0) / n;
    const min = Math.min(...arr), max = Math.max(...arr);
    const std = Math.sqrt(arr.reduce((a, c) => a + (c - mean) ** 2, 0) / n);
    return { n, mean, min, max, std };
  };
  const slope = (vals) => {
    const n = vals.length; if (n < 2) return 0;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    vals.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x; });
    const d = n * sxx - sx * sx; return d ? (n * sxy - sx * sy) / d : 0;
  };
  const trendMark = (vals, std) => {
    if (vals.length < 3) return '─ 데이터부족';
    const sl = slope(vals), thr = (std || 0) * 0.1;
    return sl > thr ? '▲ 상승' : sl < -thr ? '▼ 하강' : '─ 안정';
  };
  // 필터된 레코드로 항목별 분석 통계
  const buildStats = (code, recs) => {
    return applicableItems().map(it => {
      const seq = sortByDate(recs).filter(r => typeof (r.vals && r.vals[it.key]) === 'number');
      if (!seq.length) return null;
      const vals = seq.map(r => r.vals[it.key]);
      const s = stat(vals);
      const sp = LabDB.resolveSpec(kind, code, it.key);
      const dev = seq.filter(r => { const v = LabDB.judge(kind, code, it.key, r.vals[it.key]); return v === 'HIGH' || v === 'LOW'; }).length;
      const latest = vals[vals.length - 1];
      return { it, ...s, spec: sp, dev, devRate: s.n ? dev / s.n * 100 : 0, trend: trendMark(vals, s.std), latest, latestVerdict: LabDB.judge(kind, code, it.key, latest) };
    }).filter(Boolean);
  };
  // ── 분석대장 열 구성 ──
  //   '분석항목 관리'에 등록된 항목 중 이 대장(원료/제품)의 적용대상에 해당하는 항목을 모두 열로 노출한다.
  //   (기존에는 값이 입력된 항목만 나와서, 새로 등록한 항목이 대장에 보이지 않았음)
  //   compactCols = true 면 값이 있는 항목만 추려 좁게 본다.
  const applicableItems = () => LabDB.getItems(kind);
  const hasData = (it, recs) => recs.some(r => typeof (r.vals && r.vals[it.key]) === 'number');
  const groupOf = (it) => it.group || '기타';
  const itemGroups = () => [...new Set(applicableItems().map(groupOf))];
  const columnItemsOf = (recs) => {
    let items = applicableItems();
    if (groupSel.length) items = items.filter(it => groupSel.includes(groupOf(it)));
    return compactCols ? items.filter(it => hasData(it, recs)) : items;
  };
  const setCompactCols = (v) => { compactCols = !!v; App.refreshPage(); };
  // 그룹 칩 토글(다중선택) — 아무것도 선택 안 하면 전체 그룹
  const toggleGroup = (g) => {
    groupSel = groupSel.includes(g) ? groupSel.filter(x => x !== g) : groupSel.concat(g);
    App.refreshPage();
  };
  const clearGroups = () => { groupSel = []; App.refreshPage(); };

  // 전체 분석 레코드(평면) — 기간·검색 필터 적용
  const listData = () => {
    const q = String(listQuery || '').toLowerCase().trim();
    let recs = LabDB.getRecords(kind).filter(r => inRange(r.date));
    // 공장별 구분: 상단 공장 선택 시 해당 공장 데이터만(공장 미지정 레코드는 항상 표시)
    const fac = (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
    if (fac && fac !== 'ALL') recs = recs.filter(r => !r.factory || r.factory === fac);
    // 제품 분석대장: 축종(양축/양어/반려/기타) 필터 — 제품코드 기준 분류
    if (!isRaw && catFilter !== 'ALL')
      recs = recs.filter(r => (r.category || LabDB.productCategory(r.code)) === catFilter);
    if (q) recs = recs.filter(r =>
      String(r.code || '').toLowerCase().includes(q) ||
      String(r.name || '').toLowerCase().includes(q) ||
      String(r.id || '').toLowerCase().includes(q) ||
      String((isRaw ? r.supplier : r.formula) || '').toLowerCase().includes(q));
    return recs;
  };

  const LIST_CAP = 800;
  // 표시 셀 수 상한 — 분석항목이 200여 개라 열을 모두 펼치면 셀이 폭증해 렌더가 수 초씩 걸린다.
  //   열 수에 따라 표시 행을 자동으로 줄여 응답성을 유지한다(전체 데이터는 엑셀로 제공).
  const CELL_BUDGET = 22000;
  const rowCapFor = (colCount) => Math.max(60, Math.min(LIST_CAP, Math.floor(CELL_BUDGET / Math.max(1, colCount))));
  // 평면 레코드 테이블(항목별 열 전개 · 접수번호 틀고정)
  const listTableHtml = (recs) => {
    const present = columnItemsOf(recs);
    const cap = rowCapFor(present.length + 8);   // +8 = 고정열(접수번호·일자·공장·코드·명칭·공급처·비고·기상)
    const shown = recs.slice(0, cap);
    const headItems = present.map(it =>
      `<th style="text-align:center">${esc(it.label)}${it.unit ? `<br><span style="font-weight:400;font-size:10px;color:var(--text-muted)">${esc(it.unit)}</span>` : ''}</th>`).join('');
    const rows = shown.length ? shown.map(r => {
      const valCells = present.map(it => {
        const v = r.vals && r.vals[it.key];
        if (typeof v !== 'number') return '<td class="text-muted" style="text-align:center">-</td>';
        const m = VERDICT_META[LabDB.judge(kind, r.code, it.key, v)];
        return `<td class="mono" style="text-align:center"><b class="v-${m.cls}">${fmtNum(v)}</b></td>`;
      }).join('');
      const lastEd = (r.editHistory && r.editHistory.length) ? r.editHistory[r.editHistory.length - 1] : null;
      const editedTag = lastEd ? ` <span class="tag tag-gray" style="font-size:9px" title="수정 ${r.editHistory.length}회 · 최근 ${fmtDate(lastEd.ts)}${lastEd.by ? ' ' + esc(lastEd.by) : ''}${lastEd.reason ? ' · 사유: ' + esc(lastEd.reason) : ''}">수정됨</span>` : '';
      return `<tr>
        <td class="mono col-fix">
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-primary btn-xs" onclick="${PAGE}.editRec('${esc(r.id)}')" title="분석값 수정" style="padding:2px 8px;flex-shrink:0">수정</button>
            <button class="btn btn-outline-primary btn-xs" onclick="LabCOA.open('${esc(r.id)}')" title="이 분석 성적서 발행" style="padding:2px 8px;flex-shrink:0">성적서</button>
            <span>${esc(r.id)}</span>
          </div>
        </td>
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td class="text-muted" style="white-space:nowrap">${({ NS: '논산', GS: '경산', AS: '아산', HQ: '본사' }[r.factory] || r.factory || '-')}</td>
        <td class="mono">${esc(r.code)}</td>
        <td class="ellipsis" style="max-width:170px"><a onclick="${PAGE}.open('${esc(r.code)}')" style="cursor:pointer;color:#5aa2ff" title="이 원료 추세 보기">${esc(r.name || '-')}</a></td>
        <td class="text-muted ellipsis" style="max-width:120px">${esc((isRaw ? r.supplier : r.formula) || '-')}</td>
        ${valCells}
        <td class="text-muted ellipsis" style="max-width:120px">${esc(r.note || '')}${editedTag}</td>
        <td class="text-muted" style="white-space:nowrap" title="분석 당시 기상(내부참고)">${esc(fmtWeatherStamp(r.weather, { emptyText: '-' }))}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="99" class="text-muted" style="text-align:center;padding:24px">조건에 맞는 분석 데이터가 없습니다</td></tr>`;
    const capNote = recs.length > shown.length ? `<div class="text-muted" style="font-size:12px;margin-top:8px">※ 화면에는 상위 <b>${shown.length}</b>건만 표시됩니다${present.length > 40 ? ` (분석항목 <b>${present.length}</b>열을 펼쳐 표시 행을 줄였습니다 — 그룹을 선택하면 더 많은 행을 볼 수 있습니다)` : ''}. 전체 ${recs.length}건은 <b>엑셀 다운로드</b>로 받으세요.</div>` : '';
    return `<div class="xtbl-wrap">
      <table class="xtbl">
        <thead><tr>
          <th class="col-fix">작업 · 접수번호</th><th>접수일</th><th>공장</th><th>코드</th><th>명칭</th><th>${isRaw ? '공급처' : '배합비'}</th>
          ${headItems}
          <th>비고</th><th>날씨(분석시)</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${capNote}`;
  };

  // 제품 축종 필터 탭 (제품 분석대장 전용) — 클릭 시 즉시 필터
  const CAT_TABS = [['ALL', '전체'], ['양축', '양축'], ['양어', '양어'], ['반려', '반려'], ['기타', '기타']];
  const catTabBar = () => isRaw ? '' : `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;align-items:center">
      <span class="text-muted" style="font-size:12px;margin-right:2px">축종</span>
      ${CAT_TABS.map(([v, l]) => `<button class="btn btn-sm ${catFilter === v ? 'btn-primary' : 'btn-ghost'}" onclick="${PAGE}.setCategory('${v}')">${l}</button>`).join('')}
    </div>`;

  const listView = () => {
    const recs = listData();
    const total = LabDB.getRecords(kind).length;
    return `
    <div class="card" style="margin-bottom:14px">
      ${catTabBar()}
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div class="form-group" style="margin:0"><label class="form-label">시작일</label><input type="date" class="form-input form-input-sm" id="an-from" value="${dateFrom}"></div>
        <div class="form-group" style="margin:0"><label class="form-label">종료일</label><input type="date" class="form-input form-input-sm" id="an-to" value="${dateTo}"></div>
        <button class="btn btn-primary btn-sm" onclick="${PAGE}.applyRange()">기간 조회</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('30')">최근30일</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('60')">최근60일</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('90')">최근90일</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('ytd')">올해</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('all')">전체</button>
        <div class="form-group" style="margin:0;flex:1;min-width:180px"><label class="form-label">검색</label><input type="text" class="form-input form-input-sm" id="an-search" placeholder="코드·명칭·접수번호·${isRaw ? '공급처' : '배합비'}" value="${esc(listQuery || '')}" oninput="${PAGE}.onSearch(this.value)"></div>
        <button class="btn btn-sm" style="background:#7c5cff;color:#fff" onclick="${PAGE}.reportList()">분석 리포트</button>
        <button class="btn btn-sm" style="background:#2e9e5b;color:#fff" onclick="${PAGE}.exportRawList()">분석대장 엑셀</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px">
        <span class="text-muted" style="font-size:12px">분석항목 열</span>
        <button class="btn btn-sm ${!compactCols ? 'btn-primary' : 'btn-ghost'}" onclick="${PAGE}.setCompactCols(false)"
          title="분석항목 관리에 등록된 ${isRaw ? '원료' : '제품'} 적용항목을 모두 표시(값 없으면 '-')">전체 항목</button>
        <button class="btn btn-sm ${compactCols ? 'btn-primary' : 'btn-ghost'}" onclick="${PAGE}.setCompactCols(true)"
          title="측정값이 입력된 항목만 표시">값 있는 항목만</button>
        <span class="text-muted" style="font-size:11px;margin-left:4px">표시 열 <b>${columnItemsOf(recs).length}</b> / 등록 ${applicableItems().length}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:8px">
        <span class="text-muted" style="font-size:12px">항목 그룹</span>
        <button class="btn btn-sm ${!groupSel.length ? 'btn-primary' : 'btn-ghost'}" onclick="${PAGE}.clearGroups()" title="모든 그룹 표시">전체</button>
        ${itemGroups().map(g => {
          const n = applicableItems().filter(i => groupOf(i) === g).length;
          const on = groupSel.includes(g);
          return `<button class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" onclick="${PAGE}.toggleGroup('${esc(g)}')" title="${esc(g)} 항목 ${n}개">${esc(g)} <span style="opacity:.65">${n}</span></button>`;
        }).join('')}
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:8px">${periodText()}${!isRaw && catFilter !== 'ALL' ? ` · <b>${esc(catFilter)}</b>` : ''} · 조회 <b id="an-count">${recs.length}</b>건 (전체 ${total}건) · 명칭 클릭 시 해당 ${isRaw ? '원료' : '제품'} 추세 상세</div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">${isRaw ? '원료' : '제품'} 분석대장 <span class="text-muted" style="font-weight:400">(전체 리스트)</span></div>
        <span class="text-muted" style="font-size:12px">← → 가로 스크롤 · 접수번호 고정</span>
      </div>
      <div id="an-table">${listTableHtml(recs)}</div>
    </div>`;
  };

  const detailView = (code) => {
    const allRecs = LabDB.getRecordsByCode(kind, code);
    if (!allRecs.length) return listView('');
    const recs = allRecs.filter(r => inRange(r.date));
    const name = (recs[0] || allRecs[0]).name || LabDB.nameOf(kind, code);
    const items = applicableItems();
    const stats = buildStats(code, recs);

    // 항목별 통계·최신판정 (선택 기간 기준)
    const itemRows = stats.map(st => {
      const m = VERDICT_META[st.latestVerdict];
      const sp = st.spec;
      const range = (sp.min != null || sp.max != null) ? esc(fmtSpec(sp.min, sp.max)) : '<span class="text-muted">기준없음</span>';
      const srcTag = sp.source === 'manual' ? '<span class="tag tag-blue">규격</span>' : sp.source === 'stat' ? '<span class="tag tag-gray">통계</span>' : '';
      const active = detailItem === st.it.key ? 'row-active' : '';
      return `<tr class="${active}" onclick="${PAGE}.showItem('${esc(code)}','${st.it.key}')" style="cursor:pointer">
        <td>${st.it.label} <span class="text-muted">${st.it.unit}</span></td>
        <td class="mono"><b class="v-${m.cls}">${fmtNum(st.latest)}</b></td>
        <td>${st.latestVerdict === 'NA' ? '' : `<span class="verdict verdict-${m.cls}">${m.label}</span>`}</td>
        <td class="mono text-muted">${range} ${srcTag}</td>
        <td class="mono">${st.dev > 0 ? `<span class="v-high">${st.dev}</span>` : '0'}/${st.n}</td>
      </tr>`;
    }).join('');

    // 전체 접수 이력 — 분석값을 항목별 열로 전개(가로 스크롤 · 접수번호 틀고정)
    const presentItems = columnItemsOf(recs);
    const histHeadItems = presentItems.map(it =>
      `<th style="text-align:center">${esc(it.label)}${it.unit ? `<br><span style="font-weight:400;font-size:10px;color:var(--text-muted)">${esc(it.unit)}</span>` : ''}</th>`).join('');
    const histRows = recs.map(r => {
      const valCells = presentItems.map(it => {
        const v = r.vals && r.vals[it.key];
        if (typeof v !== 'number') return '<td class="text-muted" style="text-align:center">-</td>';
        const m = VERDICT_META[LabDB.judge(kind, code, it.key, v)];
        return `<td class="mono" style="text-align:center"><b class="v-${m.cls}">${fmtNum(v)}</b></td>`;
      }).join('');
      return `<tr>
        <td class="mono col-fix">
          <div style="display:flex;align-items:center;gap:6px">
            <button class="btn btn-primary btn-xs" onclick="${PAGE}.editRec('${esc(r.id)}')" title="분석값 수정" style="padding:2px 8px;flex-shrink:0">수정</button>
            <button class="btn btn-outline-primary btn-xs" onclick="LabCOA.open('${esc(r.id)}')" title="이 분석 성적서 발행" style="padding:2px 8px;flex-shrink:0">성적서</button>
            <span>${esc(r.id)}</span>
          </div>
        </td>
        <td class="text-muted">${fmtDate(r.date)}</td>
        ${isRaw ? `<td>${esc(r.supplier || '-')}</td>` : `<td class="mono">${esc(r.formula || '-')}</td>`}
        ${valCells}
        <td class="text-muted ellipsis" style="max-width:140px">${esc(r.note || '')}${(r.editHistory && r.editHistory.length) ? (() => { const h = r.editHistory[r.editHistory.length - 1]; return ` <span class="tag tag-gray" style="font-size:9px" title="수정 ${r.editHistory.length}회 · 최근 ${fmtDate(h.ts)}${h.by ? ' ' + esc(h.by) : ''}${h.reason ? ' · 사유: ' + esc(h.reason) : ''}">수정됨</span>`; })() : ''}</td>
      </tr>`;
    }).join('');

    if (!detailItem || !presentItems.some(it => it.key === detailItem)) {
      // 추세 차트 기본 선택은 '값이 있는 항목' 우선 (열 전체 노출 시 빈 항목이 잡히지 않도록)
      const withData = items.filter(it => hasData(it, recs));
      detailItem = (withData[0] || presentItems[0] || items[0] || {}).key || null;
    }

    return `
    <div class="detail-head">
      <button class="btn btn-ghost btn-sm" onclick="${PAGE}.back()">← 목록</button>
      <div>
        <div class="detail-title mono">${esc(code)}</div>
        <div class="detail-sub">${esc(name)} · 분석 ${recs.length}건</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div class="form-group" style="margin:0"><label class="form-label">시작일</label><input type="date" class="form-input form-input-sm" id="an-from" value="${dateFrom}"></div>
        <div class="form-group" style="margin:0"><label class="form-label">종료일</label><input type="date" class="form-input form-input-sm" id="an-to" value="${dateTo}"></div>
        <button class="btn btn-primary btn-sm" onclick="${PAGE}.applyRange()">기간 조회</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('30')">최근30일</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('60')">최근60일</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('90')">최근90일</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('ytd')">올해</button>
        <button class="btn btn-ghost btn-sm" onclick="${PAGE}.preset('all')">전체</button>
        <div style="flex:1"></div>
        <button class="btn btn-sm" style="background:#7c5cff;color:#fff" onclick="${PAGE}.report()">분석 리포트</button>
        <button class="btn btn-sm" style="background:#2e9e5b;color:#fff" onclick="${PAGE}.exportRaw()">Rawdata 엑셀</button>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:8px">${periodText()} · 조회 <b>${recs.length}</b>건${allRecs.length !== recs.length ? ` (전체 ${allRecs.length}건 중)` : ''}</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div class="card-title">항목별 통계·판정 <span class="text-muted" style="font-weight:400">(기간 내)</span></div></div>
        <div class="table-wrap" style="max-height:360px;overflow:auto">
          <table class="data-table compact">
            <thead><tr><th>항목</th><th>최신값</th><th>판정</th><th>규격범위</th><th>이탈/n</th></tr></thead>
            <tbody>${itemRows || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:16px">기간 내 분석 데이터 없음</td></tr>'}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><span id="detail-item-label">${LabDB.itemLabel(detailItem)}</span> 추세</div></div>
        <div style="height:300px;position:relative"><canvas id="detail-chart"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div class="card-title">접수 이력 (${recs.length}건)</div>
        <span class="text-muted" style="font-size:12px">← → 가로 스크롤 · 접수번호 고정</span>
      </div>
      <div class="xtbl-wrap">
        <table class="xtbl">
          <thead><tr>
            <th class="col-fix">작업 · 접수번호</th><th>접수일</th><th>${isRaw ? '공급처' : '배합비'}</th>
            ${histHeadItems}
            <th>비고</th>
          </tr></thead>
          <tbody>${histRows}</tbody>
        </table>
      </div>
    </div>`;
  };

  const drawDetailChart = (code) => {
    const canvas = document.getElementById('detail-chart');
    if (!canvas || typeof Chart === 'undefined' || !detailItem) return;
    const trend = LabDB.getTrend(kind, code, detailItem).filter(t => inRange(t.date));
    const labels = trend.map(t => fmtDate(t.date));
    const data = trend.map(t => t.value);
    const sp = LabDB.resolveSpec(kind, code, detailItem);
    if (chart) { chart.destroy(); chart = null; }
    const ds = [{
      label: `${LabDB.itemLabel(detailItem)} (${LabDB.itemUnit(detailItem)})`,
      data, borderColor: '#4f9cff', backgroundColor: 'rgba(79,156,255,0.12)',
      tension: 0.25, pointRadius: 3, fill: true,
    }];
    if (sp.max != null) ds.push({ label: '상한', data: labels.map(() => sp.max), borderColor: '#ff5c7a', borderDash: [6, 4], pointRadius: 0 });
    if (sp.min != null) ds.push({ label: '하한', data: labels.map(() => sp.min), borderColor: '#ffb020', borderDash: [6, 4], pointRadius: 0 });
    chart = new Chart(canvas, {
      type: 'line', data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  };

  // ── 상태 & 라우팅 ──
  let openCode = null;
  // 최초 진입 시 기본 기간 = 최신 분석일 기준 최근 90일 (없으면 미설정)
  const ensureDefaultRange = () => {
    if (_dateInit) return;
    _dateInit = true;
    const anchor = anchorDate();
    if (anchor) { const a = new Date(anchor + 'T00:00:00'); a.setDate(a.getDate() - 90); dateFrom = a.toISOString().slice(0, 10); dateTo = anchor; }
  };

  const render = (code) => {
    if (code) { openCode = code; detailItem = null; }
    ensureDefaultRange();
    return openCode ? detailView(openCode) : listView();
  };
  const afterRender = () => { if (openCode) drawDetailChart(openCode); };

  const open = (code) => { openCode = code; detailItem = null; App.refreshPage(); };
  const back = () => { openCode = null; App.refreshPage(); };
  const showItem = (code, item) => { detailItem = item; App.navigate(isRaw ? 'raw' : 'prod'); };

  // ── 평면 리스트 검색(포커스 유지: 표·카운트만 부분 갱신) ──
  const onSearch = (v) => {
    listQuery = v;
    const recs = listData();
    const tbl = document.getElementById('an-table');
    const cnt = document.getElementById('an-count');
    if (tbl) tbl.innerHTML = listTableHtml(recs);
    if (cnt) cnt.textContent = recs.length;
  };
  // ── 제품 축종 필터 선택 (양축/양어/반려) ──
  const setCategory = (c) => { catFilter = c; App.refreshPage(); };

  // ── 분석값 수정 (수정이력 기록) ──
  const esc2 = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const ensureEditStyle = () => {
    if (document.getElementById('anedit-style')) return;
    const st = document.createElement('style'); st.id = 'anedit-style';
    st.textContent = `
    .aned-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;}
    .aned-box{background:var(--bg-card,#1a1d27);border:1px solid var(--border,#2a2f3d);border-radius:12px;width:min(760px,96vw);max-height:92vh;display:flex;flex-direction:column;box-shadow:0 12px 48px rgba(0,0,0,.5);}
    .aned-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border,#2a2f3d);}
    .aned-body{overflow:auto;padding:14px 18px;}
    .aned-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}
    .aned-fld label{display:block;font-size:11px;color:var(--text-muted,#8892a6);margin-bottom:3px;}
    .aned-fld input{width:100%;background:var(--bg-input,#151821);border:1px solid var(--border,#2a2f3d);border-radius:6px;color:var(--text-primary,#e5e9f0);font-size:13px;padding:6px 8px;box-sizing:border-box;}
    .aned-fld input:focus{border-color:var(--accent,#4f9cff);outline:none;}
    .aned-vwrap{display:flex;align-items:center;gap:6px;}
    .aned-vwrap .aned-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;white-space:nowrap;}
    .aned-hi{color:#ff6b81;background:rgba(255,107,129,.12);} .aned-lo{color:#ffb020;background:rgba(255,176,32,.12);} .aned-ok{color:#48c78e;background:rgba(72,199,142,.12);}
    .aned-sec{font-size:12px;font-weight:700;color:var(--text-secondary,#c7d0e0);margin:14px 0 6px;}
    .aned-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid var(--border,#2a2f3d);}
    .aned-hist td{font-size:11px;padding:4px 6px;border-bottom:1px solid var(--border,#2a2f3d);}
    .aned-hist .from{color:#ff8fa3;text-decoration:line-through;} .aned-hist .to{color:#48c78e;font-weight:700;}`;
    document.head.appendChild(st);
  };
  const closeEdit = () => { document.getElementById('aned-overlay')?.remove(); };
  const editRec = (id) => {
    const r = LabDB.getRecordById(id);
    if (!r) { App.toast('레코드를 찾을 수 없습니다', 'error'); return; }
    ensureEditStyle(); closeEdit();
    // 이 레코드가 값을 가진 항목(vals·nirVals) 편집 대상
    const valKeys = Object.keys(r.vals || {});
    const nirKeys = Object.keys(r.nirVals || {}).filter(k => !valKeys.includes(k));
    const valFld = (key, v, isNir) => {
      const it = LabDB.getItem(key);
      return `<div class="aned-fld">
        <label>${esc(it ? it.label : key)}${it && it.unit ? ` <span style="color:var(--text-muted)">${esc(it.unit)}</span>` : ''}${isNir ? ' <span style="color:#5aa2ff">NIR</span>' : ''}</label>
        <div class="aned-vwrap">
          <input type="number" step="any" value="${v == null ? '' : v}" data-vk="${esc(key)}" data-nir="${isNir ? 1 : 0}" oninput="${PAGE}.judgeCell(this,'${esc(r.code)}','${esc(key)}')">
          <span class="aned-badge" data-badge="${esc(key)}${isNir ? '-nir' : ''}"></span>
        </div>
      </div>`;
    };
    const metaRaw = isRaw
      ? `<div class="aned-fld"><label>공급처</label><input id="aned-supplier" value="${esc2(r.supplier || '')}"></div>
         <div class="aned-fld"><label>원산지/모선명</label><input id="aned-origin" value="${esc2(r.origin || '')}"></div>`
      : `<div class="aned-fld"><label>배합비</label><input id="aned-formula" value="${esc2(r.formula || '')}"></div>
         <div class="aned-fld"><label>생산일</label><input type="date" id="aned-prodDate" value="${esc2((r.prodDate || '').slice(0, 10))}"></div>`;
    const hist = (r.editHistory || []).slice().reverse();
    const histHtml = hist.length ? `
      <div class="aned-sec">수정 이력 (${hist.length}회)</div>
      <table class="aned-hist" style="width:100%;border-collapse:collapse">
        <tbody>${hist.map(h => `<tr>
          <td style="white-space:nowrap;color:var(--text-muted)">${fmtDate(h.ts)}${h.by ? ' · ' + esc(h.by) : ''}</td>
          <td>${h.reason ? `<div style="color:#ffb020;margin-bottom:2px">사유: ${esc(h.reason)}</div>` : ''}${h.changes.map(c => `${esc(c.label)}: <span class="from">${esc(String(c.from))}</span> → <span class="to">${esc(String(c.to))}</span>`).join('<br>')}</td>
        </tr>`).join('')}</tbody>
      </table>` : '';
    const ov = document.createElement('div'); ov.className = 'aned-overlay'; ov.id = 'aned-overlay';
    ov.innerHTML = `
      <div class="aned-box">
        <div class="aned-head">
          <div><b>분석값 수정</b> <span class="text-muted" style="font-size:12px">${esc(r.id)} · ${esc(r.code)} · ${esc(r.name || '')}</span></div>
          <button class="btn btn-ghost btn-sm" onclick="${PAGE}.closeEdit()">✕ 닫기</button>
        </div>
        <div class="aned-body">
          <div class="aned-sec">기본 정보</div>
          <div class="aned-grid">
            <div class="aned-fld"><label>시료명</label><input id="aned-name" value="${esc2(r.name || '')}"></div>
            <div class="aned-fld"><label>접수일</label><input type="date" id="aned-date" value="${esc2((r.date || '').slice(0, 10))}"></div>
            ${metaRaw}
            <div class="aned-fld" style="grid-column:1/-1"><label>비고</label><input id="aned-note" value="${esc2(r.note || '')}"></div>
          </div>
          <div class="aned-sec">분석 항목값 <span class="text-muted" style="font-weight:400">(값 수정 시 규격 판정이 갱신됩니다)</span></div>
          <div class="aned-grid">
            ${valKeys.map(k => valFld(k, r.vals[k], false)).join('')}
            ${nirKeys.map(k => valFld(k, r.nirVals[k], true)).join('')}
          </div>
          ${histHtml}
        </div>
        <div class="aned-foot">
          <div style="display:flex;gap:8px;flex:1;min-width:0">
            <div class="aned-fld" style="width:130px;flex-shrink:0"><label>수정자 <span class="text-muted" style="font-size:10px">· 계정 자동</span></label><input id="aned-by" readonly title="로그인 계정이 자동 기록됩니다" style="background:var(--bg-soft);cursor:not-allowed" value="${esc2((typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : (r.by || ''))}"></div>
            <div class="aned-fld" style="flex:1;min-width:0"><label>수정사유 <span style="color:#e05252">*</span></label><input id="aned-reason" placeholder="예: 재분석 결과 반영, 오입력 정정"></div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="btn btn-ghost btn-sm" onclick="${PAGE}.closeEdit()">취소</button>
            <button class="btn btn-primary btn-sm" onclick="${PAGE}.saveEdit('${esc(r.id)}')">저장 (이력 기록)</button>
          </div>
        </div>
      </div>`;
    ov.addEventListener('click', e => { if (e.target === ov) closeEdit(); });
    document.body.appendChild(ov);
    // 초기 판정 배지
    ov.querySelectorAll('input[data-vk]').forEach(inp => judgeCell(inp, r.code, inp.dataset.vk));
  };
  const judgeCell = (inp, code, key) => {
    const isNir = inp.dataset.nir === '1';
    const badge = document.querySelector(`[data-badge="${key}${isNir ? '-nir' : ''}"]`);
    if (!badge) return;
    const v = inp.value === '' ? null : Number(inp.value);
    if (v == null || Number.isNaN(v)) { badge.textContent = ''; badge.className = 'aned-badge'; return; }
    const verd = LabDB.judge(kind, code, key, v);
    const map = { HIGH: ['상한초과', 'aned-hi'], LOW: ['하한미달', 'aned-lo'], OK: ['적합', 'aned-ok'], NA: ['', ''] };
    const [label, cls] = map[verd] || ['', ''];
    badge.textContent = label; badge.className = 'aned-badge ' + cls;
  };
  const saveEdit = (id) => {
    const g = (el) => document.getElementById(el);
    const patch = { vals: {}, nirVals: {} };
    document.querySelectorAll('#aned-overlay input[data-vk]').forEach(inp => {
      const bag = inp.dataset.nir === '1' ? patch.nirVals : patch.vals;
      bag[inp.dataset.vk] = inp.value;
    });
    patch.name = g('aned-name')?.value ?? '';
    patch.note = g('aned-note')?.value ?? '';
    patch.date = g('aned-date')?.value ?? '';
    if (isRaw) { patch.supplier = g('aned-supplier')?.value ?? ''; patch.origin = g('aned-origin')?.value ?? ''; }
    else { patch.formula = g('aned-formula')?.value ?? ''; patch.prodDate = g('aned-prodDate')?.value ?? ''; }
    const by = ((typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : '') || (g('aned-by')?.value || '').trim();
    const byEmail = (typeof Auth !== 'undefined' && Auth.currentEmail) ? Auth.currentEmail() : '';
    const reason = (g('aned-reason')?.value || '').trim();
    if (!reason) { App.toast('수정사유를 입력하세요 — 이력 관리를 위해 필수입니다', 'warning'); g('aned-reason')?.focus(); return; }
    const before = LabDB.getRecordById(id);
    const res = LabDB.updateRecord(id, patch, by, reason, byEmail);
    const changed = res && res.editHistory && before && (res.editHistory.length > (before.editHistory || []).length);
    closeEdit();
    App.toast(changed ? '수정되었습니다 · 사유·이력 기록됨' : '변경사항이 없습니다', changed ? 'success' : 'info');
    App.refreshPage();
  };

  // ── 기간 필터 액션 ──
  const applyRange = () => {
    dateFrom = document.getElementById('an-from')?.value || '';
    dateTo = document.getElementById('an-to')?.value || '';
    if (dateFrom && dateTo && dateFrom > dateTo) { App.toast('시작일이 종료일보다 늦습니다', 'error'); return; }
    App.refreshPage();
  };
  // 프리셋 기준일 = 가장 최근 분석일(데이터 기준). 데이터 없으면 오늘.
  const anchorDate = () => {
    const all = LabDB.getRecords(kind);
    let mx = '';
    all.forEach(r => { const d = String(r.date || '').slice(0, 10); if (d > mx) mx = d; });
    return mx || new Date().toISOString().slice(0, 10);
  };
  const preset = (p) => {
    const iso = (d) => d.toISOString().slice(0, 10);
    const anchor = anchorDate();
    const a = new Date(anchor + 'T00:00:00');
    if (p === 'all') { dateFrom = ''; dateTo = ''; }
    else if (p === 'ytd') { dateFrom = anchor.slice(0, 4) + '-01-01'; dateTo = anchor; }
    else { const d = new Date(a); d.setDate(d.getDate() - parseInt(p, 10)); dateFrom = iso(d); dateTo = anchor; }
    App.refreshPage();
  };

  // ── 분석 리포트 ──
  const reportHtml = (code, name, recs, stats, insights) => {
    const totalDev = stats.reduce((a, s) => a + s.dev, 0);
    const rows = stats.map(s => `<tr>
      <td class="l"><b>${esc(s.it.label)}</b> <span style="color:#888">${esc(s.it.unit)}</span></td>
      <td class="mono">${s.n}</td>
      <td class="mono">${fmtNum(s.mean)}</td>
      <td class="mono">${fmtNum(s.min)}</td>
      <td class="mono">${fmtNum(s.max)}</td>
      <td class="mono">${fmtNum(s.std)}</td>
      <td class="mono">${(s.spec.min != null || s.spec.max != null) ? esc(fmtSpec(s.spec.min, s.spec.max)) : '-'}</td>
      <td class="mono">${s.dev > 0 ? `<span class="rpt-bad">${s.dev} (${s.devRate.toFixed(0)}%)</span>` : '0'}</td>
      <td>${esc(s.trend)}</td>
    </tr>`).join('');
    return `
      <div class="rpt-h1">분 석 데 이 터 A I 리 포 트</div>
      <div class="rpt-sub">${isRaw ? '원료' : '제품'} 품질 분석 · ㈜우성사료 품질보증팀</div>
      <table class="rpt-info">
        <tr><td class="lb">${isRaw ? '원료' : '제품'}</td><td>${esc(name)} <span style="color:#888">(${esc(code)})</span></td><td class="lb">분석기간</td><td>${periodText()}</td></tr>
        <tr><td class="lb">분석건수</td><td>${recs.length}건</td><td class="lb">규격이탈</td><td>${totalDev}건</td></tr>
      </table>
      <table class="rpt-tbl">
        <thead><tr><th>분석항목</th><th>n</th><th>평균</th><th>최소</th><th>최대</th><th>표준편차</th><th>규격</th><th>이탈</th><th>추세</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9">데이터 없음</td></tr>'}</tbody>
      </table>
      <div style="margin-top:14px"><b>분석 코멘트</b>
        <ul style="margin:6px 0 0;padding-left:18px">${insights.map(i => `<li style="margin:3px 0">${i}</li>`).join('')}</ul>
      </div>
      <div class="rpt-foot"><div>· 통계는 선택 기간 내 완료 분석건 기준 · 추세는 시계열 선형회귀 기울기(±표준편차 10% 기준) · 이탈은 등록/통계 규격 대비 상·하한 초과.</div></div>
      <div class="rpt-sign">품질보증팀 ______________ (인)</div>`;
  };

  const report = () => {
    const code = openCode; if (!code) return;
    const recs = filteredRecs(code);
    if (!recs.length) { App.toast('해당 기간에 분석 데이터가 없습니다', 'warning'); return; }
    const name = recs[0].name || LabDB.nameOf(kind, code);
    const stats = buildStats(code, recs);
    const insights = [];
    const worst = stats.slice().sort((a, b) => b.devRate - a.devRate)[0];
    if (worst && worst.dev > 0) insights.push(`규격이탈이 가장 잦은 항목은 <b>${esc(worst.it.label)}</b> — ${worst.dev}/${worst.n}건(${worst.devRate.toFixed(1)}%). 원료·공정 점검을 권고합니다.`);
    else insights.push('선택 기간 내 전 항목이 규격을 만족했습니다.');
    const up = stats.filter(s => /상승/.test(s.trend)).map(s => s.it.label);
    const down = stats.filter(s => /하강/.test(s.trend)).map(s => s.it.label);
    if (up.length) insights.push(`상승 추세 항목: ${up.join(', ')}.`);
    if (down.length) insights.push(`하강 추세 항목: ${down.join(', ')}.`);
    const volat = stats.slice().filter(s => s.std != null).sort((a, b) => b.std - a.std).slice(0, 3).map(s => s.it.label);
    if (volat.length) insights.push(`변동성(표준편차) 상위: ${volat.join(', ')} — 관리 안정성 점검 대상.`);
    insights.push(`총 ${recs.length}건 분석 · 규격이탈 ${stats.reduce((a, s) => a + s.dev, 0)}건.`);
    lastReport = { code, name, recs, stats };
    const excelBtn = `<button class="coa-btn-print" style="background:#2e9e5b" onclick="${PAGE}.exportReportExcel()">리포트 엑셀</button>`;
    openReportOverlay(reportHtml(code, name, recs, stats, insights), excelBtn);
  };

  // ── 엑셀 다운로드 ──
  const wCols = (r) => { const w = r.weather || {}; const ci = (window.Weather && Weather.codeInfo) ? Weather.codeInfo(w.code) : { label: '' }; return [w.temp != null ? w.temp : '', w.humidity != null ? w.humidity : '', w.temp != null ? ci.label : '']; };
  const rawSheet = (code, recs) => {
    const present = columnItemsOf(recs);
    const header = ['접수번호', '접수일', (isRaw ? '공급처' : '배합비'), ...present.map(it => `${it.label}(${it.unit})`), '비고', '온도(°C)', '습도(%)', '날씨'];
    const body = sortByDate(recs).map(r => [
      r.id, fmtDate(r.date), isRaw ? (r.supplier || '') : (r.formula || ''),
      ...present.map(it => (typeof (r.vals && r.vals[it.key]) === 'number') ? r.vals[it.key] : ''), r.note || '', ...wCols(r),
    ]);
    return [header, ...body];
  };
  const fileTag = () => `${dateFrom || '전체'}_${dateTo || todayStr()}`;
  const exportRaw = () => {
    const code = openCode; const recs = filteredRecs(code);
    if (!recs.length) { App.toast('해당 기간에 데이터가 없습니다', 'warning'); return; }
    const name = (recs[0].name || code).replace(/[\\/:*?"<>|]/g, '');
    WSXlsx.download(`분석대장_${name}_${fileTag()}.xlsx`, [{ name: 'Rawdata', rows: rawSheet(code, recs) }]);
    App.toast('Rawdata 엑셀을 다운로드했습니다', 'success');
  };
  const exportReportExcel = () => {
    if (!lastReport) return;
    const { code, name, recs, stats } = lastReport;
    const summary = [
      ['우성사료 분석 데이터 분석 리포트'],
      [(isRaw ? '원료' : '제품'), `${name} (${code})`],
      ['분석기간', periodText()],
      ['분석건수', recs.length],
      ['규격이탈 합계', stats.reduce((a, s) => a + s.dev, 0)],
      [],
      ['분석항목', 'n', '평균', '최소', '최대', '표준편차', '규격하한', '규격상한', '이탈건수', '이탈률(%)', '추세'],
      ...stats.map(s => [`${s.it.label}(${s.it.unit})`, s.n, round2(s.mean), round2(s.min), round2(s.max), round2(s.std),
        s.spec.min ?? '', s.spec.max ?? '', s.dev, round2(s.devRate), s.trend]),
    ];
    WSXlsx.download(`분석리포트_${(name || code).replace(/[\\/:*?"<>|]/g, '')}_${fileTag()}.xlsx`,
      [{ name: '요약', rows: summary }, { name: 'Rawdata', rows: rawSheet(code, recs) }]);
    App.toast('분석 리포트 엑셀을 다운로드했습니다', 'success');
  };

  // ── 전체 분석대장(평면) 통계·리포트·엑셀 ──
  const buildStatsFlat = (recs) => {
    return applicableItems().map(it => {
      const seq = sortByDate(recs).filter(r => typeof (r.vals && r.vals[it.key]) === 'number');
      if (!seq.length) return null;
      const vals = seq.map(r => r.vals[it.key]);
      const s = stat(vals);
      const dev = seq.filter(r => { const v = LabDB.judge(kind, r.code, it.key, r.vals[it.key]); return v === 'HIGH' || v === 'LOW'; }).length;
      return { it, ...s, dev, devRate: s.n ? dev / s.n * 100 : 0, trend: trendMark(vals, s.std) };
    }).filter(Boolean);
  };
  // 원료별 이탈 집계
  const materialDeviations = (recs) => {
    const map = new Map();
    recs.forEach(r => {
      let dev = 0;
      applicableItems().forEach(it => { const v = r.vals && r.vals[it.key]; if (typeof v === 'number') { const j = LabDB.judge(kind, r.code, it.key, v); if (j === 'HIGH' || j === 'LOW') dev++; } });
      const e = map.get(r.code) || { code: r.code, name: r.name || LabDB.nameOf(kind, r.code), n: 0, dev: 0 };
      e.n++; e.dev += dev; map.set(r.code, e);
    });
    return [...map.values()].sort((a, b) => b.dev - a.dev);
  };

  const reportListHtml = (recs, stats, mats, insights) => {
    const totalDev = stats.reduce((a, s) => a + s.dev, 0);
    const codes = new Set(recs.map(r => r.code)).size;
    const rows = stats.map(s => `<tr>
      <td class="l"><b>${esc(s.it.label)}</b> <span style="color:#888">${esc(s.it.unit)}</span></td>
      <td class="mono">${s.n}</td><td class="mono">${fmtNum(s.mean)}</td><td class="mono">${fmtNum(s.min)}</td>
      <td class="mono">${fmtNum(s.max)}</td><td class="mono">${fmtNum(s.std)}</td>
      <td class="mono">${s.dev > 0 ? `<span class="rpt-bad">${s.dev} (${s.devRate.toFixed(0)}%)</span>` : '0'}</td><td>${esc(s.trend)}</td>
    </tr>`).join('');
    const matRows = mats.filter(m => m.dev > 0).slice(0, 10).map(m => `<tr>
      <td class="mono">${esc(m.code)}</td><td class="l">${esc(m.name)}</td><td class="mono">${m.n}</td>
      <td class="mono"><span class="rpt-bad">${m.dev}</span></td><td class="mono">${(m.dev / m.n * 100).toFixed(0)}%</td></tr>`).join('');
    return `
      <div class="rpt-h1">분 석 대 장 A I 종 합 리 포 트</div>
      <div class="rpt-sub">${isRaw ? '원료' : '제품'} 전체 품질 분석 · ㈜우성사료 품질보증팀</div>
      <table class="rpt-info">
        <tr><td class="lb">분석기간</td><td>${periodText()}</td><td class="lb">${isRaw ? '원료' : '제품'} 종수</td><td>${codes}종</td></tr>
        <tr><td class="lb">분석건수</td><td>${recs.length}건</td><td class="lb">규격이탈</td><td>${totalDev}건 (${recs.length ? (totalDev / recs.length * 100).toFixed(1) : 0}%)</td></tr>
      </table>
      <div style="font-weight:700;margin:6px 0 4px">■ 항목별 통계 (전체 ${isRaw ? '원료' : '제품'} 합산)</div>
      <table class="rpt-tbl">
        <thead><tr><th>분석항목</th><th>n</th><th>평균</th><th>최소</th><th>최대</th><th>표준편차</th><th>이탈</th><th>추세</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8">데이터 없음</td></tr>'}</tbody>
      </table>
      ${matRows ? `<div style="font-weight:700;margin:10px 0 4px">■ 규격이탈 상위 ${isRaw ? '원료' : '제품'}</div>
      <table class="rpt-tbl"><thead><tr><th>코드</th><th>명칭</th><th>분석건수</th><th>이탈건수</th><th>이탈률</th></tr></thead><tbody>${matRows}</tbody></table>` : ''}
      <div style="margin-top:14px"><b>분석 코멘트</b><ul style="margin:6px 0 0;padding-left:18px">${insights.map(i => `<li style="margin:3px 0">${i}</li>`).join('')}</ul></div>
      <div class="rpt-foot"><div>· 통계는 선택 기간·검색 조건 내 완료 분석건 기준 · 이탈은 각 ${isRaw ? '원료' : '제품'}의 등록/통계 규격 대비 상·하한 초과 · 항목 평균은 전 ${isRaw ? '원료' : '제품'} 합산이므로 참고용.</div></div>
      <div class="rpt-sign">품질보증팀 ______________ (인)</div>`;
  };

  const reportList = () => {
    const recs = listData();
    if (!recs.length) { App.toast('조회된 분석 데이터가 없습니다', 'warning'); return; }
    const stats = buildStatsFlat(recs);
    const mats = materialDeviations(recs);
    const insights = [];
    const totalDev = stats.reduce((a, s) => a + s.dev, 0);
    insights.push(`선택 조건 내 총 <b>${recs.length}건</b> · 규격이탈 <b>${totalDev}건</b>(${(totalDev / recs.length * 100).toFixed(1)}%).`);
    const worstItem = stats.slice().sort((a, b) => b.devRate - a.devRate)[0];
    if (worstItem && worstItem.dev > 0) insights.push(`이탈률 최고 항목: <b>${esc(worstItem.it.label)}</b> (${worstItem.devRate.toFixed(1)}%).`);
    const worstMat = mats[0];
    if (worstMat && worstMat.dev > 0) insights.push(`이탈 최다 ${isRaw ? '원료' : '제품'}: <b>${esc(worstMat.name)}</b>(${esc(worstMat.code)}) — ${worstMat.dev}건.`);
    else insights.push('기간 내 규격이탈이 없습니다.');
    const up = stats.filter(s => /상승/.test(s.trend)).map(s => s.it.label);
    const down = stats.filter(s => /하강/.test(s.trend)).map(s => s.it.label);
    if (up.length) insights.push(`상승 추세: ${up.join(', ')}.`);
    if (down.length) insights.push(`하강 추세: ${down.join(', ')}.`);
    lastReport = { flat: true, recs, stats, mats };
    const excelBtn = `<button class="coa-btn-print" style="background:#2e9e5b" onclick="${PAGE}.exportReportListExcel()">리포트 엑셀</button>`;
    openReportOverlay(reportListHtml(recs, stats, mats, insights), excelBtn);
  };

  // 평면 rawdata 시트(코드·명칭 포함)
  const flatRawSheet = (recs) => {
    const present = columnItemsOf(recs);
    const header = ['접수번호', '접수일', '코드', '명칭', (isRaw ? '공급처' : '배합비'), ...present.map(it => `${it.label}(${it.unit})`), '비고', '온도(°C)', '습도(%)', '날씨'];
    const body = sortByDate(recs).map(r => [
      r.id, fmtDate(r.date), r.code, r.name || '', isRaw ? (r.supplier || '') : (r.formula || ''),
      ...present.map(it => (typeof (r.vals && r.vals[it.key]) === 'number') ? r.vals[it.key] : ''), r.note || '', ...wCols(r),
    ]);
    return [header, ...body];
  };
  const exportRawList = () => {
    const recs = listData();
    if (!recs.length) { App.toast('조회된 데이터가 없습니다', 'warning'); return; }
    WSXlsx.download(`${isRaw ? '원료' : '제품'}분석대장_${fileTag()}.xlsx`, [{ name: 'Rawdata', rows: flatRawSheet(recs) }]);
    App.toast(`분석대장 ${recs.length}건을 엑셀로 다운로드했습니다`, 'success');
  };
  const exportReportListExcel = () => {
    if (!lastReport || !lastReport.flat) return;
    const { recs, stats, mats } = lastReport;
    const totalDev = stats.reduce((a, s) => a + s.dev, 0);
    const summary = [
      [`우성사료 ${isRaw ? '원료' : '제품'} 분석대장 종합 리포트`],
      ['분석기간', periodText()],
      ['분석건수', recs.length],
      [`${isRaw ? '원료' : '제품'} 종수`, new Set(recs.map(r => r.code)).size],
      ['규격이탈 합계', totalDev],
      [],
      ['분석항목', 'n', '평균', '최소', '최대', '표준편차', '이탈건수', '이탈률(%)', '추세'],
      ...stats.map(s => [`${s.it.label}(${s.it.unit})`, s.n, round2(s.mean), round2(s.min), round2(s.max), round2(s.std), s.dev, round2(s.devRate), s.trend]),
    ];
    const matSheet = [
      ['코드', '명칭', '분석건수', '이탈건수', '이탈률(%)'],
      ...mats.map(m => [m.code, m.name, m.n, m.dev, round2(m.n ? m.dev / m.n * 100 : 0)]),
    ];
    WSXlsx.download(`${isRaw ? '원료' : '제품'}분석대장_종합리포트_${fileTag()}.xlsx`,
      [{ name: '항목별통계', rows: summary }, { name: '원료별이탈', rows: matSheet }, { name: 'Rawdata', rows: flatRawSheet(recs) }]);
    App.toast('종합 리포트 엑셀을 다운로드했습니다', 'success');
  };

  return { render, afterRender, open, back, showItem, onSearch, setCategory, setCompactCols, toggleGroup, clearGroups, editRec, judgeCell, saveEdit, closeEdit, applyRange, preset, report, exportRaw, exportReportExcel, reportList, exportRawList, exportReportListExcel };
}

const RawAnalysisPage = makeAnalysisPage('raw');
const ProdAnalysisPage = makeAnalysisPage('prod');
