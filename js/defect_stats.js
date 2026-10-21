// ============================================================
// defect_stats.js — 부적합 통계 (월별 / 유형별)
//   식품안전관리인증원 범용 HACCP MES 표준모델의 '월별부적합률·유형별부적합률' 대응
//   원천: 입고검사(DB.getInspections) — 게이트별 검사항목 단위로 부적합 유형을 집계
//   보조: 입고 반려(REJECTED) 건, VOC 클레임 유형
// ============================================================

const DefectStatsPage = (() => {
  let months = 12;          // 조회 개월수: 3 | 6 | 12 | 24
  let chart = null;

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const pad2 = (n) => String(n).padStart(2, '0');
  // 월 키(YYYY-MM)는 반드시 '로컬 시각' 기준으로 만든다.
  //   toISOString()은 UTC로 변환되어 KST(+9)에서는 월초 데이터가 한 달 앞으로 밀린다.
  const ym = (d) => {
    if (!d) return '';
    const x = new Date(d);
    if (isNaN(x)) return String(d).slice(0, 7);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}`;
  };
  const pct = (a, b) => b > 0 ? Math.round(a / b * 1000) / 10 : 0;

  // 조회 기간(최근 N개월) 라벨
  const monthLabels = () => {
    const out = [];
    const d = new Date();
    for (let i = months - 1; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(`${x.getFullYear()}-${pad2(x.getMonth() + 1)}`);
    }
    return out;
  };

  // ── 데이터 수집 ──
  //   검사 레코드에는 factory 가 없으므로 연결된 입고건의 공장으로 판정한다.
  const load = () => {
    const f = fac();
    let recvById = {};
    try { (DB.getReceivings() || []).forEach(r => { recvById[r.id] = r; }); } catch (_) {}
    let insp = [];
    try { insp = DB.getInspections() || []; } catch (_) {}
    const labels = monthLabels();
    const inWindow = (d) => labels.includes(ym(d));

    const rows = insp.filter(i => {
      if (!inWindow(i.inspectedAt)) return false;
      if (f === 'ALL') return true;
      const r = recvById[i.receivingId];
      return !r || r.factory === f;     // 입고건이 없으면(구데이터) 제외하지 않음
    });
    return { labels, rows, recvById };
  };

  // 월별 검사/부적합 집계
  const byMonth = (labels, rows) => {
    const m = {};
    labels.forEach(l => { m[l] = { total: 0, fail: 0, cond: 0 }; });
    rows.forEach(i => {
      const k = ym(i.inspectedAt);
      if (!m[k]) return;
      m[k].total++;
      if (i.verdict === 'FAIL') m[k].fail++;
      else if (i.verdict === 'CONDITIONAL') m[k].cond++;
    });
    return labels.map(l => ({ month: l, ...m[l], rate: pct(m[l].fail, m[l].total) }));
  };

  // 유형별(검사항목) 부적합 집계 — checkItems 중 result==='FAIL' 인 항목명 기준
  const byItem = (rows) => {
    const map = new Map();
    rows.forEach(i => {
      (i.checkItems || []).forEach(ci => {
        if (ci.result !== 'FAIL') return;
        const key = ci.name || ci.item || '기타';
        if (!map.has(key)) map.set(key, { name: key, n: 0, gates: new Set() });
        const o = map.get(key); o.n++; if (i.gateName) o.gates.add(i.gateName);
      });
      // 검사항목 세부가 없는 경우 보완 — 원인코드를 먼저 쓰고, 없을 때만 사유 앞부분으로 대체.
      //   사유 앞 20자를 키로 쓰면 같은 원인이 문장마다 다른 항목으로 흩어진다.
      if ((!i.checkItems || !i.checkItems.length) && i.verdict === 'FAIL' && (i.failCode || i.failReason)) {
        const key = i.failCode ? DB.failCodeLabel(i.failCode) : i.failReason.slice(0, 20);
        if (!map.has(key)) map.set(key, { name: key, n: 0, gates: new Set() });
        map.get(key).n++;
      }
    });
    return [...map.values()].map(o => ({ ...o, gates: [...o.gates].join(', ') })).sort((a, b) => b.n - a.n);
  };

  // 원인코드별 부적합 — 실패비용 파레토의 기준 축
  const byCause = (rows) => {
    const map = new Map();
    rows.forEach(i => {
      if (i.verdict !== 'FAIL' && i.verdict !== 'CONDITIONAL') return;
      const key = i.failCode || '';
      if (!map.has(key)) map.set(key, { code: key, name: DB.failCodeLabel(key), n: 0, mats: new Set() });
      const o = map.get(key); o.n++; if (i.materialName) o.mats.add(i.materialName);
    });
    const list = [...map.values()].sort((a, b) => b.n - a.n);
    const sum = list.reduce((s, o) => s + o.n, 0);
    let acc = 0;
    return list.map(o => {
      acc += o.n;
      return { ...o, mats: [...o.mats].slice(0, 3).join(', '), share: pct(o.n, sum), cum: pct(acc, sum) };
    });
  };

  // 게이트별 부적합률
  const byGate = (rows) => {
    const map = new Map();
    rows.forEach(i => {
      const key = i.gateName || i.gateId || '기타';
      if (!map.has(key)) map.set(key, { name: key, total: 0, fail: 0 });
      const o = map.get(key); o.total++; if (i.verdict === 'FAIL') o.fail++;
    });
    return [...map.values()].map(o => ({ ...o, rate: pct(o.fail, o.total) })).sort((a, b) => b.fail - a.fail || b.total - a.total);
  };

  // 원료별 부적합 TOP
  const byMaterial = (rows) => {
    const map = new Map();
    rows.forEach(i => {
      const key = i.materialName || i.materialCode || '-';
      if (!map.has(key)) map.set(key, { name: key, code: i.materialCode || '', total: 0, fail: 0 });
      const o = map.get(key); o.total++; if (i.verdict === 'FAIL') o.fail++;
    });
    return [...map.values()].filter(o => o.fail > 0)
      .map(o => ({ ...o, rate: pct(o.fail, o.total) })).sort((a, b) => b.fail - a.fail).slice(0, 10);
  };

  // 입고 반려(REJECTED) 사유 — 검사 외 경로의 부적합
  const rejects = (labels) => {
    const f = fac();
    let list = [];
    try { list = (DB.getReceivings() || []).filter(r => r.status === 'REJECTED'); } catch (_) {}
    return list.filter(r => labels.includes(ym(r.receivedDate || r.createdAt)) && (f === 'ALL' || r.factory === f));
  };

  const render = () => {
    const { labels, rows } = load();
    const mon = byMonth(labels, rows);
    const items = byItem(rows);
    const gates = byGate(rows);
    const mats = byMaterial(rows);
    const causes = byCause(rows);
    const rej = rejects(labels);

    const total = rows.length;
    const fail = rows.filter(i => i.verdict === 'FAIL').length;
    const cond = rows.filter(i => i.verdict === 'CONDITIONAL').length;
    const rate = pct(fail, total);
    // 직전 동기간 대비
    const half = Math.floor(labels.length / 2);
    const recent = mon.slice(half), prev = mon.slice(0, half);
    const rRate = pct(recent.reduce((s, m) => s + m.fail, 0), recent.reduce((s, m) => s + m.total, 0));
    const pRate = pct(prev.reduce((s, m) => s + m.fail, 0), prev.reduce((s, m) => s + m.total, 0));
    const delta = (pRate > 0) ? Math.round((rRate - pRate) * 10) / 10 : null;

    const mBtn = (n) => `<button class="btn btn-sm ${months === n ? 'btn-primary' : 'btn-ghost'}" onclick="DefectStatsPage.setMonths(${n})">${n >= 12 ? (n / 12) + '년' : n + '개월'}</button>`;

    const itemRows = items.length ? items.slice(0, 12).map((o, i) => `<tr>
        <td class="text-xs">${i + 1}</td>
        <td><strong>${esc(o.name)}</strong></td>
        <td class="text-xs text-muted">${esc(o.gates || '-')}</td>
        <td class="td-right"><b>${o.n}</b>건</td>
        <td class="td-right text-xs">${pct(o.n, fail || 1)}%</td>
      </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">기간 내 부적합 항목이 없습니다</td></tr>`;

    const gateRows = gates.length ? gates.map(g => `<tr>
        <td><strong>${esc(g.name)}</strong></td>
        <td class="td-right">${g.total}</td>
        <td class="td-right ${g.fail > 0 ? 'text-red' : ''}">${g.fail}</td>
        <td class="td-right"><b>${g.rate}%</b></td>
      </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">검사 데이터가 없습니다</td></tr>`;

    const unclassified = causes.find(c => !c.code);
    const causeRows = causes.length ? causes.map((c, i) => `<tr>
        <td class="text-xs">${i + 1}</td>
        <td><strong>${esc(c.name)}</strong>${c.code ? '' : ' <span class="text-xs text-muted">(원인코드 미입력)</span>'}</td>
        <td class="text-xs text-muted">${esc(c.mats || '-')}</td>
        <td class="td-right"><b>${c.n}</b>건</td>
        <td class="td-right text-xs">${c.share}%</td>
        <td class="td-right text-xs text-muted">${c.cum}%</td>
        <td class="td-right no-print"><button class="btn btn-ghost btn-xs" onclick="DefectStatsPage.toAgenda('cause','${esc(c.code || '')}')">안건</button></td>
      </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">기간 내 부적합이 없습니다</td></tr>`;

    const matRows = mats.length ? mats.map(m => `<tr>
        <td class="td-mono text-xs">${esc(m.code)}</td>
        <td><strong>${esc(m.name)}</strong></td>
        <td class="td-right">${m.total}</td>
        <td class="td-right text-red">${m.fail}</td>
        <td class="td-right"><b>${m.rate}%</b></td>
        <td class="td-right no-print"><button class="btn btn-ghost btn-xs" onclick="DefectStatsPage.toAgenda('mat','${esc(m.code || m.name)}')">안건</button></td>
      </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">부적합 발생 원료가 없습니다</td></tr>`;

    return `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-12" style="gap:10px;flex-wrap:wrap">
        <div class="text-sm text-muted">최근 ${months}개월 · 검사 ${total}건 · 부적합 ${fail}건${cond ? ` · 조건부 ${cond}건` : ''}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="text-muted" style="font-size:12px">기간</span>${mBtn(3)}${mBtn(6)}${mBtn(12)}${mBtn(24)}
        </div>
      </div>

      <div class="inventory-summary-grid mb-16">
        <div class="inventory-summary-card"><div class="summary-label">검사 건수</div><div class="summary-value">${total}<span>건</span></div></div>
        <div class="inventory-summary-card ${fail > 0 ? 'summary-risk' : ''}"><div class="summary-label">부적합 건수</div><div class="summary-value">${fail}<span>건</span></div></div>
        <div class="inventory-summary-card ${rate > 0 ? 'summary-risk' : ''}"><div class="summary-label">부적합률</div><div class="summary-value">${rate}<span>%</span></div></div>
        <div class="inventory-summary-card"><div class="summary-label">최근 추세</div><div class="summary-value" style="font-size:20px">${
          delta == null ? '<span style="color:var(--text-muted)">비교불가</span>'
          : delta > 0 ? `<span style="color:#e5484d">▲ ${delta}%p</span>`
          : delta < 0 ? `<span style="color:#2ea86a">▼ ${Math.abs(delta)}%p</span>`
          : '<span>변동없음</span>'}</div><div class="stat-sub" style="font-size:11px">직전 동기간 대비</div></div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="section-label">월별 부적합률 추이</div>
        <div class="chart-frame" style="height:240px"><canvas id="ds-month-chart"></canvas></div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="section-label">원인별 부적합 (원인코드 기준)</div>
        <div class="table-wrapper">
          <table><thead><tr><th>#</th><th>원인</th><th>해당 원료</th><th class="td-right">건수</th><th class="td-right">비중</th><th class="td-right">누적</th><th class="no-print"></th></tr></thead>
          <tbody>${causeRows}</tbody></table>
        </div>
        ${unclassified ? `<div class="text-muted" style="font-size:12px;margin-top:8px">원인코드가 없는 ${unclassified.n}건은 코드 필수화 이전에 기록된 건입니다. 개선 우선순위 판단에서는 제외하고 보세요.</div>` : ''}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="ds-grid">
        <div class="card">
          <div class="section-label">유형별 부적합 (검사항목 기준)</div>
          <div class="table-wrapper">
            <table><thead><tr><th>#</th><th>부적합 항목</th><th>발생 게이트</th><th class="td-right">건수</th><th class="td-right">비중</th></tr></thead>
            <tbody>${itemRows}</tbody></table>
          </div>
        </div>
        <div class="card">
          <div class="section-label">게이트별 부적합률</div>
          <div class="table-wrapper">
            <table><thead><tr><th>게이트</th><th class="td-right">검사</th><th class="td-right">부적합</th><th class="td-right">비율</th></tr></thead>
            <tbody>${gateRows}</tbody></table>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="section-label">부적합 다발 원료 TOP 10</div>
        <div class="table-wrapper">
          <table><thead><tr><th>코드</th><th>원료명</th><th class="td-right">검사</th><th class="td-right">부적합</th><th class="td-right">비율</th><th class="no-print"></th></tr></thead>
          <tbody>${matRows}</tbody></table>
        </div>
      </div>

      ${rej.length ? `
      <div class="card" style="margin-top:14px">
        <div class="section-label">입고 반려 내역 (${rej.length})</div>
        <div class="table-wrapper">
          <table><thead><tr><th>입고일</th><th>원료</th><th>공급처</th><th>공장</th><th>반려사유</th></tr></thead>
          <tbody>${rej.slice(0, 20).map(r => `<tr>
            <td class="text-xs">${esc(r.receivedDate || '-')}</td>
            <td><strong>${esc(r.materialName || '-')}</strong></td>
            <td class="text-xs">${esc(r.supplierName || '-')}</td>
            <td class="text-xs">${esc(DB.getFactoryName ? DB.getFactoryName(r.factory) : r.factory)}</td>
            <td class="text-xs">${esc(r.rejectReason || '사유 미입력')}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      </div>` : ''}

      <div class="text-muted" style="font-size:12px;margin-top:10px">
        입고검사(품질 게이트) 기록을 기준으로 집계합니다. 검사 건이 없는 기간은 0%로 표시됩니다.
        상단 공장 선택 시 해당 공장 입고건의 검사만 집계합니다.
      </div>
    </div>`;
  };

  const drawChart = () => {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('ds-month-chart');
    if (!canvas) return;
    if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
    const { labels, rows } = load();
    const mon = byMonth(labels, rows);
    chart = new Chart(canvas, {
      data: {
        labels: mon.map(m => m.month),
        datasets: [
          { type: 'bar', label: '검사 건수', data: mon.map(m => m.total), backgroundColor: 'rgba(79,156,255,0.35)', borderColor: '#4f9cff', borderWidth: 1, yAxisID: 'y' },
          { type: 'bar', label: '부적합 건수', data: mon.map(m => m.fail), backgroundColor: 'rgba(229,72,77,0.55)', borderColor: '#e5484d', borderWidth: 1, yAxisID: 'y' },
          { type: 'line', label: '부적합률(%)', data: mon.map(m => m.rate), borderColor: '#e0912f', backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { beginAtZero: true, position: 'left', title: { display: true, text: '건수', color: '#8892a6', font: { size: 10 } }, ticks: { color: '#8892a6', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { beginAtZero: true, position: 'right', title: { display: true, text: '부적합률(%)', color: '#8892a6', font: { size: 10 } }, ticks: { color: '#8892a6', font: { size: 10 } }, grid: { drawOnChartArea: false } },
        },
      },
    });
  };

  const ensureStyle = () => {
    if (document.getElementById('ds-style')) return;
    const st = document.createElement('style'); st.id = 'ds-style';
    st.textContent = `@media (max-width:900px){ .ds-grid{grid-template-columns:1fr !important;} }`;
    document.head.appendChild(st);
  };

  const afterRender = () => { ensureStyle(); drawChart(); };
  const setMonths = (n) => { months = n; App.refreshPage(); };

  // 원인별 집계를 회의 안건으로 — 개별 검사건이 아니라 "이 원인 N건"을 통째로 올린다.
  //   집계행이라 레코드 id 가 없으므로 원인코드와 조회기간을 합성키로 쓴다.
  const toAgenda = (kind, key) => {
    if (typeof MeetingPage === 'undefined') return;
    const { labels, rows } = load();
    const period = labels.length ? `${labels[0]} ~ ${labels[labels.length - 1]}` : `최근 ${months}개월`;
    if (kind === 'cause') {
      const c = byCause(rows).find(x => (x.code || '') === key);
      if (!c) return;
      MeetingPage.quickAgenda({
        sourceType: 'DEFECT', sourceId: `cause|${key || 'NOCODE'}|${months}m`,
        sourceLabel: `부적합 통계 ${period}`,
        title: `[부적합] ${c.name} ${c.n}건 (${period})`,
        content: `조회기간 ${period} 부적합 ${c.n}건, 전체의 ${c.share}%.\n해당 원료: ${c.mats || '-'}`,
        category: '원료 품질',
        factory: fac(),
        priority: c.share >= 40 ? '높음' : '보통',
      });
    } else {
      const m = byMaterial(rows).find(x => (x.code || '') === key || x.name === key);
      if (!m) return;
      MeetingPage.quickAgenda({
        sourceType: 'DEFECT', sourceId: `mat|${key}|${months}m`,
        sourceLabel: `부적합 통계 ${period}`,
        title: `[부적합 다발] ${m.name} ${m.fail}건 / 부적합률 ${m.rate}%`,
        content: `조회기간 ${period} 검사 ${m.total}건 중 부적합 ${m.fail}건(${m.rate}%).`,
        category: '원료 품질',
        factory: fac(),
        priority: m.rate >= 20 ? '높음' : '보통',
      });
    }
  };

  // 대시보드 연동용 요약
  const summary = () => {
    const { labels, rows } = load();
    const total = rows.length, fail = rows.filter(i => i.verdict === 'FAIL').length;
    const top = byItem(rows)[0] || null;
    return { months, total, fail, rate: pct(fail, total), topType: top ? top.name : '', topN: top ? top.n : 0 };
  };

  return { render, afterRender, setMonths, summary, toAgenda };
})();
