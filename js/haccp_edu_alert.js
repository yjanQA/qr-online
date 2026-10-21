// ============================================================
// haccp_edu_alert.js — 사료공장 HACCP 교육 공지 알람 (인증관리 워크스페이스)
//   출처: 한국사료협회 FIRI 게시판 (firi.kofeed.org)
//   서버 프록시(/api/haccp-edu) 우선, 실패 시 CORS 프록시로 직접 파싱.
//   새 게시글(마지막 확인 이후 nttId 증가)이 있으면 배너 표시.
// ============================================================

const HaccpEduAlert = (() => {
  const BOARD_URL = 'http://firi.kofeed.org/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000004&menuNo=5040000';
  const SEEN_KEY = 'haccp_edu_seen_id';
  const CACHE_MS = 30 * 60 * 1000;
  let cache = null;         // {posts:[{id,title,date}], fetchedAt}
  let cacheAt = 0;
  let loading = null;

  const seenId = () => { try { return Number(localStorage.getItem(SEEN_KEY) || 0); } catch (_) { return 0; } };

  // ── 데이터 로드: /api → CORS 프록시(HTML 직접 파싱) ──
  const parseBoardHtml = (html) => {
    const posts = [];
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('tbody tr').forEach(tr => {
      const ntt = tr.querySelector('input[name="nttId"]');
      const title = tr.querySelector('input.submit_link');
      const id = ntt ? Number(ntt.value) : 0;
      if (!id || !title) return;
      const dateM = (tr.textContent || '').match(/\d{4}-\d{2}-\d{2}/);
      posts.push({ id, title: (title.value || '').trim(), date: dateM ? dateM[0] : '' });
    });
    posts.sort((a, b) => b.id - a.id);
    return posts.slice(0, 15);
  };
  const load = () => {
    if (cache && Date.now() - cacheAt < CACHE_MS) return Promise.resolve(cache);
    if (loading) return loading;
    const finish = (data) => { cache = data; cacheAt = Date.now(); loading = null; return data; };
    loading = fetch('/api/haccp-edu')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('api ' + r.status)))
      .then(d => { if (!d || !Array.isArray(d.posts) || !d.posts.length) throw new Error('empty'); return finish(d); })
      .catch(() => {
        // 서버 미가동(정적 서빙) 시 CORS 프록시 폴백
        const proxies = [
          (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
          (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
          (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
        ];
        const tryAt = (i) => {
          if (i >= proxies.length) { loading = null; return Promise.reject(new Error('all proxies failed')); }
          return fetch(proxies[i](BOARD_URL)).then(r => r.ok ? r.text() : Promise.reject(new Error('proxy ' + r.status)))
            .then(html => {
              const posts = parseBoardHtml(html);
              if (!posts.length) throw new Error('parse fail');
              return finish({ source: 'KOFEED-FIRI(proxy)', posts });
            })
            .catch(() => tryAt(i + 1));
        };
        return tryAt(0);
      });
    return loading;
  };

  // ── 배너 렌더 (신규 공지 있을 때만) ──
  const bannerHtml = (posts) => {
    const seen = seenId();
    const fresh = posts.filter(p => p.id > seen);
    if (!fresh.length) return '';
    const latest = fresh[0];
    return `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(255,176,32,.08);
        border:1px solid rgba(255,176,32,.4);border-left:4px solid #ffb020;border-radius:10px;
        padding:10px 14px;margin-bottom:14px">
        <div style="flex:1;min-width:220px">
          <div style="font-size:13px;font-weight:700;color:#ffb020">사료공장 HACCP 교육 공지 — 신규 ${fresh.length}건</div>
          <div style="font-size:12.5px;margin-top:2px">${esc(latest.title)} <span class="text-muted">(${esc(latest.date)}${fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : ''} · 한국사료협회 FIRI)</span></div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-outline-primary btn-sm" onclick="HaccpEduAlert.openBoard()">게시판 열기</button>
          <button class="btn btn-ghost btn-sm" onclick="HaccpEduAlert.markSeen()" title="확인 처리 — 다음 신규 공지부터 다시 알림">확인</button>
        </div>
      </div>`;
  };

  // app.js renderPage 훅: 인증관리 워크스페이스 페이지 상단에 배너 주입
  const mount = (containerEl, workspace) => {
    if (workspace !== 'haccp' || !containerEl) return;
    let slot = document.getElementById('hedu-banner');
    if (!slot) {
      slot = document.createElement('div');
      slot.id = 'hedu-banner';
      containerEl.prepend(slot);
    }
    if (cache) { slot.innerHTML = bannerHtml(cache.posts); return; }
    load().then(d => {
      const s = document.getElementById('hedu-banner');
      if (s) s.innerHTML = bannerHtml(d.posts);
    }).catch(() => { /* 조용히 무시 — 다음 진입 시 재시도 */ });
  };

  const markSeen = () => {
    const maxId = cache && cache.posts.length ? cache.posts[0].id : 0;
    try { localStorage.setItem(SEEN_KEY, String(maxId)); } catch (_) {}
    const s = document.getElementById('hedu-banner');
    if (s) s.innerHTML = '';
    App.toast('확인 처리되었습니다 — 새 공지가 올라오면 다시 알립니다', 'success');
  };

  const openBoard = () => {
    let win = null;
    try { win = window.open(BOARD_URL, '_blank', 'noopener,noreferrer'); } catch (_) { win = null; }
    if (win) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(BOARD_URL).then(
          () => App.toast('팝업이 차단되어 게시판 주소를 복사했습니다 — 브라우저 주소창에 붙여넣으세요', 'info'),
          () => App.toast('게시판 주소: ' + BOARD_URL, 'info'));
        return;
      }
    } catch (_) {}
    App.toast('게시판 주소: ' + BOARD_URL, 'info');
  };

  return { mount, markSeen, openBoard, load };
})();
