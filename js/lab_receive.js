// ============================================================
// lab_receive.js — 시료 접수 (분석 의뢰 접수 · 접수 현황)
//   접수 등록 → [분석 결과입력]에서 값 입력 → 완료 시 분석대장으로 이관
// ============================================================

const ReceivePage = (() => {
  let kind = 'raw';
  let picked = null;      // {code,name,formulaCode}
  let anaMode = 'nir';    // 분석 구분: 'nir'(NIR 신속분석) | 'chem'(화학분석 선택형)
  let baseKeys = null;    // 구분에 따라 그리드에 깔리는 기본 항목 key 목록
  let selItems = null;    // CHK 체크된 의뢰항목 key 목록 (첫 렌더 시 기본 CHK 적용)
  let extraItems = [];    // 기본 리스트 외 추가된 항목 key
  let nirVals = {};       // NIR 신속분석값 {itemKey: 입력문자열} — 접수 시점에 함께 입력
  let prodCategory = '양축'; // 제품 축종 구분 (양축/양어/반려/기타)

  // NIR 기본 항목: 일반성분 7종 + 비중 (조단백은 NIR검사법=N정량)
  const NIR_ITEMS = ['moist', 'protein_n', 'fat', 'fiber', 'ash', 'ca', 'p', 'bulk_density'];
  // 화학분석 기본 선택: 일반성분(수분·조단백·조지방·조섬유·조회분·칼슘·인) — 조단백은 Kjeldahl
  const CHEM_BASIC = ['moist', 'protein', 'fat', 'fiber', 'ash', 'ca', 'p'];
  // 화학분석 선택형 그룹 — 일반성분(기본)만 고정, 나머지는 사용자 정의 그룹(LabDB.getQuickGroups)
  const CHEM_GROUPS = [
    { key: 'basic', label: '일반성분', items: () => CHEM_BASIC },
  ];
  // 그룹의 항목 중 현재 kind에 적용 가능한 것만
  const groupKeys = (g) => (g.items || []).filter(k => {
    const it = LabDB.getItem(k);
    return it && ((it.appliesTo || 'both') === 'both' || it.appliesTo === kind);
  });

  // 구분별 기본 리스트 계산 (항목 마스터에 있는 것만)
  const modeBaseKeys = () => {
    const exists = (k) => !!LabDB.getItem(k);
    if (anaMode === 'nir') return NIR_ITEMS.filter(exists);
    return CHEM_BASIC.filter(exists);
  };
  const initModeList = () => {
    baseKeys = modeBaseKeys();
    selItems = baseKeys.slice();   // 기본분석은 전부 체크로 따라옴
    extraItems = [];
    nirVals = {};
  };

  const statusTag = (st) => {
    const m = LabDB.REQ_STATUS[st] || { label: st, cls: 'gray' };
    return `<span class="tag tag-${m.cls}">${m.label}</span>`;
  };

  const render = () => {
    if (baseKeys === null || selItems === null) initModeList();
    const today = new Date().toISOString().slice(0, 10);
    // 신청자 = 로그인 사용자 자동기록 (직접 입력 대신 계정 연동)
    const me = (typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : '';
    // 화학분석 선택형 그룹 칩 (누르면 해당 그룹 항목이 리스트업 + 체크)
    const customChips = LabDB.getQuickGroups()
      .filter(g => groupKeys(g).length)
      .map(g => `<button class="chip-add chip-add-group" onclick="ReceivePage.addGroupId('${esc(g.id)}')" title="${groupKeys(g).length}개 항목 일괄 추가">＋ ${esc(g.label)}</button>`).join('');
    const manageChip = `<button class="chip-add" style="opacity:.75" onclick="ReceivePage.manageGroups()" title="그룹 추가·항목 구성 수정">그룹 관리</button>`;
    const chemChips = CHEM_GROUPS
      .map(g => `<button class="chip-add chip-add-group" onclick="ReceivePage.addChemGroup('${g.key}')">＋ ${g.label}</button>`).join('') + customChips + manageChip;
    const groupChips = customChips + manageChip;

    // 분석 리스트 그리드 (CHK | 항목명 | 단위 | 기준치 | 결과치 | 결과판정 | 그룹)
    //   CHK(화학분석 의뢰)는 사용자가 직접 제어. 결과치 입력은 결과판정 배지만 갱신(CHK 불변).
    const gridKeys = baseKeys.concat(extraItems.filter(k => !baseKeys.includes(k) && LabDB.getItem(k)));
    const specRows = gridKeys.map(k => {
      const it = LabDB.getItem(k);
      const sp = LabDB.resolveSpec(kind, picked ? picked.code : '', k);
      const has = sp && (sp.min != null || sp.max != null);
      const checked = selItems.includes(k);
      const nirV = nirVals[k] != null ? nirVals[k] : '';
      return `<tr id="specrow-${k}" style="${checked ? '' : 'opacity:0.55'}">
        <td style="text-align:center"><input type="checkbox" id="chk-${k}" ${checked ? 'checked' : ''} onchange="ReceivePage.toggleItem('${k}')"></td>
        <td>${esc(it.label)}</td>
        <td class="text-muted">${esc(it.unit)}</td>
        <td>${it.owner ? esc(it.owner) : '<span class="text-muted">-</span>'}</td>
        <td class="mono">${has ? esc(fmtSpec(sp.min, sp.max)) : '<span class="text-muted">미등록</span>'}</td>
        <td><input type="number" step="any" class="form-input form-input-sm nir-input" value="${esc(nirV)}"
                    placeholder="결과치" oninput="ReceivePage.setNir('${k}', this.value)"></td>
        <td id="rjudge-${k}">${judgeBadge(k, nirV)}</td>
        <td><span class="tag tag-gray" style="font-size:9px">${esc(it.group)}</span></td>
      </tr>`;
    }).join('');
    const nirFilled = Object.values(nirVals).filter(v => v !== '' && v != null).length;

    const open = LabDB.getRequests('OPEN');
    const doneRecent = LabDB.getRequests('DONE').slice(0, 5);

    const reqRow = (r) => {
      const itemCnt = (r.items || []).length;
      const valCnt = Object.keys(r.vals || {}).length;
      const nirCnt = Object.keys(r.nirVals || {}).length;
      return `<tr>
        <td class="mono">${esc(r.id)}</td>
        <td><span class="tag tag-${r.kind === 'raw' ? 'blue' : 'green'}">${r.kind === 'raw' ? '원료' : '제품' + (r.category ? '·' + esc(r.category) : '')}</span></td>
        <td class="mono">${esc(r.code)}</td>
        <td class="ellipsis" style="max-width:180px">${esc(r.name)}${nirCnt ? ` <span class="tag tag-blue" style="font-size:9px" title="NIR값 입력됨">${nirCnt}</span>` : ''}</td>
        <td class="text-muted">${fmtDate(r.date)}</td>
        <td>${esc(r.by || '-')}</td>
        <td class="mono">${valCnt}/${itemCnt || '-'}</td>
        <td>${r.priority === '긴급' ? '<span class="verdict verdict-high">긴급</span>' : '보통'}</td>
        <td>${statusTag(r.status)}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-primary btn-xs" onclick="InputPage.open('${esc(r.id)}')">▶ 결과입력</button>
          <button class="btn btn-ghost btn-xs" onclick="ReceivePage.cancel('${esc(r.id)}')" title="접수 취소">✕</button>
        </td>
      </tr>`;
    };
    const openRows = open.length ? open.map(reqRow).join('')
      : '<tr><td colspan="10" class="text-muted" style="text-align:center;padding:20px">진행 중인 접수가 없습니다. 위에서 시료를 접수하세요.</td></tr>';

    const doneRows = doneRecent.map(r => `<tr>
      <td class="mono">${esc(r.id)}</td>
      <td><span class="tag tag-${r.kind === 'raw' ? 'blue' : 'green'}">${r.kind === 'raw' ? '원료' : '제품'}</span></td>
      <td class="mono">${esc(r.code)}</td>
      <td class="ellipsis" style="max-width:180px">${esc(r.name)}</td>
      <td class="text-muted">${fmtDate(r.completedAt || r.date)}</td>
      <td class="mono">${Object.keys(r.vals || {}).length}개 항목</td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-xs" onclick="LabCOA.open('${esc(r.id)}')" title="시험성적서 발행">성적서</button>
        <button class="btn btn-ghost btn-xs" onclick="App.navigate('${r.kind === 'raw' ? 'raw' : 'prod'}','${esc(r.code)}')">대장</button>
      </td>
    </tr>`).join('');

    return `
    <div class="card">
      <div class="card-head">
        <div class="kind-toggle">
          <button class="kind-btn ${kind === 'raw' ? 'active' : ''}" onclick="ReceivePage.setKind('raw')">원료 접수</button>
          <button class="kind-btn ${kind === 'prod' ? 'active' : ''}" onclick="ReceivePage.setKind('prod')">제품 접수</button>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn btn-sm" style="background:#2e9e5b;color:#fff" onclick="LabImport.pick('${kind}')" title="분석데이터 엑셀(.xlsx)을 올려 여러 건을 한 번에 접수합니다">엑셀 일괄등록</button>
          <span class="text-muted" style="font-size:12px">접수번호 자동채번: <b class="mono">${LabDB.genReceiptNo(kind)}</b></span>
        </div>
      </div>

      ${kind === 'prod' ? `
      <div class="form-group" style="margin-bottom:8px">
        <label class="form-label">축종 구분 <span class="text-muted" style="font-weight:400">(구분에 맞는 제품리스트 · 기본 스펙리스트 적용)</span></label>
        <div class="kind-toggle">
          ${LabDB.PROD_CATEGORIES.map(c => `<button class="kind-btn ${prodCategory === c ? 'active' : ''}" onclick="ReceivePage.setCategory('${c}')">${{ '양축': '', '양어': '', '반려': '', '기타': '' }[c] || ''} ${c}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="form-grid form-grid-2" style="margin-bottom:4px">
        <div class="form-group" style="position:relative">
          <label class="form-label">${kind === 'raw' ? '원료' : `제품(${prodCategory})`} 코드 <span class="req">*</span></label>
          <input type="text" class="form-input" id="rc-code" autocomplete="off"
                 placeholder="코드 또는 명칭 검색" oninput="ReceivePage.suggest()" onfocus="ReceivePage.suggest()">
          <div class="suggest-box" id="rc-suggest"></div>
          <div id="rc-picked" class="picked-info"></div>
        </div>
        <div class="form-group">
          <label class="form-label">우선순위</label>
          <select class="form-input" id="rc-priority">
            <option value="보통">보통</option>
            <option value="긴급">긴급</option>
          </select>
        </div>
      </div>

      <div class="form-grid form-grid-4">
        <div class="form-group"><label class="form-label">접수일</label><input type="date" class="form-input" id="rc-date" value="${today}"></div>
        <div class="form-group"><label class="form-label">신청자 <span class="text-muted" style="font-weight:400;font-size:11px">· 로그인 계정 자동</span></label><input type="text" class="form-input" id="rc-by" value="${esc(me)}" placeholder="로그인 필요" readonly title="로그인한 계정이 자동으로 기록됩니다" style="background:var(--bg-soft);cursor:not-allowed"></div>
        ${kind === 'raw' ? `
          <div class="form-group"><label class="form-label">공급처</label><input type="text" class="form-input" id="rc-supplier" placeholder="공급처"></div>
          <div class="form-group"><label class="form-label">원산지</label><input type="text" class="form-input" id="rc-origin" placeholder="원산지"></div>
        ` : `
          <div class="form-group"><label class="form-label">배합비</label><input type="text" class="form-input" id="rc-formula" placeholder="배합코드"></div>
          <div class="form-group"><label class="form-label">생산일</label><input type="date" class="form-input" id="rc-prodDate"></div>
        `}
      </div>
      <div class="form-group"><label class="form-label">비고</label><input type="text" class="form-input" id="rc-note" placeholder="특이사항 · 검사목적"></div>

      <hr class="divider">
      <div class="section-label">분석 구분
        <span class="text-muted">(화학분석 의뢰 <b id="rc-sel-count">${selItems.length}</b>개 · 결과치 입력(NIR) <b id="rc-nir-count">${nirFilled}</b>개)</span>
      </div>
      <div class="kind-toggle" style="margin-bottom:8px">
        <button class="kind-btn ${anaMode === 'nir' ? 'active' : ''}" onclick="ReceivePage.setMode('nir')">NIR 분석</button>
        <button class="kind-btn ${anaMode === 'chem' ? 'active' : ''}" onclick="ReceivePage.setMode('chem')">화학분석</button>
      </div>
      ${anaMode === 'nir' ? `
      <div class="text-muted" style="font-size:12px;margin-bottom:6px">
        <b>NIR 기본 8항목</b>(수분·조단백·조지방·조섬유·조회분·칼슘·인·비중)이 자동으로 깔립니다.
        <b>결과치</b>에 측정값을 입력하고, 화학분석도 함께 의뢰할 항목은 <b>CHK</b>로 직접 선택하세요.
        입력칸에서 <b>↓(또는 Enter)</b>로 다음 항목, <b>↑</b>로 이전 항목으로 이동합니다.
      </div>` : `
      <div class="text-muted" style="font-size:12px;margin-bottom:6px">
        <b>일반성분 7항목</b>(수분·조단백·조지방·조섬유·조회분·칼슘·인)이 기본 선택됩니다.
        아래 그룹 버튼을 누르면 <b>톡신류·중금속류·잔류농약류</b> 등이 리스트업되어 함께 의뢰됩니다.
      </div>
      <div class="chip-add-row" style="margin-bottom:6px">
        <span class="text-muted" style="font-size:11px">선택형 그룹:</span>
        ${chemChips}
      </div>`}
      <div class="form-group" style="position:relative">
        <input type="text" class="form-input" id="rc-item-search" autocomplete="off"
               placeholder="개별 항목 추가 (예: PDI, 비중, Lys, 잔류농약)"
               oninput="ReceivePage.suggestItems()" onfocus="ReceivePage.suggestItems()">
        <div class="suggest-box" id="rc-item-suggest"></div>
      </div>
      ${anaMode === 'nir' ? `
      <div class="chip-add-row">
        <span class="text-muted" style="font-size:11px">그룹 일괄 추가:</span>
        ${groupChips}
      </div>` : ''}
      <div class="table-wrap" style="max-height:420px;overflow:auto;margin-top:6px">
        <table class="data-table compact">
          <thead><tr>
            <th style="width:44px">CHK</th><th>항목명</th><th>단위</th><th>담당자</th><th>기준치 (이상/이하)</th>
            <th style="width:110px">결과치 <span class="text-muted" style="font-weight:400">(NIR)</span></th>
            <th style="width:80px">결과판정</th><th>그룹</th>
          </tr></thead>
          <tbody>${specRows}</tbody>
        </table>
      </div>

      <div class="form-actions">
        <button class="btn btn-ghost" onclick="ReceivePage.reset()">초기화</button>
        <button class="btn btn-primary" onclick="ReceivePage.save()">시료 접수 등록</button>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div class="section-label" style="margin:0">접수 현황 (결과입력 대기 · 분석중 ${open.length}건)</div>
        <button class="btn btn-ghost btn-sm" onclick="App.navigate('input')">분석 결과입력 →</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>접수번호</th><th>구분</th><th>코드</th><th>시료명</th><th>접수일</th><th>신청자</th><th>입력/의뢰</th><th>우선순위</th><th>상태</th><th>처리</th></tr></thead>
          <tbody>${openRows}</tbody>
        </table>
      </div>
    </div>

    ${doneRecent.length ? `
    <div class="card" style="margin-top:14px">
      <div class="section-label">최근 완료 (분석대장 이관 ${doneRecent.length}건)</div>
      <div class="table-wrap">
        <table class="data-table compact">
          <thead><tr><th>접수번호</th><th>구분</th><th>코드</th><th>시료명</th><th>완료일</th><th>결과</th><th></th></tr></thead>
          <tbody>${doneRows}</tbody>
        </table>
      </div>
    </div>` : ''}`;
  };

  const setKind = (k) => {
    kind = k; picked = null;
    initModeList();
    App.refreshPage();
  };

  // 분석 구분 변경 (NIR / 화학) → 구분별 기본분석 리스트가 따라옴
  const setMode = (m) => {
    anaMode = m;
    initModeList();
    App.refreshPage();
  };

  // 화학분석 선택형 그룹 추가 (일반성분/톡신류/중금속류/잔류농약류 …)
  const addChemGroup = (gkey) => {
    const g = CHEM_GROUPS.find(x => x.key === gkey);
    if (!g) return;
    const keys = g.items().filter(k => LabDB.getItem(k));
    keys.forEach(k => {
      if (!baseKeys.includes(k)) baseKeys.push(k);
      if (!selItems.includes(k)) selItems.push(k);
    });
    refreshKeepForm();
  };
  // 사용자 정의 그룹 일괄 추가 (NIR·화학 공통)
  const addGroupId = (id) => {
    const g = LabDB.getQuickGroups().find(x => x.id === id);
    if (!g) return;
    groupKeys(g).forEach(k => {
      if (!baseKeys.includes(k) && !extraItems.includes(k)) extraItems.push(k);
      if (!selItems.includes(k)) selItems.push(k);
    });
    refreshKeepForm();
  };

  // 축종 구분 변경 → 제품리스트 필터 + 구분별 기본 리스트 재적용
  const setCategory = (c) => {
    prodCategory = c; picked = null;
    initModeList();
    App.refreshPage();
  };

  // 스펙리스트 CHK 토글 (수동 — 결과치 자동관리와 별개로 언제든 덮어쓸 수 있음)
  const toggleItem = (key) => {
    if (selItems.includes(key)) selItems = selItems.filter(k => k !== key);
    else selItems.push(key);
    refreshKeepForm();
  };

  // 결과치(NIR) 값 → 기준치 대비 결과판정 배지 HTML
  const judgeBadge = (key, value) => {
    if (value === '' || value == null || !picked) return '';
    const n = Number(value);
    if (Number.isNaN(n)) return '';
    const verdict = LabDB.judge(kind, picked.code, key, n);
    const m = VERDICT_META[verdict];
    return verdict === 'NA' ? '' : `<span class="verdict verdict-${m.cls}">${m.label}</span>`;
  };

  // 결과판정 배지 + CHK 체크박스 + 행 스타일 + 카운터를 DOM에서 직접 갱신(전체 재렌더 없이)
  const syncRow = (key) => {
    const judgeEl = document.getElementById(`rjudge-${key}`);
    if (judgeEl) judgeEl.innerHTML = judgeBadge(key, nirVals[key] != null ? nirVals[key] : '');
    const checked = selItems.includes(key);
    const cb = document.getElementById(`chk-${key}`);
    if (cb) cb.checked = checked;
    const row = document.getElementById(`specrow-${key}`);
    if (row) row.style.opacity = checked ? '' : '0.55';
    const selCount = document.getElementById('rc-sel-count');
    if (selCount) selCount.textContent = selItems.length;
    const nirCount = document.getElementById('rc-nir-count');
    if (nirCount) nirCount.textContent = Object.values(nirVals).filter(v => v !== '' && v != null).length;
  };

  // 결과치(NIR) 입력 (타이핑마다 전체 재렌더 없이 상태만 갱신)
  //   ※ CHK(화학분석 의뢰)는 사용자가 직접 제어 — 값을 입력해도 자동으로 해제/체크하지 않음.
  const setNir = (key, value) => {
    nirVals[key] = value;
    syncRow(key);   // 결과판정 배지 · 결과치 카운터만 갱신 (CHK는 건드리지 않음)
  };

  // ── 코드 자동완성 ──
  const suggest = () => {
    const q = document.getElementById('rc-code').value;
    const box = document.getElementById('rc-suggest');
    const list = kind === 'prod' ? LabDB.searchProducts(q, prodCategory, 15) : LabDB.searchMaster(kind, q, 15);
    if (!list.length) { box.innerHTML = ''; box.classList.remove('open'); return; }
    box.innerHTML = list.map(m => `
      <div class="suggest-item" onclick="ReceivePage.pick('${esc(m.code)}')">
        <span class="mono">${esc(m.code)}</span>
        <span class="ellipsis">${esc(m.name)}</span>
        ${m.formulaCode ? `<span class="text-muted">배합 ${esc(m.formulaCode)}</span>` : ''}
      </div>`).join('');
    box.classList.add('open');
  };
  const pick = (code) => {
    const m = kind === 'raw' ? LabDB.getMaterialByCode(code) : LabDB.getProductByCode(code);
    if (!m) return;
    picked = m;
    document.getElementById('rc-code').value = m.code;
    document.getElementById('rc-suggest').classList.remove('open');
    document.getElementById('rc-picked').innerHTML = `<b>${esc(m.name)}</b> ${m.formulaCode ? `<span class="text-muted">(배합 ${esc(m.formulaCode)})</span>` : ''}${kind === 'prod' ? ` <span class="tag tag-green" style="font-size:10px">${esc(LabDB.productCategory(m.code))}</span>` : ''}`;
    if (kind === 'prod' && m.formulaCode) { const f = document.getElementById('rc-formula'); if (f) f.value = m.formulaCode; }
    refreshKeepForm(); // 스펙리스트 기준치를 선택 코드 기준으로 갱신
  };

  // ── 의뢰항목 선택 ──
  const suggestItems = () => {
    const q = (document.getElementById('rc-item-search').value || '').toLowerCase().trim();
    const box = document.getElementById('rc-item-suggest');
    let list = LabDB.getItems(kind).filter(it => !selItems.includes(it.key));
    if (q) list = list.filter(it => it.label.toLowerCase().includes(q) || (it.key || '').includes(q) || (it.group || '').toLowerCase().includes(q));
    list = list.slice(0, 25);
    if (!list.length) { box.innerHTML = ''; box.classList.remove('open'); return; }
    box.innerHTML = list.map(it => `
      <div class="suggest-item suggest-item-3" onclick="ReceivePage.addItem('${it.key}')">
        <span>${esc(it.label)} <span class="text-muted">${esc(it.unit)}</span></span>
        <span class="tag tag-gray" style="font-size:10px">${esc(it.group)}</span>
        <span class="text-muted" style="font-size:11px">＋추가</span>
      </div>`).join('');
    box.classList.add('open');
  };
  const addItem = (key) => {
    if (!extraItems.includes(key)) extraItems.push(key);
    if (!selItems.includes(key)) selItems.push(key);
    refreshKeepForm();
  };
  // ── 그룹 관리 모달 (그룹 추가·이름 변경·항목 구성 수정·삭제) ──
  const closeGroups = () => { document.getElementById('qgm-overlay')?.remove(); };
  const manageGroups = () => {
    closeGroups();
    const groups = LabDB.getQuickGroups();
    const rows = groups.map(g => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
        <input value="${esc(g.label)}" onchange="ReceivePage.renameGroup('${esc(g.id)}', this.value)"
          style="width:150px;padding:6px 9px;font-size:13px;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:6px;color:var(--text)">
        <span class="text-muted" style="font-size:12px;flex:1">${g.items.length}개 항목 · ${esc(g.items.slice(0, 4).map(k => LabDB.itemLabel(k)).join(', '))}${g.items.length > 4 ? ' 외' : ''}</span>
        <button class="btn btn-outline-primary btn-xs" onclick="ReceivePage.editGroupItems('${esc(g.id)}')">항목 편집</button>
        <button class="btn btn-ghost btn-xs" onclick="ReceivePage.deleteGroup('${esc(g.id)}')">삭제</button>
      </div>`).join('') || '<div class="text-muted" style="padding:14px;text-align:center;font-size:12px">그룹이 없습니다 — 아래에서 추가하세요</div>';
    const ov = document.createElement('div');
    ov.id = 'qgm-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;width:min(640px,95vw);max-height:88vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
          <b>그룹 일괄 추가 관리</b>
          <button class="btn btn-ghost btn-sm" onclick="ReceivePage.closeGroups()">✕ 닫기</button>
        </div>
        <div style="overflow:auto;padding:6px 18px">${rows}</div>
        <div style="display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--border)">
          <input id="qgm-newname" placeholder="새 그룹 이름 (예: 우리공장 물리분석)"
            style="flex:1;padding:7px 10px;font-size:13px;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:7px;color:var(--text)">
          <button class="btn btn-primary btn-sm" onclick="ReceivePage.createGroup()">그룹 추가</button>
        </div>
        <div class="text-muted" style="font-size:11.5px;padding:0 18px 14px">그룹 이름·구성은 모든 단말에 공유됩니다. 이름 수정은 입력 후 바로 저장됩니다.</div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeGroups(); });
    document.body.appendChild(ov);
  };
  const renameGroup = (id, name) => {
    const label = String(name || '').trim();
    if (!label) { App.toast('그룹 이름을 입력하세요', 'warning'); manageGroups(); return; }
    const groups = LabDB.getQuickGroups();
    const g = groups.find(x => x.id === id);
    if (g) { g.label = label; LabDB.saveQuickGroups(groups); App.toast('그룹 이름 변경됨', 'success'); refreshKeepForm(); }
  };
  const createGroup = () => {
    const name = (document.getElementById('qgm-newname')?.value || '').trim();
    if (!name) { App.toast('그룹 이름을 입력하세요', 'warning'); return; }
    const groups = LabDB.getQuickGroups();
    if (groups.some(g => g.label === name)) { App.toast('같은 이름의 그룹이 있습니다', 'warning'); return; }
    const g = { id: 'QG-' + Date.now().toString(36), label: name, items: [] };
    groups.push(g);
    LabDB.saveQuickGroups(groups);
    editGroupItems(g.id);   // 만들자마자 항목 선택으로
  };
  const deleteGroup = (id) => {
    const groups = LabDB.getQuickGroups();
    const g = groups.find(x => x.id === id);
    if (!g) return;
    if (!confirm(`'${g.label}' 그룹을 삭제할까요? (분석항목 자체는 삭제되지 않습니다)`)) return;
    LabDB.saveQuickGroups(groups.filter(x => x.id !== id));
    App.toast('그룹 삭제됨', 'info');
    manageGroups();
    refreshKeepForm();
  };
  // 항목 편집: 전체 항목 마스터에서 체크로 구성
  const closeGroupItems = () => { document.getElementById('qgi-overlay')?.remove(); };
  const editGroupItems = (id) => {
    closeGroups(); closeGroupItems();
    const g = LabDB.getQuickGroups().find(x => x.id === id);
    if (!g) return;
    const sel = new Set(g.items);
    // 마스터 group별로 섹션 렌더
    const byGroup = {};
    LabDB.getItems().forEach(it => { (byGroup[it.group || '기타'] = byGroup[it.group || '기타'] || []).push(it); });
    const sections = Object.keys(byGroup).map(gr => `
      <div class="qgi-sec" data-sec="${esc(gr)}">
        <div style="font-size:11.5px;font-weight:700;color:var(--text-muted);margin:10px 0 4px">${esc(gr)}</div>
        ${byGroup[gr].map(it => `
          <label class="qgi-row" data-label="${esc((it.label + ' ' + it.key).toLowerCase())}"
            style="display:flex;align-items:center;gap:8px;padding:3px 2px;font-size:12.5px;cursor:pointer">
            <input type="checkbox" data-qgi="${esc(it.key)}" ${sel.has(it.key) ? 'checked' : ''}>
            ${esc(it.label)} <span class="text-muted" style="font-size:10.5px">${esc(it.unit)}</span>
          </label>`).join('')}
      </div>`).join('');
    const ov = document.createElement('div');
    ov.id = 'qgi-overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;width:min(560px,95vw);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)">
          <div><b>'${esc(g.label)}' 항목 구성</b> <span class="text-muted" id="qgi-count" style="font-size:12px">(${g.items.length}개 선택)</span></div>
          <button class="btn btn-ghost btn-sm" onclick="ReceivePage.closeGroupItems()">✕</button>
        </div>
        <div style="padding:10px 18px 0">
          <input id="qgi-search" placeholder="항목 검색 (예: PDI, 아플라톡신)" oninput="ReceivePage.filterGroupItems(this.value)"
            style="width:100%;padding:7px 10px;font-size:13px;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:7px;color:var(--text);box-sizing:border-box">
        </div>
        <div id="qgi-list" style="overflow:auto;padding:4px 18px 12px">${sections}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border)">
          <button class="btn btn-ghost btn-sm" onclick="ReceivePage.closeGroupItems();ReceivePage.manageGroups()">취소</button>
          <button class="btn btn-primary btn-sm" onclick="ReceivePage.saveGroupItems('${esc(g.id)}')">저장</button>
        </div>
      </div>`;
    ov.addEventListener('change', (e) => {
      if (e.target && e.target.dataset && e.target.dataset.qgi != null) {
        const n = ov.querySelectorAll('input[data-qgi]:checked').length;
        const c = document.getElementById('qgi-count'); if (c) c.textContent = `(${n}개 선택)`;
      }
    });
    document.body.appendChild(ov);
  };
  const filterGroupItems = (q) => {
    const lq = String(q || '').toLowerCase().trim();
    document.querySelectorAll('#qgi-list .qgi-row').forEach(row => {
      row.style.display = !lq || row.dataset.label.includes(lq) ? 'flex' : 'none';
    });
    document.querySelectorAll('#qgi-list .qgi-sec').forEach(sec => {
      const any = [...sec.querySelectorAll('.qgi-row')].some(r => r.style.display !== 'none');
      sec.style.display = any ? '' : 'none';
    });
  };
  const saveGroupItems = (id) => {
    const keys = [...document.querySelectorAll('#qgi-overlay input[data-qgi]:checked')].map(i => i.dataset.qgi);
    const groups = LabDB.getQuickGroups();
    const g = groups.find(x => x.id === id);
    if (!g) return;
    g.items = keys;
    LabDB.saveQuickGroups(groups);
    closeGroupItems();
    App.toast(`'${g.label}' 그룹 저장됨 (${keys.length}개 항목)`, 'success');
    refreshKeepForm();
  };
  // 항목 조작 시 폼 입력값을 유지한 채 재렌더
  const refreshKeepForm = () => {
    const keep = {};
    ['rc-code', 'rc-priority', 'rc-date', 'rc-by', 'rc-supplier', 'rc-origin', 'rc-formula', 'rc-prodDate', 'rc-note'].forEach(id => {
      const el = document.getElementById(id); if (el) keep[id] = el.value;
    });
    App.refreshPage();
    Object.keys(keep).forEach(id => { const el = document.getElementById(id); if (el) el.value = keep[id]; });
    if (picked) {
      const info = document.getElementById('rc-picked');
      if (info) info.innerHTML = `<b>${esc(picked.name)}</b>`;
    }
  };

  const save = () => {
    const g = (id) => document.getElementById(id)?.value || '';
    if (!g('rc-code') || !picked) { App.toast('코드를 검색해 선택하세요', 'error'); return; }
    const nirClean = {};
    Object.keys(nirVals).forEach(k => {
      const v = nirVals[k];
      const n = Number(v);
      if (v !== '' && v != null && !Number.isNaN(n)) nirClean[k] = n;
    });
    const meName = (typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : g('rc-by');
    const meEmail = (typeof Auth !== 'undefined' && Auth.currentEmail) ? Auth.currentEmail() : '';
    const fac = (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : '';
    const req = LabDB.addRequest({
      kind, code: picked.code, name: picked.name,
      date: g('rc-date'), by: meName || g('rc-by'), byEmail: meEmail,
      factory: (fac && fac !== 'ALL') ? fac : '',
      supplier: g('rc-supplier'), origin: g('rc-origin'),
      formula: g('rc-formula'), prodDate: g('rc-prodDate'),
      note: g('rc-note'), priority: g('rc-priority') || '보통',
      category: kind === 'prod' ? prodCategory : '',
      anaMode,                     // 분석 구분 (nir/chem)
      items: selItems,
      nirVals: nirClean,
    });
    const nirMsg = Object.keys(nirClean).length ? ` · 결과치(NIR) ${Object.keys(nirClean).length}개` : '';
    App.toast(`접수 완료 · ${req.id} (화학분석 의뢰 ${selItems.length}개${nirMsg})`, 'success');
    reset();
  };

  const cancel = (id) => {
    const r = LabDB.getRequest(id);
    if (!r) return;
    if (!confirm(`접수 ${id} (${r.name})를 취소할까요?\n입력 중인 값도 함께 삭제됩니다.`)) return;
    LabDB.deleteRequest(id);
    App.toast('접수가 취소되었습니다', 'info');
    App.refreshPage();
  };

  const reset = () => {
    picked = null;
    initModeList();
    App.refreshPage();
  };

  const afterRender = () => {
    if (window.__labReceiveBound) return;
    window.__labReceiveBound = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#rc-code') && !e.target.closest('#rc-suggest')) document.getElementById('rc-suggest')?.classList.remove('open');
      if (!e.target.closest('#rc-item-search') && !e.target.closest('#rc-item-suggest')) document.getElementById('rc-item-suggest')?.classList.remove('open');
    });
  };

  return { render, afterRender, setKind, setCategory, setMode, addChemGroup, addGroupId, toggleItem, setNir, suggest, pick, suggestItems, addItem,
    manageGroups, closeGroups, renameGroup, createGroup, deleteGroup, editGroupItems, closeGroupItems, filterGroupItems, saveGroupItems,
    save, cancel, reset };
})();
