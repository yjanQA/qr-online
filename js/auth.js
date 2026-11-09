// ============================================================
// auth.js — 로그인 / 회원가입 / 마스터 승인 (사내 접근 제어)
//  · 이메일을 아이디로 사용, @woosung.kr 도메인만 가입 가능
//  · 신규 가입은 '승인 대기' → 마스터가 승인해야 로그인 가능
//  · 저장: localStorage(rm_auth_users) — 동기화 서버 사용 시 기기 간 공유
//  · 정적 웹앱 특성상 '사내 접근 제어' 수준의 보안입니다(은행급 아님)
// ============================================================

const Auth = (() => {
  const USERS_KEY   = 'rm_auth_users';
  const SESSION_KEY = 'rm_auth_session';
  const SAVED_EMAIL_KEY = 'rm_auth_saved_email';   // '아이디 저장'
  const DOMAIN      = 'woosung.kr';
  const MASTER_EMAIL = 'master@example.com';

  const savedEmail = () => { try { return localStorage.getItem(SAVED_EMAIL_KEY) || ''; } catch (_) { return ''; } };

  // ── 로그인 없이 쓰기 (2026-10-16 사용자 요청 — 가입 승인이 기기 간에 안 잡혀 우선 열어 둔다) ──
  //   false : 로그인 없이 바로 들어온다. 처음 한 번 이름만 적고(건너뛰면 '사내 사용자'),
  //           그 이름이 일지·VOC 등 작성자로 남는다. 업무영역은 전부 열린다.
  //           사용자 관리 같은 마스터 기능은 상단 '관리자 로그인'으로 들어가 쓴다.
  //   true  : 예전처럼 사내 계정 로그인 + 마스터 승인을 거쳐야 들어온다. 보완이 끝나면 되돌린다.
  const LOGIN_REQUIRED = false;
  // 온라인판(Supabase) — online_auth.js 가 먼저 불러져 있으면 계정 저장소를 그쪽으로 바꾸고 로그인을 반드시 거친다.
  //   사내 서버판 index.html 에는 online_auth.js 가 없으므로 아래 분기는 모두 건너뛴다.
  const ONLINE = (typeof window !== 'undefined' && window.QR_ONLINE_AUTH) || null;
  const NEED_LOGIN = LOGIN_REQUIRED || !!ONLINE;
  const GUEST_KEY = 'rm_guest_profile';      // 이 기기에서 쓰는 이름 — 기기마다 따로(동기화 안 함)
  const guestProfile = () => { try { return JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (_) { return null; } };
  const saveGuest = (name) => {
    const g = guestProfile() || { id: 'guest-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
    g.name = name;
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(g)); } catch (_) {}
    return g;
  };
  // 이름 기반 손님 계정 — 작성자 표시용. 이메일 자리는 기기 고유값이라 사람끼리 겹치지 않는다.
  const guestUser = () => {
    const g = guestProfile();
    if (!g) return null;
    return { id: g.id, email: g.id + '@guest.local', name: g.name || '사내 사용자',
             role: 'GUEST', status: 'APPROVED', allowedWorkspaces: null, guest: true };
  };

  // 접근 권한 단위 = 워크스페이스(상단 업무영역). app.js workspaces와 일치
  const WORKSPACES = [
    { id: 'qr',      label: QR_ON ? '입고·재고 QR' : '입고·재고' },
    { id: 'quality', label: '품질·실험실' },
    { id: 'formula', label: '배합비·생산' },
    { id: 'trace',   label: '추적·클레임' },
    { id: 'admin',   label: '관리' },
    { id: 'smart',   label: '스마트제조' },
    { id: 'haccp',   label: '인증관리' },
    { id: 'rnd',     label: '연구관리' },
  ];
  const ALL_WS = WORKSPACES.map(w => w.id);
  // 사용자의 허용 워크스페이스: 마스터=전체, allowedWorkspaces 미설정(null)=전체(하위호환)
  const allowedFor = (u) => {
    if (!u) return [];
    if (u.role === 'MASTER') return ALL_WS.slice();
    return Array.isArray(u.allowedWorkspaces) ? u.allowedWorkspaces : ALL_WS.slice();
  };
  const allowedSet = () => new Set(allowedFor(currentUser()));

  // ── SHA-256 (공용/오프라인·사내망 http 환경에서도 동작하도록 순수 JS) ──
  const sha256 = function (ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    const mathPow = Math.pow, maxWord = mathPow(2, 32);
    let i, j, result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = sha256.h = sha256.h || [];
    const k = sha256.k = sha256.k || [];
    let primeCounter = k.length;
    const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return '';
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
              w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
            ) | 0);
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++)
      for (j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    return result;
  };
  const utf8 = (str) => unescape(encodeURIComponent(String(str)));
  const hashPw = (salt, pw) => sha256(utf8(salt + ':' + pw));
  const genSalt = () => {
    try {
      const a = new Uint8Array(16);
      (window.crypto || {}).getRandomValues?.(a);
      if (a.some(x => x)) return Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
    } catch (_) {}
    return (Date.now().toString(36) + Math.random().toString(36).slice(2)).padEnd(24, '0');
  };

  // ── 저장 계층(동기화 훅 호출) ──
  const readUsers  = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch (_) { return []; } };
  const writeUsers = (list) => {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
    if (ONLINE) { ONLINE.saveUsers(list); return; }   // 온라인판: 바뀐 계정만 Supabase 에 반영(동기화 키로 보내지 않음)
    try { if (window.__onDbWrite) window.__onDbWrite(USERS_KEY); } catch (_) {}
    // 가입·승인·거절은 상대가 기다리고 있다 — 0.8초 모아 보내지 않고 바로 서버로 보낸다
    try { if (typeof Sync !== 'undefined' && Sync.syncNow) Promise.resolve(Sync.syncNow()).catch(() => {}); } catch (_) {}
  };

  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const validDomain = (e) => normEmail(e).endsWith('@' + DOMAIN);
  const findUser = (email) => readUsers().find(u => u.id === normEmail(email));
  // 승인된 사용자 목록 — 결재선 지정 등 담당자 선택용 (비밀번호 해시는 제외)
  const listUsers = () => readUsers()
    .filter(u => u.status === 'APPROVED')
    .map(u => ({ id: u.id, name: u.name || u.id, role: u.role }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const appRef = () => (typeof App !== 'undefined' && App) ? App : null;
  const toast = (m, t) => { const A = appRef(); if (A && A.toast) { try { return A.toast(m, t); } catch (_) {} } };

  // ── 마스터 계정 시드(최초 비밀번호는 첫 로그인 때 본인 설정) ──
  const ensureSeed = () => {
    if (ONLINE) return;   // 온라인판 마스터는 DB 가 가입 때 정한다
    const users = readUsers();
    if (!users.some(u => u.id === MASTER_EMAIL)) {
      users.push({
        id: MASTER_EMAIL, email: MASTER_EMAIL, name: '마스터',
        role: 'MASTER', status: 'APPROVED',
        salt: '', passwordHash: null,      // null = 최초 비밀번호 미설정
        createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(), approvedBy: 'SYSTEM'
      });
      writeUsers(users);
    }
  };

  // ── 세션 ──
  const setSession = (email) => localStorage.setItem(SESSION_KEY, JSON.stringify({ email: normEmail(email), ts: Date.now() }));
  const clearSession = () => localStorage.removeItem(SESSION_KEY);
  const sessionEmail = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')?.email || null; } catch (_) { return null; } };
  const currentUser = () => {
    const e = sessionEmail();
    const u = e ? findUser(e) : null;
    if (u && u.status === 'APPROVED') return u;
    // 온라인판 둘러보기(세션 없이 손님 이름만 있음)는 손님으로 본다
    if (NEED_LOGIN && !(ONLINE && !e && guestProfile())) return u;
    return guestUser();          // 로그인 없이 쓰는 중 — 이 기기의 이름
  };
  const isMaster = () => currentUser()?.role === 'MASTER';
  // 코드 발행 권한: 마스터 또는 canIssueCode 부여자만 (사용자 관리 → 접근 권한에서 부여)
  const canIssueCode = () => { const u = currentUser(); return !!u && (u.role === 'MASTER' || u.canIssueCode === true); };
  // 현재 로그인 사용자 이름/이메일 — 접수·수정 등 모든 작업의 작성자 자동기록용
  const currentName = () => {
    const u = currentUser();
    const nm = (u && (u.name || '').trim()) || '';
    if (nm) return nm;
    const e = sessionEmail();
    return e ? e.split('@')[0] : '';
  };
  const currentEmail = () => {
    const u = currentUser();
    return (u && u.email) || sessionEmail() || '';
  };

  // ============================================================
  // 로그인 화면(전체 오버레이)
  // ============================================================
  let mode = 'login'; // 'login' | 'signup'

  const showLogin = () => {
    document.body.classList.add('auth-locked');
    let ov = document.getElementById('auth-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'auth-overlay';
      document.body.appendChild(ov);
    }
    renderLogin();
  };
  const hideLogin = () => {
    document.getElementById('auth-overlay')?.remove();
    document.body.classList.remove('auth-locked');
  };

  const renderLogin = () => {
    const ov = document.getElementById('auth-overlay');
    if (!ov) return;
    const isSignup = mode === 'signup';
    ov.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo"></div>
          <div>
            <div class="auth-title">${QR_ON ? '우성사료 QR 이력관리' : '우성 품질관리 플랫폼'}</div>
            <div class="auth-sub">사내 계정으로 로그인하세요</div>
          </div>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab ${!isSignup ? 'active' : ''}" onclick="Auth.setMode('login')">로그인</button>
          <button class="auth-tab ${isSignup ? 'active' : ''}" onclick="Auth.setMode('signup')">회원가입</button>
        </div>

        ${isSignup ? `
          <div class="form-group">
            <label class="form-label">이름</label>
            <input type="text" class="form-input" id="auth-name" placeholder="홍길동" autocomplete="name">
          </div>
          <div class="form-group">
            <label class="form-label">이메일 (아이디)</label>
            <input type="email" class="form-input" id="auth-email" placeholder="name@${DOMAIN}" autocomplete="username">
            <div class="form-hint">@${DOMAIN} 이메일만 가입할 수 있습니다</div>
          </div>
          <div class="form-group">
            <label class="form-label">비밀번호</label>
            <input type="password" class="form-input" id="auth-pw" placeholder="6자 이상" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label class="form-label">비밀번호 확인</label>
            <input type="password" class="form-input" id="auth-pw2" placeholder="비밀번호 재입력" autocomplete="new-password"
                   onkeydown="if(event.key==='Enter')Auth.doSignup()">
          </div>
          <div class="auth-msg" id="auth-msg"></div>
          <button class="btn btn-primary btn-block" onclick="Auth.doSignup()">가입 신청</button>
          <div class="auth-foot">가입 신청 후 <b>마스터 승인</b>을 받아야 로그인할 수 있습니다.</div>
        ` : `
          <div class="form-group">
            <label class="form-label">이메일 (아이디)</label>
            <input type="email" class="form-input" id="auth-email" placeholder="name@${DOMAIN}" autocomplete="username" value="${esc(savedEmail())}"
                   oninput="Auth.onEmailInput(this.value)">
          </div>
          <div class="form-group">
            <label class="form-label">비밀번호</label>
            <input type="password" class="form-input" id="auth-pw" placeholder="비밀번호" autocomplete="current-password"
                   onkeydown="if(event.key==='Enter')Auth.doLogin()">
          </div>
          <label class="auth-remember">
            <input type="checkbox" id="auth-remember" ${savedEmail() ? 'checked' : ''} onchange="Auth.rememberToggle(this.checked)">
            <span>아이디 저장</span>
          </label>
          <div class="auth-msg" id="auth-msg"></div>
          <button class="btn btn-primary btn-block" onclick="Auth.doLogin()">로그인</button>
        `}
        ${NEED_LOGIN ? '' : '<button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="Auth.cancelLogin()">로그인 없이 계속</button>'}
        ${ONLINE ? `<button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="Auth.browseOnline()">로그인 없이 둘러보기</button>
          <div class="auth-foot">둘러보기는 시험용 표본 자료로 보여 줍니다. 입력한 내용은 이 브라우저에만 남고 다른 사람과 공유되지 않습니다.</div>` : ''}
      </div>`;
    // 저장된 아이디가 있으면 비밀번호로 바로 포커스, 없으면 이메일/이름
    setTimeout(() => {
      const el = (mode === 'login' && savedEmail()) ? ov.querySelector('#auth-pw') : ov.querySelector('#auth-email, #auth-name');
      el?.focus();
    }, 30);
  };

  const setMode = (m) => { mode = m; renderLogin(); };

  // ── 로그인 없이 쓰기: 이름 한 번 적기 ──
  const askName = () => {
    document.body.classList.add('auth-locked');
    let ov = document.getElementById('auth-overlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'auth-overlay'; document.body.appendChild(ov); }
    const cur = guestProfile()?.name || '';
    ov.innerHTML = `
      <div class="auth-card">
        <div class="auth-brand">
          <div class="auth-logo"></div>
          <div>
            <div class="auth-title">${QR_ON ? '우성사료 QR 이력관리' : '우성 품질관리 플랫폼'}</div>
            <div class="auth-sub">로그인 없이 사용합니다. 기록에 남길 이름만 적어 주세요.</div>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">이름</label>
          <input type="text" class="form-input" id="auth-guest-name" placeholder="예: 홍길동" value="${esc(cur)}"
                 autocomplete="name" onkeydown="if(event.key==='Enter')Auth.saveGuestName()">
          <div class="form-hint">일지·VOC 등의 작성자로 남습니다. 이 기기에서 한 번만 적으면 됩니다.</div>
        </div>
        <button class="btn btn-primary btn-block" onclick="Auth.saveGuestName()">시작하기</button>
        <button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="Auth.saveGuestName(true)">이름 없이 시작</button>
        <div class="auth-foot"><a href="javascript:void(0)" onclick="Auth.adminLogin()">관리자 로그인</a></div>
      </div>`;
    setTimeout(() => ov.querySelector('#auth-guest-name')?.focus(), 30);
  };
  const saveGuestName = (skip) => {
    const v = skip === true ? '사내 사용자' : (document.getElementById('auth-guest-name')?.value || '').trim();
    if (!v) { toast('이름을 입력하거나 "이름 없이 시작"을 누르세요', 'warning'); return; }
    saveGuest(v);
    hideLogin();
    activateSession();
    refreshTopbar();
    toast(`${v} 님으로 시작합니다`, 'success');
  };
  const renameGuest = () => askName();
  // 온라인판 둘러보기: 가입·승인 없이 표본 자료로 화면만 본다. 서버 동기화는 로그인 세션이 있어야 켜지므로 꺼진 채로 남는다.
  const browseOnline = () => {
    saveGuest('둘러보기');
    hideLogin();
    activateSession();
    refreshTopbar();
  };
  const adminLogin = () => { mode = 'login'; showLogin(); };
  // 관리자 로그인 창을 닫고 로그인 없이 계속
  const cancelLogin = () => {
    if (NEED_LOGIN) return;
    if (!guestProfile()) return askName();
    hideLogin();
    activateSession();
  };
  const setMsg = (html, type = 'error') => { const el = document.getElementById('auth-msg'); if (el) { el.className = `auth-msg ${type}`; el.innerHTML = html; } };

  const doSignup = () => {
    const name = document.getElementById('auth-name')?.value.trim();
    const email = normEmail(document.getElementById('auth-email')?.value);
    const pw = document.getElementById('auth-pw')?.value || '';
    const pw2 = document.getElementById('auth-pw2')?.value || '';
    if (!name) return setMsg('이름을 입력하세요');
    if (!email) return setMsg('이메일을 입력하세요');
    if (!validDomain(email)) return setMsg(`@${DOMAIN} 이메일만 가입할 수 있습니다`);
    if (pw.length < 6) return setMsg('비밀번호는 6자 이상이어야 합니다');
    if (pw !== pw2) return setMsg('비밀번호가 일치하지 않습니다');
    if (ONLINE) {
      setMsg('가입 신청 중…', 'ok');
      return ONLINE.signup(name, email, pw).then(res => {
        if (!res.ok) return setMsg(res.msg);
        mode = 'login';
        renderLogin();
        setMsg('가입 신청이 접수되었습니다. 마스터 승인 후 로그인할 수 있습니다.', 'ok');
      });
    }
    const users = readUsers();
    if (users.some(u => u.id === email)) return setMsg('이미 등록되었거나 신청된 이메일입니다');
    const salt = genSalt();
    users.push({
      id: email, email, name,
      role: 'USER', status: 'PENDING',
      salt, passwordHash: hashPw(salt, pw),
      createdAt: new Date().toISOString(), approvedAt: '', approvedBy: ''
    });
    writeUsers(users);
    syncNow();          // 마스터 화면에 바로 뜨도록 즉시 전송
    mode = 'login';
    renderLogin();
    setMsg('가입 신청이 접수되었습니다. 마스터 승인 후 로그인할 수 있습니다.', 'ok');
  };

  // 서버의 최신 계정 상태를 바로 받아온다(동기화 서버가 없으면 그냥 넘어간다)
  const syncNow = () => {
    try { return (typeof Sync !== 'undefined' && Sync.syncNow) ? Promise.resolve(Sync.syncNow()).catch(() => {}) : Promise.resolve(); }
    catch (_) { return Promise.resolve(); }
  };

  let checking = false;    // 서버 확인 중 — 로그인 버튼 연타 방지
  const doLogin = (fresh) => {
    const email = normEmail(document.getElementById('auth-email')?.value);
    const pw = document.getElementById('auth-pw')?.value || '';
    if (!email || !pw) return setMsg('이메일과 비밀번호를 입력하세요');
    if (ONLINE) {
      if (checking) return Promise.resolve();
      checking = true;
      setMsg('로그인 중…', 'ok');
      return ONLINE.login(email, pw).then(res => {
        checking = false;
        if (!res.ok) return setMsg(res.msg);
        rememberEmail(email);
        setSession(email);
        // 동기화는 로그인한 상태로 처음부터 붙어야 한다 — 새로 불러 시작한다
        setMsg('로그인되었습니다. 불러오는 중…', 'ok');
        location.reload();
      }, () => { checking = false; setMsg('온라인 서버에 연결하지 못했습니다'); });
    }
    const user = findUser(email);
    // 판정은 이 브라우저에 받아 둔 계정 사본으로 한다. 방금 승인됐거나 다른 기기에서 가입했으면
    //   사본이 아직 옛 상태일 수 있다 — 서버에서 한 번 받아온 뒤 다시 판정한다(4초 주기를 기다리지 않는다).
    //   보내는 중에는 받기를 미루는 동기화 규칙 때문에 한 번 받기는 빈손일 수 있어, 최대 6초 동안 거듭 확인한다.
    if (fresh !== true && (!user || user.status !== 'APPROVED')) {
      if (checking) return Promise.resolve();
      checking = true;
      setMsg('서버에서 계정 상태를 확인하는 중…', 'ok');
      const deadline = Date.now() + 6000;
      const tick = () => syncNow().then(() => {
        const u = findUser(email);
        if ((u && u.status === 'APPROVED') || Date.now() > deadline) { checking = false; return doLogin(true); }
        return new Promise(r => setTimeout(r, 700)).then(tick);
      });
      return tick();
    }
    if (!user) return setMsg('등록되지 않은 계정입니다');
    if (user.status === 'PENDING')  return setMsg('승인 대기 중인 계정입니다. 마스터 승인 후 로그인하세요.');
    if (user.status === 'REJECTED') return setMsg('가입이 거절된 계정입니다. 관리자에게 문의하세요.');

    // 마스터 최초 로그인: 입력한 비밀번호로 설정
    if (user.passwordHash == null) {
      if (pw.length < 6) return setMsg('최초 비밀번호는 6자 이상으로 설정하세요');
      const users = readUsers();
      const u = users.find(x => x.id === email);
      u.salt = genSalt(); u.passwordHash = hashPw(u.salt, pw);
      writeUsers(users);
      rememberEmail(email);
      setSession(email);
      toast('마스터 비밀번호가 설정되었습니다', 'success');
      return enterApp();
    }
    if (hashPw(user.salt, pw) !== user.passwordHash) return setMsg('비밀번호가 일치하지 않습니다');
    rememberEmail(email);   // 로그인 성공 시에만 아이디 저장/해제
    setSession(email);
    enterApp();
  };

  // '아이디 저장' 체크 상태에 따라 이메일 저장/해제 (로그인 성공 시에도 호출)
  const rememberEmail = (email) => {
    try {
      if (document.getElementById('auth-remember')?.checked) localStorage.setItem(SAVED_EMAIL_KEY, normEmail(email) || '');
      else localStorage.removeItem(SAVED_EMAIL_KEY);
    } catch (_) {}
  };

  // 체크박스를 켜는 즉시 현재 입력한 아이디를 저장한다(로그인 성공을 기다리지 않음).
  //   → 비밀번호를 틀리거나 승인 대기 상태여도 아이디는 유지된다.
  const rememberToggle = (checked) => {
    try {
      const email = normEmail(document.getElementById('auth-email')?.value);
      if (checked && email) localStorage.setItem(SAVED_EMAIL_KEY, email);
      else if (!checked) localStorage.removeItem(SAVED_EMAIL_KEY);
    } catch (_) {}
  };

  // 체크된 상태에서 아이디를 고치면 저장값도 실시간 갱신한다.
  const onEmailInput = (val) => {
    try {
      if (!document.getElementById('auth-remember')?.checked) return;
      const email = normEmail(val);
      if (email) localStorage.setItem(SAVED_EMAIL_KEY, email);
      else localStorage.removeItem(SAVED_EMAIL_KEY);
    } catch (_) {}
  };

  // ── 접근 권한 적용(탭·메뉴 숨김 + 네비게이션 가드) ──
  const applyPermissions = () => {
    const set = allowedSet();
    // 상단 워크스페이스 탭 숨김
    document.querySelectorAll('.workspace-tab[data-workspace]').forEach(el => {
      el.style.display = set.has(el.dataset.workspace) ? '' : 'none';
    });
    // 사이드바 나브 그룹/아이템 중 비허용 워크스페이스는 숨김(AI는 항상 표시되므로 특히 필요)
    document.querySelectorAll('.sidebar-nav [data-workspace]').forEach(el => {
      if (!set.has(el.dataset.workspace)) el.style.setProperty('display', 'none', 'important');
      else el.style.removeProperty('display');
    });
    // 현재 워크스페이스가 비허용이면 허용된 첫 영역으로 이동
    try {
      const A = appRef();
      const cur = A && A.getWorkspace ? A.getWorkspace() : null;
      if (A && cur && !set.has(cur)) {
        const first = ALL_WS.find(w => set.has(w));
        if (first && A.switchWorkspace) A.switchWorkspace(first);
      } else if (A && A.updateWorkspaceUI) {
        A.updateWorkspaceUI();
      }
    } catch (_) {}
  };

  const installGuards = () => {
    const App = appRef();
    if (!App || App.__authGuarded) return;
    const origNav = App.navigate;
    App.navigate = function (page, ...a) {
      const ws = App.pageWorkspace ? App.pageWorkspace(page) : null;
      if (ws && !allowedSet().has(ws)) { toast('접근 권한이 없는 메뉴입니다', 'warning'); return; }
      return origNav.call(App, page, ...a);
    };
    const origSw = App.switchWorkspace;
    App.switchWorkspace = function (ws) {
      if (ws && !allowedSet().has(ws)) { toast('접근 권한이 없는 영역입니다', 'warning'); return; }
      return origSw.call(App, ws);
    };
    App.__authGuarded = true;
  };

  const activateSession = () => { installGuards(); injectTopbar(); applyPermissions(); };

  const enterApp = () => {
    hideLogin();
    activateSession();
    refreshTopbar();      // 손님으로 쓰다가 관리자 로그인한 경우 상단 표시를 바꾼다
    toast(`${currentUser()?.name || currentUser()?.email} 님 로그인`, 'success');
  };

  const logout = () => {
    if (ONLINE) { ONLINE.logout().then(() => { clearSession(); location.reload(); }); return; }
    clearSession();
    location.reload();
  };

  // ============================================================
  // 상단바 사용자 영역 주입
  // ============================================================
  const injectTopbar = () => {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('auth-user-area')) return;
    const u = currentUser();
    if (!u) return;
    const master = u.role === 'MASTER';
    const pending = master ? readUsers().filter(x => x.status === 'PENDING').length : 0;
    lastPending = pending;     // 이후 동기화로 늘어나면 알림을 띄우는 기준
    const wrap = document.createElement('div');
    wrap.id = 'auth-user-area';
    wrap.className = 'auth-user-area';
    if (u.guest) {
      wrap.innerHTML = `
        <span class="auth-user-chip" title="로그인 없이 사용 중">${esc(u.name)}</span>
        <button class="btn btn-ghost btn-sm" onclick="Auth.renameGuest()">이름 변경</button>
        <button class="btn btn-ghost btn-sm" onclick="Auth.adminLogin()">관리자 로그인</button>`;
      actions.appendChild(wrap);
      return;
    }
    wrap.innerHTML = `
      ${master ? `<button class="btn btn-outline-primary btn-sm" onclick="Auth.openAdmin()">
        사용자 관리${pending ? ` <span class="auth-pending-badge">${pending}</span>` : ''}
      </button>` : ''}
      <span class="auth-user-chip" title="${esc(u.email)}">
        ${master ? '' : ''}${esc(u.name || u.email)}
      </span>
      <button class="btn btn-ghost btn-sm" onclick="Auth.logout()">로그아웃</button>`;
    actions.appendChild(wrap);
  };

  const refreshTopbar = () => { document.getElementById('auth-user-area')?.remove(); injectTopbar(); };

  // ============================================================
  // 마스터 전용 사용자 관리
  // ============================================================
  const openAdmin = () => {
    if (!isMaster()) return toast('마스터 권한이 필요합니다', 'error');
    let modal = document.getElementById('auth-admin-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'auth-admin-modal';
      modal.className = 'modal-overlay';
      modal.innerHTML = `<div class="modal modal-lg">
        <div class="modal-header">
          <div class="modal-title">사용자 관리</div>
          <button class="modal-close" onclick="Auth.closeAdmin()">✕</button>
        </div>
        <div id="auth-admin-body"></div>
      </div>`;
      document.body.appendChild(modal);
    }
    renderAdmin();
    modal.classList.add('open');
  };
  const closeAdmin = () => document.getElementById('auth-admin-modal')?.classList.remove('open');

  const STATUS_LABEL = { PENDING: '승인 대기', APPROVED: '승인됨', REJECTED: '거절됨' };

  // 사용자의 접근 가능 영역 요약 문자열
  const accessSummary = (u) => {
    const code = u.canIssueCode ? ' · <span class="text-success">코드발행</span>' : '';
    if (!Array.isArray(u.allowedWorkspaces)) return '<span class="text-success">전체</span>' + code;
    if (u.allowedWorkspaces.length === 0) return '<span class="text-danger">없음</span>' + code;
    if (u.allowedWorkspaces.length === ALL_WS.length) return '<span class="text-success">전체</span>' + code;
    const labels = WORKSPACES.filter(w => u.allowedWorkspaces.includes(w.id)).map(w => w.label);
    return `<span class="text-muted">${labels.join(' · ')}</span>` + code;
  };

  // 접근 권한 편집 모달(워크스페이스 체크박스)
  let permTargetId = null;
  const openPerms = (id) => {
    if (!isMaster()) return toast('마스터 권한이 필요합니다', 'error');
    const u = findUser(id);
    if (!u) return;
    permTargetId = id;
    const allowed = new Set(allowedFor(u));
    let modal = document.getElementById('auth-perm-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'auth-perm-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `<div class="modal">
      <div class="modal-header">
        <div class="modal-title">접근 권한 · ${esc(u.name || u.email)}</div>
        <button class="modal-close" onclick="Auth.closePerms()">✕</button>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        <div class="text-xs text-muted">이 사용자가 <b>볼 수 있는 업무영역</b>만 체크하세요. 체크 해제된 영역은 메뉴에서 숨겨지고 접근이 차단됩니다.</div>
        <div class="auth-perm-grid">
          ${WORKSPACES.map(w => `
            <label class="auth-perm-item">
              <input type="checkbox" class="auth-perm-cb" value="${w.id}" ${allowed.has(w.id) ? 'checked' : ''}>
              <span>${esc(w.label)}</span>
            </label>`).join('')}
        </div>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm" onclick="Auth.permAll(true)">전체 선택</button>
          <button class="btn btn-ghost btn-sm" onclick="Auth.permAll(false)">전체 해제</button>
        </div>
        <div class="text-xs text-muted" style="margin-top:8px;border-top:1px solid var(--border);padding-top:10px">특수 권한</div>
        <label class="auth-perm-item">
          <input type="checkbox" id="auth-perm-code" ${u.canIssueCode ? 'checked' : ''}>
          <span>코드 발행 — 원료·제품 코드 신규 발행 허용 (관리 → 코드 관리)</span>
        </label>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="Auth.closePerms()">취소</button>
          <button class="btn btn-primary" onclick="Auth.savePerms()">권한 저장</button>
        </div>
      </div>
    </div>`;
    modal.classList.add('open');
  };
  const closePerms = () => document.getElementById('auth-perm-modal')?.classList.remove('open');
  const permAll = (on) => document.querySelectorAll('#auth-perm-modal .auth-perm-cb').forEach(cb => { cb.checked = on; });
  const savePerms = () => {
    if (!permTargetId) return;
    const sel = [...document.querySelectorAll('#auth-perm-modal .auth-perm-cb:checked')].map(cb => cb.value);
    if (sel.length === 0) return toast('최소 1개 영역은 허용해야 합니다', 'warning');
    const codePerm = !!document.getElementById('auth-perm-code')?.checked;
    mutate(permTargetId, u => { u.allowedWorkspaces = sel; u.canIssueCode = codePerm; });
    toast('접근 권한을 저장했습니다', 'success');
    closePerms();
  };

  const localDay = (iso) => {
    const d = new Date(iso || '');
    return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // 다른 기기에서 가입·승인이 동기화로 들어왔을 때 — 열려 있는 사용자 관리 창과 상단 대기 배지를 갱신
  let lastPending = -1;
  const refreshAdmin = () => {
    if (!isMaster()) return;
    const pending = readUsers().filter(x => x.status === 'PENDING').length;
    if (lastPending >= 0 && pending > lastPending) toast(`새 가입 신청 ${pending - lastPending}건 — 사용자 관리에서 승인하세요`, 'info');
    lastPending = pending;
    const btn = document.querySelector('#auth-user-area button[onclick="Auth.openAdmin()"]');
    if (btn) btn.innerHTML = `사용자 관리${pending ? ` <span class="auth-pending-badge">${pending}</span>` : ''}`;
    if (document.getElementById('auth-admin-modal')?.classList.contains('open')) renderAdmin();
  };

  const renderAdmin = () => {
    const body = document.getElementById('auth-admin-body');
    if (!body) return;
    const users = readUsers().slice().sort((a, b) => (a.status === 'PENDING' ? -1 : 0) - (b.status === 'PENDING' ? -1 : 0));
    const me = currentUser()?.id;
    const groups = ['PENDING', 'APPROVED', 'REJECTED'];
    const section = (st) => {
      const list = users.filter(u => u.status === st);
      if (!list.length) return '';
      return `
        <div class="auth-admin-group">
          <div class="auth-admin-group-title">${STATUS_LABEL[st]} (${list.length})</div>
          ${list.map(u => `
            <div class="auth-admin-row">
              <div class="auth-admin-info">
                <div class="font-bold text-sm">${u.role === 'MASTER' ? '' : ''}${esc(u.name || '-')} ${u.id === me ? '<span class="text-muted">(나)</span>' : ''}</div>
                <div class="text-xs text-muted td-mono">${esc(u.email)} · ${esc(localDay(u.createdAt))}</div>
                ${st === 'APPROVED' && u.role !== 'MASTER' ? `<div class="text-xs" style="margin-top:2px">접근: ${accessSummary(u)}</div>` : ''}
              </div>
              <div class="auth-admin-actions">
                ${st === 'PENDING' ? `
                  <button class="btn btn-success btn-xs" onclick="Auth.approve('${esc(u.id)}')">승인</button>
                  <button class="btn btn-danger btn-xs" onclick="Auth.reject('${esc(u.id)}')">거절</button>` : ''}
                ${st === 'APPROVED' && u.id !== me ? `
                  ${u.role !== 'MASTER' ? `<button class="btn btn-ghost btn-xs" onclick="Auth.openPerms('${esc(u.id)}')">접근 권한</button>` : ''}
                  ${u.role !== 'MASTER' ? `<button class="btn btn-outline-primary btn-xs" onclick="Auth.transferMaster('${esc(u.id)}')">권한 이양</button>` : ''}
                  <button class="btn btn-ghost btn-xs" onclick="Auth.toggleRole('${esc(u.id)}')">${u.role === 'MASTER' ? '마스터 해제' : '마스터 지정'}</button>
                  <button class="btn btn-danger btn-xs" onclick="Auth.reject('${esc(u.id)}')">차단</button>` : ''}
                ${st === 'REJECTED' ? `
                  <button class="btn btn-success btn-xs" onclick="Auth.approve('${esc(u.id)}')">승인</button>
                  <button class="btn btn-danger btn-xs" onclick="Auth.removeUser('${esc(u.id)}')">삭제</button>` : ''}
              </div>
            </div>`).join('')}
        </div>`;
    };
    body.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px">
        <div class="info-box info-blue">
          가입은 <b>@${DOMAIN}</b> 이메일만 가능하며, 신규 신청은 여기서 <b>승인</b>해야 로그인됩니다.<br>
          <span class="text-muted" style="font-size:11px">· <b>마스터 지정</b>: 공동 마스터 추가 · <b>권한 이양</b>: 상대를 마스터로 넘기고 본인은 일반 사용자로 전환</span>
        </div>
        ${groups.map(section).join('') || '<div class="text-muted">사용자가 없습니다</div>'}
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="Auth.closeAdmin()">닫기</button>
        </div>
      </div>`;
  };

  const mutate = (id, fn) => {
    const users = readUsers();
    const u = users.find(x => x.id === id);
    if (!u) return;
    fn(u);
    writeUsers(users);
    renderAdmin();
    refreshTopbar();
  };
  const approve = (id) => mutate(id, u => { u.status = 'APPROVED'; u.approvedAt = new Date().toISOString(); u.approvedBy = currentUser()?.email || ''; toast(`${u.name || u.email} 승인 완료`, 'success'); });
  const reject  = (id) => mutate(id, u => { u.status = 'REJECTED'; toast(`${u.name || u.email} 거절/차단`, 'warning'); });
  const toggleRole = (id) => mutate(id, u => { u.role = u.role === 'MASTER' ? 'USER' : 'MASTER'; toast(`권한 변경: ${u.role}`, 'success'); });

  // 마스터 권한 이양: 대상 → MASTER, 본인 → USER (단독 이양)
  const transferMaster = (id) => {
    if (!isMaster()) return toast('마스터 권한이 필요합니다', 'error');
    const me = currentUser();
    const users = readUsers();
    const target = users.find(u => u.id === id);
    if (!target) return;
    if (target.id === me.id) return toast('본인에게는 이양할 수 없습니다', 'warning');
    if (target.status !== 'APPROVED') return toast('승인된 사용자에게만 이양할 수 있습니다', 'warning');
    if (!confirm(`마스터 권한을 '${target.name || target.email}' 님에게 이양합니다.\n이양 후 회원님은 일반 사용자로 전환되어 사용자 관리 권한이 사라집니다.\n계속하시겠습니까?`)) return;
    target.role = 'MASTER'; target.status = 'APPROVED';
    const meRec = users.find(u => u.id === me.id);
    if (meRec) meRec.role = 'USER';
    writeUsers(users);
    toast(`마스터 권한을 ${target.name || target.email} 님에게 이양했습니다`, 'success');
    closeAdmin();
    refreshTopbar();
  };
  const removeUser = (id) => { if (!confirm('이 계정을 완전히 삭제할까요?')) return; writeUsers(readUsers().filter(u => u.id !== id)); renderAdmin(); refreshTopbar(); };

  // ============================================================
  const init = () => {
    ensureSeed();
    if (ONLINE) {
      // 온라인판: 이 브라우저에 로그인 세션과 승인된 계정 사본이 모두 있어야 들어간다
      const u = currentUser();
      if (u && u.status === 'APPROVED' && ONLINE.hasSession()) { hideLogin(); activateSession(); ONLINE.watch(); }
      else if (!sessionEmail() && guestProfile()) { hideLogin(); activateSession(); }   // 둘러보기로 들어온 적 있는 브라우저
      else { clearSession(); showLogin(); }
      return;
    }
    if (!LOGIN_REQUIRED) {
      // 승인 안 된 계정으로 남은 세션은 버리고 손님으로 들어온다
      const s = sessionEmail(); const su = s ? findUser(s) : null;
      if (s && !(su && su.status === 'APPROVED')) clearSession();
      hideLogin();
      if (!sessionEmail() && !guestProfile()) askName();
      else activateSession();
      return;
    }
    const u = currentUser();
    if (u && u.status === 'APPROVED') { hideLogin(); activateSession(); }
    else { clearSession(); showLogin(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return {
    init, setMode, doLogin, doSignup, logout, rememberToggle, onEmailInput,
    saveGuestName, renameGuest, browseOnline, adminLogin, cancelLogin, loginRequired: () => NEED_LOGIN,
    openAdmin, closeAdmin, approve, reject, toggleRole, transferMaster, removeUser, refreshAdmin,
    openPerms, closePerms, permAll, savePerms,
    enforceLanding: applyPermissions,
    currentUser, isMaster, canIssueCode, currentName, currentEmail,
    listUsers,
    _sha256: sha256, _hashPw: hashPw   // 검증용
  };
})();
