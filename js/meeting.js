// ============================================================
// meeting.js — 품질회의 기록 · 안건 추적
//   회의록 작성/확정, 안건별 조치 이력 누적, 미종결 안건 이월 추적.
//   다른 화면(VOC·부적합·지적사항 등)에서 올린 안건은 대기함을 거쳐 회의에 담긴다.
// ============================================================

const MeetingPage = (() => {
  let tab = 'LOG';           // LOG(회의록) / TRACK(안건 추적)
  let detailId = null;       // 회의 상세
  let yearSel = 'ALL';
  let agTarget = null;       // 안건 추가/수정 대상 {meetingId, agendaId}
  let pgTarget = null;       // 조치 등록 대상 {meetingId, agendaId}
  let trackFilter = 'OPEN';  // OPEN(미종결) / OVERDUE(기한초과) / ALL

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const actorName = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) { return ''; } };
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const smeta = (s) => MeetingDB.STATUS_META[s] || MeetingDB.STATUS_META['미착수'];
  const pmeta = (p) => MeetingDB.PRIORITY_META[p] || MeetingDB.PRIORITY_META['보통'];

  // ── 첨부 ──
  const MAX_FILES = 8;
  const pendingFiles = [];      // 회의자료
  const pendingProgress = [];   // 조치 증빙
  const clearBucket = (b) => { b.length = 0; };
  let uploading = 0;
  const setBusy = (on) => {
    uploading += on ? 1 : -1;
    if (uploading < 0) uploading = 0;
    document.querySelectorAll('[data-upload-lock]').forEach(el => { el.disabled = uploading > 0; });
  };
  const pickInto = async (input, bucket, kind, boxId) => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    setBusy(true);
    App.toast(`첨부 ${files.length}건을 저장하는 중입니다`, 'info');
    try {
      for (const f of files) {
        if (bucket.length >= MAX_FILES) { App.toast(`첨부는 최대 ${MAX_FILES}건까지 가능합니다`, 'warning'); break; }
        try {
          const meta = await PhotoStore.save(f, { kind, by: actorName() });
          if (meta) bucket.push(meta);
        } catch (e) { App.toast(e.message || '첨부 저장에 실패했습니다', 'error'); }
        renderBucket(bucket, boxId, kind);
      }
    } finally { setBusy(false); }
  };
  const onMeetingFiles = (input) => pickInto(input, pendingFiles, 'DOC', 'mt-file-box');
  const onProgressFiles = (input) => pickInto(input, pendingProgress, 'PROGRESS', 'mt-pg-box');
  const removeFile = async (i) => { const p = pendingFiles[i]; pendingFiles.splice(i, 1); renderBucket(pendingFiles, 'mt-file-box', 'DOC'); await PhotoStore.remove(p); };
  const removeProgressFile = async (i) => { const p = pendingProgress[i]; pendingProgress.splice(i, 1); renderBucket(pendingProgress, 'mt-pg-box', 'PROGRESS'); await PhotoStore.remove(p); };
  const renderBucket = (bucket, elId, kind) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const rm = kind === 'DOC' ? 'removeFile' : 'removeProgressFile';
    el.innerHTML = bucket.length ? bucket.map((p, i) => `
      <div class="af-thumb">
        ${p.doc ? `<div class="af-thumb-doc" title="${esc(p.name)}">${esc(PhotoStore.typeLabel(p))}</div>`
                : `<img src="${PhotoStore.thumbOf(p)}" alt="${esc(p.name || '')}">`}
        <button type="button" class="af-thumb-x" onclick="MeetingPage.${rm}(${i})" title="삭제">✕</button>
      </div>`).join('') : '<span class="text-muted" style="font-size:12px">첨부 없음</span>';
  };
  const viewFiles = (meetingId, agendaId, progressId) => {
    const m = MeetingDB.getMeeting(meetingId);
    if (!m) return;
    if (!agendaId) { PhotoStore.openViewer(m.files, 0); return; }
    const a = (m.agenda || []).find(x => x.id === agendaId);
    const h = a && (a.history || []).find(x => x.id === progressId);
    if (h) PhotoStore.openViewer(h.photos, 0);
  };

  // ============================================================
  // 다른 화면에서 호출하는 진입점 — 안건 대기함에 담는다
  //   MeetingPage.quickAgenda({sourceType, sourceId, title, content, category, factory, priority})
  // ============================================================
  //   호출한 화면은 대부분 모달이 열려 있거나 페이지 전체 렌더 구조라
  //   여기서 App.refreshPage() 를 부르면 그 화면이 통째로 다시 그려져 모달이 닫힌다.
  //   그래서 토스트와 배지만 갱신하고 화면은 건드리지 않는다.
  const quickAgenda = (d) => {
    if (typeof MeetingDB === 'undefined') return false;
    const r = MeetingDB.pushInbox({ ...d, by: actorName() });
    App.toast(r.msg, r.ok ? 'success' : 'warning');
    if (r.ok) { try { App.updateBadges(); } catch (_) {} }
    return r.ok;
  };

  // ── 목록(회의록) ──
  const logView = () => {
    const f = fac();
    const st = MeetingDB.stats(f, yearSel);
    const list = MeetingDB.getMeetings(f, yearSel);
    const inbox = MeetingDB.getInbox();
    const ys = MeetingDB.years();

    const yBtn = (v, label) => `<button class="btn btn-sm ${yearSel === v ? 'btn-primary' : 'btn-ghost'}" onclick="MeetingPage.setYear('${v}')">${label}</button>`;

    const cards = list.length ? list.map(m => {
      const ag = m.agenda || [];
      const open = ag.filter(MeetingDB.isOpen).length;
      const over = ag.filter(MeetingDB.isOverdue).length;
      return `
      <div class="card mt-card" onclick="MeetingPage.open('${m.id}')" style="cursor:pointer">
        <div class="flex items-center justify-between" style="gap:10px;flex-wrap:wrap">
          <div style="min-width:0">
            <div class="flex items-center" style="gap:8px;flex-wrap:wrap">
              <span class="badge ${m.status === 'CONFIRMED' ? 'badge-pass' : 'badge-warning'}">${m.status === 'CONFIRMED' ? '확정' : '작성중'}</span>
              <span class="tag tag-gray">${esc(m.type)}</span>
              <b style="font-size:14px">${esc(m.title)}</b>
            </div>
            <div class="text-muted" style="font-size:12px;margin-top:5px">
              ${esc(m.date)}${m.time ? ' ' + esc(m.time) : ''} · ${esc(MeetingDB.factoryName(m.factory))}${m.place ? ' · ' + esc(m.place) : ''}
              ${m.chair ? ' · 주관 ' + esc(m.chair) : ''} · 참석 ${(m.attendees || []).length}명
            </div>
          </div>
          <div style="display:flex;gap:14px;text-align:center;flex:0 0 auto">
            <div><div class="text-muted" style="font-size:11px">안건</div><div style="font-weight:700">${ag.length}</div></div>
            <div><div class="text-muted" style="font-size:11px">미종결</div><div style="font-weight:700;color:${open ? '#d4820f' : 'inherit'}">${open}</div></div>
            <div><div class="text-muted" style="font-size:11px">기한초과</div><div style="font-weight:700;color:${over ? '#e5484d' : 'inherit'}">${over}</div></div>
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="card text-muted" style="text-align:center;padding:26px">등록된 회의가 없습니다</div>`;

    return `
    <div class="fade-in">
      ${tabsHtml()}

      ${inbox.length ? `
      <div class="card mt-inbox" style="margin-bottom:14px">
        <div class="flex items-center justify-between" style="gap:10px;flex-wrap:wrap">
          <div>
            <b>안건 대기함 ${inbox.length}건</b>
            <div class="text-muted" style="font-size:12px;margin-top:3px">다른 화면에서 올린 안건입니다. 회의를 열고 안건으로 담으세요.</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="MeetingPage.openInbox()">대기함 보기</button>
        </div>
      </div>` : ''}

      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-card"><div class="stat-label">회의</div><div class="stat-value">${st.meetings}</div><div class="stat-sub">기록 건수</div></div>
        <div class="stat-card"><div class="stat-label">안건</div><div class="stat-value">${st.agenda}</div><div class="stat-sub">종결률 ${st.closeRate}%${st.raised > st.agenda ? ` · 상정 ${st.raised}회` : ''}</div></div>
        <div class="stat-card ${st.open ? 'danger' : 'ok'}"><div class="stat-label">미종결</div><div class="stat-value">${st.open}</div><div class="stat-sub">조치 진행 필요</div></div>
        <div class="stat-card ${st.overdue ? 'danger' : ''}"><div class="stat-label">기한 초과</div><div class="stat-value">${st.overdue}</div><div class="stat-sub">이월 ${st.carried}건</div></div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">품질회의 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${yBtn('ALL', '전체')}${ys.slice(0, 3).map(y => yBtn(y, y)).join('')}
            <button class="btn btn-primary btn-sm" onclick="MeetingPage.openMeetingModal('')">＋ 회의 등록</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">${cards}</div>
      </div>
    </div>`;
  };

  const tabsHtml = () => `
    <div class="mt-tabs">
      <button class="mt-tab ${tab === 'LOG' ? 'active' : ''}" onclick="MeetingPage.setTab('LOG')">회의록</button>
      <button class="mt-tab ${tab === 'TRACK' ? 'active' : ''}" onclick="MeetingPage.setTab('TRACK')">안건 추적</button>
    </div>`;

  // ── 회의 상세 ──
  const detailView = (id) => {
    const m = MeetingDB.getMeeting(id);
    if (!m) { detailId = null; return logView(); }
    const ag = (m.agenda || []).slice().sort((a, b) => (a.no || 0) - (b.no || 0));
    const locked = m.status === 'CONFIRMED';

    const agendaCards = ag.length ? ag.map(a => agendaCard(m, a, locked)).join('')
      : `<div class="text-muted" style="text-align:center;padding:22px;font-size:13px">안건이 없습니다. 안건을 추가하거나 대기함·이월에서 담으세요.</div>`;

    const files = PhotoStore.normalize(m.files);

    return `
    <div class="fade-in">
      <div class="card">
        <div class="card-head">
          <button class="btn btn-ghost btn-sm" onclick="MeetingPage.back()">← 목록</button>
          <div class="card-title" style="margin:0">${esc(m.title)}</div>
          <div style="display:flex;gap:6px">
            ${locked
              ? `<button class="btn btn-ghost btn-sm" onclick="MeetingPage.reopen('${m.id}')">확정 해제</button>`
              : `<button class="btn btn-ghost btn-sm" onclick="MeetingPage.openMeetingModal('${m.id}')">수정</button>
                 <button class="btn btn-primary btn-sm" onclick="MeetingPage.confirm('${m.id}')">회의록 확정</button>`}
            <button class="btn btn-ghost btn-sm" onclick="MeetingPage.print('${m.id}')">인쇄</button>
            <button class="btn btn-ghost btn-sm" onclick="MeetingPage.remove('${m.id}')">삭제</button>
          </div>
        </div>

        <div class="mt-info">
          <div><span class="mt-info-k">일시</span>${esc(m.date)}${m.time ? ' ' + esc(m.time) : ''}</div>
          <div><span class="mt-info-k">구분</span>${esc(m.type)}</div>
          <div><span class="mt-info-k">장소</span>${esc(m.place || '-')}</div>
          <div><span class="mt-info-k">공장</span>${esc(MeetingDB.factoryName(m.factory))}</div>
          <div><span class="mt-info-k">주관</span>${esc(m.chair || '-')}</div>
          <div><span class="mt-info-k">상태</span><span class="badge ${locked ? 'badge-pass' : 'badge-warning'}">${locked ? '확정' : '작성중'}</span>${locked && m.confirmedBy ? ` <span class="text-muted" style="font-size:11px">${esc(m.confirmedBy)}</span>` : ''}</div>
          <div style="grid-column:1/-1"><span class="mt-info-k">참석자</span>${(m.attendees || []).length ? esc((m.attendees || []).join(', ')) : '-'}</div>
          ${m.note ? `<div style="grid-column:1/-1"><span class="mt-info-k">비고</span>${esc(m.note)}</div>` : ''}
        </div>

        <div class="mt-files no-print">
          <span class="mt-info-k">회의자료</span>
          ${files.length ? files.map((p, i) => `<button class="btn btn-ghost btn-xs" onclick="MeetingPage.viewFiles('${m.id}')">${esc(PhotoStore.typeLabel(p))} ${esc(p.name || '')}</button>`).join('')
            : '<span class="text-muted" style="font-size:12px">없음</span>'}
          ${locked ? '' : `<label class="btn btn-ghost btn-xs" style="cursor:pointer;margin:0">＋ 자료 첨부
            <input type="file" accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.hwp,.hwpx,image/*" multiple style="display:none" onchange="MeetingPage.onMeetingFilesDirect(this,'${m.id}')"></label>`}
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-head">
          <div class="card-title">안건 <span class="text-muted" style="font-weight:400">(${ag.length}건)</span></div>
          ${locked ? '<span class="text-muted" style="font-size:12px">확정된 회의록입니다. 안건 조치는 계속 등록할 수 있습니다.</span>' : `
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="MeetingPage.openCarry('${m.id}')">이월 안건 담기</button>
            <button class="btn btn-ghost btn-sm" onclick="MeetingPage.openInbox('${m.id}')">대기함에서 담기 ${MeetingDB.inboxCount() ? `(${MeetingDB.inboxCount()})` : ''}</button>
            <button class="btn btn-primary btn-sm" onclick="MeetingPage.openAgendaModal('${m.id}','')">＋ 안건 추가</button>
          </div>`}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">${agendaCards}</div>
      </div>
    </div>`;
  };

  // 안건 카드 — 결정사항과 조치 이력을 한 눈에
  const agendaCard = (m, a, locked) => {
    const s = smeta(a.status);
    const over = MeetingDB.isOverdue(a);
    const hist = (a.history || []).slice().sort((x, y) => String(y.date).localeCompare(String(x.date)));
    const src = a.sourceType && a.sourceType !== 'NONE';
    return `
    <div class="card mt-agenda ${over ? 'mt-agenda-over' : ''}">
      <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap">
        <div class="flex items-center" style="gap:7px;flex-wrap:wrap;min-width:0">
          <span class="mt-no">${a.no}</span>
          <span class="badge ${pmeta(a.priority).cls}">${esc(a.priority)}</span>
          <span class="badge ${s.cls}">${esc(a.status)}</span>
          <span class="tag tag-gray">${esc(a.category)}</span>
          <b style="font-size:14px">${esc(a.title)}</b>
          ${Number(a.carryCount) > 0 ? `<span class="tag tag-orange" title="이전 회의에서 이월된 안건">이월 ${a.carryCount}회</span>` : ''}
        </div>
        <div style="display:flex;gap:5px;flex:0 0 auto" class="no-print">
          <button class="btn btn-ghost btn-xs" onclick="MeetingPage.openProgressModal('${m.id}','${a.id}')">조치 등록</button>
          ${locked ? '' : `<button class="btn btn-ghost btn-xs" onclick="MeetingPage.openAgendaModal('${m.id}','${a.id}')">수정</button>
          <button class="btn btn-ghost btn-xs" onclick="MeetingPage.removeAgenda('${m.id}','${a.id}')">삭제</button>`}
        </div>
      </div>

      <div class="mt-agenda-meta">
        ${a.owner ? `<span>담당 <b>${esc(a.owner)}</b>${a.dept ? ` (${esc(a.dept)})` : ''}</span>` : '<span class="text-red">담당 미지정</span>'}
        ${a.dueDate ? `<span>기한 <b class="${over ? 'text-red' : ''}">${esc(a.dueDate)}</b>${over ? ' (초과)' : ''}</span>` : ''}
        ${src ? `<span>출처 <button class="mt-src no-print" onclick="MeetingPage.goSource('${esc(a.sourceType)}','${esc(a.sourceId)}')">${esc(MeetingDB.sourceLabel(a.sourceType))}${a.sourceLabel ? ' · ' + esc(a.sourceLabel) : ''}</button></span>` : ''}
      </div>

      ${a.content ? `<div class="mt-block"><div class="mt-block-k">논의 내용</div><div>${esc(a.content).replace(/\n/g, '<br>')}</div></div>` : ''}
      ${a.decision ? `<div class="mt-block mt-decision"><div class="mt-block-k">결정 사항</div><div>${esc(a.decision).replace(/\n/g, '<br>')}</div></div>` : ''}

      ${hist.length ? `
      <div class="mt-hist">
        <div class="mt-block-k">조치 이력 ${hist.length}건</div>
        ${hist.map(h => `
          <div class="mt-hist-row">
            <span class="mt-hist-date">${esc(h.date)}</span>
            <span class="badge ${smeta(h.status).cls}">${esc(h.status)}</span>
            <span class="mt-hist-txt">${esc(h.content)}</span>
            ${h.by ? `<span class="text-muted" style="font-size:11px">${esc(h.by)}</span>` : ''}
            ${(h.photos || []).length ? `<button class="btn btn-ghost btn-xs no-print" onclick="MeetingPage.viewFiles('${m.id}','${a.id}','${h.id}')">증빙 ${(h.photos || []).length}</button>` : ''}
            <button class="mt-hist-x no-print" onclick="MeetingPage.removeProgress('${m.id}','${a.id}','${h.id}')" title="삭제">✕</button>
          </div>`).join('')}
      </div>` : `<div class="text-muted" style="font-size:12px;margin-top:8px">조치 이력이 없습니다</div>`}
    </div>`;
  };

  // ── 안건 추적 ──
  const trackView = () => {
    const f = fac();
    const st = MeetingDB.stats(f, 'ALL');
    const owners = MeetingDB.byOwner(f);
    const stalledList = MeetingDB.stalled(f, 1);
    // 이월된 안건은 계보당 최신 1건만 — 같은 사안이 회의 수만큼 늘어나 보이면 안 된다
    let list = MeetingDB.openAgenda(f);
    if (trackFilter === 'OVERDUE') list = list.filter(a => a.overdue);
    else if (trackFilter === 'ALL') {
      list = MeetingDB.latestByRoot(MeetingDB.allAgenda(f)).map(a => ({ ...a, overdue: MeetingDB.isOverdue(a) }));
    }

    const fBtn = (v, label) => `<button class="btn btn-sm ${trackFilter === v ? 'btn-primary' : 'btn-ghost'}" onclick="MeetingPage.setTrack('${v}')">${label}</button>`;

    const rows = list.length ? list.map(a => `
      <tr onclick="MeetingPage.open('${a.meetingId}')" style="cursor:pointer">
        <td class="text-xs text-muted">${esc(a.meetingDate)}</td>
        <td><b>${esc(a.title)}</b>${Number(a.carryCount) > 0 ? ` <span class="tag tag-orange">이월 ${a.carryCount}</span>` : ''}
          ${a.lastProgress ? `<div class="text-xs text-muted ellipsis" style="max-width:340px">최근: ${esc(a.lastProgress)}</div>` : ''}</td>
        <td><span class="tag tag-gray">${esc(a.category)}</span></td>
        <td>${esc(a.owner || '-')}</td>
        <td class="${a.overdue ? 'text-red' : ''}">${esc(a.dueDate || '-')}${a.overdue ? ' (초과)' : ''}</td>
        <td><span class="badge ${pmeta(a.priority).cls}">${esc(a.priority)}</span></td>
        <td><span class="badge ${smeta(a.status).cls}">${esc(a.status)}</span></td>
        <td class="no-print"><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();MeetingPage.openProgressModal('${a.meetingId}','${a.id}')">조치</button></td>
      </tr>`).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">해당 안건이 없습니다</td></tr>`;

    const ownerRows = owners.length ? owners.map(o => `
      <tr><td><b>${esc(o.name)}</b></td>
        <td class="td-right">${o.n}</td>
        <td class="td-right ${o.overdue ? 'text-red' : ''}">${o.overdue}</td>
        <td class="td-right">${o.urgent}</td></tr>`).join('')
      : `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:18px">미종결 안건이 없습니다</td></tr>`;

    return `
    <div class="fade-in">
      ${tabsHtml()}

      <div class="stat-grid" style="margin-bottom:14px">
        <div class="stat-card ${st.open ? 'danger' : 'ok'}"><div class="stat-label">미종결 안건</div><div class="stat-value">${st.open}</div><div class="stat-sub">전체 ${st.agenda}건 중</div></div>
        <div class="stat-card ${st.overdue ? 'danger' : ''}"><div class="stat-label">기한 초과</div><div class="stat-value">${st.overdue}</div><div class="stat-sub">즉시 조치 필요</div></div>
        <div class="stat-card ${st.urgent ? 'danger' : ''}"><div class="stat-label">긴급</div><div class="stat-value">${st.urgent}</div><div class="stat-sub">미종결 중</div></div>
        <div class="stat-card ${stalledList.length ? 'danger' : 'ok'}"><div class="stat-label">장기 미해결</div><div class="stat-value">${stalledList.length}</div><div class="stat-sub">1회 이상 이월</div></div>
      </div>

      ${stalledList.length ? `
      <div class="card mt-stalled" style="margin-bottom:14px">
        <div class="section-label">회의를 넘겨도 끝나지 않는 안건</div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${stalledList.slice(0, 8).map(a => `
            <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;cursor:pointer" onclick="MeetingPage.open('${a.meetingId}')">
              <div style="min-width:0">
                <b>${esc(a.title)}</b>
                <span class="tag tag-orange" style="margin-left:6px">이월 ${a.carryCount}회</span>
                <div class="text-xs text-muted">최초 논의 이후 ${MeetingDB.lineage(a).length}개 회의에서 다뤄짐 · 담당 ${esc(a.owner || '미지정')}</div>
              </div>
              <span class="badge ${smeta(a.status).cls}">${esc(a.status)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="card" style="margin-bottom:14px">
        <div class="card-head">
          <div class="card-title">안건 목록 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
          <div style="display:flex;gap:6px">${fBtn('OPEN', '미종결')}${fBtn('OVERDUE', '기한초과')}${fBtn('ALL', '전체')}</div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>회의일</th><th>안건</th><th>분류</th><th>담당</th><th>기한</th><th>중요도</th><th>상태</th><th class="no-print"></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="section-label">담당자별 미종결 안건</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>담당</th><th class="td-right">미종결</th><th class="td-right">기한초과</th><th class="td-right">긴급</th></tr></thead>
            <tbody>${ownerRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  };

  // ── 모달 셸 ──
  const modalsHtml = () => `
    <div class="modal-overlay" id="mt-meeting-modal">
      <div class="modal modal-lg"><div class="modal-header"><div class="modal-title">회의 등록/수정</div>
        <button class="modal-close" onclick="MeetingPage.closeModal('mt-meeting-modal')">✕</button></div>
        <div id="mt-meeting-body"></div></div>
    </div>
    <div class="modal-overlay" id="mt-agenda-modal">
      <div class="modal modal-lg"><div class="modal-header"><div class="modal-title">안건</div>
        <button class="modal-close" onclick="MeetingPage.closeModal('mt-agenda-modal')">✕</button></div>
        <div id="mt-agenda-body"></div></div>
    </div>
    <div class="modal-overlay" id="mt-progress-modal">
      <div class="modal"><div class="modal-header"><div class="modal-title">조치 등록</div>
        <button class="modal-close" onclick="MeetingPage.closeModal('mt-progress-modal')">✕</button></div>
        <div id="mt-progress-body"></div></div>
    </div>
    <div class="modal-overlay" id="mt-pick-modal">
      <div class="modal modal-lg"><div class="modal-header"><div class="modal-title" id="mt-pick-title">안건 담기</div>
        <button class="modal-close" onclick="MeetingPage.closeModal('mt-pick-modal')">✕</button></div>
        <div id="mt-pick-body"></div></div>
    </div>`;

  const render = () => {
    const body = detailId ? detailView(detailId) : (tab === 'TRACK' ? trackView() : logView());
    return body + modalsHtml();
  };
  const afterRender = () => {};

  // ── 회의 등록/수정 ──
  const openMeetingModal = (id) => {
    const m = id ? MeetingDB.getMeeting(id) : null;
    const body = document.getElementById('mt-meeting-body');
    if (!body) return;
    const curFac = m ? m.factory : (fac() !== 'ALL' ? fac() : 'NS');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-4">
          <div class="form-group"><label class="form-label">회의일 <span class="req">*</span></label>
            <input type="date" class="form-input" id="mt-date" value="${esc(m?.date || todayStr())}"></div>
          <div class="form-group"><label class="form-label">시각</label>
            <input type="time" class="form-input" id="mt-time" value="${esc(m?.time || '')}"></div>
          <div class="form-group"><label class="form-label">구분</label>
            <select class="form-input" id="mt-type">${MeetingDB.MEETING_TYPES.map(t => `<option value="${esc(t)}" ${m?.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">공장</label>
            <select class="form-input" id="mt-factory">${MeetingDB.FACTORIES.map(x => `<option value="${x.code}" ${curFac === x.code ? 'selected' : ''}>${x.name}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">회의명</label>
          <input type="text" class="form-input" id="mt-title" value="${esc(m?.title || '')}" placeholder="비워두면 회의일과 구분으로 자동 생성됩니다"></div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">장소</label>
            <input type="text" class="form-input" id="mt-place" value="${esc(m?.place || '')}" placeholder="예) 논산공장 회의실"></div>
          <div class="form-group"><label class="form-label">주관</label>
            <input type="text" class="form-input" id="mt-chair" value="${esc(m?.chair || actorName())}"></div>
        </div>
        <div class="form-group"><label class="form-label">참석자 <span class="text-muted" style="font-weight:400;font-size:12px">(쉼표로 구분)</span></label>
          <input type="text" class="form-input" id="mt-attendees" value="${esc((m?.attendees || []).join(', '))}" placeholder="예) 품질팀장, 생산팀장, 구매팀"></div>
        <div class="form-group"><label class="form-label">비고</label>
          <textarea class="form-input" id="mt-note" rows="2">${esc(m?.note || '')}</textarea></div>
        ${m ? '' : `
        <div class="form-group"><label class="form-label">회의자료 <span class="text-muted" style="font-weight:400;font-size:12px">(최대 ${MAX_FILES}건)</span></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">파일 선택
            <input type="file" accept=".pdf,.xlsx,.xls,.docx,.doc,.pptx,.hwp,.hwpx,image/*" multiple style="display:none" onchange="MeetingPage.onMeetingFiles(this)"></label>
          <div id="mt-file-box" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
        </div>`}
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MeetingPage.closeModal('mt-meeting-modal')">취소</button>
          <button class="btn btn-primary" data-upload-lock onclick="MeetingPage.saveMeeting('${esc(id || '')}')">${m ? '수정' : '등록'}</button>
        </div>
      </div>`;
    if (!m) { clearBucket(pendingFiles); renderBucket(pendingFiles, 'mt-file-box', 'DOC'); }
    document.getElementById('mt-meeting-modal').classList.add('open');
  };
  const saveMeeting = (id) => {
    if (uploading > 0) { App.toast('첨부 저장이 끝난 뒤에 저장해 주세요', 'warning'); return; }
    const g = (x) => document.getElementById(x)?.value || '';
    const date = g('mt-date');
    if (!date) { App.toast('회의일을 입력하세요', 'error'); return; }
    const data = {
      date, time: g('mt-time'), type: g('mt-type'), factory: g('mt-factory'),
      title: g('mt-title'), place: g('mt-place'), chair: g('mt-chair'),
      attendees: g('mt-attendees').split(',').map(s => s.trim()).filter(Boolean),
      note: g('mt-note'),
    };
    if (id) { MeetingDB.updateMeeting(id, data); App.toast('회의 정보를 수정했습니다', 'success'); }
    else {
      const r = MeetingDB.addMeeting({ ...data, files: pendingFiles.slice(), createdBy: actorName() });
      clearBucket(pendingFiles);
      App.toast('회의를 등록했습니다', 'success');
      detailId = r.id;
    }
    closeModal('mt-meeting-modal');
    App.refreshPage();
  };
  // 상세 화면에서 자료를 바로 추가(즉시 저장)
  const onMeetingFilesDirect = async (input, meetingId) => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    App.toast(`자료 ${files.length}건을 저장하는 중입니다`, 'info');
    for (const f of files) {
      const cur = (MeetingDB.getMeeting(meetingId)?.files || []).slice();
      if (cur.length >= MAX_FILES) { App.toast(`자료는 최대 ${MAX_FILES}건까지 첨부할 수 있습니다`, 'warning'); break; }
      try {
        const meta = await PhotoStore.save(f, { kind: 'DOC', by: actorName() });
        if (meta) MeetingDB.updateMeeting(meetingId, { files: cur.concat(meta) });
      } catch (e) { App.toast(e.message || '자료 저장에 실패했습니다', 'error'); }
    }
    App.refreshPage();
  };

  const confirm_ = (id) => {
    const r = MeetingDB.confirmMeeting(id, actorName());
    if (!r.ok) { App.toast(r.msg, 'error'); return; }
    App.toast('회의록을 확정했습니다', 'success');
    App.refreshPage();
  };
  const reopen = (id) => {
    if (!confirm('확정을 해제하고 다시 편집할까요?')) return;
    MeetingDB.reopenMeeting(id);
    App.toast('확정을 해제했습니다', 'info');
    App.refreshPage();
  };
  const remove = (id) => {
    const m = MeetingDB.getMeeting(id);
    if (!m) return;
    if (!confirm(`"${m.title}" 회의록을 삭제할까요?\n안건 ${(m.agenda || []).length}건과 조치 이력도 함께 삭제됩니다.`)) return;
    MeetingDB.deleteMeeting(id);
    App.toast('삭제되었습니다', 'info');
    detailId = null;
    App.refreshPage();
  };

  // ── 안건 추가/수정 ──
  const openAgendaModal = (meetingId, agendaId) => {
    const a = agendaId ? MeetingDB.findAgenda(meetingId, agendaId) : null;
    const body = document.getElementById('mt-agenda-body');
    if (!body) return;
    agTarget = { meetingId, agendaId };
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-group"><label class="form-label">안건명 <span class="req">*</span></label>
          <input type="text" class="form-input" id="mt-ag-title" value="${esc(a?.title || '')}" placeholder="예) 펠릿 분화율 클레임 재발 방지"></div>
        <div class="form-grid form-grid-4">
          <div class="form-group"><label class="form-label">분류</label>
            <select class="form-input" id="mt-ag-cat">${MeetingDB.AGENDA_CATEGORIES.map(c => `<option value="${esc(c)}" ${a?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">중요도</label>
            <select class="form-input" id="mt-ag-pri">${MeetingDB.PRIORITIES.map(p => `<option value="${esc(p)}" ${a?.priority === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">담당자</label>
            <input type="text" class="form-input" id="mt-ag-owner" value="${esc(a?.owner || '')}"></div>
          <div class="form-group"><label class="form-label">조치 기한</label>
            <input type="date" class="form-input" id="mt-ag-due" value="${esc(a?.dueDate || '')}"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">담당 부서</label>
            <input type="text" class="form-input" id="mt-ag-dept" value="${esc(a?.dept || '')}" placeholder="예) 생산팀"></div>
          <div class="form-group"><label class="form-label">상태</label>
            <select class="form-input" id="mt-ag-status">${MeetingDB.AGENDA_STATUS.map(s => `<option value="${esc(s)}" ${a?.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">논의 내용</label>
          <textarea class="form-input" id="mt-ag-content" rows="3" placeholder="현황·원인·논의된 의견">${esc(a?.content || '')}</textarea></div>
        <div class="form-group"><label class="form-label">결정 사항</label>
          <textarea class="form-input" id="mt-ag-decision" rows="3" placeholder="무엇을, 누가, 언제까지 — 조치 추적의 기준이 됩니다">${esc(a?.decision || '')}</textarea></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MeetingPage.closeModal('mt-agenda-modal')">취소</button>
          <button class="btn btn-primary" onclick="MeetingPage.saveAgenda()">${a ? '수정' : '추가'}</button>
        </div>
      </div>`;
    document.getElementById('mt-agenda-modal').classList.add('open');
  };
  const saveAgenda = () => {
    if (!agTarget) return;
    const g = (x) => document.getElementById(x)?.value || '';
    const title = g('mt-ag-title').trim();
    if (!title) { App.toast('안건명을 입력하세요', 'error'); return; }
    const data = {
      title, category: g('mt-ag-cat'), priority: g('mt-ag-pri'), owner: g('mt-ag-owner'),
      dept: g('mt-ag-dept'), dueDate: g('mt-ag-due'), status: g('mt-ag-status'),
      content: g('mt-ag-content'), decision: g('mt-ag-decision'),
    };
    if (agTarget.agendaId) MeetingDB.updateAgenda(agTarget.meetingId, agTarget.agendaId, data);
    else MeetingDB.addAgenda(agTarget.meetingId, data);
    App.toast(agTarget.agendaId ? '안건을 수정했습니다' : '안건을 추가했습니다', 'success');
    agTarget = null;
    closeModal('mt-agenda-modal');
    App.refreshPage();
  };
  const removeAgenda = (meetingId, agendaId) => {
    const a = MeetingDB.findAgenda(meetingId, agendaId);
    if (!a) return;
    if (!confirm(`"${a.title}" 안건을 삭제할까요?\n조치 이력 ${(a.history || []).length}건도 함께 삭제됩니다.`)) return;
    MeetingDB.deleteAgenda(meetingId, agendaId);
    App.toast('삭제되었습니다', 'info');
    App.refreshPage();
  };

  // ── 조치 등록 ──
  const openProgressModal = (meetingId, agendaId) => {
    const a = MeetingDB.findAgenda(meetingId, agendaId);
    const body = document.getElementById('mt-progress-body');
    if (!a || !body) return;
    pgTarget = { meetingId, agendaId };
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="text-muted" style="font-size:12px">${esc(a.title)}</div>
        ${a.decision ? `<div class="mt-block mt-decision" style="margin:0"><div class="mt-block-k">결정 사항</div><div>${esc(a.decision).replace(/\n/g, '<br>')}</div></div>` : ''}
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">조치일</label>
            <input type="date" class="form-input" id="mt-pg-date" value="${todayStr()}"></div>
          <div class="form-group"><label class="form-label">상태</label>
            <select class="form-input" id="mt-pg-status">${MeetingDB.AGENDA_STATUS.map(s => `<option value="${esc(s)}" ${s === '진행중' ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label class="form-label">진행 내용 <span class="req">*</span></label>
          <textarea class="form-input" id="mt-pg-content" rows="4" placeholder="무엇을 했고 어디까지 진행됐는지">${''}</textarea></div>
        <div class="form-group"><label class="form-label">조치자</label>
          <input type="text" class="form-input" id="mt-pg-by" value="${esc(actorName())}" readonly></div>
        <div class="form-group"><label class="form-label">증빙 <span class="text-muted" style="font-weight:400;font-size:12px">(사진·문서 최대 ${MAX_FILES}건)</span></label>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;display:inline-block;margin:0">파일 선택 / 촬영
            <input type="file" accept="image/*,.pdf,.xlsx,.docx,.hwp" multiple capture="environment" style="display:none" onchange="MeetingPage.onProgressFiles(this)"></label>
          <div id="mt-pg-box" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MeetingPage.closeModal('mt-progress-modal')">취소</button>
          <button class="btn btn-primary" data-upload-lock onclick="MeetingPage.saveProgress()">등록</button>
        </div>
      </div>`;
    clearBucket(pendingProgress);
    renderBucket(pendingProgress, 'mt-pg-box', 'PROGRESS');
    document.getElementById('mt-progress-modal').classList.add('open');
  };
  const saveProgress = () => {
    if (!pgTarget) return;
    if (uploading > 0) { App.toast('첨부 저장이 끝난 뒤에 등록해 주세요', 'warning'); return; }
    const g = (x) => document.getElementById(x)?.value || '';
    const content = g('mt-pg-content').trim();
    if (!content) { App.toast('진행 내용을 입력하세요', 'error'); return; }
    MeetingDB.addProgress(pgTarget.meetingId, pgTarget.agendaId, {
      date: g('mt-pg-date'), status: g('mt-pg-status'), content, by: actorName(),
      photos: pendingProgress.slice(),
    });
    clearBucket(pendingProgress);
    pgTarget = null;
    App.toast('조치를 등록했습니다', 'success');
    closeModal('mt-progress-modal');
    App.refreshPage();
  };
  const removeProgress = (meetingId, agendaId, progressId) => {
    if (!confirm('이 조치 이력을 삭제할까요?')) return;
    MeetingDB.deleteProgress(meetingId, agendaId, progressId);
    App.toast('삭제되었습니다', 'info');
    App.refreshPage();
  };

  // ── 대기함 / 이월 담기 ──
  const openInbox = (meetingId) => {
    const box = MeetingDB.getInbox();
    const body = document.getElementById('mt-pick-body');
    if (!body) return;
    document.getElementById('mt-pick-title').textContent = meetingId ? '대기함에서 안건 담기' : '안건 대기함';
    const rows = box.length ? box.map(x => `
      <label class="mt-pick-row">
        ${meetingId ? `<input type="checkbox" class="mt-pick-cb" value="${esc(x.id)}" checked>` : ''}
        <div style="min-width:0;flex:1">
          <div><span class="tag tag-gray">${esc(MeetingDB.sourceLabel(x.sourceType))}</span> <b>${esc(x.title)}</b></div>
          ${x.content ? `<div class="text-xs text-muted ellipsis">${esc(x.content)}</div>` : ''}
          <div class="text-xs text-muted">${esc(x.sourceLabel || '')}${x.by ? ' · ' + esc(x.by) : ''} · ${String(x.at).slice(0, 10)}</div>
        </div>
        <button class="mt-hist-x" onclick="event.preventDefault();MeetingPage.dropInbox('${esc(x.id)}','${esc(meetingId || '')}')" title="대기함에서 제거">✕</button>
      </label>`).join('') : '<div class="text-muted" style="text-align:center;padding:22px;font-size:13px">대기함이 비어 있습니다</div>';

    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="text-muted" style="font-size:12px">
          VOC·부적합·지적사항 등 각 화면의 "회의 안건 등록" 버튼으로 담긴 항목입니다.
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;max-height:52vh;overflow:auto">${rows}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MeetingPage.closeModal('mt-pick-modal')">닫기</button>
          ${meetingId && box.length ? `<button class="btn btn-primary" onclick="MeetingPage.takeInbox('${esc(meetingId)}')">선택 항목 안건으로 담기</button>` : ''}
        </div>
      </div>`;
    document.getElementById('mt-pick-modal').classList.add('open');
  };
  const dropInbox = (id, meetingId) => {
    MeetingDB.removeInbox(id);
    openInbox(meetingId || '');
  };
  const takeInbox = (meetingId) => {
    const ids = [...document.querySelectorAll('.mt-pick-cb:checked')].map(x => x.value);
    if (!ids.length) { App.toast('담을 항목을 선택하세요', 'warning'); return; }
    const box = MeetingDB.getInbox();
    let n = 0;
    ids.forEach(id => {
      const x = box.find(b => b.id === id);
      if (!x) return;
      MeetingDB.addAgenda(meetingId, {
        title: x.title, content: x.content, category: x.category || '기타', priority: x.priority,
        sourceType: x.sourceType, sourceId: x.sourceId, sourceLabel: x.sourceLabel,
      });
      MeetingDB.removeInbox(id);
      n++;
    });
    App.toast(`안건 ${n}건을 담았습니다`, 'success');
    closeModal('mt-pick-modal');
    App.refreshPage();
  };

  const openCarry = (meetingId) => {
    const m = MeetingDB.getMeeting(meetingId);
    if (!m) return;
    const cands = MeetingDB.carryOverCandidates(m.factory, meetingId)
      .filter(c => !(m.agenda || []).some(a => (a.rootId || a.id) === (c.rootId || c.id)));
    const body = document.getElementById('mt-pick-body');
    if (!body) return;
    document.getElementById('mt-pick-title').textContent = '이월 안건 담기';
    const rows = cands.length ? cands.map(c => `
      <label class="mt-pick-row">
        <input type="checkbox" class="mt-carry-cb" value="${esc(c.id)}" data-meeting="${esc(c.meetingId)}" checked>
        <div style="min-width:0;flex:1">
          <div><span class="badge ${smeta(c.status).cls}">${esc(c.status)}</span> <b>${esc(c.title)}</b>
            ${Number(c.carryCount) > 0 ? `<span class="tag tag-orange">이월 ${c.carryCount}회</span>` : ''}</div>
          <div class="text-xs text-muted">${esc(c.meetingDate)} ${esc(c.meetingTitle)} · 담당 ${esc(c.owner || '미지정')}${c.dueDate ? ' · 기한 ' + esc(c.dueDate) : ''}</div>
        </div>
      </label>`).join('') : '<div class="text-muted" style="text-align:center;padding:22px;font-size:13px">이월할 미종결 안건이 없습니다</div>';

    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="text-muted" style="font-size:12px">
          이전 회의에서 끝나지 않은 안건입니다. 담으면 그동안의 조치 이력을 그대로 가지고 넘어옵니다.
        </div>
        <div style="display:flex;flex-direction:column;gap:7px;max-height:52vh;overflow:auto">${rows}</div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="MeetingPage.closeModal('mt-pick-modal')">닫기</button>
          ${cands.length ? `<button class="btn btn-primary" onclick="MeetingPage.takeCarry('${esc(meetingId)}')">선택 항목 이월</button>` : ''}
        </div>
      </div>`;
    document.getElementById('mt-pick-modal').classList.add('open');
  };
  const takeCarry = (meetingId) => {
    const picks = [...document.querySelectorAll('.mt-carry-cb:checked')];
    if (!picks.length) { App.toast('이월할 안건을 선택하세요', 'warning'); return; }
    const items = picks.map(cb => {
      const src = MeetingDB.findAgenda(cb.dataset.meeting, cb.value);
      return src ? { ...src, meetingId: cb.dataset.meeting } : null;
    }).filter(Boolean);
    const n = MeetingDB.carryOver(meetingId, items);
    App.toast(`안건 ${n}건을 이월했습니다`, 'success');
    closeModal('mt-pick-modal');
    App.refreshPage();
  };

  // ── 출처로 이동 ──
  //   각 화면의 상세 열기 함수는 App.refreshPage() 기반이라 해당 페이지에 가 있어야 동작한다.
  //   그래서 페이지 이동 뒤 한 박자 늦게 연다(기존 화면들이 쓰는 관용구).
  const goSource = (type, id) => {
    const page = MeetingDB.sourcePage(type);
    if (!page) { App.toast('연결된 화면이 없습니다', 'info'); return; }
    App.navigate(page);
    if (!id) return;
    setTimeout(() => {
      try {
        if (type === 'VOC' && typeof VOCPage !== 'undefined') VOCPage.openDetail(id);
        else if (type === 'FINDING' && typeof AuditFindingPage !== 'undefined') {
          AuditFindingPage.open(String(id).split('/')[0]);   // 복합키 auditId/findingId
        } else if (type === 'JOURNAL' && typeof JournalPage !== 'undefined') JournalPage.open(String(id).split('|')[0]);
        else if (type === 'ISSUE' && typeof ProcessIssuePage !== 'undefined') ProcessIssuePage.openResolveModal(id);
        else if (type === 'VALIDATION' && typeof ValidationPage !== 'undefined') ValidationPage.open(id);
        else if (type === 'CALIB' && typeof CalibrationPage !== 'undefined') CalibrationPage.open(id);
      } catch (_) {}
    }, 120);
  };

  // ── 인쇄 ──
  const print = (id) => {
    detailId = id;
    setTimeout(() => window.print(), 60);
  };

  // ── 상태 전환 ──
  const setTab = (t) => { tab = t; detailId = null; App.refreshPage(); };
  const setYear = (y) => { yearSel = y; App.refreshPage(); };
  const setTrack = (v) => { trackFilter = v; App.refreshPage(); };
  const open = (id) => { detailId = id; App.refreshPage(); };
  const back = () => { detailId = null; App.refreshPage(); };
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  // 다른 화면이 대기함 개수를 물어볼 때
  const inboxCount = () => { try { return MeetingDB.inboxCount(); } catch (_) { return 0; } };

  return {
    render, afterRender,
    setTab, setYear, setTrack, open, back, closeModal,
    openMeetingModal, saveMeeting, onMeetingFiles, onMeetingFilesDirect, removeFile,
    confirm: confirm_, reopen, remove, print,
    openAgendaModal, saveAgenda, removeAgenda,
    openProgressModal, saveProgress, removeProgress, onProgressFiles, removeProgressFile,
    openInbox, dropInbox, takeInbox, openCarry, takeCarry,
    viewFiles, goSource, quickAgenda, inboxCount,
  };
})();
