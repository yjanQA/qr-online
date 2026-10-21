// ============================================================
// calibration.js — 계측기 검교정 관리
//   HACCP 선행요건: 측정 신뢰성 확보(계측기 교정 유효기간·성적서 관리)
//   목록/등록 · 교정 실시 등록(성적서 첨부) · 교정 이력 · 임박/경과 알림
// ============================================================

const CalibrationPage = (() => {
  let detailId = null;      // 상세(이력) 보기 중인 계측기
  let typeFilter = 'ALL';   // 종류 필터
  let statusFilter = 'ALL'; // 상태 필터: ALL | valid | due | overdue | none
  let query = '';
  let pendingCert = null;   // 교정 실시 등록에 첨부한 성적서

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const meta = (s) => CalibDB.STATUS_META[s] || CalibDB.STATUS_META.none;

  // 성적서 첨부(2MB 제한, 이미지는 축소해 보관)
  const downscale = (file, maxDim = 1400, quality = 0.72) => new Promise((resolve) => {
    if (!String(file.type || '').startsWith('image/')) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) {
          const r = maxDim / Math.max(width, height);
          width = Math.round(width * r); height = Math.round(height * r);
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

  const onCertFile = async (input) => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { App.toast('성적서는 2MB 이하만 첨부할 수 있습니다', 'warning'); return; }
    const shrunk = await downscale(f);
    if (shrunk) {
      pendingCert = { name: f.name, mimeType: 'image/jpeg', size: f.size, dataUrl: shrunk };
      renderCertBox();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingCert = { name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, dataUrl: reader.result };
      renderCertBox();
    };
    reader.readAsDataURL(f);
  };
  const removeCert = () => { pendingCert = null; renderCertBox(); };
  const renderCertBox = () => {
    const el = document.getElementById('cal-cert-box');
    if (!el) return;
    el.innerHTML = pendingCert
      ? `<span class="badge badge-pass">${esc(pendingCert.name)}</span>
         <button type="button" class="btn btn-ghost btn-xs" onclick="CalibrationPage.removeCert()">✕ 제거</button>`
      : '<span class="text-muted" style="font-size:12px">첨부된 성적서 없음</span>';
  };
  const viewCert = (id, histId) => {
    const it = CalibDB.getById(id);
    const h = it && (it.history || []).find(x => x.id === histId);
    if (!h || !h.cert || !h.cert.dataUrl) { App.toast('성적서 파일이 없습니다', 'warning'); return; }
    const w = window.open('', '_blank');
    if (!w) { App.toast('팝업 차단을 해제해 주세요', 'warning'); return; }
    const name = esc(h.cert.name || '성적서');
    if (String(h.cert.mimeType || '').startsWith('image/')) {
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${name}</title><style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style></head><body><img src="${h.cert.dataUrl}"></body></html>`);
    } else {
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${name}</title><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style></head><body><iframe src="${h.cert.dataUrl}"></iframe></body></html>`);
    }
    w.document.close();
  };

  // ── 목록 ──
  const filtered = () => {
    const q = query.toLowerCase().trim();
    return CalibDB.getAll(fac()).filter(it => {
      if (typeFilter !== 'ALL' && it.type !== typeFilter) return false;
      if (statusFilter !== 'ALL' && CalibDB.statusOf(it) !== statusFilter) return false;
      if (!q) return true;
      return [it.code, it.name, it.type, it.location, it.maker, it.model, it.serial, it.agency]
        .map(v => String(v || '').toLowerCase()).join(' ').includes(q);
    });
  };

  const render = () => {
    if (detailId) {
      const it = CalibDB.getById(detailId);
      if (!it) { detailId = null; } else return renderDetail(it);
    }
    const st = CalibDB.stats(fac());
    const list = filtered();
    const types = ['ALL'].concat(CalibDB.TYPES);
    const sfBtn = (v, label, n, tone) =>
      `<button class="btn btn-sm ${statusFilter === v ? 'btn-primary' : 'btn-ghost'}" onclick="CalibrationPage.setStatus('${v}')">${label}${n != null ? ` <b style="${tone ? 'color:' + tone : ''}">${n}</b>` : ''}</button>`;

    const rows = list.length ? list.map(it => {
      const s = CalibDB.statusOf(it), m = meta(s);
      const next = CalibDB.nextDateOf(it), dd = CalibDB.ddayOf(it);
      return `<tr style="cursor:pointer" onclick="CalibrationPage.open('${esc(it.id)}')">
        <td class="td-mono text-xs">${esc(it.code)}</td>
        <td><strong>${esc(it.name)}</strong></td>
        <td class="text-xs">${esc(it.type)}</td>
        <td class="text-xs">${esc(CalibDB.factoryName(it.factory))}${it.location ? ` · ${esc(it.location)}` : ''}</td>
        <td class="text-xs">${it.cycleMonths}개월</td>
        <td class="text-xs">${esc(it.lastDate || '-')}</td>
        <td class="text-xs"><b>${esc(next || '-')}</b></td>
        <td>${s === 'none' ? '<span class="badge badge-default">미교정</span>'
              : `<span class="badge ${m.cls}">${m.label}</span>${dd != null ? ` <span class="text-xs text-muted">${dd < 0 ? `${Math.abs(dd)}일 경과` : `D-${dd}`}</span>` : ''}`}</td>
        <td><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();CalibrationPage.openCalibModal('${esc(it.id)}')">교정등록</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text-muted)">해당 조건의 계측기가 없습니다</td></tr>`;

    return `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-12" style="gap:10px;flex-wrap:wrap">
        <div class="text-sm text-muted">계측기 ${st.total}대 · 교정 준수율 <b>${st.complianceRate}%</b>${st.actionNeeded > 0 ? ` · <span class="text-danger">조치필요 ${st.actionNeeded}건</span>` : ''}</div>
        <button class="btn btn-primary btn-sm" onclick="CalibrationPage.openEditModal()">＋ 계측기 등록</button>
      </div>

      <div class="inventory-summary-grid mb-16">
        <div class="inventory-summary-card"><div class="summary-label">전체 계측기</div><div class="summary-value">${st.total}<span>대</span></div></div>
        <div class="inventory-summary-card ${st.overdue > 0 ? 'summary-risk' : ''}"><div class="summary-label">교정기한 경과</div><div class="summary-value">${st.overdue}<span>대</span></div></div>
        <div class="inventory-summary-card ${st.due > 0 ? 'summary-risk' : ''}"><div class="summary-label">교정 임박(${CalibDB.DUE_DAYS}일)</div><div class="summary-value">${st.due}<span>대</span></div></div>
        <div class="inventory-summary-card ${st.none > 0 ? 'summary-risk' : ''}"><div class="summary-label">미교정</div><div class="summary-value">${st.none}<span>대</span></div></div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <span class="text-muted" style="font-size:12px">상태</span>
          ${sfBtn('ALL', '전체', st.total)}
          ${sfBtn('overdue', '기한경과', st.overdue, st.overdue ? '#e5484d' : '')}
          ${sfBtn('due', '임박', st.due, st.due ? '#d4820f' : '')}
          ${sfBtn('none', '미교정', st.none, st.none ? '#d4820f' : '')}
          ${sfBtn('valid', '유효', st.valid)}
          <span class="text-muted" style="font-size:12px;margin-left:6px">종류</span>
          <select class="form-input form-input-sm" style="max-width:150px" onchange="CalibrationPage.setType(this.value)">
            ${types.map(t => `<option value="${esc(t)}" ${typeFilter === t ? 'selected' : ''}>${t === 'ALL' ? '전체 종류' : esc(t)}</option>`).join('')}
          </select>
          <input type="text" class="form-input form-input-sm" style="max-width:220px" placeholder="관리번호·기기명·위치 검색"
                 value="${esc(query)}" oninput="CalibrationPage.onSearch(this.value)">
        </div>
      </div>

      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>관리번호</th><th>기기명</th><th>종류</th><th>설치위치</th><th>주기</th><th>최근교정</th><th>차기교정</th><th>상태</th><th>액션</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:8px">행을 클릭하면 교정 이력·성적서를 봅니다 · 상단 공장 선택에 따라 해당 공장 계측기만 표시됩니다</div>
      </div>

      <div class="modal-overlay" id="cal-edit-modal">
        <div class="modal modal-lg">
          <div class="modal-header"><div class="modal-title">계측기 등록/수정</div>
            <button class="modal-close" onclick="CalibrationPage.closeModal('cal-edit-modal')">✕</button></div>
          <div id="cal-edit-body"></div>
        </div>
      </div>
      <div class="modal-overlay" id="cal-calib-modal">
        <div class="modal">
          <div class="modal-header"><div class="modal-title">교정 실시 등록</div>
            <button class="modal-close" onclick="CalibrationPage.closeModal('cal-calib-modal')">✕</button></div>
          <div id="cal-calib-body"></div>
        </div>
      </div>
    </div>`;
  };

  // ── 상세(이력) ──
  const renderDetail = (it) => {
    const s = CalibDB.statusOf(it), m = meta(s);
    const next = CalibDB.nextDateOf(it), dd = CalibDB.ddayOf(it);
    const hist = (it.history || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const info = (l, v) => `<div><div class="text-xs text-muted">${l}</div><div>${v || '<span class="text-muted">-</span>'}</div></div>`;
    return `
    <div class="fade-in">
      <div class="card">
        <div class="card-head">
          <button class="btn btn-ghost btn-sm" onclick="CalibrationPage.back()">← 목록</button>
          <div class="section-label" style="margin:0">${esc(it.name)} <span class="td-mono text-xs">${esc(it.code)}</span></div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="CalibrationPage.openEditModal('${esc(it.id)}')">수정</button>
            <button class="btn btn-ghost btn-sm" onclick="CalibrationPage.toAgenda('${esc(it.id)}')">회의 안건</button>
            <button class="btn btn-ghost btn-sm" onclick="CalibrationPage.remove('${esc(it.id)}')">삭제</button>
            <button class="btn btn-primary btn-sm" onclick="CalibrationPage.openCalibModal('${esc(it.id)}')">교정등록</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:10px 0 14px">
          ${info('종류', esc(it.type))}
          ${info('공장·위치', esc(CalibDB.factoryName(it.factory)) + (it.location ? ' · ' + esc(it.location) : ''))}
          ${info('제조사·모델', [it.maker, it.model].filter(Boolean).map(esc).join(' ') )}
          ${info('제조번호', esc(it.serial))}
          ${info('교정주기', it.cycleMonths + '개월')}
          ${info('최근교정일', esc(it.lastDate))}
          ${info('차기교정일', `<b>${esc(next || '-')}</b>`)}
          ${info('상태', `<span class="badge ${m.cls}">${m.label}</span>${dd != null ? ` <span class="text-xs text-muted">${dd < 0 ? Math.abs(dd) + '일 경과' : 'D-' + dd}</span>` : ''}`)}
        </div>
        ${it.note ? `<div class="info-box info-blue" style="margin-bottom:12px">${esc(it.note)}</div>` : ''}

        <div class="section-label" style="font-size:13px">교정 이력 (${hist.length})</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>교정일</th><th>교정기관</th><th>결과</th><th>성적서</th><th>담당자</th><th>비고</th><th></th></tr></thead>
            <tbody>${hist.length ? hist.map(h => `<tr>
              <td class="text-xs"><b>${esc(h.date)}</b></td>
              <td class="text-xs">${esc(h.agency || '-')}</td>
              <td>${h.result === '부적합' ? '<span class="badge badge-fail">부적합</span>' : h.result === '조정후적합' ? '<span class="badge badge-warning">조정후적합</span>' : '<span class="badge badge-pass">적합</span>'}</td>
              <td>${h.cert ? `<button class="btn btn-ghost btn-xs" onclick="CalibrationPage.viewCert('${esc(it.id)}','${esc(h.id)}')">보기</button>` : '<span class="text-muted text-xs">미첨부</span>'}</td>
              <td class="text-xs">${esc(h.by || '-')}</td>
              <td class="text-xs">${esc(h.note || '')}</td>
              <td><button class="btn btn-ghost btn-xs" onclick="CalibrationPage.removeHistory('${esc(it.id)}','${esc(h.id)}')">삭제</button></td>
            </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">교정 이력이 없습니다</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="modal-overlay" id="cal-edit-modal">
        <div class="modal modal-lg">
          <div class="modal-header"><div class="modal-title">계측기 등록/수정</div>
            <button class="modal-close" onclick="CalibrationPage.closeModal('cal-edit-modal')">✕</button></div>
          <div id="cal-edit-body"></div>
        </div>
      </div>
      <div class="modal-overlay" id="cal-calib-modal">
        <div class="modal">
          <div class="modal-header"><div class="modal-title">교정 실시 등록</div>
            <button class="modal-close" onclick="CalibrationPage.closeModal('cal-calib-modal')">✕</button></div>
          <div id="cal-calib-body"></div>
        </div>
      </div>
    </div>`;
  };

  // ── 계측기 등록/수정 모달 ──
  const openEditModal = (id) => {
    const it = id ? CalibDB.getById(id) : null;
    const body = document.getElementById('cal-edit-body');
    if (!body) return;
    const curFac = it ? it.factory : (fac() !== 'ALL' ? fac() : 'NS');
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">기기명 <span class="req">*</span></label>
            <input type="text" class="form-input" id="cal-name" value="${esc(it?.name || '')}" placeholder="예) 실험실 정밀저울(0.1mg)"></div>
          <div class="form-group"><label class="form-label">관리번호</label>
            <input type="text" class="form-input" id="cal-code" value="${esc(it?.code || '')}" placeholder="미입력 시 자동발급(CAL001…)"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">종류</label>
            <select class="form-input" id="cal-type">${CalibDB.TYPES.map(t => `<option value="${esc(t)}" ${it?.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">교정주기</label>
            <select class="form-input" id="cal-cycle">${CalibDB.CYCLES.map(c => `<option value="${c}" ${(it?.cycleMonths || 12) === c ? 'selected' : ''}>${c}개월</option>`).join('')}</select></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">공장</label>
            <select class="form-input" id="cal-factory">${CalibDB.FACTORIES.map(f => `<option value="${f.code}" ${curFac === f.code ? 'selected' : ''}>${f.name}</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">설치위치</label>
            <input type="text" class="form-input" id="cal-location" value="${esc(it?.location || '')}" placeholder="예) 품질관리실, 포장라인"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">제조사</label>
            <input type="text" class="form-input" id="cal-maker" value="${esc(it?.maker || '')}"></div>
          <div class="form-group"><label class="form-label">모델</label>
            <input type="text" class="form-input" id="cal-model" value="${esc(it?.model || '')}"></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">제조번호(S/N)</label>
            <input type="text" class="form-input" id="cal-serial" value="${esc(it?.serial || '')}"></div>
          <div class="form-group"><label class="form-label">최근 교정일</label>
            <input type="date" class="form-input" id="cal-last" value="${esc(it?.lastDate || '')}">
            <div class="form-hint">차기 교정일은 주기에 맞춰 자동 계산됩니다</div></div>
        </div>
        <div class="form-group"><label class="form-label">교정기관</label>
          <input type="text" class="form-input" id="cal-agency" value="${esc(it?.agency || '')}" placeholder="예) 한국계량측정협회, 사내 자체점검"></div>
        <div class="form-group"><label class="form-label">비고</label>
          <textarea class="form-input" id="cal-note" rows="2">${esc(it?.note || '')}</textarea></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="CalibrationPage.closeModal('cal-edit-modal')">취소</button>
          <button class="btn btn-primary" onclick="CalibrationPage.save('${esc(id || '')}')">${it ? '수정' : '등록'}</button>
        </div>
      </div>`;
    document.getElementById('cal-edit-modal').classList.add('open');
  };

  const save = (id) => {
    const g = (x) => document.getElementById(x)?.value || '';
    const name = g('cal-name').trim();
    if (!name) { App.toast('기기명은 필수입니다', 'error'); return; }
    const data = {
      name, code: g('cal-code').trim(), type: g('cal-type'), factory: g('cal-factory'),
      location: g('cal-location'), maker: g('cal-maker'), model: g('cal-model'), serial: g('cal-serial'),
      cycleMonths: Number(g('cal-cycle')) || 12, lastDate: g('cal-last'), agency: g('cal-agency'), note: g('cal-note'),
    };
    if (id) {
      // 주기/최근교정일이 바뀌면 차기교정일 재계산
      data.nextDate = data.lastDate ? CalibDB.addMonths(data.lastDate, data.cycleMonths) : '';
      CalibDB.update(id, data);
      App.toast('계측기 정보를 수정했습니다', 'success');
    } else {
      CalibDB.add(data);
      App.toast('계측기를 등록했습니다', 'success');
    }
    closeModal('cal-edit-modal');
    App.refreshPage();
  };

  const remove = (id) => {
    const it = CalibDB.getById(id);
    if (!it) return;
    if (!confirm(`'${it.name}' 계측기를 삭제할까요?\n교정 이력도 함께 삭제됩니다.`)) return;
    CalibDB.remove(id);
    App.toast('삭제되었습니다', 'info');
    detailId = null;
    App.refreshPage();
  };

  // ── 교정 실시 등록 모달 ──
  const openCalibModal = (id) => {
    const it = CalibDB.getById(id);
    const body = document.getElementById('cal-calib-body');
    if (!it || !body) return;
    pendingCert = null;
    const today = new Date().toISOString().slice(0, 10);
    const by = (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : '';
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="info-box info-blue"><b>${esc(it.name)}</b> <span class="td-mono text-xs">${esc(it.code)}</span> · 주기 ${it.cycleMonths}개월</div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">교정일 <span class="req">*</span></label>
            <input type="date" class="form-input" id="calh-date" value="${today}" onchange="CalibrationPage.previewNext('${esc(id)}')"></div>
          <div class="form-group"><label class="form-label">차기 교정일</label>
            <input type="date" class="form-input" id="calh-next" value="${esc(CalibDB.addMonths(today, it.cycleMonths))}">
            <div class="form-hint">주기 기준 자동 계산 · 필요 시 수정</div></div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group"><label class="form-label">교정기관</label>
            <input type="text" class="form-input" id="calh-agency" value="${esc(it.agency || '')}"></div>
          <div class="form-group"><label class="form-label">결과</label>
            <select class="form-input" id="calh-result">
              <option value="적합">적합</option><option value="조정후적합">조정후적합</option><option value="부적합">부적합</option>
            </select></div>
        </div>
        <div class="form-group"><label class="form-label">담당자</label>
          <input type="text" class="form-input" id="calh-by" value="${esc(by)}" readonly></div>
        <div class="form-group">
          <label class="form-label">교정성적서 첨부</label>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">파일 선택
              <input type="file" accept=".pdf,image/*" style="display:none" onchange="CalibrationPage.onCertFile(this)"></label>
            <div id="cal-cert-box"><span class="text-muted" style="font-size:12px">첨부된 성적서 없음</span></div>
          </div>
          <div class="form-hint">2MB 이하 · 이미지는 자동 축소되어 보관됩니다</div>
        </div>
        <div class="form-group"><label class="form-label">비고</label>
          <textarea class="form-input" id="calh-note" rows="2" placeholder="예) 편차 0.02g, 조정 후 적합"></textarea></div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="CalibrationPage.closeModal('cal-calib-modal')">취소</button>
          <button class="btn btn-primary" onclick="CalibrationPage.saveCalib('${esc(id)}')">교정 등록</button>
        </div>
      </div>`;
    document.getElementById('cal-calib-modal').classList.add('open');
  };

  const previewNext = (id) => {
    const it = CalibDB.getById(id);
    const d = document.getElementById('calh-date')?.value;
    const n = document.getElementById('calh-next');
    if (it && d && n) n.value = CalibDB.addMonths(d, it.cycleMonths);
  };

  const saveCalib = (id) => {
    const g = (x) => document.getElementById(x)?.value || '';
    const date = g('calh-date');
    if (!date) { App.toast('교정일을 입력하세요', 'error'); return; }
    CalibDB.addCalibration(id, {
      date, nextDate: g('calh-next'), agency: g('calh-agency'), result: g('calh-result'),
      by: g('calh-by'), note: g('calh-note'), cert: pendingCert,
    });
    pendingCert = null;
    App.toast('교정 이력을 등록했습니다', 'success');
    closeModal('cal-calib-modal');
    App.refreshPage();
  };

  const removeHistory = (id, histId) => {
    if (!confirm('이 교정 이력을 삭제할까요?')) return;
    CalibDB.deleteCalibration(id, histId);
    App.toast('교정 이력을 삭제했습니다', 'warning');
    App.refreshPage();
  };

  // 품질회의 안건으로 올리기 — 교정 기한 경과·부적합 계측기
  const toAgenda = (id) => {
    const it = CalibDB.getById(id);
    if (!it || typeof MeetingPage === 'undefined') return;
    const s = CalibDB.statusOf(it);
    const label = (CalibDB.STATUS_META[s] || {}).label || s;
    MeetingPage.quickAgenda({
      sourceType: 'CALIB',
      sourceId: it.id,
      sourceLabel: `${it.code || ''} ${it.name || ''}`.trim(),
      title: `[검교정] ${it.name}(${it.code}) — ${label}`,
      content: `종류 ${it.type || '-'} · 주기 ${it.cycleMonths || '-'}개월\n최근교정 ${it.lastDate || '미교정'} · 차기 ${CalibDB.nextDateOf(it) || '-'}\n상태 ${label}`,
      category: 'HACCP·선행요건',
      factory: it.factory,
      priority: (s === 'overdue' || s === 'none') ? '긴급' : '보통',
    });
  };

  const closeModal = (mid) => { document.getElementById(mid)?.classList.remove('open'); };
  const open = (id) => { detailId = id; App.refreshPage(); };
  const back = () => { detailId = null; App.refreshPage(); };
  const setType = (v) => { typeFilter = v; App.refreshPage(); };
  const setStatus = (v) => { statusFilter = v; App.refreshPage(); };
  const onSearch = (v) => { query = v; App.refreshPage(); };

  return { render, open, back, setType, setStatus, onSearch,
    openEditModal, save, remove, openCalibModal, previewNext, saveCalib, removeHistory,
    onCertFile, removeCert, viewCert, toAgenda, closeModal };
})();
