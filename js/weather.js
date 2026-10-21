// ============================================================
// weather.js — 공장 위치별 날씨·습도 자동 기록 (Open-Meteo, API키 불필요·CORS 허용)
//   사료 보관 품질(수분 흡습·곰팡이독소)은 외기 온·습도와 직결 → 자동 로깅·표시·고습경보.
//   참고: 3D 사료빈 온·습도 실시간 모니터링(축산신문 2026) — 부패·오염 사전예방.
// ============================================================

const Weather = (() => {
  const KEY = 'weather_log';
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const notifyWrite = (k) => { try { if (window.__onDbWrite) window.__onDbWrite(k); } catch (_) {} };
  const set = (d) => { localStorage.setItem(KEY, JSON.stringify(d)); notifyWrite(KEY); };

  // 공장 위치 좌표 (설정 변경 가능 — 실제 사업장 인근 좌표)
  const LOCATIONS = {
    NS: { name: '논산공장', lat: 36.187, lon: 127.098 },
    GS: { name: '경산공장', lat: 35.825, lon: 128.741 },
    AS: { name: '아산공장', lat: 36.790, lon: 127.004 },
    HQ: { name: '본사',     lat: 37.566, lon: 126.978 },
  };
  const FACTORY_ORDER = ['NS', 'GS', 'AS'];

  // WMO weather_code → 아이콘·설명
  const WMO = {
    0: ['', '맑음'], 1: ['', '대체로 맑음'], 2: ['', '부분 흐림'], 3: ['', '흐림'],
    45: ['', '안개'], 48: ['', '서리 안개'],
    51: ['', '약한 이슬비'], 53: ['', '이슬비'], 55: ['', '짙은 이슬비'],
    56: ['', '어는 이슬비'], 57: ['', '어는 이슬비'],
    61: ['', '약한 비'], 63: ['', '비'], 65: ['', '강한 비'],
    66: ['', '어는 비'], 67: ['', '어는 비'],
    71: ['', '약한 눈'], 73: ['', '눈'], 75: ['', '강한 눈'], 77: ['', '싸락눈'],
    80: ['', '소나기'], 81: ['', '소나기'], 82: ['', '강한 소나기'],
    85: ['', '소낙눈'], 86: ['', '강한 소낙눈'],
    95: ['', '뇌우'], 96: ['', '우박 뇌우'], 99: ['', '강한 우박 뇌우'],
  };
  const codeInfo = (c) => { const w = WMO[c] || ['', '-']; return { icon: w[0], label: w[1] }; };

  // 습도 경보 임계 (사료 흡습·곰팡이 위험)
  const HUMID_CAUTION = 70;  // 주의
  const HUMID_HIGH = 80;     // 위험
  const humidityLevel = (h) => h == null ? null : (h >= HUMID_HIGH ? 'high' : h >= HUMID_CAUTION ? 'caution' : 'ok');
  const humidityText = (lvl) => ({ high: '고습 위험', caution: '주의', ok: '양호' }[lvl] || '-');

  let _current = {};   // factory → 최근 조회값
  let _fetching = {};

  const fetchCurrent = async (factory) => {
    const loc = LOCATIONS[factory] || LOCATIONS.NS;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
      + `&current=temperature_2m,relative_humidity_2m,weather_code,precipitation,apparent_temperature`
      + `&timezone=Asia%2FSeoul`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('weather http ' + res.status);
    const j = await res.json();
    const c = j.current || {};
    return {
      factory, ts: new Date().toISOString(), obsTime: c.time || '',
      temp: c.temperature_2m, humidity: c.relative_humidity_2m,
      feels: c.apparent_temperature, code: c.weather_code, precip: c.precipitation,
    };
  };

  // 기록: 조회 후 저장(같은 공장 40분 이내 중복이면 캐시만 갱신, 저장 생략)
  const record = async (factory) => {
    if (_fetching[factory]) return _current[factory] || null;
    _fetching[factory] = true;
    try {
      const r = await fetchCurrent(factory);
      _current[factory] = r;
      const log = get();
      const last = log.filter(x => x.factory === factory).sort((a, b) => b.ts.localeCompare(a.ts))[0];
      if (!last || (Date.now() - new Date(last.ts).getTime()) >= 40 * 60 * 1000) {
        log.push({ id: 'W-' + factory + '-' + Date.now().toString(36), ...r });
        if (log.length > 3000) log.splice(0, log.length - 3000);
        set(log);
      }
      try { document.dispatchEvent(new CustomEvent('weather:update', { detail: r })); } catch (_) {}
      return r;
    } catch (e) {
      console.warn('[Weather] record fail:', e.message);
      return null;
    } finally { _fetching[factory] = false; }
  };

  const current = (factory) => _current[factory] || getLatest(factory);
  const getLatest = (factory) => get()
    .filter(x => !factory || factory === 'ALL' || x.factory === factory)
    .sort((a, b) => b.ts.localeCompare(a.ts))[0] || null;
  const getRecent = (factory, limit = 300) => get()
    .filter(x => !factory || factory === 'ALL' || x.factory === factory)
    .sort((a, b) => a.ts.localeCompare(b.ts)).slice(-limit);
  const allLatest = () => FACTORY_ORDER.map(f => ({ factory: f, name: LOCATIONS[f].name, data: current(f) }));  // 본사(HQ) 제외 — 좌표 있어도 표시 불필요

  // 분석·생산 레코드에 붙일 현재 기상 스냅샷
  const stamp = (factory) => {
    const c = current((factory && factory !== 'ALL') ? factory : 'NS');
    return c ? { temp: c.temp, humidity: c.humidity, code: c.code, at: c.ts } : null;
  };

  const curFactory = () => { try { const f = App.getFactory && App.getFactory(); return (f && f !== 'ALL') ? f : 'NS'; } catch (_) { return 'NS'; } };

  let _timer = null;
  const init = () => {
    // 진입 즉시 현재 공장 + 주요 공장 1회 기록(순차로 부하 분산)
    record(curFactory());
    FACTORY_ORDER.forEach((c, i) => setTimeout(() => record(c), 900 * (i + 1)));
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => record(curFactory()), 60 * 60 * 1000);  // 1시간마다 자동 기록
  };

  return {
    LOCATIONS, FACTORY_ORDER, codeInfo, HUMID_CAUTION, HUMID_HIGH, humidityLevel, humidityText,
    fetchCurrent, record, current, getLatest, getRecent, allLatest, stamp, init,
  };
})();

