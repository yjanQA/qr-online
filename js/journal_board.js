// ============================================================
// journal_board.js — 일지 현황 · 결재함
//   · 결재함 : 내가 처리해야 할 상신 일지를 한 화면에서 검토·승인·반려
//   · 작성 현황 : 양식별 최근 작성일 / 작성기한 초과 / 미조치 이탈
//   · 월별 추이 : 작성 건수 · 승인 건수 · 이탈 건수
//   · 현장 QR : 작업장에 붙여두고 휴대폰으로 찍으면 해당 일지 작성 화면으로 진입
// ============================================================

const JournalBoardPage = (() => {
  let months = 12;
  let tab = 'BOX';           // BOX(결재함) | DUE(작성현황) | QR(현장QR)
  let chart = null;

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const facName = (f) => (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(f) : f;
  const myEmail = () => { try { return Auth.currentEmail() || ''; } catch (_) { return ''; } };
  const fmtDT = (s) => s ? String(s).replace('T', ' ').slice(0, 16) : '-';

  const render = () => {
    const f = fac();
    const st = JournalDB.stats(f);
    const box = JournalDB.myApprovals(myEmail(), f);
    const due = JournalDB.dueList(f);
    const overdue = due.filter(d => d.overdue > 0).sort((a, b) => b.overdue - a.overdue);
    const openNgRecs = JournalDB.getRecords({ factory: f }).filter(r => (r.openNg || 0) > 0);

    const banner = [];
    if (overdue.length) banner.push(`<div class="card alert-banner alert-danger">
      <b>작성기한 초과 ${overdue.length}종</b> — ${overdue.slice(0, 4).map(d => `${esc(d.tpl.name)}(${d.last ? d.overdue + '일 경과' : '작성이력 없음 ' + d.overdue + '일'})`).join(', ')}${overdue.length > 4 ? ` 외 ${overdue.length - 4}종` : ''}
    </div>`);
    if (openNgRecs.length) banner.push(`<div class="card alert-banner alert-danger">
      <b>미조치 이탈 ${st.openNg}건</b> — 개선조치가 입력되지 않은 일지 ${openNgRecs.length}건이 있습니다.
    </div>`);
    if (box.length) banner.push(`<div class="card alert-banner alert-warn">
      <b>결재 대기 ${box.length}건</b> — 아래 결재함에서 검토·승인 처리하세요.
    </div>`);

    const tabs = [['BOX', `결재함 (${box.length})`], ['DUE', '작성 현황'], ['QR', '현장 QR']].map(([k, l]) =>
      `<button class="factory-tab ${tab === k ? 'active' : ''}" onclick="JournalBoardPage.setTab('${k}')">${l}</button>`).join('');

    return `
      <div class="fade-in">
        ${banner.join('')}

        <div class="inventory-summary-grid mb-20">
          <div class="inventory-summary-card"><div class="summary-label">누적 작성</div><div class="summary-value">${st.total}<span>건</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">승인 완료</div><div class="summary-value">${st.approved}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.submitted > 0 ? 'summary-risk' : ''}"><div class="summary-label">결재 진행중</div><div class="summary-value">${st.submitted}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.openNg > 0 ? 'summary-risk' : ''}"><div class="summary-label">미조치 이탈</div><div class="summary-value">${st.openNg}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.overdue > 0 ? 'summary-risk' : ''}"><div class="summary-label">기한 초과</div><div class="summary-value">${st.overdue}<span>종</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">결재 완료율</div><div class="summary-value">${st.approveRate}<span>%</span></div></div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">일지 작성·결재 추이</div>
            <div class="factory-tabs">${[6, 12, 24].map(m =>
              `<button class="factory-tab ${months === m ? 'active' : ''}" onclick="JournalBoardPage.setMonths(${m})">${m}개월</button>`).join('')}</div>
          </div>
          <div class="chart-wrapper" style="height:240px"><canvas id="jb-chart"></canvas></div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">일지 관리</div><div class="factory-tabs">${tabs}</div></div>
          ${tab === 'BOX' ? boxPanel(box) : tab === 'DUE' ? duePanel(due, openNgRecs) : qrPanel()}
        </div>
      </div>`;
  };

  // ── 결재함 ──
  const boxPanel = (box) => {
    if (!box.length) return `<div class="empty-state text-muted" style="padding:30px;text-align:center">처리할 결재가 없습니다</div>`;
    const rows = box.map(r => {
      const sm = JournalDB.statusMeta(r.status);
      const openNg = r.openNg || 0;
      return `<tr>
        <td class="td-mono text-xs">${esc(r.date)}</td>
        <td><strong>${esc(r.tplName)}</strong> <span class="text-muted text-xs">${esc(r.tplCode)}</span></td>
        <td class="text-xs">${esc(facName(r.factory))}</td>
        <td class="text-xs">${esc(r.writer || '-')}</td>
        <td style="text-align:center">${r.ng > 0
          ? `<span class="badge badge-fail">이탈 ${r.ng}</span>${openNg ? ` <span class="text-xs" style="color:var(--danger)">미조치 ${openNg}</span>` : ''}`
          : '<span class="badge badge-pass">이상없음</span>'}</td>
        <td class="text-xs">${fmtDT(r.submittedAt)}</td>
        <td style="text-align:center"><span class="badge ${sm.cls}">${sm.label}</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="JournalBoardPage.openRec('${r.id}')">상세</button>
          ${r.status === 'SUBMITTED' ? `<button class="btn btn-ghost btn-xs" onclick="JournalBoardPage.act('review','${r.id}')">검토</button>` : ''}
          <button class="btn btn-ghost btn-xs" onclick="JournalBoardPage.act('approve','${r.id}')">승인</button>
          <button class="btn btn-ghost btn-xs" onclick="JournalBoardPage.act('reject','${r.id}')">반려</button>
        </td>
      </tr>`;
    }).join('');
    return `
      <div class="table-wrapper"><table>
        <thead><tr><th>작성일</th><th>일지</th><th>공장</th><th>작성자</th><th style="text-align:center">판정</th><th>상신일시</th><th style="text-align:center">상태</th><th>결재</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  };

  // ── 작성 현황 ──
  const duePanel = (due, openNgRecs) => {
    const sorted = due.slice().sort((a, b) => (b.overdue - a.overdue) || (a.tpl.code || '').localeCompare(b.tpl.code || ''));
    const rows = sorted.map(d => {
      const cyc = JournalDB.CYCLES[d.tpl.cycle] || JournalDB.CYCLES.EVENT;
      const state = cyc.days === 0 ? '<span class="text-muted">수시</span>'
        : !d.last ? `<span class="badge badge-fail">작성이력 없음 ${d.overdue}일</span>`
        : d.overdue > 0 ? `<span class="badge badge-fail">${d.overdue}일 초과</span>`
        : '<span class="badge badge-pass">정상</span>';
      return `<tr>
        <td class="td-mono text-xs">${esc(d.tpl.code)}</td>
        <td><strong>${esc(d.tpl.name)}</strong></td>
        <td class="text-xs">${esc(d.tpl.category)}</td>
        <td class="text-xs">${cyc.label}</td>
        <td class="text-xs">${d.last ? esc(d.last) : '-'}</td>
        <td class="text-xs">${d.due ? esc(d.due) : '-'}</td>
        <td style="text-align:center">${state}</td>
        <td style="text-align:center">${d.count}</td>
        <td style="text-align:center">${d.ng > 0 ? `<span style="color:var(--danger)">${d.ng}</span>` : '0'}</td>
      </tr>`;
    }).join('');

    const ngRows = openNgRecs.length ? openNgRecs.map(r => {
      const devs = JournalDB.openDeviations(r);
      return `<tr style="cursor:pointer" onclick="JournalBoardPage.openRec('${r.id}')">
        <td class="td-mono text-xs">${esc(r.date)}</td>
        <td><strong>${esc(r.tplName)}</strong></td>
        <td class="text-xs">${esc(facName(r.factory))}</td>
        <td class="text-xs">${devs.slice(0, 3).map(d => `${d.target ? esc(d.target) + ' ' : ''}${esc(d.label)}=<b>${esc(d.value)}</b>`).join(', ')}${devs.length > 3 ? ` 외 ${devs.length - 3}건` : ''}</td>
        <td style="text-align:center"><span class="badge badge-fail">${devs.length}건</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:16px">미조치 이탈이 없습니다</td></tr>';

    return `
      <div class="table-wrapper mb-20"><table>
        <thead><tr><th>코드</th><th>일지명</th><th>구분</th><th>주기</th><th>최근작성</th><th>다음기한</th><th style="text-align:center">상태</th><th style="text-align:center">누적</th><th style="text-align:center">이탈</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <div class="section-title mb-12">개선조치 미입력 이탈</div>
      <div class="table-wrapper"><table>
        <thead><tr><th>작성일</th><th>일지</th><th>공장</th><th>이탈 내용</th><th style="text-align:center">건수</th></tr></thead>
        <tbody>${ngRows}</tbody>
      </table></div>`;
  };

  // ── 현장 QR ──
  //   작업장 벽면에 붙여두고 휴대폰으로 찍으면 해당 일지 작성 화면으로 바로 들어간다.
  const qrPanel = () => {
    const tpls = JournalDB.getTemplates({ activeOnly: true, factory: fac() });
    const cards = tpls.map(t => `
      <div class="card" style="padding:14px;text-align:center">
        <div style="font-weight:600;font-size:13px;margin-bottom:2px">${esc(t.name)}</div>
        <div class="text-muted text-xs mb-8">${esc(t.code)} · ${JournalDB.cycleLabel(t.cycle)}</div>
        <div id="jbqr-${t.id}" style="display:flex;justify-content:center"></div>
      </div>`).join('');
    return `
      <div class="text-muted text-xs mb-12">아래 QR을 인쇄해 해당 작업장에 부착하세요. 현장 휴대폰으로 찍으면 로그인 후 그 일지의 작성 화면이 열립니다.</div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn btn-outline-primary btn-sm" onclick="JournalBoardPage.printQR()">QR 인쇄</button></div>
      <div id="jb-qr-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px">${cards}</div>`;
  };

  const qrLink = (tplId) => {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
    return `${base}?page=journal&tpl=${encodeURIComponent(tplId)}`;
  };
  const drawQR = () => {
    if (tab !== 'QR' || typeof QRCode === 'undefined') return;
    JournalDB.getTemplates({ activeOnly: true, factory: fac() }).forEach(t => {
      const el = document.getElementById('jbqr-' + t.id);
      if (!el || el.childNodes.length) return;
      try { new QRCode(el, { text: qrLink(t.id), width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M }); } catch (_) {}
    });
  };
  const printQR = () => {
    const grid = document.getElementById('jb-qr-grid');
    if (!grid) return;
    const w = window.open('', '_blank');
    if (!w) { App.toast('팝업이 차단되었습니다', 'warning'); return; }
    w.document.write(`<title>일지 현장 QR</title><style>
      body{font-family:'Malgun Gothic',sans-serif;margin:16px}
      .g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
      .c{border:1px solid #ccc;border-radius:8px;padding:12px;text-align:center;page-break-inside:avoid}
      .c img,.c canvas{margin:6px auto;display:block}
      .n{font-weight:700;font-size:14px}.s{color:#666;font-size:11px}
    </style><div class="g">${
      Array.from(grid.children).map(c => `<div class="c">${c.innerHTML}</div>`).join('')
    }</div>`);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch (_) {} }, 400);
  };

  // ── 결재 액션 ──
  const openRec = (id) => { App.navigate('journal'); setTimeout(() => { try { JournalPage.open(id); } catch (_) {} }, 0); };
  const act = (kind, id) => {
    let res;
    if (kind === 'review') res = JournalDB.review(id, prompt('검토 의견 (선택)') ?? '');
    else if (kind === 'approve') {
      const r = JournalDB.getRecord(id);
      if (r && JournalDB.openDeviations(r).length) { App.toast('미조치 이탈이 있어 승인할 수 없습니다', 'warning'); return; }
      res = JournalDB.approve(id, prompt('승인 의견 (선택)') ?? '');
    } else {
      const c = prompt('반려 사유를 입력하세요');
      if (c === null) return;
      if (!c.trim()) { App.toast('반려 사유는 필수입니다', 'error'); return; }
      res = JournalDB.reject(id, c.trim());
    }
    App.toast(res.ok ? '처리되었습니다' : res.msg, res.ok ? 'success' : 'warning');
    App.refreshPage();
  };

  const drawChart = () => {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('jb-chart');
    if (!canvas) return;
    if (chart) { try { chart.destroy(); } catch (_) {} chart = null; }
    const t = JournalDB.monthlyTrend(fac(), months);
    chart = new Chart(canvas, {
      data: {
        labels: t.labels,
        datasets: [
          { type: 'bar', label: '작성', data: t.written, backgroundColor: 'rgba(79,156,255,0.35)', borderColor: '#4f9cff', borderWidth: 1, yAxisID: 'y' },
          { type: 'bar', label: '승인완료', data: t.approved, backgroundColor: 'rgba(48,164,108,0.45)', borderColor: '#30a46c', borderWidth: 1, yAxisID: 'y' },
          { type: 'line', label: '이탈', data: t.ng, borderColor: '#e5484d', backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { beginAtZero: true, position: 'left', title: { display: true, text: '일지(건)', color: '#8892a6', font: { size: 10 } }, ticks: { color: '#8892a6', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { beginAtZero: true, position: 'right', title: { display: true, text: '이탈(건)', color: '#8892a6', font: { size: 10 } }, ticks: { color: '#8892a6', font: { size: 10 }, precision: 0 }, grid: { drawOnChartArea: false } },
        },
      },
    });
  };

  const afterRender = () => { drawChart(); drawQR(); };
  const setMonths = (m) => { months = m; App.refreshPage(); };
  const setTab = (t) => { tab = t; App.refreshPage(); };

  return { render, afterRender, setMonths, setTab, openRec, act, printQR };
})();
