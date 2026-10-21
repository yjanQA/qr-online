// ============================================================
// voc_dashboard.js — VOC 종합 대시보드
//   원본 대장: 품질 데이터/우성사료 VOC 보고서 (사료/반려/양어 3개 대장)
//   대장이 보던 축을 그대로 화면으로 옮긴다.
//     · 접수 추이 / 종결률 / 평균 처리일 / 답변기한 초과
//     · 불만유형·근본원인·제품·거래처·지구·축종별 분포
//     · 재발방지대책이 비어 있는 종결 건(= 히스토리가 끊긴 건) 추적
// ============================================================

const VOCDashboardPage = (() => {
  let months = 12;
  let axis = 'category';      // category | rootType | product | customer | region | species
  let scope = 'COMPLAINT';   // COMPLAINT(불만만) | ALL(칭찬·정보공유 포함)
  let chart = null;

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const facName = (f) => (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(f) : f;
  const fmtDate = (s) => String(s || '').slice(0, 10) || '-';

  const AXES = [
    ['category',  '불만유형'],
    ['rootType',  '근본원인'],
    ['product',   '제품'],
    ['customer',  '거래처'],
    ['region',    '소속지구'],
    ['species',   '축종'],
    ['satisfaction', '만족도'],
  ];
  const axisData = (s) => ({
    category: s.byCategory, rootType: s.byRootType, product: s.byProduct,
    customer: s.byCustomer, region: s.byRegion, species: s.bySpecies,
    satisfaction: s.bySatisfaction,
  }[axis] || []);

  const sevBadge = (x) => x === 'HIGH' ? '<span class="badge badge-fail">긴급</span>'
    : x === 'MEDIUM' ? '<span class="badge badge-warning">중간</span>' : '<span class="badge badge-default">낮음</span>';
  const stBadge = (x) => ({
    OPEN: '<span class="badge badge-alert">접수</span>',
    INVESTIGATING: '<span class="badge badge-warning">조사중</span>',
    ACTION: '<span class="badge badge-info">조치중</span>',
    CLOSED: '<span class="badge badge-pass">종결</span>',
  }[x] || `<span class="badge badge-default">${esc(x)}</span>`);

  const render = () => {
    const f = fac();
    const s = DB.vocStats(f, months, scope === 'COMPLAINT');
    const sAll = DB.vocStats(f, months, false);
    const praise = sAll.windowTotal - DB.vocStats(f, months, true).windowTotal;

    const banner = [];
    if (s.overdue > 0) banner.push(`<div class="card alert-banner alert-danger">
      <b>답변기한 초과 ${s.overdue}건</b> — ${s.overdueList.slice(0, 3).map(v => `${esc(v.customer || v.productName || v.vocNo)}(${DB.vocOverdue(v)}일 경과)`).join(', ')}${s.overdue > 3 ? ` 외 ${s.overdue - 3}건` : ''}
    </div>`);
    if (s.high > 0) banner.push(`<div class="card alert-banner alert-danger">
      <b>긴급 미종결 ${s.high}건</b> — 위해 가능성이 있는 클레임입니다. 역추적과 회수 검토가 필요합니다.
    </div>`);
    if (s.noPrevent > 0) banner.push(`<div class="card alert-banner alert-warn">
      <b>재발방지대책 미기재 종결 ${s.noPrevent}건</b> — 대책이 없으면 같은 클레임이 반복됩니다. 소급 입력이 필요합니다.
    </div>`);

    const rank = axisData(s).slice(0, 10);
    const maxN = rank.length ? rank[0].n : 1;
    const rankRows = rank.length ? rank.map((r, i) => `
      <tr>
        <td class="td-mono text-xs" style="width:34px">${i + 1}</td>
        <td>${esc(r.name)}</td>
        <td style="width:200px">
          <div class="voc-rank-bar"><div class="voc-rank-fill" style="width:${Math.round(r.n / maxN * 100)}%"></div></div>
        </td>
        <td class="td-mono" style="width:60px;text-align:right">${r.n}건</td>
        <td class="td-mono text-xs text-muted" style="width:60px;text-align:right">${s.windowTotal ? Math.round(r.n / s.windowTotal * 100) : 0}%</td>
      </tr>`).join('') : '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px">해당 기간 데이터가 없습니다</td></tr>';

    // 미종결 건 — 오래된 순(방치된 것이 위로)
    const openRows = s.openList.length ? s.openList
      .slice().sort((a, b) => DB.vocLeadDays(b) - DB.vocLeadDays(a)).slice(0, 15)
      .map(v => {
        const od = DB.vocOverdue(v);
        return `<tr style="cursor:pointer${od > 0 ? ';background:rgba(239,68,68,.05)' : ''}" onclick="VOCDashboardPage.openVOC('${v.id}')">
          <td class="td-mono text-xs">${fmtDate(v.receivedAt || v.registeredAt)}</td>
          <td><strong>${esc(v.productName || '-')}</strong><div class="text-xs text-muted">${esc(v.customer || '-')}</div></td>
          <td class="text-xs">${esc(v.category || '-')}</td>
          <td style="text-align:center">${sevBadge(v.severity)}</td>
          <td style="text-align:center">${stBadge(v.status)}</td>
          <td class="td-mono text-xs" style="text-align:center">${DB.vocLeadDays(v)}일</td>
          <td style="text-align:center">${od > 0 ? `<span class="badge badge-fail">${od}일 초과</span>` : `<span class="text-muted text-xs">${fmtDate(v.dueDate)}</span>`}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:18px">미종결 VOC가 없습니다</td></tr>';

    // 최근 재발방지대책 — 무엇을 고쳤는지가 쌓이는 곳
    const prevRows = DB.getVOCs()
      .filter(v => (f === 'ALL' || (v.factory || 'HQ') === f) && String(v.prevention || '').trim())
      .sort((a, b) => String(b.closedAt || b.answerDate || '').localeCompare(String(a.closedAt || a.answerDate || '')))
      .slice(0, 12);
    const prevHtml = prevRows.length ? prevRows.map(v => `
      <tr style="cursor:pointer" onclick="VOCDashboardPage.openVOC('${v.id}')">
        <td class="td-mono text-xs">${fmtDate(v.closedAt || v.answerDate || v.updatedAt)}</td>
        <td class="text-xs"><strong>${esc(v.productName || '-')}</strong></td>
        <td class="text-xs">${v.rootType ? esc(v.rootType) : '<span class="text-muted">미분류</span>'}</td>
        <td class="text-xs text-muted">${esc(v.rootCause || '-')}</td>
        <td class="text-xs">${esc(v.prevention)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:18px">등록된 재발방지대책이 없습니다</td></tr>';

    return `
      <div class="fade-in">
        ${banner.join('')}

        <div class="flex items-center justify-between mb-16">
          <div class="factory-tabs">
            <button class="factory-tab ${scope === 'COMPLAINT' ? 'active' : ''}" onclick="VOCDashboardPage.setScope('COMPLAINT')">불만 건만</button>
            <button class="factory-tab ${scope === 'ALL' ? 'active' : ''}" onclick="VOCDashboardPage.setScope('ALL')">전체 VOC</button>
          </div>
          <div class="text-muted" style="font-size:12px">
            사료(양축) 대장은 칭찬·서비스활동 기록도 함께 관리합니다 — 최근 ${months}개월 중 ${praise}건
          </div>
        </div>

        <div class="inventory-summary-grid mb-20">
          <div class="inventory-summary-card"><div class="summary-label">최근 ${months}개월 접수</div><div class="summary-value">${s.windowTotal}<span>건</span></div></div>
          <div class="inventory-summary-card ${s.open > 0 ? 'summary-risk' : ''}"><div class="summary-label">미종결</div><div class="summary-value">${s.open}<span>건</span></div></div>
          <div class="inventory-summary-card ${s.overdue > 0 ? 'summary-risk' : ''}"><div class="summary-label">답변기한 초과</div><div class="summary-value">${s.overdue}<span>건</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">종결률</div><div class="summary-value">${s.closeRate}<span>%</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">평균 처리일</div><div class="summary-value">${s.avgLead}<span>일</span></div></div>
          <div class="inventory-summary-card ${s.noPrevent > 0 ? 'summary-risk' : ''}"><div class="summary-label">대책 미기재</div><div class="summary-value">${s.noPrevent}<span>건</span></div></div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">VOC 접수·종결 추이</div>
            <div class="factory-tabs">${[6, 12, 24].map(m =>
              `<button class="factory-tab ${months === m ? 'active' : ''}" onclick="VOCDashboardPage.setMonths(${m})">${m}개월</button>`).join('')}</div>
          </div>
          <div class="chart-wrapper" style="height:250px"><canvas id="vd-chart"></canvas></div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">분포 분석 TOP 10</div>
            <div class="factory-tabs">${AXES.map(([k, l]) =>
              `<button class="factory-tab ${axis === k ? 'active' : ''}" onclick="VOCDashboardPage.setAxis('${k}')">${l}</button>`).join('')}</div>
          </div>
          <div class="table-wrapper"><table>
            <thead><tr><th>순위</th><th>${esc(AXES.find(a => a[0] === axis)?.[1] || '')}</th><th>비중</th><th style="text-align:right">건수</th><th style="text-align:right">비율</th></tr></thead>
            <tbody>${rankRows}</tbody>
          </table></div>
          ${axis === 'rootType' ? (() => {
            const un = s.unclassified;
            return un > 0
              ? `<div class="alert-banner alert-warn card mt-12" style="margin-bottom:0">
                   <b>근본원인 미분류 ${un}건</b> — 과거 대장에는 원인 '분류' 항목이 없어 비어 있습니다.
                   근본원인 문장은 그대로 남아 있으니, 처리내역 화면에서 분류만 선택하면 이 집계에 잡힙니다.
                   <button class="btn btn-ghost btn-xs" style="margin-left:8px" onclick="VOCDashboardPage.goClassify()">분류할 건 보기</button>
                 </div>`
              : '';
          })() : ''}
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">미종결 VOC <span class="text-muted" style="font-weight:400">(${s.open}건 중 최근 15건)</span></div>
            <span class="text-muted" style="font-size:12px">경과일이 긴 순</span></div>
          <div class="table-wrapper"><table>
            <thead><tr><th>접수일</th><th>제품 / 거래처</th><th>유형</th><th style="text-align:center">심각도</th><th style="text-align:center">상태</th><th style="text-align:center">경과</th><th style="text-align:center">답변기한</th></tr></thead>
            <tbody>${openRows}</tbody>
          </table></div>
        </div>

        <div class="card mb-24">
          <div class="card-head"><div class="card-title">재발방지대책 이력</div>
            <span class="text-muted" style="font-size:12px">종결 건에서 확정된 대책 — 같은 원인이 반복되는지 확인하세요</span></div>
          <div class="table-wrapper"><table>
            <thead><tr><th style="width:100px">종결일</th><th style="width:140px">제품</th><th style="width:100px">원인분류</th><th style="width:240px">근본원인</th><th>재발방지대책</th></tr></thead>
            <tbody>${prevHtml}</tbody>
          </table></div>
        </div>
      </div>`;
  };

  const drawChart = () => {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('vd-chart');
    if (!canvas) return;
    if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
    const s = DB.vocStats(fac(), months, scope === 'COMPLAINT');
    // 접수가 없는 달은 null — 0%로 찍으면 "종결률 0"으로 오해된다
    const rate = s.labels.map((_, i) => s.monthly[i] ? Math.round(s.monthlyClosed[i] / s.monthly[i] * 100) : null);
    chart = new Chart(canvas, {
      data: {
        labels: s.labels,
        datasets: [
          { type: 'bar', label: '접수', data: s.monthly, backgroundColor: 'rgba(79,156,255,0.35)', borderColor: '#4f9cff', borderWidth: 1, yAxisID: 'y' },
          { type: 'bar', label: '종결', data: s.monthlyClosed, backgroundColor: 'rgba(48,164,108,0.45)', borderColor: '#30a46c', borderWidth: 1, yAxisID: 'y' },
          { type: 'bar', label: '긴급', data: s.monthlyHigh, backgroundColor: 'rgba(229,72,77,0.5)', borderColor: '#e5484d', borderWidth: 1, yAxisID: 'y' },
          { type: 'line', label: '종결률(%)', data: rate, borderColor: '#e0912f', backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, spanGaps: false, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { beginAtZero: true, position: 'left', title: { display: true, text: '건수', color: '#8892a6', font: { size: 10 } }, ticks: { color: '#8892a6', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { beginAtZero: true, max: 100, position: 'right', title: { display: true, text: '종결률(%)', color: '#8892a6', font: { size: 10 } }, ticks: { color: '#8892a6', font: { size: 10 } }, grid: { drawOnChartArea: false } },
        },
      },
    });
  };

  const openVOC = (id) => { App.navigate('voc'); setTimeout(() => { try { VOCPage.openDetail(id); } catch (_) {} }, 60); };
  const goClassify = () => { App.navigate('voc'); setTimeout(() => { try { VOCPage.setFilter('NOTYPE'); } catch (_) {} }, 60); };
  const setMonths = (m) => { months = m; App.refreshPage(); };
  const setAxis = (a) => { axis = a; App.refreshPage(); };
  const setScope = (x) => { scope = x; App.refreshPage(); };
  const afterRender = () => drawChart();

  // 품질 대시보드 연동용 요약
  const summary = () => {
    const s = DB.vocStats(fac(), 12, true);
    return { open: s.open, overdue: s.overdue, high: s.high, noPrevent: s.noPrevent, closeRate: s.closeRate, avgLead: s.avgLead };
  };

  return { render, afterRender, setMonths, setAxis, setScope, openVOC, goClassify, summary };
})();
