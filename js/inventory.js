// ============================================================
// inventory.js — 톤백·지대 재고 현황
// ============================================================

const InventoryPage = (() => {
  const cycleBadge = (status) => {
    const map = {
      CRITICAL: '<span class="badge badge-fail">긴급 발주</span>',
      WARN: '<span class="badge badge-warning">발주 검토</span>',
      WATCH: '<span class="badge badge-info">관찰</span>',
      OK: '<span class="badge badge-pass">안정</span>',
      NO_USAGE: '<span class="badge badge-default">사용 이력 부족</span>'
    };
    return map[status] || `<span class="badge badge-default">${status}</span>`;
  };

  const render = () => {
    const factory   = App.getFactory();
    const inventory = factory === 'ALL' ? DB.getInventory() : DB.getInventory().filter(i => i.factory === factory);
    const cycleRows = DB.getInventoryCycleRows(factory);
    const totalStock = cycleRows.reduce((s, r) => s + r.stockKg, 0);
    const totalUsed30 = cycleRows.reduce((s, r) => s + r.used30d, 0);
    const avgDaily = totalUsed30 / 30;
    const riskCount = cycleRows.filter(r => ['CRITICAL','WARN'].includes(r.status)).length;

    const packTypes  = ['BULK','TONBAG','SACK'];
    const grouped    = packTypes.reduce((acc, pt) => { acc[pt] = inventory.filter(i => i.packType === pt); return acc; }, {});
    const packNames  = { BULK:'벌크', TONBAG:'톤백', SACK:'포대(지대)' };
    const packIcons  = { BULK:'', TONBAG:'', SACK:'' };

    return `
      <div class="fade-in">
        <div class="flex items-center justify-between mb-20">
          <div class="text-sm text-muted">재고표 ${inventory.length}개 품목 · 재고주기 ${cycleRows.length}개 원료</div>
          <button class="btn btn-primary btn-sm" onclick="App.navigate('receiving');setTimeout(()=>ReceivingPage.openAddModal(),200)">
            ＋ 입고 등록
          </button>
        </div>

        <div class="inventory-summary-grid mb-20">
          <div class="inventory-summary-card">
            <div class="summary-label">현재 원료 재고</div>
            <div class="summary-value">${formatNum(totalStock)}<span>kg</span></div>
          </div>
          <div class="inventory-summary-card">
            <div class="summary-label">최근 30일 사용량</div>
            <div class="summary-value">${formatNum(totalUsed30)}<span>kg</span></div>
          </div>
          <div class="inventory-summary-card">
            <div class="summary-label">일평균 사용량</div>
            <div class="summary-value">${formatNum(Math.round(avgDaily))}<span>kg/day</span></div>
          </div>
          <div class="inventory-summary-card ${riskCount>0?'summary-risk':''}">
            <div class="summary-label">발주 검토 대상</div>
            <div class="summary-value">${riskCount}<span>건</span></div>
          </div>
        </div>

        ${renderCycleTable(cycleRows)}

        ${inventory.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon"></div>
            <h3>재고 없음</h3>
            <p>입고 완료 후 품질 검사를 통과한 원료가 여기에 표시됩니다</p>
          </div>
        ` : packTypes.map(pt => {
          const items = grouped[pt];
          if (items.length === 0) return '';
          return `
            <div class="mb-24">
              <div class="section-title mb-12">${packIcons[pt]} ${packNames[pt]} 재고 (${items.length}개 품목)</div>
              <div class="card">
                <div class="table-wrapper">
                  <table>
                    <thead>
                      <tr><th>원료코드</th><th>원료명</th><th>공장</th><th>창고/위치</th>
                          <th class="td-right">수량</th><th class="td-right">중량(kg)</th>
                          <th>LOT수</th><th>액션</th></tr>
                    </thead>
                    <tbody>
                      ${items.map(i => `<tr>
                        <td><span class="td-mono text-xs">${i.materialCode}</span></td>
                        <td><strong>${i.materialName}</strong></td>
                        <td>${DB.getFactoryName(i.factory)}</td>
                        <td><span class="td-mono">${i.binLocation||'-'} / ${i.warehouse||'-'}</span></td>
                        <td class="td-right">${formatNum(i.qty)}</td>
                        <td class="td-right">${formatNum(i.weight)}</td>
                        <td class="td-center">${(i.lots||[]).length}</td>
                        <td><button class="btn btn-ghost btn-xs" onclick="App.navigate('outbound')">출고</button></td>
                      </tr>`).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
  };

  const renderCycleTable = (rows) => `
    <div class="mb-24">
      <div class="section-title mb-12">원료 사용량 기반 재고주기 예측</div>
      <div class="card">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>원료코드</th><th>원료명</th><th>공장</th><th>보관위치</th>
                <th class="td-right">현재고(kg)</th><th class="td-right">30일 사용(kg)</th>
                <th class="td-right">일평균</th><th class="td-right">가용일수</th>
                <th>예상 소진일</th><th>상태</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-muted)">재고주기 계산 대상이 없습니다</td></tr>` :
              rows.map(r => `
                <tr>
                  <td><span class="td-mono text-xs">${r.materialCode}</span></td>
                  <td><strong>${r.materialName}</strong></td>
                  <td>${DB.getFactoryName(r.factory)}</td>
                  <td class="text-xs">${r.locations.slice(0,2).join(', ')}${r.locations.length>2?' 외 '+(r.locations.length-2):''}</td>
                  <td class="td-right font-bold">${formatNum(Math.round(r.stockKg))}</td>
                  <td class="td-right">${formatNum(Math.round(r.used30d))}</td>
                  <td class="td-right">${r.avgDaily > 0 ? formatNum(Math.round(r.avgDaily)) : '-'}</td>
                  <td class="td-right">${r.coverDays != null ? r.coverDays.toFixed(1) + '일' : '-'}</td>
                  <td>${r.reorderDate || '-'}</td>
                  <td>${cycleBadge(r.status)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const afterRender = () => {};
  return { render, afterRender };
})();
