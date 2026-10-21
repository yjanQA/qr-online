// ============================================================
// audit_finding.js — 심사 지적사항 연간 기록
//   연도별 심사 이력 + 지적사항별 개선(조치) 이력 추적
//   연간 통계 · 분야별 다발 지적 · 반복 지적(재발) 추적
// ============================================================

const AuditFindingPage = (() => {
  let yearSel = 'ALL';       // 연도 필터
  let statusSel = 'ALL';     // 지적 상태 필터
  let detailId = null;       // 상세(심사) 보기
  let actTarget = null;      // 조치 등록 대상 {auditId, findingId}
  let trendChart = null;

  const actorName = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) { return ''; } };
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const gmeta = (g) => AuditFindingDB.GRADE_META[g] || AuditFindingDB.GRADE_META['권고사항'];
  const smeta = (s) => AuditFindingDB.STATUS_META[s] || AuditFindingDB.STATUS_META['미조치'];

  // ── 사진·증빙 첨부 ──
  //   원본은 서버(data/files) 또는 IndexedDB, 레코드에는 썸네일+메타만. PhotoStore 참조.
  //   지적 현장 사진(FINDING)과 개선 증빙(ACTION)을 구분해 보관한다.
  const MAX_PHOTOS = 8;
  const KIND_LABEL = { FINDING: '지적', ACTION: '개선' };
  const pendingFinding = [];   // 지적사항 추가 모달에서 대기중
  const pendingAction = [];    // 개선 조치 모달에서 대기중
  const clearBucket = (b) => { b.length = 0; };   // 재대입 금지(업로드 루프가 참조를 잡고 있음)

  let uploading = 0;
  const setBusy = (on) => {
    uploading += on ? 1 : -1;
    if (uploading < 0) uploading = 0;
    document.querySelectorAll('[data-upload-lock]').forEach(el => { el.disabled = uploading > 0; });
  };

  const pickInto = async (input, bucket, kind, previewId) => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    setBusy(true);
    App.toast(`첨부 ${files.length}건을 저장하는 중입니다`, 'info');
    try {
      for (const f of files) {
        if (bucket.length >= MAX_PHOTOS) { App.toast(`첨부는 최대 ${MAX_PHOTOS}건까지 가능합니다`, 'warning'); break; }
        try {
          const meta = await PhotoStore.save(f, { kind, by: actorName() });
          if (meta) bucket.push(meta);
        } catch (e) { App.toast(e.message || '첨부 저장에 실패했습니다', 'error'); }
        renderBucket(bucket, previewId, kind);
      }
    } finally { setBusy(false); }
  };
  const onFindingPhotos = (input) => pickInto(input, pendingFinding, 'FINDING', 'aff-photo-box');
  const onEvidence = (input) => pickInto(input, pendingAction, 'ACTION', 'af-evi-box');
  const removeFindingPhoto = async (i) => { const p = pendingFinding[i]; pendingFinding.splice(i, 1); renderBucket(pendingFinding, 'aff-photo-box', 'FINDING'); await PhotoStore.remove(p); };
  const removeEvidence = async (i) => { const p = pendingAction[i]; pendingAction.splice(i, 1); renderBucket(pendingAction, 'af-evi-box', 'ACTION'); await PhotoStore.remove(p); };

  const renderBucket = (bucket, elId, kind) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const rm = kind === 'FINDING' ? 'removeFindingPhoto' : 'removeEvidence';
    el.innerHTML = bucket.length ? bucket.map((p, i) => `
      <div class="af-thumb">
        ${p.doc ? `<div class="af-thumb-doc" title="${esc(p.name)}">${esc((p.name || '').split('.').pop().toUpperCase())}</div>`
                : `<img src="${PhotoStore.thumbOf(p)}" alt="${esc(p.name || '')}">`}
        <button type="button" class="af-thumb-x" onclick="AuditFindingPage.${rm}(${i})" title="삭제">✕</button>
      </div>`).join('') : '<span class="text-muted" style="font-size:12px">첨부 없음</span>';
  };

  // 저장된 첨부 보기 — 지적사항 사진 또는 개선 이력 증빙
  const viewPhotos = (auditId, findingId, actionId) => {
    const a = AuditFindingDB.getAudit(auditId);
    const f = a && (a.findings || []).find(x => x.id === findingId);
    if (!f) return;
    const list = actionId
      ? photosOfAction((f.history || []).find(h => h.id === actionId))
      : PhotoStore.normalize(f.photos);
    PhotoStore.openViewer(list, 0, KIND_LABEL);
  };
  // 품질회의 안건으로 올리기
  //   지적사항은 audits[].findings[] 중첩이라 findingId 만으로는 못 찾는다 → 복합키로 넘긴다.
  const toAgenda = (auditId, findingId) => {
    const a = AuditFindingDB.getAudit(auditId);
    if (!a || typeof MeetingPage === 'undefined') return;
    const x = (a.findings || []).find(f => f.id === findingId);
    if (!x) return;
    MeetingPage.quickAgenda({
      sourceType: 'FINDING',
      sourceId: `${auditId}/${findingId}`,
      sourceLabel: `${a.year} ${a.type} 지적`,
      title: `[${x.grade}] ${x.category} — ${String(x.content || '').replace(/\s+/g, ' ').slice(0, 40)}`,
      content: `${a.date} ${a.type}(${a.agency || '-'}) 지적사항\n${x.content}${x.dueDate ? `\n개선기한 ${x.dueDate}` : ''}${x.dept ? `\n담당 ${x.dept}` : ''}`,
      category: 'HACCP·선행요건',
      factory: a.factory,
      priority: x.grade === '중부적합' ? '긴급' : x.grade === '경부적합' ? '높음' : '보통',
    });
  };

  // 개선 이력의 첨부 — 신규(photos 배열)와 구버전(evidence 단건)을 함께 처리
  const photosOfAction = (h) => {
    if (!h) return [];
    if (Array.isArray(h.photos) && h.photos.length) return PhotoStore.normalize(h.photos);
    return h.evidence ? PhotoStore.normalize([h.evidence]) : [];
  };
  // ── 목록(연간 현황) ──
  const render = () => {
    if (detailId) {
      const a = AuditFindingDB.getAudit(detailId);
      if (!a) detailId = null; else return renderDetail(a);
    }
    const f = fac();
    const st = AuditFindingDB.yearStats(yearSel, f);
    const audits = AuditFindingDB.getAudits(yearSel, f);
    const cats = AuditFindingDB.byCategory(yearSel, f);
    const rep = AuditFindingDB.repeated(f);
    const yrs = AuditFindingDB.years();

    let findings = AuditFindingDB.allFindings(yearSel, f);
    if (statusSel !== 'ALL') {
      findings = statusSel === 'overdue' ? findings.filter(AuditFindingDB.isOverdue) : findings.filter(x => x.status === statusSel);
    }
    findings = findings.sort((a, b) => (AuditFindingDB.isOverdue(b) - AuditFindingDB.isOverdue(a))
      || (gmeta(b.grade).weight - gmeta(a.grade).weight)
      || String(b.auditDate || '').localeCompare(String(a.auditDate || '')));

    const sBtn = (v, label, n, color) =>
      `<button class="btn btn-sm ${statusSel === v ? 'btn-primary' : 'btn-ghost'}" onclick="AuditFindingPage.setStatus('${v}')">${label}${n != null ? ` <b${color ? ` style="color:${color}"` : ''}>${n}</b>` : ''}</button>`;

    const auditRows = audits.length ? audits.map(a => {
      const fs = a.findings || [];
      const open = fs.filter(x => x.status !== '완료').length;
      const crit = fs.filter(x => x.grade === '중부적합').length;
      return `<tr style="cursor:pointer" onclick="AuditFindingPage.open('${esc(a.id)}')">
        <td class="text-xs"><b>${esc(a.date)}</b></td>
        <td>${esc(a.type)}</td>
        <td class="text-xs">${esc(a.agency || '-')}</td>
        <td class="text-xs">${esc(AuditFindingDB.factoryName(a.factory))}</td>
        <td>${a.result === '부적합' ? '<span class="badge badge-fail">부적합</span>'
              : a.result === '조건부 적합' ? '<span class="badge badge-warning">조건부 적합</span>'
              : '<span class="badge badge-pass">적합</span>'}${a.score != null ? ` <span class="text-xs text-muted">${a.score}점</span>` : ''}</td>
        <td class="td-right">${fs.length}건${crit ? ` <span class="text-red">(중 ${crit})</span>` : ''}</td>
        <td class="td-right">${open > 0 ? `<span class="badge badge-warning">미완료 ${open}</span>` : '<span class="badge badge-pass">완료</span>'}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">등록된 심사가 없습니다</td></tr>`;

    const findingRows = findings.length ? findings.map(x => {
      const g = gmeta(x.grade), s = smeta(x.status), od = AuditFindingDB.isOverdue(x);
      return `<tr${od ? ' style="background:rgba(229,72,77,.06)"' : ''}>
        <td class="text-xs">${esc(x.year)}</td>
        <td class="text-xs">${esc(x.auditType)}</td>
        <td><span class="badge ${g.cls}">${esc(x.grade)}</span></td>
        <td class="text-xs">${esc(x.category)}</td>
        <td style="max-width:280px">${esc(x.content)}</td>
        <td class="text-xs">${esc(x.dept || '-')}</td>
        <td class="text-xs">${x.dueDate ? esc(x.dueDate) : '-'}${od ? ' <span class="badge badge-fail" style="font-size:9px">기한초과</span>' : ''}</td>
        <td><span class="badge ${s.cls}">${esc(x.status)}</span></td>
        <td style="white-space:nowrap"><button class="btn btn-primary btn-xs" onclick="AuditFindingPage.openActionModal('${esc(x.auditId)}','${esc(x.id)}')">조치</button>
          <button class="btn btn-ghost btn-xs" onclick="AuditFindingPage.toAgenda('${esc(x.auditId)}','${esc(x.id)}')">회의 안건</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">해당 조건의 지적사항이 없습니다</td></tr>`;

    const catRows = cats.length ? cats.slice(0, 10).map((c, i) => `<tr>
      <td class="text-xs">${i + 1}</td><td><strong>${esc(c.name)}</strong></td>
      <td class="td-right">${c.n}</td>
      <td class="td-right ${c.critical ? 'text-red' : ''}">${c.critical}</td>
      <td class="td-right ${c.open ? 'text-red' : ''}">${c.open}</td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:18px;color:var(--text-muted)">데이터 없음</td></tr>`;

    return `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-12" style="gap:10px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <span class="text-muted" style="font-size:12px">연도</span>
          <button class="btn btn-sm ${yearSel === 'ALL' ? 'btn-primary' : 'btn-ghost'}" onclick="AuditFindingPage.setYear('ALL')">전체</button>
          ${yrs.map(y => `<button class="btn btn-sm ${String(yearSel) === y ? 'btn-primary' : 'btn-ghost'}" onclick="AuditFindingPage.setYear('${y}')">${y}년</button>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm" onclick="AuditFindingPage.openAuditModal()">＋ 심사 등록</button>
      </div>

      ${st.overdue > 0 ? `<div class="card alert-banner alert-danger">
        <b>개선기한 초과 ${st.overdue}건</b> — 기한이 지난 미완료 지적사항이 있습니다. 조치 등록을 서둘러 주세요.
      </div>` : ''}

      <div class="inventory-summary-grid mb-16">
        <div class="inventory-summary-card"><div class="summary-label">심사 횟수</div><div class="summary-value">${st.audits}<span>회</span></div></div>
        <div class="inventory-summary-card"><div class="summary-label">지적 건수</div><div class="summary-value">${st.findings}<span>건</span></div></div>
        <div class="inventory-summary-card ${st.critical > 0 ? 'summary-risk' : ''}"><div class="summary-label">중부적합</div><div class="summary-value">${st.critical}<span>건</span></div></div>
        <div class="inventory-summary-card ${st.미조치 + st.조치중 > 0 ? 'summary-risk' : ''}"><div class="summary-label">미완료</div><div class="summary-value">${st.미조치 + st.조치중}<span>건</span></div></div>
        <div class="inventory-summary-card"><div class="summary-label">조치 완료율</div><div class="summary-value">${st.closeRate}<span>%</span></div></div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="section-label">연도별 지적 추이</div>
        <div class="chart-frame" style="height:220px"><canvas id="af-trend-chart"></canvas></div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="section-label">심사 이력 ${yearSel !== 'ALL' ? `<span class="tag tag-blue" style="font-size:11px">${esc(yearSel)}년</span>` : ''}</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>심사일</th><th>구분</th><th>심사기관</th><th>공장</th><th>결과</th><th class="td-right">지적</th><th class="td-right">조치</th></tr></thead>
            <tbody>${auditRows}</tbody>
          </table>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:8px">행을 클릭하면 지적사항과 개선 이력을 봅니다</div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="section-label">지적사항
          <span style="margin-left:8px">${sBtn('ALL', '전체', st.findings)}${sBtn('미조치', '미조치', st.미조치, st.미조치 ? '#e5484d' : '')}${sBtn('조치중', '조치중', st.조치중, st.조치중 ? '#d4820f' : '')}${sBtn('완료', '완료', st.완료)}${sBtn('overdue', '기한초과', st.overdue, st.overdue ? '#e5484d' : '')}</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>연도</th><th>심사</th><th>등급</th><th>분야</th><th>지적내용</th><th>담당</th><th>개선기한</th><th>상태</th><th></th></tr></thead>
            <tbody>${findingRows}</tbody>
          </table>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px" class="af-grid">
        <div class="card">
          <div class="section-label">분야별 다발 지적 TOP 10</div>
          <div class="table-wrapper">
            <table><thead><tr><th>#</th><th>분야</th><th class="td-right">건수</th><th class="td-right">중부적합</th><th class="td-right">미완료</th></tr></thead>
            <tbody>${catRows}</tbody></table>
          </div>
        </div>
        <div class="card">
          <div class="section-label">반복 지적 (2개 연도 이상)</div>
          ${rep.length ? `<div class="table-wrapper">
            <table><thead><tr><th>분야</th><th>지적 연도</th><th class="td-right">누적</th></tr></thead>
            <tbody>${rep.map(r => `<tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td class="text-xs">${r.years.map(y => `<span class="badge badge-warning" style="font-size:10px">${esc(y)}</span>`).join(' ')}</td>
              <td class="td-right"><b>${r.n}</b>건</td>
            </tr>`).join('')}</tbody></table>
          </div>
          <div class="text-muted" style="font-size:12px;margin-top:8px">여러 해에 걸쳐 반복된 분야입니다. 재발 방지 대책 수립이 필요합니다.</div>`
          : '<div class="text-sm text-muted" style="padding:16px 0">반복 지적된 분야가 없습니다.</div>'}
        </div>
      </div>

      ${modalsHtml()}
    </div>`;
  };

  // ── 심사 상세 ──
  const renderDetail = (a) => {
    const fs = (a.findings || []).slice().sort((x, y) => gmeta(y.grade).weight - gmeta(x.grade).weight);
    const info = (l, v) => `<div><div class="text-xs text-muted">${l}</div><div>${v || '<span class="text-muted">-</span>'}</div></div>`;
    return `
    <div class="fade-in">
      <div class="card">
        <div class="card-head">
          <button class="btn btn-ghost btn-sm" onclick="AuditFindingPage.back()">← 목록</button>
          <div class="section-label" style="margin:0">${esc(a.date)} · ${esc(a.type)}</div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="AuditFindingPage.openAuditModal('${esc(a.id)}')">수정</button>
            <button class="btn btn-ghost btn-sm" onclick="AuditFindingPage.removeAudit('${esc(a.id)}')">삭제</button>
            <button class="btn btn-primary btn-sm" onclick="AuditFindingPage.openFindingModal('${esc(a.id)}')">＋ 지적사항 추가</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:10px 0 14px">
          ${info('연도', esc(a.year) + '년')}
          ${info('심사기관', esc(a.agency))}
          ${info('대상 공장', esc(AuditFindingDB.factoryName(a.factory)))}
          ${info('결과', esc(a.result) + (a.score != null ? ` (${a.score}점)` : ''))}
          ${info('심사자', esc(a.auditor))}
          ${info('지적 건수', fs.length + '건')}
        </div>
        ${a.note ? `<div class="info-box info-blue" style="margin-bottom:12px">${esc(a.note)}</div>` : ''}
        ${((typeof SelfCheck !== 'undefined') && a.checklist) ? SelfCheck.detailHtml(a, checklistPending(a).length) : ''}

        <div class="section-label" style="font-size:13px">지적사항 및 개선 이력 (${fs.length})</div>
        ${fs.length ? fs.map(x => {
          const g = gmeta(x.grade), s = smeta(x.status), od = AuditFindingDB.isOverdue(x);
          const hist = (x.history || []).slice().sort((p, q) => String(q.date).localeCompare(String(p.date)));
          return `<div class="card" style="margin:10px 0;border-left:3px solid ${g.color}">
            <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
              <div style="flex:1;min-width:220px">
                <div><span class="badge ${g.cls}">${esc(x.grade)}</span> <span class="badge badge-default">${esc(x.category)}</span> <span class="badge ${s.cls}">${esc(x.status)}</span>${od ? ' <span class="badge badge-fail">기한초과</span>' : ''}</div>
                <div style="font-size:13px;line-height:1.6;margin-top:6px">${esc(x.content)}</div>
                <div class="text-xs text-muted" style="margin-top:4px">담당 ${esc(x.dept || '-')} · 개선기한 ${esc(x.dueDate || '-')}</div>
                ${(() => {
                  const ps = PhotoStore.normalize(x.photos);
                  if (!ps.length) return '';
                  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
                    ${ps.slice(0, 6).map((p, i) => p.doc
                      ? `<button class="btn btn-ghost btn-xs" onclick="AuditFindingPage.viewPhotos('${esc(a.id)}','${esc(x.id)}')">${esc(p.name)}</button>`
                      : `<img src="${PhotoStore.thumbOf(p)}" class="af-card-thumb" title="${esc(p.name || '')}"
                           onclick="AuditFindingPage.viewPhotos('${esc(a.id)}','${esc(x.id)}')">`).join('')}
                    ${ps.length > 6 ? `<span class="text-xs text-muted">외 ${ps.length - 6}건</span>` : ''}
                  </div>`;
                })()}
              </div>
              <div style="display:flex;gap:5px;flex-shrink:0">
                <button class="btn btn-primary btn-xs" onclick="AuditFindingPage.openActionModal('${esc(a.id)}','${esc(x.id)}')">조치 등록</button>
                <button class="btn btn-ghost btn-xs" onclick="AuditFindingPage.toAgenda('${esc(a.id)}','${esc(x.id)}')">회의 안건</button>
                <button class="btn btn-ghost btn-xs" onclick="AuditFindingPage.removeFinding('${esc(a.id)}','${esc(x.id)}')">삭제</button>
              </div>
            </div>
            ${hist.length ? `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
              <div class="text-xs text-muted" style="margin-bottom:6px">개선 이력 ${hist.length}건</div>
              ${hist.map(h => `<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:12px;border-bottom:1px dashed var(--border)">
                <span class="badge ${smeta(h.status).cls}" style="flex-shrink:0">${esc(h.status)}</span>
                <span class="text-muted" style="flex-shrink:0">${esc(h.date)}</span>
                <span style="flex:1">${esc(h.action || '-')}</span>
                <span class="text-muted" style="flex-shrink:0">${esc(h.by || '')}</span>
                ${photosOfAction(h).length ? `<button class="btn btn-ghost btn-xs" onclick="AuditFindingPage.viewPhotos('${esc(a.id)}','${esc(x.id)}','${esc(h.id)}')">증빙 ${photosOfAction(h).length}</button>` : ''}
                <button class="btn btn-ghost btn-xs" onclick="AuditFindingPage.removeAction('${esc(a.id)}','${esc(x.id)}','${esc(h.id)}')">✕</button>
              </div>`).join('')}
            </div>` : '<div class="text-xs text-muted" style="margin-top:8px">개선 이력이 없습니다</div>'}
          </div>`;
        }).join('') : '<div class="text-sm text-muted" style="padding:16px 0">등록된 지적사항이 없습니다.</div>'}
      </div>
      ${modalsHtml()}
    </div>`;
  };

  const modalsHtml = () => `
    <div class="modal-overlay" id="af-audit-modal">
      <div class="modal modal-lg"><div class="modal-header"><div class="modal-title">심사 등록/수정</div>
        <button class="modal-close" onclick="AuditFindingPage.closeModal('af-audit-modal')">✕</button></div>
        <div id="af-audit-body"></div></div>
    </div>
    <div class="modal-overlay" id="af-finding-modal">
      <div class="modal modal-lg"><div class="modal-header"><div class="modal-title">지적사항 추가</div>
        <button class="modal-close" onclick="AuditFindingPage.closeModal('af-finding-modal')">✕</button></div>
        <div id="af-finding-body"></div></div>
    </div>
    <div class="modal-overlay" id="af-action-modal">
      <div class="modal"><div class="modal-header"><div class="modal-title">개선 조치 등록</div>
        <button class="modal-close" onclick="AuditFindingPage.closeModal('af-action-modal')">✕</button></div>
        <div id="af-action-body"></div></div>
    </div>`;

  // ── 심사 등록 모달 ──
  const openAuditModal = (id) => {
    const a = id ? AuditFindingDB.getAudit(id) : null;
    const body = document.getElementById('af-audit-body');
    if (!body) return;
    const curFac = a ? a.factory : (fac() !== 'ALL' ? fac() : 'NS');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">심사일 <span class="req">*</span></label>
            <input type="date" class="form-input" id="af-date" value="${esc(a?.date || todayStr())}"></div>
          <div class="form-group"><label class="form-label">심사 구분</label>
            <select class="form-input" id="af-type" onchange="if(typeof SelfCheck!=='undefined')SelfCheck.mount(this.value)">${AuditFindingDB.AUDIT_TYPES.map(t => `<option value="${esc(t)}" ${a?.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">심사기관</label>
            <input type="text" class="form-input" id="af-agency" value="${esc(a?.agency || '')}" placeholder="예) 한국식품안전관리인증원"></div>
          <div class="form-group"><label class="form-label">대상 공장</label>
            <select class="form-input" id="af-factory">${AuditFindingDB.FACTORIES.map(x => `<option value="${x.code}" ${curFac === x.code ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">결과</label>
            <select class="form-input" id="af-result" onchange="if(typeof SelfCheck!=='undefined')SelfCheck.touchResult()">${AuditFindingDB.RESULTS.map(r => `<option value="${esc(r)}" ${a?.result === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">점수 <span class="text-muted">(선택 · 자체 점검은 점검표가 채움)</span></label>
            <input type="number" class="form-input" id="af-score" value="${a?.score ?? ''}" placeholder="예) 91"></div>
        </div>
        <div class="form-group"><label class="form-label">심사자</label>
          <input type="text" class="form-input" id="af-auditor" value="${esc(a?.auditor || '')}"></div>
        <div class="form-group"><label class="form-label">비고</label>
          <textarea class="form-input" id="af-note" rows="2">${esc(a?.note || '')}</textarea></div>
        <div id="af-checklist"></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="AuditFindingPage.closeModal('af-audit-modal')">취소</button>
          <button class="btn btn-primary" onclick="AuditFindingPage.saveAudit('${esc(id || '')}')">${a ? '수정' : '등록'}</button>
        </div>
      </div>`;
    // 자체 점검이면 점검표(협력사 품질검증 평가표와 같은 항목)를 펼친다
    if ((typeof SelfCheck !== 'undefined')) { SelfCheck.load(a?.checklist); SelfCheck.mount(document.getElementById('af-type').value); }
    document.getElementById('af-audit-modal').classList.add('open');
  };
  const saveAudit = (id) => {
    const g = (x) => document.getElementById(x)?.value || '';
    const date = g('af-date');
    if (!date) { App.toast('심사일을 입력하세요', 'error'); return; }
    const data = { date, year: Number(date.slice(0, 4)), type: g('af-type'), agency: g('af-agency'),
      factory: g('af-factory'), result: g('af-result'), score: g('af-score'), auditor: g('af-auditor'), note: g('af-note') };
    // 자체 점검표 — 다른 심사 구분으로 바꿨으면 지운다
    // 점검표 — 펼쳐 두고 채점한 경우에만 남는다(점검표를 빼면 지워진다)
    if ((typeof SelfCheck !== 'undefined')) data.checklist = SelfCheck.value();
    if (data.checklist && data.score === '') data.score = data.checklist.summary.score;
    if (id) { AuditFindingDB.updateAudit(id, data); App.toast('심사 정보를 수정했습니다', 'success'); }
    else { const r = AuditFindingDB.addAudit(data); App.toast('심사를 등록했습니다', 'success'); detailId = r.id; }
    closeModal('af-audit-modal');
    App.refreshPage();
  };
  // 점검표에서 미흡·부적합인데 아직 지적사항으로 넘기지 않은 항목
  const checklistPending = (a) => {
    if (!(typeof SelfCheck !== 'undefined') || !a || !a.checklist) return [];
    const done = new Set((a.findings || []).map(f => f.sourceKey).filter(Boolean));
    return SelfCheck.lowItems(a.checklist).filter(it => !done.has('chk:' + it.key));
  };
  const findingsFromChecklist = (auditId) => {
    const a = AuditFindingDB.getAudit(auditId);
    const list = checklistPending(a);
    if (!list.length) { App.toast('지적사항으로 넘길 미흡·부적합 항목이 없습니다', 'info'); return; }
    if (!confirm(`미흡·부적합 ${list.length}건을 지적사항으로 등록할까요?\n부적합(0점)은 중부적합, 미흡(1점)은 경부적합으로 등록합니다.`)) return;
    list.forEach(it => {
      AuditFindingDB.addFinding(auditId, {
        category: it.category,
        grade: it.score === 0 ? '중부적합' : '경부적합',
        content: `[${a.type} 점검표 · ${it.cat}] ${it.doc} — ${it.score === 0 ? '부적합' : '미흡'}(${it.score}점)${it.check ? '. 확인사항: ' + it.check : ''}${it.memo ? '. ' + it.memo : ''}`,
        sourceKey: 'chk:' + it.key,
      });
    });
    App.toast(`지적사항 ${list.length}건을 등록했습니다 — 조치 등록으로 개선 이력을 남기세요`, 'success');
    App.refreshPage();
  };

  const removeAudit = (id) => {
    const a = AuditFindingDB.getAudit(id);
    if (!a) return;
    if (!confirm(`${a.date} ${a.type} 기록을 삭제할까요?\n지적사항 ${(a.findings || []).length}건과 개선 이력도 함께 삭제됩니다.`)) return;
    AuditFindingDB.deleteAudit(id);
    App.toast('삭제되었습니다', 'info');
    detailId = null;
    App.refreshPage();
  };

  // ── 지적사항 추가 모달 ──
  const openFindingModal = (auditId) => {
    const body = document.getElementById('af-finding-body');
    if (!body) return;
    // 심사 유형(HACCP/SQF)에 맞는 심사기준 중분류를 지적 분야 후보로 보여준다.
    const audit = AuditFindingDB.getAudit(auditId);
    const stdKey = AuditFindingDB.standardOf(audit && audit.type);
    const stdLabel = (AuditFindingDB.AUDIT_STANDARDS[stdKey] || {}).label || '';
    const catOptions = AuditFindingDB.categoriesFor(audit && audit.type).map(g =>
      `<optgroup label="${esc(g.title)}">${g.items.map(it => `<option value="${esc(it)}">${esc(it)}</option>`).join('')}</optgroup>`).join('');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">지적 등급</label>
            <select class="form-input" id="aff-grade">${AuditFindingDB.GRADES.map(x => `<option value="${esc(x)}" ${x === '경부적합' ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">지적 분야</label>
            <select class="form-input" id="aff-category">${catOptions}</select>
            <div class="form-hint">${esc(stdLabel)}${audit && audit.type ? ' · ' + esc(audit.type) : ''} 기준</div></div>
        </div>
        <div class="form-group"><label class="form-label">지적 내용 <span class="req">*</span></label>
          <textarea class="form-input" id="aff-content" rows="3" placeholder="심사 지적서에 기재된 내용을 그대로 입력"></textarea></div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">담당 부서</label>
            <input type="text" class="form-input" id="aff-dept" placeholder="예) 품질팀, 생산팀"></div>
          <div class="form-group"><label class="form-label">개선기한</label>
            <input type="date" class="form-input" id="aff-due"></div>
        </div>
        <div class="form-group"><label class="form-label">지적 현장 사진
            <span class="text-muted" style="font-weight:400;font-size:12px">(지적 부위·상태 · 최대 ${MAX_PHOTOS}건)</span></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">사진 선택 / 촬영
            <input type="file" accept="image/*,.pdf" multiple capture="environment" style="display:none" onchange="AuditFindingPage.onFindingPhotos(this)"></label>
          <div id="aff-photo-box" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
          <div class="form-hint">${PhotoStore.serverOn()
            ? '원본은 서버에 저장되어 모든 단말에서 볼 수 있습니다.'
            : '서버 미연결 — 원본은 이 기기에만 저장됩니다.'}</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="AuditFindingPage.closeModal('af-finding-modal')">취소</button>
          <button class="btn btn-primary" data-upload-lock onclick="AuditFindingPage.saveFinding('${esc(auditId)}')">추가</button>
        </div>
      </div>`;
    clearBucket(pendingFinding);
    renderBucket(pendingFinding, 'aff-photo-box', 'FINDING');
    document.getElementById('af-finding-modal').classList.add('open');
  };
  const saveFinding = (auditId) => {
    if (uploading > 0) { App.toast('첨부 저장이 끝난 뒤에 추가해 주세요', 'warning'); return; }
    const g = (x) => document.getElementById(x)?.value || '';
    const content = g('aff-content').trim();
    if (!content) { App.toast('지적 내용을 입력하세요', 'error'); return; }
    AuditFindingDB.addFinding(auditId, {
      grade: g('aff-grade'), category: g('aff-category'), content, dept: g('aff-dept'), dueDate: g('aff-due'),
      photos: pendingFinding.slice(),
    });
    App.toast('지적사항을 추가했습니다', 'success');
    clearBucket(pendingFinding);
    closeModal('af-finding-modal');
    App.refreshPage();
  };
  const removeFinding = (auditId, fid) => {
    if (!confirm('이 지적사항을 삭제할까요? 개선 이력도 함께 삭제됩니다.')) return;
    AuditFindingDB.deleteFinding(auditId, fid);
    App.toast('삭제되었습니다', 'info');
    App.refreshPage();
  };

  // ── 개선 조치 모달 ──
  const openActionModal = (auditId, findingId) => {
    const a = AuditFindingDB.getAudit(auditId);
    const f = a && (a.findings || []).find(x => x.id === findingId);
    const body = document.getElementById('af-action-body');
    if (!f || !body) return;
    actTarget = { auditId, findingId };
    const by = (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : '';
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="info-box info-blue"><span class="badge ${gmeta(f.grade).cls}">${esc(f.grade)}</span> ${esc(f.content)}</div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">조치일 <span class="req">*</span></label>
            <input type="date" class="form-input" id="afa-date" value="${todayStr()}"></div>
          <div class="form-group"><label class="form-label">처리 상태</label>
            <select class="form-input" id="afa-status">${AuditFindingDB.STATUS.map(s => `<option value="${esc(s)}" ${s === '완료' ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">개선 내역 <span class="req">*</span></label>
          <textarea class="form-input" id="afa-action" rows="3" placeholder="무엇을 어떻게 개선했는지 구체적으로"></textarea></div>
        <div class="form-group"><label class="form-label">조치자</label>
          <input type="text" class="form-input" id="afa-by" value="${esc(by)}" readonly></div>
        <div class="form-group"><label class="form-label">개선 증빙
            <span class="text-muted" style="font-weight:400;font-size:12px">(개선 전/후 사진, 교체 증빙 등 · 최대 ${MAX_PHOTOS}건)</span></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">사진 선택 / 촬영
            <input type="file" accept="image/*,.pdf" multiple capture="environment" style="display:none" onchange="AuditFindingPage.onEvidence(this)"></label>
          <div id="af-evi-box" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="AuditFindingPage.closeModal('af-action-modal')">취소</button>
          <button class="btn btn-primary" data-upload-lock onclick="AuditFindingPage.saveAction()">조치 등록</button>
        </div>
      </div>`;
    clearBucket(pendingAction);
    renderBucket(pendingAction, 'af-evi-box', 'ACTION');
    document.getElementById('af-action-modal').classList.add('open');
  };
  const saveAction = () => {
    if (!actTarget) return;
    if (uploading > 0) { App.toast('첨부 저장이 끝난 뒤에 등록해 주세요', 'warning'); return; }
    const g = (x) => document.getElementById(x)?.value || '';
    const action = g('afa-action').trim();
    if (!action) { App.toast('개선 내역을 입력하세요', 'error'); return; }
    AuditFindingDB.addAction(actTarget.auditId, actTarget.findingId, {
      date: g('afa-date'), status: g('afa-status'), action, by: g('afa-by'), photos: pendingAction.slice(),
    });
    App.toast('개선 조치를 등록했습니다', 'success');
    actTarget = null; clearBucket(pendingAction);
    closeModal('af-action-modal');
    App.refreshPage();
  };
  const removeAction = (auditId, fid, aid) => {
    if (!confirm('이 개선 이력을 삭제할까요?')) return;
    AuditFindingDB.deleteAction(auditId, fid, aid);
    App.toast('개선 이력을 삭제했습니다', 'warning');
    App.refreshPage();
  };

  // ── 차트 ──
  const drawChart = () => {
    if (typeof Chart === 'undefined') return;
    const c = document.getElementById('af-trend-chart');
    if (!c) return;
    if (trendChart) { try { trendChart.destroy(); } catch (_) {} trendChart = null; }
    const tr = AuditFindingDB.yearTrend(fac());
    if (!tr.length) return;
    trendChart = new Chart(c, {
      data: {
        labels: tr.map(t => t.year + '년'),
        datasets: [
          { type: 'bar', label: '지적 건수', data: tr.map(t => t.findings), backgroundColor: 'rgba(79,156,255,0.4)', borderColor: '#4f9cff', borderWidth: 1, yAxisID: 'y' },
          { type: 'bar', label: '중부적합', data: tr.map(t => t.critical), backgroundColor: 'rgba(229,72,77,0.6)', borderColor: '#e5484d', borderWidth: 1, yAxisID: 'y' },
          { type: 'line', label: '조치 완료율(%)', data: tr.map(t => t.closeRate), borderColor: '#2ea86a', backgroundColor: 'transparent', tension: 0.25, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { beginAtZero: true, position: 'left', ticks: { color: '#8892a6', font: { size: 10 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { beginAtZero: true, max: 100, position: 'right', ticks: { color: '#8892a6', font: { size: 10 } }, grid: { drawOnChartArea: false } },
        },
      },
    });
  };
  const ensureStyle = () => {
    if (document.getElementById('af-style')) return;
    const st = document.createElement('style'); st.id = 'af-style';
    st.textContent = `@media (max-width:900px){ .af-grid{grid-template-columns:1fr !important;} }`;
    document.head.appendChild(st);
  };
  const afterRender = () => { ensureStyle(); if (!detailId) drawChart(); };

  const setYear = (y) => { yearSel = y; App.refreshPage(); };
  const setStatus = (s) => { statusSel = s; App.refreshPage(); };
  const open = (id) => { detailId = id; App.refreshPage(); };
  const back = () => { detailId = null; App.refreshPage(); };
  const closeModal = (id) => { document.getElementById(id)?.classList.remove('open'); };

  // 대시보드 연동 요약
  const summary = () => {
    const f = fac();
    const openF = AuditFindingDB.openFindings(f);
    return {
      open: openF.length,
      overdue: openF.filter(x => x.overdue).length,
      critical: openF.filter(x => x.grade === '중부적합').length,
      repeated: AuditFindingDB.repeated(f).length,
    };
  };

  return { findingsFromChecklist, render, afterRender, setYear, setStatus, open, back, closeModal,
    openAuditModal, saveAudit, removeAudit,
    openFindingModal, saveFinding, removeFinding,
    openActionModal, saveAction, removeAction,
    onEvidence, removeEvidence, onFindingPhotos, removeFindingPhoto, viewPhotos, toAgenda, summary };
})();
