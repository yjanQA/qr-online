// ============================================================
// qm_lot.js — 품질검사 로트 · 품질재고 · 검사설정 화면
//
//   근거: 우성사료 To-Be 정의서(품질 업무영역) — SAP QM
//     QmLotPage   검사로트 : 로트 생성 → 샘플 → 결과등록 → 합부판정 → 용도결정
//     QmStockPage 품질재고 : 3구분 현황 · 반복검사 트리거 · 부적합 처분(QM.3)
//     QmSetupPage 검사설정 : 자재별 검사대상 지정(자재마스터 QM뷰, QM.1.1.5)
// ============================================================

// ── 공통 부품 ──
const QmUI = (() => {
  const esc = (v) => String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const fac = () => (typeof App !== 'undefined' && App.getFactory) ? App.getFactory() : 'ALL';
  const facName = (id) => (typeof DB !== 'undefined' && DB.getFactoryName) ? DB.getFactoryName(id) : (id || '-');
  const actor = () => { try { return (typeof Auth !== 'undefined' && Auth.currentName()) || '품질팀'; } catch (_) { return '품질팀'; } };
  const badge = (map, k) => {
    const m = QmDB.meta(map, k);
    return `<span class="badge ${m.cls || 'badge-default'}">${esc(m.label)}</span>`;
  };
  const kg = (v) => (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const num = (id) => Number(document.getElementById(id)?.value) || 0;
  const openModal = (id) => document.getElementById(id)?.classList.add('open');
  const closeModal = (id) => document.getElementById(id)?.classList.remove('open');
  const match = (q, ...vals) => {
    const lq = String(q || '').trim().toLowerCase();
    return !lq || vals.some(v => String(v || '').toLowerCase().includes(lq));
  };
  const empty = (t, h) => `<div class="empty-state"><h3>${esc(t)}</h3><p>${esc(h || '')}</p></div>`;
  const dateOnly = (v) => String(v || '').slice(0, 10);
  return { esc, fac, facName, actor, badge, kg, val, num, openModal, closeModal, match, empty, dateOnly };
})();


// ============================================================
// 검사로트
// ============================================================
const QmLotPage = (() => {
  const U = () => QmUI;
  let q = '', fOrigin = '', fStatus = '';
  let resultFor = null, udFor = null;
  let rows = [];   // 결과 입력 중인 항목

  const list = () => {
    const u = U();
    return QmDB.getLotsBy(u.fac())
      .filter(l => !fOrigin || l.origin === fOrigin)
      .filter(l => !fStatus || l.status === fStatus)
      .filter(l => u.match(q, l.lotNo, l.materialName, l.materialCode, l.batchNo, l.supplierName));
  };

  const card = (l) => {
    const u = U();
    const ng = (l.results || []).filter(r => r.judge === 'NG');
    return `
      <div class="card qm-card ${l.verdict === 'FAIL' ? 'fail' : ''}">
        <div class="qm-card-head">
          <div>
            <div class="qm-code">${u.esc(l.lotNo)} · ${u.esc(u.facName(l.factory))} · ${u.esc(QmDB.ORIGINS[l.origin].ref)}</div>
            <h4>${u.esc(l.materialName || l.materialCode)} <em>${u.esc(l.materialCode)}</em></h4>
          </div>
          <div class="qm-badges">
            ${u.badge(QmDB.ORIGINS, l.origin)}
            ${u.badge(QmDB.LOT_STATUS, l.status)}
            ${l.verdict ? u.badge(QmDB.VERDICTS, l.verdict) : ''}
          </div>
        </div>

        <div class="qm-kv">
          <div><label>배치·LOT</label><span>${u.esc(l.batchNo || '-')}</span></div>
          <div><label>검사 수량</label><span>${u.kg(l.qty)} ${u.esc(l.unit)}</span></div>
          ${l.supplierName ? `<div><label>공급사</label><span>${u.esc(l.supplierName)}</span></div>` : ''}
          ${l.expiryDate ? `<div><label>유통기한</label><span>${u.esc(l.expiryDate)}${l.expiryAfter ? ` → ${u.esc(l.expiryAfter)} (재조정)` : ''}</span></div>` : ''}
          ${l.nextInspectDate ? `<div><label>차기 검사일</label><span>${u.esc(l.nextInspectDate)}</span></div>` : ''}
          ${l.note ? `<div><label>비고</label><span>${u.esc(l.note)}</span></div>` : ''}
          ${l.ud ? `<div><label>용도결정</label><span>${u.badge(QmDB.UD_CODES, l.ud.code)} ${u.kg(l.ud.qty)}kg · ${u.esc(l.ud.by)} · ${u.esc(u.dateOnly(l.ud.at))}${l.ud.note ? ` — ${u.esc(l.ud.note)}` : ''}</span></div>` : ''}
        </div>

        ${(l.results || []).length ? `
          <div class="table-wrap">
            <table class="data-table qm-res">
              <thead><tr><th>검사항목</th><th class="td-right">결과</th><th class="td-right">기준</th><th>판정</th></tr></thead>
              <tbody>${l.results.map(r => `<tr class="${r.judge === 'NG' ? 'ng' : ''}">
                <td>${u.esc(r.label || r.item)}</td>
                <td class="td-right mono">${u.esc(r.value)} ${u.esc(r.unit || '')}</td>
                <td class="td-right mono">${u.esc(rangeText(r))}</td>
                <td>${r.judge === 'NG' ? '<span class="badge badge-fail">이탈</span>' : r.judge === 'OK' ? '<span class="badge badge-pass">적합</span>' : '-'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : ''}
        ${(l.qualResults || []).length ? `<div class="qm-qual">${l.qualResults.map(qr =>
          `<span class="qm-qualchip ${qr.ng ? 'ng' : ''}">${u.esc(qr.group)} · ${u.esc(qr.label)}</span>`).join('')}</div>` : ''}
        ${ng.length ? `<div class="qm-ngline">규격 이탈 ${ng.length}항목 — ${u.esc(ng.map(r => r.label || r.item).join(', '))}</div>` : ''}

        <div class="qm-actions">
          ${l.status === 'CREATED' ? `<button class="btn btn-sm" onclick="QmLotPage.sample('${l.id}')">샘플 채취</button>` : ''}
          ${l.status !== 'UD_DONE' && l.status !== 'CANCELLED' ? `<button class="btn btn-sm btn-primary" onclick="QmLotPage.openResult('${l.id}')">검사결과 등록</button>` : ''}
          ${l.status === 'RESULTED' ? `<button class="btn btn-sm btn-primary" onclick="QmLotPage.openUD('${l.id}')">용도결정</button>` : ''}
          ${l.status !== 'UD_DONE' ? `<button class="btn btn-sm btn-danger" onclick="QmLotPage.remove('${l.id}')">삭제</button>` : ''}
        </div>
      </div>`;
  };

  const rangeText = (r) => {
    const lo = String(r.lower ?? '').trim(), hi = String(r.upper ?? '').trim();
    if (lo && hi) return `${lo} ~ ${hi}`;
    if (lo) return `${lo} 이상`;
    if (hi) return `${hi} 이하`;
    return '-';
  };

  const render = () => {
    const u = U();
    const s = QmDB.summary(u.fac());
    const rowsHtml = list();
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">품질 · 실험실</div>
            <h2>품질검사 로트</h2>
            <p>검사의 단위를 로트로 관리합니다. 로트가 생기면 그 수량은 품질검사재고로 잠기고, 용도결정을 거쳐야 가용재고로 풀립니다.</p>
            <div class="qm-docref">근거: 우성사료 To-Be 정의서(품질 업무영역) QM.2 품질검사 — 원부재료 입고검사 / 제품·반제품 입고검사 / 재고 반복검사</div>
          </div>
          <div class="module-metrics">
            <div><span>${s.openLots}</span><label>진행중 로트</label></div>
            <div><span>${s.awaitingUD}</span><label>용도결정 대기</label></div>
            <div><span>${s.failLots}</span><label>부적합 미처리</label></div>
            <div><span>${s.pendingRecv + s.pendingProd}</span><label>로트 미생성</label></div>
          </div>
        </div>

        ${s.pendingRecv || s.pendingProd ? `
          <div class="qm-alert">
            검사로트가 아직 만들어지지 않은 건이 있습니다 —
            입고 ${s.pendingRecv}건 · 생산 ${s.pendingProd}건.
            <button class="btn btn-sm btn-primary" onclick="QmLotPage.openIntake()">로트 생성하기</button>
          </div>` : ''}

        <div class="qm-toolbar">
          <input type="text" class="form-input qm-search" placeholder="로트번호 · 자재 · 배치 · 공급사 검색"
                 value="${u.esc(q)}" oninput="QmLotPage.onSearch(this.value)">
          <select class="form-input qm-filter" onchange="QmLotPage.onOrigin(this.value)">
            <option value="">전체 발생원</option>
            ${Object.entries(QmDB.ORIGINS).map(([k, v]) => `<option value="${k}" ${fOrigin === k ? 'selected' : ''}>${u.esc(v.label)}</option>`).join('')}
          </select>
          <select class="form-input qm-filter" onchange="QmLotPage.onStatus(this.value)">
            <option value="">전체 상태</option>
            ${Object.entries(QmDB.LOT_STATUS).map(([k, v]) => `<option value="${k}" ${fStatus === k ? 'selected' : ''}>${u.esc(v.label)}</option>`).join('')}
          </select>
          <div class="qm-toolbar-right">
            <button class="btn btn-sm" onclick="QmLotPage.openIntake()">＋ 로트 생성</button>
          </div>
        </div>

        <div class="qm-list">
          ${rowsHtml.length ? rowsHtml.map(card).join('')
            : u.empty('검사로트가 없습니다', '＋ 로트 생성에서 입고·생산 건을 불러오십시오.')}
        </div>

        ${intakeModal()}
        ${resultModal()}
        ${udModal()}
      </div>`;
  };

  // ── 로트 생성 (입고·생산 건 불러오기) ──
  const intakeModal = () => {
    const u = U();
    const recv = QmDB.pendingReceivings(u.fac()).slice(0, 60);
    const prod = QmDB.pendingProductLots(u.fac()).slice(0, 60);
    return `
      <div class="modal-overlay" id="qm-intake-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>검사로트 생성</h3>
            <button class="modal-close" onclick="QmUI.closeModal('qm-intake-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="qm-note">
              검사설정에서 <b>검사대상으로 지정된 자재</b>만 나옵니다.
              로트를 만들면 해당 수량이 품질검사재고로 잠깁니다.
            </div>

            <div class="qm-formsec">구매입고 (QM.2.1) — ${recv.length}건</div>
            ${recv.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>입고일</th><th>자재</th><th>공급사</th><th class="td-right">중량</th><th>상태</th><th></th></tr></thead>
              <tbody>${recv.map(r => `<tr>
                <td class="text-sm">${u.esc(u.dateOnly(r.receivedDate || r.createdAt))}</td>
                <td>${u.esc(r.materialName || r.materialCode)}</td>
                <td class="text-sm">${u.esc(r.supplierName || '-')}</td>
                <td class="td-right mono">${u.kg(r.actualWeight || r.expectedWeight)}kg</td>
                <td class="text-sm text-muted">${u.esc(r.status)}</td>
                <td><button class="btn btn-sm btn-primary" onclick="QmLotPage.fromReceiving('${r.id}')">로트 생성</button></td>
              </tr>`).join('')}</tbody></table></div>`
              : '<div class="qm-emptyline">대기 중인 입고건이 없습니다</div>'}

            <div class="qm-formsec">생산입고 (QM.2.2) — ${prod.length}건</div>
            ${prod.length ? `<div class="table-wrap"><table class="data-table">
              <thead><tr><th>생산일</th><th>제품</th><th>LOT</th><th class="td-right">수량</th><th></th></tr></thead>
              <tbody>${prod.map(p => `<tr>
                <td class="text-sm">${u.esc(u.dateOnly(p.productionDate || p.createdAt))}</td>
                <td>${u.esc(p.productName || p.productCode)}</td>
                <td class="mono text-sm">${u.esc(p.lotNo || p.id)}</td>
                <td class="td-right mono">${u.kg(p.qty || p.weight)}</td>
                <td><button class="btn btn-sm btn-primary" onclick="QmLotPage.fromProductLot('${p.id}')">로트 생성</button></td>
              </tr>`).join('')}</tbody></table></div>`
              : '<div class="qm-emptyline">대기 중인 생산 LOT 이 없습니다</div>'}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="QmUI.closeModal('qm-intake-modal')">닫기</button>
          </div>
        </div>
      </div>`;
  };

  // ── 검사결과 등록 ──
  const labItems = () => {
    try {
      if (typeof LabDB !== 'undefined' && LabDB.getItems) return LabDB.getItems() || [];
    } catch (_) {}
    return (window.LAB_ITEMS || []);
  };

  const resultModal = () => {
    const u = U();
    const l = resultFor ? QmDB.getLotById(resultFor) : null;
    return `
      <div class="modal-overlay" id="qm-result-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>검사결과 등록${l ? ` — ${u.esc(l.lotNo)}` : ''}</h3>
            <button class="modal-close" onclick="QmUI.closeModal('qm-result-modal')">✕</button>
          </div>
          <div class="modal-body">
            ${l ? `
              <div class="qm-note">
                ${u.esc(l.materialName || l.materialCode)} · 배치 ${u.esc(l.batchNo || '-')} · ${u.kg(l.qty)}${u.esc(l.unit)}
                <br>상·하한을 넣으면 자동으로 이탈 여부를 판정합니다. 최종 판정은 아래에서 확정하십시오.
              </div>
              <div class="table-wrap">
                <table class="data-table qm-res-edit">
                  <thead><tr><th>검사항목</th><th>단위</th><th>하한</th><th>상한</th><th>결과</th><th></th></tr></thead>
                  <tbody id="qm-res-rows">${rows.map(rowHtml).join('')}</tbody>
                </table>
              </div>
              <div class="flex gap-8 mt-8">
                <select class="form-input" id="qm-add-item" style="max-width:260px">
                  <option value="">＋ 검사항목 추가</option>
                  ${labItems().map(it => `<option value="${u.esc(it.key)}|${u.esc(it.label)}|${u.esc(it.unit || '')}">${u.esc(it.label)}${it.unit ? ` (${u.esc(it.unit)})` : ''}</option>`).join('')}
                </select>
                <button class="btn btn-sm" onclick="QmLotPage.addRowFromSelect()">추가</button>
                <button class="btn btn-sm" onclick="QmLotPage.addRow()">빈 행 추가</button>
              </div>

              <div class="qm-formsec">정성 검사 (외관·이물·관능)</div>
              <div class="qm-qualgrid" id="qm-qual">
                ${QUAL_SETS.map((set, gi) => `
                  <div class="qm-qualset">
                    <label>${u.esc(set.group)}</label>
                    <select class="form-input" data-qual="${gi}">
                      <option value="">미판정</option>
                      ${set.codes.map((c, ci) => `<option value="${ci}" ${qualPick[gi] === String(ci) ? 'selected' : ''}>${u.esc(c.label)}</option>`).join('')}
                    </select>
                  </div>`).join('')}
              </div>

              <div class="form-row mt-12">
                <div class="form-group"><label class="form-label">최종 판정</label>
                  <select class="form-input" id="qm-verdict">
                    <option value="">자동 판정에 맡김</option>
                    ${Object.entries(QmDB.VERDICTS).map(([k, v]) => `<option value="${k}">${u.esc(v.label)}</option>`).join('')}
                  </select>
                  <div class="form-hint">비워두면 규격 이탈 여부로 자동 판정합니다. 조건부합격은 직접 선택해야 합니다.</div>
                </div>
                <div class="form-group"><label class="form-label">검사자</label>
                  <input type="text" class="form-input" id="qm-tester" value="${u.esc(u.actor())}" readonly></div>
              </div>
            ` : '<div class="qm-emptyline">로트를 찾을 수 없습니다</div>'}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="QmUI.closeModal('qm-result-modal')">취소</button>
            <button class="btn btn-primary" onclick="QmLotPage.submitResult()">결과 저장</button>
          </div>
        </div>
      </div>`;
  };

  // 정성 검사 선택세트 — SAP 의 코드그룹/선택세트에 대응하는 최소 구현
  const QUAL_SETS = [
    { group: '외관', codes: [{ label: '정상', ng: false }, { label: '변색', ng: true }, { label: '뭉침·고결', ng: true }] },
    { group: '이물', codes: [{ label: '없음', ng: false }, { label: '이물 혼입', ng: true }] },
    { group: '냄새', codes: [{ label: '정상', ng: false }, { label: '이취', ng: true }] },
    { group: '해충', codes: [{ label: '없음', ng: false }, { label: '발견', ng: true }] },
  ];
  let qualPick = {};

  const rowHtml = (r, i) => `
    <tr>
      <td><input type="text" class="form-input" value="${QmUI.esc(r.label || '')}" oninput="QmLotPage.onRow(${i},'label',this.value)"></td>
      <td><input type="text" class="form-input" value="${QmUI.esc(r.unit || '')}" oninput="QmLotPage.onRow(${i},'unit',this.value)"></td>
      <td><input type="text" class="form-input" value="${QmUI.esc(r.lower ?? '')}" oninput="QmLotPage.onRow(${i},'lower',this.value)"></td>
      <td><input type="text" class="form-input" value="${QmUI.esc(r.upper ?? '')}" oninput="QmLotPage.onRow(${i},'upper',this.value)"></td>
      <td><input type="text" class="form-input" value="${QmUI.esc(r.value ?? '')}" oninput="QmLotPage.onRow(${i},'value',this.value)"></td>
      <td><button class="btn btn-sm" onclick="QmLotPage.delRow(${i})">✕</button></td>
    </tr>`;

  // ── 용도결정 ──
  const udModal = () => {
    const u = U();
    const l = udFor ? QmDB.getLotById(udFor) : null;
    const suggest = l ? (l.verdict === 'PASS' ? 'A' : l.verdict === 'COND' ? 'C' : 'B') : 'A';
    return `
      <div class="modal-overlay" id="qm-ud-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>용도결정${l ? ` — ${u.esc(l.lotNo)}` : ''}</h3>
            <button class="modal-close" onclick="QmUI.closeModal('qm-ud-modal')">✕</button>
          </div>
          <div class="modal-body">
            ${l ? `
              <div class="qm-note">
                ${u.esc(l.materialName)} · 배치 ${u.esc(l.batchNo || '-')} · 검사수량 ${u.kg(l.qty)}${u.esc(l.unit)}
                <br>판정 ${u.badge(QmDB.VERDICTS, l.verdict)} — 판정은 규격 충족 여부이고,
                <b>이 재고를 어떻게 할지는 용도결정이 정합니다.</b>
              </div>
              <div class="form-group"><label class="form-label">용도결정 코드</label>
                <div class="qm-udlist">
                  ${Object.entries(QmDB.UD_CODES).map(([k, v]) => `
                    <label class="qm-udrow ${suggest === k ? 'suggest' : ''}">
                      <input type="radio" name="qm-ud" value="${k}" ${suggest === k ? 'checked' : ''}>
                      <div>
                        <strong>${k} ${u.esc(v.label)}</strong>
                        <p>${u.esc(v.desc)}${v.need.includes('note') ? ' · 사유 필수' : ''}</p>
                      </div>
                    </label>`).join('')}
                </div>
              </div>
              <div class="form-row">
                <div class="form-group"><label class="form-label">수량 (${u.esc(l.unit)})</label>
                  <input type="number" class="form-input" id="qm-ud-qty" value="${l.qty}" step="0.1">
                  <div class="form-hint">일부만 결정하면 나머지는 검사재고로 남습니다.</div></div>
                ${l.origin === 'P09' ? `<div class="form-group"><label class="form-label">유통기한 재조정</label>
                  <input type="date" class="form-input" id="qm-ud-expiry" value="${u.esc(l.expiryDate || '')}">
                  <div class="form-hint">반복검사 결과에 따라 조정합니다 (MM.1.1.5.2 배치변경).</div></div>` : ''}
              </div>
              <div class="form-group"><label class="form-label">사유·비고</label>
                <textarea class="form-input" id="qm-ud-note" rows="2" placeholder="특채·재작업·반품·폐기는 사유가 필수입니다"></textarea></div>
            ` : '<div class="qm-emptyline">로트를 찾을 수 없습니다</div>'}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="QmUI.closeModal('qm-ud-modal')">취소</button>
            <button class="btn btn-primary" onclick="QmLotPage.submitUD()">결정 확정</button>
          </div>
        </div>
      </div>`;
  };

  // ── 이벤트 ──
  const openIntake = () => { App.refreshPage(); QmUI.openModal('qm-intake-modal'); };
  const fromReceiving = (id) => {
    try { const l = QmDB.createLotFromReceiving(id, QmUI.actor()); App.toast(`검사로트 ${l.lotNo} 생성 — ${QmUI.kg(l.qty)}kg 검사재고로 전환`, 'success'); }
    catch (e) { App.toast(e.message, 'error'); }
    App.refreshPage(); QmUI.openModal('qm-intake-modal');
  };
  const fromProductLot = (id) => {
    try { const l = QmDB.createLotFromProductLot(id, QmUI.actor()); App.toast(`검사로트 ${l.lotNo} 생성`, 'success'); }
    catch (e) { App.toast(e.message, 'error'); }
    App.refreshPage(); QmUI.openModal('qm-intake-modal');
  };

  const sample = (id) => { QmDB.sampleLot(id, QmUI.actor()); App.toast('샘플 채취를 기록했습니다', 'success'); App.refreshPage(); };

  const openResult = (id) => {
    resultFor = id;
    const l = QmDB.getLotById(id);
    rows = (l?.results || []).map(r => ({ ...r }));
    qualPick = {};
    (l?.qualResults || []).forEach(qr => {
      const gi = QUAL_SETS.findIndex(s => s.group === qr.group);
      if (gi >= 0) { const ci = QUAL_SETS[gi].codes.findIndex(c => c.label === qr.label); if (ci >= 0) qualPick[gi] = String(ci); }
    });
    if (!rows.length) {
      // 기본 항목 — 사료 일반성분. 규격은 비워두고 담당자가 채운다.
      rows = [
        { item: 'moist', label: '수분', unit: '%', lower: '', upper: '', value: '' },
        { item: 'protein', label: '조단백', unit: '%', lower: '', upper: '', value: '' },
        { item: 'fat', label: '조지방', unit: '%', lower: '', upper: '', value: '' },
        { item: 'fiber', label: '조섬유', unit: '%', lower: '', upper: '', value: '' },
        { item: 'ash', label: '조회분', unit: '%', lower: '', upper: '', value: '' },
      ];
    }
    App.refreshPage(); QmUI.openModal('qm-result-modal');
  };

  const repaintRows = () => {
    const el = document.getElementById('qm-res-rows');
    if (el) el.innerHTML = rows.map(rowHtml).join('');
  };
  const onRow = (i, f, v) => { if (rows[i]) rows[i][f] = v; };
  const addRow = () => { rows.push({ item: '', label: '', unit: '', lower: '', upper: '', value: '' }); repaintRows(); };
  const delRow = (i) => { rows.splice(i, 1); repaintRows(); };
  const addRowFromSelect = () => {
    const v = QmUI.val('qm-add-item');
    if (!v) return;
    const [key, label, unit] = v.split('|');
    rows.push({ item: key, label, unit, lower: '', upper: '', value: '' });
    repaintRows();
    const sel = document.getElementById('qm-add-item'); if (sel) sel.value = '';
  };

  const submitResult = () => {
    if (!resultFor) return;
    const quals = [];
    document.querySelectorAll('#qm-qual select[data-qual]').forEach(sel => {
      const gi = Number(sel.dataset.qual);
      if (sel.value === '') return;
      const c = QUAL_SETS[gi].codes[Number(sel.value)];
      quals.push({ group: QUAL_SETS[gi].group, code: sel.value, label: c.label, ng: c.ng });
    });
    const filled = rows.filter(r => String(r.label || '').trim());
    QmDB.saveResults(resultFor, filled, quals, QmUI.val('qm-verdict'), QmUI.actor());
    const l = QmDB.getLotById(resultFor);
    resultFor = null;
    QmUI.closeModal('qm-result-modal');
    App.toast(`검사결과를 저장했습니다 — 판정 ${QmDB.meta(QmDB.VERDICTS, l.verdict).label}`, l.verdict === 'FAIL' ? 'warning' : 'success');
    App.refreshPage();
  };

  const openUD = (id) => { udFor = id; App.refreshPage(); QmUI.openModal('qm-ud-modal'); };
  const submitUD = () => {
    if (!udFor) return;
    const code = document.querySelector('input[name="qm-ud"]:checked')?.value;
    try {
      const l = QmDB.decideUsage(udFor, code, {
        qty: QmUI.num('qm-ud-qty'),
        note: QmUI.val('qm-ud-note'),
        by: QmUI.actor(),
        newExpiry: QmUI.val('qm-ud-expiry'),
      });
      udFor = null;
      QmUI.closeModal('qm-ud-modal');
      App.toast(`용도결정 완료 — ${QmDB.UD_CODES[code].label}`, 'success');
      App.refreshPage();
    } catch (e) { App.toast(e.message, 'error'); }
  };

  const remove = (id) => {
    if (!confirm('검사로트를 삭제합니다. 잠겨 있던 검사재고가 풀립니다.\n계속할까요?')) return;
    QmDB.removeLot(id); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };

  const onSearch = (v) => { q = v; repaint(); };
  const onOrigin = (v) => { fOrigin = v; repaint(); };
  const onStatus = (v) => { fStatus = v; repaint(); };
  const repaint = () => {
    const el = document.querySelector('.qm-list');
    if (!el) return;
    const r = list();
    el.innerHTML = r.length ? r.map(card).join('') : QmUI.empty('조건에 맞는 로트가 없습니다', '검색어나 필터를 바꿔보십시오.');
  };

  return {
    render, afterRender: () => {},
    openIntake, fromReceiving, fromProductLot, sample,
    openResult, onRow, addRow, delRow, addRowFromSelect, submitResult,
    openUD, submitUD, remove, onSearch, onOrigin, onStatus,
  };
})();


// ============================================================
// 품질재고 · 반복검사 · 부적합 처분
// ============================================================
const QmStockPage = (() => {
  const U = () => QmUI;
  let q = '', onlyHeld = false, disposeFor = null;

  const list = () => {
    const u = U();
    return QmDB.getStockBy(u.fac())
      .filter(s => !onlyHeld || Number(s.qi) > 0 || Number(s.blocked) > 0)
      .filter(s => u.match(q, s.materialName, s.materialCode, s.batchNo))
      .sort((a, b) => (Number(b.blocked) + Number(b.qi)) - (Number(a.blocked) + Number(a.qi)));
  };

  const bar = (s) => {
    const tot = ['qi', 'unrestricted', 'blocked'].reduce((a, k) => a + Number(s[k] || 0), 0);
    if (tot <= 0) return '';
    const p = (k) => (Number(s[k] || 0) / tot * 100).toFixed(1);
    return `<div class="qm-stackbar" title="검사 ${QmUI.kg(s.qi)} / 가용 ${QmUI.kg(s.unrestricted)} / 보류 ${QmUI.kg(s.blocked)}">
      <i class="qi" style="width:${p('qi')}%"></i>
      <i class="ok" style="width:${p('unrestricted')}%"></i>
      <i class="bad" style="width:${p('blocked')}%"></i>
    </div>`;
  };

  const render = () => {
    const u = U();
    const s = QmDB.summary(u.fac());
    const rows = list();
    const due = QmDB.dueForRecurring(u.fac());
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">품질 · 실험실</div>
            <h2>품질재고 · 부적합 처분</h2>
            <p>재고를 품질검사·가용·보류 3구분으로 관리합니다. 가용재고만 출고·투입에 쓸 수 있습니다.</p>
            <div class="qm-docref">근거: To-Be 정의서 QM.2.3 재고 반복검사 · QM.3.1 부적합관리(불용전환 → 위해요소 평가 → 폐기 또는 해제)</div>
          </div>
          <div class="module-metrics">
            <div><span>${u.kg(s.unrestricted)}</span><label>가용(kg)</label></div>
            <div><span>${u.kg(s.qi)}</span><label>품질검사(kg)</label></div>
            <div><span>${u.kg(s.blocked)}</span><label>보류(kg)</label></div>
            <div><span>${s.dueRecurring}</span><label>반복검사 도래</label></div>
          </div>
        </div>

        ${due.length ? `
          <div class="qm-alert warn">
            차기 검사일이 도래한 재고가 ${due.length}건 있습니다 —
            ${u.esc(due.slice(0, 3).map(d => `${d.materialName || d.materialCode}(${d.nextInspectDate})`).join(', '))}${due.length > 3 ? ' 외' : ''}.
            트리거를 돌리면 검사로트가 생성되고 해당 수량이 품질검사재고로 잠깁니다.
            <button class="btn btn-sm btn-primary" onclick="QmStockPage.runTrigger()">반복검사 트리거 실행</button>
          </div>` : ''}

        <div class="qm-legend">
          <span><i class="qi"></i> 품질검사재고 — 판정 전, 사용 불가</span>
          <span><i class="ok"></i> 가용재고 — 사용 가능</span>
          <span><i class="bad"></i> 보류재고 — 부적합, 처분 대기</span>
        </div>

        <div class="qm-toolbar">
          <input type="text" class="form-input qm-search" placeholder="자재 · 배치 검색"
                 value="${u.esc(q)}" oninput="QmStockPage.onSearch(this.value)">
          <label class="qm-check">
            <input type="checkbox" ${onlyHeld ? 'checked' : ''} onchange="QmStockPage.onlyHeldToggle(this.checked)">
            잠긴 재고만 보기
          </label>
        </div>

        ${rows.length ? `
          <div class="table-wrap card">
            <table class="data-table">
              <thead><tr>
                <th>자재</th><th>배치</th><th>구성</th>
                <th class="td-right">품질검사</th><th class="td-right">가용</th><th class="td-right">보류</th>
                <th>유통기한</th><th>차기검사</th><th></th>
              </tr></thead>
              <tbody>${rows.map(s2 => `<tr>
                <td><strong>${u.esc(s2.materialName || s2.materialCode)}</strong><div class="text-xs text-muted mono">${u.esc(s2.materialCode)}</div></td>
                <td class="mono text-sm">${u.esc(s2.batchNo || '-')}</td>
                <td style="min-width:120px">${bar(s2)}</td>
                <td class="td-right mono ${Number(s2.qi) > 0 ? 'qm-qi' : ''}">${u.kg(s2.qi)}</td>
                <td class="td-right mono ${Number(s2.unrestricted) > 0 ? 'qm-ok' : ''}">${u.kg(s2.unrestricted)}</td>
                <td class="td-right mono ${Number(s2.blocked) > 0 ? 'qm-bad' : ''}">${u.kg(s2.blocked)}</td>
                <td class="text-sm">${u.esc(s2.expiryDate || '-')}</td>
                <td class="text-sm ${s2.nextInspectDate && s2.nextInspectDate <= QmDB.todayStr() ? 'qm-bad' : ''}">${u.esc(s2.nextInspectDate || '-')}</td>
                <td>${Number(s2.blocked) > 0 ? `<button class="btn btn-sm btn-danger" onclick="QmStockPage.openDispose('${s2.id}')">부적합 처분</button>` : ''}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : u.empty('품질재고가 없습니다', '검사로트를 만들면 여기에 쌓입니다.')}

        ${disposalHistory()}
        ${disposeModal()}
      </div>`;
  };

  const disposalHistory = () => {
    const u = U();
    const all = [];
    QmDB.getStockBy(u.fac()).forEach(s => (s.disposals || []).forEach(d =>
      all.push({ ...d, materialName: s.materialName || s.materialCode, batchNo: s.batchNo })));
    all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!all.length) return '';
    return `
      <div class="card mt-16">
        <div class="card-title mb-12">부적합 처분 이력 (${all.length})</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>일자</th><th>자재</th><th>배치</th><th>처분</th><th class="td-right">수량</th><th>위해</th><th>사유</th><th>담당</th></tr></thead>
            <tbody>${all.slice(0, 40).map(d => `<tr>
              <td class="text-sm">${u.esc(u.dateOnly(d.at))}</td>
              <td>${u.esc(d.materialName)}</td>
              <td class="mono text-sm">${u.esc(d.batchNo || '-')}</td>
              <td>${u.badge(QmDB.DISPOSAL, d.action)}</td>
              <td class="td-right mono">${u.kg(d.qty)}</td>
              <td>${d.hazard ? '<span class="badge badge-fail">위해</span>' : '<span class="badge badge-pass">없음</span>'}</td>
              <td class="text-sm text-muted">${u.esc(d.note)}</td>
              <td class="text-sm">${u.esc(d.by || '-')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  };

  const disposeModal = () => {
    const u = U();
    const s = disposeFor ? QmDB.getStock().find(x => x.id === disposeFor) : null;
    return `
      <div class="modal-overlay" id="qm-dispose-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>부적합 처분</h3>
            <button class="modal-close" onclick="QmUI.closeModal('qm-dispose-modal')">✕</button>
          </div>
          <div class="modal-body">
            ${s ? `
              <div class="qm-note">
                ${u.esc(s.materialName || s.materialCode)} · 배치 ${u.esc(s.batchNo || '-')}
                <br>보류재고 <b>${u.kg(s.blocked)}kg</b>
                <br>To-Be 프로세스: 불용재고 전환 → <b>위해요소 검사</b> → 위해 여부에 따라 폐기출고 또는 보류 해제.
              </div>
              <div class="form-group">
                <label class="qm-check"><input type="checkbox" id="qm-hazard"> 위해요소 검사 결과 <b>위해 있음</b></label>
                <div class="form-hint">위해가 있으면 해제(가용전환)를 선택할 수 없습니다.</div>
              </div>
              <div class="form-group"><label class="form-label">처분 구분</label>
                <div class="qm-udlist">
                  ${Object.entries(QmDB.DISPOSAL).map(([k, v], i) => `
                    <label class="qm-udrow">
                      <input type="radio" name="qm-disp" value="${k}" ${i === 0 ? 'checked' : ''}>
                      <div><strong>${u.esc(v.label)}</strong><p>${u.esc(v.desc)}</p></div>
                    </label>`).join('')}
                </div>
              </div>
              <div class="form-group"><label class="form-label">수량 (kg)</label>
                <input type="number" class="form-input" id="qm-disp-qty" value="${s.blocked}" step="0.1"></div>
              <div class="form-group"><label class="form-label">사유 <em>*</em></label>
                <textarea class="form-input" id="qm-disp-note" rows="2" placeholder="위해평가 결과 · 처분 근거"></textarea></div>
            ` : '<div class="qm-emptyline">재고를 찾을 수 없습니다</div>'}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="QmUI.closeModal('qm-dispose-modal')">취소</button>
            <button class="btn btn-danger" onclick="QmStockPage.submitDispose()">처분 확정</button>
          </div>
        </div>
      </div>`;
  };

  const runTrigger = () => {
    const created = QmDB.runRecurringTrigger(QmUI.fac(), QmUI.actor());
    App.toast(created.length ? `검사로트 ${created.length}건을 생성하고 해당 재고를 잠갔습니다` : '도래한 재고가 없습니다',
      created.length ? 'success' : 'info');
    App.refreshPage();
  };

  const openDispose = (id) => { disposeFor = id; App.refreshPage(); QmUI.openModal('qm-dispose-modal'); };
  const submitDispose = () => {
    if (!disposeFor) return;
    const action = document.querySelector('input[name="qm-disp"]:checked')?.value;
    const hazard = !!document.getElementById('qm-hazard')?.checked;
    if (hazard && action === 'RELEASE') { App.toast('위해가 확인된 재고는 해제할 수 없습니다', 'error'); return; }
    try {
      QmDB.disposeBlocked(disposeFor, action, {
        qty: QmUI.num('qm-disp-qty'), note: QmUI.val('qm-disp-note'), hazard, by: QmUI.actor(),
      });
      disposeFor = null;
      QmUI.closeModal('qm-dispose-modal');
      App.toast('처분을 기록했습니다', 'success');
      App.refreshPage();
    } catch (e) { App.toast(e.message, 'error'); }
  };

  const onSearch = (v) => { q = v; App.refreshPage(); };
  const onlyHeldToggle = (on) => { onlyHeld = on; App.refreshPage(); };

  return { render, afterRender: () => {}, runTrigger, openDispose, submitDispose, onSearch, onlyHeldToggle };
})();


// ============================================================
// 검사설정 (자재마스터 QM뷰 — QM.1.1.5)
// ============================================================
const QmSetupPage = (() => {
  const U = () => QmUI;
  let q = '', editCode = null;

  const materials = () => {
    try { return (DB.getMaterials() || []); } catch (_) { return []; }
  };

  const render = () => {
    const u = U();
    const setups = QmDB.getSetups();
    const mats = materials();
    const shown = setups.filter(s => u.match(q, s.materialCode, s.materialName));
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">품질 · 실험실</div>
            <h2>검사설정 (자재 QM뷰)</h2>
            <p>어떤 자재를 검사 대상으로 볼지 정합니다. 여기서 지정한 자재만 검사로트가 생성됩니다.</p>
            <div class="qm-docref">근거: To-Be 정의서 QM.1.1.5 자재생성·변경(품질뷰) · QM.1.1.6 검사계획</div>
          </div>
          <div class="module-metrics">
            <div><span>${setups.length}</span><label>등록 자재</label></div>
            <div><span>${setups.filter(s => s.onReceive).length}</span><label>입고검사</label></div>
            <div><span>${setups.filter(s => s.onProduce).length}</span><label>생산검사</label></div>
            <div><span>${setups.filter(s => s.recurringDays > 0).length}</span><label>반복검사</label></div>
          </div>
        </div>

        <div class="qm-note mb-16">
          미등록 자재는 <b>입고·생산검사 대상</b>으로 간주합니다(안전측). 검사에서 빼려면 여기 등록 후 해제하십시오.
        </div>

        <div class="qm-toolbar">
          <input type="text" class="form-input qm-search" placeholder="자재코드 · 자재명 검색"
                 value="${u.esc(q)}" oninput="QmSetupPage.onSearch(this.value)">
          <div class="qm-toolbar-right">
            <button class="btn btn-primary btn-sm" onclick="QmSetupPage.openEdit('')">＋ 자재 검사설정</button>
          </div>
        </div>

        ${shown.length ? `
          <div class="table-wrap card">
            <table class="data-table">
              <thead><tr><th>자재코드</th><th>자재명</th><th>입고검사</th><th>생산검사</th><th class="td-right">반복검사 주기</th><th>시료량</th><th>비고</th><th></th></tr></thead>
              <tbody>${shown.map(s => `<tr>
                <td class="mono">${u.esc(s.materialCode)}</td>
                <td>${u.esc(s.materialName || '-')}</td>
                <td>${s.onReceive ? '<span class="badge badge-pass">대상</span>' : '<span class="badge badge-default">제외</span>'}</td>
                <td>${s.onProduce ? '<span class="badge badge-pass">대상</span>' : '<span class="badge badge-default">제외</span>'}</td>
                <td class="td-right mono">${s.recurringDays > 0 ? s.recurringDays + '일' : '-'}</td>
                <td class="text-sm">${u.esc(s.sampleQty || '-')}</td>
                <td class="text-sm text-muted">${u.esc(s.note || '')}</td>
                <td class="qm-rowact">
                  <button class="btn btn-sm" onclick="QmSetupPage.openEdit('${u.esc(s.materialCode)}')">수정</button>
                  <button class="btn btn-sm btn-danger" onclick="QmSetupPage.remove('${u.esc(s.materialCode)}')">삭제</button>
                </td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : u.empty('등록된 검사설정이 없습니다', '＋ 자재 검사설정으로 검사대상을 지정하십시오.')}

        ${modal(mats)}
      </div>`;
  };

  const modal = (mats) => {
    const u = U();
    const s = editCode ? QmDB.setupOf(editCode) : null;
    return `
      <div class="modal-overlay" id="qm-setup-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>${s && s.registered ? '검사설정 수정' : '자재 검사설정'}</h3>
            <button class="modal-close" onclick="QmUI.closeModal('qm-setup-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">자재코드 <em>*</em></label>
                <input type="text" class="form-input" id="qs-code" value="${u.esc(s?.materialCode || '')}"
                       list="qm-mat-list" ${s && s.registered ? 'readonly' : ''} oninput="QmSetupPage.syncName(this.value)"></div>
              <div class="form-group"><label class="form-label">자재명</label>
                <input type="text" class="form-input" id="qs-name" value="${u.esc(s?.materialName || '')}"></div>
            </div>
            <div class="form-group">
              <label class="qm-check"><input type="checkbox" id="qs-recv" ${!s || s.onReceive ? 'checked' : ''}> 구매입고 검사 대상 (QM.2.1)</label>
            </div>
            <div class="form-group">
              <label class="qm-check"><input type="checkbox" id="qs-prod" ${!s || s.onProduce ? 'checked' : ''}> 생산입고 검사 대상 (QM.2.2)</label>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">반복검사 주기(일)</label>
                <input type="number" class="form-input" id="qs-recur" value="${s?.recurringDays || 0}" min="0">
                <div class="form-hint">0 이면 반복검사를 하지 않습니다. 용도결정으로 가용전환될 때 차기 검사일이 이 주기로 잡힙니다.</div></div>
              <div class="form-group"><label class="form-label">시료 채취량</label>
                <input type="text" class="form-input" id="qs-sample" value="${u.esc(s?.sampleQty || '')}" placeholder="예: 500g"></div>
            </div>
            <div class="form-group"><label class="form-label">비고</label>
              <input type="text" class="form-input" id="qs-note" value="${u.esc(s?.note || '')}" placeholder="중점 확인 항목 등"></div>
            <datalist id="qm-mat-list">
              ${mats.slice(0, 800).map(m => `<option value="${u.esc(m.code)}">${u.esc(m.name)}</option>`).join('')}
            </datalist>
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="QmUI.closeModal('qm-setup-modal')">취소</button>
            <button class="btn btn-primary" onclick="QmSetupPage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openEdit = (code) => { editCode = code || null; App.refreshPage(); QmUI.openModal('qm-setup-modal'); };
  const syncName = (code) => {
    const m = materials().find(x => x.code === String(code));
    const el = document.getElementById('qs-name');
    if (m && el && !el.value) el.value = m.name;
  };
  const submit = () => {
    const code = QmUI.val('qs-code');
    if (!code) { App.toast('자재코드를 입력하십시오', 'warning'); return; }
    QmDB.saveSetup({
      materialCode: code,
      materialName: QmUI.val('qs-name'),
      onReceive: !!document.getElementById('qs-recv')?.checked,
      onProduce: !!document.getElementById('qs-prod')?.checked,
      recurringDays: QmUI.num('qs-recur'),
      sampleQty: QmUI.val('qs-sample'),
      note: QmUI.val('qs-note'),
      updatedBy: QmUI.actor(),
    });
    editCode = null;
    QmUI.closeModal('qm-setup-modal');
    App.toast('검사설정을 저장했습니다', 'success');
    App.refreshPage();
  };
  const remove = (code) => {
    if (!confirm(`${code} 검사설정을 삭제합니다.\n삭제하면 기본값(검사 대상)으로 돌아갑니다. 계속할까요?`)) return;
    QmDB.removeSetup(code); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };
  const onSearch = (v) => { q = v; App.refreshPage(); };

  return { render, afterRender: () => {}, openEdit, syncName, submit, remove, onSearch };
})();
