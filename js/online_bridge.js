// ============================================================
// online_bridge.js — 온라인판(Supabase) 연결 계층
//   온라인판(online/build_online.py 로 만든 사본)에서만 불러온다. 사내 서버판 index.html 에는 없다.
//
//   하는 일
//   · 동기화(sync.js)가 부르는 사내 서버 주소 3개를 Supabase 함수로 바꿔 준다.
//       /api/health → sync_head   (로그인·승인된 사용자일 때만 ok)
//       /api/pull   → sync_pull   (since 이후 바뀐 레코드)
//       /api/push   → sync_push   (바뀐 레코드·삭제)
//     sync.js 는 그대로 두고 fetch 만 가로챈다 — 사내 서버판과 온라인판이 같은 동기화 규칙을 쓴다.
//   · 그 밖의 /api/* (법령·가축질병·생산실적·첨부파일 등 사내 서버 전용 기능)는 "온라인 초안 미지원"으로 돌려준다.
//   · 계정(rm_auth_users)은 동기화하지 않는다. 로그인·가입·승인은 online_auth.js 가 Supabase Auth 로 처리한다.
//
//   필요: online_config.js (window.QR_ONLINE_CONFIG = { url, anonKey }), supabase-js UMD
// ============================================================

(() => {
  const cfg = window.QR_ONLINE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase || !window.supabase.createClient) {
    console.warn('[Online] 설정(url·anonKey) 또는 supabase-js 가 없어 온라인 연결을 건너뜁니다');
    window.QR_ONLINE = { ready: false };
    return;
  }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const SKIP_KEYS = new Set(['rm_auth_users']);
  const PAGE = 1000;

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });

  // 로그인 세션이 있는지 — 화면 첫 판정(동기)용. 실제 유효성은 Supabase 호출에서 다시 확인된다.
  const hasSession = () => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        if (v && (v.access_token || (v.currentSession && v.currentSession.access_token)) && (v.refresh_token || v.currentSession)) return true;
      }
    } catch (_) {}
    return false;
  };

  const head = async () => {
    const { data: s } = await sb.auth.getSession();
    if (!s || !s.session) return null;
    const { data, error } = await sb.rpc('sync_head');
    if (error || data == null) return null;
    return Number(data) || 0;
  };

  // since 이후 바뀐 것을 쪽 단위로 끝까지 받는다
  const pullAll = async (since) => {
    const changes = {};
    const deletes = [];
    let cursor = Number(since) || 0;
    for (;;) {
      const { data, error } = await sb.rpc('sync_pull', { p_since: cursor, p_limit: PAGE });
      if (error) throw error;
      const rows = data || [];
      rows.forEach(r => {
        if (SKIP_KEYS.has(r.key)) return;
        if (r.deleted) deletes.push({ key: r.key, id: r.rec_id });
        else (changes[r.key] = changes[r.key] || []).push({ ...(r.data || {}), id: r.rec_id, _seq: Number(r.seq) });
        if (Number(r.seq) > cursor) cursor = Number(r.seq);
      });
      if (rows.length < PAGE) break;
    }
    return { changes, deletes, seq: cursor };
  };

  const push = async (body) => {
    const keys = {};
    Object.keys(body.keys || {}).forEach(k => { if (!SKIP_KEYS.has(k)) keys[k] = body.keys[k]; });
    const dels = (body.deletes || []).filter(d => d && !SKIP_KEYS.has(d.key));
    const { data, error } = await sb.rpc('sync_push', { p_keys: keys, p_deletes: dels });
    if (error) throw error;
    return { ok: true, seq: Number(data) || 0 };
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const path = url.replace(location.origin, '');
    if (!/^\/?api\//.test(path)) return origFetch(input, init);
    const p = path.replace(/^\//, '');
    try {
      if (p.startsWith('api/health')) {
        const seq = await head();
        return seq == null ? json({ ok: false, error: 'not-signed-in' }, 401) : json({ ok: true, seq, online: true });
      }
      if (p.startsWith('api/pull')) {
        const since = new URLSearchParams(p.split('?')[1] || '').get('since');
        return json(await pullAll(since));
      }
      if (p.startsWith('api/push')) {
        const body = JSON.parse((init && init.body) || '{}');
        return json(await push(body));
      }
      return json({ ok: false, error: 'online-draft', message: '온라인 초안에서는 사내 서버 전용 기능을 쓸 수 없습니다' }, 503);
    } catch (e) {
      console.warn('[Online] 요청 실패', p, e);
      return json({ ok: false, error: String(e && e.message || e) }, 502);
    }
  };

  window.QR_ONLINE = { ready: true, client: sb, hasSession, url: cfg.url };

  // 화면 구석에 "온라인 초안" 표시 — 사내 서버판과 헷갈리지 않게
  const badge = () => {
    if (document.getElementById('qr-online-badge')) return;
    const b = document.createElement('div');
    b.id = 'qr-online-badge';
    b.textContent = '온라인 초안 · 시험용 데이터';
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;padding:4px 10px;border-radius:12px;'
      + 'background:#9a6a00;color:#fff;font-size:11.5px;font-weight:600;opacity:.88;pointer-events:none';
    document.body.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', badge); else badge();
})();
