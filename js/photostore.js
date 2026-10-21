// ============================================================
// photostore.js — 현장 사진 저장소 (VOC·일지 공용)
//
//   사진을 레코드에 data URI 로 그대로 넣으면 안 된다.
//   실측: 1100px/q0.7 한 장이 약 66KB → 6장이면 400KB.
//   레코드는 localStorage 에 들어가고 동기화 페이로드로도 나가므로
//   몇 건만 쌓여도 저장 한도(5~10MB)와 push/pull 이 함께 무너진다.
//
//   그래서 3단 구조로 나눈다.
//     · 원본(뷰용 1600px)  → 서버 data/files (모든 단말 공유) · 서버 없으면 IndexedDB(로컬)
//     · 썸네일(220px, 3KB) → 레코드에 저장. 목록·카드는 이것만 그린다
//     · 레코드에는 {id, thumb, name, ...} 메타만 → 동기화 부담 최소
//
//   서버가 있으면 어느 기기에서 찍어도 다른 단말에서 원본이 보인다.
//   서버가 없으면(정적 열람) 원본은 찍은 기기에만 남고 썸네일만 공유된다.
// ============================================================

const PhotoStore = (() => {
  const VIEW_MAX = 1600;      // 원본(뷰용) 최대 변
  const VIEW_Q   = 0.72;
  const THUMB_MAX = 220;      // 썸네일 최대 변
  const THUMB_Q  = 0.6;
  const MAX_INPUT_BYTES = 12 * 1024 * 1024;   // 이미지 입력 상한(어차피 축소되므로 넉넉히)
  const MAX_DOC_BYTES   = 8 * 1024 * 1024;    // 문서 상한 — 서버 MAX_FILE_BYTES 와 같아야 한다
                                              // (넘기면 업로드가 400 으로 떨어져 이 기기에만 남는다)

  const uid = () => 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ── 서버 사용 가능 여부 ──
  //   동기화(Sync) 와 무관하게 스스로 /api/health 를 한 번 확인한다.
  //   동기화가 꺼져 있어도 사진은 서버에 올려 모든 단말에서 볼 수 있어야 하기 때문.
  let _srv = null;         // null=미확인, true/false=확인됨
  const probe = async () => {
    if (_srv !== null) return _srv;
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      _srv = !!(j && j.ok && j.files);      // files:true 인 서버만 업로드 지원
    } catch (_) { _srv = false; }
    return _srv;
  };
  const serverOn = () => _srv === true;
  // 화면이 뜨자마자 안내 문구를 정확히 쓰려면 미리 확인해 둔다
  if (typeof window !== 'undefined') { try { probe(); } catch (_) {} }

  // ── 이미지 축소 ──
  const loadImage = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = (e) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = e.target.result; };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const toDataUrl = (img, maxDim, q) => {
    let { width, height } = img;
    if (Math.max(width, height) > maxDim) {
      const k = maxDim / Math.max(width, height);
      width = Math.round(width * k); height = Math.round(height * k);
    }
    const cv = document.createElement('canvas');
    cv.width = width; cv.height = height;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);   // 투명 PNG → 검은 배경 방지
    ctx.drawImage(img, 0, 0, width, height);
    return cv.toDataURL('image/jpeg', q);
  };
  const b64of = (dataUrl) => String(dataUrl).split(',')[1] || '';
  const bytesOf = (dataUrl) => Math.round(b64of(dataUrl).length * 3 / 4);

  // ── 원본 저장 ──
  const putServer = async (id, dataUrl) => {
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, mime: 'image/jpeg', data: b64of(dataUrl) }),
    });
    if (!res.ok) throw new Error('upload failed ' + res.status);
    return res.json();
  };
  const putLocal = async (id, dataUrl) => {
    if (typeof FileStore === 'undefined' || !FileStore.available()) throw new Error('no local store');
    const blob = await (await fetch(dataUrl)).blob();
    await FileStore.put(id, blob, { name: id + '.jpg', type: 'image/jpeg' });
  };

  // 확장자 → MIME. 브라우저가 file.type 을 못 채우는 형식(.hwp 등)을 위한 보정.
  const MIME_BY_EXT = {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    hwp: 'application/haansofthwp',
    hwpx: 'application/hwp+zip',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  const extOf = (name) => String(name || '').split('.').pop().toLowerCase();

  // 이미지가 아닌 증빙(PDF·성적서 등) — 축소 없이 원본만 보관하고 썸네일은 두지 않는다
  const saveDoc = async (file, opt) => {
    if (file.size > MAX_DOC_BYTES) throw new Error(`${file.name}은 8MB를 초과합니다`);
    const id = uid();
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = (e) => res(e.target.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const mime = file.type || MIME_BY_EXT[extOf(file.name)] || 'application/octet-stream';
    let store = 'none';
    if (await probe()) {
      try {
        const res = await fetch('/api/files', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, mime, data: b64of(dataUrl) }),
        });
        if (!res.ok) throw new Error('upload failed');
        store = 'server';
      } catch (_) { try { await putLocal(id, dataUrl); store = 'local'; } catch (__) { store = 'none'; } }
    } else {
      try { await putLocal(id, dataUrl); store = 'local'; } catch (_) { store = 'none'; }
    }
    return {
      id, thumb: '', store, doc: true, mime,
      name: file.name || '첨부', bytes: file.size,
      at: new Date().toISOString(), by: opt.by || '', kind: opt.kind || 'INTAKE', note: opt.note || '',
    };
  };

  /**
   * 파일 한 건을 저장하고 레코드에 넣을 메타를 돌려준다.
   * 이미지는 뷰용 축소본 + 썸네일, 그 외(PDF 등)는 원본만.
   * @returns {Promise<object|null>} {id, thumb, name, w, h, bytes, at, by, kind, store, doc?}
   */
  const save = async (file, opt = {}) => {
    if (!file) return null;
    if (file.size > MAX_INPUT_BYTES) throw new Error(`${file.name}은 12MB를 초과합니다`);
    if (!String(file.type || '').startsWith('image/')) return saveDoc(file, opt);
    const img = await loadImage(file);
    const view = toDataUrl(img, VIEW_MAX, VIEW_Q);
    const thumb = toDataUrl(img, THUMB_MAX, THUMB_Q);
    const id = uid();

    let store = 'none';
    if (await probe()) {
      try { await putServer(id, view); store = 'server'; }
      catch (_) { try { await putLocal(id, view); store = 'local'; } catch (__) { store = 'thumb'; } }
    } else {
      try { await putLocal(id, view); store = 'local'; } catch (_) { store = 'thumb'; }
    }

    return {
      id, thumb, store,
      // 실제로 보관되는 바이트는 JPEG 로 재인코딩된 것이므로 확장자도 맞춘다.
      // (원래 이름을 그대로 두면 .png 로 내려받히는데 내용은 JPEG)
      name: (file.name || '사진').replace(/\.[^.]+$/, '') + '.jpg',
      w: img.naturalWidth, h: img.naturalHeight,
      bytes: bytesOf(view),
      at: new Date().toISOString(),
      by: opt.by || '',
      kind: opt.kind || 'INTAKE',     // INTAKE(접수) | ACTION(조치)
      note: opt.note || '',
    };
  };

  /**
   * 원본 표시용 URL. 저장 위치(store)를 그대로 믿고 만든다.
   *   존재 확인용 HEAD 요청은 하지 않는다 — 서버가 HEAD 를 처리하지 않아 항상 실패했고,
   *   불필요한 왕복이기도 하다. 실제로 없으면 <img onerror> 에서 썸네일로 떨어뜨린다.
   */
  const url = async (photo) => {
    if (!photo) return '';
    if (typeof photo === 'string') return photo;          // 구버전: data URI 그대로 저장된 사진
    if (photo._raw) return photo._raw;                    // 구버전 증빙(레코드에 data URI 보관)
    if (photo.store === 'server') return '/api/files/' + photo.id;
    if (photo.store === 'local') {
      try {
        if (typeof FileStore !== 'undefined' && FileStore.available()) {
          const rec = await FileStore.get(photo.id);
          if (rec && rec.blob) return URL.createObjectURL(rec.blob);
        }
      } catch (_) {}
    }
    return photo.thumb || '';                             // 원본이 이 기기에 없을 때
  };

  /** 목록·카드용 즉시 표시 이미지(항상 동기, 네트워크 없음) */
  const thumbOf = (photo) => (typeof photo === 'string') ? photo : (photo && photo.thumb) || '';

  // ── 다운로드 ──
  //   서버 파일·로컬(IndexedDB)·구버전 data URI 를 한 경로로 처리하려고
  //   전부 Blob 으로 받아 원래 파일명으로 내려받는다. (a[href=/api/files/id] 로는
  //   확장자만 남고 "성적서.pdf" 같은 원래 이름이 사라진다)
  const blobOf = async (photo) => {
    if (!photo) return null;
    const viaFetch = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('fetch ' + r.status); return r.blob(); };
    if (typeof photo === 'string') return viaFetch(photo);
    if (photo._raw) return viaFetch(photo._raw);
    if (photo.store === 'server') return viaFetch('/api/files/' + photo.id);
    if (photo.store === 'local') {
      if (typeof FileStore !== 'undefined' && FileStore.available()) {
        const rec = await FileStore.get(photo.id);
        if (rec && rec.blob) return rec.blob;
      }
    }
    return photo.thumb ? viaFetch(photo.thumb) : null;     // 원본이 없으면 썸네일이라도
  };
  const toast = (msg, type) => { try { App.toast(msg, type); } catch (_) {} };
  const download = async (photo) => {
    try {
      const blob = await blobOf(photo);
      if (!blob) { toast('원본 파일을 찾을 수 없습니다', 'error'); return false; }
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = (photo && photo.name) || '첨부';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
      if (photo && (photo.store === 'thumb' || photo.legacy) && !photo.doc) {
        toast('이 기기에 원본이 없어 축소본을 내려받았습니다', 'warning');
      }
      return true;
    } catch (_) {
      toast('다운로드에 실패했습니다', 'error');
      return false;
    }
  };

  const sizeText = (bytes) => {
    const n = Number(bytes) || 0;
    if (!n) return '';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
    return (n / 1024 / 1024).toFixed(1) + 'MB';
  };
  /** 파일 유형 라벨(PDF·XLSX·JPG) — 목록 칩 표기용 */
  const typeLabel = (photo) => {
    if (!photo) return '';
    const name = String(photo.name || '');
    const e = name.includes('.') ? extOf(name) : '';       // 확장자 없는 이름을 통째로 쓰지 않도록
    if (e && e.length <= 5 && /^[a-z0-9]+$/.test(e)) return e.toUpperCase();
    return photo.doc ? 'FILE' : 'IMG';
  };

  const remove = async (photo) => {
    if (!photo || typeof photo === 'string') return;
    try { if (typeof FileStore !== 'undefined' && FileStore.available()) await FileStore.del(photo.id); } catch (_) {}
    // 서버 파일은 지우지 않는다 — 다른 레코드가 참조하거나 감사 증적으로 남아야 할 수 있다.
  };

  /** 구버전 첨부를 새 메타 형태로 감싼다 — 화면 코드가 한 가지만 다루도록.
   *   · 문자열 data URI (VOC 구버전 사진)
   *   · {name, mimeType, dataUrl} (심사 지적사항 구버전 증빙) */
  const normalize = (list) => (Array.isArray(list) ? list : []).filter(Boolean).map((p, i) => {
    if (typeof p === 'string') {
      return { id: 'legacy' + i, thumb: p, store: 'thumb', name: `사진${i + 1}.jpg`, kind: 'INTAKE', legacy: true };
    }
    if (p.dataUrl && !p.id) {
      const isImg = String(p.mimeType || '').startsWith('image/');
      return {
        id: 'legacy' + i, thumb: isImg ? p.dataUrl : '', store: 'thumb', legacy: true, doc: !isImg,
        mime: p.mimeType || '', name: p.name || `첨부${i + 1}`, bytes: p.size || 0, kind: p.kind || 'ACTION',
        _raw: p.dataUrl,
      };
    }
    return p;
  });

  // ============================================================
  // 공용 뷰어(라이트박스) — VOC·심사 지적사항 등 여러 화면이 함께 쓴다
  //   photos: normalize() 를 거친 배열. PDF 등 문서는 새 탭으로 연다.
  // ============================================================
  const VIEWER_ID = 'ps-lightbox';
  let vw = { list: [], idx: 0, labels: {} };
  const closeViewer = () => {
    document.getElementById(VIEWER_ID)?.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (!document.getElementById(VIEWER_ID)) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  };
  const step = async (d) => {
    if (!vw.list.length) return;
    vw.idx = (vw.idx + d + vw.list.length) % vw.list.length;
    await paint();
  };
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const paint = async () => {
    const ov = document.getElementById(VIEWER_ID);
    if (!ov) return;
    const p = vw.list[vw.idx];
    const src = await url(p);
    const label = vw.labels[p.kind] || '';
    const body = p.doc
      ? `<div class="ps-lb-doc">
           <div style="font-size:14px;margin-bottom:10px">${esc(p.name)}</div>
           ${src ? `<div style="display:flex;gap:8px;justify-content:center">
                      <a class="btn btn-ghost btn-sm" href="${esc(src)}" target="_blank" rel="noopener">새 탭에서 열기</a>
                      <button class="btn btn-primary btn-sm" onclick="PhotoStore.downloadCurrent()">다운로드</button>
                    </div>`
                 : '<div class="text-muted" style="font-size:12px">이 기기에 원본이 없습니다</div>'}
         </div>`
      : `<img src="${esc(src)}" alt="${esc(p.name || '')}" onerror="this.onerror=null;this.src='${esc(p.thumb || '')}'">`;
    ov.innerHTML = `
      ${vw.list.length > 1 ? `<button class="ps-lb-nav ps-lb-prev" onclick="PhotoStore.step(-1)" title="이전">←</button>` : ''}
      <div class="ps-lb-body">
        ${body}
        <div class="ps-lb-cap">
          ${label ? `<span class="badge ${p.kind === 'ACTION' ? 'badge-info' : 'badge-default'}">${esc(label)}</span>` : ''}
          ${p.doc ? '' : `<span>${esc(p.name || '')}</span>`}
          ${p.by ? `<span class="text-muted">· ${esc(p.by)}</span>` : ''}
          ${p.at ? `<span class="text-muted">· ${String(p.at).replace('T', ' ').slice(0, 16)}</span>` : ''}
          ${vw.list.length > 1 ? `<span class="text-muted">· ${vw.idx + 1}/${vw.list.length}</span>` : ''}
          ${(p.store === 'thumb' || p.legacy) && !p.doc ? '<span class="text-muted">· 원본 없음(썸네일)</span>' : ''}
          ${p.doc ? '' : `<button class="ps-lb-dl" onclick="PhotoStore.downloadCurrent()" title="다운로드">다운로드</button>`}
        </div>
      </div>
      ${vw.list.length > 1 ? `<button class="ps-lb-nav ps-lb-next" onclick="PhotoStore.step(1)" title="다음">→</button>` : ''}
      <button class="ps-lb-close" onclick="PhotoStore.closeViewer()" title="닫기">✕</button>`;
  };
  /** @param photos 원본 배열(normalize 전이어도 됨) @param idx 시작 인덱스 @param labels {INTAKE:'접수', ACTION:'조치'} */
  const openViewer = async (photos, idx = 0, labels = {}) => {
    vw.list = normalize(photos);
    if (!vw.list.length) return;
    vw.idx = Math.max(0, Math.min(idx, vw.list.length - 1));
    vw.labels = labels || {};
    let ov = document.getElementById(VIEWER_ID);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = VIEWER_ID;
      ov.className = 'no-print ps-lightbox';
      ov.onclick = (e) => { if (e.target === ov) closeViewer(); };
      document.body.appendChild(ov);
      document.addEventListener('keydown', onKey);
    }
    await paint();
  };

  const downloadCurrent = () => download(vw.list[vw.idx]);

  return {
    save, url, thumbOf, remove, normalize, serverOn,
    download, downloadCurrent, sizeText, typeLabel,
    openViewer, closeViewer, step, VIEW_MAX, THUMB_MAX,
  };
})();
