// ============================================================
// online_auth.js — 온라인판(Supabase) 로그인·가입·승인
//   온라인판에서만 불러온다(online_bridge.js 다음, auth.js 앞).
//   auth.js 는 화면·판정을 그대로 쓰고, 계정 저장소만 여기로 바꾼다.
//     · 가입      → Supabase Auth 가입. 계정 행(profiles)은 DB 트리거가 '승인 대기'로 만든다.
//     · 로그인    → 이메일·비밀번호 확인 후 계정 상태(승인 여부)를 profiles 에서 읽는다.
//     · 사용자 관리 → 승인·거절·권한 변경을 profiles 에 쓴다(마스터만 DB 가 허용).
//   계정 목록은 auth.js 가 쓰던 localStorage(rm_auth_users)에 사본으로 받아 둔다(동기화하지 않음).
// ============================================================

(() => {
  const O = window.QR_ONLINE;
  if (!O || !O.ready) return;
  const sb = O.client;
  const USERS_KEY = 'rm_auth_users';

  // profiles 행 ↔ auth.js 사용자 객체
  const toUser = (p) => ({
    id: p.email, uid: p.id, email: p.email, name: p.name || '',
    role: p.role, status: p.status,
    allowedWorkspaces: Array.isArray(p.allowed_workspaces) ? p.allowed_workspaces : null,
    canIssueCode: !!p.can_issue_code,
    createdAt: p.created_at || '', approvedAt: p.approved_at || '', approvedBy: p.approved_by || '',
  });
  const toRow = (u) => ({
    name: u.name || '', role: u.role, status: u.status,
    allowed_workspaces: Array.isArray(u.allowedWorkspaces) ? u.allowedWorkspaces : null,
    can_issue_code: !!u.canIssueCode,
    approved_at: u.approvedAt || null, approved_by: u.approvedBy || '',
  });
  const SAME = (a, b) => JSON.stringify(toRow(a)) === JSON.stringify(toRow(b));

  let known = {};   // 마지막으로 서버에서 받은 계정(email → user) — 바뀐 것만 올리기 위한 기준

  const readCache = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (_) { return []; } };
  const writeCache = (list) => { try { localStorage.setItem(USERS_KEY, JSON.stringify(list)); } catch (_) {} };

  // 서버 계정 목록을 받아 사본을 갈아끼운다
  const refreshUsers = async () => {
    const { data, error } = await sb.from('profiles').select('*').order('created_at');
    if (error) throw error;
    const list = (data || []).map(toUser);
    known = {};
    list.forEach(u => { known[u.id] = u; });
    writeCache(list);
    return list;
  };

  const msgOf = (e) => {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않습니다';
    if (/email not confirmed/i.test(m)) return '이메일 확인이 끝나지 않은 계정입니다. 관리자에게 문의하세요.';
    if (/already registered|already been registered|user already exists/i.test(m)) return '이미 등록되었거나 신청된 이메일입니다';
    if (/woosung\.kr|database error saving new user/i.test(m)) return '@woosung.kr 이메일만 가입할 수 있습니다';
    if (/password/i.test(m) && /6|short|weak/i.test(m)) return '비밀번호는 6자 이상이어야 합니다';
    if (/rate limit|too many/i.test(m)) return '요청이 많습니다. 잠시 후 다시 시도하세요.';
    if (/failed to fetch|network/i.test(m)) return '온라인 서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.';
    return m || '처리하지 못했습니다';
  };

  const signup = async (name, email, password) => {
    const { error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
    if (error) return { ok: false, msg: msgOf(error) };
    // 가입 직후 자동 로그인 세션이 생길 수 있다 — 승인 전이므로 바로 끊는다
    try { await sb.auth.signOut(); } catch (_) {}
    return { ok: true };
  };

  const login = async (email, password) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, msg: msgOf(error) };
    const uid = data && data.user && data.user.id;
    const { data: me, error: e2 } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (e2 || !me) { await sb.auth.signOut(); return { ok: false, msg: '계정 정보를 찾지 못했습니다. 관리자에게 문의하세요.' }; }
    if (me.status !== 'APPROVED') {
      await sb.auth.signOut();
      return { ok: false, msg: me.status === 'REJECTED' ? '가입이 거절된 계정입니다. 관리자에게 문의하세요.' : '승인 대기 중인 계정입니다. 마스터 승인 후 로그인하세요.' };
    }
    await refreshUsers();
    return { ok: true, user: toUser(me) };
  };

  const logout = async () => { try { await sb.auth.signOut(); } catch (_) {} };

  // auth.js 의 writeUsers 가 부른다 — 이전 사본과 비교해 바뀐 계정만 서버에 반영
  let saving = Promise.resolve();
  const saveUsers = (list) => {
    saving = saving.then(async () => {
      const now = {};
      (list || []).forEach(u => { now[u.id] = u; });
      // 마스터 권한 이양처럼 본인 권한이 함께 바뀌면, 본인 행을 먼저 바꾸는 순간 마스터가 아니게 되어
      //   상대 행을 못 고친다 — 다른 사람 행을 먼저, 본인 행을 마지막에 차례로 보낸다.
      const { data: s } = await sb.auth.getSession();
      const myUid = s && s.session && s.session.user && s.session.user.id;
      const jobs = [];
      Object.values(now).forEach(u => {
        const before = known[u.id];
        if (!u.uid || !before || SAME(u, before)) return;
        jobs.push({ mine: u.uid === myUid, run: () => sb.from('profiles').update(toRow(u)).eq('id', u.uid) });
      });
      Object.values(known).forEach(u => {
        if (!now[u.id] && u.uid) jobs.push({ mine: false, run: () => sb.from('profiles').delete().eq('id', u.uid) });
      });
      if (!jobs.length) return;
      jobs.sort((a, b) => (a.mine ? 1 : 0) - (b.mine ? 1 : 0));
      try {
        for (const j of jobs) { const { error } = await j.run(); if (error) throw error; }
      } catch (e) { try { App.toast('계정 변경을 저장하지 못했습니다 — ' + msgOf(e), 'error'); } catch (_) {} }
      try { await refreshUsers(); } catch (_) {}
      try { if (typeof Auth !== 'undefined' && Auth.refreshAdmin) Auth.refreshAdmin(); } catch (_) {}
    });
    return saving;
  };

  // 로그인 상태면 계정 목록을 주기적으로 새로 받는다(새 가입 신청·승인 반영)
  const watch = () => {
    const tick = () => {
      if (!O.hasSession()) return;
      refreshUsers().then(() => {
        try { if (typeof Auth !== 'undefined' && Auth.refreshAdmin) Auth.refreshAdmin(); } catch (_) {}
      }).catch(() => {});
    };
    tick();
    setInterval(tick, 15000);
  };

  // 승인이 취소(차단)되거나 세션이 끊기면 다시 로그인하게 한다
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { try { localStorage.removeItem('rm_auth_session'); } catch (_) {} }
  });

  window.QR_ONLINE_AUTH = {
    hasSession: O.hasSession, signup, login, logout, saveUsers, refreshUsers, watch,
    knownUsers: () => readCache(),
  };
})();
