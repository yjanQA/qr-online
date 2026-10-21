// ============================================================
// office_audit.js — 영업소 심사 체크리스트 (전산화 + 누적 대시보드)
//   · 영업소 선택 → 체크리스트 입력(구분별 배점/개선요망사항)
//   · 심사일별 누적 → 총점 추이·카테고리 레이더·영업소 비교 대시보드
//   · 상세는 원본 양식으로 인쇄/PDF (openReportOverlay 재사용)
// ============================================================

const OfficeAuditPage = (() => {
  let mode = 'overview';   // 'overview' | 'form' | 'detail'
  let office = 'ALL';      // 대시보드 영업소 필터
  let detailId = null;
  let editId = null;
  let manageOffices = false; // 영업소 관리 패널 표시
  let trendChart = null, radarChart = null;

  const OA = () => OfficeAuditDB;
  const fmt0 = (n) => (typeof fmtNum === 'function' ? fmtNum(n, 0) : String(n ?? 0));
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const oName = (c) => OA().officeName(c);

  // 자체 스타일 1회 주입(모듈 자족)
  const ensureStyle = () => {
    if (document.getElementById('oa-style')) return;
    const st = document.createElement('style'); st.id = 'oa-style';
    st.textContent = `
    .oa-opts{display:flex;flex-wrap:wrap;gap:6px}
    .oa-opt{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid var(--border,#d5dae3);border-radius:16px;font-size:12px;cursor:pointer;user-select:none;white-space:nowrap;transition:border-color .12s,background .12s}
    .oa-opt input{margin:0;cursor:pointer}
    .oa-opt .oa-pts{font-family:'Consolas',monospace;font-size:11px;color:var(--text-muted,#8892a6);margin-left:3px}
    .oa-opt.on{border-color:var(--accent,#3E6AE1);background:rgba(62,106,225,0.10);font-weight:700}
    .oa-opt.on .oa-pts{color:var(--accent,#3E6AE1)}
    .oa-form-table td{vertical-align:middle}
    .oa-form-table .oa-q{font-size:13px;line-height:1.4}
    .oa-d-opt{display:inline-block;padding:1px 8px;border-radius:12px;font-size:12px;color:var(--text-muted,#8892a6);border:1px solid transparent}
    .oa-d-opt.on{border-color:var(--accent,#3E6AE1);color:var(--accent,#3E6AE1);font-weight:800;background:rgba(62,106,225,0.08)}`;
    document.head.appendChild(st);
  };

  // ── 개요 / 대시보드 ──
  const renderOverview = () => {
    const audits = OA().getAudits(office);
    const isAll = office === 'ALL';

    // 필터 바
    const officeTabs = [['ALL', '전체']].concat(OA().getOffices().map(o => [o.code, o.name.replace('영업소', '')]))
      .map(([v, l]) => `<button class="btn btn-sm ${office === v ? 'btn-primary' : 'btn-ghost'}" onclick="OfficeAuditPage.setOffice('${v}')">${esc(l)}</button>`).join('');
    const filterBar = `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="text-muted" style="font-size:12px">영업소</span>${officeTabs}
        <div style="flex:1"></div>
        <button class="btn btn-ghost btn-sm" onclick="OfficeAuditPage.toggleManageOffices()">${manageOffices ? '✕ 관리 닫기' : '영업소 관리'}</button>
        <button class="btn btn-primary btn-sm" onclick="OfficeAuditPage.openNew()">＋ 심사 입력</button>
      </div>
    </div>`;

    // 영업소 관리 패널 (추가/이름변경/삭제)
    const officePanel = !manageOffices ? '' : (() => {
      const rows = OA().getOffices().map(o => {
        const n = OA().getAudits(o.code).length;
        return `<tr>
          <td><input type="text" class="form-input form-input-sm" id="oa-off-${esc(o.code)}" value="${esc(o.name)}"></td>
          <td class="mono text-muted" style="text-align:center">${n}건</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-ghost btn-xs" onclick="OfficeAuditPage.saveOfficeName('${esc(o.code)}')">이름 저장</button>
            <button class="btn btn-ghost btn-xs" onclick="OfficeAuditPage.deleteOffice('${esc(o.code)}')">삭제</button>
          </td>
        </tr>`;
      }).join('');
      return `
      <div class="card" style="margin-bottom:14px">
        <div class="section-label">영업소 관리 <span class="text-muted" style="font-size:11px;font-weight:400">· 이름 변경 시 기존 심사기록에 자동 반영 · 심사기록 있는 영업소는 삭제 불가</span></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>영업소명</th><th style="width:70px">심사</th><th style="width:150px"></th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
          <input type="text" class="form-input form-input-sm" id="oa-new-office" placeholder="새 영업소명 (예: 대구영업소)" style="max-width:240px" onkeydown="if(event.key==='Enter'){OfficeAuditPage.addOffice();}">
          <button class="btn btn-primary btn-sm" onclick="OfficeAuditPage.addOffice()">＋ 영업소 추가</button>
        </div>
      </div>`;
    })();

    // 요약 통계
    const totals = audits.map(a => OA().totalScore(a));
    const avg = totals.length ? Math.round(totals.reduce((s, v) => s + v, 0) / totals.length) : null;
    const latest = audits[0] || null;
    const latestTotal = latest ? OA().totalScore(latest) : null;
    const gr = latestTotal != null ? OA().gradeOf(latestTotal) : null;
    const officesAudited = new Set(OA().getAudits('ALL').map(a => a.office)).size;
    const statCards = `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">${isAll ? '심사 영업소' : '심사 횟수'}</div>
        <div class="stat-value">${isAll ? officesAudited : audits.length}</div>
        <div class="stat-sub">${isAll ? `전체 ${OA().getOffices().length}개소 중` : esc(oName(office))}</div></div>
      <div class="stat-card"><div class="stat-label">최근 심사 총점</div>
        <div class="stat-value" ${gr ? `style="color:${gr.color}"` : ''}>${latestTotal != null ? latestTotal : '-'}<span style="font-size:13px;color:var(--text-muted)"> / ${OA().MAX_TOTAL}</span></div>
        <div class="stat-sub">${latest ? `${esc(latest.date)} · ${gr.g}(${gr.label})` : '심사 기록 없음'}</div></div>
      <div class="stat-card"><div class="stat-label">평균 총점</div>
        <div class="stat-value">${avg != null ? avg : '-'}</div>
        <div class="stat-sub">${totals.length ? `${totals.length}회 평균` : '-'}</div></div>
      <div class="stat-card"><div class="stat-label">총 심사 건수</div>
        <div class="stat-value">${OA().getAudits('ALL').length}</div>
        <div class="stat-sub">전 영업소 누적</div></div>
    </div>`;

    // 차트 2개 (총점 추이 · 카테고리 레이더)
    const win = (id, title, body) => `
      <div class="win" data-win="${id}" style="position:static;width:auto;height:auto">
        <div class="win-head"><span class="win-title">${title}</span></div>
        <div class="win-body" style="height:290px">${body}</div>
      </div>`;
    const charts = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
      ${win('oa-trend', isAll ? '심사일별 평균 총점 추이' : `${esc(oName(office))} 총점 추이`, `<div class="chart-frame" style="height:100%"><canvas id="oa-trend-chart"></canvas></div>`)}
      ${win('oa-radar', `카테고리 달성률(%) ${isAll ? '· 전체 평균' : ''}`, `<div class="chart-frame" style="height:100%"><canvas id="oa-radar-chart"></canvas></div>`)}
    </div>`;

    // 영업소 비교 (전체일 때) — 최근 총점/평균/등급
    let compare = '';
    if (isAll) {
      const rows = OA().latestByOffice().map(o => {
        const g = o.total != null ? OA().gradeOf(o.total) : null;
        return `<tr ${o.count ? `onclick="OfficeAuditPage.setOffice('${o.code}')" style="cursor:pointer"` : 'class="text-muted"'}>
          <td><b>${esc(o.name)}</b></td>
          <td class="mono">${o.count || 0}회</td>
          <td class="text-muted">${esc(o.latestDate || '-')}</td>
          <td class="mono">${o.total != null ? o.total : '-'}</td>
          <td class="mono">${o.avg != null ? o.avg : '-'}</td>
          <td>${g ? `<span class="verdict" style="color:${g.color}">${g.g} ${g.label}</span>` : '<span class="text-muted">미심사</span>'}</td>
        </tr>`;
      }).join('');
      compare = `
      <div class="card" style="margin-bottom:14px">
        <div class="section-label">영업소별 현황 <span class="text-muted" style="font-size:11px;font-weight:400">· 최근 심사 기준 · 행 클릭 시 해당 영업소</span></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>영업소</th><th>심사</th><th>최근 심사일</th><th>최근 총점</th><th>평균</th><th>등급</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>`;
    }

    // 최근 심사 개선필요 항목(주목)
    let attention = '';
    const att = OA().attentionItems(office);
    if (att.length) {
      const rows = att.map(a => `<tr>
        <td><span class="tag tag-gray" style="font-size:10px">${esc(a.cat)}</span></td>
        <td>${esc(a.q)}</td>
        <td class="mono"><b class="${a.score === 0 || a.label === '미흡' ? 'v-high' : ''}">${esc(a.label)}(${a.score})</b> <span class="text-muted">/ ${a.max}</span></td>
        <td class="text-muted">${esc(a.note || '-')}</td>
      </tr>`).join('');
      attention = `
      <div class="card" style="margin-bottom:14px">
        <div class="section-label">최근 심사 개선필요 항목 <span class="text-muted" style="font-size:11px;font-weight:400">· ${esc(latest ? oName(latest.office) + ' ' + latest.date : '')} · 만점 미달 ${att.length}건</span></div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>구분</th><th>점검사항</th><th>평가</th><th>개선요망</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>`;
    }

    // 심사 목록
    const cats = OA().CHECKLIST;
    const listRows = audits.map(a => {
      const t = OA().totalScore(a); const g = OA().gradeOf(t);
      return `<tr onclick="OfficeAuditPage.openDetail('${esc(a.id)}')" style="cursor:pointer">
        <td><b>${esc(oName(a.office))}</b></td>
        <td class="mono">${esc(a.date)}</td>
        <td class="text-muted">${esc(a.auditor || '-')}</td>
        ${cats.map(c => `<td class="mono">${OA().categoryScore(a, c.key)}<span class="text-muted" style="font-size:10px">/${c.max}</span></td>`).join('')}
        <td class="mono"><b>${t}</b></td>
        <td><span class="verdict" style="color:${g.color}">${g.g}</span></td>
      </tr>`;
    }).join('') || `<tr><td colspan="${4 + cats.length + 2}" class="text-muted" style="text-align:center;padding:20px">심사 기록이 없습니다. 「＋ 심사 입력」으로 추가하세요.</td></tr>`;
    const list = `
    <div class="card">
      <div class="section-label">심사 목록 ${!isAll ? `<span class="tag tag-blue" style="font-size:11px">${esc(oName(office))}</span>` : ''}</div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>영업소</th><th>심사일</th><th>심사자</th>${cats.map(c => `<th>${esc(c.key)}<span class="text-muted" style="font-size:10px">/${c.max}</span></th>`).join('')}<th>총점</th><th>등급</th></tr></thead>
        <tbody>${listRows}</tbody></table></div>
      <div class="text-muted" style="font-size:12px;margin-top:8px">행 클릭 시 상세(원본 양식)·인쇄/PDF·수정. 총점 100점(제품40·물류16·위생32·안전6·기타6).</div>
    </div>`;

    return filterBar + officePanel + statCards + charts + compare + attention + list;
  };

  // ── 입력 / 수정 폼 ──
  const renderForm = () => {
    const editing = editId ? OA().getAudit(editId) : null;
    const today = new Date().toISOString().slice(0, 10);
    const defOffice = editing ? editing.office : (office !== 'ALL' ? office : '');
    const defAuditor = editing ? (editing.auditor || '') : ((typeof Auth !== 'undefined' && Auth.currentName && Auth.currentName()) || '');

    const officeOpts = ['<option value="">영업소 선택</option>']
      .concat(OA().getOffices().map(o => `<option value="${o.code}" ${defOffice === o.code ? 'selected' : ''}>${esc(o.name)}</option>`)).join('');

    const catBlocks = OA().CHECKLIST.map(c => {
      const rows = c.items.map(it => {
        const cur = editing && editing.scores ? editing.scores[it.id] : undefined;
        const opts = it.opts.map(([label, pts]) => {
          const on = cur != null && Number(cur) === pts;
          return `<label class="oa-opt ${on ? 'on' : ''}">
            <input type="radio" name="oa-${it.id}" value="${pts}" ${on ? 'checked' : ''} onchange="OfficeAuditPage.recalc()">
            <span>${label}<b class="oa-pts">${pts}</b></span></label>`;
        }).join('');
        const impNote = editing ? ((editing.improvements || []).find(x => x.id === it.id) || {}).note || '' : '';
        return `<tr>
          <td class="oa-q">${esc(it.q)}</td>
          <td class="oa-opts">${opts}</td>
          <td><input type="text" class="form-input form-input-sm" id="oa-note-${it.id}" value="${esc(impNote)}" placeholder="개선요망사항"></td>
        </tr>`;
      }).join('');
      return `
      <div class="card" style="margin-bottom:12px">
        <div class="section-label" style="display:flex;justify-content:space-between;align-items:center">
          <span>${esc(c.key)} <span class="text-muted" style="font-size:11px;font-weight:400">· 배점 ${c.max}점</span></span>
          <span class="mono" style="font-size:13px">소계 <b id="oa-cat-${c.key}">0</b> / ${c.max}</span>
        </div>
        <div class="table-wrap"><table class="data-table oa-form-table">
          <thead><tr><th style="width:52%">점검사항</th><th>점수</th><th style="width:26%">개선요망사항</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>`;
    }).join('');

    return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-head" style="display:flex;justify-content:space-between;align-items:center">
        <div class="section-label" style="margin:0">${editing ? '영업소 심사 수정' : '영업소 심사 입력'}</div>
        <button class="btn btn-ghost btn-sm" onclick="OfficeAuditPage.cancel()">← 취소</button>
      </div>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label">영업소 <span class="req">*</span></label>
          <select class="form-input" id="oa-office" ${editing ? 'disabled' : ''}>${officeOpts}</select>
          ${editing ? `<input type="hidden" id="oa-office" value="${esc(editing.office)}">` : ''}
        </div>
        <div class="form-group"><label class="form-label">심사일 <span class="req">*</span></label>
          <input type="date" class="form-input" id="oa-date" value="${esc(editing ? editing.date : today)}"></div>
        <div class="form-group"><label class="form-label">심사자</label>
          <input type="text" class="form-input" id="oa-auditor" value="${esc(defAuditor)}" placeholder="심사자명"></div>
      </div>
      <div class="oa-live" style="display:flex;gap:18px;flex-wrap:wrap;align-items:baseline;margin-top:6px">
        <div><span class="text-muted" style="font-size:12px">현재 총점</span> <b class="mono" style="font-size:20px" id="oa-total">0</b> <span class="text-muted">/ ${OA().MAX_TOTAL}</span></div>
        <div><span class="text-muted" style="font-size:12px">등급</span> <b id="oa-grade">-</b></div>
        <div><span class="text-muted" style="font-size:12px">미입력</span> <b class="mono" id="oa-missing">${OA().ITEMS.length}</b>개</div>
      </div>
    </div>
    ${catBlocks}
    <div class="card" style="margin-bottom:12px">
      <div class="form-group"><label class="form-label">종합 의견 / 비고</label>
        <textarea class="form-input" id="oa-note-summary" rows="2" placeholder="심사 총평, 주요 지적사항 요약">${esc(editing ? editing.note || '' : '')}</textarea></div>
    </div>
    <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:24px">
      <button class="btn btn-ghost" onclick="OfficeAuditPage.cancel()">취소</button>
      <button class="btn btn-primary" onclick="OfficeAuditPage.save()">${editing ? '수정 저장' : '심사 등록'}</button>
    </div>`;
  };

  // ── 상세 (원본 양식) ──
  const renderDetail = (a) => {
    const t = OA().totalScore(a); const g = OA().gradeOf(t);
    const catTables = OA().CHECKLIST.map(c => {
      const rows = c.items.map(it => {
        const cur = a.scores ? a.scores[it.id] : undefined;
        const opts = it.opts.map(([label, pts]) => {
          const on = cur != null && Number(cur) === pts;
          return `<span class="oa-d-opt ${on ? 'on' : ''}">${label}(${pts})</span>`;
        }).join(' ');
        const imp = (a.improvements || []).find(x => x.id === it.id);
        return `<tr>
          <td class="l">${esc(it.q)}</td>
          <td>${opts}</td>
          <td class="l">${esc(imp ? imp.note : '')}</td>
        </tr>`;
      }).join('');
      return `<table class="data-table compact" style="margin-bottom:10px">
        <thead><tr><th style="width:52%">${esc(c.key)} <span class="text-muted" style="font-weight:400;font-size:11px">(배점 ${c.max})</span></th><th>점수</th><th style="width:26%">개선요망사항</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">${esc(c.key)} 소계</td><td class="mono"><b>${OA().categoryScore(a, c.key)} / ${c.max}</b></td></tr></tfoot>
      </table>`;
    }).join('');

    return `
    <div class="card">
      <div class="card-head" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="OfficeAuditPage.backToList()">← 목록으로</button>
        <div class="section-label" style="margin:0">영업소 심사 상세</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="OfficeAuditPage.print('${esc(a.id)}')">인쇄 / PDF</button>
          <button class="btn btn-ghost btn-sm" onclick="OfficeAuditPage.openEdit('${esc(a.id)}')">수정</button>
          <button class="btn btn-ghost btn-sm" onclick="OfficeAuditPage.remove('${esc(a.id)}')">삭제</button>
        </div>
      </div>
      <div class="detail-head" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin:8px 0">
        <div><span class="text-muted" style="font-size:11px">영업소</span><div><span class="tag tag-blue">${esc(oName(a.office))}</span></div></div>
        <div><span class="text-muted" style="font-size:11px">심사일</span><div>${esc(a.date)}</div></div>
        <div><span class="text-muted" style="font-size:11px">심사자</span><div>${esc(a.auditor || '-')}</div></div>
        <div><span class="text-muted" style="font-size:11px">총점</span><div class="mono"><b style="font-size:17px">${t}</b> / ${OA().MAX_TOTAL}</div></div>
        <div><span class="text-muted" style="font-size:11px">등급</span><div><b style="color:${g.color}">${g.g} ${g.label}</b></div></div>
      </div>
      ${catTables}
      <div class="section-label" style="font-size:13px;margin-top:8px">종합 의견 / 비고</div>
      <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;background:var(--bg-surface);border:1px solid var(--border);border-radius:10px;padding:12px">${esc(a.note || '-')}</div>
      ${a.enteredBy ? `<div class="text-muted" style="font-size:11px;margin-top:8px">입력자: ${esc(a.enteredBy)}</div>` : ''}
    </div>`;
  };

  // 인쇄용 시트(openReportOverlay) — 원본 양식 재현
  const printSheet = (a) => {
    const t = OA().totalScore(a); const g = OA().gradeOf(t);
    const simpleRows = OA().CHECKLIST.map(c => {
      const items = c.items.map(it => {
        const cur = a.scores ? a.scores[it.id] : undefined;
        const opts = it.opts.map(([label, pts]) => `<span style="${cur != null && Number(cur) === pts ? 'font-weight:800;border:1.5px solid #000;border-radius:10px;padding:0 5px' : 'color:#777'}">${label}(${pts})</span>`).join(' ');
        const imp = (a.improvements || []).find(x => x.id === it.id);
        return `<tr><td>${esc(c.key)}</td><td class="l">${esc(it.q)}</td><td style="text-align:center">${opts}</td><td class="l">${esc(imp ? imp.note : '')}</td></tr>`;
      }).join('');
      return items + `<tr><td colspan="3" style="text-align:right;font-weight:700;background:#f2f2f2">${esc(c.key)} 총점 (${c.max}점)</td><td style="text-align:center;font-weight:800;background:#f2f2f2">${OA().categoryScore(a, c.key)}</td></tr>`;
    }).join('');

    return `
      <div class="rpt-h1">영업소 심사 체크리스트</div>
      <div class="rpt-sub">( ${esc(oName(a.office))} ) · ${esc(a.date)} · 심사자: ${esc(a.auditor || '-')}</div>
      <table class="rpt-tbl">
        <thead><tr><th style="width:8%">구분</th><th style="width:44%">점검사항</th><th style="width:26%">점수</th><th style="width:22%">개선요망사항</th></tr></thead>
        <tbody>${simpleRows}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right;font-weight:800">총점 (100점)</td><td style="text-align:center;font-weight:800">${t}</td></tr></tfoot>
      </table>
      <div style="margin-top:8px;font-size:12px">등급: <b style="color:${g.color}">${g.g}(${g.label})</b> · ${t} / ${OA().MAX_TOTAL}점</div>
      ${a.note ? `<div class="rpt-foot">종합의견: ${esc(a.note)}</div>` : ''}`;
  };

  const render = () => {
    ensureStyle();
    if (mode === 'form') return renderForm();
    if (mode === 'detail' && detailId) {
      const a = OA().getAudit(detailId);
      if (!a) { mode = 'overview'; detailId = null; return renderOverview(); }
      return renderDetail(a);
    }
    return renderOverview();
  };

  // ── 차트 ──
  const drawCharts = () => {
    if (typeof Chart === 'undefined') return;
    const trend = OA().totalTrend(office);
    const tc = document.getElementById('oa-trend-chart');
    if (tc) {
      if (trendChart) { trendChart.destroy(); trendChart = null; }
      trendChart = new Chart(tc, {
        type: 'line',
        data: { labels: trend.map(p => p.date), datasets: [{ label: '총점', data: trend.map(p => p.total), borderColor: '#3E6AE1', backgroundColor: 'rgba(62,106,225,0.12)', tension: 0.25, pointRadius: 4, fill: true }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(120,134,160,0.12)' } },
            y: { suggestedMin: 0, suggestedMax: 100, ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(120,134,160,0.12)' } },
          },
        },
      });
    }
    const rc = document.getElementById('oa-radar-chart');
    if (rc) {
      if (radarChart) { radarChart.destroy(); radarChart = null; }
      const rates = OA().categoryRates(office);
      radarChart = new Chart(rc, {
        type: 'radar',
        data: {
          labels: rates.map(r => `${r.key}(${r.avg}/${r.max})`),
          datasets: [{ label: '달성률', data: rates.map(r => r.rate), borderColor: '#E4002B', backgroundColor: 'rgba(228,0,43,0.14)', pointBackgroundColor: '#E4002B', borderWidth: 2 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `달성률 ${ctx.raw}%` } } },
          scales: { r: { suggestedMin: 0, suggestedMax: 100, ticks: { stepSize: 25, color: '#8892a6', backdropColor: 'transparent', font: { size: 9 } }, grid: { color: 'rgba(120,134,160,0.2)' }, angleLines: { color: 'rgba(120,134,160,0.2)' }, pointLabels: { color: '#5a6270', font: { size: 11 } } } },
        },
      });
    }
  };

  // ── 폼 실시간 합계 ──
  const recalc = () => {
    let total = 0, filled = 0;
    OA().CHECKLIST.forEach(c => {
      let cs = 0;
      c.items.forEach(it => {
        const el = document.querySelector(`input[name="oa-${it.id}"]:checked`);
        if (el) { cs += Number(el.value) || 0; filled++; }
      });
      const cell = document.getElementById(`oa-cat-${c.key}`);
      if (cell) cell.textContent = cs;
      total += cs;
    });
    const tEl = document.getElementById('oa-total'); if (tEl) tEl.textContent = total;
    const mEl = document.getElementById('oa-missing'); if (mEl) mEl.textContent = OA().ITEMS.length - filled;
    const gEl = document.getElementById('oa-grade');
    if (gEl) { const gr = OA().gradeOf(total); gEl.textContent = `${gr.g} ${gr.label}`; gEl.style.color = gr.color; }
    // 선택 하이라이트
    OA().ITEMS.forEach(it => {
      document.querySelectorAll(`input[name="oa-${it.id}"]`).forEach(r => {
        const lab = r.closest('.oa-opt'); if (lab) lab.classList.toggle('on', r.checked);
      });
    });
  };

  const save = () => {
    const office_ = val('oa-office');
    const date = val('oa-date');
    if (!office_) { App.toast('영업소를 선택하세요', 'error'); return; }
    if (!date) { App.toast('심사일을 선택하세요', 'error'); return; }
    const scores = {}; const improvements = []; let missing = 0;
    OA().ITEMS.forEach(it => {
      const el = document.querySelector(`input[name="oa-${it.id}"]:checked`);
      if (el) scores[it.id] = Number(el.value) || 0; else missing++;
      const note = (document.getElementById(`oa-note-${it.id}`)?.value || '').trim();
      if (note) improvements.push({ id: it.id, note });
    });
    if (missing > 0 && !confirm(`${missing}개 항목이 미입력입니다. 그대로 저장할까요?`)) return;
    // 중복 심사(같은 영업소·같은 날) 경고 — 신규일 때만
    if (!editId) {
      const dupId = `OA-${office_}-${date}`;
      if (OA().getAudit(dupId) && !confirm('같은 영업소·같은 날짜 심사가 이미 있습니다. 덮어쓸까요?')) return;
    }
    const rec = OA().saveAudit({
      id: editId || undefined,
      office: office_, date,
      auditor: val('oa-auditor'),
      scores, improvements,
      note: val('oa-note-summary'),
      enteredBy: (typeof Auth !== 'undefined' && Auth.currentEmail && Auth.currentEmail()) || '',
    });
    App.toast(`영업소 심사 저장됨 · ${oName(rec.office)} ${rec.date} (${OA().totalScore(rec)}점)`, 'success');
    mode = 'detail'; detailId = rec.id; editId = null;
    App.refreshPage();
  };

  // ── 영업소 관리 액션 ──
  const toggleManageOffices = () => { manageOffices = !manageOffices; App.refreshPage(); };
  const addOffice = () => {
    const name = val('oa-new-office');
    if (!name.trim()) { App.toast('영업소명을 입력하세요', 'error'); return; }
    const r = OA().addOffice(name);
    if (!r) { App.toast('이미 있는 영업소명입니다', 'warning'); return; }
    App.toast(`영업소 추가됨 · ${r.name}`, 'success');
    App.refreshPage();
  };
  const saveOfficeName = (code) => {
    const name = val(`oa-off-${code}`);
    if (!name.trim()) { App.toast('영업소명을 입력하세요', 'error'); return; }
    if (OA().renameOffice(code, name)) { App.toast('영업소명이 변경되었습니다', 'success'); App.refreshPage(); }
    else App.toast('변경 실패 — 중복 이름인지 확인하세요', 'error');
  };
  const deleteOffice = (code) => {
    const nm = oName(code);
    if (OA().officeHasAudits(code)) {
      App.toast(`${nm}에 심사기록이 있어 삭제할 수 없습니다. 해당 심사를 먼저 삭제하세요.`, 'warning');
      return;
    }
    if (!confirm(`${nm}을(를) 목록에서 삭제할까요?`)) return;
    OA().removeOffice(code);
    if (office === code) office = 'ALL';
    App.toast('영업소가 삭제되었습니다', 'info');
    App.refreshPage();
  };

  // ── 액션 ──
  const setOffice = (v) => { office = v; mode = 'overview'; detailId = null; App.refreshPage(); };
  const openNew = () => { mode = 'form'; editId = null; App.refreshPage(); };
  const openEdit = (id) => { mode = 'form'; editId = id; App.refreshPage(); };
  const cancel = () => { mode = editId ? 'detail' : 'overview'; detailId = editId; editId = null; App.refreshPage(); };
  const openDetail = (id) => { mode = 'detail'; detailId = id; App.refreshPage(); };
  const backToList = () => { mode = 'overview'; detailId = null; App.refreshPage(); };
  const remove = (id) => {
    const a = OA().getAudit(id); if (!a) return;
    if (!confirm(`${oName(a.office)} ${a.date} 심사 기록을 삭제할까요?`)) return;
    OA().deleteAudit(id);
    App.toast('삭제되었습니다', 'info');
    mode = 'overview'; detailId = null; App.refreshPage();
  };
  const print = (id) => {
    const a = OA().getAudit(id); if (!a) return;
    if (typeof openReportOverlay === 'function') openReportOverlay(printSheet(a));
    else window.print();
  };

  const afterRender = () => { if (mode === 'overview') drawCharts(); if (mode === 'form') recalc(); };

  return { render, afterRender, setOffice, openNew, openEdit, openDetail, backToList, cancel, save, recalc, remove, print, toggleManageOffices, addOffice, saveOfficeName, deleteOffice };
})();
