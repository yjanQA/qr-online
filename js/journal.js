// ============================================================
// journal.js — 전자 일지 (작성 · 결재 · 이력)
//   양식(JournalDB 템플릿)을 그대로 화면으로 찍어내는 범용 일지 프레임.
//   종이 일지를 대체하는 것이 목적이므로 아래 3가지를 반드시 만족한다.
//     1) 한계기준 이탈은 자동 판정하고, 개선조치 없이는 상신 불가
//     2) 상신 → 검토 → 승인 결재선과 결재 이력(누가·언제)을 남긴다
//     3) 증빙사진을 일지에 직접 붙인다
// ============================================================

const JournalPage = (() => {
  let mode = 'LIST';           // LIST | EDIT | DETAIL
  let editRec = null;          // 작성/수정 중인 기록 (메모리 사본)
  let detailId = null;
  let fTpl = 'ALL', fStatus = 'ALL', fCat = 'ALL', fNg = false;
  let period = 90;             // 목록 조회 기간(일)
  let actKey = null;           // 개선조치 대상 셀 키

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const facName = (f) => (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(f) : f;
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const myName = () => { try { return Auth.currentName() || ''; } catch (_) { return ''; } };
  const myEmail = () => { try { return Auth.currentEmail() || ''; } catch (_) { return ''; } };
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayShift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const fmtDT = (s) => s ? String(s).replace('T', ' ').slice(0, 16) : '-';

  // ── 증빙사진 (2MB 제한 · 1400px 축소) ──
  const downscale = (file, maxDim = 1400, q = 0.72) => new Promise((res) => {
    if (!String(file.type || '').startsWith('image/')) { res(null); return; }
    const r = new FileReader();
    r.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) { const k = maxDim / Math.max(width, height); width = Math.round(width * k); height = Math.round(height * k); }
        const cv = document.createElement('canvas'); cv.width = width; cv.height = height;
        cv.getContext('2d').drawImage(img, 0, 0, width, height);
        try { res(cv.toDataURL('image/jpeg', q)); } catch (_) { res(null); }
      };
      img.onerror = () => res(null);
      img.src = e.target.result;
    };
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
  const onPhotos = async (input) => {
    const files = Array.from(input.files || []); input.value = '';
    if (!editRec) return;
    for (const f of files) {
      if (f.size > 2 * 1024 * 1024) { App.toast(`${f.name}은 2MB를 초과합니다`, 'warning'); continue; }
      const s = await downscale(f);
      if (s) editRec.photos.push({ name: f.name, dataUrl: s });
    }
    renderPhotoBox();
  };
  const removePhoto = (i) => { if (editRec) { editRec.photos.splice(i, 1); renderPhotoBox(); } };
  const renderPhotoBox = () => {
    const el = document.getElementById('jn-photos');
    if (!el || !editRec) return;
    el.innerHTML = editRec.photos.length
      ? editRec.photos.map((p, i) => `<span class="badge badge-info" style="margin-right:6px">${esc(p.name)}
          <button type="button" class="btn btn-ghost btn-xs" onclick="JournalPage.removePhoto(${i})">✕</button></span>`).join('')
      : '<span class="text-muted" style="font-size:12px">첨부 없음</span>';
  };
  const viewPhoto = (recId, i) => {
    const r = JournalDB.getRecord(recId); if (!r || !r.photos[i]) return;
    const w = window.open('', '_blank');
    if (w) w.document.write(`<title>${esc(r.photos[i].name)}</title><body style="margin:0;background:#111"><img src="${r.photos[i].dataUrl}" style="max-width:100%;display:block;margin:auto"></body>`);
  };

  // ============================================================
  // 1) 목록
  // ============================================================
  const listView = () => {
    const f = fac();
    const from = dayShift(-period);
    const recs = JournalDB.getRecords({ factory: f, tplId: fTpl, status: fStatus, category: fCat, ngOnly: fNg, from });
    const st = JournalDB.stats(f);
    const due = JournalDB.dueList(f).filter(d => d.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue);
    const mine = JournalDB.myApprovals(myEmail(), f);

    const overdueBanner = due.length ? `
      <div class="card alert-banner alert-danger">
        <b>작성기한 초과 ${due.length}건</b> — ${due.slice(0, 3).map(d => `${esc(d.tpl.name)}(${d.last ? d.overdue + '일 경과' : '미작성 ' + d.overdue + '일'})`).join(', ')}${due.length > 3 ? ` 외 ${due.length - 3}건` : ''}
      </div>` : '';
    const approvalBanner = mine.length ? `
      <div class="card alert-banner alert-warn">
        <b>결재 대기 ${mine.length}건</b> — 검토·승인이 필요한 일지가 있습니다. 일지 현황 화면의 결재함에서 처리하세요.
      </div>` : '';

    const tplOpts = ['<option value="ALL">전체 양식</option>']
      .concat(JournalDB.getTemplates({ activeOnly: true, factory: f })
        .map(t => `<option value="${t.id}" ${fTpl === t.id ? 'selected' : ''}>${esc(t.code)} ${esc(t.name)}</option>`)).join('');
    const catTabs = ['ALL'].concat(JournalDB.CATEGORIES).map(c =>
      `<button class="factory-tab ${fCat === c ? 'active' : ''}" onclick="JournalPage.setCat('${c}')">${c === 'ALL' ? '전체' : c}</button>`).join('');
    const stTabs = ['ALL', 'DRAFT', 'SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED'].map(s =>
      `<button class="factory-tab ${fStatus === s ? 'active' : ''}" onclick="JournalPage.setStatus('${s}')">${s === 'ALL' ? '전체' : JournalDB.statusMeta(s).label}</button>`).join('');
    const perTabs = [30, 90, 180, 365].map(p =>
      `<button class="factory-tab ${period === p ? 'active' : ''}" onclick="JournalPage.setPeriod(${p})">${p >= 365 ? '1년' : p + '일'}</button>`).join('');

    const rows = recs.length ? recs.map(r => {
      const sm = JournalDB.statusMeta(r.status);
      return `<tr style="cursor:pointer" onclick="JournalPage.open('${r.id}')">
        <td class="td-mono text-xs">${esc(r.date)}</td>
        <td><strong>${esc(r.tplName)}</strong> <span class="text-muted text-xs">${esc(r.tplCode)}</span></td>
        <td class="text-xs">${esc(r.category)}</td>
        <td class="text-xs">${esc(facName(r.factory))}</td>
        <td style="text-align:center">${r.ng > 0
          ? `<span class="badge badge-fail">이탈 ${r.ng}</span>${r.openNg > 0 ? ` <span class="text-xs" style="color:var(--danger)">미조치 ${r.openNg}</span>` : ''}`
          : '<span class="badge badge-pass">이상없음</span>'}</td>
        <td class="text-xs">${esc(r.writer || '-')}</td>
        <td style="text-align:center"><span class="badge ${sm.cls}">${sm.label}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:26px">해당 조건의 일지가 없습니다</td></tr>`;

    return `
      <div class="fade-in">
        ${overdueBanner}
        ${approvalBanner}

        <div class="inventory-summary-grid mb-20">
          <div class="inventory-summary-card"><div class="summary-label">작성 일지</div><div class="summary-value">${st.total}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.submitted > 0 ? 'summary-risk' : ''}"><div class="summary-label">결재 대기</div><div class="summary-value">${st.submitted}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.openNg > 0 ? 'summary-risk' : ''}"><div class="summary-label">미조치 이탈</div><div class="summary-value">${st.openNg}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.overdue > 0 ? 'summary-risk' : ''}"><div class="summary-label">작성기한 초과</div><div class="summary-value">${st.overdue}<span>종</span></div></div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">일지 작성</div>
            <span class="text-muted" style="font-size:12px">등록된 양식 ${st.templates}종 · 양식을 고르면 점검표가 그대로 화면에 펼쳐집니다</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div class="form-group" style="min-width:280px;margin:0">
              <label class="form-label">작성할 일지 양식</label>
              <select class="form-input form-input-sm" id="jn-new-tpl">
                ${JournalDB.getTemplates({ activeOnly: true, factory: f }).map(t =>
                  `<option value="${t.id}">[${esc(t.category)}] ${esc(t.code)} ${esc(t.name)} · ${JournalDB.cycleLabel(t.cycle)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0"><label class="form-label">작성일</label>
              <input type="date" class="form-input form-input-sm" id="jn-new-date" value="${JournalDB.todayStr()}"></div>
            <button class="btn btn-primary btn-sm" onclick="JournalPage.startNew()">일지 작성 시작</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">일지 이력 <span class="text-muted" style="font-weight:400">(${recs.length}건)</span></div>
            <div class="factory-tabs">${perTabs}</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <div class="factory-tabs">${catTabs}</div>
            <div class="factory-tabs">${stTabs}</div>
            <select class="form-input form-input-sm" style="max-width:260px" onchange="JournalPage.setTpl(this.value)">${tplOpts}</select>
            <label style="display:flex;align-items:center;gap:6px;font-size:12px">
              <input type="checkbox" ${fNg ? 'checked' : ''} onchange="JournalPage.setNg(this.checked)"> 이탈 있는 일지만
            </label>
          </div>
          <div class="table-wrapper">
            <table>
              <thead><tr><th>작성일</th><th>일지</th><th>구분</th><th>공장</th><th style="text-align:center">판정</th><th>작성자</th><th style="text-align:center">결재</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  };

  // ============================================================
  // 2) 작성/수정
  // ============================================================
  const startNew = () => {
    const tplId = val('jn-new-tpl');
    const date = val('jn-new-date') || JournalDB.todayStr();
    const tpl = JournalDB.getTemplate(tplId);
    if (!tpl) { App.toast('양식을 선택하세요', 'error'); return; }
    const f = fac();
    editRec = {
      id: null, tplId: tpl.id, tplCode: tpl.code, tplName: tpl.name, category: tpl.category,
      factory: f === 'ALL' ? 'HQ' : f, date, shift: '',
      targetLabel: tpl.targetLabel || '점검대상',
      targets: (tpl.targets || []).slice(),
      vals: {}, actions: [], photos: [], memo: '',
      writer: myName(), writerEmail: myEmail(), status: 'DRAFT',
    };
    mode = 'EDIT'; App.refreshPage();
  };
  // 현장 QR 진입 — 해당 양식의 오늘자 일지를 바로 연다 (작성중 건이 있으면 이어서 작성)
  const startFromQR = (tplId) => {
    const tpl = JournalDB.getTemplate(tplId);
    if (!tpl) { App.toast('해당 일지 양식을 찾을 수 없습니다', 'error'); return; }
    const today = JournalDB.todayStr();
    const exist = JournalDB.getRecords({ tplId }).find(r => r.date === today && r.status === 'DRAFT');
    if (exist) { editExisting(exist.id); return; }
    const f = fac();
    editRec = {
      id: null, tplId: tpl.id, tplCode: tpl.code, tplName: tpl.name, category: tpl.category,
      factory: f === 'ALL' ? 'HQ' : f, date: today, shift: '',
      targetLabel: tpl.targetLabel || '점검대상',
      targets: (tpl.targets || []).slice(),
      vals: {}, actions: [], photos: [], memo: '',
      writer: myName(), writerEmail: myEmail(), status: 'DRAFT',
    };
    mode = 'EDIT'; App.refreshPage();
  };

  const editExisting = (id) => {
    const r = JournalDB.getRecord(id); if (!r) return;
    if (JournalDB.isLocked(r)) { App.toast('상신된 일지는 수정할 수 없습니다. 상신취소 후 수정하세요', 'warning'); return; }
    editRec = JSON.parse(JSON.stringify(r));
    mode = 'EDIT'; App.refreshPage();
  };
  const cancelEdit = () => { editRec = null; mode = 'LIST'; App.refreshPage(); };

  const setVal = (target, rowKey, v) => {
    if (!editRec) return;
    const k = JournalDB.cellKey(target, rowKey);
    editRec.vals[k] = { ...(editRec.vals[k] || {}), v };
    paintCell(target, rowKey);
    refreshNgBar();
  };
  const setMemo = (target, rowKey, v) => {
    if (!editRec) return;
    const k = JournalDB.cellKey(target, rowKey);
    editRec.vals[k] = { ...(editRec.vals[k] || {}), memo: v };
  };
  const rowOf = (rowKey) => (JournalDB.getTemplate(editRec.tplId).rows || []).find(r => r.key === rowKey);
  const paintCell = (target, rowKey) => {
    const k = JournalDB.cellKey(target, rowKey);
    const el = document.querySelector(`[data-cell="${CSS.escape(k)}"]`);
    if (!el) return;
    const row = rowOf(rowKey);
    if (!row) return;
    const cur = (editRec.vals[k] || {}).v;
    el.classList.toggle('jn-ng', JournalDB.isNg(row, cur));
    // 버튼형 선택지는 어떤 값을 골랐는지 즉시 보이게 한다(적합=초록 / 부적합=빨강)
    const ngVals = JournalDB.ngValuesOf(row);
    el.querySelectorAll('.jn-opt').forEach(btn => {
      const v = btn.textContent.trim();
      const on = String(cur ?? '') === v;
      btn.classList.toggle('jn-opt-ok', on && !ngVals.includes(v));
      btn.classList.toggle('jn-opt-ng', on && ngVals.includes(v));
    });
  };
  const refreshNgBar = () => {
    const el = document.getElementById('jn-ngbar');
    if (!el || !editRec) return;
    const devs = JournalDB.deviationsOf(editRec);
    const open = JournalDB.openDeviations(editRec);
    el.innerHTML = devs.length
      ? `<div class="card alert-banner ${open.length ? 'alert-danger' : 'alert-warn'}">
           <b>한계기준 이탈 ${devs.length}건</b>${open.length ? ` · <span style="color:var(--danger)">개선조치 미입력 ${open.length}건</span> — 개선조치를 입력해야 상신할 수 있습니다.` : ' · 개선조치 입력 완료'}
           <div style="margin-top:6px;font-size:12px">${devs.map(d => `${d.target ? esc(d.target) + ' / ' : ''}${esc(d.label)} = <b>${esc(d.value)}</b>${d.std ? ` <span class="text-muted">(기준 ${esc(d.std)})</span>` : ''}`).join('<br>')}</div>
         </div>`
      : '';
  };

  // 항목 입력 위젯
  const inputFor = (row, target) => {
    const k = JournalDB.cellKey(target, row.key);
    const cur = (editRec.vals[k] || {}).v ?? '';
    const ng = JournalDB.isNg(row, cur);
    const attr = `data-cell="${esc(k)}" class="jn-cell${ng ? ' jn-ng' : ''}"`;
    const on = `onchange="JournalPage.setVal('${esc(target)}','${row.key}',this.value)"`;
    if (row.type === 'NUM') {
      return `<div ${attr}><input type="number" step="any" class="form-input form-input-sm" value="${esc(cur)}" ${on} oninput="JournalPage.setVal('${esc(target)}','${row.key}',this.value)" placeholder="${esc(row.unit || '')}"></div>`;
    }
    if (row.type === 'TEXT') {
      return `<div ${attr}><input class="form-input form-input-sm" value="${esc(cur)}" ${on}></div>`;
    }
    if (row.type === 'TIME') {
      return `<div ${attr}><input type="time" class="form-input form-input-sm" value="${esc(cur)}" ${on}></div>`;
    }
    const opts = JournalDB.optionsOf(row);
    // 선택지가 3개 이하면 버튼형(현장 휴대폰에서 터치 한 번), 그 이상은 셀렉트
    if (opts.length && opts.length <= 3) {
      return `<div ${attr}>${opts.map(o => {
        const isNgOpt = JournalDB.ngValuesOf(row).includes(o);
        return `<button type="button" class="jn-opt ${cur === o ? (isNgOpt ? 'jn-opt-ng' : 'jn-opt-ok') : ''}"
          onclick="JournalPage.setVal('${esc(target)}','${row.key}','${esc(o)}')">${esc(o)}</button>`;
      }).join('')}</div>`;
    }
    return `<div ${attr}><select class="form-input form-input-sm" ${on}>
      <option value="">선택</option>${opts.map(o => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  };

  const editView = () => {
    const tpl = JournalDB.getTemplate(editRec.tplId);
    if (!tpl) { mode = 'LIST'; return listView(); }
    const rows = tpl.rows || [];
    const hasTargets = (editRec.targets || []).length > 0;

    // 대상형: 대상(행) × 항목(열) 매트릭스 / 문항형: 항목(행) 단일 열
    let body;
    if (hasTargets) {
      body = `
      <div class="table-wrapper">
        <table class="jn-table">
          <thead><tr><th style="min-width:110px">${esc(editRec.targetLabel || '점검대상')}</th>
            ${rows.map(r => `<th>${esc(r.label)}${r.unit ? ` <span class="text-muted">(${esc(r.unit)})</span>` : ''}
              ${JournalDB.stdText(r) ? `<div class="jn-std">기준 ${esc(JournalDB.stdText(r))}</div>` : ''}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${editRec.targets.map(tg => `<tr>
              <td><strong>${esc(tg)}</strong></td>
              ${rows.map(r => `<td>${inputFor(r, tg)}</td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    } else {
      body = `
      <div class="table-wrapper">
        <table class="jn-table">
          <thead><tr><th style="min-width:200px">점검 항목</th><th style="width:110px">기준</th><th style="width:220px">결과</th><th>비고</th></tr></thead>
          <tbody>
            ${JournalDB.withGroupRows(rows).map(r => {
              if (r.__group) return `<tr class="jn-grp"><td colspan="4">${esc(r.__group)}</td></tr>`;
              const k = JournalDB.cellKey('', r.key);
              return `<tr>
                <td><strong>${esc(r.label)}</strong>${r.unit ? ` <span class="text-muted">(${esc(r.unit)})</span>` : ''}</td>
                <td class="text-xs text-muted">${esc(JournalDB.stdText(r) || '-')}</td>
                <td>${inputFor(r, '')}</td>
                <td><input class="form-input form-input-sm" value="${esc((editRec.vals[k] || {}).memo || '')}"
                  onchange="JournalPage.setMemo('','${r.key}',this.value)" placeholder="비고"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    }

    const facOpts = (typeof DB !== 'undefined' ? DB.getFactories() : []).map(x =>
      `<option value="${x.id}" ${editRec.factory === x.id ? 'selected' : ''}>${x.name}</option>`).join('');

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-16">
          <div>
            <div class="text-sm"><strong style="font-size:16px">${esc(tpl.name)}</strong>
              <span class="badge badge-default" style="margin-left:6px">${esc(tpl.code)}</span>
              <span class="badge badge-info">${esc(tpl.category)}</span>
              <span class="badge badge-default">${JournalDB.cycleLabel(tpl.cycle)}</span></div>
            ${tpl.note ? `<div class="text-muted text-xs mt-4">${esc(tpl.note)}</div>` : ''}
          </div>
          <button class="btn btn-ghost btn-sm" onclick="JournalPage.cancelEdit()">← 목록</button>
        </div>

        <div id="jn-ngbar"></div>

        <div class="card mb-16">
          <div class="form-grid form-grid-3">
            <div class="form-group"><label class="form-label">작성일</label>
              <input type="date" class="form-input form-input-sm" value="${esc(editRec.date)}" onchange="JournalPage.setHead('date',this.value)"></div>
            <div class="form-group"><label class="form-label">공장</label>
              <select class="form-input form-input-sm" onchange="JournalPage.setHead('factory',this.value)">${facOpts}</select></div>
            <div class="form-group"><label class="form-label">작성자</label>
              <input class="form-input form-input-sm" value="${esc(editRec.writer)}" readonly style="background:var(--bg-subtle,rgba(128,128,128,.08))"></div>
          </div>
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">점검 기록</div>
            ${hasTargets ? `<button class="btn btn-ghost btn-xs" onclick="JournalPage.addTarget()">＋ 대상 추가</button>` : ''}
          </div>
          ${body}
        </div>

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">증빙사진 · 종합 특이사항</div></div>
          <div class="form-group">
            <label class="form-label">증빙사진 (2MB 이하 · 여러 장 가능)</label>
            <input type="file" accept="image/*" multiple class="form-input form-input-sm" onchange="JournalPage.onPhotos(this)">
            <div id="jn-photos" style="margin-top:8px"></div>
          </div>
          <div class="form-group">
            <label class="form-label">종합 특이사항</label>
            <textarea class="form-textarea" rows="2" onchange="JournalPage.setHead('memo',this.value)">${esc(editRec.memo || '')}</textarea>
          </div>
        </div>

        <div class="flex gap-8 mb-24">
          <button class="btn btn-ghost" onclick="JournalPage.cancelEdit()">취소</button>
          <button class="btn btn-outline-primary" onclick="JournalPage.saveDraft()">임시저장</button>
          <button class="btn btn-primary" onclick="JournalPage.saveAndSubmit()">저장 후 상신</button>
        </div>
      </div>`;
  };

  const setHead = (k, v) => { if (editRec) editRec[k] = v; };
  const addTarget = () => {
    const name = prompt('추가할 점검대상 이름');
    if (!name || !name.trim()) return;
    editRec.targets.push(name.trim());
    App.refreshPage();
  };

  const persist = () => {
    if (!editRec) return null;
    if (editRec.id) return JournalDB.updateRecord(editRec.id, {
      date: editRec.date, factory: editRec.factory, targets: editRec.targets,
      vals: editRec.vals, actions: editRec.actions, photos: editRec.photos, memo: editRec.memo,
    });
    const r = JournalDB.addRecord(editRec);
    if (r) editRec.id = r.id;
    return r;
  };
  const saveDraft = () => {
    const r = persist();
    if (!r) { App.toast('저장에 실패했습니다', 'error'); return; }
    App.toast('임시저장되었습니다', 'success');
    editRec = null; mode = 'LIST'; App.refreshPage();
  };
  const saveAndSubmit = () => {
    const r = persist();
    if (!r) { App.toast('저장에 실패했습니다', 'error'); return; }
    const open = JournalDB.openDeviations(r);
    if (open.length) {
      App.toast(`이탈 ${open.length}건의 개선조치가 필요합니다`, 'warning');
      detailId = r.id; editRec = null; mode = 'DETAIL'; App.refreshPage();
      return;
    }
    const res = JournalDB.submit(r.id, JournalDB.lineFor(r.tplId));
    if (!res.ok) { App.toast(res.msg, 'warning'); detailId = r.id; editRec = null; mode = 'DETAIL'; App.refreshPage(); return; }
    App.toast('상신되었습니다', 'success');
    editRec = null; mode = 'LIST'; App.refreshPage();
  };

  // ============================================================
  // 3) 상세 · 결재
  // ============================================================
  const open = (id) => { detailId = id; mode = 'DETAIL'; App.refreshPage(); };
  const back = () => { detailId = null; mode = 'LIST'; App.refreshPage(); };

  const detailView = () => {
    const r = JournalDB.getRecord(detailId);
    if (!r) { mode = 'LIST'; return listView(); }
    const tpl = JournalDB.getTemplate(r.tplId);
    const rows = (tpl && tpl.rows) || [];
    const sm = JournalDB.statusMeta(r.status);
    const devs = JournalDB.deviationsOf(r, tpl);
    const openDev = JournalDB.openDeviations(r, tpl);
    const hasTargets = (r.targets || []).length > 0;
    const actMap = {}; (r.actions || []).forEach(a => { actMap[a.key] = a; });

    const cellText = (row, tg) => {
      const c = (r.vals || {})[JournalDB.cellKey(tg, row.key)] || {};
      const v = c.v ?? '';
      if (v === '') return '<span class="text-muted">-</span>';
      const ng = JournalDB.isNg(row, v);
      return `<span class="${ng ? 'jn-txt-ng' : ''}">${esc(v)}${row.unit ? ' ' + esc(row.unit) : ''}</span>`;
    };

    let body;
    if (hasTargets) {
      body = `<div class="table-wrapper"><table class="jn-table">
        <thead><tr><th>${esc(r.targetLabel || '점검대상')}</th>${rows.map(x => `<th>${esc(x.label)}${x.unit ? ` (${esc(x.unit)})` : ''}</th>`).join('')}</tr></thead>
        <tbody>${r.targets.map(tg => `<tr><td><strong>${esc(tg)}</strong></td>${rows.map(x => `<td>${cellText(x, tg)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
    } else {
      body = `<div class="table-wrapper"><table class="jn-table">
        <thead><tr><th style="min-width:200px">점검 항목</th><th style="width:130px">기준</th><th style="width:140px">결과</th><th>비고</th></tr></thead>
        <tbody>${JournalDB.withGroupRows(rows).map(x => {
          if (x.__group) return `<tr class="jn-grp"><td colspan="4">${esc(x.__group)}</td></tr>`;
          const c = (r.vals || {})[JournalDB.cellKey('', x.key)] || {};
          return `<tr><td><strong>${esc(x.label)}</strong></td>
            <td class="text-xs text-muted">${esc(JournalDB.stdText(x) || '-')}</td>
            <td>${cellText(x, '')}</td>
            <td class="text-xs text-muted">${esc(c.memo || '-')}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }

    const devPanel = devs.length ? `
      <div class="card mb-16">
        <div class="card-head"><div class="card-title">한계기준 이탈 및 개선조치 <span class="text-muted" style="font-weight:400">(${devs.length}건)</span></div>
          ${openDev.length ? `<span class="badge badge-fail">미조치 ${openDev.length}건</span>` : '<span class="badge badge-pass">조치 완료</span>'}
        </div>
        <div class="table-wrapper"><table>
          <thead><tr><th>대상</th><th>항목</th><th>측정/판정</th><th>기준</th><th>원인</th><th>개선조치</th><th>조치자</th><th></th></tr></thead>
          <tbody>${devs.map(d => {
            const k = JournalDB.cellKey(d.target, d.rowKey);
            const a = actMap[k];
            return `<tr${a ? '' : ' style="background:rgba(239,68,68,.05)"'}>
              <td class="text-xs">${esc(d.target || '-')}</td>
              <td><strong>${esc(d.label)}</strong></td>
              <td class="jn-txt-ng">${esc(d.value)} ${esc(d.unit)}</td>
              <td class="text-xs text-muted">${esc(d.std || '-')}</td>
              <td class="text-xs">${a ? esc(a.cause || '-') : '<span class="text-muted">-</span>'}</td>
              <td class="text-xs">${a ? esc(a.action) : '<span style="color:var(--danger)">미입력</span>'}</td>
              <td class="text-xs">${a ? esc(a.by) : '-'}</td>
              <td>${JournalDB.isLocked(r) ? '' : `<button class="btn btn-ghost btn-xs" onclick="JournalPage.openAction('${r.id}','${esc(k)}','${esc(d.label)}')">${a ? '수정' : '조치 입력'}</button>`}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>` : '';

    const histRows = (r.history || []).length ? r.history.map(h => {
      const label = { SUBMIT: '상신', REVIEW: '검토완료', APPROVE: '승인', REJECT: '반려', CANCEL: '상신취소' }[h.act] || h.act;
      return `<tr><td class="text-xs">${fmtDT(h.at)}</td><td><span class="badge ${h.act === 'REJECT' ? 'badge-fail' : h.act === 'APPROVE' ? 'badge-pass' : 'badge-info'}">${label}</span></td>
        <td class="text-xs">${esc(h.by || '-')}</td><td class="text-xs text-muted">${esc(h.comment || '-')}</td></tr>`;
    }).join('') : '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:14px">결재 이력이 없습니다</td></tr>';

    const canEdit = !JournalDB.isLocked(r);
    const actions = [];
    if (canEdit) {
      actions.push(`<button class="btn btn-outline-primary btn-sm" onclick="JournalPage.editExisting('${r.id}')">수정</button>`);
      actions.push(`<button class="btn btn-primary btn-sm" onclick="JournalPage.doSubmit('${r.id}')">상신</button>`);
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="JournalPage.del('${r.id}')">삭제</button>`);
    }
    if (r.status === 'SUBMITTED') {
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="JournalPage.doCancel('${r.id}')">상신취소</button>`);
      actions.push(`<button class="btn btn-info btn-sm" onclick="JournalPage.doReview('${r.id}')">검토완료</button>`);
    }
    if (r.status === 'SUBMITTED' || r.status === 'REVIEWED') {
      actions.push(`<button class="btn btn-success btn-sm" onclick="JournalPage.doApprove('${r.id}')">승인</button>`);
      actions.push(`<button class="btn btn-danger btn-sm" onclick="JournalPage.doReject('${r.id}')">반려</button>`);
    }
    // 이탈이 있으면 결재 상태와 무관하게 회의 안건으로 올릴 수 있어야 한다
    if (devs.length) actions.push(`<button class="btn btn-outline-primary btn-sm" onclick="JournalPage.toAgenda('${r.id}')">회의 안건</button>`);

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-16">
          <div>
            <div><strong style="font-size:16px">${esc(r.tplName)}</strong>
              <span class="badge badge-default" style="margin-left:6px">${esc(r.tplCode)}</span>
              <span class="badge ${sm.cls}">${sm.label}</span></div>
            <div class="text-muted text-xs mt-4">${esc(r.date)} · ${esc(facName(r.factory))} · 작성자 ${esc(r.writer || '-')} · 등록 ${fmtDT(r.createdAt)}</div>
          </div>
          <div class="flex gap-8">${actions.join('')}
            <button class="btn btn-ghost btn-sm" onclick="JournalPage.back()">← 목록</button></div>
        </div>

        ${openDev.length ? `<div class="card alert-banner alert-danger"><b>미조치 이탈 ${openDev.length}건</b> — 개선조치를 입력해야 상신·승인이 가능합니다.</div>` : ''}

        ${devPanel}

        <div class="card mb-16">
          <div class="card-head"><div class="card-title">점검 기록</div>
            <span class="text-muted" style="font-size:12px">${devs.length ? `이탈 ${devs.length}건` : '이상 없음'}</span></div>
          ${body}
          ${r.memo ? `<div class="info-box info-blue mt-12"><div class="info-label">종합 특이사항</div><div class="info-value">${esc(r.memo)}</div></div>` : ''}
        </div>

        ${(r.photos || []).length ? `
        <div class="card mb-16">
          <div class="card-head"><div class="card-title">증빙사진 (${r.photos.length}장)</div></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${r.photos.map((p, i) => `<div style="cursor:pointer" onclick="JournalPage.viewPhoto('${r.id}',${i})">
              <img src="${p.dataUrl}" style="width:130px;height:100px;object-fit:cover;border-radius:6px;border:1px solid var(--border,#333)">
              <div class="text-xs text-muted" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</div>
            </div>`).join('')}
          </div>
        </div>` : ''}

        <div class="card mb-24">
          <div class="card-head"><div class="card-title">결재 이력</div>
            <span class="text-muted" style="font-size:12px">작성 → 상신 → 검토 → 승인</span></div>
          <div class="table-wrapper"><table>
            <thead><tr><th style="width:150px">일시</th><th style="width:100px">구분</th><th style="width:120px">처리자</th><th>의견</th></tr></thead>
            <tbody>${histRows}</tbody>
          </table></div>
        </div>

        ${actionModal()}
      </div>`;
  };

  // ── 개선조치 입력 모달 ──
  const actionModal = () => `
    <div class="modal-overlay" id="jn-act-modal">
      <div class="modal"><div class="modal-header"><div class="modal-title">개선조치 등록</div>
        <button class="modal-close" onclick="JournalPage.closeModal('jn-act-modal')">✕</button></div>
        <div id="jn-act-body"></div>
      </div>
    </div>`;
  const openAction = (recId, key, label) => {
    const r = JournalDB.getRecord(recId); if (!r) return;
    actKey = { recId, key };
    const a = (r.actions || []).find(x => x.key === key) || {};
    document.getElementById('jn-act-body').innerHTML = `
      <div style="padding:16px">
        <div class="info-box info-warning mb-12"><div class="info-label">이탈 항목</div><div class="info-value">${esc(label)}</div></div>
        <div class="form-group"><label class="form-label">발생 원인</label>
          <input class="form-input form-input-sm" id="jn-act-cause" value="${esc(a.cause || '')}" placeholder="예: 냉방기 고장으로 실온 상승"></div>
        <div class="form-group"><label class="form-label">개선조치 및 경과 <span class="req">*</span></label>
          <textarea class="form-textarea" rows="3" id="jn-act-action" placeholder="예: 냉방기 수리 의뢰(8/3 완료), 재측정 결과 28℃ 정상">${esc(a.action || '')}</textarea></div>
        <div class="form-group"><label class="form-label">조치자</label>
          <input class="form-input form-input-sm" id="jn-act-by" value="${esc(a.by || myName())}" readonly style="background:var(--bg-subtle,rgba(128,128,128,.08))"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="JournalPage.closeModal('jn-act-modal')">취소</button>
        <button class="btn btn-primary" onclick="JournalPage.saveAction()">저장</button>
      </div>`;
    document.getElementById('jn-act-modal').classList.add('open');
  };
  const saveAction = () => {
    if (!actKey) return;
    const action = val('jn-act-action');
    if (!action) { App.toast('개선조치 내용을 입력하세요', 'error'); return; }
    JournalDB.setAction(actKey.recId, actKey.key, { cause: val('jn-act-cause'), action, by: val('jn-act-by') || myName() });
    closeModal('jn-act-modal'); actKey = null;
    App.toast('개선조치가 등록되었습니다', 'success'); App.refreshPage();
  };
  const closeModal = (id) => { document.getElementById(id)?.classList.remove('open'); };

  // ── 결재 액션 ──
  const doSubmit = (id) => {
    const res = JournalDB.submit(id, JournalDB.lineFor(JournalDB.getRecord(id)?.tplId));
    App.toast(res.ok ? '상신되었습니다' : res.msg, res.ok ? 'success' : 'warning');
    App.refreshPage();
  };
  const doCancel = (id) => { const res = JournalDB.cancelSubmit(id); App.toast(res.ok ? '상신이 취소되었습니다' : res.msg, res.ok ? 'success' : 'warning'); App.refreshPage(); };
  const doReview = (id) => { const c = prompt('검토 의견 (선택)') ?? ''; const res = JournalDB.review(id, c); App.toast(res.ok ? '검토 처리되었습니다' : res.msg, res.ok ? 'success' : 'warning'); App.refreshPage(); };
  const doApprove = (id) => {
    const r = JournalDB.getRecord(id);
    if (r && JournalDB.openDeviations(r).length) { App.toast('미조치 이탈이 있어 승인할 수 없습니다', 'warning'); return; }
    const c = prompt('승인 의견 (선택)') ?? '';
    const res = JournalDB.approve(id, c); App.toast(res.ok ? '승인되었습니다' : res.msg, res.ok ? 'success' : 'warning'); App.refreshPage();
  };
  const doReject = (id) => {
    const c = prompt('반려 사유를 입력하세요');
    if (c === null) return;
    if (!c.trim()) { App.toast('반려 사유는 필수입니다', 'error'); return; }
    const res = JournalDB.reject(id, c.trim()); App.toast(res.ok ? '반려되었습니다' : res.msg, res.ok ? 'success' : 'warning'); App.refreshPage();
  };
  const del = (id) => { if (!confirm('이 일지를 삭제할까요?')) return; JournalDB.deleteRecord(id); detailId = null; mode = 'LIST'; App.toast('삭제되었습니다', 'success'); App.refreshPage(); };

  // ── 필터 ──
  const setCat = (c) => { fCat = c; App.refreshPage(); };
  const setStatus = (s) => { fStatus = s; App.refreshPage(); };
  const setTpl = (t) => { fTpl = t; App.refreshPage(); };
  const setNg = (b) => { fNg = b; App.refreshPage(); };
  const setPeriod = (p) => { period = p; App.refreshPage(); };

  // 품질회의 안건으로 올리기 — 한계기준 이탈이 반복되면 회의에서 다뤄야 한다
  const toAgenda = (recId) => {
    const r = JournalDB.getRecord(recId);
    if (!r || typeof MeetingPage === 'undefined') return;
    const tpl = JournalDB.getTemplate(r.tplId);
    const devs = JournalDB.deviationsOf(r, tpl);
    const lines = devs.slice(0, 6)
      .map(d => `· ${d.target ? d.target + ' ' : ''}${d.label} = ${d.value}${d.unit || ''}${d.std ? ` (기준 ${d.std})` : ''}`)
      .join('\n');
    MeetingPage.quickAgenda({
      sourceType: 'JOURNAL',
      sourceId: r.id,
      sourceLabel: `${r.tplCode} ${r.date}`,
      title: `[일지 이탈] ${r.tplName} ${r.date} — ${devs.length}건`,
      content: `${r.tplName}(${r.tplCode}) ${r.date} 한계기준 이탈 ${devs.length}건${r.openNg > 0 ? ` · 미조치 ${r.openNg}건` : ''}\n${lines}${devs.length > 6 ? `\n외 ${devs.length - 6}건` : ''}`,
      category: 'HACCP·선행요건',
      factory: r.factory,
      priority: (r.openNg || 0) > 0 ? '높음' : '보통',
    });
  };

  const render = () => (mode === 'EDIT' && editRec) ? editView() : (mode === 'DETAIL' && detailId) ? detailView() : listView();
  const afterRender = () => { if (mode === 'EDIT' && editRec) { renderPhotoBox(); refreshNgBar(); } };

  return {
    render, afterRender,
    startNew, startFromQR, editExisting, cancelEdit, setVal, setMemo, setHead, addTarget,
    saveDraft, saveAndSubmit, open, back, del,
    onPhotos, removePhoto, viewPhoto,
    openAction, saveAction, closeModal,
    doSubmit, doCancel, doReview, doApprove, doReject,
    setCat, setStatus, setTpl, setNg, setPeriod, toAgenda,
  };
})();
