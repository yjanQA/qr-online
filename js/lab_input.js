// ============================================================
// lab_input.js — 분석 결과입력 (접수 건 기반)
//   [시료 접수]에서 접수된 건을 선택 → 항목별 값 입력(실시간 판정)
//   → 임시저장(분석중) 또는 분석완료(분석대장 이관)
// ============================================================

const InputPage = (() => {
  let activeId = null;   // 현재 입력 중인 접수번호 (null이면 목록 화면)

  const statusTag = (st) => {
    const m = LabDB.REQ_STATUS[st] || { label: st, cls: 'gray' };
    return `<span class="tag tag-${m.cls}">${m.label}</span>`;
  };

  // 분석 구분 배지: NIR / 화학 (anaMode 없으면 nirVals·의뢰항목으로 추정)
  const modeOf = (r) => {
    if (r.anaMode === 'nir' || r.anaMode === 'chem') return r.anaMode;
    const hasNir = r.nirVals && Object.keys(r.nirVals).length;
    const hasReq = r.items && r.items.length;
    return hasNir && !hasReq ? 'nir' : (hasReq ? 'chem' : 'nir');
  };
  const modeBadge = (r) => {
    const m = modeOf(r);
    return m === 'nir'
      ? `<span class="tag tag-blue" style="font-size:9px" title="NIR 신속분석">NIR</span>`
      : `<span class="tag tag-gray" style="font-size:9px" title="화학분석">화학</span>`;
  };

  // 접수 건의 입력값(NIR 접수치 + 화학 결과치) 규격 이탈 집계
  const reqDeviation = (r) => {
    const seen = {};   // key → 우선 화학(vals) > NIR(nirVals)
    Object.keys(r.nirVals || {}).forEach(k => { if (typeof r.nirVals[k] === 'number') seen[k] = r.nirVals[k]; });
    Object.keys(r.vals || {}).forEach(k => { if (typeof r.vals[k] === 'number') seen[k] = r.vals[k]; });
    let checked = 0, ng = 0, ok = 0;
    Object.keys(seen).forEach(k => {
      const v = LabDB.judge(r.kind, r.code, k, seen[k]);
      if (v === 'NA') return;
      checked++;
      if (v === 'HIGH' || v === 'LOW') ng++; else ok++;
    });
    return { total: Object.keys(seen).length, checked, ng, ok };
  };
  const devBadge = (r) => {
    const d = reqDeviation(r);
    if (d.total === 0) return '<span class="text-muted" style="font-size:11px">미입력</span>';
    if (d.checked === 0) return '<span class="text-muted" style="font-size:11px" title="적용 규격 없음">기준없음</span>';
    return d.ng > 0
      ? `<span class="verdict verdict-high" title="규격 이탈 ${d.ng}건 / 판정 ${d.checked}건">이탈 ${d.ng}</span>`
      : `<span class="verdict verdict-ok" title="판정 ${d.checked}건 모두 적합">적합</span>`;
  };

  // ── 목록 화면: 결과입력 대기 접수 건 ──
  const renderList = () => {
    const open = LabDB.getRequests('OPEN');
    const rows = open.length ? open.map(r => {
      const itemCnt = (r.items || []).length;
      const valCnt = Object.keys(r.vals || {}).length;
      const nirCnt = Object.keys(r.nirVals || {}).length;
      return `<tr onclick="InputPage.open('${esc(r.id)}')" style="cursor:pointer">
        <td style="white-space:nowrap">${modeBadge(r)} <span class="mono">${esc(r.id)}</span></td>
        <td><span class="tag tag-${r.kind === 'raw' ? 'blue' : 'green'}">${r.kind === 'raw' ? '원료' : '제품' + (r.category ? '·' + esc(r.category) : '')}</span></td>
        <td class="mono">${esc(r.code)}</td>
        <td class="ellipsis" style="max-width:200px">${esc(r.name)}${nirCnt ? ` <span class="tag tag-blue" style="font-size:9px">${nirCnt}</span>` : ''}</td>
        <td>${devBadge(r)}</td>
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td>${esc(r.by || '-')}</td>
        <td class="mono">${valCnt}/${itemCnt || '-'}</td>
        <td>${r.priority === '긴급' ? '<span class="verdict verdict-high">긴급</span>' : '보통'}</td>
        <td>${statusTag(r.status)}</td>
        <td><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();InputPage.open('${esc(r.id)}')">▶ 입력</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="11" class="text-muted" style="text-align:center;padding:24px">
        결과입력 대기 건이 없습니다. <b>시료 접수</b>에서 먼저 접수를 등록하세요.
        <div style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="App.navigate('labReceive')">시료 접수 →</button></div>
      </td></tr>`;

    return `
    <div class="card">
      <div class="card-head">
        <div class="section-label" style="margin:0">결과입력 대기 목록 (${open.length}건)</div>
        <button class="btn btn-ghost btn-sm" onclick="App.navigate('labReceive')">시료 접수 →</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>분석·접수번호</th><th>구분</th><th>코드</th><th>시료명</th><th>이탈</th><th>접수일</th><th>신청자</th><th>입력/의뢰</th><th>우선순위</th><th>상태</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="text-muted" style="font-size:12px;margin-top:8px">
        행을 클릭하면 결과입력 화면으로 이동합니다. 입력 완료 시 <b>분석대장</b>(원료/제품 분석대장)으로 이관되고, 대시보드에 집계됩니다.
      </div>
    </div>`;
  };

  // ── 입력 화면: 선택된 접수 건 ──
  const renderEntry = (req) => {
    const metaCells = [
      ['접수번호', `${modeBadge(req)} <b class="mono">${esc(req.id)}</b>`],
      ['구분', req.kind === 'raw' ? '원료' : '제품' + (req.category ? ' · ' + esc(req.category) : '')],
      ['코드', `<span class="mono">${esc(req.code)}</span>`],
      ['시료명', `<b>${esc(req.name)}</b>`],
      ['접수일', fmtDate(req.date)],
      ['신청자', esc(req.by || '-')],
      req.kind === 'raw' ? ['공급처', esc(req.supplier || '-')] : ['배합비', esc(req.formula || '-')],
      req.kind === 'raw' ? ['원산지', esc(req.origin || '-')] : ['생산일', req.prodDate ? fmtDate(req.prodDate) : '-'],
      ['우선순위', req.priority === '긴급' ? '<span class="verdict verdict-high">긴급</span>' : '보통'],
      ['상태', statusTag(req.status)],
    ].map(([k, v]) => `<div><span class="text-muted" style="font-size:11px">${k}</span><div>${v}</div></div>`).join('');

    // 의뢰항목 + 이미 값이 입력된 항목 + NIR값이 입력된 항목의 합집합을 행으로 구성
    const keys = (req.items || []).slice();
    Object.keys(req.vals || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); });
    Object.keys(req.nirVals || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); });
    const rowsHtml = keys.map(k => itemRowHtml(k, req.vals ? req.vals[k] : undefined)).join('');
    const nirCnt = Object.keys(req.nirVals || {}).length;

    return `
    <div class="card">
      <div class="card-head">
        <button class="btn btn-ghost btn-sm" onclick="InputPage.backToList()">← 대기 목록</button>
        <div class="section-label" style="margin:0">분석 결과입력</div>
      </div>
      <div class="detail-head" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:8px">${metaCells}</div>
      ${req.note ? `<div class="text-muted" style="font-size:12px;margin-bottom:8px">${esc(req.note)}</div>` : ''}

      <hr class="divider">
      <div class="section-label">분석 항목 <span class="text-muted">(값을 입력하면 규격 기준 실시간 판정${nirCnt ? ` · NIR값 ${nirCnt}개와 자동 비교` : ''})</span></div>

      <div class="form-group" style="position:relative">
        <input type="text" class="form-input" id="in-item-search" autocomplete="off"
               placeholder="항목 추가 검색 (의뢰항목 외 추가 분석 시)"
               oninput="InputPage.suggestItems()" onfocus="InputPage.suggestItems()">
        <div class="suggest-box" id="in-item-suggest"></div>
      </div>

      <div id="in-items" class="item-rows">
        ${rowsHtml || '<div class="item-empty" id="in-items-empty">의뢰항목이 없습니다. 위 검색창에서 항목을 추가하세요.</div>'}
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" onclick="InputPage.backToList()">취소</button>
        <button class="btn btn-outline-primary" onclick="InputPage.saveDraft()">임시저장 (분석중)</button>
        <button class="btn btn-primary" onclick="InputPage.complete()">분석완료 → 분석대장 등록</button>
      </div>
    </div>`;
  };

  // 기준치(규격) 문자열: 수동규격 → 통계밴드 순으로 조회
  const specText = (req, key) => {
    const it = LabDB.getItem(key);
    const sp = LabDB.resolveSpec(req.kind, req.code, key);
    if (!sp || (sp.min == null && sp.max == null)) return '<span class="text-muted">기준없음</span>';
    const lo = sp.min != null ? fmtNum(sp.min) : '−';
    const hi = sp.max != null ? fmtNum(sp.max) : '−';
    const src = sp.source === 'stat' ? ' <span class="text-muted" style="font-size:9px">(통계)</span>' : '';
    return `<span class="mono">${lo} ~ ${hi}</span> <span class="text-muted">${esc(it ? it.unit : '')}</span>${src}`;
  };

  // NIR값 대비 화학분석값 오차 배지 (both present일 때만)
  const nirDiffHtml = (nir, chem, unit) => {
    if (typeof nir !== 'number' || typeof chem !== 'number') return '';
    const diff = chem - nir;
    const pct = chem !== 0 ? Math.abs(diff) / Math.abs(chem) * 100 : (diff === 0 ? 0 : 100);
    const within = pct <= LabDB.NIR_TOLERANCE_PCT;
    return `<span class="text-muted" style="font-size:10px" title="화학분석-NIR 오차">
      Δ${diff >= 0 ? '+' : ''}${fmtNum(diff)} <span class="${within ? 'text-ok' : 'text-danger'}">(${fmtNum(pct)}%)</span></span>`;
  };

  const itemRowHtml = (key, val) => {
    const it = LabDB.getItem(key);
    if (!it) return '';
    const req = LabDB.getRequest(activeId);
    const nir = req && req.nirVals ? req.nirVals[key] : undefined;
    const nirCell = nir != null
      ? `<span class="mono">${fmtNum(nir)}</span> <span class="text-muted">${esc(it.unit)}</span>`
      : '<span class="text-muted">−</span>';
    return `
      <div class="item-row item-row-spec6" id="irow-${key}">
        <div class="item-row-name">${esc(it.label)} <span class="text-muted">${esc(it.unit)}</span>
          ${it.owner ? `<span class="tag tag-blue" style="font-size:9px" title="분석 담당자">${esc(it.owner)}</span>` : ''}
          <span class="tag tag-gray" style="font-size:9px">${esc(it.group)}</span></div>
        <div class="item-row-spec" title="기준치 (수동규격 → 통계밴드)">${req ? specText(req, key) : ''}</div>
        <div class="item-row-spec" title="접수 시 입력된 NIR 신속분석값">${nirCell}</div>
        <input type="number" step="any" class="form-input form-input-sm val-input" data-item="${key}"
               value="${val != null ? val : ''}" oninput="InputPage.preview('${key}')" placeholder="화학분석값">
        <div class="val-verdict" id="vd-${key}">
          <div id="vdbadge-${key}"></div>
          <div id="ndbadge-${key}">${val != null ? nirDiffHtml(nir, val, it.unit) : ''}</div>
        </div>
        <button class="btn btn-ghost btn-xs" onclick="InputPage.removeRow('${key}')" title="제거">✕</button>
      </div>`;
  };

  const render = () => {
    if (!activeId) return renderList();
    const req = LabDB.getRequest(activeId);
    if (!req || req.status === 'DONE') { activeId = null; return renderList(); }
    return renderEntry(req);
  };

  const open = (id) => {
    activeId = id;
    if (App.getPage && App.getPage() === 'input') App.refreshPage();
    else App.navigate('input');
    // 기존 입력값 판정 표시
    setTimeout(() => {
      document.querySelectorAll('#in-items .val-input').forEach(el => { if (el.value !== '') preview(el.dataset.item); });
    }, 50);
  };
  const backToList = () => { activeId = null; App.refreshPage(); };

  // ── 항목 검색·추가 ──
  const suggestItems = () => {
    const req = LabDB.getRequest(activeId);
    if (!req) return;
    const q = (document.getElementById('in-item-search').value || '').toLowerCase().trim();
    const box = document.getElementById('in-item-suggest');
    let list = LabDB.getItems(req.kind).filter(it => !document.getElementById('irow-' + it.key));
    if (q) list = list.filter(it => it.label.toLowerCase().includes(q) || (it.key || '').includes(q) || (it.group || '').toLowerCase().includes(q));
    list = list.slice(0, 25);
    if (!list.length) { box.innerHTML = ''; box.classList.remove('open'); return; }
    box.innerHTML = list.map(it => `
      <div class="suggest-item suggest-item-3" onclick="InputPage.addRow('${it.key}')">
        <span>${esc(it.label)} <span class="text-muted">${esc(it.unit)}</span></span>
        <span class="tag tag-gray" style="font-size:10px">${esc(it.group)}</span>
        <span class="text-muted" style="font-size:11px">＋추가</span>
      </div>`).join('');
    box.classList.add('open');
  };

  const addRow = (key) => {
    if (!key || document.getElementById('irow-' + key)) return;
    const it = LabDB.getItem(key);
    if (!it) return;
    document.getElementById('in-items-empty')?.remove();
    const cont = document.getElementById('in-items');
    const div = document.createElement('div');
    div.innerHTML = itemRowHtml(key);
    cont.appendChild(div.firstElementChild);
    const search = document.getElementById('in-item-search');
    if (search) search.value = '';
    document.getElementById('in-item-suggest')?.classList.remove('open');
    document.querySelector(`#irow-${key} .val-input`)?.focus();
  };

  const removeRow = (key) => {
    document.getElementById('irow-' + key)?.remove();
    const cont = document.getElementById('in-items');
    if (cont && !cont.querySelector('.item-row')) {
      cont.innerHTML = '<div class="item-empty" id="in-items-empty">의뢰항목이 없습니다. 위 검색창에서 항목을 추가하세요.</div>';
    }
  };

  const preview = (item) => {
    const req = LabDB.getRequest(activeId);
    const el = document.querySelector(`#in-items .val-input[data-item="${item}"]`);
    const vdbadge = document.getElementById(`vdbadge-${item}`);
    const ndbadge = document.getElementById(`ndbadge-${item}`);
    if (!el || !vdbadge || !req) return;
    const v = el.value;
    if (v === '') {
      vdbadge.innerHTML = ''; if (ndbadge) ndbadge.innerHTML = '';
      el.classList.remove('inp-high', 'inp-low', 'inp-ok');
      return;
    }
    const verdict = LabDB.judge(req.kind, req.code, item, Number(v));
    const m = VERDICT_META[verdict];
    el.classList.remove('inp-high', 'inp-low', 'inp-ok');
    if (verdict === 'HIGH') el.classList.add('inp-high');
    else if (verdict === 'LOW') el.classList.add('inp-low');
    else if (verdict === 'OK') el.classList.add('inp-ok');
    vdbadge.innerHTML = verdict === 'NA' ? '' : `<span class="verdict verdict-${m.cls}">${m.label}</span>`;
    if (ndbadge) {
      const it = LabDB.getItem(item);
      const nir = req.nirVals ? req.nirVals[item] : undefined;
      ndbadge.innerHTML = nirDiffHtml(nir, Number(v), it ? it.unit : '');
    }
  };

  // ── 저장/완료 ──
  const collectVals = () => {
    const vals = {};
    document.querySelectorAll('#in-items .val-input').forEach(el => {
      if (el.value !== '') {
        const n = Number(el.value);
        if (!Number.isNaN(n)) vals[el.dataset.item] = n;
      }
    });
    return vals;
  };
  const collectItems = () => [...document.querySelectorAll('#in-items .item-row')].map(el => el.id.replace('irow-', ''));

  const saveDraft = () => {
    if (!activeId) return;
    const vals = collectVals();
    LabDB.updateRequest(activeId, { vals, items: collectItems(), status: Object.keys(vals).length ? 'IN_PROGRESS' : 'RECEIVED' });
    App.toast(`임시저장됨 · ${activeId} (${Object.keys(vals).length}개 값)`, 'success');
    App.refreshPage();
    setTimeout(() => {
      document.querySelectorAll('#in-items .val-input').forEach(el => { if (el.value !== '') preview(el.dataset.item); });
    }, 50);
  };

  const complete = () => {
    if (!activeId) return;
    const vals = collectVals();
    if (Object.keys(vals).length === 0) { App.toast('분석값을 1개 이상 입력하세요', 'warning'); return; }
    LabDB.updateRequest(activeId, { vals, items: collectItems() });
    try {
      const rec = LabDB.completeRequest(activeId);
      App.toast(`분석완료 · ${rec.id} → ${rec.kind === 'raw' ? '원료' : '제품'} 분석대장 등록 (${Object.keys(rec.vals).length}개 항목)`, 'success');
      activeId = null;
      App.refreshPage();
    } catch (e) {
      App.toast(e.message || '완료 처리 중 오류', 'error');
    }
  };

  const afterRender = () => {
    if (window.__labInputBound) return;
    window.__labInputBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#in-item-search') && !e.target.closest('#in-item-suggest')) document.getElementById('in-item-suggest')?.classList.remove('open');
    });
  };

  return { render, afterRender, open, backToList, suggestItems, addRow, removeRow, preview, saveDraft, complete };
})();
