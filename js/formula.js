// ============================================================
// formula.js — 배합비/원료 구성 관리
// ============================================================

const FormulaPage = (() => {
  const rowCount = 8;

  const safe = (v) => String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const badge = (status) => {
    if (status === 'ACTIVE') return '<span class="badge badge-pass">사용중</span>';
    if (status === 'HOLD') return '<span class="badge badge-warning">보류</span>';
    return '<span class="badge badge-default">작성중</span>';
  };

  const totalPct = (recipe) => recipe.ingredients.reduce((sum, item) => sum + (Number(item.pct) || 0), 0);
  const avg = (items) => items.length ? Math.round(items.reduce((sum, item) => sum + item.ingredients.length, 0) / items.length) : 0;

  const render = () => {
    const recipes = DB.getFormulaRecipes().slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const activeCount = recipes.filter(item => item.status === 'ACTIVE').length;
    const holdCount = recipes.filter(item => item.status === 'HOLD').length;

    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">배합비 · 생산</div>
            <h2>배합비 관리</h2>
            <p>제품별 원료 구성비, 배합 특이사항, 주의 조건을 배합비팀 기준으로 관리합니다.</p>
          </div>
          <div class="module-metrics">
            <div><span>${formatNum(recipes.length)}</span><label>등록 배합비</label></div>
            <div><span>${formatNum(activeCount)}</span><label>사용중</label></div>
            <div><span>${formatNum(avg(recipes))}</span><label>평균 원료수</label></div>
            <div><span>${formatNum(holdCount)}</span><label>보류</label></div>
          </div>
        </div>

        <div class="flex justify-between items-center mb-16 formula-toolbar">
          <div>
            <div class="text-sm text-muted">제품코드와 원료코드 마스터를 연결해 배합비 LOT 추적의 기준으로 사용합니다.</div>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-sm" onclick="FormulaPage.openSyncModal()">외부 연동 · 가져오기</button>
            <button class="btn btn-primary btn-sm" onclick="FormulaPage.openAddModal()">＋ 배합비 등록</button>
          </div>
        </div>

        <div class="formula-layout">
          <div class="formula-list">
            ${recipes.length === 0 ? emptyState() : recipes.map(renderRecipeCard).join('')}
          </div>
          <aside class="card formula-side-panel">
            <div class="card-title mb-12">배합비팀 확인 포인트</div>
            <div class="formula-checkline">
              <strong>원료분석</strong>
              <span>조건부/부적합 원료는 배합비 보정 또는 투입 보류 검토</span>
            </div>
            <div class="formula-checkline">
              <strong>재고주기</strong>
              <span>사용량이 높은 주원료는 재고표와 함께 최소 재고량 재설정</span>
            </div>
            <div class="formula-checkline">
              <strong>질병 위기단계</strong>
              <span>심각 단계 원료·차량은 방역 확인 후 투입 승인</span>
            </div>
            <div class="formula-checkline">
              <strong>VOC 역추적</strong>
              <span>제품 LOT에서 배합비 버전과 원료 LOT를 함께 확인</span>
            </div>
          </aside>
        </div>

        <div class="modal-overlay" id="formula-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title" id="formula-modal-title">배합비 등록</div>
              <button class="modal-close" onclick="FormulaPage.closeModal('formula-modal')">✕</button>
            </div>
            <div id="formula-modal-body"></div>
          </div>
        </div>

        <div class="modal-overlay" id="formula-sync-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title">배합비 외부 연동</div>
              <button class="modal-close" onclick="FormulaPage.closeModal('formula-sync-modal')">✕</button>
            </div>
            <div id="formula-sync-body"></div>
          </div>
        </div>
      </div>
    `;
  };

  // ============================================================
  // 외부 연동 — 설정 / 가져오기 / 미리보기
  //   API 개통 전에도 같은 파이프라인으로 파일 임포트가 가능하도록 두 경로를 한 화면에 둔다.
  // ============================================================
  let syncPreview = [];      // 미리보기 목록
  let syncPick = {};         // 반영 대상 체크 상태
  let syncTab = 'pull';      // pull | config | log

  const openSyncModal = () => {
    syncTab = 'pull';
    renderSyncBody();
    document.getElementById('formula-sync-modal')?.classList.add('open');
  };

  const setSyncTab = (t) => { syncTab = t; renderSyncBody(); };

  const kindBadge = (k) => k === 'NEW' ? '<span class="badge badge-pass">신규</span>'
    : k === 'UPDATE' ? '<span class="badge badge-warning">변경</span>'
    : '<span class="badge badge-default">동일</span>';

  const renderSyncBody = () => {
    const el = document.getElementById('formula-sync-body');
    if (!el) return;
    const cfg = FormulaSync.getConfig();
    el.innerHTML = `
      <div class="fsync-tabs">
        ${[['pull', '가져오기'], ['config', '연동 설정'], ['log', '이력']].map(([k, l]) =>
          `<button class="fsync-tab ${syncTab === k ? 'active' : ''}" onclick="FormulaPage.setSyncTab('${k}')">${l}</button>`).join('')}
      </div>
      ${syncTab === 'pull' ? pullTab(cfg) : syncTab === 'config' ? configTab(cfg) : logTab()}`;
  };

  const pullTab = (cfg) => `
    <div class="fsync-note">
      ${cfg.baseUrl
        ? `연동 주소: <b>${safe(FormulaSync.buildUrl(cfg))}</b>`
        : '아직 API 주소가 설정되지 않았습니다. <b>연동 설정</b> 탭에서 주소·인증·필드 매핑을 넣으면 바로 가져올 수 있습니다. 그 전까지는 아래 파일 가져오기를 쓰십시오.'}
      <br>가져온 내용은 <b>바로 저장되지 않습니다.</b> 신규·변경·동일을 확인하고 고른 것만 반영합니다.
    </div>

    <div class="fsync-actions">
      <button class="btn btn-primary btn-sm" ${cfg.baseUrl ? '' : 'disabled'} onclick="FormulaPage.pullApi()">API 에서 가져오기</button>
      <label class="btn btn-sm">
        파일 가져오기 (JSON · CSV)
        <input type="file" accept=".json,.csv,.txt" style="display:none" onchange="FormulaPage.pullFile(this)">
      </label>
      <button class="btn btn-sm" onclick="FormulaPage.loadSample()">예시 응답으로 미리보기</button>
      <span class="fsync-hint">CSV 는 원료별 1행 형태를 제품코드+버전으로 묶습니다.</span>
    </div>

    <div id="fsync-preview">${previewHtml()}</div>`;

  const previewHtml = () => {
    if (!syncPreview.length) return '<div class="fsync-empty">가져온 배합비가 없습니다.</div>';
    const n = { NEW: 0, UPDATE: 0, SAME: 0 };
    syncPreview.forEach(i => { n[i._kind] += 1; });
    const bad = syncPreview.filter(i => i._valid.issues.length).length;
    return `
      <div class="fsync-summary">
        <span>총 <b>${syncPreview.length}</b>건</span>
        <span class="ok">신규 <b>${n.NEW}</b></span>
        <span class="warn">변경 <b>${n.UPDATE}</b></span>
        <span>동일 <b>${n.SAME}</b></span>
        ${bad ? `<span class="bad">확인필요 <b>${bad}</b></span>` : ''}
        <button class="btn btn-sm" onclick="FormulaPage.pickAll(true)">전체 선택</button>
        <button class="btn btn-sm" onclick="FormulaPage.pickAll(false)">전체 해제</button>
      </div>
      <div class="table-wrap">
        <table class="data-table fsync-table">
          <thead><tr>
            <th style="width:36px"></th><th>구분</th><th>제품코드</th><th>제품명</th><th>버전</th>
            <th class="td-right">원료수</th><th class="td-right">합계</th><th>확인사항</th>
          </tr></thead>
          <tbody>${syncPreview.map((it, i) => `<tr class="${it._valid.issues.length ? 'warn' : ''}">
            <td><input type="checkbox" ${syncPick[i] ? 'checked' : ''} ${it._kind === 'SAME' || !it._valid.ok ? 'disabled' : ''}
                       onchange="FormulaPage.pickOne(${i}, this.checked)"></td>
            <td>${kindBadge(it._kind)}</td>
            <td class="mono">${safe(it.productCode || '-')}</td>
            <td>${safe(it.productName || '-')}</td>
            <td class="mono">${safe(it.version)}</td>
            <td class="td-right mono">${it.ingredients.length}</td>
            <td class="td-right mono ${Math.abs(it._valid.sum - 100) > 0.5 ? 'fsync-bad' : ''}">${it._valid.sum.toFixed(2)}%</td>
            <td class="text-sm text-muted">${safe(it._valid.issues.join(' · ') || (it._changes.length ? '변경: ' + it._changes.join(', ') : ''))}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="fsync-apply">
        <span class="fsync-hint">선택 <b>${Object.values(syncPick).filter(Boolean).length}</b>건을 반영합니다. 변경 건은 기존 배합비를 덮어씁니다.</span>
        <button class="btn btn-primary" onclick="FormulaPage.applySync()">선택 항목 반영</button>
      </div>`;
  };

  const configTab = (cfg) => {
    const m = cfg.map;
    const row = (id, label, value, ph) => `
      <div class="form-group">
        <label class="form-label">${label}</label>
        <input class="form-input" id="${id}" value="${safe(value ?? '')}" placeholder="${safe(ph || '')}">
      </div>`;
    return `
      <div class="fsync-note">
        상대 시스템의 <b>주소·인증·필드명</b>만 채우면 됩니다. 코드 수정은 필요 없습니다.
        <br>연결이 안 되면 대부분 상대 서버의 <b>CORS 허용</b>이 빠진 경우입니다.
      </div>
      <div class="form-grid form-grid-3">
        ${row('fs-base', 'Base URL', cfg.baseUrl, 'http://erp.wsfeed.local')}
        ${row('fs-path', '엔드포인트 경로', cfg.path, '/api/formulas')}
        ${row('fs-query', '쿼리 파라미터', cfg.queryParams, 'plant=NS&status=ACTIVE')}
      </div>
      <div class="form-grid form-grid-3">
        <div class="form-group"><label class="form-label">인증 방식</label>
          <select class="form-input" id="fs-auth">
            ${Object.entries(FormulaSync.AUTH_TYPES).map(([k, v]) =>
              `<option value="${k}" ${cfg.authType === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select></div>
        ${row('fs-authkey', '헤더 이름', cfg.authKeyName, 'X-API-Key')}
        ${row('fs-authval', '인증 값', cfg.authValue, '토큰 또는 키')}
      </div>

      <div class="fsync-sec">필드 매핑 — 상대 응답의 필드명</div>
      <div class="form-grid form-grid-3">
        ${row('fs-m-list', '목록 경로', m.listPath, 'data (응답 자체가 배열이면 비움)')}
        ${row('fs-m-code', '제품코드', m.productCode, '')}
        ${row('fs-m-name', '제품명', m.productName, '')}
        ${row('fs-m-ver', '버전', m.version, '')}
        ${row('fs-m-qty', '목표 배합량', m.targetQty, '')}
        ${row('fs-m-status', '상태', m.status, '')}
        ${row('fs-m-ings', '원료 배열', m.ingredients, '')}
        ${row('fs-m-icode', '원료코드', m.ingCode, '')}
        ${row('fs-m-iname', '원료명', m.ingName, '')}
        ${row('fs-m-ipct', '구성비', m.ingPct, '')}
        ${row('fs-m-inote', '원료 특이사항', m.ingNote, '')}
        <div class="form-group"><label class="form-label">임포트 시 상태</label>
          <select class="form-input" id="fs-autostatus">
            <option value="DRAFT" ${cfg.autoStatus === 'DRAFT' ? 'selected' : ''}>작성중으로 받기 (권장)</option>
            <option value="ACTIVE" ${cfg.autoStatus === 'ACTIVE' ? 'selected' : ''}>사용중으로 받기</option>
            <option value="" ${cfg.autoStatus === '' ? 'selected' : ''}>원본 상태 유지</option>
          </select>
          <div class="form-hint">받자마자 사용중이 되면 검토 없이 생산에 쓰입니다. 작성중 권장.</div></div>
      </div>

      <div class="fsync-actions">
        <button class="btn btn-sm" onclick="FormulaPage.testSync()">연결 테스트</button>
        <button class="btn btn-sm btn-danger" onclick="FormulaPage.resetSync()">기본값 복원</button>
        <button class="btn btn-primary btn-sm" onclick="FormulaPage.saveSyncConfig()">설정 저장</button>
      </div>
      <div id="fsync-test"></div>
      ${cfg.updatedAt ? `<div class="fsync-hint mt-8">최종 수정 ${safe(String(cfg.updatedAt).slice(0, 10))}${cfg.updatedBy ? ' · ' + safe(cfg.updatedBy) : ''}</div>` : ''}`;
  };

  const logTab = () => {
    const logs = FormulaSync.getLogs();
    if (!logs.length) return '<div class="fsync-empty">반영 이력이 없습니다.</div>';
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>일시</th><th>경로</th><th class="td-right">신규</th><th class="td-right">갱신</th><th class="td-right">건너뜀</th><th>담당</th></tr></thead>
      <tbody>${logs.map(l => `<tr>
        <td class="text-sm">${safe(String(l.at).slice(0, 16).replace('T', ' '))}</td>
        <td>${safe(l.source)}</td>
        <td class="td-right mono">${l.created}</td>
        <td class="td-right mono">${l.updated}</td>
        <td class="td-right mono">${l.skipped}</td>
        <td class="text-sm">${safe(l.by || '-')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  };

  const readCfgForm = () => ({
    baseUrl: document.getElementById('fs-base')?.value.trim(),
    path: document.getElementById('fs-path')?.value.trim(),
    queryParams: document.getElementById('fs-query')?.value.trim(),
    authType: document.getElementById('fs-auth')?.value,
    authKeyName: document.getElementById('fs-authkey')?.value.trim(),
    authValue: document.getElementById('fs-authval')?.value.trim(),
    autoStatus: document.getElementById('fs-autostatus')?.value,
    map: {
      listPath: document.getElementById('fs-m-list')?.value.trim(),
      productCode: document.getElementById('fs-m-code')?.value.trim(),
      productName: document.getElementById('fs-m-name')?.value.trim(),
      version: document.getElementById('fs-m-ver')?.value.trim(),
      targetQty: document.getElementById('fs-m-qty')?.value.trim(),
      status: document.getElementById('fs-m-status')?.value.trim(),
      ingredients: document.getElementById('fs-m-ings')?.value.trim(),
      ingCode: document.getElementById('fs-m-icode')?.value.trim(),
      ingName: document.getElementById('fs-m-iname')?.value.trim(),
      ingPct: document.getElementById('fs-m-ipct')?.value.trim(),
      ingNote: document.getElementById('fs-m-inote')?.value.trim(),
    },
  });

  const saveSyncConfig = () => {
    FormulaSync.saveConfig({ ...readCfgForm(), enabled: true }, actorName());
    App.toast('연동 설정을 저장했습니다', 'success');
    renderSyncBody();
  };
  const resetSync = () => {
    if (!confirm('연동 설정을 기본값으로 되돌립니다.\n계속할까요?')) return;
    FormulaSync.resetConfig();
    App.toast('기본값으로 복원했습니다', 'success');
    renderSyncBody();
  };

  const testSync = async () => {
    const el = document.getElementById('fsync-test');
    if (el) el.innerHTML = '<div class="fsync-hint">연결 확인 중…</div>';
    try {
      const r = await FormulaSync.testConnection(readCfgForm());
      el.innerHTML = `<div class="fsync-test ok">
        연결 성공 (${r.ms}ms) · 목록 ${r.isArray ? `배열 ${r.count}건` : '배열 아님 — 목록 경로를 확인하십시오'}
        ${r.sampleKeys.length ? `<br>응답 필드: <span class="mono">${safe(r.sampleKeys.join(', '))}</span>` : ''}
        ${!r.isArray && r.rootKeys.length ? `<br>응답 최상위 키: <span class="mono">${safe(r.rootKeys.join(', '))}</span>` : ''}
      </div>`;
    } catch (e) {
      el.innerHTML = `<div class="fsync-test bad">${safe(e.message)}</div>`;
    }
  };

  const setPreview = (items) => {
    syncPreview = items;
    syncPick = {};
    items.forEach((it, i) => { syncPick[i] = it._kind !== 'SAME' && it._valid.ok; });
    const el = document.getElementById('fsync-preview');
    if (el) el.innerHTML = previewHtml();
  };

  const pullApi = async () => {
    const el = document.getElementById('fsync-preview');
    if (el) el.innerHTML = '<div class="fsync-hint">가져오는 중…</div>';
    try { setPreview(await FormulaSync.pullFromApi()); App.toast(`${syncPreview.length}건을 가져왔습니다`, 'success'); }
    catch (e) { if (el) el.innerHTML = `<div class="fsync-test bad">${safe(e.message)}</div>`; App.toast(e.message, 'error'); }
  };

  const pullFile = (input) => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { setPreview(FormulaSync.importFromText(String(rd.result), f.name)); App.toast(`${syncPreview.length}건을 읽었습니다`, 'success'); }
      catch (e) { App.toast(e.message, 'error'); }
    };
    rd.onerror = () => App.toast('파일을 읽지 못했습니다', 'error');
    rd.readAsText(f, 'utf-8');
  };

  const loadSample = () => {
    const raw = FormulaSync.sampleResponse();
    setPreview(FormulaSync.diffAgainstExisting(FormulaSync.normalize(raw, FormulaSync.getConfig().map)));
    App.toast('예시 응답으로 미리보기를 만들었습니다 — 매핑 확인용입니다', 'info');
  };

  const pickOne = (i, on) => { syncPick[i] = on; const el = document.getElementById('fsync-preview'); if (el) el.innerHTML = previewHtml(); };
  const pickAll = (on) => {
    syncPreview.forEach((it, i) => { syncPick[i] = on && it._kind !== 'SAME' && it._valid.ok; });
    const el = document.getElementById('fsync-preview'); if (el) el.innerHTML = previewHtml();
  };

  const applySync = () => {
    const chosen = syncPreview.filter((_, i) => syncPick[i]);
    if (!chosen.length) { App.toast('반영할 항목을 선택하십시오', 'warning'); return; }
    const upd = chosen.filter(c => c._prevId).length;
    if (!confirm(`${chosen.length}건을 반영합니다.${upd ? `\n그중 ${upd}건은 기존 배합비를 덮어씁니다.` : ''}\n계속할까요?`)) return;
    const log = FormulaSync.applyItems(chosen, actorName());
    App.toast(`반영 완료 — 신규 ${log.created} · 갱신 ${log.updated}${log.skipped ? ` · 건너뜀 ${log.skipped}` : ''}`, 'success');
    closeModal('formula-sync-modal');
    App.refreshPage();
  };

  const actorName = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName()) || '배합비팀'; } catch (_) { return '배합비팀'; } };

  const emptyState = () => `
    <div class="empty-state">
      <div class="empty-icon"></div>
      <h3>등록된 배합비가 없습니다</h3>
      <p class="text-muted">배합비 등록 버튼으로 제품별 원료 구성비를 추가하세요.</p>
    </div>
  `;

  const renderRecipeCard = (recipe) => {
    const total = totalPct(recipe);
    const totalClass = Math.abs(total - 100) <= 0.5 ? 'text-success' : 'text-warning';
    return `
      <article class="formula-card">
        <div class="formula-card-head">
          <div>
            <div class="td-mono text-xs">${safe(recipe.formulaCode || recipe.id)}</div>
            <h3>${safe(recipe.productName || '제품명 미지정')}</h3>
            <p>${safe(recipe.productCode || '-')} · ${safe(recipe.version || 'v1')} · 목표 ${formatNum(recipe.targetQty)}kg</p>
          </div>
          ${badge(recipe.status)}
        </div>

        <div class="formula-summary-grid">
          <div><span>${formatNum(recipe.ingredients.length)}</span><label>원료수</label></div>
          <div><span class="${totalClass}">${total.toFixed(1)}%</span><label>구성합계</label></div>
          <div><span>${safe(recipe.ownerTeam || '배합비팀')}</span><label>담당</label></div>
        </div>

        <div class="formula-ingredient-list">
          ${recipe.ingredients.map(renderIngredient).join('')}
        </div>

        <div class="formula-note-grid">
          <div>
            <label>특이사항</label>
            <p>${safe(recipe.specialNotes || '등록된 특이사항 없음')}</p>
          </div>
          <div>
            <label>주의사항</label>
            <p>${safe(recipe.caution || '등록된 주의사항 없음')}</p>
          </div>
        </div>
      </article>
    `;
  };

  const renderIngredient = (item) => `
    <div class="formula-ingredient-row">
      <div>
        <strong>${safe(item.materialName || '원료명 미지정')}</strong>
        <span class="td-mono">${safe(item.materialCode || '-')}</span>
      </div>
      <div class="td-right">
        <strong>${Number(item.pct || 0).toFixed(2)}%</strong>
        <span>${formatNum(item.qty)}kg</span>
      </div>
      <div>${safe(item.note || '-')}</div>
    </div>
  `;

  const openAddModal = () => {
    const body = document.getElementById('formula-modal-body');
    if (!body) return;
    const products = DB.getProducts().filter(p => p.active !== false);
    const materials = DB.getMaterials().filter(m => m.active !== false);

    document.getElementById('formula-modal-title').textContent = '배합비 등록';
    body.innerHTML = `
      <div class="formula-modal-body">
        <div class="form-grid form-grid-3">
          <div class="form-group">
            <label class="form-label">제품코드</label>
            <input class="form-input" id="fr-product-code" list="fr-products" placeholder="예) 7000001" oninput="FormulaPage.syncProductName()">
            <datalist id="fr-products">
              ${products.map(p => `<option value="${safe(p.code)}">${safe(p.name || '')}</option>`).join('')}
            </datalist>
          </div>
          <div class="form-group">
            <label class="form-label">제품명</label>
            <input class="form-input" id="fr-product-name" placeholder="제품명">
          </div>
          <div class="form-group">
            <label class="form-label">버전</label>
            <input class="form-input" id="fr-version" value="v${new Date().getFullYear().toString().slice(2)}.1">
          </div>
          <div class="form-group">
            <label class="form-label">목표 배합량(kg)</label>
            <input type="number" class="form-input" id="fr-target-qty" value="1000" min="1">
          </div>
          <div class="form-group">
            <label class="form-label">상태</label>
            <select class="form-input" id="fr-status">
              <option value="ACTIVE">사용중</option>
              <option value="DRAFT">작성중</option>
              <option value="HOLD">보류</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">작성자</label>
            <input class="form-input" id="fr-created-by" value="배합비팀">
          </div>
        </div>

        <datalist id="fr-materials">
          ${materials.map(m => `<option value="${safe(m.code)}">${safe(m.name || '')}</option>`).join('')}
        </datalist>

        <div class="formula-input-section">
          <div class="formula-input-head">
            <strong>원료 구성</strong>
            <span>구성비 합계는 100% 기준입니다.</span>
          </div>
          <div class="formula-input-table">
            <div class="formula-input-row formula-input-row-head">
              <span>원료코드</span><span>원료명</span><span>구성비(%)</span><span>특이사항</span>
            </div>
            ${Array.from({ length: rowCount }, (_, idx) => ingredientInputRow(idx)).join('')}
          </div>
        </div>

        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label class="form-label">배합 특이사항</label>
            <textarea class="form-textarea" id="fr-special-notes" placeholder="예) 원료 수분 높을 때 옥수수 비율 보정 검토"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label">주의사항</label>
            <textarea class="form-textarea" id="fr-caution" placeholder="예) 질병 위기단계 심각 시 차량 소독 확인 후 투입"></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="FormulaPage.closeModal('formula-modal')">취소</button>
          <button class="btn btn-primary" onclick="FormulaPage.submitFormula()">저장</button>
        </div>
      </div>
    `;
    openModal('formula-modal');
  };

  const ingredientInputRow = (idx) => `
    <div class="formula-input-row">
      <input class="form-input" id="fr-mat-code-${idx}" list="fr-materials" oninput="FormulaPage.syncMaterialName(${idx})" placeholder="원료코드">
      <input class="form-input" id="fr-mat-name-${idx}" placeholder="원료명">
      <input class="form-input" id="fr-pct-${idx}" type="number" min="0" step="0.01" placeholder="0.00">
      <input class="form-input" id="fr-note-${idx}" placeholder="특이사항">
    </div>
  `;

  const syncProductName = () => {
    const code = document.getElementById('fr-product-code')?.value;
    const product = DB.getProductByCode(code);
    const nameEl = document.getElementById('fr-product-name');
    if (product && nameEl && !nameEl.dataset.manual) nameEl.value = product.name || '';
  };

  const syncMaterialName = (idx) => {
    const code = document.getElementById(`fr-mat-code-${idx}`)?.value;
    const material = DB.getMaterialByCode(code);
    const nameEl = document.getElementById(`fr-mat-name-${idx}`);
    if (material && nameEl) nameEl.value = material.name || '';
  };

  const submitFormula = () => {
    const productCode = document.getElementById('fr-product-code')?.value.trim() || '';
    const productName = document.getElementById('fr-product-name')?.value.trim() || '';
    const targetQty = Number(document.getElementById('fr-target-qty')?.value || 1000);
    const ingredients = [];

    for (let i = 0; i < rowCount; i += 1) {
      const materialCode = document.getElementById(`fr-mat-code-${i}`)?.value.trim() || '';
      const materialName = document.getElementById(`fr-mat-name-${i}`)?.value.trim() || '';
      const pct = Number(document.getElementById(`fr-pct-${i}`)?.value || 0);
      const note = document.getElementById(`fr-note-${i}`)?.value.trim() || '';
      if (materialCode || materialName || pct > 0 || note) {
        ingredients.push({ materialCode, materialName, pct, note });
      }
    }

    const total = ingredients.reduce((sum, item) => sum + (Number(item.pct) || 0), 0);
    if (!productCode && !productName) { App.toast('제품코드 또는 제품명을 입력하세요', 'error'); return; }
    if (!ingredients.length) { App.toast('원료 구성을 1개 이상 입력하세요', 'error'); return; }
    if (Math.abs(total - 100) > 0.5) { App.toast(`원료 구성비 합계가 ${total.toFixed(2)}%입니다`, 'warning'); return; }

    DB.addFormulaRecipe({
      productCode,
      productName,
      version: document.getElementById('fr-version')?.value.trim() || 'v1',
      status: document.getElementById('fr-status')?.value || 'ACTIVE',
      targetQty,
      ingredients,
      specialNotes: document.getElementById('fr-special-notes')?.value.trim() || '',
      caution: document.getElementById('fr-caution')?.value.trim() || '',
      createdBy: document.getElementById('fr-created-by')?.value.trim() || '배합비팀',
    });

    closeModal('formula-modal');
    App.toast('배합비가 저장되었습니다', 'success');
    App.refreshPage();
  };

  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');

  return {
    render, afterRender: () => {}, openAddModal, submitFormula, syncProductName, syncMaterialName, closeModal,
    // 외부 연동
    openSyncModal, setSyncTab, saveSyncConfig, resetSync, testSync,
    pullApi, pullFile, loadSample, pickOne, pickAll, applySync,
  };
})();
