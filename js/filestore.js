// ============================================================
// filestore.js — 첨부파일 바이너리 저장소 (IndexedDB)
//   HACCP 문서 등에 첨부하는 PDF·docx·xlsx 원본 파일을 저장.
//   용량이 큰 파일을 다루므로 localStorage(문자열 5~10MB) 대신 IndexedDB 사용.
//   ※ 파일 바이너리는 기기 로컬에 보관(동기화 대상 아님). 문서에는 첨부 메타만 저장·동기화.
// ============================================================

const FileStore = (() => {
  const DB_NAME = 'ws-files';
  const STORE = 'files';
  const VERSION = 1;
  let dbp = null;

  const available = () => (typeof indexedDB !== 'undefined');

  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  };

  // id 로 파일(Blob) 저장
  const put = async (id, blob, meta) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, blob, meta: meta || {} });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  };

  // id 로 파일 레코드 조회({ id, blob, meta }) — 없으면 null
  const get = async (id) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  };

  const del = async (id) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  };

  const has = async (id) => { try { return !!(await get(id)); } catch (_) { return false; } };

  return { available, put, get, del, has };
})();