if (typeof window !== 'undefined') window.Weather = Weather;

// ============================================================
// WeatherPage — 날씨·습도 기록 화면 (품질·실험실)
// ============================================================
const WeatherPage = (() => {
  let chart = null;
  let selFactory = 'ALL';
  let _booted = false;

  const fmtTime = (iso) => { const s = String(iso || ''); return s ? s.slice(5, 16).replace('T', ' ') : '-'; };
  const humBadge = (h) => {
    const lvl = Weather.humidityLevel(h);
    if (!lvl) return '<span class="text-muted">-</span>';
    const cls = lvl === 'high' ? 'high' : lvl === 'caution' ? 'low' : 'ok';
    return `<span class="verdict verdict-${cls}">${h}% · ${Weather.humidityText(lvl)}</span>`;
  };

  const currentCard = (row) => {
    const d = row.data;
    if (!d) return `<div class="card" style="margin:0;text-align:center;min-height:150px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px">
      <div class="section-label" style="margin:0">${esc(row.name)}</div>
      <div class="text-muted" style="font-size:13px">데이터 수집 대기…<br><span style="font-size:11px">인터넷 연결 시 자동 기록</span></div></div>`;
    const ci = Weather.codeInfo(d.code);
    const lvl = Weather.humidityLevel(d.humidity);
    const border = lvl === 'high' ? 'border-color:#e0565688' : lvl === 'caution' ? 'border-color:#e0a65688' : '';
    return `<div class="card" style="margin:0;min-height:150px;${border}">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="section-label" style="margin:0">${esc(row.name)}</div>
        <div style="font-size:30px;line-height:1">${ci.icon}</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:14px;margin-top:4px">
        <div><div class="mono" style="font-size:30px;font-weight:800;line-height:1">${d.temp != null ? d.temp.toFixed(1) : '-'}<span style="font-size:15px">°C</span></div>
          <div class="text-muted" style="font-size:11px">체감 ${d.feels != null ? d.feels.toFixed(1) + '°' : '-'} · ${esc(ci.label)}</div></div>
        <div style="margin-left:auto;text-align:right">
          <div class="mono" style="font-size:22px;font-weight:800;line-height:1;color:${lvl === 'high' ? '#ff6b81' : lvl === 'caution' ? '#e0a656' : 'inherit'}">${d.humidity != null ? d.humidity : '-'}<span style="font-size:13px">%</span></div>
          <div style="font-size:11px">${humBadge(d.humidity)}</div></div>
      </div>
      <div class="text-muted" style="font-size:11px;margin-top:8px">강수 ${d.precip != null ? d.precip : 0}mm · 관측 ${fmtTime(d.obsTime || d.ts)}</div>
    </div>`;
  };

  const render = () => {
    const rows = Weather.allLatest();
    const cards = rows.map(currentCard).join('');
    // 고습 경보
    const alerts = rows.filter(r => r.data && Weather.humidityLevel(r.data.humidity) !== 'ok' && Weather.humidityLevel(r.data.humidity));
    const alertBanner = alerts.length ? `
      <div class="card alert-banner alert-danger">
        <b>고습 경보</b> — ${alerts.map(a => `${esc(a.name)} <b>${a.data.humidity}%</b>`).join(' · ')} ·
        외기 습도가 높아 <b>사료 흡습·곰팡이독소 발생 위험</b>이 있습니다. 사일로·톤백 밀폐, 제습·환기, 재고 회전(FIFO)을 점검하세요.
        <span class="text-muted" style="font-size:12px">(주의 ${Weather.HUMID_CAUTION}% / 위험 ${Weather.HUMID_HIGH}% 기준)</span>
      </div>` : '';

    // 기록 표(최근)
    const log = Weather.getRecent(selFactory, 300).slice().reverse().slice(0, 60);
    const logRows = log.length ? log.map(x => {
      const ci = Weather.codeInfo(x.code);
      return `<tr>
        <td class="text-muted">${fmtTime(x.ts)}</td>
        <td>${esc((Weather.LOCATIONS[x.factory] || {}).name || x.factory)}</td>
        <td class="mono">${x.temp != null ? x.temp.toFixed(1) : '-'}°</td>
        <td class="mono">${x.feels != null ? x.feels.toFixed(1) : '-'}°</td>
        <td>${humBadge(x.humidity)}</td>
        <td class="mono">${x.precip != null ? x.precip : 0}mm</td>
        <td>${ci.icon} ${esc(ci.label)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="text-muted" style="text-align:center;padding:20px">기록이 없습니다. 인터넷 연결 시 자동으로 수집됩니다. (지금 기록)</td></tr>`;

    const facBtns = [['ALL', '전체']].concat(Weather.FACTORY_ORDER.map(f => [f, (Weather.LOCATIONS[f] || {}).name || f]))
      .map(([v, l]) => `<button class="btn btn-sm ${selFactory === v ? 'btn-primary' : 'btn-ghost'}" onclick="WeatherPage.setFactory('${v}')">${l}</button>`).join('');

    return `
    ${alertBanner}
    <div class="card-head" style="margin-bottom:12px">
      <div class="text-muted" style="font-size:12px">Open-Meteo 기상데이터 · 1시간마다 자동 기록 · 사료 보관 습도관리</div>
      <button class="btn btn-primary btn-sm" onclick="WeatherPage.refresh()">지금 기록</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:14px">${cards}</div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <div class="card-title">온도·습도 추이</div>
        <div style="display:flex;gap:6px">${facBtns}</div>
      </div>
      <div style="height:280px;position:relative"><canvas id="weather-chart"></canvas></div>
    </div>

    <div class="card">
      <div class="section-label">기록 (최근 60건${selFactory !== 'ALL' ? ' · ' + ((Weather.LOCATIONS[selFactory] || {}).name || '') : ''})</div>
      <div class="table-wrap" style="max-height:360px;overflow:auto">
        <table class="data-table"><thead><tr><th>일시</th><th>위치</th><th>온도</th><th>체감</th><th>습도</th><th>강수</th><th>날씨</th></tr></thead>
          <tbody>${logRows}</tbody></table>
      </div>
    </div>`;
  };

  const drawChart = () => {
    const canvas = document.getElementById('weather-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const data = Weather.getRecent(selFactory, 100);
    const labels = data.map(x => fmtTime(x.ts));
    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: '온도(°C)', data: data.map(x => x.temp), borderColor: '#ff8c42', backgroundColor: 'rgba(255,140,66,0.12)', tension: 0.3, pointRadius: 2, yAxisID: 'y', fill: true },
          { label: '습도(%)', data: data.map(x => x.humidity), borderColor: '#4f9cff', backgroundColor: 'rgba(79,156,255,0.10)', tension: 0.3, pointRadius: 2, yAxisID: 'y1', fill: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } },
          annotation: false,
        },
        scales: {
          x: { ticks: { color: '#8892a6', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { position: 'left', title: { display: true, text: '°C', color: '#ff8c42' }, ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y1: { position: 'right', min: 0, max: 100, title: { display: true, text: '%', color: '#4f9cff' }, ticks: { color: '#8892a6', font: { size: 10 } }, grid: { drawOnChartArea: false } },
        },
      },
    });
  };

  const afterRender = () => {
    drawChart();
    if (!_booted) { _booted = true; // 최초 진입 시 전 공장 즉시 1회 기록 후 갱신
      Promise.all(Weather.FACTORY_ORDER.map(f => Weather.record(f))).then(() => { if (App.getWorkspace && App.getWorkspace() === 'quality') App.refreshPage(); });
    }
  };
  const setFactory = (f) => { selFactory = f; App.refreshPage(); };
  const refresh = () => {
    App.toast('현재 날씨를 기록합니다…', 'info');
    Promise.all(Weather.FACTORY_ORDER.map(f => Weather.record(f))).then(() => { App.toast('날씨·습도 기록 완료', 'success'); App.refreshPage(); });
  };

  return { render, afterRender, setFactory, refresh };
})();

if (typeof window !== 'undefined') window.WeatherPage = WeatherPage;
