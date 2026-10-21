// ============================================================
// feed_production.js — 국내 배합사료 생산실적 모니터링 (독립 페이지)
//   출처: 농림축산식품부 통계게시판 「YYYY년 M월 배합사료 생산실적 및 가격 통계」
//   서버 프록시 /api/feed-production (server.py 가 최신 .xls 를 xlrd 로 파싱, 24h 캐시)
//   매월 새 통계가 게시되면 자동으로 최신 월까지 반영됨.
//   배합비·생산 워크스페이스의 별도 메뉴(feedProduction).
// ============================================================

const FeedProductionPage = (() => {
  let data = null;        // {years, byYear:{y:{latestMonth, classes:{total,양계용,...}}}, sido, latestYear, latestMonth, classKeys, fetchedAt}
  let selYear = null;
  let chart = null;       // 월별 추세
  let yearChart = null;   // 연도별 비교
  const BOARD_URL = 'https://www.mafra.go.kr/bbs/home/789/artclList.do';

  const t = (n, d = 0) => (n == null || Number.isNaN(n)) ? '−' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: d });
  const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

  const render = () => `
    <div class="fade-in">
      <div class="module-hero mb-20">
        <div>
          <div class="module-kicker">배합비 · 생산</div>
          <h2>배합사료 생산실적</h2>
          <p>국내 전체 배합사료 생산량을 축종별·월별로 한눈에 모니터링합니다. (농림축산식품부 통계 · 매월 갱신)</p>
        </div>
      </div>
      <div class="card" id="feedprod-card">
        <div class="card-head">
          <div class="card-title">국내 배합사료 생산실적 <span class="tag tag-blue" style="font-size:10px">농림축산식품부 월간통계</span></div>
          <button class="btn btn-ghost btn-sm" onclick="FeedProductionPage.openBoard()">통계 원문(게시판)</button>
        </div>
        <div id="feedprod-body" class="text-muted" style="font-size:12px;padding:8px 0">생산실적 데이터를 불러오는 중... (최신 통계 .xls 파싱, 최초 10초 내외 소요)</div>
      </div>
    </div>`;

  // ── 데이터 헬퍼 ──
  const yInfo = (y) => data.byYear[y];
  const clsArr = (y, key) => (yInfo(y).classes[key] || Array(12).fill(0));
  const lmOf = (y) => yInfo(y).latestMonth || 12;
  const ytd = (arr, lm) => arr.slice(0, lm).reduce((a, b) => a + (b || 0), 0);
  // 축종 표시 순서(생산량 큰 순 고정)
  const CLASS_ORDER = ['양돈용', '양계용', '고기소용', '기타가축', '젖소용', '애완동물', '어류용', '대용유'];

  const buildUI = () => {
    const body = document.getElementById('feedprod-body');
    if (!body || !data) return;
    const years = data.years.slice().sort((a, b) => a - b);
    if (!selYear || !years.includes(selYear)) selYear = data.latestYear;
    const prevYear = years.includes(selYear - 1) ? selYear - 1 : null;
    const lm = lmOf(selYear);
    const isYTD = selYear === data.latestYear && lm < 12;

    const totalArr = clsArr(selYear, 'total');
    const tot = ytd(totalArr, lm);
    const prevTot = prevYear ? ytd(clsArr(prevYear, 'total'), lm) : null;   // 전년 동기(같은 1~lm월)
    const yoy = prevTot ? ((tot - prevTot) / prevTot * 100) : null;
    const monthAvg = lm ? tot / lm : null;
    const latestMonthVal = totalArr[lm - 1];

    // 축종별 누계 + 구성비 + 전년 동기 대비
    const keys = (data.classKeys || CLASS_ORDER).slice()
      .sort((a, b) => (CLASS_ORDER.indexOf(a) < 0 ? 99 : CLASS_ORDER.indexOf(a)) - (CLASS_ORDER.indexOf(b) < 0 ? 99 : CLASS_ORDER.indexOf(b)));
    const clsRows = keys.map(k => {
      const cur = ytd(clsArr(selYear, k), lm);
      const share = tot ? (cur / tot * 100) : 0;
      const pv = prevYear ? ytd(clsArr(prevYear, k), lm) : null;
      const d = (pv != null && pv > 0) ? ((cur - pv) / pv * 100) : null;
      return `<tr>
        <td><b>${esc(k)}</b></td>
        <td class="mono" style="text-align:right">${t(cur)}</td>
        <td class="mono text-muted" style="text-align:right">${share.toFixed(1)}%</td>
        <td class="mono" style="text-align:right">${d == null ? '<span class="text-muted">−</span>'
          : `<span style="color:${d >= 0 ? '#48c78e' : '#ff6b81'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}%</span>`}</td>
      </tr>`;
    }).join('');
    const topCls = keys.map(k => [k, ytd(clsArr(selYear, k), lm)]).sort((a, b) => b[1] - a[1])[0];

    const yearBtns = years.map(y =>
      `<button class="btn btn-sm ${y === selYear ? 'btn-primary' : 'btn-ghost'}" onclick="FeedProductionPage.setYear(${y})">${y}</button>`).join('');
    const kpi = (label, value, sub, tone) => `
      <div class="stat-card ${tone || ''}">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="font-size:22px">${value}</div>
        <div class="stat-sub">${sub || ''}</div>
      </div>`;

    // 연도별 비교(연간 총계 + 동기간 누계)
    const cmpMonth = data.latestMonth;   // 최신연 최신월 = 동기간 기준
    body.className = '';
    body.style.padding = '0';
    body.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="font-size:12.5px;font-weight:700;margin-bottom:6px">연도별 총생산량 비교 <span class="text-muted" style="font-weight:400">(연간 총계 · 1~${cmpMonth}월 동기간 누계)</span></div>
        <div class="chart-frame" style="height:200px"><canvas id="feedprod-yearchart"></canvas></div>
      </div>
      <div style="border-top:1px solid var(--border);margin:4px 0 12px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-bottom:10px">
        <span class="text-muted" style="font-size:11px">연도</span>${yearBtns}
        <div style="flex:1"></div>
        <span class="text-muted" style="font-size:11px">${isYTD ? `${selYear}년은 1~${lm}월 누계` : `${selYear}년 연간`} · 단위 톤</span>
      </div>
      <div class="stat-grid" style="margin-bottom:12px">
        ${kpi(`${selYear}년 ${isYTD ? `누계(1~${lm}월)` : ''} 총생산량`, t(tot) + ' 톤', '국내 전체 배합사료')}
        ${kpi(prevYear ? `전년(${prevYear}) 동기 대비` : '전년 대비', yoy == null ? '−' : (yoy >= 0 ? '+' : '') + yoy.toFixed(1) + '%', prevYear ? `${prevYear}년 동기 ${t(prevTot)} 톤` : '전년 데이터 없음', yoy == null ? '' : (yoy >= 0 ? 'ok' : 'danger'))}
        ${kpi('월평균 생산량', monthAvg != null ? t(monthAvg) + ' 톤' : '−', `집계 ${lm}개월`)}
        ${kpi('최대 축종', topCls ? esc(topCls[0]) : '−', topCls && tot ? `${t(topCls[1])} 톤 (${(topCls[1] / tot * 100).toFixed(1)}%)` : '')}
      </div>
      <div class="qd-raw-grid" style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:stretch">
        <div class="chart-frame" style="height:250px"><canvas id="feedprod-chart"></canvas></div>
        <div class="table-wrap" style="max-height:270px;overflow:auto">
          <table class="data-table compact">
            <thead><tr><th>축종</th><th style="text-align:right">${isYTD ? '누계' : '연간'}(톤)</th><th style="text-align:right">구성비</th><th style="text-align:right">전년동기</th></tr></thead>
            <tbody>${clsRows}</tbody>
          </table>
        </div>
      </div>
      ${sidoHtml()}
      <div class="text-muted" style="font-size:11px;margin-top:8px">출처: 농림축산식품부 「배합사료 생산실적 및 가격 통계」 (매월 게시) · 조회 ${esc(String(data.fetchedAt || '').slice(0, 16).replace('T', ' '))} · 24시간 캐시 · 수집연도 ${years[0]}~${years[years.length - 1]}</div>`;
    drawChart(prevYear);
    drawYearChart(cmpMonth);
  };

  // ── 시도별 생산량 (최신월) ──
  const sidoHtml = () => {
    const s = data.sido;
    if (!s || !s.regions) return '';
    const nat = s.regions['전국'] || 0;
    const rows = Object.entries(s.regions).filter(([k]) => k !== '전국')
      .sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 0;
    const body = rows.map(([name, qy]) => {
      const share = nat ? (qy / nat * 100) : 0;
      const w = max ? (qy / max * 100) : 0;
      return `<tr>
        <td style="white-space:nowrap"><b>${esc(name)}</b></td>
        <td style="width:100%;padding:4px 8px">
          <div style="background:linear-gradient(90deg, rgba(79,156,255,.55) ${w}%, transparent ${w}%);border-radius:4px;height:16px"></div>
        </td>
        <td class="mono" style="text-align:right;white-space:nowrap">${t(qy)}</td>
        <td class="mono text-muted" style="text-align:right;white-space:nowrap">${share.toFixed(1)}%</td>
      </tr>`;
    }).join('');
    return `
      <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:12.5px;font-weight:700;margin-bottom:2px">시도별 생산량 <span class="text-muted" style="font-weight:400">(${s.year}년 ${s.month}월 · 전국 ${t(nat)} 톤)</span></div>
        <div class="text-muted" style="font-size:11px;margin-bottom:8px">※ 회사(제조사)별 생산량은 공개 통계로 제공되지 않아, 지역(시도)별 생산량으로 제공합니다.</div>
        <div class="table-wrap" style="max-height:340px;overflow:auto">
          <table class="data-table compact">
            <thead><tr><th>시도</th><th>분포</th><th style="text-align:right">생산량(톤)</th><th style="text-align:right">구성비</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  };

  const monthlyForChart = (y) => {
    const lm = lmOf(y);
    return clsArr(y, 'total').map((v, i) => i < lm ? +(v || 0).toFixed(0) : null);
  };
  const drawChart = (prevYear) => {
    const canvas = document.getElementById('feedprod-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
    const datasets = [{
      label: `${selYear}년 월별 생산량(톤)`, data: monthlyForChart(selYear),
      borderColor: '#4f9cff', backgroundColor: 'rgba(79,156,255,0.12)', tension: 0.25, pointRadius: 3, fill: true, spanGaps: false,
    }];
    if (prevYear) datasets.push({
      label: `${prevYear}년`, data: monthlyForChart(prevYear),
      borderColor: '#8892a6', borderDash: [5, 4], pointRadius: 0, fill: false, tension: 0.25,
    });
    chart = new Chart(canvas, {
      type: 'line',
      data: { labels: MONTHS, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#8892a6', font: { size: 10 }, callback: (v) => t(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  };

  // 연도별 비교: 연간 총계 + 1~cmpMonth 동기간 누계 (막대)
  const drawYearChart = (cmpMonth) => {
    const canvas = document.getElementById('feedprod-yearchart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (yearChart) { try { yearChart.destroy(); } catch (_) {} yearChart = null; }
    const years = data.years.slice().sort((a, b) => a - b);
    const annual = years.map(y => {
      const info = yInfo(y);
      return info.latestMonth >= 12 ? +ytd(clsArr(y, 'total'), 12).toFixed(0) : null;   // 미완성 연도는 연간 막대 생략
    });
    const samePeriod = years.map(y => +ytd(clsArr(y, 'total'), cmpMonth).toFixed(0));
    yearChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: years.map(String),
        datasets: [
          { label: '연간 총계(톤)', data: annual, backgroundColor: 'rgba(79,156,255,0.75)', borderRadius: 4 },
          { label: `1~${cmpMonth}월 누계(톤)`, data: samePeriod, backgroundColor: 'rgba(46,158,91,0.8)', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y == null ? '−' : t(c.parsed.y)} 톤` } },
        },
        scales: {
          x: { ticks: { color: '#8892a6', font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: '#8892a6', font: { size: 10 }, callback: (v) => t(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
  };

  const afterRender = () => {
    if (data) { buildUI(); return; }
    fetch('/api/feed-production')
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error || ('api ' + r.status)))))
      .then(d => {
        if (!d || !d.byYear || !d.years || !d.years.length) throw new Error('empty');
        data = d;
        buildUI();
      })
      .catch((e) => {
        const body = document.getElementById('feedprod-body');
        if (body) body.innerHTML = `<div style="font-size:12px;line-height:1.7">
          <b style="color:#ff8f8f">생산실적 데이터를 불러오지 못했습니다.</b><br>
          · 동기화 서버(<span class="mono">python server.py 8456</span>)가 실행 중이어야 합니다.<br>
          · 서버에 <span class="mono">xlrd</span> 패키지가 필요합니다 (<span class="mono">pip install xlrd</span>).<br>
          · 농식품부 게시판 점검 중이면 잠시 후 다시 시도하세요.<br>
          <span class="text-muted">(${esc(String(e && e.message || e))})</span></div>`;
      });
  };

  const setYear = (y) => { selYear = y; buildUI(); };
  const openBoard = () => {
    let win = null;
    try { win = window.open(BOARD_URL, '_blank', 'noopener,noreferrer'); } catch (_) { win = null; }
    if (!win) { try { navigator.clipboard && navigator.clipboard.writeText(BOARD_URL); } catch (_) {} App.toast('게시판 주소를 복사했습니다: ' + BOARD_URL, 'info'); }
  };

  return { render, afterRender, setYear, openBoard };
})();
// 하위호환: 이전 전역명 참조 방지
const FeedProduction = FeedProductionPage;
