// ============================================================
// disease_page.js — 질병관리 (품질·실험실 > 품질관리)
//
//   가축전염병 발생 이력을 KAHIS(국가가축방역통합시스템) 공개 목록에서 기간으로 받아
//   시군구 지도·공장 인근 발생·질병별 기본 현황·월별 추이로 보여 준다.
//     · 위기단계(관심·주의·심각)는 기존 DiseaseAlert 위젯(농식품부)을 그대로 얹는다.
//     · 받는 곳: server.py /api/disease-history → 안 되면 공개 CORS 프록시 → 지난 저장본.
//     · 공개 근거: 가축전염병예방법 제3조의2, 같은 법 시행령 제2조의2.
//     · 농장명(대부분 대표자 개인 이름)은 받지도 보여 주지도 않는다. 소재지·축종·두수만.
//     · 공장과의 거리는 시군구 중심점 기준이다(농장 좌표는 공개되지 않는다).
//   지도 경계: data/koreaMap.js (tools/gen_korea_map.py 로 생성, 화면을 처음 열 때 불러온다)
// ============================================================

const DiseasePage = (() => {
  const KAHIS_URL = 'https://home.kahis.go.kr/home/lkntscrinfo/selectLkntsOccrrncList.do';
  const CACHE_KEY = 'ws_disease_history_v1';
  const PRESETS = [['30d', '최근 30일', 30], ['90d', '90일', 90], ['1y', '1년', 365], ['3y', '3년', 365 * 3], ['5y', '5년', 365 * 5]];
  // 3km = 보호지역 바깥 경계, 10km = 예찰지역 바깥 경계(구제역·AI·ASF 방역실시요령 제2조), 30·50km = 내부 감시
  const RADII = [3, 10, 30, 50];
  const LEGAL_RADII = { 3: '보호지역', 10: '예찰지역' };
  // 공장 둘레 방역지역(추정)과 사료공장 조치 — 각 방역실시요령 고시 조항
  const ZONE_RULES = [
    { re: /조류인플루엔자/, law: '조류인플루엔자 방역실시요령(고시 제2026-25호)', zones: {
      관리: '사료공장의 원료·사료 이동제한, 바이러스 양성 등은 폐기 (제22조제3항제10호)',
      보호: '사료공장의 원료·사료 이동제한, 위험도 평가 후 가축방역관 지도·감독하 생산·유통 허용, 가금용 사료는 검역본부 점검 후 허용 (제22조제3항제11호)',
      예찰: '사료공장은 가축방역관 지도·감독하 생산·유통 (제23조제3항제9호)' } },
    { re: /구제역/, law: '구제역 방역실시요령(고시 제2024-5호)', zones: {
      관리: '관리지역 내 우제류농장 사료공급은 지정 차량 이용 (제20조의2제4항)',
      보호: '보호지역 내 우제류농장 사료공급은 시장·군수·구청장 지정 차량 고정 배차 (제20조의3제4항제5호)',
      예찰: '예찰지역은 정기 백신접종 미실시 유형 발생 때 설정 (제2조제5호)' } },
    { re: /아프리카돼지열병/, law: '아프리카돼지열병 방역실시요령(고시 제2026-23호)', zones: {
      관리: '사료공장·사료 환적장의 사료는 시장·군수 지정 차량만 소독 후 운반 (제21조제4항제7호)',
      보호: '사료공장·사료 환적장의 사료는 시장·군수 지정 차량만 소독 후 운반 (제21조제4항제7호)',
      예찰: '사료·가축분뇨를 예찰지역 밖으로 반출할 때 소독 (제22조제4항제6호)' } },
  ];
  const ZONE_RANGE = { 관리: '반경 500m 이내', 보호: '500m~3km', 예찰: '3km 초과~10km' };
  const zoneOf = (d) => (d <= 0.5 ? '관리' : d <= 3 ? '보호' : d <= 10 ? '예찰' : '');
  const ZONE_DAYS = 30;                    // 발생 뒤 이 기간 안이고 종식일이 없으면 방역지역이 살아 있다고 본다(추정)
  const RECENT_DAYS = 14;                  // 지도에서 '최근 발생' 테두리를 긋는 기준
  // 옛 광역시도 이름 → 지도 이름(2026 기준)
  const OLD_SIDO = { '강원도': '강원특별자치도', '전라북도': '전북특별자치도', '전라남도': '전남광주통합특별시',
                     '광주광역시': '전남광주통합특별시', '제주도': '제주특별자치도' };
  const COLORS = ['#fcbba1', '#fb7a5a', '#de2d26', '#8f1410'];
  const STEPS = [1, 3, 10, 30];            // 1~2 / 3~9 / 10~29 / 30~ (+0 은 회색)
  const SERIES = ['#c0392b', '#3E6AE1', '#9a6a00', '#1f7a4d', '#7d3c98', '#5C5E62', '#d35400'];

  const st = {
    preset: '1y', from: '', to: '',
    disease: '', species: '', grade: '', sido: '', region: '',
    radius: 10,
    data: null, loading: false, error: '', note: '',
  };
  let chart = null;
  let mapReady = !!window.KOREA_MAP;
  let mapLoading = null;

  // ── 공통 ──
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymd = (d) => {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  const daysBefore = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  const daysAgo = (s) => {
    const d = new Date(String(s || '').slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? 9999 : Math.floor((Date.now() - d.getTime()) / 86400000);
  };
  const md = (s) => String(s).slice(5).replace('-', '.');
  const recentSpan = (n) => `${md(daysBefore(n))} ~ ${md(ymd(new Date()))}`;
  const range = () => {
    if (st.preset === 'custom' && st.from && st.to) return [st.from, st.to];
    const p = PRESETS.find(x => x[0] === st.preset) || PRESETS[2];
    return [daysBefore(p[2]), ymd(new Date())];
  };
  const regionKey = (region) => {
    const t = String(region || '').trim().split(/\s+/);
    let sido = OLD_SIDO[t[0]] || t[0] || '';
    const sgg = t[1] || '';
    if (sido === '경상북도' && sgg === '군위군') sido = '대구광역시';     // 2023-07 대구 편입
    if (sido === '세종특별자치시') return { key: sido, sido, sgg: '' };
    return /[시군구]$/.test(sgg) ? { key: sido + ' ' + sgg, sido, sgg } : { key: sido, sido, sgg: '' };
  };
  const speciesHead = (s) => String(s || '').split('-')[0].trim() || '기타';
  const diseaseName = (s) => String(s || '').replace(/\s+/g, '');
  const gradeText = (g) => (g ? g + '종' : '-');
  const shortSido = (s) => String(s || '')
    .replace('특별자치시', '').replace('특별자치도', '').replace('통합특별시', '').replace('특별시', '')
    .replace('광역시', '').replace('충청북도', '충북').replace('충청남도', '충남').replace('경상북도', '경북')
    .replace('경상남도', '경남').replace('경기도', '경기');
  const km = (a, b) => {
    const R = 6371, r = Math.PI / 180;
    const dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  const factories = () => {
    const L = (window.Weather && Weather.LOCATIONS) || {};
    return ['NS', 'GS', 'AS'].filter(id => L[id]).map(id => ({ id, name: L[id].name, ll: [L[id].lat, L[id].lon] }));
  };

  // ── 지도 경계 불러오기(처음 한 번) ──
  const loadMap = () => {
    if (window.KOREA_MAP) { mapReady = true; return Promise.resolve(); }
    if (mapLoading) return mapLoading;
    const add = (src) => new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    mapLoading = Promise.all([
      add('data/koreaMap.js?v=20261109'),
      window.KOREA_EMD ? null : add('data/koreaEmd.js?v=20261111'),   // 읍면동 중심점 — 없으면 시군구 중심으로 잰다
    ]).then(() => { mapReady = !!window.KOREA_MAP; });
    return mapLoading;
  };
  // 발생지 위치: 읍면동 중심점, 이름이 안 맞으면 시군구 중심점
  const locCache = new Map();
  const emdPick = (tbl, name) => {
    if (!tbl) return null;
    if (tbl[name]) return [name, tbl[name]];
    const stem = name.replace(/[읍면동]$/, '');
    if (stem.length < 2) return null;
    const ks = Object.keys(tbl);
    // 면→읍 승격, 법정동 → 행정동(신촌동 → 신촌1동·신촌제1동)
    const k = ks.find(x => x.replace(/[읍면]$/, '') === stem && /[읍면]$/.test(name))
      || ks.find(x => x.startsWith(stem) && /^(제)?\d+(\.\d+)?[가]?동$/.test(x.slice(stem.length)));
    return k ? [k, tbl[k]] : null;
  };
  const locOf = (region) => {
    if (locCache.has(region)) return locCache.get(region);
    const k = regionKey(region);
    const g = regionIndex()[k.key];
    let out = g ? { ll: g.ll, lvl: 'sgg', label: k.key } : null;
    const E = window.KOREA_EMD;
    if (E) {
      const t = String(region || '').trim().split(/\s+/);
      let i = k.sgg ? 2 : 1;
      if (k.sgg && /시$/.test(k.sgg) && /구$/.test(t[i] || '')) i++;   // 수원시 장안구 ○○동
      const name = t[i] || '';
      if (name && /[읍면동가]$/.test(name)) {
        let hit = emdPick(E[k.key], name);
        if (!hit) {          // 시군구 이름이 바뀐 경우(인천 2026 개편 등): 같은 시도 안에서 이름이 하나만 맞으면 쓴다
          const c = Object.keys(E).filter(x => x === k.sido || x.startsWith(k.sido + ' ')).map(x => emdPick(E[x], name)).filter(Boolean);
          if (c.length === 1) hit = c[0];
        }
        if (hit) out = { ll: hit[1], lvl: 'emd', label: `${k.key} ${hit[0]}` };
      }
    }
    if (out || window.KOREA_EMD) locCache.set(region, out);
    return out;
  };
  // 공장별 방역지역 추정: 최근 ZONE_DAYS일·종식 전 발생 중 반경 10km 안
  const zoneHits = (rows, f) => rows
    .filter(r => !r.endedAt && daysAgo(r.occurredAt) <= ZONE_DAYS)
    .map(r => ({ r, loc: locOf(r.region) })).filter(x => x.loc)
    .map(x => ({ ...x, d: km(f.ll, x.loc.ll) })).filter(x => x.d <= 10)
    .sort((a, b) => a.d - b.d);
  const regionIndex = () => {
    const m = window.KOREA_MAP;
    if (!m) return {};
    if (!m._idx) m._idx = Object.fromEntries(m.regions.map(r => [r.k, r]));
    return m._idx;
  };

  // ── 자료 받기 ──
  const obText = (x) => String(x || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  // 서버가 없을 때(온라인판·정적 실행) 프록시로 받은 KAHIS 표를 직접 푼다. 농장명 칸은 버린다.
  const parseHtml = (html, grade) => {
    const out = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    while ((tr = trRe.exec(html))) {
      if (!tr[1].includes('list_g_line')) continue;
      const tds = (tr[1].match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || []).map(obText);
      if (tds.length < 7) continue;
      const m = /^(\d{4}-\d{2}-\d{2})\s*(?:\((\d{4}-\d{2}-\d{2})\))?/.exec(tds[3]);
      if (!m) continue;
      let occurred = m[1];
      const diagnosed = m[2] || '';
      const y = +occurred.slice(0, 4);
      if (diagnosed && (y < 2000 || y > new Date().getFullYear())) occurred = diagnosed;
      out.push({ disease: tds[0], region: tds[2], occurredAt: occurred, diagnosedAt: diagnosed,
                 species: tds[4], count: tds[5], agency: tds[6], endedAt: tds[7] || '', grade });
    }
    return out;
  };
  const fetchText = async (url, ms) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally { clearTimeout(t); }
  };
  const viaServer = async (from, to) => {
    if (!/^https?:$/.test(location.protocol)) throw new Error('서버 없음');
    const text = await fetchText(`/api/disease-history?from=${from}&to=${to}`, 60000);
    const p = JSON.parse(text);
    if (p.error) throw new Error(p.error);
    return p;
  };
  const viaProxy = async (from, to) => {
    const items = [];
    for (const grade of ['1', '2', '3']) {
      const target = `${KAHIS_URL}?pageUnit=3000&occrFromDt=${from}&occrToDt=${to}&legalIctsdGradSe=${grade}`;
      const enc = encodeURIComponent(target);
      let ok = false;
      for (const url of [`https://api.allorigins.win/raw?url=${enc}`, `https://corsproxy.io/?url=${enc}`]) {
        try {
          const html = await fetchText(url, 15000);
          if (!/전체\s*:\s*[\d,]+\s*건/.test(html)) throw new Error('표 없음');
          items.push(...parseHtml(html, grade));
          ok = true;
          break;
        } catch (_) { /* 다음 프록시 */ }
      }
      if (!ok) throw new Error('프록시 연결 실패');
    }
    items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
    return { source: 'KAHIS', from, to, fetchedAt: new Date().toISOString(), items };
  };
  // 서버가 남겨 둔 최근 1년 보관본(data/disease_history.json). 서버를 새로 띄우기 전에도 정적 파일로 읽힌다.
  const viaSnapshot = async (from, to) => {
    if (!/^https?:$/.test(location.protocol)) throw new Error('서버 없음');
    const p = JSON.parse(await fetchText('data/disease_history.json?t=' + Date.now(), 15000));
    if (!p || !Array.isArray(p.items) || !p.items.length) throw new Error('보관본 없음');
    return { ...p, coverFrom: p.from, coverTo: p.to, from, to, snapshot: true,
             items: p.items.filter(r => r.occurredAt >= from && r.occurredAt <= to) };
  };
  const snapNote = (p) => {
    const d = new Date(p.fetchedAt || '');
    const z = (n) => String(n).padStart(2, '0');
    const at = isNaN(d) ? '이전' : `${ymd(d)} ${z(d.getHours())}:${z(d.getMinutes())}`;
    const short = p.coverFrom && p.from < p.coverFrom ? ` 보관본은 ${p.coverFrom} 이후만 있어 그 앞은 비어 있습니다.` : '';
    return `${at} 에 KAHIS 에서 받아 둔 자료입니다.${short}`;
  };
  const saveCache = (p) => {
    if (!p || p.items.length > 1500) return;             // 저장 공간을 아끼려고 1년 안팎 분량만 남긴다
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch (_) {}
  };
  const loadCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; } };

  let loadSeq = 0;
  const ageHours = (iso) => { const t = new Date(iso || '').getTime(); return isNaN(t) ? 1e9 : (Date.now() - t) / 3600000; };
  const load = async () => {
    const [from, to] = range();
    const seq = ++loadSeq;
    st.loading = true; st.error = ''; st.note = '';
    paint();
    // 빨리 끝나는 곳부터 차례로. 공개 프록시는 느리고 자주 막혀 맨 끝에만 쓴다.
    let p = null;
    let triedProxy = false;
    try { p = await viaServer(from, to); } catch (_) {}
    if (!p) {
      // 서버가 없으면(온라인판·재시작 전) 보관본 파일과 이 브라우저 저장본 중 새것을 쓴다
      let snap = null;
      try { snap = await viaSnapshot(from, to); } catch (_) {}
      const c = loadCache();
      const mine = (c && c.items && c.items.length)
        ? { ...c, stale: true, coverFrom: c.from, coverTo: c.to, from, to,
            items: c.items.filter(r => r.occurredAt >= from && r.occurredAt <= to) } : null;
      p = [snap, mine].filter(Boolean).sort((x, y) => ageHours(x.fetchedAt) - ageHours(y.fetchedAt))[0] || null;
    }
    if (!p) { triedProxy = true; try { p = await viaProxy(from, to); } catch (_) {} }
    if (seq !== loadSeq) return;                 // 그사이 기간을 바꿨다
    if (p) {
      p.items = (p.items || []).map(({ farm, ...rest }) => rest);
      if (p.snapshot || p.stale) st.note = snapNote(p);
      st.data = p;
      if (!p.stale && !p.snapshot) saveCache(p);
      // 보관본이 3시간보다 오래됐으면 화면은 그대로 두고 뒤에서 최신 자료를 받아 바꾼다
      if ((p.snapshot || p.stale) && !triedProxy && ageHours(p.fetchedAt) > 3) {
        st.note += ' 최신 자료를 받는 중입니다…';
        viaProxy(from, to).then(f => {
          if (seq !== loadSeq) return;
          f.items = f.items.map(({ farm, ...rest }) => rest);
          st.data = f; st.note = '';
          saveCache(f);
          paint();
        }).catch(() => {
          if (seq !== loadSeq) return;
          st.note = snapNote(p);
          paint();
        });
      }
    } else {
      st.data = null;
      st.error = 'KAHIS 발생 자료를 받지 못했고 받아 둔 보관본도 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    }
    st.loading = false;
    await loadMap();
    paint();
  };

  // ── 거르기 ──
  const rowsAll = () => (st.data && st.data.items) || [];
  const match = (r, skip) => {
    if (skip !== 'disease' && st.disease && diseaseName(r.disease) !== st.disease) return false;
    if (skip !== 'species' && st.species && speciesHead(r.species) !== st.species) return false;
    if (skip !== 'grade' && st.grade && r.grade !== st.grade) return false;
    if (skip !== 'place') {
      const k = regionKey(r.region);
      if (st.region && k.key !== st.region) return false;
      if (st.sido && k.sido !== st.sido) return false;
    }
    return true;
  };
  const filtered = (skip) => rowsAll().filter(r => match(r, skip));
  const countBy = (rows, fn) => {
    const m = new Map();
    rows.forEach(r => { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ── 화면 조각 ──
  const toolbar = () => {
    const all = rowsAll();
    const dz = countBy(all, r => diseaseName(r.disease));
    const sp = countBy(all, r => speciesHead(r.species));
    const [from, to] = range();
    const presetBtns = PRESETS.map(([v, l]) =>
      `<button class="btn btn-sm ${st.preset === v ? 'btn-primary' : 'btn-ghost'}" onclick="DiseasePage.setPreset('${v}')">${l}</button>`).join('');
    const sel = (id, cur, opts, all) => `<select class="form-input" style="width:auto;min-width:130px;padding:6px 8px" onchange="DiseasePage.setFilter('${id}', this.value)">
        <option value="">${all}</option>${opts.map(([v, l]) => `<option value="${h(v)}" ${cur === v ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
    const place = st.region || st.sido;
    return `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <div style="display:flex;gap:4px;flex-wrap:wrap">${presetBtns}</div>
        <input type="date" class="form-input" style="width:auto;padding:5px 8px" value="${from}" onchange="DiseasePage.setDate('from', this.value)">
        <span class="text-muted">~</span>
        <input type="date" class="form-input" style="width:auto;padding:5px 8px" value="${to}" onchange="DiseasePage.setDate('to', this.value)">
        <span style="flex:1"></span>
        <button class="btn btn-ghost btn-sm" onclick="DiseasePage.reload()">다시 받기</button>
        <button class="btn btn-ghost btn-sm" onclick="DiseasePage.exportXlsx()" ${all.length ? '' : 'disabled'}>엑셀 내려받기</button>
        <button class="btn btn-ghost btn-sm" onclick="DiseaseAlert.openKahis()">KAHIS 원문</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px">
        ${sel('disease', st.disease, dz.map(([k, n]) => [k, `${k} (${n})`]), '질병 전체')}
        ${sel('species', st.species, sp.map(([k, n]) => [k, `${k} (${n})`]), '축종 전체')}
        ${sel('grade', st.grade, [['1', '제1종'], ['2', '제2종'], ['3', '제3종']], '법정 종 전체')}
        ${place ? `<span class="badge" style="background:var(--danger-bg);color:var(--danger);padding:5px 10px;border-radius:4px;font-size:12px">지역: ${h(place)}
            <a href="javascript:void(0)" style="margin-left:6px;color:inherit" onclick="DiseasePage.setPlace('', '')">✕</a></span>` : ''}
        ${(st.disease || st.species || st.grade || place) ? `<button class="btn btn-ghost btn-xs" onclick="DiseasePage.clearFilters()">조건 지우기</button>` : ''}
      </div>
    </div>`;
  };

  const kpis = (rows) => {
    const regions = new Set(rows.map(r => regionKey(r.region).key));
    const recent = rows.filter(r => daysAgo(r.occurredAt) <= RECENT_DAYS).length;
    const last = rows[0];
    const fs = factories();
    const near = rows.filter(r => {
      const loc = locOf(r.region);
      return loc && daysAgo(r.occurredAt) <= 30 && fs.some(f => km(f.ll, loc.ll) <= st.radius);
    }).length;
    const card = (label, value, sub, color) => `<div class="kpi-card" style="--kpi-color:${color};cursor:default">
        <div class="kpi-label" style="text-transform:none">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
    return `<div class="kpi-grid" style="margin-bottom:14px">
      ${card('발생 건수', rows.length.toLocaleString(), `${range().join(' ~ ')}`, 'var(--accent)')}
      ${card('발생 시군구', regions.size, '지도에 칠해진 시군구', 'var(--warning)')}
      ${card(`최근 ${RECENT_DAYS}일 발생 건수`, recent, `${recentSpan(RECENT_DAYS)}${last ? ` · 마지막 ${h(md(last.occurredAt))} ${h(diseaseName(last.disease))}` : ''}`, recent ? 'var(--danger)' : 'var(--success)')}
      ${card(`공장 ${st.radius}km 안 발생 건수 (최근 30일)`, near, `${recentSpan(30)}${LEGAL_RADII[st.radius] ? ` · ${LEGAL_RADII[st.radius]} 경계` : ' · 내부 감시 반경'} · 읍면 중심 기준 · 두 공장 반경에 겹치면 1건으로`, near ? 'var(--danger)' : 'var(--success)')}
    </div>`;
  };

  const colorOf = (n) => {
    if (!n) return 'var(--bg-soft)';
    let i = 0;
    while (i < STEPS.length && n >= STEPS[i]) i++;
    return COLORS[Math.max(0, i - 1)];
  };

  // 고른 시군구용: 같은 단계의 더 진한 색
  const SEL_COLORS = ['#ef6548', '#cb181d', '#99000d', '#4a0806'];
  const selColorOf = (n) => {
    if (!n) return '#9aa0a8';
    let i = 0;
    while (i < STEPS.length && n >= STEPS[i]) i++;
    return SEL_COLORS[Math.max(0, i - 1)];
  };

  const mapSvg = (rows) => {
    const m = window.KOREA_MAP;
    if (!m) return `<div class="text-muted" style="padding:40px;text-align:center">지도 경계 파일(data/koreaMap.js)을 불러오지 못했습니다.</div>`;
    const cnt = {}, recent = {};
    rows.forEach(r => {
      const k = regionKey(r.region).key;
      cnt[k] = (cnt[k] || 0) + 1;
      if (daysAgo(r.occurredAt) <= RECENT_DAYS) recent[k] = true;
    });
    const sel = st.region;
    // 고른 시군구는 한 단계 진한 색 + 굵은 검은 테두리로, 다른 시군구 위에 그린다. 나머지는 살짝 옅게.
    const paths = m.regions.filter(r => r.k !== sel).map(r => {
      const n = cnt[r.k] || 0;
      const stroke = recent[r.k] ? '#7a120e' : '#ffffff';
      const sw = recent[r.k] ? 1.1 : 0.4;
      return `<path d="${r.d}" fill="${colorOf(n)}" stroke="${stroke}" stroke-width="${sw}" data-k="${h(r.k)}" data-n="${n}" style="cursor:pointer"${sel ? ' fill-opacity="0.55"' : ''}></path>`;
    }).join('') + m.regions.filter(r => r.k === sel).map(r => {
      const n = cnt[r.k] || 0;
      return `<path d="${r.d}" fill="${selColorOf(n)}" stroke="#171A20" stroke-width="2.4" stroke-linejoin="round" data-k="${h(r.k)}" data-n="${n}" style="cursor:pointer"></path>`;
    }).join('');
    const pxPerKm = m.proj.ky / 111.0;
    const fac = factories().map(f => {
      const x = (f.ll[1] - m.proj.lon0) * m.proj.kx, y = (m.proj.lat0 - f.ll[0]) * m.proj.ky;
      const cx = x.toFixed(1), cy = y.toFixed(1), rr = (st.radius * pxPerKm).toFixed(1);
      // 붉은 지도 위에서도 보이게: 흰 받침선 위에 진한 파란 점선
      return `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="rgba(29,78,216,0.12)" stroke="#ffffff" stroke-width="4" stroke-opacity="0.9" pointer-events="none"></circle>
        <circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"></circle>
        <rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" fill="#1d4ed8" stroke="#fff" stroke-width="1.5" pointer-events="none"></rect>
        <text x="${(x + 7).toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="11" font-weight="700" fill="#1f3f99" stroke="#fff" stroke-width="3" paint-order="stroke" pointer-events="none">${h(f.name.replace('공장', ''))}</text>`;
    }).join('');
    // 지도 위 숫자: 많이 난 시군구 상위 12곳
    const labels = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => {
      const g = regionIndex()[k];
      if (!g) return '';
      return `<text x="${g.c[0]}" y="${g.c[1] + 3}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${n >= 10 || k === st.region ? '#fff' : '#171A20'}" pointer-events="none">${n}</text>`;
    }).join('');
    return `<svg id="dz-map" viewBox="0 0 ${m.w} ${m.h}" style="width:100%;max-height:640px;display:block" xmlns="http://www.w3.org/2000/svg">
        <g id="dz-regions">${paths}</g>
        <path d="${m.sidoLines}" fill="none" stroke="#8a8f98" stroke-width="0.8" pointer-events="none"></path>
        ${labels}${fac}
      </svg>`;
  };

  const legend = () => {
    const ranges = ['1~2', '3~9', '10~29', '30~'];
    return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:11px;color:var(--text-muted);margin-top:6px">
      <span><i style="display:inline-block;width:12px;height:12px;background:var(--bg-soft);border:1px solid var(--border);vertical-align:-2px"></i> 0</span>
      ${ranges.map((t, i) => `<span><i style="display:inline-block;width:12px;height:12px;background:${COLORS[i]};vertical-align:-2px"></i> ${t}건</span>`).join('')}
      <span><i style="display:inline-block;width:12px;height:12px;border:1.5px solid #7a120e;vertical-align:-2px"></i> 최근 ${RECENT_DAYS}일 발생</span>
      <span><i style="display:inline-block;width:9px;height:9px;background:#1d4ed8;vertical-align:0"></i> 공장 <i style="display:inline-block;width:18px;border-top:2px dashed #1d4ed8;vertical-align:3px;margin-left:4px"></i> 반경</span>
    </div>`;
  };

  const sidoBars = (rows) => {
    const list = countBy(rows, r => regionKey(r.region).sido);
    const max = list.length ? list[0][1] : 1;
    if (!list.length) return '<div class="text-muted" style="font-size:12px">해당 기간 발생이 없습니다.</div>';
    return list.map(([s, n]) => `
      <div style="display:flex;align-items:center;gap:8px;margin:3px 0;cursor:pointer" onclick="DiseasePage.setPlace('${h(s)}', '')" title="${h(s)}만 보기">
        <div style="width:54px;font-size:12px;${st.sido === s ? 'font-weight:700;color:var(--danger)' : ''}">${h(shortSido(s))}</div>
        <div style="flex:1;background:var(--bg-soft);height:12px;border-radius:2px;overflow:hidden">
          <div style="width:${Math.max(2, n / max * 100).toFixed(1)}%;height:100%;background:${COLORS[3]}"></div></div>
        <div class="mono" style="width:44px;text-align:right;font-size:12px">${n}</div>
      </div>`).join('');
  };

  const kmText = (d) => (d < 20 ? d.toFixed(1) : String(Math.round(d)));
  const nearCard = (rows) => {
    const radBtns = RADII.map(r => `<button class="btn btn-xs ${st.radius === r ? 'btn-primary' : 'btn-ghost'}" onclick="DiseasePage.setRadius(${r})" title="${LEGAL_RADII[r] ? `${LEGAL_RADII[r]} 바깥 경계(방역실시요령 제2조)` : '내부 감시 반경'}">${r}km${LEGAL_RADII[r] ? ` ${LEGAL_RADII[r]}` : ''}</button>`).join('');
    let emdN = 0, sggN = 0;
    rows.forEach(r => { const l = locOf(r.region); if (l) { if (l.lvl === 'emd') emdN++; else sggN++; } });
    const body = factories().map(f => {
      const hits = rows.map(r => ({ r, loc: locOf(r.region) }))
        .filter(x => x.loc).map(x => ({ ...x, d: km(f.ll, x.loc.ll) }));
      const inR = hits.filter(x => x.d <= st.radius);
      const in30 = inR.filter(x => daysAgo(x.r.occurredAt) <= 30);
      const nearest = hits.filter(x => daysAgo(x.r.occurredAt) <= 30).sort((a, b) => a.d - b.d)[0];
      const zh = zoneHits(rows, f);
      const tone = zh.length || in30.length ? 'var(--danger)' : inR.length ? 'var(--warning)' : 'var(--success)';
      const top = countBy(inR.map(x => x.r), r => diseaseName(r.disease)).map(([k, n]) => `${h(k)} ${n}`).join(' · ');
      const where = (x) => `${h(x.loc.label)}${x.loc.lvl === 'sgg' ? ' (시군구 중심)' : ''}`;
      // 질병마다 가장 가까운 발생 하나로 방역지역을 추정한다
      const seen = new Set();
      const zoneLines = zh.filter(x => { const k = diseaseName(x.r.disease); if (seen.has(k)) return false; seen.add(k); return true; }).map(x => {
        const dz = diseaseName(x.r.disease), z = zoneOf(x.d), rule = ZONE_RULES.find(R => R.re.test(dz));
        return `<div style="margin-top:6px;padding:7px 9px;background:var(--danger-bg);border-radius:4px;font-size:12px;line-height:1.5">
          <b style="color:var(--danger)">${h(dz)} ${z}지역(${ZONE_RANGE[z]}) 해당 가능</b> · ${where(x)} 약 ${kmText(x.d)}km · 발생 ${h(x.r.occurredAt)}
          <div>${rule ? `${h(rule.zones[z])}<span class="text-muted"> — ${h(rule.law)}</span>` : '<span class="text-muted">이 질병은 방역실시요령 고시가 없습니다. 긴급행동지침(SOP)과 시군 공고로 방역대를 확인합니다.</span>'}</div></div>`;
      }).join('');
      return `<div style="border:1px solid var(--border);border-left:3px solid ${tone};border-radius:4px;padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <b>${h(f.name)}</b><span class="mono" style="color:${tone};font-weight:700">${in30.length}<span style="font-size:11px;font-weight:400;color:var(--text-muted)"> 건 / ${st.radius}km · 최근 30일</span></span></div>
        <div class="text-muted" style="font-size:12px;margin-top:4px">조회 기간 전체 반경 안 ${inR.length}건${top ? ' — ' + top : ''}</div>
        <div style="font-size:12px;margin-top:4px">${nearest
          ? `30일 내 가장 가까운 발생: <b>${where(nearest)}</b> 약 ${kmText(nearest.d)}km · ${h(diseaseName(nearest.r.disease))} · ${h(nearest.r.occurredAt)}`
          : '<span class="text-muted">30일 내 발생 없음</span>'}</div>
        ${zoneLines || `<div style="font-size:12px;margin-top:4px;color:var(--success)">방역지역(10km) 안 진행 중 발생 없음</div>`}
      </div>`;
    }).join('');
    return `<div class="card" style="margin:0">
      <div class="card-head"><div class="card-title">공장 인근 발생</div><div style="display:flex;gap:4px;flex-wrap:wrap">${radBtns}</div></div>
      <div style="display:grid;gap:8px">${body}</div>
      <div class="text-muted" style="font-size:11px;margin-top:8px;line-height:1.55">
        방역지역 반경: 관리지역 500m 이내 · 보호지역 500m~3km · 예찰지역 3km 초과~10km (구제역·조류인플루엔자·아프리카돼지열병 방역실시요령 제2조). 시장·군수가 지역 여건에 따라 넓히거나 좁힐 수 있습니다.<br>
        거리는 발생 읍면동 중심점과 공장 사이 직선거리이고, 읍면 이름이 안 맞으면 시군구 중심점으로 잽니다(조회 기간 읍면 기준 ${emdN}건 · 시군구 기준 ${sggN}건). 농장 위치는 공개되지 않으므로 방역지역 해당 여부는 추정이며, 발생 ${ZONE_DAYS}일 안·종식 전 건만 봅니다. 실제 적용은 해당 시군 공고로 확인합니다.</div>
    </div>`;
  };

  // 질병별 기본 현황 — 받아 온 발생 자료에서 바로 뽑는다
  const diseaseTable = () => {
    const rows = filtered('disease');
    const groups = new Map();
    rows.forEach(r => {
      const k = diseaseName(r.disease);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });
    const list = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    if (!list.length) return '';
    const [from, to] = range();
    const tr = list.map(([k, rs]) => {
      const last = rs[0];
      const sp = countBy(rs, r => r.species.replace('-', ' ')).map(([s, n]) => `${h(s)} ${n}`).join(' · ');
      const sidos = new Set(rs.map(r => regionKey(r.region).sido)).size;
      const recent = rs.filter(r => daysAgo(r.occurredAt) <= 30).length;
      const ended = rs.filter(r => r.endedAt).length;
      return `<tr style="cursor:pointer;${st.disease === k ? 'background:var(--danger-bg)' : ''}" onclick="DiseasePage.setFilter('disease', '${st.disease === k ? '' : h(k)}')">
        <td><b>${h(k)}</b></td><td>${gradeText(last.grade)}</td>
        <td class="mono" style="text-align:right">${rs.length}</td>
        <td class="mono" style="text-align:right;${recent ? 'color:var(--danger);font-weight:700' : ''}">${recent}</td>
        <td style="font-size:12px">${sp}</td><td class="mono" style="text-align:right">${sidos}</td>
        <td class="mono">${h(last.occurredAt)}</td><td>${h(regionKey(last.region).key)}</td>
        <td class="mono" style="text-align:right">${ended}</td></tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-head"><div class="card-title">질병별 기본 현황</div>
        <div class="text-muted" style="font-size:12px">줄을 누르면 그 질병만 봅니다 · 법정 종은 KAHIS 분류</div></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>질병</th><th>법정 종</th>
          <th style="text-align:right">발생 건수<div style="font-size:10px;font-weight:400;color:var(--text-muted)">${h(from)} ~ ${h(to)}</div></th>
          <th style="text-align:right">최근 30일 건수<div style="font-size:10px;font-weight:400;color:var(--text-muted)">${recentSpan(30)}</div></th>
          <th>축종별 건수</th><th style="text-align:right">발생 시도 수</th><th>마지막 발생</th><th>마지막 발생지</th><th style="text-align:right">종식된 건수</th></tr></thead>
        <tbody>${tr}</tbody></table></div>
      <div class="text-muted" style="font-size:11px;margin-top:8px">건수는 KAHIS 발생 목록의 줄 수입니다(농장 한 곳의 확진 1번 = 1건, 마릿수 아님). 최근 30일 건수는 발생 건수의 일부이고, 축종별 건수를 더하면 발생 건수와 같습니다. 마릿수는 아래 발생 목록의 두수 칸에 있습니다.</div>
    </div>`;
  };

  const listTable = (rows) => {
    const shown = rows.slice(0, 200);
    const tr = shown.map(r => {
      const k = regionKey(r.region);
      const rest = String(r.region || '').split(/\s+/).slice(k.sgg ? 2 : 1, k.sgg ? 3 : 2).join(' ');
      const fresh = daysAgo(r.occurredAt) <= RECENT_DAYS;
      return `<tr>
        <td class="mono" style="${fresh ? 'color:var(--danger);font-weight:700' : ''}">${h(r.occurredAt)}</td>
        <td class="mono text-muted">${h(r.diagnosedAt)}</td>
        <td>${h(diseaseName(r.disease))}</td><td>${gradeText(r.grade)}</td>
        <td>${h(shortSido(k.sido))} ${h(k.sgg)} <span class="text-muted">${h(rest)}</span></td>
        <td>${h(r.species)}</td><td class="mono" style="text-align:right">${h(r.count)}</td>
        <td class="text-muted">${h(r.agency)}</td><td class="mono">${h(r.endedAt)}</td></tr>`;
    }).join('');
    return `<div class="card">
      <div class="card-head"><div class="card-title">발생 목록</div>
        <div class="text-muted" style="font-size:12px">${rows.length > shown.length ? `최근 ${shown.length}건 표시 · 전체 ${rows.length}건은 엑셀로` : `${rows.length}건`}</div></div>
      <div class="table-wrap" style="max-height:480px;overflow:auto"><table class="data-table">
        <thead><tr><th>발생일</th><th>확진일</th><th>질병</th><th>법정 종</th><th>소재지(읍면까지)</th><th>축종</th><th style="text-align:right">두수</th><th>진단기관</th><th>종식일</th></tr></thead>
        <tbody>${tr || '<tr><td colspan="9" class="text-muted" style="text-align:center;padding:20px">조건에 맞는 발생이 없습니다.</td></tr>'}</tbody></table></div>
    </div>`;
  };

  const body = () => {
    if (st.loading && !st.data) return `<div class="card text-muted" style="text-align:center;padding:50px">KAHIS 발생 자료를 받는 중입니다…</div>`;
    if (st.error && !st.data) return `<div class="card alert-banner alert-danger" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="flex:1">${h(st.error)}</span>
        <button class="btn btn-sm btn-primary" onclick="DiseasePage.reload()">다시 시도</button></div>`;
    const rows = filtered();
    const mapRows = filtered('place');
    return `
      ${st.note ? `<div class="card alert-banner alert-warning" style="margin-bottom:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="flex:1">${h(st.note)}</span>
        <button class="btn btn-xs btn-ghost" onclick="DiseasePage.reload()">다시 연결</button></div>` : ''}
      ${st.loading ? '<div class="text-muted" style="font-size:12px;margin:-6px 0 8px">새 기간 자료를 받는 중…</div>' : ''}
      ${kpis(rows)}
      <div style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,1fr);gap:14px;margin-bottom:14px" class="dz-grid">
        <div class="card" style="margin:0;position:relative">
          <div class="card-head"><div class="card-title">시군구별 발생 분포</div>
            <div class="text-muted" style="font-size:12px">시군구를 누르면 그 지역만 봅니다</div></div>
          ${mapSvg(mapRows)}
          ${legend()}
          <div id="dz-tip" style="position:absolute;display:none;pointer-events:none;background:#171A20;color:#fff;font-size:12px;padding:6px 9px;border-radius:4px;max-width:240px;z-index:5"></div>
        </div>
        <div style="display:grid;gap:14px;align-content:start">
          ${nearCard(mapRows)}
          <div class="card" style="margin:0">
            <div class="card-head"><div class="card-title">시도별 발생</div></div>
            ${sidoBars(filtered('place'))}
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title">월별 발생 추이</div><div class="text-muted" style="font-size:12px">질병별 쌓은 막대</div></div>
        <div style="height:240px;position:relative"><canvas id="dz-chart"></canvas></div>
      </div>
      ${diseaseTable()}
      ${listTable(rows)}`;
  };

  const drawChart = () => {
    const cv = document.getElementById('dz-chart');
    if (chart) { chart.destroy(); chart = null; }
    if (!cv || typeof Chart === 'undefined') return;
    const rows = filtered();
    const months = [];
    const [from, to] = range();
    const d = new Date(from.slice(0, 7) + '-01T00:00:00');
    const end = to.slice(0, 7);
    while (months.length < 120) {
      const k = ymd(d).slice(0, 7);
      months.push(k);
      if (k >= end) break;
      d.setMonth(d.getMonth() + 1);
    }
    const top = countBy(rows, r => diseaseName(r.disease)).slice(0, 6).map(x => x[0]);
    const series = top.concat(rows.some(r => !top.includes(diseaseName(r.disease))) ? ['기타'] : []);
    const ds = series.map((name, i) => ({
      label: name,
      backgroundColor: SERIES[i % SERIES.length],
      data: months.map(m => rows.filter(r => r.occurredAt.slice(0, 7) === m &&
        (name === '기타' ? !top.includes(diseaseName(r.disease)) : diseaseName(r.disease) === name)).length),
    }));
    chart = new Chart(cv, {
      type: 'bar',
      data: { labels: months.map(m => m.slice(2).replace('-', '.')), datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
        scales: { x: { stacked: true, ticks: { font: { size: 10 }, maxTicksLimit: 18 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  };

  const bindMap = () => {
    const svg = document.getElementById('dz-map');
    const tip = document.getElementById('dz-tip');
    if (!svg || !tip) return;
    const rows = filtered('place');
    svg.addEventListener('mousemove', (e) => {
      const p = e.target.closest && e.target.closest('path[data-k]');
      if (!p) { tip.style.display = 'none'; return; }
      const k = p.dataset.k;
      const rs = rows.filter(r => regionKey(r.region).key === k);
      const dz = countBy(rs, r => diseaseName(r.disease)).map(([n, c]) => `${h(n)} ${c}건`).join('<br>');
      tip.innerHTML = `<b>${h(k)}</b><br>${rs.length ? `${rs.length}건 · 마지막 ${h(rs[0].occurredAt)}<br>${dz}` : '발생 없음'}`;
      const box = svg.parentElement.getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - box.left + 12, box.width - 250) + 'px';
      tip.style.top = (e.clientY - box.top + 12) + 'px';
      tip.style.display = 'block';
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    svg.addEventListener('click', (e) => {
      const p = e.target.closest && e.target.closest('path[data-k]');
      if (!p) return;
      const k = p.dataset.k;
      setPlace('', st.region === k ? '' : k);
    });
  };

  const paint = () => {
    const tb = document.getElementById('dz-toolbar');
    const root = document.getElementById('dz-root');
    if (!tb || !root) return;
    tb.innerHTML = toolbar();
    root.innerHTML = body();
    drawChart();
    bindMap();
  };

  // ── 바깥에서 부르는 것 ──
  const render = () => `
    <style>@media (max-width: 900px) { .dz-grid { grid-template-columns: 1fr !important; } }</style>
    <div style="margin-bottom:14px">${typeof DiseaseAlert !== 'undefined' ? DiseaseAlert.render() : ''}</div>
    <div id="dz-toolbar"></div>
    <div id="dz-root"></div>
    <div class="text-muted" style="font-size:11px;margin-top:10px">
      출처: 농림축산식품부 가축질병 위기단계 · 국가가축방역통합시스템(KAHIS) 법정가축전염병 발생현황
      (가축전염병예방법 제3조의2, 같은 법 시행령 제2조의2에 따른 공개 자료). 농장명은 싣지 않습니다.
    </div>`;

  const afterRender = () => {
    if (typeof DiseaseAlert !== 'undefined' && DiseaseAlert.afterRender) DiseaseAlert.afterRender();
    if (st.data) { loadMap().then(paint); return; }
    load();
  };

  const setPreset = (v) => { st.preset = v; st.from = ''; st.to = ''; load(); };
  const setDate = (which, v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    const [f, t] = range();
    st.from = which === 'from' ? v : f;
    st.to = which === 'to' ? v : t;
    st.preset = 'custom';
    load();
  };
  const setFilter = (id, v) => { st[id] = v; paint(); };
  const setPlace = (sido, region) => { st.sido = sido; st.region = region; paint(); };
  const setRadius = (r) => { st.radius = r; paint(); };
  const clearFilters = () => { st.disease = st.species = st.grade = st.sido = st.region = ''; paint(); };
  const reload = () => load();

  const exportXlsx = () => {
    const rows = filtered();
    if (!rows.length || typeof WSXlsx === 'undefined') return;
    const [from, to] = range();
    const head = ['발생일', '확진일', '질병', '법정 종', '광역시도', '시군구', '소재지', '축종', '두수', '진단기관', '종식일'];
    const data = rows.map(r => {
      const k = regionKey(r.region);
      return [r.occurredAt, r.diagnosedAt, diseaseName(r.disease), gradeText(r.grade), k.sido, k.sgg, r.region,
              r.species, isNaN(+r.count) ? r.count : +r.count, r.agency, r.endedAt];
    });
    WSXlsx.download(`가축전염병_발생_${from}_${to}.xlsx`, [{ name: '발생목록', rows: [head, ...data] }]);
  };

  return { render, afterRender, setPreset, setDate, setFilter, setPlace, setRadius, clearFilters, reload, exportXlsx,
           _test: { regionKey, parseHtml, km } };
})();

if (typeof window !== 'undefined') window.DiseasePage = DiseasePage;
