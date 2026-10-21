// ============================================================
// productstock.js — 제품 재고 현황 (제품LOT 생산량 − 출고량)
// ============================================================

const ProductStockPage = (() => {
  const render = () => {
    const factory = App.getFactory();
    const rows = DB.getProductStockRows(factory);
    const totalRemain = rows.reduce((s, r) => s + r.remaining, 0);
    const totalProd   = rows.reduce((s, r) => s + r.produced, 0);
    const totalShip   = rows.reduce((s, r) => s + r.shipped, 0);
    const soldout = rows.filter(r => r.remaining === 0).length;

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">제품 LOT ${rows.length}건 · 재고소진 ${soldout}건</div>
          <button class="btn btn-primary btn-sm" onclick="App.navigate('outbound')">출고 처리</button>
        </div>

        <div class="inventory-summary-grid mb-20">
          <div class="inventory-summary-card"><div class="summary-label">총 생산량</div><div class="summary-value">${formatNum(totalProd)}</div></div>
          <div class="inventory-summary-card"><div class="summary-label">총 출고량</div><div class="summary-value">${formatNum(totalShip)}</div></div>
          <div class="inventory-summary-card"><div class="summary-label">현재 제품재고</div><div class="summary-value">${formatNum(totalRemain)}</div></div>
          <div class="inventory-summary-card ${soldout>0?'':''}"><div class="summary-label">소진 LOT</div><div class="summary-value">${soldout}<span>건</span></div></div>
        </div>

        ${typeof StockLevel !== 'undefined' ? StockLevel.section() : ''}

        <div class="card">
          <div class="table-wrapper"><table>
            <thead><tr><th>제품 LOT</th><th>제품명</th><th>공장</th><th>생산일</th><th>포장</th><th class="td-right">생산</th><th class="td-right">출고</th><th class="td-right">재고</th><th>QR</th></tr></thead>
            <tbody>${rows.length===0?`<tr><td colspan="9" style="text-align:center;padding:28px;color:var(--text-muted)">생산된 제품 LOT이 없습니다</td></tr>`:
              rows.map(r => `<tr${r.remaining===0?' style="opacity:.55"':''}>
                <td class="td-mono text-xs">${r.fgLotNo||r.id}</td>
                <td><strong>${r.productName||'-'}</strong></td>
                <td>${DB.getFactoryName(r.factory)}</td>
                <td class="text-xs">${r.productionDate||'-'}</td>
                <td class="text-xs">${r.packType||'-'}</td>
                <td class="td-right">${formatNum(r.produced)}</td>
                <td class="td-right">${formatNum(r.shipped)}</td>
                <td class="td-right font-bold" style="color:${r.remaining===0?'var(--text-muted)':'var(--success)'}">${formatNum(r.remaining)}</td>
                <td><button class="btn btn-ghost btn-xs" onclick="App.navigate('history','${(r.fgLotNo||r.id)}')">추적</button></td>
              </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  };

  const afterRender = () => {};
  return { render, afterRender };
})();
