// ============================================================
// law_monitor.js — 법령 모니터 (인증관리 > 법령)
//
//   서버(/api/law-digest)가 만들어 준 정리본을 탭별로 보여준다.
//   무엇이 바뀌었는지는 서버(law_monitor.py)가 스냅샷 비교로 정한다. 화면은 판단하지 않는다.
//
//   · 감시 법령은 기본 목록 + 화면에서 검색해 추가한 목록(/api/law-watch, 전 사용자 공유)
//   · 모든 탭에 검색어·구분·분류·소관부처 필터
//   2026-10-16 독립 사이트(법령모니터링, 3100)를 플랫폼으로 합쳤다.
// ============================================================

const LawMonitorPage = (() => {
  let data = null;
  let tab = 'change';
  let loading = false;
  let loadErr = '';
  let autoTried = false;   // 화면을 열 때 자동 불러오기는 한 번만 — 실패할 때마다 다시 그리며 재시도하면 끝없이 깜박인다
  const filter = { q: '', kind: '', cat: '', ministry: '', core: '' };
  const finder = { q: '', kind: 'all', cat: '', items: null, busy: false, err: '' };

  const TABS = [
    { id: 'change',   label: '변경 알림' },
    { id: 'bill',     label: '입법예고' },
    { id: 'upcoming', label: '시행 예정' },
    { id: 'law',      label: '감시 법령' },
    { id: 'rule',     label: '관련 고시' },
  ];

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const actor = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) { return ''; } };

  // 시행일까지 남은 일수 — 로컬 기준으로 센다(UTC 로 바꾸면 하루가 어긋난다)
  const daysUntil = (ymd) => {
    const p = String(ymd || '').split('-');
    if (p.length !== 3) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d) ? null : Math.round((d - t) / 86400000);
  };
  const ddayTag = (ymd) => {
    const d = daysUntil(ymd);
    if (d == null) return '<span class="badge badge-default">-</span>';
    const cls = d <= 30 ? 'badge-fail' : d <= 90 ? 'badge-warning' : 'badge-default';
    return `<span class="badge ${cls}">${d === 0 ? '오늘' : d < 0 ? '지남' : 'D-' + d}</span>`;
  };
  // 입법예고 '남은 기간'은 사이트가 "21일" 형태로 준다
  const leftTag = (text) => {
    const n = parseInt(String(text).replace(/[^0-9]/g, ''), 10);
    if (isNaN(n)) return `<span class="badge badge-default">${esc(text || '-')}</span>`;
    const cls = n <= 7 ? 'badge-fail' : n <= 20 ? 'badge-warning' : 'badge-default';
    return `<span class="badge ${cls}">${n}일 남음</span>`;
  };
  const link = (url, label) => url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || '원문')}</a>`
    : '<span class="text-muted">-</span>';
  const kindLabel = (k) => k === 'rule' ? '고시·훈령' : '법령';
  const sub = (t) => t ? `<div class="text-xs text-muted">${esc(t)}</div>` : '';

  // ── 필터 ──
  const rowsOf = (t) => {
    if (!data) return [];
    if (t === 'change') return data.changes || [];
    if (t === 'bill') return data.bills || [];
    if (t === 'upcoming') return data.upcoming || [];
    if (t === 'law') return data.laws || [];
    return data.rules || [];
  };
  const pass = (x) => {
    const q = filter.q.trim().toLowerCase();
    if (q && !`${x.name || ''} ${x.title || ''} ${x.ministry || ''} ${x.field || ''}`.toLowerCase().includes(q)) return false;
    if (filter.kind && tab !== 'bill' && x.kind !== filter.kind) return false;
    if (filter.cat && (x.category || '') !== filter.cat) return false;
    if (filter.ministry && (x.ministry || '') !== filter.ministry) return false;
    if (filter.core && tab === 'bill' && (filter.core === 'core') !== !!x.core) return false;
    return true;
  };

  const filterBar = () => {
    const all = rowsOf(tab);
    const ministries = [...new Set(all.map(x => x.ministry).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (filter.ministry && !ministries.includes(filter.ministry)) filter.ministry = '';
    const cats = (data && data.categories) || [];
    const opt = (v, label, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(label)}</option>`;
    return `
      <div class="lm-filters">
        <input type="search" class="form-input form-input-sm lm-q" id="lm-q" placeholder="이름·소관부처 검색"
               value="${esc(filter.q)}" oninput="LawMonitorPage.setFilter('q', this.value)">
        ${tab === 'bill'
          ? `<select class="form-input form-input-sm" onchange="LawMonitorPage.setFilter('core', this.value)">
               ${opt('', '핵심·관련 전체', filter.core)}${opt('core', '핵심만', filter.core)}${opt('rel', '관련만', filter.core)}
             </select>`
          : `<select class="form-input form-input-sm" onchange="LawMonitorPage.setFilter('kind', this.value)">
               ${opt('', '법령·고시 전체', filter.kind)}${opt('law', '법령', filter.kind)}${opt('rule', '고시·훈령', filter.kind)}
             </select>`}
        <select class="form-input form-input-sm" onchange="LawMonitorPage.setFilter('cat', this.value)">
          ${opt('', '분류 전체', filter.cat)}${cats.map(c => opt(c, c, filter.cat)).join('')}
        </select>
        <select class="form-input form-input-sm" onchange="LawMonitorPage.setFilter('ministry', this.value)">
          ${opt('', '소관부처 전체', filter.ministry)}${ministries.map(m => opt(m, m, filter.ministry)).join('')}
        </select>
        ${(filter.q || filter.kind || filter.cat || filter.ministry || filter.core)
          ? '<button class="btn btn-ghost btn-sm" onclick="LawMonitorPage.clearFilter()">필터 해제</button>' : ''}
        <span class="lm-count" id="lm-count"></span>
      </div>`;
  };

  const table = (head, rows) => `
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  const empty = (title, msg) => `<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(msg || '')}</p></div>`;
  const note = (html) => `<div class="lm-note">${html}</div>`;
  const catTag = (c) => c ? `<span class="badge badge-default">${esc(c)}</span>` : '';

  // ── 탭별 본문 ──
  const viewChange = (rows) => {
    if (!(data.changes || []).length) {
      return note('감시 대상 법령·고시를 직전 확인 시점과 비교합니다.')
        + empty('새로운 변경이 없습니다', data.firstRun
          ? '오늘 처음 확인해 기준을 잡았습니다. 다음 확인부터 달라진 것만 여기 표시됩니다.'
          : `마지막 확인(${data.checkedDate || '-'}) 기준으로 감시 대상에 개정이 없습니다.`);
    }
    return note('직전 확인 이후 <b>새로 생기거나 개정된 것</b>입니다. 최근 90일치를 보관합니다.')
      + table(['감지일', '구분', '종류', '명칭', '공포·발령', '시행일', '소관부처', '원문'], rows.map(x => `
        <tr>
          <td class="td-mono">${esc(x.detectedAt)}</td>
          <td><span class="badge ${x.what === '신규' ? 'badge-info' : 'badge-warning'}">${esc(x.what)}</span></td>
          <td>${kindLabel(x.kind)}</td>
          <td><b>${esc(x.name)}</b>${sub([x.revision, x.category].filter(Boolean).join(' · '))}</td>
          <td class="td-mono">${x.prevPromulgated ? `<span class="text-muted">${esc(x.prevPromulgated)}</span> → ` : ''}${esc(x.promulgated)}</td>
          <td class="td-mono">${esc(x.effective) || '-'}</td>
          <td>${esc(x.ministry) || '-'}</td>
          <td>${link(x.link)}</td>
        </tr>`));
  };

  const viewBill = (rows) => {
    if (!(data.bills || []).length) {
      return note('국민참여입법센터에서 감시 법령·사료·축산·반려용품 관련 입법예고를 찾습니다.')
        + empty('진행 중인 관련 입법예고가 없습니다', '최근 게시분에 관련 예고가 없습니다. 새로 올라오면 여기에 표시됩니다.');
    }
    return note('의견 제출이 가능한 입법예고입니다. <span class="badge badge-fail">핵심</span> 은 감시 법령의 개정 예고이거나 제목에 관련 용어가 직접 들어간 건입니다.')
      + table(['구분', '법령안', '분류', '소관부처', '분야', '의견 접수기간', '남은 기간', '원문'], rows.map(x => `
        <tr>
          <td><span class="badge ${x.core ? 'badge-fail' : 'badge-default'}">${x.core ? '핵심' : '관련'}</span></td>
          <td><b>${esc(x.title)}</b></td>
          <td>${catTag(x.category)}</td>
          <td>${esc(x.ministry)}</td>
          <td>${esc(x.field) || '-'}</td>
          <td class="td-mono">${esc(x.period)}</td>
          <td>${leftTag(x.daysLeft)}</td>
          <td>${link(x.link, '의견 제출')}</td>
        </tr>`));
  };

  const viewUpcoming = (rows) => {
    if (!(data.upcoming || []).length) {
      return note('공포됐지만 아직 시행 전인 개정을 모읍니다.')
        + empty('시행 예정인 개정이 없습니다', '감시 대상 중 시행일이 오늘 이후인 건이 없습니다.');
    }
    return note('공포는 됐지만 <b>아직 시행 전</b>인 개정입니다. 시행일까지 남은 기간을 확인하세요.')
      + table(['시행일', '남은 기간', '종류', '명칭', '공포·발령', '소관부처', '원문'], rows.map(x => `
        <tr>
          <td class="td-mono"><b>${esc(x.effective)}</b></td>
          <td>${ddayTag(x.effective)}</td>
          <td>${kindLabel(x.kind)}</td>
          <td>${esc(x.name)}${sub([x.revision, x.category].filter(Boolean).join(' · '))}</td>
          <td class="td-mono">${esc(x.promulgated) || '-'}</td>
          <td>${esc(x.ministry) || '-'}</td>
          <td>${link(x.link)}</td>
        </tr>`));
  };

  const srcTag = (x) => x.source === '추가'
    ? '<span class="badge badge-info">추가</span>'
    : x.source === '검색' ? '<span class="badge badge-default">사료 검색</span>'
    : '<span class="badge badge-default">기본</span>';

  const viewList = (rows, isRule) => {
    const all = isRule ? (data.rules || []) : (data.laws || []);
    if (!all.length) return empty(isRule ? '관련 고시를 불러오지 못했습니다' : '감시 법령을 불러오지 못했습니다', '잠시 후 "지금 다시 확인"을 눌러 주세요.');
    const watch = data.watchlist || [];
    const addedBy = (x) => {
      const w = watch.find(v => v.kind === x.kind && v.name === x.name);
      return w ? [w.addedBy, w.addedAt].filter(Boolean).join(' · ') : '';
    };
    return note(isRule
        ? '사료를 규율하는 고시·훈령(소관부처로 추림)과 이름으로 지정한 고시입니다. <b>법령 추가</b>로 검색해 더 넣을 수 있습니다.'
        : '상시 감시하는 법령입니다. 개정되면 <b>변경 알림</b> 탭에 나타납니다. <b>법령 추가</b>로 검색해 더 넣을 수 있습니다.')
      + table(['출처', '명칭', '분류', '제·개정', '공포·발령', '시행일', '소관부처', '원문', ''], rows.map(x => `
        <tr>
          <td>${srcTag(x)}</td>
          <td><b>${esc(x.name)}</b>${x.source === '추가' ? sub('추가 ' + addedBy(x)) : ''}</td>
          <td>${catTag(x.category)}</td>
          <td>${esc(x.revision) || '-'}</td>
          <td class="td-mono">${esc(x.promulgated) || '-'}</td>
          <td class="td-mono">${esc(x.effective) || '-'}</td>
          <td>${esc(x.ministry) || '-'}</td>
          <td>${link(x.link)}</td>
          <td>${x.source === '추가'
            ? `<button class="btn btn-ghost btn-xs" data-kind="${esc(x.kind)}" data-name="${esc(x.name)}" onclick="LawMonitorPage.removeWatch(this.dataset.kind, this.dataset.name)">감시 해제</button>`
            : ''}</td>
        </tr>`));
  };

  const panelHtml = () => {
    if (!data) {
      if (loadErr) {
        // 서버에 못 닿은 것인지(주소·연결 문제), 서버가 법령 사이트에서 못 받아온 것인지 구분해 알려준다
        const noServer = /Failed to fetch|NetworkError|서버 응답 404|응답 시간이 초과|Load failed/i.test(loadErr);
        return `<div class="empty-state">
          <h3>정보를 불러오지 못했습니다</h3>
          <p>${noServer
            ? `품질관리 서버에 연결되지 않았습니다. 지금 접속한 주소는 <b>${esc(location.host || location.href)}</b> 입니다.
               사내 주소 <b>192.100.160.52:3000</b> 으로 접속했는지, 서버 PC가 켜져 있는지 확인하세요.`
            : '서버가 국가법령정보센터·국민참여입법센터에서 정보를 받아오지 못했습니다. 잠시 후 다시 시도하세요.'}</p>
          <p class="text-xs text-muted">${esc(loadErr)}</p>
          <button class="btn btn-primary btn-sm" onclick="LawMonitorPage.load(false)">다시 시도</button>
        </div>`;
      }
      return '<div class="lm-loading">법령 정보를 불러오는 중입니다… 처음에는 30초 정도 걸릴 수 있습니다.</div>';
    }
    const rows = rowsOf(tab).filter(pass);
    if (rowsOf(tab).length && !rows.length) return empty('필터에 맞는 항목이 없습니다', '필터를 바꾸거나 해제해 보세요.');
    if (tab === 'change') return viewChange(rows);
    if (tab === 'bill') return viewBill(rows);
    if (tab === 'upcoming') return viewUpcoming(rows);
    return viewList(rows, tab === 'rule');
  };

  // 필터 입력 중에는 입력창이 다시 그려지면 포커스가 날아간다 — 본문만 갈아 끼운다
  const paintPanel = () => {
    const el = document.getElementById('lm-panel');
    if (el) el.innerHTML = panelHtml();
    const cnt = document.getElementById('lm-count');
    if (cnt && data) {
      const all = rowsOf(tab).length, shown = rowsOf(tab).filter(pass).length;
      cnt.textContent = all === shown ? `${all}건` : `${shown} / ${all}건`;
    }
  };

  // ── 법령 추가(검색) 모달 ──
  const finderHtml = () => {
    const cats = (data && data.categories) || ['사료·축산', '반려용품·표시광고', '기타'];
    if (!finder.cat) finder.cat = cats[0];
    const list = finder.items;
    return `
      <div class="lm-finder-bar">
        <input type="search" class="form-input" id="lm-find-q" placeholder="법령·고시 이름 일부 (예: 비료관리법, 동물보호)"
               value="${esc(finder.q)}" onkeydown="if(event.key==='Enter')LawMonitorPage.find()">
        <select class="form-input" id="lm-find-kind">
          <option value="all" ${finder.kind === 'all' ? 'selected' : ''}>법령·고시</option>
          <option value="law" ${finder.kind === 'law' ? 'selected' : ''}>법령만</option>
          <option value="rule" ${finder.kind === 'rule' ? 'selected' : ''}>고시·훈령만</option>
        </select>
        <button class="btn btn-primary" onclick="LawMonitorPage.find()" ${finder.busy ? 'disabled' : ''}>${finder.busy ? '검색 중…' : '검색'}</button>
      </div>
      <div class="lm-finder-cat">
        <label class="form-label">추가할 때 분류</label>
        <select class="form-input form-input-sm" onchange="LawMonitorPage.setFinderCat(this.value)">
          ${cats.map(c => `<option ${finder.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <span class="text-xs text-muted">추가하면 그 시점을 기준으로 이후 개정만 알립니다. 시행령·시행규칙은 따로 추가합니다.</span>
      </div>
      ${finder.err ? `<div class="lm-note lm-err">${esc(finder.err)}</div>` : ''}
      ${list == null ? '<div class="text-sm text-muted" style="padding:12px 0">국가법령정보센터에서 현행 법령·고시를 찾습니다. 두 글자 이상 입력하세요.</div>'
        : !list.length ? '<div class="text-sm text-muted" style="padding:12px 0">검색 결과가 없습니다.</div>'
        : `<div class="table-wrapper lm-finder-list">
            <table class="data-table">
              <thead><tr><th>종류</th><th>명칭</th><th>소관부처</th><th>공포·발령</th><th>원문</th><th></th></tr></thead>
              <tbody>${list.map(x => `
                <tr>
                  <td>${kindLabel(x.kind)}</td>
                  <td><b>${esc(x.name)}</b>${sub(x.revision)}</td>
                  <td>${esc(x.ministry) || '-'}</td>
                  <td class="td-mono">${esc(x.promulgated) || '-'}</td>
                  <td>${link(x.link)}</td>
                  <td>${x.watched ? '<span class="badge badge-pass">감시 중</span>'
                    : `<button class="btn btn-outline-primary btn-xs" data-kind="${esc(x.kind)}" data-name="${esc(x.name)}"
                         onclick="LawMonitorPage.addWatch(this.dataset.kind, this.dataset.name, this)">추가</button>`}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>`}`;
  };
  const paintFinder = () => {
    const el = document.getElementById('lm-finder-body');
    if (el) el.innerHTML = finderHtml();
  };

  // ── 화면 ──
  const render = () => {
    const n = (k) => data ? (data[k] || []).length : '-';
    const nWatch = data ? (data.laws || []).length + (data.rules || []).length : '-';
    const metric = (id, val, label, hot) => `
      <div class="lm-metric ${hot ? 'hot' : ''} ${tab === id ? 'on' : ''}" onclick="LawMonitorPage.setTab('${id}')" title="${esc(label)} 보기">
        <span>${val}</span><label>${label}</label>
      </div>`;
    return `
      <div class="fade-in">
        <div class="module-hero mb-16">
          <div>
            <div class="module-kicker">인증관리 · 법령</div>
            <h2>법령 모니터</h2>
            <p>사료·축산과 반려용품 표시·광고 관련 법령·고시의 개정을 감시하고, 의견 제출이 가능한 입법예고를 모읍니다.
               마지막으로 확인한 시점과 비교하므로 며칠 걸러 열어도 그 사이 변경을 놓치지 않습니다.</p>
          </div>
          <div class="module-metrics">
            ${metric('change', n('changes'), '새 변경', data && (data.changes || []).length)}
            ${metric('bill', n('bills'), '입법예고', data && (data.bills || []).length)}
            ${metric('upcoming', n('upcoming'), '시행 예정', false)}
            ${metric('law', nWatch, '감시 중', false)}
          </div>
        </div>

        <div class="lm-toolbar">
          <span class="text-sm text-muted" id="lm-checked">${data ? `마지막 확인 ${esc(data.checkedDate || '-')} (${esc(data.updatedAt || '')})` : (loading ? '확인 중…' : '')}</span>
          <div class="flex gap-8">
            <button class="btn btn-sm" onclick="LawMonitorPage.openFinder()">법령 추가</button>
            <button class="btn btn-sm btn-primary" id="lm-refresh" onclick="LawMonitorPage.load(true)" ${loading ? 'disabled' : ''}>${loading ? '확인 중…' : '지금 다시 확인'}</button>
          </div>
        </div>

        <div class="tabs mb-12">
          ${TABS.map(t => `<div class="tab ${tab === t.id ? 'active' : ''}" onclick="LawMonitorPage.setTab('${t.id}')">${t.label}</div>`).join('')}
        </div>

        ${data ? filterBar() : ''}
        <div id="lm-panel">${panelHtml()}</div>

        <div class="lm-foot text-xs text-muted">
          출처 · <a href="https://www.law.go.kr" target="_blank" rel="noopener noreferrer">국가법령정보센터</a>
          · <a href="https://opinion.lawmaking.go.kr" target="_blank" rel="noopener noreferrer">국민참여입법센터</a>
          — 사내 열람용입니다. 법적 효력은 원문을 따르며, 조치 전 반드시 원문을 확인하세요.
        </div>

        <div class="modal-overlay" id="lm-finder-modal">
          <div class="modal modal-xl">
            <div class="modal-header">
              <div class="modal-title">감시 법령·고시 추가</div>
              <button class="modal-close" onclick="LawMonitorPage.closeFinder()">✕</button>
            </div>
            <div id="lm-finder-body" style="padding:16px">${finderHtml()}</div>
          </div>
        </div>
      </div>`;
  };

  const afterRender = () => {
    if (!data && !loading && !autoTried) { autoTried = true; load(false); }
    paintPanel();
  };

  // 수집은 수십 초 걸릴 수 있다. 이미 받아 둔 내용이 있으면 갱신 중에도 그대로 보여준다.
  const load = (force) => {
    if (loading) return;
    loading = true; loadErr = '';
    if (document.getElementById('lm-panel')) refreshShell();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 120000) : null;
    fetch('/api/law-digest' + (force ? '?refresh=1' : ''), { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(r => r.json().then(j => { if (!r.ok || j.error) throw new Error(j.error || ('서버 응답 ' + r.status)); return j; }))
      .then(d => {
        data = d;
        if (force) App.toast(`최신 정보로 갱신했습니다 (${d.checkedDate || ''})`, 'success');
      })
      .catch(e => {
        const msg = e && e.name === 'AbortError' ? '응답 시간이 초과됐습니다' : (e && e.message) || '';
        if (data) App.toast('갱신하지 못했습니다 — 기존 정보를 그대로 보여줍니다. ' + msg, 'warning');
        else loadErr = msg;
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        loading = false;
        if (document.getElementById('lm-panel')) refreshShell();
      });
  };

  // 같은 화면에 있을 때만 다시 그린다(로딩 중 다른 메뉴로 갔으면 건드리지 않는다)
  const refreshShell = () => {
    const keepQ = document.activeElement && document.activeElement.id === 'lm-q';
    App.refreshPage();
    if (keepQ) setTimeout(() => { const q = document.getElementById('lm-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 80);
  };

  const setTab = (t) => {
    if (!TABS.some(x => x.id === t)) return;
    tab = t;
    filter.ministry = ''; filter.core = '';
    App.refreshPage();
  };

  let qTimer = null;
  const setFilter = (k, v) => {
    filter[k] = v;
    if (k === 'q') { clearTimeout(qTimer); qTimer = setTimeout(paintPanel, 150); return; }
    App.refreshPage();
  };
  const clearFilter = () => { Object.keys(filter).forEach(k => { filter[k] = ''; }); App.refreshPage(); };

  // ── 감시 목록 ──
  const openFinder = () => {
    finder.err = '';
    paintFinder();
    document.getElementById('lm-finder-modal')?.classList.add('open');
    setTimeout(() => document.getElementById('lm-find-q')?.focus(), 50);
  };
  // 닫을 때 뒤 화면(목록·필터·숫자)을 한 번에 새로 그린다
  const closeFinder = () => { document.getElementById('lm-finder-modal')?.classList.remove('open'); App.refreshPage(); };
  const setFinderCat = (c) => { finder.cat = c; };

  const find = () => {
    finder.q = (document.getElementById('lm-find-q')?.value || '').trim();
    finder.kind = document.getElementById('lm-find-kind')?.value || 'all';
    if (finder.q.length < 2) { finder.err = '두 글자 이상 입력하세요.'; paintFinder(); return; }
    finder.busy = true; finder.err = ''; paintFinder();
    fetch(`/api/law-search?q=${encodeURIComponent(finder.q)}&kind=${encodeURIComponent(finder.kind)}`, { cache: 'no-store' })
      .then(r => r.json().then(j => { if (!r.ok || j.error) throw new Error(j.error || ('서버 응답 ' + r.status)); return j; }))
      .then(j => { finder.items = j.items || []; })
      .catch(e => { finder.err = '검색하지 못했습니다 — ' + ((e && e.message) || ''); })
      .finally(() => { finder.busy = false; paintFinder(); });
  };

  const post = (body) => fetch('/api/law-watch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json().then(j => { if (!r.ok || j.error) throw new Error(j.error || ('서버 응답 ' + r.status)); return j; }));

  const addWatch = (kind, name, btn) => {
    if (btn) { btn.disabled = true; btn.textContent = '추가 중…'; }
    post({ action: 'add', kind, name, category: finder.cat, by: actor() })
      .then(j => {
        const it = j.item;
        if (data && it) {
          const key = kind === 'rule' ? 'rules' : 'laws';
          data[key] = (data[key] || []).filter(x => x.id !== it.id).concat(it);
          data.watchlist = (data.watchlist || []).concat({ kind, name: it.name, category: finder.cat, addedBy: actor(), addedAt: '방금' });
        }
        (finder.items || []).forEach(x => { if (x.kind === kind && x.name === name) x.watched = true; });
        App.toast(`감시 목록에 추가했습니다 — ${name}`, 'success');
        paintFinder();
        refreshAfterModal();
      })
      .catch(e => {
        finder.err = (e && e.message) || '추가하지 못했습니다';
        paintFinder();
      });
  };

  const removeWatch = (kind, name) => {
    if (!confirm(`"${name}" 을(를) 감시 목록에서 뺄까요?\n기본 감시 법령은 그대로 남습니다.`)) return;
    post({ action: 'remove', kind, name })
      .then(() => {
        if (data) {
          const key = kind === 'rule' ? 'rules' : 'laws';
          data[key] = (data[key] || []).filter(x => !(x.source === '추가' && x.name === name));
          data.watchlist = (data.watchlist || []).filter(w => !(w.kind === kind && w.name === name));
        }
        App.toast(`감시를 해제했습니다 — ${name}`, 'success');
        App.refreshPage();
      })
      .catch(e => App.toast((e && e.message) || '해제하지 못했습니다', 'error'));
  };

  // 모달을 연 채로 뒤 화면 숫자·목록을 갱신한다(App.refreshPage 는 열린 모달을 닫는다)
  const refreshAfterModal = () => {
    const panel = document.getElementById('lm-panel');
    if (panel) paintPanel();
    const metrics = document.querySelectorAll('.lm-metric span');
    if (metrics.length === 4 && data) metrics[3].textContent = (data.laws || []).length + (data.rules || []).length;
  };

  return {
    render, afterRender, load, setTab, setFilter, clearFilter,
    openFinder, closeFinder, setFinderCat, find, addWatch, removeWatch,
  };
})();
