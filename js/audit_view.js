// ============================================================
// audit_view.js — 통합 수정 이력(감사 추적) 조회
//   전 업무에 흩어진 editHistory/history/logs 를 AuditLog.collect() 로 한 형태로
//   모아 한 화면에서 검색·필터·CSV 내보내기 한다. (관리자용)
// ============================================================

const AuditViewPage = (() => {
  let fModule = 'ALL';
  let fFrom = '';
  let fTo = '';
  let fQuery = '';
  let cache = [];        // 최근 collect 결과(내보내기용)
  const CAP = 500;

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const AL = () => (typeof AuditLog !== 'undefined') ? AuditLog : (window.AuditLog || null);

  const filtered = () => {
    const al = AL(); if (!al || !al.collect) return [];
    let rows = al.collect();
    if (fModule !== 'ALL') rows = rows.filter(r => r.module === fModule);
    if (fFrom) rows = rows.filter(r => String(r.ts).slice(0, 10) >= fFrom);
    if (fTo) rows = rows.filter(r => String(r.ts).slice(0, 10) <= fTo);
    const q = fQuery.trim().toLowerCase();
    if (q) rows = rows.filter(r =>
      (r.target || '').toLowerCase().includes(q) ||
      (r.by || '').toLowerCase().includes(q) ||
      (r.summary || '').toLowerCase().includes(q) ||
      (r.action || '').toLowerCase().includes(q) ||
      (r.module || '').toLowerCase().includes(q));
    cache = rows;
    return rows;
  };

  const fmtTs = (ts) => {
    const s = String(ts || '');
    if (!s) return '-';
    return s.slice(0, 16).replace('T', ' ');
  };

  const render = () => {
    const al = AL();
    if (!al || !al.collect) {
      return `<div class="empty-state"><h3>감사 로거를 불러올 수 없습니다</h3><p>audit_log.js 로드를 확인하세요.</p></div>`;
    }
    const all = filtered();
    const rows = all.slice(0, CAP);
    const mods = al.modules ? al.modules() : [];
    const modCounts = {};
    al.collect().forEach(r => { modCounts[r.module] = (modCounts[r.module] || 0) + 1; });
    const totalAll = al.collect().length;

    const body = rows.length ? rows.map(r => `
      <tr>
        <td class="mono" style="white-space:nowrap">${esc(fmtTs(r.ts))}</td>
        <td><span class="badge badge-default">${esc(r.module)}</span></td>
        <td>${esc(r.target) || '<span class="text-muted">-</span>'}</td>
        <td>${esc(r.action)}</td>
        <td><b>${esc(r.by) || '<span class="text-muted">(미상)</span>'}</b>${r.byEmail ? `<div class="text-xs text-muted">${esc(r.byEmail)}</div>` : ''}</td>
        <td style="max-width:360px">${esc(r.summary) || '<span class="text-muted">-</span>'}${r.reason ? `<div class="text-xs" style="color:#b8860b">사유: ${esc(r.reason)}</div>` : ''}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:28px">조건에 맞는 수정 이력이 없습니다</td></tr>`;

    const modOpts = ['ALL', ...mods].map(m =>
      `<option value="${esc(m)}" ${fModule === m ? 'selected' : ''}>${m === 'ALL' ? '전체 업무' : esc(m)}${m !== 'ALL' && modCounts[m] ? ` (${modCounts[m]})` : ''}</option>`).join('');

    const capNote = all.length > CAP
      ? `<div class="text-muted" style="font-size:12px;margin-top:8px">※ ${all.length.toLocaleString()}건 중 최근 ${CAP}건만 표시 — 기간·업무·검색으로 좁히세요.</div>` : '';

    return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div class="card-title">수정 이력 통합 조회 <span class="text-muted" style="font-weight:400">전 업무 감사 추적</span></div>
        <span class="text-muted" style="font-size:12px">누가·언제·무엇을 고쳤는지 한 곳에서 확인</span>
      </div>
      <div class="text-muted" style="font-size:12.5px;line-height:1.7">
        협력사·배합비·공정이슈·유효성평가·계측기·구서·심사지적·회의·SQF·분석대장·코드·등록증·HACCP·일지·규격·VOC 등
        전 업무의 수정 내역을 모읍니다. 작성자는 로그인 사용자로 자동 기록됩니다.
      </div>
    </div>

    <div class="card">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
        <div class="form-group" style="margin:0;min-width:150px">
          <label class="form-label">업무</label>
          <select class="form-input form-input-sm" onchange="AuditViewPage.setModule(this.value)">${modOpts}</select>
        </div>
        <div class="form-group" style="margin:0"><label class="form-label">시작일</label><input type="date" class="form-input form-input-sm" value="${fFrom}" onchange="AuditViewPage.setFrom(this.value)"></div>
        <div class="form-group" style="margin:0"><label class="form-label">종료일</label><input type="date" class="form-input form-input-sm" value="${fTo}" onchange="AuditViewPage.setTo(this.value)"></div>
        <div class="form-group" style="margin:0;flex:1;min-width:200px">
          <label class="form-label">검색 (대상·작성자·내용)</label>
          <input type="text" class="form-input form-input-sm" id="av-q" value="${esc(fQuery)}" placeholder="예: 홍길동, 연락처, 배합비" oninput="AuditViewPage.onSearch(this.value)">
        </div>
        <span class="text-muted" style="font-size:12px">전체 <b>${totalAll.toLocaleString()}</b>건 · 조회 <b id="av-count">${all.length.toLocaleString()}</b>건</span>
        <button class="btn btn-ghost btn-sm" onclick="AuditViewPage.exportCsv()">CSV 내보내기</button>
      </div>
      <div class="table-wrap" style="max-height:min(720px,calc(100vh - 400px));overflow:auto">
        <table class="data-table compact">
          <thead><tr>
            <th>일시</th><th>업무</th><th>대상</th><th>동작</th><th>작성자</th><th>변경 내용</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${capNote}
    </div>`;
  };

  let searchTimer = null;
  const onSearch = (v) => {
    fQuery = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { App.refreshPage(); const el = document.getElementById('av-q'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300);
  };
  const setModule = (v) => { fModule = v; App.refreshPage(); };
  const setFrom = (v) => { fFrom = v; App.refreshPage(); };
  const setTo = (v) => { fTo = v; App.refreshPage(); };

  const exportCsv = () => {
    const rows = cache && cache.length ? cache : filtered();
    if (!rows.length) { App.toast('내보낼 이력이 없습니다', 'warning'); return; }
    const head = ['일시', '업무', '대상', '동작', '작성자', '이메일', '변경내용', '사유'];
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(',')];
    rows.forEach(r => lines.push([fmtTs(r.ts), r.module, r.target, r.action, r.by, r.byEmail, r.summary, r.reason].map(cell).join(',')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = `수정이력_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
    App.toast(`${rows.length}건을 CSV로 내려받았습니다.`, 'success');
  };

  return { render, onSearch, setModule, setFrom, setTo, exportCsv };
})();
