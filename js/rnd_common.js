// ============================================================
// rnd_common.js — 연구관리 화면 공통 부품
//
//   연구관리 7개 화면은 "목록 → 카드 → 모달 폼 → 첨부" 구조가 똑같다.
//   화면마다 따로 짜면 첨부 동작이 화면별로 달라지므로(업로드 잠금, 삭제,
//   문서/이미지 구분) 여기 한 곳에 두고 전 화면이 같은 것을 쓴다.
//
//   RndUI.attachBox(bucketName)  — 첨부 위젯 마크업
//   RndUI.onPick(bucketName, input) — 파일 선택 처리 (모든 화면 공용 핸들러)
//   RndUI.bucket(name)           — 모달이 열려 있는 동안 첨부를 담아두는 임시 배열
// ============================================================

const RndUI = (() => {
  const MAX_FILES = 12;

  const esc = (v) => String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  // 줄바꿈을 살려서 보여준다. 연구노트 본문은 문단이 의미를 가진다.
  const nl2br = (v) => esc(v).replaceAll('\n', '<br>');

  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const facName = (id) => (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(id) : (id || '-');
  const facList = () => (typeof DB !== 'undefined' && DB.getFactories) ? DB.getFactories() : [{ id: 'HQ', name: '본사' }];
  // 공장 필터가 '전체' 일 때 새 기록의 소속은 본사로 둔다(무소속 레코드를 만들지 않는다)
  const defaultFactory = () => { const f = fac(); return f === 'ALL' ? 'HQ' : f; };

  // 작성자는 직접 입력받지 않는다 — 로그인 계정에서 가져온다
  const actorName = () => {
    try { return (typeof Auth !== 'undefined' && Auth.currentName()) || '연구개발팀'; } catch (_) { return '연구개발팀'; }
  };
  const actorEmail = () => {
    try { return (typeof Auth !== 'undefined' && Auth.currentEmail()) || ''; } catch (_) { return ''; }
  };

  const badge = (map, key) => {
    const m = (map && map[key]) || { label: key || '-', cls: 'badge-default' };
    return `<span class="badge ${m.cls || 'badge-default'}">${esc(m.label)}</span>`;
  };
  const label = (map, key) => ((map && map[key]) || {}).label || key || '-';

  const dateOnly = (v) => String(v || '').slice(0, 10);
  const dday = (due) => {
    if (!due) return null;
    const d = Math.round((new Date(due) - new Date(RndDB.todayStr())) / 86400000);
    return d;
  };
  const ddayText = (due) => {
    const d = dday(due);
    if (d === null) return '';
    if (d < 0) return `<span class="rnd-dday over">D+${-d}</span>`;
    if (d === 0) return '<span class="rnd-dday soon">D-DAY</span>';
    return `<span class="rnd-dday${d <= 14 ? ' soon' : ''}">D-${d}</span>`;
  };

  const emptyState = (title, hint) => `
    <div class="empty-state">
      <h3>${esc(title)}</h3>
      <p>${esc(hint || '')}</p>
    </div>`;

  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const num = (id) => Number(document.getElementById(id)?.value) || 0;
  const checked = (id) => !!document.getElementById(id)?.checked;

  const options = (map, sel) => Object.entries(map)
    .map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');

  const factoryOptions = (sel) => facList()
    .map(f => `<option value="${f.id}" ${sel === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('');

  const projectOptions = (sel, includeBlank = true) => {
    const list = RndDB.getActiveProjects(fac());
    // 이미 닫힌 과제에 달린 기록을 수정할 때 선택값이 사라지면 안 된다
    if (sel && !list.some(p => p.id === sel)) {
      const p = RndDB.getProjectById(sel);
      if (p) list.unshift(p);
    }
    return (includeBlank ? '<option value="">— 과제 미연결 —</option>' : '')
      + list.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('');
  };
  const projectLabel = (id) => {
    if (!id) return '';
    const p = RndDB.getProjectById(id);
    return p ? `${p.code} · ${p.name}` : '(삭제된 과제)';
  };

  // ============================================================
  // 첨부파일 — 전 화면 공용
  //   모달이 열려 있는 동안만 buckets 에 쌓았다가 저장 시 레코드로 옮긴다.
  // ============================================================
  const buckets = {};
  const bucket = (name) => (buckets[name] = buckets[name] || []);
  const resetBucket = (name, initial) => {
    const b = bucket(name);
    b.length = 0;                          // 재대입 금지 — 업로드 루프가 참조를 잡고 있다
    (initial || []).forEach(x => b.push(x));
    return b;
  };

  let uploading = 0;
  const setBusy = (on) => {
    uploading += on ? 1 : -1;
    if (uploading < 0) uploading = 0;
    document.querySelectorAll('[data-upload-lock]').forEach(el => { el.disabled = uploading > 0; });
  };

  const onPick = async (name, input) => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    const b = bucket(name);
    setBusy(true);
    App.toast(`첨부 ${files.length}건을 저장하는 중입니다`, 'info');
    try {
      for (const f of files) {
        if (b.length >= MAX_FILES) { App.toast(`첨부는 최대 ${MAX_FILES}건까지 가능합니다`, 'warning'); break; }
        try {
          const meta = await PhotoStore.save(f, { kind: 'RND', by: actorName() });
          if (meta) b.push(meta);
        } catch (e) { App.toast(e.message || '첨부 저장에 실패했습니다', 'error'); }
        renderBucket(name);
      }
    } finally { setBusy(false); }
  };

  const removeFile = async (name, i) => {
    const b = bucket(name);
    const p = b[i];
    b.splice(i, 1);
    renderBucket(name);
    await PhotoStore.remove(p);
  };

  const extOf = (p) => String(p?.name || '').split('.').pop().toUpperCase().slice(0, 4) || 'FILE';

  const renderBucket = (name) => {
    const el = document.getElementById('rnd-files-' + name);
    if (!el) return;
    const b = bucket(name);
    el.innerHTML = b.length ? b.map((p, i) => `
      <div class="rnd-thumb" title="${esc(p.name || '')}">
        ${p.doc ? `<div class="rnd-thumb-doc">${esc(extOf(p))}</div>`
                : `<img src="${PhotoStore.thumbOf(p)}" alt="${esc(p.name || '')}">`}
        <button type="button" class="rnd-thumb-x" onclick="RndUI.removeFile('${name}', ${i})" title="삭제">✕</button>
      </div>`).join('') : '<span class="rnd-files-empty">첨부 없음</span>';
  };

  // 모달 안에 넣는 첨부 위젯
  const attachBox = (name, hint) => `
    <div class="form-group">
      <label class="form-label">첨부파일</label>
      <div class="rnd-files" id="rnd-files-${name}"><span class="rnd-files-empty">첨부 없음</span></div>
      <label class="btn btn-sm rnd-file-btn" data-upload-lock>
        파일 추가
        <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.hwp"
               style="display:none" onchange="RndUI.onPick('${name}', this)">
      </label>
      <div class="form-hint">${esc(hint || '실험 사진·성적서·문헌·엑셀 원본 등. 이미지는 자동 축소되고 문서는 원본으로 보관됩니다.')}
        ${PhotoStore.serverOn() ? '' : ' (동기화 서버가 꺼져 있어 원본은 이 기기에만 남습니다)'}</div>
    </div>`;

  // 저장된 레코드의 첨부 목록 — 카드/상세에서 클릭하면 뷰어가 열린다
  const fileStrip = (files, opts = {}) => {
    const list = PhotoStore.normalize(files || []);
    if (!list.length) return opts.hideEmpty ? '' : '<span class="rnd-files-empty">첨부 없음</span>';
    return `<div class="rnd-files view">${list.map((p, i) => `
      <div class="rnd-thumb" title="${esc(p.name || '')}" onclick="RndUI.viewFiles(this)"
           data-files='${esc(JSON.stringify(list))}' data-idx="${i}">
        ${p.doc ? `<div class="rnd-thumb-doc">${esc(extOf(p))}</div>`
                : `<img src="${PhotoStore.thumbOf(p)}" alt="${esc(p.name || '')}">`}
      </div>`).join('')}</div>`;
  };

  const viewFiles = (el) => {
    try {
      const list = JSON.parse(el.dataset.files || '[]');
      // 세 번째 인자는 kind → 라벨 맵이다(함수가 아니다). 첨부는 모두 kind:'RND' 로 저장한다.
      PhotoStore.openViewer(list, Number(el.dataset.idx) || 0, { RND: '연구관리 첨부' });
    } catch (e) { App.toast('첨부를 열 수 없습니다', 'error'); }
  };

  const fileCount = (files) => (Array.isArray(files) ? files.length : 0);
  const fileChip = (files) => {
    const n = fileCount(files);
    return n ? `<span class="rnd-chip">첨부 ${n}</span>` : '';
  };

  // ============================================================
  // 목록 툴바 — 검색 + 상태 필터. 화면마다 같은 모양이라 공통으로 뺐다.
  // ============================================================
  const toolbar = (id, opts) => `
    <div class="rnd-toolbar">
      <input type="text" class="form-input rnd-search" id="${id}-q" placeholder="${esc(opts.placeholder || '검색')}"
             value="${esc(opts.q || '')}" oninput="${opts.onSearch}(this.value)">
      ${opts.filters ? opts.filters : ''}
      <div class="rnd-toolbar-right">
        ${opts.extra || ''}
        <button class="btn btn-primary btn-sm" onclick="${opts.onAdd}">＋ ${esc(opts.addLabel || '등록')}</button>
      </div>
    </div>`;

  const selectFilter = (id, map, sel, onChange, allLabel) => `
    <select class="form-input rnd-filter" id="${id}" onchange="${onChange}(this.value)">
      <option value="">${esc(allLabel || '전체')}</option>
      ${Object.entries(map).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
    </select>`;

  const matches = (q, ...vals) => {
    const lq = String(q || '').trim().toLowerCase();
    if (!lq) return true;
    return vals.some(v => String(v || '').toLowerCase().includes(lq));
  };

  const confirmDelete = (what) => confirm(`${what}을(를) 삭제합니다. 되돌릴 수 없습니다.\n계속할까요?`);

  return {
    esc, nl2br, fac, facName, facList, defaultFactory, actorName, actorEmail,
    badge, label, dateOnly, dday, ddayText, emptyState,
    openModal, closeModal, val, num, checked, options, factoryOptions,
    projectOptions, projectLabel,
    bucket, resetBucket, onPick, removeFile, renderBucket, attachBox,
    fileStrip, viewFiles, fileCount, fileChip,
    toolbar, selectFilter, matches, confirmDelete,
  };
})();
