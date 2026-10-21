// ============================================================
// expiry_alert.js — 유통기한(소비기한) 임박 알림
//   식품안전관리인증원 범용 HACCP MES 표준모델의 '유통기한임박' 대응
//   원료(입고 LOT)와 제품(제품 LOT)을 한 화면에서 '남은 일자 / 지난 일자'로 구분해 관리
//   보관 중인 재고만 대상(출고·반려·소진 건 제외) · 공장별 분리
// ============================================================

const ExpiryAlertPage = (() => {
  const THRESHOLD_KEY = 'expiry_alert_days';
  let kindFilter = 'ALL';   // ALL | raw | prod
  let stateFilter = 'ALL';  // ALL | expired(지남) | near(임박) | ok(여유)
  let query = '';

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const today = () => new Date().toISOString().slice(0, 10);

  // 임박 기준일(사용자 설정, 기본 30일)
  const getThreshold = () => {
    const v = Number(localStorage.getItem(THRESHOLD_KEY));
    return (v && v > 0) ? v : 30;
  };
  const setThreshold = (v) => {
    const n = Number(v);
    if (!n || n <= 0) return;
    localStorage.setItem(THRESHOLD_KEY, String(n));
    App.refreshPage();
  };

  const daysLeft = (expiry) => {
    if (!expiry) return null;
    const a = new Date(today() + 'T00:00:00'), b = new Date(String(expiry).slice(0, 10) + 'T00:00:00');
    if (isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  };
  const stateOf = (d) => d == null ? 'none' : d < 0 ? 'expired' : d <= getThreshold() ? 'near' : 'ok';

  // ── 대상 수집 ──
  //   원료: 입고 레코드 중 보관 중인 것(입고완료·승인·검사대기). 반려/취소/출고분 제외.
  //   제품: 제품 LOT 중 AVAILABLE(미출고).
  const RAW_ALIVE = ['IN_STOCK', 'APPROVED', 'PENDING_QC', 'HOLD'];

  // 기한이 등록되지 않은 보관 재고 — 이 화면에서 바로 입력할 수 있게 별도 수집
  const collectMissing = () => {
    const f = fac();
    const out = [];
    try {
      (DB.getReceivings() || []).forEach(r => {
        if (!RAW_ALIVE.includes(r.status)) return;
        if (f !== 'ALL' && r.factory !== f) return;
        if (r.expiryDate) return;
        out.push({ kind: 'raw', kindLabel: '원료', id: r.id, code: r.materialCode || '', name: r.materialName || '-',
          lot: r.lotNo || r.preRegId || '', factory: r.factory, made: r.manufactureDate || r.receivedDate || '',
          qty: Number(r.actualWeight || r.expectedWeight || 0), unit: r.unit || 'kg' });
      });
    } catch (_) {}
    try {
      (DB.getProductLots ? DB.getProductLots() : []).forEach(p => {
        if (p.status !== 'AVAILABLE') return;
        if (f !== 'ALL' && p.factory !== f) return;
        if (p.expiryDate) return;
        out.push({ kind: 'prod', kindLabel: '제품', id: p.id, code: p.productCode || '', name: p.productName || '-',
          lot: p.fgLotNo || '', factory: p.factory, made: p.productionDate || '',
          qty: Number(p.qty || 0), unit: p.unit || 'kg' });
      });
    } catch (_) {}
    return out;
  };

  // 미등록 건에 소비기한 저장
  const saveExpiry = (kind, id) => {
    const v = document.getElementById(`exp-in-${id}`)?.value;
    if (!v) { App.toast('소비기한을 선택하세요', 'warning'); return; }
    try {
      if (kind === 'raw') DB.updateReceiving(id, { expiryDate: v });
      else DB.updateProductLot(id, { expiryDate: v });
      App.toast('소비기한을 등록했습니다', 'success');
      App.refreshPage();
    } catch (e) { App.toast('저장 실패: ' + e.message, 'error'); }
  };
  // 제조일 + 기본 보관기간으로 자동 채우기
  const suggestExpiry = (kind, id, made, code) => {
    const el = document.getElementById(`exp-in-${id}`);
    if (!el) return;
    const months = kind === 'prod' ? DB.shelfMonthsFor(code) : (DB.getShelfConfig()._raw || 6);
    const base = made || today();
    el.value = DB.addMonthsTo(base, months);
    App.toast(`기본 보관기간 ${months}개월 적용 · 필요 시 수정하세요`, 'info', 2500);
  };

  const collect = () => {
    const f = fac();
    const out = [];
    try {
      (DB.getReceivings() || []).forEach(r => {
        if (!RAW_ALIVE.includes(r.status)) return;
        if (f !== 'ALL' && r.factory !== f) return;
        if (!r.expiryDate) return;
        const d = daysLeft(r.expiryDate);
        out.push({
          kind: 'raw', kindLabel: '원료', id: r.id,
          code: r.materialCode || '', name: r.materialName || '-',
          lot: r.lotNo || r.preRegId || '', factory: r.factory,
          supplier: r.supplierName || '',
          made: r.manufactureDate || '', expiry: String(r.expiryDate).slice(0, 10),
          qty: Number(r.actualWeight || r.expectedWeight || 0), unit: r.unit || 'kg',
          status: r.status, days: d, state: stateOf(d), page: 'receiving',
        });
      });
    } catch (_) {}
    try {
      (DB.getProductLots ? DB.getProductLots() : []).forEach(p => {
        if (p.status !== 'AVAILABLE') return;
        if (f !== 'ALL' && p.factory !== f) return;
        if (!p.expiryDate) return;
        const d = daysLeft(p.expiryDate);
        out.push({
          kind: 'prod', kindLabel: '제품', id: p.id,
          code: p.productCode || '', name: p.productName || '-',
          lot: p.fgLotNo || p.lotNo || '', factory: p.factory,
          supplier: '',
          made: p.productionDate || '', expiry: String(p.expiryDate).slice(0, 10),
          qty: Number(p.qty || 0), unit: p.unit || 'kg',
          status: p.status, days: d, state: stateOf(d), page: 'productStock',
        });
      });
    } catch (_) {}
    // 지남 → 임박 → 여유, 같은 상태면 기한 빠른 순
    const rank = { expired: 0, near: 1, ok: 2, none: 3 };
    return out.sort((a, b) => (rank[a.state] - rank[b.state]) || String(a.expiry).localeCompare(String(b.expiry)));
  };

  const filtered = (list) => {
    const q = query.toLowerCase().trim();
    return list.filter(x => {
      if (kindFilter !== 'ALL' && x.kind !== kindFilter) return false;
      if (stateFilter !== 'ALL' && x.state !== stateFilter) return false;
      if (!q) return true;
      return [x.code, x.name, x.lot, x.supplier].map(v => String(v || '').toLowerCase()).join(' ').includes(q);
    });
  };

  const stats = (list) => ({
    total: list.length,
    expired: list.filter(x => x.state === 'expired').length,
    near: list.filter(x => x.state === 'near').length,
    ok: list.filter(x => x.state === 'ok').length,
    rawN: list.filter(x => x.kind === 'raw').length,
    prodN: list.filter(x => x.kind === 'prod').length,
    riskQty: list.filter(x => x.state === 'expired' || x.state === 'near').reduce((s, x) => s + x.qty, 0),
  });

  const render = () => {
    const all = collect();
    const st = stats(all);
    const list = filtered(all);
    const missing = collectMissing();
    const th = getThreshold();
    const btn = (cur, v, fn, label, n, color) =>
      `<button class="btn btn-sm ${cur === v ? 'btn-primary' : 'btn-ghost'}" onclick="ExpiryAlertPage.${fn}('${v}')">${label}${n != null ? ` <b${color ? ` style="color:${color}"` : ''}>${n}</b>` : ''}</button>`;

    const rows = list.length ? list.map(x => {
      const dayCell = x.days == null ? '<span class="text-muted">-</span>'
        : x.days < 0 ? `<span class="badge badge-fail">${Math.abs(x.days)}일 지남</span>`
        : x.days <= th ? `<span class="badge badge-warning">${x.days}일 남음</span>`
        : `<span class="text-muted">${x.days}일 남음</span>`;
      return `<tr${x.state === 'expired' ? ' style="background:rgba(229,72,77,.06)"' : ''}>
        <td><span class="badge ${x.kind === 'prod' ? 'badge-info' : 'badge-default'}">${x.kindLabel}</span></td>
        <td class="td-mono text-xs">${esc(x.code)}</td>
        <td><strong>${esc(x.name)}</strong>${x.supplier ? `<div class="text-xs text-muted">${esc(x.supplier)}</div>` : ''}</td>
        <td class="td-mono text-xs">${esc(x.lot || '-')}</td>
        <td class="text-xs">${esc(DB.getFactoryName ? DB.getFactoryName(x.factory) : x.factory)}</td>
        <td class="td-right">${formatNum(x.qty)}${esc(x.unit)}</td>
        <td class="text-xs">${esc(x.made || '-')}</td>
        <td class="text-xs"><b>${esc(x.expiry)}</b></td>
        <td>${dayCell}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="App.navigate('${x.page}')">이동</button></td>
      </tr>`;
    }).join('') : `<tr><td colspan="10" style="text-align:center;padding:28px;color:var(--text-muted)">해당 조건의 재고가 없습니다</td></tr>`;

    return `
    <div class="fade-in">
      <div class="flex items-center justify-between mb-12" style="gap:10px;flex-wrap:wrap">
        <div class="text-sm text-muted">기한 등록 재고 ${st.total}건 (원료 ${st.rawN} · 제품 ${st.prodN}) · 임박기준 ${th}일</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="text-muted" style="font-size:12px">임박 기준</span>
          <select class="form-input form-input-sm" style="width:92px" onchange="ExpiryAlertPage.setThreshold(this.value)">
            ${[7, 14, 30, 60, 90].map(d => `<option value="${d}" ${th === d ? 'selected' : ''}>${d}일</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="inventory-summary-grid mb-16">
        <div class="inventory-summary-card ${st.expired > 0 ? 'summary-risk' : ''}"><div class="summary-label">기한 지남</div><div class="summary-value">${st.expired}<span>건</span></div></div>
        <div class="inventory-summary-card ${st.near > 0 ? 'summary-risk' : ''}"><div class="summary-label">기한 임박(${th}일)</div><div class="summary-value">${st.near}<span>건</span></div></div>
        <div class="inventory-summary-card"><div class="summary-label">여유</div><div class="summary-value">${st.ok}<span>건</span></div></div>
        <div class="inventory-summary-card ${st.riskQty > 0 ? 'summary-risk' : ''}"><div class="summary-label">조치대상 수량</div><div class="summary-value">${(st.riskQty / 1000).toFixed(1)}<span>t</span></div></div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
          <span class="text-muted" style="font-size:12px">구분</span>
          ${btn(kindFilter, 'ALL', 'setKind', '전체', st.total)}
          ${btn(kindFilter, 'raw', 'setKind', '원료', st.rawN)}
          ${btn(kindFilter, 'prod', 'setKind', '제품', st.prodN)}
          <span class="text-muted" style="font-size:12px;margin-left:6px">상태</span>
          ${btn(stateFilter, 'ALL', 'setState', '전체')}
          ${btn(stateFilter, 'expired', 'setState', '지남', st.expired, st.expired ? '#e5484d' : '')}
          ${btn(stateFilter, 'near', 'setState', '임박', st.near, st.near ? '#d4820f' : '')}
          ${btn(stateFilter, 'ok', 'setState', '여유', st.ok)}
          <input type="text" class="form-input form-input-sm" style="max-width:220px;margin-left:6px"
                 placeholder="코드·품명·LOT·공급처 검색" value="${esc(query)}" oninput="ExpiryAlertPage.onSearch(this.value)">
        </div>
      </div>

      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead><tr><th>구분</th><th>코드</th><th>품명</th><th>LOT</th><th>공장</th><th class="td-right">수량</th><th>제조일</th><th>기한</th><th>남은/지난</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:8px">
          보관 중인 재고만 표시합니다 (원료: 입고완료·승인·검사대기·보류 / 제품: 미출고). 반려·취소·출고분은 제외됩니다.
        </div>
      </div>

      ${missing.length ? `
      <div class="card" style="margin-top:14px;border-color:rgba(224,145,47,.45)">
        <div class="section-label">소비기한 미등록 재고 (${missing.length})
          <span class="text-muted" style="font-weight:400;font-size:12px">· 기한이 없으면 임박 관리 대상에서 빠집니다. 아래에서 바로 등록하세요.</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>구분</th><th>코드</th><th>품명</th><th>LOT</th><th>공장</th><th class="td-right">수량</th><th>제조/입고일</th><th>소비기한 입력</th><th></th></tr></thead>
            <tbody>${missing.map(x => `<tr>
              <td><span class="badge ${x.kind === 'prod' ? 'badge-info' : 'badge-default'}">${x.kindLabel}</span></td>
              <td class="td-mono text-xs">${esc(x.code)}</td>
              <td><strong>${esc(x.name)}</strong></td>
              <td class="td-mono text-xs">${esc(x.lot || '-')}</td>
              <td class="text-xs">${esc(DB.getFactoryName ? DB.getFactoryName(x.factory) : x.factory)}</td>
              <td class="td-right">${formatNum(x.qty)}${esc(x.unit)}</td>
              <td class="text-xs">${esc(x.made || '-')}</td>
              <td><input type="date" class="form-input form-input-sm" id="exp-in-${esc(x.id)}" style="width:150px"></td>
              <td style="white-space:nowrap">
                <button class="btn btn-ghost btn-xs" title="제조일 + 기본 보관기간" onclick="ExpiryAlertPage.suggestExpiry('${x.kind}','${esc(x.id)}','${esc(x.made)}','${esc(x.code)}')">자동</button>
                <button class="btn btn-primary btn-xs" onclick="ExpiryAlertPage.saveExpiry('${x.kind}','${esc(x.id)}')">저장</button>
              </td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="text-muted" style="font-size:12px;margin-top:8px">
          「자동」은 제품은 축종별 기본 보관기간(양축·양어 3개월 / 반려 12개월 / 기타 6개월), 원료는 기본 6개월을 적용합니다.
          이후 생성되는 제품 LOT은 제조일 기준으로 유통기한이 자동 계산됩니다.
        </div>
      </div>` : ''}
    </div>`;
  };

  // 대시보드 연동용 요약(공장 반영)
  const summary = () => {
    const list = collect();
    return stats(list);
  };

  const setKind = (v) => { kindFilter = v; App.refreshPage(); };
  const setState = (v) => { stateFilter = v; App.refreshPage(); };
  const onSearch = (v) => { query = v; App.refreshPage(); };

  return { render, setKind, setState, onSearch, setThreshold, summary, getThreshold,
    saveExpiry, suggestExpiry };
})();
