// ============================================================
// lab_pet.js — 반려 · 성분/SIZE 방향성 판정 + 컴플레인
//   방향성(↑↓) 등록성분 합부판정 · SIZE/용적중 · 정확도%  +  컴플레인 유형·월별 집계
// ============================================================

const PetPage = (() => {
  let tab = 'anal';   // 'anal' | 'voc'
  let openId = null;  // 분석 상세
  let openVoc = null; // 컴플레인 상세
  const S = () => LabSpeciesDB;

  const vBadgeInline = (v) => {
    const m = { OK: ['적합', 'ok'], HIGH: ['상한초과', 'high'], LOW: ['하한미달', 'low'], PASS: ['적합', 'ok'], FAIL: ['부적합', 'high'], NA: ['-', 'na'] }[v] || ['-', 'na'];
    return `<span class="verdict verdict-${m[1]}">${m[0]}</span>`;
  };

  const tabBar = () => `
    <div style="display:flex;gap:6px;margin-bottom:14px">
      <button class="btn btn-sm ${tab === 'anal' ? 'btn-primary' : 'btn-ghost'}" onclick="PetPage.setTab('anal')">성분·SIZE 분석</button>
      <button class="btn btn-sm ${tab === 'voc' ? 'btn-primary' : 'btn-ghost'}" onclick="PetPage.setTab('voc')">컴플레인</button>
    </div>`;

  // ══════════════ 분석(성분·SIZE) ══════════════
  const analList = () => {
    const list = S().getPets();
    const fail = list.filter(r => S().petEvaluate(r).overall === 'FAIL').length;
    const rows = list.length ? list.map(r => {
      const ev = S().petEvaluate(r);
      return `<tr onclick="PetPage.open('${r.id}')" style="cursor:pointer">
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td>${esc(r.brand || '-')}</td>
        <td><b>${esc(r.product || '-')}</b></td>
        <td class="text-muted">${esc(r.formula || '-')}</td>
        <td class="mono">${fmtNum((r.vals || {}).protein, 1)}</td>
        <td class="mono">${fmtNum((r.vals || {}).fat, 1)}</td>
        <td>${vBadgeInline(ev.overall)}</td>
        <td onclick="event.stopPropagation()"><button class="btn btn-ghost btn-sm" onclick="PetPage.report('${r.id}')">성적서</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:20px">등록된 반려 분석이 없습니다.</td></tr>`;
    return `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">분석 건수</div><div class="stat-value">${fmtNum(list.length, 0)}</div><div class="stat-sub">반려 제품</div></div>
      <div class="stat-card ${fail > 0 ? 'danger' : 'ok'}"><div class="stat-label">부적합</div><div class="stat-value">${fmtNum(fail, 0)}</div><div class="stat-sub">방향성 이탈</div></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">반려 성분·SIZE 분석 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="PetPage.open('NEW')">＋ 분석 입력</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>분석일</th><th>상품</th><th>제품명</th><th>배합비</th><th>조단백</th><th>조지방</th><th>판정</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:10px">방향성 판정 — 수분·조섬유·조회분 ↓(기준 이하 적합), 조단백·조지방·칼슘·인 ↑(기준 이상 적합). 정확도% = 분석치/기준×100.</div>
    </div>`;
  };

  const compRow = (c, vals, specs) => {
    const v = (vals || {})[c.key] ?? '', s = (specs || {})[c.key] ?? '';
    return `<tr>
      <td class="l"><b>${c.label}</b> <span class="text-muted">${c.dir}</span></td>
      <td><input type="number" step="any" class="form-input" style="padding:4px" data-val="${c.key}" value="${v}" oninput="PetPage.preview()"></td>
      <td><input type="number" step="any" class="form-input" style="padding:4px" data-spec="${c.key}" value="${s}" oninput="PetPage.preview()"></td>
    </tr>`;
  };

  const analDetail = (id) => {
    const isNew = id === 'NEW';
    const r = isNew ? { date: new Date().toISOString().slice(0, 10), vals: {}, specs: {} } : S().getPet(id);
    if (!r) return analList();
    const comps = S().PET_COMPONENTS.map(c => compRow(c, r.vals, r.specs)).join('');
    const sz = (k) => (r.vals || {})[k] ?? '';
    const sp = (k) => (r.specs || {})[k] ?? '';
    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="PetPage.back()">← 목록</button>
        <div class="card-title" style="margin:0">${isNew ? '＋ 반려 성분·SIZE 분석' : '' + esc(r.product || '분석')}</div>
        ${isNew ? '' : `<button class="btn btn-ghost btn-sm" onclick="PetPage.remove('${r.id}')">삭제</button>`}
      </div>
      <div class="card" style="background:var(--bg-surface);border-style:dashed;padding:12px;margin-bottom:12px">
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="margin:0;flex:1;min-width:240px">
            <label class="form-label">공식 제품규격 검색 <span class="text-muted" style="font-weight:400">(코드·제품명·브랜드 — 규격서_2604 기준)</span></label>
            <input type="text" class="form-input" id="pt-spec-search" list="pt-spec-list" placeholder="예: 1002853 또는 래핑찰리" onchange="PetPage.pickSpec(this.value)">
            <datalist id="pt-spec-list">${LabDB.searchPetSpecs('', 300).map(m => `<option value="${esc(m.code)}">${esc(m.name)} · ${esc(m.brand)}</option>`).join('')}</datalist>
          </div>
          <div class="text-muted" id="pt-spec-status" style="font-size:12px;padding-bottom:8px">제품을 선택하면 등록성분·SIZE·용적중 기준이 자동으로 채워집니다.</div>
        </div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">분석일자</label><input type="date" class="form-input" id="pt-date" value="${esc(r.date || '')}"></div>
        <div class="form-group"><label class="form-label">상품(브랜드)</label><input type="text" class="form-input" id="pt-brand" value="${esc(r.brand || '')}" placeholder="예: 독무대"></div>
        <div class="form-group"><label class="form-label">제품명 <span class="req">*</span></label><input type="text" class="form-input" id="pt-product" value="${esc(r.product || '')}" placeholder="예: 독무대 센스 5"></div>
        <div class="form-group"><label class="form-label">배합비</label><input type="text" class="form-input" id="pt-formula" value="${esc(r.formula || '')}"></div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">제품코드</label><input type="text" class="form-input" id="pt-code" value="${esc(r.productCode || '')}" onchange="PetPage.pickSpec(this.value, true)"></div>
        <div class="form-group"><label class="form-label">제조일자</label><input type="date" class="form-input" id="pt-proddate" value="${esc(r.prodDate || '')}"></div>
      </div>

      <div style="display:flex;gap:16px;flex-wrap:wrap">
        <div class="card" style="padding:12px;flex:1;min-width:320px">
          <div class="card-title" style="font-size:13px;margin-bottom:8px">일반성분 (분석치 / 기준치)</div>
          <table style="width:100%"><thead><tr><th style="text-align:left;font-size:11px" class="text-muted">항목</th><th style="font-size:11px" class="text-muted">분석치</th><th style="font-size:11px" class="text-muted">기준치</th></tr></thead><tbody>${comps}</tbody></table>
        </div>
        <div class="card" style="padding:12px;flex:1;min-width:320px">
          <div class="card-title" style="font-size:13px;margin-bottom:8px">SIZE · 용적중</div>
          <div class="form-grid form-grid-2">
            <div class="form-group"><label class="form-label">직경(실측)</label><input type="number" step="any" class="form-input" data-val="dia" value="${sz('dia')}" oninput="PetPage.preview()"></div>
            <div class="form-group"><label class="form-label">직경 min~max</label><div style="display:flex;gap:4px"><input type="number" step="any" class="form-input" data-spec="diaMin" value="${sp('diaMin')}" oninput="PetPage.preview()"><input type="number" step="any" class="form-input" data-spec="diaMax" value="${sp('diaMax')}" oninput="PetPage.preview()"></div></div>
            <div class="form-group"><label class="form-label">길이(실측)</label><input type="number" step="any" class="form-input" data-val="len" value="${sz('len')}" oninput="PetPage.preview()"></div>
            <div class="form-group"><label class="form-label">길이 min~max</label><div style="display:flex;gap:4px"><input type="number" step="any" class="form-input" data-spec="lenMin" value="${sp('lenMin')}" oninput="PetPage.preview()"><input type="number" step="any" class="form-input" data-spec="lenMax" value="${sp('lenMax')}" oninput="PetPage.preview()"></div></div>
            <div class="form-group"><label class="form-label">용적중(실측)</label><input type="number" step="any" class="form-input" data-val="vol" value="${sz('vol')}" oninput="PetPage.preview()"></div>
            <div class="form-group"><label class="form-label">용적중 min~max</label><div style="display:flex;gap:4px"><input type="number" step="any" class="form-input" data-spec="volMin" value="${sp('volMin')}" oninput="PetPage.preview()"><input type="number" step="any" class="form-input" data-spec="volMax" value="${sp('volMax')}" oninput="PetPage.preview()"></div></div>
          </div>
        </div>
      </div>

      <div id="pt-preview" style="margin:12px 0"></div>

      <div class="form-group"><label class="form-label">비고</label><textarea class="form-input" id="pt-note" rows="2">${esc(r.note || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="PetPage.back()">취소</button>
        <button class="btn btn-primary" onclick="PetPage.save('${isNew ? 'NEW' : r.id}')">저장</button>
      </div>
    </div>`;
  };

  const previewHtml = (ev) => {
    if (ev.overall === 'NA') return '<div class="text-muted" style="font-size:12px">분석치·기준치를 입력하면 판정·정확도가 표시됩니다.</div>';
    const cells = ev.items.filter(i => i.verdict !== 'NA').map(i =>
      `<td style="text-align:center;padding:4px 10px"><div class="text-muted" style="font-size:11px">${i.label}</div><div style="font-weight:700">${vBadgeInline(i.verdict)}</div><div class="text-muted" style="font-size:10px">${i.accuracy != null ? fmtNum(i.accuracy, 0) + '%' : ''}</div></td>`).join('');
    return `<div class="card" style="padding:10px"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-weight:800;font-size:15px">종합 ${vBadgeInline(ev.overall)}</div>
      <table><tr>${cells}</tr></table></div></div>`;
  };

  // ══════════════ 컴플레인 ══════════════
  const vocList = () => {
    const list = S().getComplaints();
    const st = S().complaintStats();
    const typeBars = S().COMPLAINT_TYPES.filter(t => st.byType[t] > 0).map(t =>
      `<span class="tag tag-gray" style="margin:2px">${t} <b>${st.byType[t]}</b></span>`).join('') || '<span class="text-muted">집계 없음</span>';
    const maxM = Math.max(1, ...Object.values(st.byMonth));
    const monthBars = Object.entries(st.byMonth).map(([m, c]) =>
      `<div style="text-align:center;flex:1"><div style="height:60px;display:flex;align-items:flex-end;justify-content:center"><div title="${m}월 ${c}건" style="width:60%;background:${c > 0 ? '#4f9cff' : '#333'};height:${Math.round(c / maxM * 100)}%;min-height:2px;border-radius:3px 3px 0 0"></div></div><div class="text-muted" style="font-size:10px">${m}월</div><div style="font-size:11px;font-weight:700">${c || ''}</div></div>`).join('');
    const rows = list.length ? list.map(c => `
      <tr onclick="PetPage.openVoc('${c.id}')" style="cursor:pointer">
        <td class="text-muted">${fmtDate(c.recvDate)}</td>
        <td>${esc(c.brand || '-')}</td>
        <td><b>${esc(c.product || '-')}</b></td>
        <td><span class="tag tag-gray">${esc(c.ctype)}</span></td>
        <td class="ellipsis" style="max-width:280px">${esc(c.detail || '')}</td>
        <td class="text-muted">${fmtDate(c.replyDate) === '-' ? '미답변' : fmtDate(c.replyDate)}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px">등록된 컴플레인이 없습니다.</td></tr>`;
    return `
    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card"><div class="stat-label">컴플레인 총계</div><div class="stat-value">${fmtNum(st.total, 0)}</div><div class="stat-sub">전체 접수</div></div>
      <div class="stat-card"><div class="stat-label">최다 유형</div><div class="stat-value" style="font-size:22px">${(() => { const e = Object.entries(st.byType).sort((a, b) => b[1] - a[1])[0]; return e && e[1] > 0 ? e[0] : '-'; })()}</div><div class="stat-sub">발생 1위</div></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-title" style="font-size:13px;margin-bottom:8px">월별 접수 추이</div>
      <div style="display:flex;gap:2px;align-items:flex-end">${monthBars}</div>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="card-title" style="font-size:13px;margin-bottom:8px">유형별 집계</div>${typeBars}</div>
    <div class="card">
      <div class="card-head">
        <div class="card-title">컴플레인 <span class="text-muted" style="font-weight:400">(${list.length}건)</span></div>
        <button class="btn btn-primary btn-sm" onclick="PetPage.openVoc('NEW')">＋ 컴플레인 등록</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>접수일</th><th>상품</th><th>제품명</th><th>유형</th><th>불만내역</th><th>답변일</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  };

  const vocDetail = (id) => {
    const isNew = id === 'NEW';
    const c = isNew ? { recvDate: new Date().toISOString().slice(0, 10), channel: 'Oral', ctype: '기타' } : S().getComplaint(id);
    if (!c) return vocList();
    const typeOpts = S().COMPLAINT_TYPES.map(t => `<option ${t === c.ctype ? 'selected' : ''}>${t}</option>`).join('');
    const chOpts = ['Oral', '유선', '온라인', '카페/SNS', '기타'].map(t => `<option ${t === c.channel ? 'selected' : ''}>${t}</option>`).join('');
    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="PetPage.backVoc()">← 목록</button>
        <div class="card-title" style="margin:0">${isNew ? '＋ 컴플레인 등록' : '' + esc(c.product || '컴플레인')}</div>
        ${isNew ? '' : `<button class="btn btn-ghost btn-sm" onclick="PetPage.removeVoc('${c.id}')">삭제</button>`}
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">접수일자</label><input type="date" class="form-input" id="vc-recv" value="${esc(c.recvDate || '')}"></div>
        <div class="form-group"><label class="form-label">제조일자</label><input type="date" class="form-input" id="vc-prod" value="${esc(c.prodDate || '')}"></div>
        <div class="form-group"><label class="form-label">접수경로</label><select class="form-input" id="vc-channel">${chOpts}</select></div>
        <div class="form-group"><label class="form-label">불만유형</label><select class="form-input" id="vc-type">${typeOpts}</select></div>
      </div>
      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">상품(브랜드)</label><input type="text" class="form-input" id="vc-brand" value="${esc(c.brand || '')}"></div>
        <div class="form-group"><label class="form-label">제품명</label><input type="text" class="form-input" id="vc-product" value="${esc(c.product || '')}"></div>
        <div class="form-group"><label class="form-label">제품코드</label><input type="text" class="form-input" id="vc-code" value="${esc(c.productCode || '')}"></div>
        <div class="form-group"><label class="form-label">답변일</label><input type="date" class="form-input" id="vc-reply" value="${esc(c.replyDate || '')}"></div>
      </div>
      <div class="form-group"><label class="form-label">불만내역</label><textarea class="form-input" id="vc-detail" rows="3">${esc(c.detail || '')}</textarea></div>
      <div class="form-group"><label class="form-label">조치사항</label><textarea class="form-input" id="vc-action" rows="3">${esc(c.action || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="PetPage.backVoc()">취소</button>
        <button class="btn btn-primary" onclick="PetPage.saveVoc('${isNew ? 'NEW' : c.id}')">저장</button>
      </div>
    </div>`;
  };

  // ── render ──
  const render = () => {
    if (tab === 'anal') return tabBar() + (openId ? analDetail(openId) : analList());
    return tabBar() + (openVoc ? vocDetail(openVoc) : vocList());
  };
  const afterRender = () => { if (tab === 'anal' && openId) preview(); };

  const setTab = (t) => { tab = t; openId = null; openVoc = null; App.refreshPage(); };

  // ── 분석 액션 ──
  const readValSpec = () => {
    const vals = {}, specs = {};
    document.querySelectorAll('[data-val]').forEach(inp => { if (inp.value !== '') vals[inp.dataset.val] = parseFloat(inp.value); });
    document.querySelectorAll('[data-spec]').forEach(inp => { if (inp.value !== '') specs[inp.dataset.spec] = parseFloat(inp.value); });
    return { vals, specs };
  };
  const preview = () => {
    const { vals, specs } = readValSpec();
    const ev = S().petEvaluate({ vals, specs });
    const el = document.getElementById('pt-preview'); if (el) el.innerHTML = previewHtml(ev);
  };
  // 공식 규격 자동채움 — 규격서_2604 기준 (분석치는 건드리지 않고 기준치만 채움)
  const pickSpec = (codeOrQuery, fromCodeField) => {
    const q = String(codeOrQuery || '').trim();
    if (!q) return;
    const m = LabDB.getPetSpec(q) || LabDB.searchPetSpecs(q, 1)[0];
    const st = document.getElementById('pt-spec-status');
    if (!m) { if (st && !fromCodeField) st.innerHTML = '<span class="verdict verdict-high">규격서에 없는 코드/제품입니다</span>'; return; }
    const setV = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    setV('pt-code', m.code); setV('pt-brand', m.brand); setV('pt-product', m.name); setV('pt-formula', m.formula);
    // 등록성분 기준치 (방향성 그대로)
    document.querySelectorAll('[data-spec]').forEach(inp => {
      const k = inp.dataset.spec;
      const map = { moist: m.moist, protein: m.protein, fat: m.fat, fiber: m.fiber, ash: m.ash, ca: m.ca, p: m.p,
        diaMin: m.diaMin, diaMax: m.diaMax, lenMin: m.lenMin, lenMax: m.lenMax, volMin: m.volMin, volMax: m.volMax };
      if (map[k] != null) inp.value = map[k];
    });
    preview();
    if (st) st.innerHTML = `<span class="verdict verdict-ok">${esc(m.name)}</span> <span class="text-muted">등록번호 ${esc(m.regNo || '-')} · ${esc(m.usage || '')} · ${esc(m.shape || '')} ${esc(m.unitKg || '')}kg${m.discontinued ? ' · <b style="color:#e0a656">단종</b>' : ''}</span>`;
  };

  const open = (id) => { openId = id; App.refreshPage(); };
  const back = () => { openId = null; App.refreshPage(); };
  const save = (id) => {
    const gv = (i) => document.getElementById(i)?.value ?? '';
    const product = gv('pt-product').trim();
    if (!product) { App.toast('제품명을 입력하세요', 'error'); return; }
    const { vals, specs } = readValSpec();
    S().savePet({
      id: id === 'NEW' ? null : id,
      date: gv('pt-date'), brand: gv('pt-brand'), product, formula: gv('pt-formula'),
      productCode: gv('pt-code'), prodDate: gv('pt-proddate'), vals, specs, note: gv('pt-note'),
    });
    App.toast('반려 분석이 저장되었습니다', 'success');
    openId = null; App.refreshPage();
  };
  const remove = (id) => {
    const r = S().getPet(id); if (!r) return;
    if (!confirm(`"${r.product}" 분석을 삭제할까요?`)) return;
    S().deletePet(id); App.toast('삭제되었습니다', 'info'); openId = null; App.refreshPage();
  };

  // ── 컴플레인 액션 ──
  const openVocFn = (id) => { openVoc = id; App.refreshPage(); };
  const backVoc = () => { openVoc = null; App.refreshPage(); };
  const saveVoc = (id) => {
    const gv = (i) => document.getElementById(i)?.value ?? '';
    S().saveComplaint({
      id: id === 'NEW' ? null : id,
      recvDate: gv('vc-recv'), prodDate: gv('vc-prod'), channel: gv('vc-channel'), ctype: gv('vc-type'),
      brand: gv('vc-brand'), product: gv('vc-product'), productCode: gv('vc-code'),
      detail: gv('vc-detail'), action: gv('vc-action'), replyDate: gv('vc-reply'),
    });
    App.toast('컴플레인이 저장되었습니다', 'success');
    openVoc = null; App.refreshPage();
  };
  const removeVoc = (id) => {
    const c = S().getComplaint(id); if (!c) return;
    if (!confirm('이 컴플레인을 삭제할까요?')) return;
    S().deleteComplaint(id); App.toast('삭제되었습니다', 'info'); openVoc = null; App.refreshPage();
  };

  // ── 보고서 ──
  const reportHtml = (r) => {
    const ev = S().petEvaluate(r);
    const f = (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(r.factory) : (r.factory || '-');
    const rows = ev.items.map(i => `<tr>
      <td class="l"><b>${i.label}</b> <span style="color:#888">${i.dir}</span></td>
      <td class="mono">${i.val != null ? fmtNum(i.val, 2) : '-'}</td>
      <td class="mono">${i.spec != null ? fmtNum(i.spec, 2) : '-'}</td>
      <td class="mono">${i.accuracy != null ? fmtNum(i.accuracy, 0) + '%' : '-'}</td>
      <td>${vBadge(i.verdict)}</td></tr>`).join('');
    const vals = r.vals || {}, specs = r.specs || {};
    const sizeRow = (lbl, v, mn, mx, verdict) => `<tr><td class="l"><b>${lbl}</b></td><td class="mono">${v != null ? fmtNum(v, 2) : '-'}</td><td class="mono">${(mn != null || mx != null) ? `${mn ?? ''}~${mx ?? ''}` : '-'}</td><td>-</td><td>${vBadge(verdict)}</td></tr>`;
    return `
      <div class="rpt-h1">반 려 제 품 분 석 성 적 서</div>
      <div class="rpt-sub">㈜우성사료 사업1본부 · 품질보증팀</div>
      <table class="rpt-info">
        <tr><td class="lb">사업장</td><td>${esc(f)}</td><td class="lb">분석일자</td><td>${fmtDate(r.date)}</td></tr>
        <tr><td class="lb">상품</td><td>${esc(r.brand || '-')}</td><td class="lb">제품명</td><td>${esc(r.product || '-')}</td></tr>
        <tr><td class="lb">배합비</td><td>${esc(r.formula || '-')}</td><td class="lb">제조일자</td><td>${fmtDate(r.prodDate) === '-' ? '-' : fmtDate(r.prodDate)}</td></tr>
      </table>
      <table class="rpt-tbl">
        <thead><tr><th style="width:26%">항목</th><th>분석치</th><th>기준치</th><th>정확도</th><th>판정</th></tr></thead>
        <tbody>
          ${rows}
          ${sizeRow('직경(mm)', vals.dia, specs.diaMin, specs.diaMax, ev.size.dia)}
          ${sizeRow('길이(mm)', vals.len, specs.lenMin, specs.lenMax, ev.size.len)}
          ${sizeRow('용적중(g/L)', vals.vol, specs.volMin, specs.volMax, ev.size.vol)}
        </tbody>
      </table>
      <div style="text-align:center;margin:14px 0"><span style="font-size:13px;color:#444">종합 판정 </span> ${vBadge(ev.overall)}</div>
      ${r.note ? `<div style="font-size:12px"><b>비고:</b> ${esc(r.note)}</div>` : ''}
      <div class="rpt-foot"><div>방향성 판정: 수분·조섬유·조회분 ↓(기준 이하 적합) / 조단백·조지방·칼슘·인 ↑(기준 이상 적합). 정확도% = 분석치 ÷ 기준치 × 100.</div></div>
      <div class="rpt-sign">품질보증팀 ______________ (인)</div>`;
  };
  const report = (id) => { const r = S().getPet(id); if (r) openReportOverlay(reportHtml(r)); };

  return { render, afterRender, setTab, open, back, save, remove, preview, report, pickSpec, openVoc: openVocFn, backVoc, saveVoc, removeVoc };
})();

if (typeof window !== 'undefined') window.PetPage = PetPage;
