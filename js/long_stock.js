// ============================================================
// long_stock.js — 장기재고 알람 (WBS 4.1.3 장기보관원료 품질확인)
//   2026-10-19 유통기한 임박(expiry_alert.js) 화면을 이 화면의 '유통기한' 탭으로 합쳤다.
//   유통기한 판정·입력 로직은 ExpiryAlertPage 에 그대로 두고 여기서 탭으로 불러 쓴다.
//   QR 입고 원료 재고(톤백/지대 + 사일로 LOT)를 자동 판별:
//     ① 미사용: 마지막 사용 후(또는 입고 후 사용이력 없이) N개월 경과 — 기본 3개월
//     ② 저회전: 최근 90일 사용량 기준 소진 예상이 M개월 이상 — 기본 12개월(회전율 1년↑)
//   사용 신호 = 이력(rm_history)의 사일로 FIFO 차감·로스·재고 감소 조정.
//   공장 필터(App.getFactory) 연동, 알림센터(NotificationCenter) 배지 연동.
// ============================================================

const LongStockPage = (() => {
  // 판정 임계값(화면에서 조정 가능)
  let unusedMonths = 3;    // ① 미사용 기준(개월)
  let turnMonths   = 12;   // ② 소진 예상 기준(개월)
  let filter = 'all';      // all | unused | slow
  let view = 'long';       // long(장기 보관) | expiry(유통기한)

  const DAY = 24 * 60 * 60 * 1000;
  const today = () => new Date();
  const parseD = (s) => { const d = new Date(String(s || '').slice(0, 10)); return isNaN(d) ? null : d; };
  const daysBetween = (from, to) => (from && to) ? Math.floor((to - from) / DAY) : null;
  const fmtKg = (n) => (n == null) ? '-' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FACTORY_LABEL = { NS: '논산', GS: '경산', AS: '아산', HQ: '본사' };

  // ── 재고 수집: 톤백/지대(rm_inventory) + 사일로 잔존 LOT ──
  //   원료(code+factory) 단위 집계: 총 kg, 가장 오래된 잔존 LOT 입고일, 보관위치들
  const collectStock = (factory) => {
    const map = new Map();   // `${factory}|${code}` -> row
    const put = (factory2, code, name, kg, inDate, loc) => {
      if (!code || !(kg > 0)) return;
      const key = factory2 + '|' + code;
      if (!map.has(key)) map.set(key, { factory: factory2, code, name: name || '', kg: 0, oldest: null, locs: new Set() });
      const r = map.get(key);
      r.kg += kg;
      if (name && !r.name) r.name = name;
      const d = parseD(inDate);
      if (d && (!r.oldest || d < r.oldest)) r.oldest = d;
      if (loc) r.locs.add(loc);
    };

    try {
      (DB.getInventory() || []).forEach(inv => {
        if (factory !== 'ALL' && inv.factory !== factory) return;
        const lots = Array.isArray(inv.lots) && inv.lots.length ? inv.lots : null;
        const oldestLot = lots ? lots.reduce((a, l) => {
          const d = parseD(l.receivedDate); return (d && (!a || d < a)) ? d : a;
        }, null) : null;
        put(inv.factory, inv.materialCode, inv.materialName, Number(inv.weight) || 0,
          oldestLot || inv.createdAt, `${inv.warehouse || ''} ${inv.binLocation || ''}`.trim());
      });
    } catch (_) {}

    try {
      (DB.getSilos() || []).forEach(s => {
        if (factory !== 'ALL' && s.factory !== factory) return;
        (s.currentLots || []).forEach(l => {
          put(s.factory, l.materialCode || s.materialCode, l.materialName || s.materialName,
            Number(l.qty) || 0, l.inDate, s.name || s.id);
        });
      });
    } catch (_) {}

    return [...map.values()];
  };

  // ── 사용 이력 수집: 원료(code+factory)별 { lastUsed, use90kg } ──
  //   SILO_CONSUME/LOSS: refId=사일로 → materialCode, detail의 kg 파싱
  //   ADJUST(감소): refId=원료코드 (kg 불명 → 최근사용 신호로만)
  const collectUsage = () => {
    const silosById = new Map();
    try { (DB.getSilos() || []).forEach(s => silosById.set(s.id, s)); } catch (_) {}
    const out = new Map();   // `${factory}|${code}` -> { lastUsed:Date, use90:kg }
    const cutoff90 = new Date(today() - 90 * DAY);
    const touch = (factory, code, ts, kg) => {
      if (!code) return;
      const key = (factory || 'ALL') + '|' + code;
      if (!out.has(key)) out.set(key, { lastUsed: null, use90: 0 });
      const u = out.get(key);
      const d = parseD(ts);
      if (d && (!u.lastUsed || d > u.lastUsed)) u.lastUsed = d;
      if (d && kg > 0 && d >= cutoff90) u.use90 += kg;
    };
    try {
      (DB.getHistory() || []).forEach(h => {
        if (h.refType === 'SILO_CONSUME' || h.refType === 'LOSS') {
          const silo = silosById.get(h.refId);
          if (!silo) return;
          const m = String(h.detail || '').match(/([\d][\d,\.]*)\s*kg/);
          const kg = m ? Number(m[1].replace(/,/g, '')) : 0;
          touch(silo.factory, silo.materialCode, h.timestamp, kg);
        } else if (h.refType === 'ADJUST') {
          if (!/^\s*-/.test(String(h.detail || ''))) return;   // 감소만 사용으로 간주
          // ADJUST는 공장 정보가 없어 코드 단위로만 신호 기록(모든 공장에 적용)
          touch('ALL', h.refId, h.timestamp, 0);
        }
      });
    } catch (_) {}
    return out;
  };

  // ── 판정 ──
  //   반환: [{ ...stock, lastUsed, daysStored, daysNoUse, use90, monthsToDeplete, flags:['unused'|'slow'] }]
  const analyze = (factory) => {
    const stock = collectStock(factory);
    const usage = collectUsage();
    const t = today();
    const unusedDays = Math.round(unusedMonths * 30.4);

    return stock.map(r => {
      const u = usage.get(r.factory + '|' + r.code) || usage.get('ALL|' + r.code) || { lastUsed: null, use90: 0 };
      const daysStored = daysBetween(r.oldest, t);
      const daysNoUse = u.lastUsed ? daysBetween(u.lastUsed, t) : null;
      // 소진 예상(개월): 최근 90일 사용량을 월평균으로 환산
      const monthlyUse = u.use90 / 3;
      const monthsToDeplete = monthlyUse > 0 ? (r.kg / monthlyUse) : null;

      const flags = [];
      // ① 미사용: 사용이력 없으면 입고 경과로, 있으면 마지막 사용 경과로 판정
      if (u.lastUsed ? (daysNoUse >= unusedDays) : (daysStored != null && daysStored >= unusedDays)) flags.push('unused');
      // ② 저회전: 사용은 있으나 소진까지 N개월 이상
      if (monthsToDeplete != null && monthsToDeplete >= turnMonths) flags.push('slow');

      return { ...r, lastUsed: u.lastUsed, use90: u.use90, daysStored, daysNoUse, monthsToDeplete, flags };
    }).filter(r => r.flags.length)
      .sort((a, b) => (b.daysStored || 0) - (a.daysStored || 0));
  };

  // 알림센터/배지용: 현재 공장 기준 장기재고 건수
  const alerts = (factory) => {
    try { return analyze(factory || (typeof App !== 'undefined' ? App.getFactory() : 'ALL')); }
    catch (_) { return []; }
  };
  // 사이드바 배지: 장기 보관 + 유통기한 지남·임박
  const expirySummary = () => {
    try { return (typeof ExpiryAlertPage !== 'undefined' && ExpiryAlertPage.summary) ? ExpiryAlertPage.summary() : null; }
    catch (_) { return null; }
  };
  const alertCount = (factory) => {
    const ex = expirySummary();
    return alerts(factory).length + (ex ? (ex.expired || 0) + (ex.near || 0) : 0);
  };

  // 탭 머리 — 장기 보관 / 유통기한
  const viewTabs = (longN) => {
    const ex = expirySummary();
    const exN = ex ? (ex.expired || 0) + (ex.near || 0) : 0;
    return `
      <div class="tabs mb-16">
        <div class="tab ${view === 'long' ? 'active' : ''}" onclick="LongStockPage.setView('long')">장기 보관 (미사용·저회전) ${longN != null ? `<b>${longN}</b>` : ''}</div>
        <div class="tab ${view === 'expiry' ? 'active' : ''}" onclick="LongStockPage.setView('expiry')">유통기한 (지남·임박) ${ex ? `<b${ex.expired ? ' style="color:#c0392b"' : ''}>${exN}</b>` : ''}</div>
      </div>`;
  };

  // ── 렌더 ──
  const flagBadge = (r) => {
    const b = [];
    if (r.flags.includes('unused')) b.push(`<span class="ls-badge ls-danger">${unusedMonths}개월↑ 미사용</span>`);
    if (r.flags.includes('slow')) b.push(`<span class="ls-badge ls-warn">저회전 ${r.monthsToDeplete == null ? '' : '· 소진 ' + r.monthsToDeplete.toFixed(1) + '개월'}</span>`);
    return b.join(' ');
  };

  const render = (arg) => {
    if (arg === 'expiry' || arg === 'long') view = arg;
    const factory = (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
    const rows = analyze(factory);
    if (view === 'expiry') {
      const body = (typeof ExpiryAlertPage !== 'undefined') ? ExpiryAlertPage.render() : '<div class="ls-empty">유통기한 기능을 불러오지 못했습니다.</div>';
      return `<div class="fade-in">${viewTabs(rows.length)}${body}</div>`;
    }
    const unused = rows.filter(r => r.flags.includes('unused'));
    const slow = rows.filter(r => r.flags.includes('slow') && !r.flags.includes('unused'));
    const shown = filter === 'unused' ? rows.filter(r => r.flags.includes('unused'))
      : filter === 'slow' ? rows.filter(r => r.flags.includes('slow'))
      : rows;
    const totalKg = rows.reduce((s, r) => s + r.kg, 0);
    const facLabel = factory === 'ALL' ? '전체' : (FACTORY_LABEL[factory] || factory);

    const table = shown.length ? `
      <div class="ls-scroll">
        <table class="ls-tbl">
          <thead><tr>
            <th>상태</th><th>코드</th><th>원료명</th><th>공장</th><th>보관위치</th>
            <th class="ls-num">재고량(kg)</th><th>최초 입고</th><th class="ls-num">보관일수</th>
            <th>최근 사용</th><th class="ls-num">미사용 일수</th><th class="ls-num">최근90일 사용(kg)</th><th class="ls-num">소진 예상</th>
          </tr></thead>
          <tbody>
            ${shown.map(r => `
              <tr class="${r.flags.includes('unused') ? 'ls-row-danger' : 'ls-row-warn'}">
                <td>${flagBadge(r)}</td>
                <td class="mono">${esc(r.code)}</td>
                <td><b>${esc(r.name || '-')}</b></td>
                <td>${FACTORY_LABEL[r.factory] || r.factory}</td>
                <td class="ls-loc">${esc([...r.locs].join(', ') || '-')}</td>
                <td class="ls-num"><b>${fmtKg(r.kg)}</b></td>
                <td>${r.oldest ? r.oldest.toISOString().slice(0, 10) : '-'}</td>
                <td class="ls-num ${r.daysStored >= 90 ? 'ls-hot' : ''}">${r.daysStored ?? '-'}일</td>
                <td>${r.lastUsed ? r.lastUsed.toISOString().slice(0, 10) : '<span class="text-muted">사용이력 없음</span>'}</td>
                <td class="ls-num ${r.daysNoUse != null && r.daysNoUse >= 90 ? 'ls-hot' : ''}">${r.daysNoUse != null ? r.daysNoUse + '일' : '-'}</td>
                <td class="ls-num">${fmtKg(r.use90)}</td>
                <td class="ls-num">${r.monthsToDeplete != null ? r.monthsToDeplete.toFixed(1) + '개월' : '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`
      : `<div class="ls-empty">현재 기준(미사용 ${unusedMonths}개월 / 소진 ${turnMonths}개월↑)에 해당하는 장기재고가 없습니다.<br>
         <span class="text-muted">상단 임계값을 낮춰 예비 점검을 할 수 있습니다.</span></div>`;

    return `
      <style>
        .ls-summary{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
        .ls-card{flex:1;min-width:150px;background:var(--bg-surface,#fff);border:1px solid var(--border,#e3e3e3);border-radius:6px;padding:14px 16px;cursor:pointer;transition:.15s;}
        .ls-card:hover{border-color:var(--accent,#3E6AE1);}
        .ls-card.on{border-color:var(--accent,#3E6AE1);box-shadow:0 0 0 1px var(--accent,#3E6AE1);}
        .ls-card b{display:block;font-size:24px;margin-bottom:2px;}
        .ls-card span{font-size:12px;color:var(--text-secondary,#5c5f66);}
        .ls-c-danger b{color:#c0392b;} .ls-c-warn b{color:#b8860b;} .ls-c-total b{color:var(--accent,#3E6AE1);}
        .ls-toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;background:var(--bg-surface,#fff);
          border:1px solid var(--border,#e3e3e3);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;}
        .ls-toolbar label{color:var(--text-secondary,#5c5f66);font-size:12px;}
        .ls-toolbar input{width:56px;border:1px solid var(--border,#d5d5d5);border-radius:4px;padding:4px 6px;text-align:right;
          background:var(--bg-input,#fff);color:var(--text-primary,#171a20);}
        .ls-scroll{overflow-x:auto;border:1px solid var(--border,#e3e3e3);border-radius:6px;}
        table.ls-tbl{border-collapse:collapse;width:100%;font-size:12.5px;white-space:nowrap;background:var(--bg-surface,#fff);}
        .ls-tbl th,.ls-tbl td{border-bottom:1px solid var(--border,#ececec);padding:8px 10px;text-align:left;}
        .ls-tbl th{background:var(--bg-soft,#f4f4f6);font-weight:600;position:sticky;top:0;}
        .ls-num{text-align:right;font-variant-numeric:tabular-nums;}
        .ls-loc{max-width:180px;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;color:var(--text-secondary,#666);}
        .ls-badge{display:inline-block;font-size:10.5px;font-weight:700;border-radius:3px;padding:2px 7px;white-space:nowrap;}
        .ls-danger{background:#fdecec;color:#c0392b;} .ls-warn{background:#fff7e6;color:#b8860b;}
        .ls-row-danger td:first-child{border-left:3px solid #c0392b;}
        .ls-row-warn td:first-child{border-left:3px solid #e0a82e;}
        .ls-hot{color:#c0392b;font-weight:700;}
        .ls-empty{padding:48px;text-align:center;color:var(--text-secondary,#5c5f66);line-height:1.8;
          background:var(--bg-surface,#fff);border:1px dashed var(--border,#d5d5d5);border-radius:6px;}
        .ls-note{font-size:11.5px;color:var(--text-muted,#8a8f96);margin-top:10px;line-height:1.6;}
        @media (prefers-color-scheme:dark){ .ls-danger{background:#3a1e1e;} .ls-warn{background:#3a331e;} }
      </style>
      <div class="fade-in">
        ${viewTabs(rows.length)}
        <div class="ls-summary">
          <div class="ls-card ls-c-danger ${filter === 'unused' ? 'on' : ''}" onclick="LongStockPage.setFilter('unused')">
            <b>${unused.length}</b><span>${unusedMonths}개월 이상 미사용</span></div>
          <div class="ls-card ls-c-warn ${filter === 'slow' ? 'on' : ''}" onclick="LongStockPage.setFilter('slow')">
            <b>${rows.filter(r => r.flags.includes('slow')).length}</b><span>저회전(소진 ${turnMonths}개월↑)</span></div>
          <div class="ls-card ls-c-total ${filter === 'all' ? 'on' : ''}" onclick="LongStockPage.setFilter('all')">
            <b>${rows.length}</b><span>장기재고 합계 · ${fmtKg(totalKg)}kg</span></div>
        </div>
        <div class="ls-toolbar">
          <label>미사용 기준 <input type="number" min="1" max="24" value="${unusedMonths}" onchange="LongStockPage.setUnused(this.value)"> 개월 이상</label>
          <label>저회전 기준: 소진 예상 <input type="number" min="1" max="60" value="${turnMonths}" onchange="LongStockPage.setTurn(this.value)"> 개월 이상</label>
          <span class="text-muted" style="font-size:11.5px">공장: <b>${facLabel}</b> (상단 공장 선택 연동)</span>
        </div>
        ${table}
        <p class="ls-note">
          · <b>미사용</b>: 마지막 사용(사일로 투입·차감·재고감소) 이후 — 사용이력이 없으면 최초 입고일 기준 — ${unusedMonths}개월 경과<br>
          · <b>저회전</b>: 최근 90일 사용량을 월평균으로 환산했을 때 현재고 소진까지 ${turnMonths}개월 이상 (회전율 저조)<br>
          · 대상 재고 = 톤백·지대 재고 + 사일로 잔존 LOT. 장기재고는 유통기한·곰팡이독소·변질 위험이 있어 우선 사용 또는 재검사가 필요합니다. (업무체계도 4.1.3)
        </p>
      </div>`;
  };

  return {
    render,
    setFilter: (f) => { filter = f; App.refreshPage(); },
    setView: (v) => { view = v; App.navigate('longStock', v); },
    setUnused: (v) => { const n = Number(v); if (n >= 1) unusedMonths = n; App.refreshPage(); },
    setTurn: (v) => { const n = Number(v); if (n >= 1) turnMonths = n; App.refreshPage(); },
    alerts, alertCount,
  };
})();
