// ============================================================
// stock_level.js — 제품(톤백·지대) 재고 적정성 알람
//   기준 = 최근 3개월 평균 출하량(월). 현재고가 하한보다 적으면 "부족", 상한보다 많으면 "과재고".
//     하한 = 월평균 출하량 × 부족 기준 개월(기본 1개월)
//     상한 = 월평균 출하량 × 과재고 기준 개월(기본 2개월)
//   현재고 = 제품 LOT 생산량 − 출고량(DB.getProductStockRows). 벌크는 바로 출하하므로 대상에서 뺀다.
//   월평균 출하량
//     1) 출고 기록이 3개월 이상 쌓인 제품 → 최근 90일 출고량 ÷ 3
//     2) 출고 기록이 짧으면 → 직접 입력(또는 엑셀로 불러온) 기준 출하량
//     3) 둘 다 없고 짧은 기록만 있으면 → 그 기간을 월 단위로 환산(기록 부족 표시)
//   알림: 제품 재고 화면 · 투입지시/배합·생산LOT 화면 배너 · 알림센터(사이드바 배지)
//   설정·기준값은 rm_stock_levels(동기화 키)에 저장 — 모든 기기 공유
// ============================================================

const StockLevel = (() => {
  const KEY = 'rm_stock_levels';
  const CFG_ID = '__config';
  const DEFAULT_CFG = { lowMonths: 1, highMonths: 2 };
  const WINDOW_DAYS = 90;

  let filter = 'ALL';      // ALL | ALERT | LOW | OVER | OK
  let packFilter = 'ALL';  // ALL | 톤백 | 지대

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const now = () => new Date().toISOString();
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  const dayDiff = (from) => {
    const a = new Date(String(from).slice(0, 10) + 'T00:00:00');
    return isNaN(a) ? 0 : Math.floor((new Date(ymd(new Date()) + 'T00:00:00') - a) / 86400000);
  };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const write = (list) => {
    localStorage.setItem(KEY, JSON.stringify(list));
    try { if (window.__onDbWrite) window.__onDbWrite(KEY); } catch (_) {}
  };
  const actor = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : ''; } catch (_) { return ''; } };
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const facName = (f) => (DB.getFactoryName ? DB.getFactoryName(f) : f);
  const kg = (v) => formatNum(Math.round(Number(v) || 0));

  // ── 포장 구분: 톤백 / 지대(포대) / 벌크(제외) ──
  const packClass = (packType) => {
    const s = String(packType || '');
    if (/벌크|bulk/i.test(s)) return null;
    if (/톤백|1t|ton/i.test(s)) return '톤백';
    return '지대';
  };
  const groupId = (factory, code, pack) => `${factory}|${code}|${pack}`;

  // ── 설정 ──
  const getConfig = () => {
    const row = read().find(x => x.id === CFG_ID) || {};
    return {
      lowMonths: Number(row.lowMonths) > 0 ? Number(row.lowMonths) : DEFAULT_CFG.lowMonths,
      highMonths: Number(row.highMonths) > 0 ? Number(row.highMonths) : DEFAULT_CFG.highMonths,
    };
  };
  const saveConfig = (patch) => {
    const cur = getConfig();
    const next = { ...cur, ...patch };
    if (!(next.highMonths > next.lowMonths)) { App.toast('과재고 기준은 부족 기준보다 커야 합니다', 'warning'); return false; }
    const list = read().filter(x => x.id !== CFG_ID);
    list.push({ id: CFG_ID, ...next, updatedAt: now(), updatedBy: actor() });
    write(list);
    return true;
  };
  const getBasis = (id) => read().find(x => x.id === id && x.id !== CFG_ID) || null;
  const basisList = () => read().filter(x => x.id !== CFG_ID);

  // ── 계산 ──
  //   반환: 공장·제품·포장 단위 행 { id, factory, code, name, pack, stock, lots, avg, source, low, high, months, status, need, excess }
  const compute = (factory = 'ALL') => {
    const cfg = getConfig();
    const groups = {};
    const touch = (f, code, name, pack) => {
      const id = groupId(f, code, pack);
      if (!groups[id]) groups[id] = { id, factory: f, code, name: name || code, pack, stock: 0, lots: 0, ship90: 0, firstShip: '', oldest: '' };
      else if (name && groups[id].name === groups[id].code) groups[id].name = name;
      return groups[id];
    };

    // 현재고
    const stockRows = (DB.getProductStockRows ? DB.getProductStockRows('ALL') : []) || [];
    const lotPack = {};
    stockRows.forEach(r => {
      const pack = packClass(r.packType);
      lotPack[r.id] = lotPack[r.fgLotNo] = { pack, code: r.productCode || r.productName || '', name: r.productName || '', factory: r.factory };
      if (!pack) return;
      const g = touch(r.factory, r.productCode || r.productName || '', r.productName, pack);
      g.stock += Number(r.remaining) || 0;
      if ((Number(r.remaining) || 0) > 0) {
        g.lots++;
        const d = String(r.productionDate || r.createdAt || '').slice(0, 10);
        if (d && (!g.oldest || d < g.oldest)) g.oldest = d;
      }
    });

    // 출하 실적(제품 출고만)
    const since = daysAgo(WINDOW_DAYS);
    (DB.getOutbounds ? DB.getOutbounds() : []).forEach(o => {
      if (o.kind !== 'PRODUCT') return;
      const lp = lotPack[o.productLotId] || lotPack[o.fgLotNo];
      if (!lp || !lp.pack) return;
      const g = touch(o.factory || lp.factory, o.productCode || lp.code, o.productName || lp.name, lp.pack);
      const d = String(o.outboundDate || '').slice(0, 10);
      if (d && (!g.firstShip || d < g.firstShip)) g.firstShip = d;
      if (d && d >= since) g.ship90 += Number(o.qty) || 0;
    });

    // 직접 입력 기준값만 있는 제품도 포함(재고 0 → 부족으로 잡힌다)
    basisList().forEach(b => {
      if (!b.factory || !b.pack) return;
      touch(b.factory, b.productCode || b.productName || '', b.productName, b.pack);
    });

    return Object.values(groups)
      .filter(g => factory === 'ALL' || g.factory === factory)
      .map(g => {
        const b = getBasis(g.id);
        const histDays = g.firstShip ? dayDiff(g.firstShip) : 0;
        let avg = 0, source = '';
        if (histDays >= WINDOW_DAYS) { avg = g.ship90 / 3; source = 'auto'; }
        else if (b && Number(b.monthlyShip) > 0) { avg = Number(b.monthlyShip); source = 'manual'; }
        else if (g.ship90 > 0) { avg = g.ship90 / Math.max(histDays, 7) * 30; source = 'short'; }
        const low = b && Number(b.minStock) > 0 ? Number(b.minStock) : avg * cfg.lowMonths;
        const high = b && Number(b.maxStock) > 0 ? Number(b.maxStock) : avg * cfg.highMonths;
        let status;
        // 출하 기준이 없을 때: 가장 오래된 재고가 3개월을 넘었으면 '출하 없음'(과재고 성격), 아니면 '기준 없음'(알람 아님)
        if (avg <= 0) status = g.stock <= 0 ? 'NONE' : (g.oldest && dayDiff(g.oldest) >= WINDOW_DAYS ? 'NOMOVE' : 'NOBASIS');
        else if (g.stock <= 0) status = 'OUT';
        else if (g.stock < low) status = 'LOW';
        else if (g.stock > high) status = 'OVER';
        else status = 'OK';
        const target = (low + high) / 2;
        return {
          ...g, avg, source, histDays, low, high,
          months: avg > 0 ? g.stock / avg : null,
          status,
          need: (status === 'OUT' || status === 'LOW') ? Math.max(0, target - g.stock) : 0,
          excess: status === 'OVER' ? g.stock - high : (status === 'NOMOVE' ? g.stock : 0),
          basis: b,
        };
      })
      .filter(r => r.status !== 'NONE');
  };

  const isShort = (s) => s === 'OUT' || s === 'LOW';
  const isOver = (s) => s === 'OVER' || s === 'NOMOVE';
  const alerts = (factory = 'ALL') => compute(factory).filter(r => isShort(r.status) || isOver(r.status));
  const summary = (factory = 'ALL') => {
    const rows = compute(factory);
    return {
      total: rows.length,
      short: rows.filter(r => isShort(r.status)).length,
      over: rows.filter(r => isOver(r.status)).length,
      ok: rows.filter(r => r.status === 'OK').length,
    };
  };

  // ── 표시 부품 ──
  const BADGE = {
    OUT: '<span class="badge badge-fail">재고 없음</span>',
    LOW: '<span class="badge badge-fail">부족</span>',
    OVER: '<span class="badge badge-warning">과재고</span>',
    NOMOVE: '<span class="badge badge-warning">출하 없음</span>',
    OK: '<span class="badge badge-pass">적정</span>',
    NOBASIS: '<span class="badge badge-default">기준 없음</span>',
  };
  const SOURCE = {
    auto: '출고기록 3개월',
    manual: '기준값 입력',
    short: '출고기록 부족',
  };
  const advice = (r) => {
    if (isShort(r.status)) return `<b style="color:var(--danger)">생산 필요 약 ${kg(r.need)}kg</b>`;
    if (r.status === 'OVER') return `<b style="color:var(--warning)">생산 보류 검토 · 초과 ${kg(r.excess)}kg</b>`;
    if (r.status === 'NOMOVE') return `<b style="color:var(--warning)">3개월 출하 없음 · 출하·유통기한 확인</b>`;
    if (r.status === 'NOBASIS') return '<span class="text-muted">출고 기록이 쌓이거나 기준 출하량을 등록하면 판정</span>';
    return '<span class="text-muted">-</span>';
  };

  // 생산 화면(투입지시·배합) 상단 배너 — 생산 우선/보류 판단용
  const productionBanner = () => {
    let rows;
    try { rows = alerts(fac()); } catch (_) { return ''; }
    if (!rows.length) return '';
    const short = rows.filter(r => isShort(r.status)).sort((a, b) => b.need - a.need);
    const over = rows.filter(r => isOver(r.status)).sort((a, b) => b.excess - a.excess);
    const line = (list, fmt) => list.slice(0, 5).map(fmt).join(' · ') + (list.length > 5 ? ` 외 ${list.length - 5}건` : '');
    return `
      <div class="card mb-16" style="border-color:rgba(229,72,77,.35)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="section-label" style="margin:0">제품 재고 알람 (3개월 평균 출하량 기준)</div>
          <button class="btn btn-ghost btn-xs" onclick="App.navigate('productStock')">제품 재고에서 보기 →</button>
        </div>
        ${short.length ? `<div style="margin-top:8px;font-size:13px"><span class="badge badge-fail">생산 우선 ${short.length}건</span>
          ${line(short, r => `${esc(r.name)}(${r.pack}) <b>${kg(r.need)}kg</b>`)}</div>` : ''}
        ${over.length ? `<div style="margin-top:6px;font-size:13px"><span class="badge badge-warning">생산 보류 검토 ${over.length}건</span>
          ${line(over, r => `${esc(r.name)}(${r.pack}) ${r.status === 'NOMOVE' ? '출하 없음' : '초과 ' + kg(r.excess) + 'kg'}`)}</div>` : ''}
      </div>`;
  };

  // 제품 LOT 등록 창에서 제품을 고르면 그 제품의 재고 상태를 보여준다
  const hintFor = (factory, code, name, packType) => {
    const key = code || name;
    if (!key) return '';
    const pack = packType ? packClass(packType) : '';
    if (packType && !pack) return '';   // 벌크는 판정 대상 아님
    const rows = compute(factory || 'ALL').filter(r => (r.code === key || (name && r.name === name)) && (!pack || r.pack === pack));
    if (!rows.length) return '';
    return rows.map(r => {
      if (isOver(r.status)) return `<div class="info-box info-warning" style="margin-top:6px">${r.pack} 재고 ${kg(r.stock)}kg — ${r.status === 'NOMOVE' ? '최근 3개월 출하가 없습니다' : `과재고(상한 ${kg(r.high)}kg 초과)`}. 생산 전에 확인하세요.</div>`;
      if (isShort(r.status)) return `<div class="info-box info-blue" style="margin-top:6px">${r.pack} 재고 부족 — 현재 ${kg(r.stock)}kg / 하한 ${kg(r.low)}kg. 생산 우선 대상입니다.</div>`;
      if (r.status !== 'OK') return '';
      return `<div class="text-xs text-muted" style="margin-top:6px">${r.pack} 재고 적정 — ${kg(r.stock)}kg (${r.months.toFixed(1)}개월분)</div>`;
    }).join('');
  };

  // ── 제품 재고 화면 섹션 ──
  const section = () => {
    const cfg = getConfig();
    const all = compute(fac());
    const st = {
      short: all.filter(r => isShort(r.status)).length,
      over: all.filter(r => isOver(r.status)).length,
      ok: all.filter(r => r.status === 'OK').length,
    };
    const rank = { OUT: 0, LOW: 1, OVER: 2, NOMOVE: 3, OK: 4, NOBASIS: 5 };
    const list = all.filter(r => {
      if (packFilter !== 'ALL' && r.pack !== packFilter) return false;
      if (filter === 'ALERT') return isShort(r.status) || isOver(r.status);
      if (filter === 'LOW') return isShort(r.status);
      if (filter === 'OVER') return isOver(r.status);
      if (filter === 'OK') return r.status === 'OK';
      return true;
    }).sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.name).localeCompare(String(b.name)));
    const chip = (cur, v, fn, label, n, color) =>
      `<button class="btn btn-sm ${cur === v ? 'btn-primary' : 'btn-ghost'}" onclick="StockLevel.${fn}('${v}')">${label}${n != null ? ` <b${color ? ` style="color:${color}"` : ''}>${n}</b>` : ''}</button>`;
    const monthOpts = (sel, list) => list.map(m => `<option value="${m}" ${Number(sel) === m ? 'selected' : ''}>${m}개월</option>`).join('');

    return `
      <div class="card mb-20">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="section-label" style="margin:0">재고 적정성 알람 — 톤백·지대 (3개월 평균 출하량 기준)</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="text-muted" style="font-size:12px">부족 기준</span>
            <select class="form-input form-input-sm" style="width:92px" onchange="StockLevel.setConfig('lowMonths', this.value)">${monthOpts(cfg.lowMonths, [0.5, 1, 1.5, 2])}</select>
            <span class="text-muted" style="font-size:12px">과재고 기준</span>
            <select class="form-input form-input-sm" style="width:92px" onchange="StockLevel.setConfig('highMonths', this.value)">${monthOpts(cfg.highMonths, [1.5, 2, 2.5, 3, 4])}</select>
            <button class="btn btn-ghost btn-xs" onclick="StockLevel.downloadTemplate()">엑셀 양식 받기</button>
            <label class="btn btn-ghost btn-xs" style="cursor:pointer">엑셀 불러오기<input type="file" accept=".xlsx" style="display:none" onchange="StockLevel.importFile(this)"></label>
            <button class="btn btn-primary btn-xs" onclick="StockLevel.openEdit()">＋ 기준 출하량 등록</button>
          </div>
        </div>

        <div class="inventory-summary-grid" style="margin:12px 0">
          <div class="inventory-summary-card ${st.short ? 'summary-risk' : ''}"><div class="summary-label">재고 부족 (생산 필요)</div><div class="summary-value">${st.short}<span>건</span></div></div>
          <div class="inventory-summary-card ${st.over ? 'summary-risk' : ''}"><div class="summary-label">과재고 · 출하 없음</div><div class="summary-value">${st.over}<span>건</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">적정</div><div class="summary-value">${st.ok}<span>건</span></div></div>
          <div class="inventory-summary-card"><div class="summary-label">판정 기준</div><div class="summary-value" style="font-size:15px">월평균 × ${cfg.lowMonths} ~ ${cfg.highMonths}개월</div></div>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px">
          <span class="text-muted" style="font-size:12px">상태</span>
          ${chip(filter, 'ALL', 'setFilter', '전체', all.length)}
          ${chip(filter, 'ALERT', 'setFilter', '알람만', st.short + st.over)}
          ${chip(filter, 'LOW', 'setFilter', '부족', st.short, st.short ? '#e5484d' : '')}
          ${chip(filter, 'OVER', 'setFilter', '과재고', st.over, st.over ? '#d4820f' : '')}
          ${chip(filter, 'OK', 'setFilter', '적정', st.ok)}
          <span class="text-muted" style="font-size:12px;margin-left:6px">포장</span>
          ${chip(packFilter, 'ALL', 'setPack', '전체')}
          ${chip(packFilter, '톤백', 'setPack', '톤백')}
          ${chip(packFilter, '지대', 'setPack', '지대')}
        </div>

        <div class="table-wrapper"><table>
          <thead><tr><th>공장</th><th>제품코드</th><th>제품명</th><th>포장</th>
            <th class="td-right">현재고(kg)</th><th class="td-right">월평균 출하(kg)</th><th>기준 출처</th>
            <th class="td-right">재고 개월수</th><th class="td-right">하한~상한(kg)</th><th>상태</th><th>권고</th><th></th></tr></thead>
          <tbody>${list.length ? list.map(r => `<tr${isShort(r.status) ? ' style="background:rgba(229,72,77,.06)"' : isOver(r.status) ? ' style="background:rgba(245,158,11,.06)"' : ''}>
            <td class="text-xs">${esc(facName(r.factory))}</td>
            <td class="td-mono text-xs">${esc(r.code)}</td>
            <td><strong>${esc(r.name)}</strong></td>
            <td>${r.pack}</td>
            <td class="td-right font-bold">${kg(r.stock)}</td>
            <td class="td-right">${r.avg > 0 ? kg(r.avg) : '-'}</td>
            <td class="text-xs">${SOURCE[r.source] || '<span class="text-muted">없음</span>'}${r.source === 'short' ? `<div class="text-muted">${r.histDays}일치</div>` : ''}</td>
            <td class="td-right">${r.months != null ? r.months.toFixed(1) + '개월' : '-'}</td>
            <td class="td-right text-xs">${r.avg > 0 ? `${kg(r.low)} ~ ${kg(r.high)}` : '-'}</td>
            <td>${BADGE[r.status] || ''}</td>
            <td class="text-xs">${advice(r)}</td>
            <td><button class="btn btn-ghost btn-xs" onclick="StockLevel.openEdit('${esc(r.id)}')">기준</button></td>
          </tr>`).join('') : `<tr><td colspan="12" style="text-align:center;padding:28px;color:var(--text-muted)">${all.length ? '해당 조건의 제품이 없습니다' : '판정할 제품이 없습니다 — 제품 LOT·출고가 쌓이거나 기준 출하량을 등록하면 표시됩니다'}</td></tr>`}</tbody>
        </table></div>
        <div class="text-muted" style="font-size:12px;margin-top:8px">
          월평균 출하량은 출고 기록이 3개월 이상 쌓인 제품은 최근 90일 출고량 ÷ 3으로 자동 계산하고, 기록이 짧으면 등록한 기준 출하량을 씁니다.
          벌크 제품은 대상에서 제외합니다. 부족·과재고는 알림센터와 투입지시·배합 화면에도 표시됩니다.
        </div>
      </div>

      <div class="modal-overlay" id="sl-edit-modal">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">기준 출하량 등록</div>
            <button class="modal-close" onclick="StockLevel.closeEdit()">✕</button>
          </div>
          <div id="sl-edit-body"></div>
        </div>
      </div>`;
  };

  // ── 기준값 편집 ──
  const openEdit = (id) => {
    const body = document.getElementById('sl-edit-body');
    if (!body) return;
    const [f0, c0, p0] = id ? String(id).split('|') : [fac() === 'ALL' ? 'NS' : fac(), '', '지대'];
    const b = id ? getBasis(id) : null;
    const row = id ? compute('ALL').find(r => r.id === id) : null;
    const facs = (DB.getFactories ? DB.getFactories() : []).filter(f => f.id && f.id !== 'ALL' && f.id !== 'HQ');
    const products = (DB.getProducts ? DB.getProducts() : []).filter(p => p.active !== false).slice(0, 3000);
    body.innerHTML = `
      <div class="form-grid form-grid-2">
        <div class="form-group"><label class="form-label">공장 *</label>
          <select class="form-input" id="sl-factory" ${id ? 'disabled' : ''}>${facs.map(f => `<option value="${esc(f.id)}" ${f.id === f0 ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">포장 *</label>
          <select class="form-input" id="sl-pack" ${id ? 'disabled' : ''}>${['톤백', '지대'].map(p => `<option ${p === p0 ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">제품코드 *</label>
          <input class="form-input" id="sl-code" list="sl-code-list" value="${esc(c0)}" ${id ? 'disabled' : ''} placeholder="제품코드">
          <datalist id="sl-code-list">${products.map(p => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">월평균 출하량(kg)</label>
          <input type="number" class="form-input" id="sl-monthly" value="${b && b.monthlyShip ? b.monthlyShip : ''}" placeholder="${row && row.source === 'auto' ? '출고기록으로 자동 계산 중' : '예) 30000'}"></div>
        <div class="form-group"><label class="form-label">하한 직접 지정(kg)</label>
          <input type="number" class="form-input" id="sl-min" value="${b && b.minStock ? b.minStock : ''}" placeholder="비우면 월평균 × 부족 기준"></div>
        <div class="form-group"><label class="form-label">상한 직접 지정(kg)</label>
          <input type="number" class="form-input" id="sl-max" value="${b && b.maxStock ? b.maxStock : ''}" placeholder="비우면 월평균 × 과재고 기준"></div>
      </div>
      ${row && row.source === 'auto' ? `<div class="text-xs text-muted" style="margin-top:4px">이 제품은 출고 기록이 3개월 이상이라 월평균 출하량(${kg(row.avg)}kg)을 자동 계산합니다. 입력한 월평균 출하량은 쓰지 않고, 하한·상한 직접 지정만 적용됩니다.</div>` : ''}
      ${b && b.updatedAt ? `<div class="text-xs text-muted" style="margin-top:4px">최근 수정 ${esc(String(b.updatedAt).slice(0, 10))} ${esc(b.updatedBy || '')}</div>` : ''}
      <div style="display:flex;justify-content:space-between;gap:8px;margin-top:16px">
        <div>${b ? `<button class="btn btn-ghost btn-sm" onclick="StockLevel.removeBasis('${esc(id)}')">기준값 삭제</button>` : ''}</div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="StockLevel.closeEdit()">취소</button>
          <button class="btn btn-primary btn-sm" onclick="StockLevel.saveEdit('${esc(id || '')}')">저장</button>
        </div>
      </div>`;
    document.getElementById('sl-edit-modal')?.classList.add('open');
  };
  const closeEdit = () => document.getElementById('sl-edit-modal')?.classList.remove('open');

  const upsertBasis = (list, rec) => {
    const i = list.findIndex(x => x.id === rec.id);
    if (i >= 0) list[i] = { ...list[i], ...rec };
    else list.push(rec);
  };
  const saveEdit = (id) => {
    const v = (k) => document.getElementById(k)?.value;
    const factory = id ? id.split('|')[0] : v('sl-factory');
    const pack = id ? id.split('|')[2] : v('sl-pack');
    const code = (id ? id.split('|')[1] : String(v('sl-code') || '')).trim();
    if (!factory || !pack || !code) { App.toast('공장·포장·제품코드를 입력하세요', 'warning'); return; }
    const num = (k) => { const n = Number(v(k)); return n > 0 ? n : 0; };
    const monthlyShip = num('sl-monthly'), minStock = num('sl-min'), maxStock = num('sl-max');
    if (minStock && maxStock && maxStock <= minStock) { App.toast('상한은 하한보다 커야 합니다', 'warning'); return; }
    const p = DB.getProductByCode ? DB.getProductByCode(code) : null;
    const list = read();
    upsertBasis(list, {
      id: groupId(factory, code, pack), factory, productCode: code, productName: (p && p.name) || code, pack,
      monthlyShip, minStock, maxStock, updatedAt: now(), updatedBy: actor(),
    });
    write(list);
    closeEdit();
    App.toast('기준을 저장했습니다', 'success');
    App.refreshPage();
  };
  const removeBasis = (id) => {
    if (!confirm('이 제품의 기준값을 삭제할까요?')) return;
    write(read().filter(x => x.id !== id));
    closeEdit();
    App.refreshPage();
  };

  // ── 엑셀 ──
  const downloadTemplate = () => {
    if (typeof WSXlsx === 'undefined') { App.toast('엑셀 기능을 불러오지 못했습니다', 'error'); return; }
    const rows = [
      ['제품 재고 기준 출하량'],
      ['안내', '공장은 논산/경산/아산, 포장은 톤백/지대. 하한·상한은 비우면 월평균 × 기준 개월로 계산합니다.'],
      [],
      ['공장', '제품코드', '제품명', '포장', '월평균 출하량(kg)', '하한(kg)', '상한(kg)'],
    ];
    const seen = new Set();
    compute(fac()).forEach(r => {
      seen.add(r.id);
      const b = r.basis || {};
      rows.push([facName(r.factory), r.code, r.name, r.pack, b.monthlyShip || (r.source === 'auto' ? Math.round(r.avg) : ''), b.minStock || '', b.maxStock || '']);
    });
    WSXlsx.download(`제품재고_기준출하량_${ymd(new Date())}.xlsx`, [{ name: '기준출하량', rows }]);
  };

  const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/\(.*?\)/g, '');
  const facCode = (s) => {
    const t = String(s || '').trim();
    const f = (DB.getFactories ? DB.getFactories() : []).find(x => x.id === t || x.name === t || (x.name && t && (x.name.includes(t) || t.includes(x.name))));
    return f ? f.id : '';
  };
  const importFile = async (input) => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (typeof LabImport === 'undefined' || !LabImport._parseXlsx) { App.toast('엑셀 읽기 기능을 불러오지 못했습니다', 'error'); return; }
    let grid;
    try { grid = await LabImport._parseXlsx(await file.arrayBuffer()); }
    catch (e) { App.toast('엑셀을 읽지 못했습니다 — ' + (e.message || e), 'error'); return; }
    const hr = grid.findIndex(r => (r || []).some(c => norm(c) === '제품코드') && (r || []).some(c => norm(c) === '월평균출하량'));
    if (hr < 0) { App.toast('"제품코드"·"월평균 출하량" 머리글을 찾지 못했습니다. 이 화면에서 받은 양식을 쓰세요.', 'error'); return; }
    const head = grid[hr].map(norm);
    const col = (n) => head.indexOf(n);
    const cF = col('공장'), cC = col('제품코드'), cN = col('제품명'), cP = col('포장'), cM = col('월평균출하량'), cLo = col('하한'), cHi = col('상한');
    const list = read();
    let ok = 0, skip = 0;
    grid.slice(hr + 1).forEach(r => {
      if (!r) return;
      const code = String(r[cC] ?? '').trim();
      if (!code) return;
      const factory = facCode(cF >= 0 ? r[cF] : '') || (fac() !== 'ALL' ? fac() : '');
      const pack = /톤백/.test(String(r[cP] || '')) ? '톤백' : /지대|포대/.test(String(r[cP] || '')) ? '지대' : '';
      const n = (c) => { const x = Number(String(c >= 0 ? r[c] ?? '' : '').replace(/[,\s]/g, '')); return x > 0 ? x : 0; };
      const monthlyShip = n(cM), minStock = n(cLo), maxStock = n(cHi);
      if (!factory || !pack || !(monthlyShip || minStock || maxStock)) { skip++; return; }
      const p = DB.getProductByCode ? DB.getProductByCode(code) : null;
      upsertBasis(list, {
        id: groupId(factory, code, pack), factory, productCode: code,
        productName: (p && p.name) || String(cN >= 0 ? r[cN] || '' : '').trim() || code, pack,
        monthlyShip, minStock, maxStock, updatedAt: now(), updatedBy: actor(),
      });
      ok++;
    });
    if (!ok) { App.toast(`불러올 행이 없습니다 (건너뜀 ${skip}행 — 공장·포장·수량 확인)`, 'warning'); return; }
    write(list);
    App.toast(`기준 출하량 ${ok}건을 불러왔습니다${skip ? ` · 건너뜀 ${skip}행` : ''}`, 'success', 3500);
    App.refreshPage();
  };

  const setFilter = (v) => { filter = v; App.refreshPage(); };
  const setPack = (v) => { packFilter = v; App.refreshPage(); };
  const setConfig = (k, v) => { if (saveConfig({ [k]: Number(v) })) App.refreshPage(); };

  return {
    compute, alerts, summary, getConfig, packClass, isShort, isOver,
    section, productionBanner, hintFor,
    openEdit, closeEdit, saveEdit, removeBasis,
    downloadTemplate, importFile, setFilter, setPack, setConfig,
  };
})();
