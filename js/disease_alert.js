// ============================================================
// disease_alert.js — 농림축산식품부 가축질병 위기단계 위젯
// ============================================================

const DiseaseAlert = (() => {
  const MAFRA_URL = 'https://www.mafra.go.kr/FMD-AI2/';
  // 위기단계는 "지금 몇 단계인가"만 알려준다. "무엇이 어디서 터졌는가"는 KAHIS 쪽.
  //   근거: 가축전염병예방법 제3조의2 — 농장명·소재지·발생일까지 공개된다.
  //   단, 농장명은 대부분 대표자 개인 이름이라 받지도 보여주지도 않는다(소재지·축종·두수만).
  //   2026-11 확인: www.kahis.go.kr 쪽은 갱신이 멈춰 있어 home 쪽(현행)을 쓴다.
  const KAHIS_URL = 'https://home.kahis.go.kr/home/lkntscrinfo/selectLkntsOccrrncList.do';
  // v3: 공식 표에 없는 질병을 '미표시'로 둔다(2026-11 럼피스킨이 표에서 빠짐). 예전 캐시는 쓰지 않는다.
  const CACHE_KEY = 'ws_disease_alert_cache_v3';
  try { localStorage.removeItem('ws_disease_alert_cache_v2'); } catch (_) {}
  // v1 캐시에는 농장명(대표자 개인 이름)이 들어 있어 버리고 v2 로 새로 쌓는다
  const OB_CACHE_KEY = 'ws_disease_outbreak_cache_v2';
  try { localStorage.removeItem('ws_disease_outbreak_cache_v1'); } catch (_) {}
  const REFRESH_MS = 10 * 60 * 1000;
  let timer = null;

  const meta = {
    '조류인플루엔자': { id: 'ai', name: '조류 인플루엔자', shortName: 'AI', icon: '' },
    '아프리카돼지열병': { id: 'asf', name: '아프리카 돼지열병', shortName: 'ASF', icon: '' },
    '구제역': { id: 'fmd', name: '구제역', shortName: 'FMD', icon: '' },
    '럼피스킨': { id: 'lsd', name: '럼피스킨', shortName: 'LSD', icon: '' }
  };

  const levelOrder = { 관심: 1, 주의: 2, 심각: 3 };
  const DISEASE_ORDER = ['ai', 'asf', 'fmd', 'lsd'];

  // 표시용 4칸으로 맞춘다. 공식 표에 없는 질병은 단계를 지어내지 않고 빈 값으로 둔다.
  const fillSlots = (items) => {
    const list = Array.isArray(items) ? items : [];
    return Object.values(meta)
      .map(info => list.find(x => x.id === info.id) || { ...info, level: '' })
      .sort((a, b) => DISEASE_ORDER.indexOf(a.id) - DISEASE_ORDER.indexOf(b.id));
  };
  // 단계를 한 번도 확인하지 못했을 때 — 과거 값을 박아 두면 틀린 단계가 현재값처럼 보인다
  const unknownState = () => ({ source: 'NONE', fetchedAt: '', items: fillSlots([]) });

  const stripTags = (html) => String(html || '')
    .replace(/<br\s*\/?>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();

  const normalizeName = (name) => {
    const cleaned = String(name || '').replace(/\s+/g, '');
    if (cleaned.includes('조류') || cleaned.includes('인플루엔자')) return '조류인플루엔자';
    if (cleaned.includes('아프리카') || cleaned.includes('돼지')) return '아프리카돼지열병';
    if (cleaned.includes('구제역')) return '구제역';
    if (cleaned.includes('럼피')) return '럼피스킨';
    return cleaned;
  };

  const parseOfficialHtml = (html) => {
    const items = [];
    const dlRegex = /<dl\b[^>]*class=["'][^"']*icon_level[^"']*["'][^>]*>([\s\S]*?)<\/dl>/gi;
    let match;
    while ((match = dlRegex.exec(html))) {
      const block = match[1];
      const dtMatch = block.match(/<dt[^>]*>([\s\S]*?)<\/dt>/i);
      const key = normalizeName(stripTags(dtMatch?.[1] || ''));
      const info = meta[key];
      if (!info) continue;

      let activeLevel = '';
      const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
      let pMatch;
      while ((pMatch = pRegex.exec(block))) {
        const attrs = pMatch[1] || '';
        const level = stripTags(pMatch[2]);
        if (/\bon\b/.test(attrs) && ['관심', '주의', '심각'].includes(level)) {
          activeLevel = level;
          break;
        }
      }
      if (activeLevel) items.push({ ...info, level: activeLevel });
    }

    if (!items.length) throw new Error('위기단계 표를 읽지 못했습니다.');
    return { source: 'MAFRA', fetchedAt: new Date().toISOString(), items: fillSlots(items) };
  };

  // ── 발생현황: HTML 표 파싱 (서버 프록시가 없을 때 클라이언트에서 직접) ──
  const obText = (x) => String(x || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const parseOutbreakHtml = (html, limit = 10) => {
    const items = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    while ((tr = trRe.exec(html))) {
      const body = tr[1];
      if (!body.includes('list_g_line')) continue;      // 데이터 행만
      const tds = (body.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || []).map(obText);
      if (tds.length < 7) continue;
      const m = /^(\d{4}-\d{2}-\d{2})\s*(?:\((\d{4}-\d{2}-\d{2})\))?/.exec(tds[3]);
      let occurredAt = m ? m[1] : tds[3];
      const diagnosedAt = (m && m[2]) || '';
      const y = +String(occurredAt).slice(0, 4);
      if (diagnosedAt && (y < 2000 || y > new Date().getFullYear())) occurredAt = diagnosedAt;   // 원자료 오타(4026-…)
      items.push({
        // tds[1] 은 농장명(대부분 대표자 개인 이름) — 개인정보라 받지 않는다
        disease: tds[0], region: tds[2],
        occurredAt, diagnosedAt,
        species: tds[4], count: tds[5], agency: tds[6], endedAt: tds[7] || ''
      });
    }
    if (!items.length) throw new Error('발생현황 표를 읽지 못했습니다.');
    items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return { source: 'KAHIS', url: KAHIS_URL, fetchedAt: new Date().toISOString(), items: items.slice(0, limit) };
  };

  const loadOutbreaks = async () => {
    const isHttp = location.protocol === 'http:' || location.protocol === 'https:';
    const enc = encodeURIComponent(KAHIS_URL);
    const sources = [];
    if (isHttp) sources.push({ url: '/api/disease-outbreaks', json: true });
    sources.push({ url: `https://api.allorigins.win/raw?url=${enc}` });
    sources.push({ url: `https://corsproxy.io/?url=${enc}` });
    sources.push({ url: `https://api.codetabs.com/v1/proxy/?quest=${KAHIS_URL}` });

    for (const src of sources) {
      try {
        const text = await fetchText(src.url);
        const payload = src.json ? JSON.parse(text) : parseOutbreakHtml(text);
        if (src.json && payload.error) throw new Error(payload.error);
        if (!payload.items || !payload.items.length) throw new Error('빈 응답');
        // 서버가 예전 형식(농장명 포함)으로 주더라도 여기서 떼어낸 뒤 저장·표시한다
        payload.items = payload.items.map(({ farm, ...rest }) => rest);
        try { localStorage.setItem(OB_CACHE_KEY, JSON.stringify(payload)); } catch (_) {}
        return { data: payload, live: true };
      } catch (_) { /* 다음 소스 */ }
    }
    try {
      const raw = localStorage.getItem(OB_CACHE_KEY);
      if (raw) return { data: JSON.parse(raw), live: false };
    } catch (_) {}
    return { data: null, live: false };
  };

  // 시도명은 길어서 한 줄에 안 들어간다 — 흔히 부르는 이름으로 줄인다
  const SIDO_SHORT = [
    ['전북특별자치도', '전북'], ['전라북도', '전북'], ['강원특별자치도', '강원'],
    ['제주특별자치도', '제주'], ['세종특별자치시', '세종'], ['전남광주통합특별시', '전남광주'],
    ['충청북도', '충북'], ['충청남도', '충남'], ['전라남도', '전남'],
    ['경상북도', '경북'], ['경상남도', '경남'], ['경기도', '경기'],
    ['서울특별시', '서울'], ['부산광역시', '부산'], ['대구광역시', '대구'],
    ['인천광역시', '인천'], ['광주광역시', '광주'], ['대전광역시', '대전'], ['울산광역시', '울산']
  ];
  const shortRegion = (region) => {
    const parts = String(region || '').split(/\s+/).filter(Boolean);
    if (!parts.length) return '-';
    let sido = parts[0];
    const hit = SIDO_SHORT.find(([full]) => sido === full);
    if (hit) sido = hit[1];
    return parts[1] ? `${sido} ${parts[1]}` : sido;
  };

  // '소-한우' → '한우',  '돼지-일반' → '돼지'
  const shortSpecies = (sp) => {
    const [head, tail] = String(sp || '').split('-');
    if (!tail || tail === '일반') return head || '-';
    return tail;
  };

  // 외부 사이트에서 긁어온 글자라 그대로 innerHTML 에 넣지 않는다
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const daysAgo = (ymd) => {
    // 'YYYY-MM-DD' 를 그대로 Date 에 넣으면 UTC 자정이 되어 하루가 밀린다 — 현지 자정으로 읽는다
    const d = new Date(String(ymd || '').slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return '';
    const n = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (n <= 0) return '오늘';
    return `${n}일 전`;
  };

  const renderOutbreak = (payload) => {
    if (!payload || !payload.items || !payload.items.length) {
      return `<span class="ob-empty">최근 발생내역을 불러오지 못했습니다</span>`;
    }
    const it = payload.items[0];
    const more = payload.items.slice(1, 4)
      .map(x => `${x.occurredAt} ${x.disease} · ${shortRegion(x.region)}`).join('\n');
    const tip = [it.disease, it.region,
      `발생 ${it.occurredAt}${it.diagnosedAt ? ` (진단 ${it.diagnosedAt})` : ''}`,
      `${it.species} ${it.count}두 · ${it.agency}`,
      it.endedAt ? `종식 ${it.endedAt}` : '진행 중',
      more ? `\n[그 다음]\n${more}` : ''].filter(Boolean).join('\n');
    return `
      <span class="ob-label">최근 발생</span>
      <span class="ob-disease">${esc(it.disease)}</span>
      <span class="ob-where">${esc(shortRegion(it.region))}</span>
      <span class="ob-what">${esc(shortSpecies(it.species))} ${esc(it.count)}두</span>
      <span class="ob-when">${esc(it.occurredAt)} <em>${daysAgo(it.occurredAt)}</em></span>
      <button class="ob-link" onclick="DiseaseAlert.openKahis()" title="KAHIS 법정가축전염병 발생현황 열기">전체↗</button>
      <span class="ob-tip" title="${esc(tip)}"></span>
    `;
  };

  const loadCache = () => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  const saveCache = (payload) => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch (_) {}
  };

  // 소스별 타임아웃 fetch (한 소스가 느려도 다음으로 빠르게 넘어감)
  const fetchText = async (url, ms = 9000) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally { clearTimeout(t); }
  };

  // 위기단계 로드: ① 서버 프록시(/api) → ② 여러 CORS 프록시 → ③ 직접(HTTPS일 때만) 순으로 폴백.
  //   서버 프록시(server.py /api/disease-alert)가 가장 안정적. python -m http.server면 ②로.
  const loadLive = async () => {
    const isHttp = location.protocol === 'http:' || location.protocol === 'https:';
    const enc = encodeURIComponent(MAFRA_URL);
    const sources = [];
    if (isHttp) sources.push({ url: '/api/disease-alert', json: true });        // ① 서버 프록시
    sources.push({ url: `https://api.allorigins.win/raw?url=${enc}` });          // ② CORS 프록시들
    sources.push({ url: `https://corsproxy.io/?url=${enc}` });
    sources.push({ url: `https://api.codetabs.com/v1/proxy/?quest=${MAFRA_URL}` });
    if (location.protocol === 'https:') sources.push({ url: MAFRA_URL });        // ③ 직접(대개 CORS 차단)

    for (const src of sources) {
      try {
        const text = await fetchText(src.url);
        const payload = src.json ? JSON.parse(text) : parseOfficialHtml(text);
        if (src.json && payload.error) throw new Error(payload.error);
        if (!payload.items || !payload.items.length) throw new Error('빈 응답');
        const normalized = { ...payload, items: fillSlots(payload.items), fetchedAt: payload.fetchedAt || new Date().toISOString(), source: payload.source || 'MAFRA' };
        // 서버가 공식 사이트를 못 읽어 지난 값을 돌려준 경우 — 실시간으로 표시하지 않는다
        if (payload.stale) return { data: normalized, live: false, message: `공식 사이트 연결 실패 · 마지막 확인값${ageText(normalized.fetchedAt)}` };
        saveCache(normalized);
        return { data: normalized, live: true, message: '실시간 연결됨' };
      } catch (err) { /* 다음 소스 시도 */ }
    }

    const cached = loadCache();
    if (cached?.items?.length) {
      return { data: { ...cached, items: fillSlots(cached.items) }, live: false,
               message: `공식 사이트 연결 실패 · 마지막 확인값${ageText(cached.fetchedAt)}` };
    }
    return { data: unknownState(), live: false, message: '공식 사이트 연결 실패 · 현재 단계를 확인하지 못했습니다' };
  };

  // 마지막 확인이 며칠 전인지 — 옛값을 현재값으로 착각하지 않게 함께 적는다
  const ageText = (iso) => {
    const d = new Date(iso || '');
    if (isNaN(d)) return '';
    const n = Math.floor((Date.now() - d.getTime()) / 86400000);
    return n >= 1 ? `(${n}일 전)` : '';
  };

  // 확인된 단계 중 가장 높은 것. 하나도 없으면 빈 값.
  const highestLevel = (items) => items.reduce((top, item) =>
    (levelOrder[item.level] || 0) > (levelOrder[top] || 0) ? item.level : top, '');

  const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' +
      d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  const levelClass = (level) => {
    if (level === '심각') return 'critical';
    if (level === '주의') return 'caution';
    if (level === '관심') return 'watch';
    return 'unknown';
  };

  // 간소화 행: [아이콘 약칭] ─ [현재단계 pill] (한 줄, 작게)
  const renderRows = (items) => items.map(item => `
    <div class="disease-row disease-${levelClass(item.level)}" title="${item.name} (${item.shortName})${item.level ? '' : ' · 공식 위기단계 표에 표시되지 않았습니다'}">
      <div class="disease-name">
        <div>
          <strong>${item.name}</strong>
          <span>${item.shortName}</span>
        </div>
      </div>
      <span class="disease-cur ${levelClass(item.level)}">${item.level || '미표시'}</span>
    </div>
  `).join('');

  const paint = (payload, state = {}) => {
    const el = document.getElementById('disease-alert-body');
    const metaEl = document.getElementById('disease-alert-meta');
    const badgeEl = document.getElementById('disease-alert-badge');
    if (!el) return;
    const data = payload || unknownState();
    el.innerHTML = renderRows(fillSlots(data.items));
    if (badgeEl) {
      const high = highestLevel(data.items);
      badgeEl.textContent = high === '심각' ? '심각 포함' : high === '주의' ? '주의 포함' : high === '관심' ? '전체 관심' : '확인 불가';
      badgeEl.className = `disease-summary-badge ${state.live === false ? 'unknown' : levelClass(high)}`;
    }
    if (metaEl) {
      const when = formatTime(data.fetchedAt);
      metaEl.textContent = `${state.message || '공식 단계 표시'}${when ? ` · ${when}` : ''}`;
      metaEl.classList.toggle('stale', state.live === false);
    }
  };

  const paintOutbreak = (payload) => {
    const el = document.getElementById('disease-outbreak');
    if (!el) return;
    el.innerHTML = renderOutbreak(payload);
  };

  const refresh = async () => {
    const metaEl = document.getElementById('disease-alert-meta');
    if (metaEl) metaEl.textContent = '공식 페이지 확인 중...';
    // 위기단계와 발생내역은 출처가 달라 따로 받는다 — 한쪽이 늦어도 다른 쪽은 먼저 그린다
    //   (발생내역은 프록시를 차례로 돌면 수십 초 걸릴 수 있어 기다리게 하면 위기단계가 멈춰 보인다)
    const lv = loadLive().then(level => paint(level.data, level)).catch(() => {});
    const ob = loadOutbreaks().then(r => paintOutbreak(r && r.data)).catch(() => paintOutbreak(null));
    await Promise.all([lv, ob]);
  };

  const render = () => `
    <div class="card disease-alert-card">
      <div class="disease-alert-head">
        <div class="disease-alert-title">가축질병 위기단계
          <span class="disease-summary-badge watch" id="disease-alert-badge">확인중</span>
        </div>
        <div class="disease-alert-actions">
          <span class="disease-alert-meta" id="disease-alert-meta">확인 중…</span>
          <button class="btn btn-ghost btn-xs" onclick="DiseaseAlert.refresh()" title="새로고침">↻</button>
          <button class="btn btn-ghost btn-xs" onclick="DiseaseAlert.openOfficial()" title="농림축산식품부 공식 페이지 열기">공식↗</button>
        </div>
      </div>
      <div class="disease-alert-body" id="disease-alert-body">
        ${renderRows(fillSlots((loadCache() || unknownState()).items))}
      </div>
      <div class="disease-outbreak" id="disease-outbreak">
        <span class="ob-label">최근 발생</span><span class="ob-empty">확인 중…</span>
      </div>
    </div>
  `;

  // 공식 페이지 열기 — 실제 브라우저는 새 탭, 외부이동 차단 환경(미리보기 등)은 주소 복사로 폴백(오류 방지)
  const openOfficial = () => {
    let win = null;
    try { win = window.open(MAFRA_URL, '_blank', 'noopener,noreferrer'); } catch (_) { win = null; }
    if (win) return;
    // 새 탭이 열리지 않으면 주소를 클립보드로 복사
    const notify = () => { if (typeof App !== 'undefined' && App.toast) App.toast('공식 페이지 주소를 복사했습니다. 브라우저 주소창에 붙여넣으세요.', 'info', 3500); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(MAFRA_URL).then(notify).catch(() => { if (typeof App !== 'undefined' && App.toast) App.toast('공식 페이지: ' + MAFRA_URL, 'info', 5000); });
      } else if (typeof App !== 'undefined' && App.toast) { App.toast('공식 페이지: ' + MAFRA_URL, 'info', 5000); }
    } catch (_) { if (typeof App !== 'undefined' && App.toast) App.toast('공식 페이지: ' + MAFRA_URL, 'info', 5000); }
  };

  // KAHIS 발생현황 페이지 열기 — 공식 페이지 열기와 같은 폴백 방식
  const openKahis = () => {
    let win = null;
    try { win = window.open(KAHIS_URL, '_blank', 'noopener,noreferrer'); } catch (_) { win = null; }
    if (win) return;
    const say = (m) => { if (typeof App !== 'undefined' && App.toast) App.toast(m, 'info', 4000); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(KAHIS_URL)
          .then(() => say('KAHIS 발생현황 주소를 복사했습니다. 주소창에 붙여넣으세요.'))
          .catch(() => say('KAHIS 발생현황: ' + KAHIS_URL));
      } else { say('KAHIS 발생현황: ' + KAHIS_URL); }
    } catch (_) { say('KAHIS 발생현황: ' + KAHIS_URL); }
  };

  const afterRender = () => {
    if (timer) clearInterval(timer);
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  };

  return { render, afterRender, refresh, openOfficial, openKahis,
           parseOfficialHtml, parseOutbreakHtml };
})();
