// ============================================================
// product_trace.js — 제품 추적관리 (추적·클레임)
//
//   제품을 고르고 제조일자를 누르면 그 제품·그날에 걸린 기록을 한 화면에 모아 보여 준다.
//     · 생산 LOT → 배합 → 투입 원료 LOT → 원료 입고(입고일·협력사·입고검사)
//     · 제품 분석(분석대장, 제조 당일~3일 뒤 분석분) · 출고 · VOC
//     · 그날 공장 기록: 전자 일지 · CCP 측정 · 날씨·습도(Open-Meteo 일별)
//   생산·투입 실적은 이 시스템에 배합·제품LOT 이 등록된 것만 이어진다(ERP 생산실적 연동 전).
//   배합비(batch.formula)는 보여 주지 않는다. 투입 원료는 실제 투입 LOT 기록만 쓴다.
// ============================================================

const ProductTracePage = (() => {
  const st = { q: '', key: '', date: '', openLot: '' };
  const FACTORY_NAMES = { NS: '논산', GS: '경산', AS: '아산', HQ: '본사' };
  const ANALYSIS_AFTER_DAYS = 3;          // 제조일 뒤 며칠 안의 분석을 그날 제품 분석으로 본다
  const weatherCache = {};
  let argSig = '';                        // 다른 화면에서 넘겨받은 제품·날짜는 한 번만 적용

  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jsq = (v) => h(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.·()]/g, '');
  const day = (s) => String(s || '').slice(0, 10);
  const num = (v) => (Number(v) || 0).toLocaleString();
  const fName = (f) => FACTORY_NAMES[f] || f || '-';
  const addDays = (d, n) => {
    const x = new Date(d + 'T00:00:00');
    if (isNaN(x)) return d;
    x.setDate(x.getDate() + n);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const factory = () => { try { const f = App.getFactory && App.getFactory(); return f && f !== 'ALL' ? f : ''; } catch (_) { return ''; } };
  const inFactory = (f) => !factory() || f === factory();
  const safe = (fn, fb) => { try { const v = fn(); return v == null ? fb : v; } catch (_) { return fb; } };

  // ── 제품 목록: 제품 마스터 + 분석대장 + 생산 LOT + VOC 에 나온 제품을 하나로 ──
  let _idx = null, _idxSig = '';
  const productIndex = () => {
    const lots = safe(() => DB.getProductLots(), []);
    const vocs = safe(() => DB.getVOCs(), []);
    const labProd = safe(() => LabDB.getRecords('prod'), []);
    const sig = `${lots.length}|${vocs.length}|${labProd.length}`;
    if (_idx && sig === _idxSig) return _idx;
    const map = new Map();
    const put = (code, name, src) => {
      const c = String(code || '').trim(), n = String(name || '').trim();
      if (!c && !n) return;
      const key = c ? 'C:' + c : 'N:' + norm(n);
      const cur = map.get(key) || { key, code: c, name: n, n: 0, src: new Set() };
      if (!cur.name && n) cur.name = n;
      cur.n += 1; cur.src.add(src);
      map.set(key, cur);
    };
    safe(() => LabDB.getProducts(), []).forEach(p => put(p.code, p.name, 'master'));
    safe(() => DB.getProducts(), []).forEach(p => put(p.code, p.name, 'master'));
    labProd.forEach(r => put(r.code, r.name, 'lab'));
    lots.forEach(l => put(l.productCode, l.productName, 'lot'));
    vocs.forEach(v => put(v.productCode, v.productName, 'voc'));
    // 이름만 있는 항목이 코드 있는 항목과 이름이 같으면 합친다
    const byName = new Map();
    map.forEach(p => { if (p.code && p.name) byName.set(norm(p.name), p); });
    map.forEach((p, k) => {
      if (p.code) return;
      const twin = byName.get(norm(p.name));
      if (twin) { twin.n += p.n; p.src.forEach(s => twin.src.add(s)); map.delete(k); }
    });
    _idx = map; _idxSig = sig;
    return map;
  };
  const current = () => (st.key ? productIndex().get(st.key) : null);

  const sameProduct = (p, code, name) => {
    if (!p) return false;
    if (p.code && code) return String(code).trim() === p.code;
    return !!name && norm(name) === norm(p.name);
  };

  // ── 그 제품의 기록 ──
  const lotsOf = (p) => safe(() => DB.getProductLots(), [])
    .filter(l => sameProduct(p, l.productCode, l.productName) && inFactory(l.factory));
  const labOf = (p) => (p.code ? safe(() => LabDB.getRecordsByCode('prod', p.code), []) : safe(() => LabDB.getRecords('prod'), []).filter(r => norm(r.name) === norm(p.name)))
    .filter(r => inFactory(r.factory));
  // VOC 대장 제품명은 "스마일독"처럼 브랜드 수준이라 제품 마스터 이름과 딱 맞지 않는 경우가 많다.
  //   이름이 같으면 확정, VOC 제품명이 이 제품 이름 안에 들어 있으면 '이름이 비슷한 VOC'로 따로 보여 준다.
  const vocsOf = (p) => {
    const pn = norm(p.name);
    const out = [];
    safe(() => DB.getVOCs(), []).forEach(v => {
      if (factory() && v.factory !== factory()) return;
      if (sameProduct(p, v.productCode, v.productName)) { out.push({ v, loose: false }); return; }
      if (p.code && v.productCode) return;               // 둘 다 코드가 있는데 다르면 다른 제품
      const vn = norm(v.productName);
      if (vn.length >= 3 && pn.includes(vn)) out.push({ v, loose: true });
    });
    return out;
  };
  const vocDay = (v) => safe(() => DB.vocMfgDate(v), '') || day(v.mfgDate);

  // 제조일자 후보: 생산 LOT 제조일 · 분석일 · VOC 제조일자
  const datesOf = (p) => {
    const m = new Map();
    const bump = (d, k) => { if (!d) return; const x = m.get(d) || { d, lot: 0, lab: 0, voc: 0 }; x[k] += 1; m.set(d, x); };
    lotsOf(p).forEach(l => bump(day(l.productionDate), 'lot'));
    labOf(p).forEach(r => bump(day(r.date), 'lab'));
    vocsOf(p).forEach(x => bump(vocDay(x.v), 'voc'));
    return [...m.values()].sort((a, b) => b.d.localeCompare(a.d));
  };

  // ── 검색 ──
  const suggest = (q) => {
    const lq = norm(q);
    if (!lq) return [];
    const out = [];
    productIndex().forEach(p => {
      if (norm(p.name).includes(lq) || p.code.includes(q.trim())) out.push(p);
    });
    return out.sort((a, b) => (b.src.size - a.src.size) || (b.n - a.n)).slice(0, 30);
  };
  const srcText = (p) => [p.src.has('lot') ? '생산LOT' : '', p.src.has('lab') ? '분석' : '', p.src.has('voc') ? 'VOC' : ''].filter(Boolean).join(' · ') || '기록 없음';

  const onSearch = (v) => {
    st.q = v;
    const box = document.getElementById('pt-suggest');
    if (!box) return;
    const list = suggest(v);
    box.style.display = list.length ? 'block' : 'none';
    box.innerHTML = list.map(p => `
      <div class="pt-sug" onmousedown="ProductTracePage.pick('${jsq(p.key)}')">
        <b>${h(p.name || '-')}</b> <span class="text-muted mono" style="font-size:11px">${h(p.code)}</span>
        <span class="text-muted" style="float:right;font-size:11px">${h(srcText(p))}</span></div>`).join('');
  };
  const pick = (key) => { st.key = key; st.date = ''; st.openLot = ''; st.q = current()?.name || ''; App.refreshPage(); };
  const setDate = (d) => { st.date = d; st.openLot = ''; App.refreshPage(); };
  const clear = () => { st.key = ''; st.date = ''; st.q = ''; App.refreshPage(); };
  const toggleLot = (k) => { st.openLot = st.openLot === k ? '' : k; App.refreshPage(); };

  // ── 화면 조각 ──
  const searchCard = () => {
    const p = current();
    return `<div class="card" style="margin-bottom:14px;overflow:visible">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1;min-width:240px;position:relative">
          <div class="text-muted" style="font-size:12px;margin-bottom:4px">제품명 또는 제품코드</div>
          <input id="pt-q" class="form-input" autocomplete="off" placeholder="예: 한흥, 1003046" value="${h(st.q)}"
            oninput="ProductTracePage.onSearch(this.value)" onfocus="ProductTracePage.onSearch(this.value)"
            onblur="setTimeout(()=>{const b=document.getElementById('pt-suggest');if(b)b.style.display='none'},150)">
          <div id="pt-suggest" class="pt-suggest" style="display:none"></div>
        </div>
        <div>
          <div class="text-muted" style="font-size:12px;margin-bottom:4px">제조일자</div>
          <input type="date" class="form-input" value="${h(st.date)}" ${p ? '' : 'disabled'} onchange="ProductTracePage.setDate(this.value)">
        </div>
        ${p ? `<button class="btn btn-ghost btn-sm" onclick="ProductTracePage.clear()">다른 제품</button>` : ''}
      </div>
      ${p ? `<div style="margin-top:10px;font-size:13px"><b>${h(p.name)}</b> <span class="mono text-muted">${h(p.code || '코드 없음')}</span>
        ${factory() ? `<span class="badge badge-info" style="margin-left:6px">${h(fName(factory()))} 공장만</span>` : ''}</div>` : ''}
    </div>`;
  };

  const datesCard = (p) => {
    const ds = datesOf(p);
    if (!ds.length) return `<div class="card text-muted" style="margin-bottom:14px">이 제품의 생산 LOT·분석·VOC 기록이 없습니다. 제조일자를 직접 고르면 그날 공장 기록(일지·CCP·날씨)은 볼 수 있습니다.</div>`;
    const chip = (x) => {
      const parts = [x.lot ? `생산LOT ${x.lot}` : '', x.lab ? `분석 ${x.lab}` : '', x.voc ? `VOC ${x.voc}` : ''].filter(Boolean).join(' · ');
      const on = st.date === x.d;
      return `<button class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" style="margin:0 6px 6px 0;text-align:left;line-height:1.3"
        onclick="ProductTracePage.setDate('${x.d}')"><span class="mono">${x.d}</span><br><span style="font-size:10.5px;${on ? '' : 'color:var(--text-muted)'}">${parts}</span></button>`;
    };
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-head"><div class="card-title">제조일자 고르기</div>
        <div class="text-muted" style="font-size:12px">기록이 있는 날 ${ds.length}일 · 분석은 분석일 기준</div></div>
      <div style="max-height:190px;overflow:auto">${ds.map(chip).join('')}</div>
    </div>`;
  };

  const section = (title, sub, body) => `<div class="card" style="margin-bottom:14px">
      <div class="card-head"><div class="card-title">${title}</div>${sub ? `<div class="text-muted" style="font-size:12px">${sub}</div>` : ''}</div>
      ${body}</div>`;
  const empty = (t) => `<div class="text-muted" style="font-size:13px;padding:4px 0">${t}</div>`;
  const table = (head, rows) => `<div class="table-wrap"><table class="data-table pt-t"><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  const qcBadge = (r) => {
    if (!r) return '<span class="text-muted">-</span>';
    const ins = safe(() => DB.getInspectionsByReceivingId(r.id), []);
    if (!ins.length) return '<span class="badge badge-default">검사 없음</span>';
    if (ins.some(i => i.verdict === 'FAIL')) return '<span class="badge badge-fail">불합격 포함</span>';
    if (ins.some(i => i.verdict !== 'PASS')) return '<span class="badge badge-warning">조건부</span>';
    return '<span class="badge badge-pass">합격</span>';
  };
  const recvOf = (c, recvs) => (c.receivingId && recvs.find(x => x.id === c.receivingId)) || (c.lotNo && recvs.find(x => x.lotNo === c.lotNo)) || null;
  const outsOf = (lot) => safe(() => DB.getOutbounds(), []).filter(o => o.productLotId === lot.id || (lot.fgLotNo && o.fgLotNo === lot.fgLotNo));

  // 이 원료 LOT 이 들어간 다른 제품 (회수 범위 확인용)
  const otherUses = (c, r, selfBatchId) => {
    const hit = (x) => (r && x.receivingId === r.id) || (c.lotNo && x.lotNo === c.lotNo);
    const batches = safe(() => DB.getBatches(), []).filter(b => b.id !== selfBatchId && (b.consumedLots || []).some(hit));
    if (!batches.length) return `<div class="text-muted" style="font-size:12px;padding:6px 0">이 원료 LOT 이 들어간 다른 배합 기록이 없습니다.</div>`;
    return `<div style="font-size:12px;padding:6px 0 2px">이 원료 LOT 이 들어간 다른 제품 ${batches.length}건</div>` + table(['배합', '제품', '투입량', '제품 LOT', '제조일'],
      batches.map(b => {
        const l = b.productLotId ? safe(() => DB.getProductLotById(b.productLotId), null) : null;
        const used = (b.consumedLots || []).filter(hit).reduce((s, x) => s + (Number(x.deducted ?? x.qty) || 0), 0);
        return `<tr><td class="mono">${h(b.batchCode)}</td><td>${h(b.productName || '-')}</td><td class="mono" style="text-align:right">${num(used)}kg</td>
          <td class="mono">${h(l?.fgLotNo || '미등록')}</td><td class="mono">${h(day(l?.productionDate) || '-')}</td></tr>`;
      }));
  };

  const lotBlock = (lot) => {
    const recvs = safe(() => DB.getReceivings(), []);
    const batch = lot.batchId ? safe(() => DB.getBatchById(lot.batchId), null) : null;
    const consumed = batch?.consumedLots || [];
    const outs = outsOf(lot);
    const head = `<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:13px;margin-bottom:10px">
        <span>제품 LOT <b class="mono">${h(lot.fgLotNo)}</b></span><span>${h(fName(lot.factory))}</span>
        <span>${num(lot.qty)}${h(lot.unit || 'kg')}${lot.packCount ? ` · ${h(lot.packType || '')} ${num(lot.packCount)}개` : ''}</span>
        <span>유통기한 ${h(day(lot.expiryDate) || '-')}</span>
        ${batch ? `<span>배합 <span class="mono">${h(batch.batchCode)}</span> · ${h(String(batch.batchedAt || '').slice(0, 16).replace('T', ' '))} · ${num(batch.totalQty)}kg</span>` : ''}
      </div>`;
    let raw;
    if (!batch) raw = empty('이 생산 LOT 은 배합 기록과 연결되어 있지 않아 투입 원료를 알 수 없습니다.');
    else if (!consumed.length) raw = empty(`배합 ${h(batch.batchCode)} 에 투입 원료 LOT 기록이 없습니다.`);
    else {
      raw = table(['원료', '원료 LOT', '사일로', '투입량', '입고일', '협력사', '송장·협력사 LOT', '입고검사', ''],
        consumed.map((c, i) => {
          const r = recvOf(c, recvs);
          const code = c.materialCode || r?.materialCode || '';
          const name = r?.materialName || c.materialName || safe(() => DB.getMaterialByCode(code)?.name, '') || code || '-';
          const k = `${lot.id}|${i}`;
          const open = st.openLot === k;
          return `<tr><td><b>${h(name)}</b></td><td class="mono">${h(c.lotNo || r?.lotNo || '-')}</td><td>${h(c.siloId || '-')}</td>
              <td class="mono" style="text-align:right">${num(c.deducted ?? c.qty ?? 0)}kg</td>
              <td class="mono">${h(day(r?.receivedDate) || '-')}</td><td>${h(r ? (r.supplierName || r.supplier || '-') : '입고 기록 없음')}</td>
              <td class="mono" style="font-size:11px">${h([r?.invoiceNo, r?.supplierLot].filter(Boolean).join(' / ') || '-')}</td>
              <td>${qcBadge(r)}</td>
              <td><button class="btn btn-ghost btn-xs" onclick="ProductTracePage.toggleLot('${jsq(k)}')">${open ? '접기' : '다른 제품'}</button></td></tr>
            ${open ? `<tr><td colspan="9" style="background:var(--bg-soft)">${otherUses(c, r, batch.id)}</td></tr>` : ''}`;
        }));
    }
    const out = outs.length ? table(['출고일', '거래처·도착지', '수량', '용도'], outs.map(o =>
      `<tr><td class="mono">${h(day(o.outboundDate) || '-')}</td><td>${h(o.destination || '-')}</td><td class="mono" style="text-align:right">${num(o.qty)}${h(o.unit || 'kg')}</td><td>${h(o.purpose || '-')}</td></tr>`))
      : empty('출고 기록 없음');
    return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:10px">${head}
      <div style="font-size:12.5px;font-weight:700;margin:4px 0 6px">투입 원료</div>${raw}
      <div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">출고</div>${out}</div>`;
  };

  const productionCard = (p, d) => {
    const lots = lotsOf(p).filter(l => day(l.productionDate) === d);
    const body = lots.length ? lots.map(lotBlock).join('')
      : empty('이날 등록된 생산 LOT 이 없습니다. 생산·원료 투입 실적은 ERP 생산실적이 연동되면 여기에 이어집니다.');
    return section('생산 · 배합 · 원료 투입', '생산 LOT → 배합 → 투입 원료 LOT → 원료 입고', body);
  };

  // 분석값은 항목을 열로 펼친 표로 — 행 = 분석 1건, 맨 아래 행 = 규격
  const ANAL_KEYS = { moisture: 'moist', protein: 'protein_n', fat: 'fat', fiber: 'fiber', ash: 'ash' };   // 제품LOT 분석 → 분석대장 항목
  const analysisCard = (p, d) => {
    const to = addDays(d, ANALYSIS_AFTER_DAYS);
    const lotIds = new Set(lotsOf(p).filter(l => day(l.productionDate) === d).map(l => l.id));
    const recs = labOf(p).filter(r => day(r.date) >= d && day(r.date) <= to)
      .map(r => ({ date: day(r.date), id: r.id, factory: r.factory, by: r.by, note: r.note, code: r.code, vals: r.vals || {} }))
      .concat(safe(() => DB.getProductAnalyses(), []).filter(a => lotIds.has(a.productLotId)).map(a => {
        const vals = {};
        Object.entries(ANAL_KEYS).forEach(([src, k]) => { const v = Number(a[src]); if (a[src] !== '' && a[src] != null && !isNaN(v)) vals[k] = v; });
        return { date: day(a.analyzedAt), id: a.fgLotNo || a.id, factory: '', by: a.analyst, note: a.verdict, code: a.productCode, vals };
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const sub = `분석일 ${d} ~ ${to} (제조 당일~${ANALYSIS_AFTER_DAYS}일 뒤)`;
    if (!recs.length) return section('제품 분석', sub, empty('이 기간 분석 기록이 없습니다.'));

    // 열 순서는 분석항목 관리 순서를 따른다
    const order = new Map(safe(() => LabDB.getItems(), []).map((it, i) => [it.key, i]));
    const keys = [...new Set(recs.flatMap(r => Object.keys(r.vals)))]
      .sort((a, b) => (order.has(a) ? order.get(a) : 999) - (order.has(b) ? order.get(b) : 999));
    const code = p.code || recs[0].code;
    const judge = (k, v) => safe(() => LabDB.judge('prod', code, k, v), 'NA');
    let outCnt = 0;
    const th = keys.map(k => {
      const u = safe(() => LabDB.itemUnit(k), '');
      return `<th style="text-align:right;white-space:nowrap">${h(safe(() => LabDB.itemLabel(k), k))}${u ? `<div style="font-size:10px;font-weight:400;color:var(--text-muted)">${h(u)}</div>` : ''}</th>`;
    }).join('');
    const rows = recs.map(r => `<tr><td class="mono">${h(r.date)}</td><td class="mono" style="font-size:11px">${h(r.id)}</td><td>${h(fName(r.factory))}</td><td>${h(r.by || '-')}</td>
      ${keys.map(k => {
        const v = r.vals[k];
        if (typeof v !== 'number') return '<td style="text-align:right" class="text-muted">-</td>';
        const j = judge(k, v);
        if (j === 'HIGH' || j === 'LOW') outCnt++;
        const style = j === 'HIGH' ? 'color:var(--danger);font-weight:700' : j === 'LOW' ? 'color:var(--warning);font-weight:700' : '';
        return `<td class="mono" style="text-align:right;${style}" title="${j === 'HIGH' ? '규격 초과' : j === 'LOW' ? '규격 미달' : ''}">${h(v)}${j === 'HIGH' ? ' ▲' : j === 'LOW' ? ' ▼' : ''}</td>`;
      }).join('')}
      <td style="font-size:11px">${h(r.note || '')}</td></tr>`);
    let manual = 0, stat = 0;
    const specRow = `<tr style="background:var(--bg-soft)"><td colspan="4" style="font-size:12px;font-weight:700">규격</td>
      ${keys.map(k => {
        const sp = safe(() => LabDB.resolveSpec('prod', code, k), {});
        if (!sp || sp.source == null) return '<td style="text-align:right" class="text-muted">-</td>';
        if (sp.source === 'manual') manual++; else stat++;
        const r2 = (x) => (sp.source === 'stat' ? +Number(x).toFixed(2) : x);    // 통계 규격은 소수 둘째 자리까지
        const t = sp.min != null && sp.max != null ? `${r2(sp.min)} ~ ${r2(sp.max)}` : sp.min != null ? `${r2(sp.min)} 이상` : `${r2(sp.max)} 이하`;
        return `<td class="mono" style="text-align:right;font-size:11px;${sp.source === 'stat' ? 'color:var(--text-muted)' : ''}">${h(t)}</td>`;
      }).join('')}<td></td></tr>`;
    const note = `<div class="text-muted" style="font-size:11px;margin-top:6px">▲ 규격 초과 · ▼ 규격 미달${stat ? ' · 흐린 글씨 규격은 등록된 규격이 없어 이 제품 분석 이력의 평균±2σ로 잡은 값입니다' : ''}</div>`;
    return section('제품 분석', `${sub}${outCnt ? ` · <b style="color:var(--danger)">규격 벗어난 값 ${outCnt}개</b>` : ''}`,
      `<div class="table-wrap"><table class="data-table pt-t"><thead><tr><th>분석일</th><th>접수번호</th><th>공장</th><th>분석자</th>${th}<th>비고</th></tr></thead>
        <tbody>${rows.join('')}${specRow}</tbody></table></div>${note}`);
  };

  const vocCard = (p, d) => {
    const all = vocsOf(p);
    const exact = all.filter(x => !x.loose), loose = all.filter(x => x.loose);
    const hit = exact.filter(x => vocDay(x.v) === d).map(x => x.v);
    const near = loose.filter(x => vocDay(x.v) === d).map(x => x.v);
    const noDate = all.filter(x => !vocDay(x.v)).length;
    const rowOf = (v) => `<tr><td class="mono">${h(day(v.receivedAt || v.registeredAt) || '-')}</td><td>${h(v.productName || '-')}</td><td>${h(v.category || '-')}</td>
        <td style="white-space:normal">${h(v.complaint || v.title || '-')}</td><td style="white-space:normal">${h(v.action || '-')}</td><td>${h(v.status || '-')}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="VOCPage.openDetail('${jsq(v.id)}')">이력</button></td></tr>`;
    const head = ['접수일', '제품명(VOC)', '유형', '내용', '조치', '상태', ''];
    const sub = `이 제품 VOC ${exact.length}건${loose.length ? ` · 이름이 비슷한 VOC ${loose.length}건` : ''}${noDate ? ` · 제조일자 미기재 ${noDate}건` : ''}`;
    const body = (hit.length ? table(head, hit.map(rowOf)) : empty('이 제조일자로 접수된 VOC 가 없습니다.'))
      + (near.length ? `<div style="font-size:12.5px;font-weight:700;margin:12px 0 4px">이름이 비슷한 VOC ${near.length}건</div>
          <div class="text-muted" style="font-size:12px;margin-bottom:6px">VOC 대장에는 제품명이 브랜드까지만 적힌 경우가 많아(예: 스마일독) 이 제품이 맞는지 확인이 필요합니다.</div>`
          + table(head, near.map(rowOf)) : '');
    return section('VOC (이 제조일자)', sub, body);
  };

  // 그날 공장: 생산 LOT·분석에 나온 공장, 없으면 고른 공장, 그것도 없으면 3개 공장
  const factoriesFor = (p, d) => {
    if (factory()) return [factory()];
    const s = new Set();
    lotsOf(p).filter(l => day(l.productionDate) === d).forEach(l => s.add(l.factory));
    labOf(p).filter(r => day(r.date) >= d && day(r.date) <= addDays(d, ANALYSIS_AFTER_DAYS)).forEach(r => s.add(r.factory));
    const list = [...s].filter(f => ['NS', 'GS', 'AS'].includes(f));
    return list.length ? list : ['NS', 'GS', 'AS'];
  };

  const dayCard = (p, d) => {
    const fs = factoriesFor(p, d);
    const jr = safe(() => JournalDB.getRecords({ from: d, to: d }), []).filter(r => !r.factory || fs.includes(r.factory));
    const ccp = safe(() => DB.getCCPLogs('ALL'), []).filter(x => day(x.measuredAt) === d && fs.includes(x.factory));
    const jRows = jr.map(r => `<tr><td>${h(fName(r.factory))}</td><td>${h(r.tplName || '-')}</td><td>${h(r.category || '')}</td>
        <td style="text-align:right;${r.ng ? 'color:var(--danger);font-weight:700' : ''}">${r.ng || 0}</td><td>${h(r.status || '')}</td><td>${h(r.writer || '')}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="ProductTracePage.openJournal('${jsq(r.id)}')">열기</button></td></tr>`);
    const cRows = ccp.map(x => `<tr><td>${h(fName(x.factory))}</td><td>${h(x.ccpName || '-')}</td><td class="mono">${h(x.value)} ${h(x.unit || '')}</td>
        <td>${x.judged === 'DEVIATION' ? '<span class="badge badge-fail">이탈</span>' : '<span class="badge badge-pass">적합</span>'}</td>
        <td style="white-space:normal">${h(x.correctiveAction || '')}</td><td class="mono">${h(String(x.measuredAt || '').slice(11, 16))}</td></tr>`);
    const wx = fs.map(f => `<div id="pt-wx-${f}" style="border:1px solid var(--border);border-radius:6px;padding:8px 12px;min-width:180px">
        <b>${h(fName(f))}</b> <span class="text-muted" style="font-size:12px">받는 중…</span></div>`).join('');
    return section('그날 공장 기록', `${d} · ${fs.map(fName).join(', ')}`,
      `<div style="font-size:12.5px;font-weight:700;margin-bottom:6px">날씨·습도</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${wx}</div>
       <div style="font-size:12.5px;font-weight:700;margin-bottom:6px">전자 일지 ${jr.length}건</div>${jRows.length ? table(['공장', '일지', '구분', '이탈', '상태', '작성', ''], jRows) : empty('이날 작성된 일지가 없습니다.')}
       <div style="font-size:12.5px;font-weight:700;margin:12px 0 6px">CCP 측정 ${ccp.length}건</div>${cRows.length ? table(['공장', 'CCP', '측정값', '판정', '개선조치', '시각'], cRows) : empty('이날 CCP 측정 기록이 없습니다.')}`);
  };

  const openJournal = (id) => { App.navigate('journal'); setTimeout(() => { try { JournalPage.open(id); } catch (_) {} }, 60); };

  // 날씨: 최근 80일은 예보 API(과거 포함), 그보다 오래면 기록 API
  const loadWeather = async (f, d) => {
    const key = f + '|' + d;
    if (weatherCache[key]) return weatherCache[key];
    const loc = (window.Weather && Weather.LOCATIONS[f]) || null;
    if (!loc) throw new Error('좌표 없음');
    const ago = (Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000;
    const host = ago <= 80 ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
    const url = `${host}?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${d}&end_date=${d}`
      + '&daily=temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,relative_humidity_2m_max,precipitation_sum,weather_code&timezone=Asia%2FSeoul';
    const res = await fetch(url);
    if (!res.ok) throw new Error('http ' + res.status);
    const j = await res.json();
    const x = j.daily || {};
    const w = { tmax: x.temperature_2m_max?.[0], tmin: x.temperature_2m_min?.[0], hmean: x.relative_humidity_2m_mean?.[0],
      hmax: x.relative_humidity_2m_max?.[0], rain: x.precipitation_sum?.[0], code: x.weather_code?.[0] };
    if (w.tmax == null) throw new Error('자료 없음');
    weatherCache[key] = w;
    return w;
  };
  const paintWeather = (p, d) => {
    factoriesFor(p, d).forEach(f => {
      loadWeather(f, d).then(w => {
        const el = document.getElementById('pt-wx-' + f);
        if (!el || st.date !== d) return;
        const lvl = safe(() => Weather.humidityLevel(w.hmean), null);   // 판정은 하루 평균으로(새벽 최고습도는 늘 높다)
        const label = safe(() => Weather.codeInfo(w.code).label, '');
        el.innerHTML = `<b>${h(fName(f))}</b> <span style="font-size:12px">${h(label)}</span>
          <div style="font-size:12px;margin-top:3px">기온 ${h(w.tmin)} ~ ${h(w.tmax)}°C · 강수 ${h(w.rain)}mm</div>
          <div style="font-size:12px;${lvl === 'high' ? 'color:var(--danger);font-weight:700' : lvl === 'caution' ? 'color:var(--warning);font-weight:700' : ''}">습도 평균 ${h(w.hmean)}% · 최고 ${h(w.hmax)}%${lvl && lvl !== 'ok' ? ' · ' + h(Weather.humidityText(lvl)) : ''}</div>`;
      }).catch(() => {
        const el = document.getElementById('pt-wx-' + f);
        if (el) el.innerHTML = `<b>${h(fName(f))}</b> <span class="text-muted" style="font-size:12px">날씨 자료를 받지 못했습니다</span>`;
      });
    });
  };

  const render = (code, date) => {
    // 다른 화면에서 제품(코드·LOT)과 날짜를 넘겨받으면 바로 연다
    const sig = `${code || ''}|${date || ''}`;
    if (code && sig !== argSig) {
      argSig = sig;
      const lot = safe(() => DB.getProductLots(), []).find(l => l.fgLotNo === code || l.id === code);
      const ix = productIndex();
      const hit = lot ? [...ix.values()].find(p => sameProduct(p, lot.productCode, lot.productName))
        : (ix.get('C:' + code) || [...ix.values()].find(p => norm(p.name) === norm(code)));
      if (hit) { st.key = hit.key; st.q = hit.name; st.date = lot ? day(lot.productionDate) : (date || ''); st.openLot = ''; }
    }
    const p = current();
    return `<style>
        .pt-suggest{position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--bg-card,#fff);border:1px solid var(--border);border-radius:6px;max-height:320px;overflow:auto;box-shadow:0 6px 18px rgba(0,0,0,.12)}
        .pt-sug{padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)}
        .pt-sug:hover{background:var(--bg-soft)}
        .pt-t td{white-space:nowrap}
      </style>
      ${searchCard()}
      ${!p ? `<div class="card text-muted" style="text-align:center;padding:40px">제품명이나 제품코드를 입력해 제품을 고르세요. 제조일자를 누르면 그 제품·그날의 생산, 원료 투입, 분석, VOC, 공장 기록이 한 화면에 나옵니다.</div>` : `
        ${datesCard(p)}
        ${st.date ? `${productionCard(p, st.date)}${analysisCard(p, st.date)}${vocCard(p, st.date)}${dayCard(p, st.date)}`
          : '<div class="card text-muted" style="text-align:center;padding:30px">위에서 제조일자를 누르거나 날짜를 직접 고르세요.</div>'}`}`;
  };

  const afterRender = () => {
    const p = current();
    if (p && st.date) paintWeather(p, st.date);
  };

  return { render, afterRender, onSearch, pick, setDate, clear, toggleLot, openJournal };
})();
