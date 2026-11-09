// ============================================================
// code_master.js — 코드 관리 (원료·제품 코드 마스터 발행/수정)
//   여기서 발행되는 코드가 플랫폼 전체(입고·재고·분석·규격·배합비)의 기준.
//   저장: 메인 DB(rm_materials/rm_products) + 실험실(lab_materials/lab_products) 동시 반영,
//   sync.js 동기화 대상이라 모든 단말에 전파됨.
// ============================================================

const CodeMasterPage = (() => {
  let viewKind = 'raw';        // 'raw' | 'prod'  — 아래 조회 목록(브라우즈) 대상
  let issueKind = 'raw';       // 'raw' | 'prod'  — 신규 발행 대상(목록과 독립)
  let query = '';
  const ROW_CAP = 100;

  const kLabel = () => viewKind === 'raw' ? '원료' : '제품';
  const iLabel = () => issueKind === 'raw' ? '원료' : '제품';
  const canIssue = () => (typeof Auth === 'undefined' || !Auth.canIssueCode) ? true : Auth.canIssueCode();

  // 단미사료의 범위 (사료 등의 기준 및 규격 / 사료공정서 분류번호 100~730) — 대분류 → 중분류
  const FEED_TAXONOMY = {
    '식물성': ['곡물류', '강피류', '식물성단백질류', '근괴류', '식품가공류', '조류', '섬유질류', '식물성유지류', '전분류'],
    '동물성': ['동물성단백질류', '동물성무기물류', '동물성유지류'],
    '광물성': ['식염류', '인산염류 및 칼슘염류', '다량 광물질류', '미량 광물질류', '혼합 광물질'],
    '기타·보조사료': ['기타 유지류', '단세포단백질', '대용유', '결착제', '유화제', '보존제', '아미노산제', '비타민제', '효소제', '생균제', '향미제', '비단백태질소화합물', '규산염제', '완충제', '착색제', '추출제', '올리고당'],
  };
  const FEED_MAJORS = Object.keys(FEED_TAXONOMY);
  const feedMajorOf = (sub) => FEED_MAJORS.find(mj => FEED_TAXONOMY[mj].includes(sub)) || '';

  // ── 목록 데이터 ──
  const listData = () => {
    const list = viewKind === 'raw' ? DB.getMaterials() : DB.getProducts();
    const lq = query.toLowerCase().trim();
    let rows = list;
    if (lq) rows = list.filter(m =>
      m.code.toLowerCase().includes(lq) ||
      (m.name || '').toLowerCase().includes(lq) ||
      String(m.formulaCode || '').includes(lq) ||
      (m.category || '').toLowerCase().includes(lq));
    return rows.slice().sort((a, b) => a.code.localeCompare(b.code));
  };

  // 추천 코드: 입력 접두어(있으면) 범위 내 숫자 최대값 + 1
  const suggestCode = () => {
    const prefixEl = document.getElementById('cm-code');
    const prefix = (prefixEl ? prefixEl.value : '').trim();
    const list = issueKind === 'raw' ? DB.getMaterials() : DB.getProducts();
    const nums = list.map(m => m.code).filter(c => /^\d+$/.test(c) && (!prefix || c.startsWith(prefix))).map(Number);
    if (!nums.length) { App.toast(prefix ? `'${prefix}'로 시작하는 코드가 없습니다` : '숫자 코드가 없습니다', 'warning'); return; }
    const next = String(Math.max(...nums) + 1);
    if (prefixEl) prefixEl.value = next;
    App.toast(`추천 코드: ${next} (${prefix ? `'${prefix}' 대역` : '전체'} 최대값 + 1)`, 'info');
  };

  // ── 화면 ──
  const render = () => {
    const rawCnt = DB.getMaterials().length;
    const prodCnt = DB.getProducts().length;
    const all = listData();
    const rows = all.slice(0, ROW_CAP);
    const cats = [...new Set(DB.getMaterials().map(m => m.category).filter(Boolean))].sort();
    // 주공급처: 협력사 마스터에서 연동(등록된 협력사만 선택)
    const supOpts = (DB.getSuppliers ? DB.getSuppliers() : [])
      .slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .map(s => `<option value="${esc(s.name)}">${esc(s.code || '')} ${esc(s.name)}</option>`).join('');

    const addForm = issueKind === 'raw' ? `
      <div class="form-group" style="margin:0;min-width:150px">
        <label class="form-label">원료코드 <span style="color:#e05252">*</span></label>
        <div style="display:flex;gap:6px">
          <input type="text" class="form-input form-input-sm mono" id="cm-code" placeholder="예: 4401000">
          <button class="btn btn-ghost btn-sm" onclick="CodeMasterPage.suggest()" title="접두어 입력 후 누르면 해당 대역 다음 번호">추천</button>
        </div>
      </div>
      <div class="form-group" style="margin:0;flex:1;min-width:180px"><label class="form-label">원료명 <span style="color:#e05252">*</span></label><input type="text" class="form-input form-input-sm" id="cm-name" placeholder="예: 옥수수(브라질)"></div>
      <div class="form-group" style="margin:0;min-width:120px">
        <label class="form-label">대분류 <span class="text-muted" style="font-weight:400;font-size:10px">단미사료 범위</span></label>
        <select class="form-input form-input-sm" id="cm-cat-major" onchange="CodeMasterPage.onMajorChange()">
          <option value="">선택</option>
          ${FEED_MAJORS.map(mj => `<option value="${esc(mj)}">${esc(mj)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin:0;min-width:150px">
        <label class="form-label">중분류</label>
        <select class="form-input form-input-sm" id="cm-category"><option value="">대분류 먼저 선택</option></select>
      </div>
      <div class="form-group" style="margin:0;width:90px"><label class="form-label">단위</label><input type="text" class="form-input form-input-sm" id="cm-unit" value="kg"></div>
      <div class="form-group" style="margin:0;min-width:150px">
        <label class="form-label">주공급처 <span class="text-muted" style="font-weight:400;font-size:10px">협력사 연동</span></label>
        <input type="text" class="form-input form-input-sm" id="cm-supplier" list="cm-suppliers" placeholder="협력사 검색·선택">
        <datalist id="cm-suppliers">${supOpts}</datalist>
      </div>`
    : `
      <div class="form-group" style="margin:0;min-width:150px">
        <label class="form-label">제품코드 <span style="color:#e05252">*</span></label>
        <div style="display:flex;gap:6px">
          <input type="text" class="form-input form-input-sm mono" id="cm-code" placeholder="예: 1002900">
          <button class="btn btn-ghost btn-sm" onclick="CodeMasterPage.suggest()" title="접두어 입력 후 누르면 해당 대역 다음 번호">추천</button>
        </div>
      </div>
      <div class="form-group" style="margin:0;flex:1;min-width:200px"><label class="form-label">제품명 <span style="color:#e05252">*</span></label><input type="text" class="form-input form-input-sm" id="cm-name" placeholder="예: 슈퍼50 육용종계란전기-KG"></div>
      <div class="form-group" style="margin:0;min-width:120px"><label class="form-label">배합코드</label><input type="text" class="form-input form-input-sm mono" id="cm-formula" placeholder="예: 5993"></div>`;

    const head = viewKind === 'raw'
      ? '<th>코드</th><th>원료명</th><th>분류</th><th>단위</th><th>주공급처</th>' + (QR_ON ? '<th>QR값</th>' : '') + '<th>상태</th><th style="text-align:right">작업</th>'
      : '<th>코드</th><th>제품명</th><th>배합코드</th><th>축종</th>' + (QR_ON ? '<th>QR값</th>' : '') + '<th>상태</th><th style="text-align:right">작업</th>';

    const body = rows.length ? rows.map(m => {
      const common = `
        <td>${m.active !== false ? '<span class="verdict verdict-ok">사용</span>' : '<span class="text-muted">중지</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-xs" onclick="CodeMasterPage.edit('${esc(m.code)}')">수정</button>
          <button class="btn btn-ghost btn-xs" onclick="CodeMasterPage.toggle('${esc(m.code)}')">${m.active !== false ? '중지' : '사용'}</button>
        </td>`;
      return viewKind === 'raw' ? `
      <tr class="${m.active !== false ? '' : 'row-dim'}">
        <td class="mono">${esc(m.code)}</td>
        <td>${esc(m.name)}</td>
        <td class="text-muted">${esc(m.category || '-')}</td>
        <td class="text-muted">${esc(m.unit || 'kg')}</td>
        <td class="text-muted ellipsis" style="max-width:130px">${esc(m.supplier || '-')}</td>
        <td class="mono text-muted qr-only" style="font-size:11px">${esc(m.qrCode || '')}</td>
        ${common}
      </tr>` : `
      <tr class="${m.active !== false ? '' : 'row-dim'}">
        <td class="mono">${esc(m.code)}</td>
        <td>${esc(m.name)}</td>
        <td class="mono text-muted">${esc(m.formulaCode || '-')}</td>
        <td class="text-muted">${esc(LabDB.productCategory(m.code))}</td>
        <td class="mono text-muted qr-only" style="font-size:11px">${esc(m.qrCode || '')}</td>
        ${common}
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="text-muted" style="text-align:center;padding:24px">${query ? '검색 결과가 없습니다' : '코드가 없습니다'}</td></tr>`;

    const capNote = all.length > ROW_CAP
      ? `<div class="text-muted" style="font-size:12px;margin-top:8px">※ ${all.length}개 중 상위 ${ROW_CAP}개만 표시 — <b>검색</b>으로 대상을 좁히세요.</div>` : '';

    const issueCard = canIssue() ? `
    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div class="card-title">신규 코드 발행</div>
        <span class="text-muted" style="font-size:12px">발행 즉시 입고·분석·규격·배합비 전 화면과 모든 단말에 반영됩니다</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
        <span class="text-muted" style="font-size:12px">발행 대상</span>
        <button class="btn btn-sm ${issueKind === 'raw' ? 'btn-primary' : 'btn-ghost'}" onclick="CodeMasterPage.setIssueKind('raw')">원료</button>
        <button class="btn btn-sm ${issueKind === 'prod' ? 'btn-primary' : 'btn-ghost'}" onclick="CodeMasterPage.setIssueKind('prod')">제품</button>
        <span class="text-muted" style="font-size:11px;margin-left:6px">· 아래 조회 목록과 독립적으로 선택합니다</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        ${addForm}
        <button class="btn btn-primary btn-sm" onclick="CodeMasterPage.add()">${iLabel()}코드 발행</button>
      </div>
    </div>` : `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:13px">
        코드 발행 권한이 없습니다 — 코드 발행은 <b>마스터</b> 또는 <b>권한을 부여받은 사용자</b>만 가능합니다. (코드 조회·검색은 자유롭게 가능)
      </div>
    </div>`;

    return `
    ${issueCard}

    <div class="card">
      <div class="card-head">
        <div class="card-title">코드 마스터 <span class="text-muted" style="font-weight:400">원료 ${rawCnt}종 · 제품 ${prodCnt}종</span></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:12px">
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm ${viewKind === 'raw' ? 'btn-primary' : 'btn-ghost'}" onclick="CodeMasterPage.setKind('raw')">원료 (${rawCnt})</button>
          <button class="btn btn-sm ${viewKind === 'prod' ? 'btn-primary' : 'btn-ghost'}" onclick="CodeMasterPage.setKind('prod')">제품 (${prodCnt})</button>
        </div>
        <div class="form-group" style="margin:0;flex:1;min-width:220px">
          <label class="form-label">검색 (코드·명칭·분류·배합코드)</label>
          <input type="text" class="form-input form-input-sm" id="cm-search" value="${esc(query)}" placeholder="예: 4401, 옥수수" oninput="CodeMasterPage.onSearch(this.value)">
        </div>
        <span class="text-muted" style="font-size:12px">조회 <b id="cm-count">${all.length}</b>건</span>
      </div>
      <div class="table-wrap" style="max-height:min(760px,calc(100vh - 420px));overflow:auto" id="cm-table-wrap">
        <table class="data-table compact" id="cm-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      ${capNote}
      <div class="text-muted" style="font-size:12px;margin-top:10px;line-height:1.6">
        · 코드는 발행 후 변경할 수 없습니다(명칭·분류 등만 수정 가능). 잘못 발행한 코드는 <b>중지</b>로 전환하세요.<br>
        ${QR_ON ? '· QR값(WS-MAT-코드 / WS-PROD-코드)은 발행 시 자동 생성되며 QR 스캔·라벨 출력에 그대로 사용됩니다.' : ''}
      </div>
    </div>`;
  };

  // ── 목록 부분 갱신 (검색 타이핑 시 포커스 유지) ──
  let searchTimer = null;
  const onSearch = (v) => {
    query = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { App.refreshPage(); const el = document.getElementById('cm-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 300);
  };
  const setKind = (k) => { if (viewKind !== k) { viewKind = k; query = ''; App.refreshPage(); } };

  // ── 발행 ──
  const setIssueKind = (k) => { if (issueKind !== k) { issueKind = k; App.refreshPage(); } };
  // 대분류 선택 시 중분류(단미사료 범위) 옵션 채우기
  const onMajorChange = () => {
    const mj = document.getElementById('cm-cat-major')?.value || '';
    const sel = document.getElementById('cm-category');
    if (!sel) return;
    const subs = FEED_TAXONOMY[mj] || [];
    sel.innerHTML = subs.length
      ? '<option value="">선택</option>' + subs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
      : '<option value="">대분류 먼저 선택</option>';
  };
  const add = () => {
    if (!canIssue()) { App.toast('코드 발행 권한이 없습니다 — 마스터에게 권한을 요청하세요', 'error'); return; }
    const code = (document.getElementById('cm-code')?.value || '').trim();
    const name = (document.getElementById('cm-name')?.value || '').trim();
    if (!code) { App.toast('코드를 입력하세요', 'warning'); return; }
    if (!/^[A-Za-z0-9-]+$/.test(code)) { App.toast('코드는 숫자·영문·하이픈만 사용할 수 있습니다', 'warning'); return; }
    if (!name) { App.toast(`${iLabel()}명을 입력하세요`, 'warning'); return; }
    try {
      if (issueKind === 'raw') {
        const item = DB.addMaterial({
          code, name,
          category: (document.getElementById('cm-category')?.value || '').trim(),
          unit: (document.getElementById('cm-unit')?.value || 'kg').trim() || 'kg',
          supplier: (document.getElementById('cm-supplier')?.value || '').trim(),
        });
        LabDB.upsertMasterCode('raw', item);
      } else {
        const item = DB.addProduct({
          code, name,
          formulaCode: (document.getElementById('cm-formula')?.value || '').trim(),
        });
        LabDB.upsertMasterCode('prod', item);
      }
      App.toast(`${iLabel()}코드 발행 완료: ${code} · ${name}`, 'success');
      viewKind = issueKind;   // 발행 결과를 아래 목록에서 바로 확인
      query = code;
      App.refreshPage();
      App.updateBadges && App.updateBadges();
    } catch (e) { App.toast(e.message, 'error'); }
  };

  // ── 수정 모달 ──
  const ensureStyle = () => {
    if (document.getElementById('cmed-style')) return;
    const st = document.createElement('style');
    st.id = 'cmed-style';
    st.textContent = `
      .cmed-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;}
      .cmed-box{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;width:min(560px,94vw);padding:20px;box-shadow:0 16px 48px rgba(0,0,0,.5);}
      .cmed-fld{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;}
      .cmed-fld label{font-size:11.5px;color:var(--text-muted);}
      .cmed-fld input{padding:7px 10px;font-size:13px;background:var(--bg-input,transparent);border:1px solid var(--border);border-radius:7px;color:var(--text);}`;
    document.head.appendChild(st);
  };
  const closeEdit = () => { document.getElementById('cmed-overlay')?.remove(); };
  const edit = (code) => {
    const m = viewKind === 'raw' ? DB.getMaterialByCode(code) : DB.getProductByCode(code);
    if (!m) { App.toast('코드를 찾을 수 없습니다', 'error'); return; }
    ensureStyle(); closeEdit();
    const fields = viewKind === 'raw' ? `
      <div class="cmed-fld"><label>원료명</label><input id="cmed-name" value="${esc(m.name)}"></div>
      <div style="display:flex;gap:10px">
        <div class="cmed-fld" style="flex:1"><label>분류</label><input id="cmed-category" value="${esc(m.category || '')}"></div>
        <div class="cmed-fld" style="width:90px"><label>단위</label><input id="cmed-unit" value="${esc(m.unit || 'kg')}"></div>
      </div>
      <div class="cmed-fld"><label>주공급처</label><input id="cmed-supplier" value="${esc(m.supplier || '')}"></div>`
    : `
      <div class="cmed-fld"><label>제품명</label><input id="cmed-name" value="${esc(m.name)}"></div>
      <div class="cmed-fld" style="width:160px"><label>배합코드</label><input id="cmed-formula" value="${esc(m.formulaCode || '')}"></div>`;
    const hist = (m.editHistory || []).slice().reverse();
    const histHtml = hist.length ? `
      <div style="font-size:12px;font-weight:700;margin:12px 0 6px">수정 이력 (${hist.length}회)</div>
      <div style="max-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:6px 10px">
        ${hist.map(h => `<div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border)">
          <span class="text-muted">${esc(String(h.ts || '').slice(0, 16).replace('T', ' '))}${h.by ? ' · ' + esc(h.by) : ''}</span>
          ${h.reason ? `<span style="color:#ffb020"> · 사유: ${esc(h.reason)}</span>` : ''}<br>
          ${(h.changes || []).map(c => `${esc(c.label)}: <span style="color:#ff8fa3;text-decoration:line-through">${esc(String(c.from))}</span> → <span style="color:#48c78e;font-weight:700">${esc(String(c.to))}</span>`).join(' · ')}
        </div>`).join('')}
      </div>` : '';
    const ov = document.createElement('div');
    ov.className = 'cmed-overlay'; ov.id = 'cmed-overlay';
    ov.innerHTML = `
      <div class="cmed-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div><b>${kLabel()}코드 수정</b> <span class="mono text-muted" style="font-size:12px">${esc(m.code)}</span></div>
          <button class="btn btn-ghost btn-xs" onclick="CodeMasterPage.closeEdit()">✕</button>
        </div>
        ${fields}
        <div style="display:flex;gap:10px">
          <div class="cmed-fld" style="width:130px"><label>수정자 <span style="color:#e05252">*</span></label><input id="cmed-by" placeholder="담당자명"></div>
          <div class="cmed-fld" style="flex:1"><label>수정사유 <span style="color:#e05252">*</span></label><input id="cmed-reason" placeholder="예: 제품명 변경, 배합코드 정정"></div>
        </div>
        <div class="text-muted" style="font-size:11.5px;margin:4px 0 12px">코드 자체는 변경할 수 없습니다.${QR_ON ? ` QR값: <span class="mono">${esc(m.qrCode || '')}</span>` : ''}</div>
        ${histHtml}
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-ghost btn-sm" onclick="CodeMasterPage.closeEdit()">취소</button>
          <button class="btn btn-primary btn-sm" onclick="CodeMasterPage.saveEdit('${esc(m.code)}')">저장 (이력 기록)</button>
        </div>
      </div>`;
    ov.addEventListener('click', (e) => { if (e.target === ov) closeEdit(); });
    document.body.appendChild(ov);
  };
  const saveEdit = (code) => {
    const g = (id) => (document.getElementById(id)?.value || '').trim();
    const name = g('cmed-name');
    if (!name) { App.toast('명칭을 입력하세요', 'warning'); return; }
    const by = g('cmed-by'), reason = g('cmed-reason');
    if (!by) { App.toast('수정자를 입력하세요', 'warning'); document.getElementById('cmed-by')?.focus(); return; }
    if (!reason) { App.toast('수정사유를 입력하세요 — 이력 관리를 위해 필수입니다', 'warning'); document.getElementById('cmed-reason')?.focus(); return; }
    const before = viewKind === 'raw' ? DB.getMaterialByCode(code) : DB.getProductByCode(code);
    const patch = viewKind === 'raw'
      ? { name, category: g('cmed-category'), unit: g('cmed-unit') || 'kg', supplier: g('cmed-supplier') }
      : { name, formulaCode: g('cmed-formula') };
    // 변경 필드 diff → 이력 항목
    const LABELS = viewKind === 'raw'
      ? { name: '원료명', category: '분류', unit: '단위', supplier: '주공급처' }
      : { name: '제품명', formulaCode: '배합코드' };
    const changes = Object.keys(LABELS)
      .filter(f => String(before[f] || '') !== String(patch[f] || ''))
      .map(f => ({ field: f, label: LABELS[f], from: before[f] || '', to: patch[f] || '' }));
    if (!changes.length) { closeEdit(); App.toast('변경사항이 없습니다', 'info'); return; }
    patch.editHistory = (before.editHistory || []).concat([{ ts: DB.now(), by, reason, changes }]);
    const updated = viewKind === 'raw' ? DB.updateMaterialByCode(code, patch) : DB.updateProductByCode(code, patch);
    if (updated) LabDB.upsertMasterCode(viewKind, updated);
    closeEdit();
    App.toast('수정되었습니다 · 사유·이력 기록됨 — 전 화면에 반영', 'success');
    App.refreshPage();
  };
  const toggle = (code) => {
    const m = viewKind === 'raw' ? DB.getMaterialByCode(code) : DB.getProductByCode(code);
    if (!m) return;
    const next = !(m.active !== false);
    const reason = (prompt(`${m.code} · ${m.name}\n${next ? '사용 재개' : '사용 중지'} 사유를 입력하세요 (이력에 기록됩니다)`) || '').trim();
    if (!reason) { App.toast('사유가 입력되지 않아 취소되었습니다', 'info'); return; }
    const hist = (m.editHistory || []).concat([{
      ts: DB.now(), by: '', reason,
      changes: [{ field: 'active', label: '상태', from: next ? '중지' : '사용', to: next ? '사용' : '중지' }],
    }]);
    if (viewKind === 'raw') DB.updateMaterialByCode(code, { active: next, editHistory: hist });
    else DB.updateProductByCode(code, { active: next, editHistory: hist });
    App.toast(`${next ? '사용 재개' : '중지'} 처리 · 이력 기록됨`, 'success');
    App.refreshPage();
  };

  return { render, setKind, setIssueKind, onMajorChange, onSearch, add, suggest: suggestCode, edit, saveEdit, closeEdit, toggle };
})();
