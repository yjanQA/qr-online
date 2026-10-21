// ============================================================
// lab_species_report.js — 축종별 품질관리 전문가 시트 (양축/양어/반려)
//   분석대장(lab_records) 전체 데이터를 축종별로 취합해 하나의 품질 보고서로 구성.
//   공통: KPI · 성분 추이 · 제품별 품질 현황(변동 추세) · 규격 이탈 상세 · 인쇄 보고서
//   축종 특화: 양축=공정기준율(조단백)·입자도(Dgw)·옥수수 등급 / 양어=물리검사 취합 / 반려=등록성분 적합률·SIZE·컴플레인
//   기존 측정 도구(옥수수/입자도/물리검사/반려입력)는 시트 상단에서 진입.
// ============================================================

function makeSpeciesReport(cfg) {
  // cfg: { key(페이지 전역명), species, icon?, items:[핵심 성분 key], tools:[{page,label}], extra(레코드셋)=>HTML, extraCharts()=>void, printExtra(ctx)=>HTML }
  let periodDays = 90;
  let charts = [];
  let prodPick = 'ALL';   // 제품 필터: 'ALL'(전체) | 제품코드
  let cmpPick = '';       // 비교 제품코드 (prodPick 선택 시에만 사용)

  const S = () => LabSpeciesDB;
  const catOf = (r) => r.category || LabDB.productCategory(r.code);

  // ── 기간 (최신 분석일 앵커) ──
  const anchorDate = () => {
    let mx = '';
    LabDB.getRecords('prod').forEach(r => { const d = String(r.date || '').slice(0, 10); if (d > mx) mx = d; });
    return mx || new Date().toISOString().slice(0, 10);
  };
  const rangeOf = () => {
    const to = anchorDate();
    const a = new Date(to + 'T00:00:00'); a.setDate(a.getDate() - (periodDays - 1));
    return { from: a.toISOString().slice(0, 10), to };
  };
  const inRange = (d, rg) => { const s = String(d || '').slice(0, 10); return s >= rg.from && s <= rg.to; };

  // ── 공통 통계 ──
  const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const slope = (vals) => {
    const n = vals.length; if (n < 2) return 0;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    vals.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x; });
    const d = n * sxx - sx * sx; return d ? (n * sxy - sx * sy) / d : 0;
  };
  const trendMark = (vals) => {
    if (vals.length < 3) return '<span class="text-muted">─</span>';
    const sl = slope(vals), m = mean(vals) || 1, thr = Math.abs(m) * 0.003;
    return sl > thr ? '<span style="color:#ff6b81">▲ 상승</span>' : sl < -thr ? '<span style="color:#4f9cff">▼ 하강</span>' : '<span class="text-muted">─ 안정</span>';
  };
  const vOf = (r, key) => {
    if (key === 'protein') { const v = r.vals && (typeof r.vals.protein_n === 'number' ? r.vals.protein_n : r.vals.protein); return typeof v === 'number' ? v : null; }
    const v = r.vals && r.vals[key]; return typeof v === 'number' ? v : null;
  };
  const jKeyOf = (r, key) => key === 'protein' ? (typeof (r.vals || {}).protein_n === 'number' ? 'protein_n' : 'protein') : key;
  const ITEM_LABEL = { moist: '수분', protein: '조단백', fat: '조지방', fiber: '조섬유', ash: '조회분', ca: '칼슘', p: '인', bulk_density: '용적중' };

  // 축종 레코드 (기간 내)
  const recsOf = (rg) => LabDB.getRecords('prod').filter(r => catOf(r) === cfg.species && inRange(r.date, rg));

  // ── 제품 필터 (전체 / 개별 선택 / 타제품 비교) ──
  const prodName = (code) => LabDB.nameOf('prod', code) || code;
  const selName = () => prodPick === 'ALL' ? '전체 제품' : prodName(prodPick);
  // 이 축종의 제품 후보 (분석건수 내림차순, 코드·명칭 검색)
  const speciesProds = (q) => {
    const by = new Map();
    LabDB.getRecords('prod').forEach(r => {
      if (catOf(r) !== cfg.species) return;
      if (!by.has(r.code)) by.set(r.code, { code: r.code, name: r.name || prodName(r.code), n: 0 });
      by.get(r.code).n++;
    });
    let list = [...by.values()];
    const lq = String(q || '').toLowerCase().trim();
    if (lq) list = list.filter(m => m.code.toLowerCase().includes(lq) || (m.name || '').toLowerCase().includes(lq));
    return list.sort((a, b) => b.n - a.n);
  };
  const sugHtml = (q, which) => {
    const fn = which === 'cmp' ? 'pickCmp' : 'pickProd';
    const cur = which === 'cmp' ? cmpPick : prodPick;
    const head = which === 'cmp'
      ? `<div class="qd-sug-row${!cmpPick ? ' sel' : ''}" onmousedown="${cfg.key}.pickCmp('')"><b>비교 없음</b></div>`
      : `<div class="qd-sug-row${prodPick === 'ALL' ? ' sel' : ''}" onmousedown="${cfg.key}.pickProd('ALL')"><b>전체 제품</b> <span class="text-muted">(${cfg.species})</span></div>`;
    const rows = speciesProds(q)
      .filter(m => which !== 'cmp' || m.code !== prodPick)   // 비교 목록에서 선택 제품 제외
      .slice(0, 60).map(m => `
      <div class="qd-sug-row${m.code === cur ? ' sel' : ''}" onmousedown="${cfg.key}.${fn}('${esc(m.code)}')">
        <span class="mono">${esc(m.code)}</span> ${esc(m.name)} <span class="text-muted">(${m.n})</span></div>`).join('');
    return head + (rows || '<div class="text-muted" style="padding:8px 10px;font-size:12px">검색 결과 없음</div>');
  };
  const showSug = (which, q) => {
    const box = document.getElementById(`${cfg.key}-${which}-sug`);
    if (!box) return;
    box.innerHTML = sugHtml(q, which);
    box.style.display = 'block';
  };
  const openSug = (which) => {
    const inp = document.getElementById(`${cfg.key}-${which}-inp`);
    if (inp) inp.value = '';
    showSug(which, '');
  };
  const blurSug = (which) => {
    setTimeout(() => {
      const box = document.getElementById(`${cfg.key}-${which}-sug`);
      if (box) box.style.display = 'none';
      const inp = document.getElementById(`${cfg.key}-${which}-inp`);
      if (inp) inp.value = which === 'cmp' ? (cmpPick ? prodName(cmpPick) : '') : selName();
    }, 160);
  };
  const pickProd = (code) => { prodPick = code; if (code === 'ALL' || code === cmpPick) cmpPick = ''; App.refreshPage(); };
  const pickCmp = (code) => { cmpPick = code === prodPick ? '' : code; App.refreshPage(); };

  // 드롭다운 스타일 (대시보드와 동일 클래스 — 페이지 단독 진입 대비 자체 주입)
  const ensureSugStyle = () => {
    if (document.getElementById('sp-sug-style')) return;
    const st = document.createElement('style'); st.id = 'sp-sug-style';
    st.textContent = `
    .qd-sug-box{position:absolute;top:100%;left:0;right:0;z-index:60;margin-top:2px;background:var(--bg-card,#1a1d27);
      border:1px solid var(--border,#2a2f3d);border-radius:8px;max-height:280px;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.4);}
    .qd-sug-row{padding:7px 10px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border,#2a2f3d);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .qd-sug-row:hover{background:var(--bg-hover,rgba(255,255,255,.06));}
    .qd-sug-row.sel{background:rgba(79,156,255,.14);}
    .data-table tr.row-active td{background:rgba(46,158,91,.14);}`;
    document.head.appendChild(st);
  };

  // 성분 통계 (핵심 항목별)
  const compStats = (recs) => cfg.items.map(key => {
    const vals = []; let dev = 0;
    recs.forEach(r => {
      const v = vOf(r, key); if (v == null) return;
      vals.push(v);
      const j = LabDB.judge('prod', r.code, jKeyOf(r, key), v);
      if (j === 'HIGH' || j === 'LOW') dev++;
    });
    return { key, label: ITEM_LABEL[key] || key, n: vals.length, mean: mean(vals),
      min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, dev };
  });

  // 제품별 품질 현황
  const productRows = (recs) => {
    const by = new Map();
    recs.forEach(r => {
      if (!by.has(r.code)) by.set(r.code, { code: r.code, name: r.name, n: 0, seq: [], dev: 0, last: '' });
      const o = by.get(r.code); o.n++;
      const d = String(r.date || '').slice(0, 10); if (d > o.last) o.last = d;
      Object.keys(r.vals || {}).forEach(k => {
        const j = LabDB.judge('prod', r.code, k, r.vals[k]);
        if (j === 'HIGH' || j === 'LOW') o.dev++;
      });
      o.seq.push(r);
    });
    return [...by.values()].map(o => {
      const sorted = o.seq.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const stats = {};
      cfg.items.forEach(key => {
        const vals = sorted.map(r => vOf(r, key)).filter(v => v != null);
        stats[key] = { mean: mean(vals), trend: trendMark(vals) };
      });
      return { ...o, stats };
    }).sort((a, b) => b.n - a.n);
  };

  // 규격 이탈 상세
  const deviations = (recs, limit = 15) => {
    const out = [];
    recs.forEach(r => {
      Object.keys(r.vals || {}).forEach(k => {
        const v = r.vals[k];
        const j = LabDB.judge('prod', r.code, k, v);
        if (j !== 'HIGH' && j !== 'LOW') return;
        const sp = LabDB.resolveSpec('prod', r.code, k);
        out.push({ date: String(r.date || '').slice(0, 10), name: r.name, code: r.code, item: k, v, sp, j });
      });
    });
    out.sort((a, b) => b.date.localeCompare(a.date));
    return { total: out.length, rows: out.slice(0, limit) };
  };

  const statCard = (label, value, sub, tone) => `
    <div class="stat-card ${tone || ''}">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub || ''}</div>
    </div>`;

  const sectionCard = (title, badge, body, headExtra) => `
    <div class="card" style="margin-top:14px">
      <div class="card-head" style="flex-wrap:wrap;gap:8px">
        <div class="card-title">${title} ${badge ? `<span class="tag tag-gray" style="font-size:10px">${badge}</span>` : ''}</div>
        ${headExtra || ''}
      </div>
      ${body}
    </div>`;

  // ── 렌더 ──
  const render = () => {
    const rg = rangeOf();
    const recsAll = recsOf(rg);                       // 축종 전체 (제품별 표·선택 목록용)
    const recs = prodPick === 'ALL' ? recsAll : recsAll.filter(r => r.code === prodPick);   // 선택 제품 기준
    const cmpRecs = (prodPick !== 'ALL' && cmpPick) ? recsAll.filter(r => r.code === cmpPick) : null;
    const cs = compStats(recs);
    const prows = productRows(recsAll);
    const devs = deviations(recs);
    const totalDev = devs.total;
    const devRate = recs.length ? (recs.filter(r => Object.keys(r.vals || {}).some(k => { const j = LabDB.judge('prod', r.code, k, r.vals[k]); return j === 'HIGH' || j === 'LOW'; })).length / recs.length * 100) : 0;

    const periodBtn = (d) => `<button class="btn btn-sm ${periodDays === d ? 'btn-primary' : 'btn-ghost'}" onclick="${cfg.key}.setPeriod(${d})">${d}일</button>`;
    const toolBtns = (cfg.tools || []).map(t => `<button class="btn btn-ghost btn-sm" onclick="App.navigate('${t.page}')">${t.label} →</button>`).join('');

    // 성분 통계: 비교 모드면 선택 제품 vs 비교 제품 나란히
    const cmpCs = cmpRecs ? compStats(cmpRecs) : null;
    const compHead = cmpCs
      ? `<tr><th>항목</th><th>선택 평균 (n)</th><th>비교 평균 (n)</th><th>차이</th><th>선택 이탈</th><th>비교 이탈</th></tr>`
      : `<tr><th>항목</th><th>n</th><th>평균</th><th>범위</th><th>이탈</th></tr>`;
    const compRows = cmpCs
      ? cs.map((c, i) => {
        const b = cmpCs[i];
        const diff = (c.mean != null && b.mean != null) ? c.mean - b.mean : null;
        return `<tr>
          <td><b>${c.label}</b></td>
          <td class="mono">${c.n ? `${fmtNum(c.mean)} <span class="text-muted">(${c.n})</span>` : '-'}</td>
          <td class="mono">${b.n ? `${fmtNum(b.mean)} <span class="text-muted">(${b.n})</span>` : '-'}</td>
          <td class="mono">${diff == null ? '-' : `<span style="color:${diff >= 0 ? '#48c78e' : '#ff6b81'}">${diff >= 0 ? '+' : ''}${fmtNum(diff)}</span>`}</td>
          <td>${c.dev > 0 ? `<span class="verdict verdict-high">${c.dev}건</span>` : '<span class="text-muted">−</span>'}</td>
          <td>${b.dev > 0 ? `<span class="verdict verdict-high">${b.dev}건</span>` : '<span class="text-muted">−</span>'}</td>
        </tr>`;
      }).join('')
      : cs.map(c => `<tr>
        <td><b>${c.label}</b></td>
        <td class="mono">${c.n}</td>
        <td class="mono">${c.n ? fmtNum(c.mean) : '-'}</td>
        <td class="mono text-muted">${c.n ? `${fmtNum(c.min)} ~ ${fmtNum(c.max)}` : '-'}</td>
        <td>${c.dev > 0 ? `<span class="verdict verdict-high">${c.dev}건</span>` : '<span class="text-muted">−</span>'}</td>
      </tr>`).join('');

    const prodTable = prows.slice(0, 12).map(p => `<tr class="${p.code === prodPick ? 'row-active' : ''}" style="cursor:pointer" onclick="${cfg.key}.pickProd('${esc(p.code)}')" title="이 제품만 보기">
        <td class="ellipsis" style="max-width:170px"><a onclick="event.stopPropagation();App.navigate('prod','${esc(p.code)}')" style="cursor:pointer;color:#5aa2ff" title="제품 분석대장 상세">${esc(p.name || p.code)}</a>${p.code === cmpPick ? ' <span class="tag tag-blue" style="font-size:9px">비교</span>' : ''}</td>
        <td class="mono">${p.n}</td>
        ${cfg.items.slice(0, 3).map(k => `<td class="mono">${p.stats[k].mean != null ? fmtNum(p.stats[k].mean) : '-'}</td><td style="font-size:11px">${p.stats[k].trend}</td>`).join('')}
        <td>${p.dev > 0 ? `<span class="verdict verdict-high">${p.dev}</span>` : '<span class="text-muted">−</span>'}</td>
        <td class="text-muted mono" style="font-size:11px">${p.last}</td>
      </tr>`).join('') || `<tr><td colspan="99" class="text-muted" style="text-align:center;padding:18px">기간 내 ${cfg.species} 제품 분석 데이터가 없습니다</td></tr>`;
    const prodHead = cfg.items.slice(0, 3).map(k => `<th>${ITEM_LABEL[k]}평균</th><th>추세</th>`).join('');

    const devRows = devs.rows.map(d => `<tr>
        <td class="text-muted mono" style="font-size:11px">${d.date}</td>
        <td class="ellipsis" style="max-width:150px">${esc(d.name || d.code)}</td>
        <td>${LabDB.itemLabel(d.item)}</td>
        <td class="mono"><b class="v-${d.j === 'HIGH' ? 'high' : 'low'}">${fmtNum(d.v)}</b></td>
        <td class="mono text-muted">${fmtSpec(d.sp.min, d.sp.max, '-')}</td>
        <td><span class="verdict verdict-${d.j === 'HIGH' ? 'high' : 'low'}">${d.j === 'HIGH' ? '상한초과' : '하한미달'}</span></td>
      </tr>`).join('') || `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:18px">규격 이탈이 없습니다</td></tr>`;

    return `
    <div class="fade-in">
      <div class="card">
        <div class="card-head" style="flex-wrap:wrap;gap:8px">
          <div class="card-title">${cfg.species} 품질 종합 <span class="tag tag-green" style="font-size:10px">전문가 시트</span>
            ${prodPick !== 'ALL' ? `<span class="tag tag-blue" style="font-size:10px">${esc(selName())}${cmpPick ? ` vs ${esc(prodName(cmpPick))}` : ''}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            ${periodBtn(30)}${periodBtn(60)}${periodBtn(90)}
            <button class="btn btn-sm" style="background:#7c5cff;color:#fff" onclick="${cfg.key}.printReport()">보고서 인쇄</button>
          </div>
        </div>
        <div class="text-muted" style="font-size:12px;margin-bottom:10px">
          기간 ${rg.from} ~ ${rg.to} · 분석대장 기반 취합 ${toolBtns ? ' · 측정 입력: ' : ''}${toolBtns}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-bottom:10px">
          <span class="text-muted" style="font-size:11px">제품 선택</span>
          <button class="btn btn-sm ${prodPick === 'ALL' ? 'btn-primary' : 'btn-ghost'}" onclick="${cfg.key}.pickProd('ALL')">전체</button>
          <div style="position:relative;min-width:240px">
            <input type="text" class="form-input form-input-sm" id="${cfg.key}-prod-inp" value="${esc(selName())}"
              placeholder="제품 검색 (코드·명칭)" autocomplete="off" data-nonav
              onfocus="${cfg.key}.openSug('prod')" oninput="${cfg.key}.searchSug('prod', this.value)" onblur="${cfg.key}.blurSug('prod')">
            <div id="${cfg.key}-prod-sug" class="qd-sug-box" style="display:none"></div>
          </div>
          ${prodPick !== 'ALL' ? `
          <span class="text-muted" style="font-size:11px;margin-left:6px">타제품 비교</span>
          <div style="position:relative;min-width:240px">
            <input type="text" class="form-input form-input-sm" id="${cfg.key}-cmp-inp" value="${cmpPick ? esc(prodName(cmpPick)) : ''}"
              placeholder="비교할 제품 검색 (선택)" autocomplete="off" data-nonav
              onfocus="${cfg.key}.openSug('cmp')" oninput="${cfg.key}.searchSug('cmp', this.value)" onblur="${cfg.key}.blurSug('cmp')">
            <div id="${cfg.key}-cmp-sug" class="qd-sug-box" style="display:none"></div>
          </div>
          ${cmpPick ? `<button class="btn btn-ghost btn-sm" onclick="${cfg.key}.pickCmp('')">비교 해제</button>` : ''}` : ''}
        </div>
        <div class="stat-grid">
          ${statCard('분석 건수', fmtNum(recs.length, 0), prodPick === 'ALL' ? `${cfg.species} 제품` : esc(selName()))}
          ${prodPick === 'ALL' ? statCard('분석 제품 수', fmtNum(prows.length, 0), '코드 기준') : statCard('선택 제품', esc(prodPick), esc(selName()))}
          ${statCard('규격 이탈', fmtNum(totalDev, 0), '항목 기준 누적', totalDev > 0 ? 'danger' : 'ok')}
          ${statCard('이탈 시료율', `${devRate.toFixed(1)}%`, '이탈 포함 시료 비율', devRate > 5 ? 'danger' : 'ok')}
          ${(cfg.kpis ? cfg.kpis(recs, rg) : []).map(k => statCard(k.label, k.value, k.sub, k.tone)).join('')}
        </div>
      </div>

      ${sectionCard('성분 분석 추이', cmpRecs ? `${esc(selName())} vs ${esc(prodName(cmpPick))} · 일자별 평균` : `${prodPick === 'ALL' ? cfg.species : esc(selName())} · 일자별 평균`, `
        <div class="qd-raw-grid">
          <div class="chart-frame" style="height:240px"><canvas id="${cfg.key}-comp-chart"></canvas></div>
          <div class="table-wrap"><table class="data-table compact">
            <thead>${compHead}</thead>
            <tbody>${compRows}</tbody>
          </table></div>
        </div>`)}

      ${sectionCard('제품별 품질 현황', '분석건수 상위 · 명칭 클릭 시 제품 추세 상세', `
        <div class="table-wrap" style="overflow:auto">
          <table class="data-table compact">
            <thead><tr><th>제품</th><th>n</th>${prodHead}<th>이탈</th><th>최근분석</th></tr></thead>
            <tbody>${prodTable}</tbody>
          </table>
        </div>`)}

      ${cfg.extra ? cfg.extra(recs, rg) : ''}

      ${sectionCard('규격 이탈 상세', `최근순 · 총 ${totalDev}건 중 ${devs.rows.length}건 표시`, `
        <div class="table-wrap"><table class="data-table compact">
          <thead><tr><th>일자</th><th>제품</th><th>항목</th><th>측정값</th><th>규격</th><th>판정</th></tr></thead>
          <tbody>${devRows}</tbody>
        </table></div>`)}
    </div>`;
  };

  // ── 차트 ──
  const destroyCharts = () => { charts.forEach(c => { try { c.destroy(); } catch (_) {} }); charts = []; };
  const lineChart = (id, labels, datasets) => {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return null;
    const c = new Chart(canvas, {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#8892a6', maxTicksLimit: 8, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#8892a6', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    });
    if (c) charts.push(c);
    return c;
  };
  const COLORS = ['#4f9cff', '#2e9e5b', '#ffb020', '#ff5c7a', '#7c5cff'];

  const drawCharts = () => {
    destroyCharts();
    const rg = rangeOf();
    const recsAll = recsOf(rg);
    const recs = prodPick === 'ALL' ? recsAll : recsAll.filter(r => r.code === prodPick);
    const cmpRecs = (prodPick !== 'ALL' && cmpPick) ? recsAll.filter(r => r.code === cmpPick) : null;
    // 일자별 항목 평균 버킷
    const bucketOf = (rs) => {
      const byDate = new Map();
      rs.forEach(r => {
        const d = String(r.date || '').slice(0, 10);
        if (!byDate.has(d)) byDate.set(d, {});
        const bucket = byDate.get(d);
        cfg.items.forEach(key => {
          const v = vOf(r, key); if (v == null) return;
          (bucket[key] = bucket[key] || []).push(v);
        });
      });
      return byDate;
    };
    const bA = bucketOf(recs);
    const bB = cmpRecs ? bucketOf(cmpRecs) : null;
    const labels = [...new Set([...bA.keys(), ...(bB ? bB.keys() : [])])].sort();
    const seriesOf = (bucketMap, key) => labels.map(d => {
      const arr = (bucketMap.get(d) || {})[key];
      return arr && arr.length ? +mean(arr).toFixed(2) : null;
    });
    // 비교 모드: 항목 3개로 제한(가독성) — 선택=실선, 비교=점선(같은 색)
    const keys = bB ? cfg.items.slice(0, 3) : cfg.items;
    const datasets = [];
    keys.forEach((key, i) => {
      const color = COLORS[i % COLORS.length];
      datasets.push({
        label: `${ITEM_LABEL[key]}${bB ? '·선택' : ''}(%)`,
        data: seriesOf(bA, key),
        borderColor: color, backgroundColor: 'transparent',
        tension: 0.25, pointRadius: 2, spanGaps: true,
      });
      if (bB) datasets.push({
        label: `${ITEM_LABEL[key]}·비교(%)`,
        data: seriesOf(bB, key),
        borderColor: color, backgroundColor: 'transparent', borderDash: [6, 4],
        tension: 0.25, pointRadius: 0, spanGaps: true,
      });
    });
    lineChart(`${cfg.key}-comp-chart`, labels, datasets);
    if (cfg.extraCharts) cfg.extraCharts(rg, { lineChart, charts, COLORS, mean });
  };

  // ── 인쇄 보고서 ──
  const printReport = () => {
    const rg = rangeOf();
    const recsAll = recsOf(rg);
    const recs = prodPick === 'ALL' ? recsAll : recsAll.filter(r => r.code === prodPick);
    const cs = compStats(recs);
    const prows = productRows(recs).slice(0, 15);
    const devs = deviations(recs, 15);
    const today = new Date().toISOString().slice(0, 10);
    const scopeLabel = prodPick === 'ALL' ? '' : ` · 대상 제품: ${selName()}(${prodPick})${cmpPick ? ` / 비교: ${prodName(cmpPick)}` : ''}`;
    const compTbl = cs.map(c => `<tr><td class="l">${c.label}</td><td>${c.n}</td><td>${c.n ? fmtNum(c.mean) : '-'}</td><td>${c.n ? `${fmtNum(c.min)} ~ ${fmtNum(c.max)}` : '-'}</td><td class="${c.dev ? 'rpt-bad' : ''}">${c.dev}</td></tr>`).join('');
    const prodTbl = prows.map(p => `<tr><td class="l">${esc(p.name || p.code)}</td><td>${p.n}</td>${cfg.items.slice(0, 3).map(k => `<td>${p.stats[k].mean != null ? fmtNum(p.stats[k].mean) : '-'}</td>`).join('')}<td class="${p.dev ? 'rpt-bad' : ''}">${p.dev}</td><td>${p.last}</td></tr>`).join('');
    const devTbl = devs.rows.map(d => `<tr><td>${d.date}</td><td class="l">${esc(d.name || d.code)}</td><td>${LabDB.itemLabel(d.item)}</td><td class="rpt-bad">${fmtNum(d.v)}</td><td>${fmtSpec(d.sp.min, d.sp.max, '-')}</td><td>${d.j === 'HIGH' ? '상한초과' : '하한미달'}</td></tr>`).join('');
    openReportOverlay(`
      <div class="rpt-h1">${cfg.species} 품질 종합 보고서</div>
      <div class="rpt-sub">기간 ${rg.from} ~ ${rg.to} · 발행 ${today} · (주)우성사료 품질관리팀${esc(scopeLabel)}</div>
      <table class="rpt-info"><tr>
        <td class="lb">분석 건수</td><td>${recs.length}</td>
        <td class="lb">분석 제품</td><td>${productRows(recs).length}종</td>
        <td class="lb">규격 이탈</td><td>${devs.total}건</td>
      </tr></table>
      <div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">1. 성분 분석 통계</div>
      <table class="rpt-tbl"><thead><tr><th>항목</th><th>n</th><th>평균(%)</th><th>범위(%)</th><th>이탈</th></tr></thead><tbody>${compTbl}</tbody></table>
      <div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">2. 제품별 품질 현황 (분석건수 상위 15)</div>
      <table class="rpt-tbl"><thead><tr><th>제품</th><th>n</th>${cfg.items.slice(0, 3).map(k => `<th>${ITEM_LABEL[k]}평균</th>`).join('')}<th>이탈</th><th>최근분석</th></tr></thead><tbody>${prodTbl}</tbody></table>
      ${cfg.printExtra ? cfg.printExtra(recs, rg) : ''}
      <div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">규격 이탈 상세 (최근 15건 / 총 ${devs.total}건)</div>
      <table class="rpt-tbl"><thead><tr><th>일자</th><th>제품</th><th>항목</th><th>측정값</th><th>규격</th><th>판정</th></tr></thead><tbody>${devTbl}</tbody></table>
      <div class="rpt-sign">Approved by QA Manager</div>
      <div class="rpt-foot">본 보고서는 분석대장·현장 측정 데이터를 기간 기준으로 자동 취합한 것입니다. (주)우성사료 논산공장</div>
    `);
  };

  const setPeriod = (d) => { periodDays = d; App.refreshPage(); };
  const afterRender = () => { ensureSugStyle(); drawCharts(); };
  const searchSug = (which, v) => showSug(which, v);

  return { render, afterRender, setPeriod, printReport, pickProd, pickCmp, openSug, searchSug, blurSug };
}

// ============================================================
// VOC 연동 컴플레인 (전 축종 공통) — 양축/양어/반려 모두 동일 UI
//   LabSpeciesDB.vocComplaintStats(species, year): VOC를 축종별로 집계
// ============================================================
const _vocYear = () => new Date().getFullYear();
const vocCompKpi = (species) => {
  const cst = LabSpeciesDB.vocComplaintStats(species, _vocYear());
  return { label: '컴플레인(올해)', value: fmtNum(cst.total, 0), sub: 'VOC 연동 · 유형/월별', tone: cst.total > 0 ? 'danger' : 'ok' };
};
const vocCompCard = (species, canvasId) => {
  const cst = LabSpeciesDB.vocComplaintStats(species, _vocYear());
  const typeRows = Object.entries(cst.byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
    .map(([t, v]) => `<tr><td>${esc(t)}</td><td class="mono"><b>${v}</b></td><td><div style="background:#ff5c7a;height:8px;border-radius:4px;width:${Math.min(100, v / Math.max(1, cst.total) * 100 * 2)}%"></div></td></tr>`).join('')
    || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px">올해 VOC 컴플레인이 없습니다</td></tr>';
  return `
    <div class="card" style="margin-top:14px">
      <div class="card-head"><div class="card-title">컴플레인 <span class="tag tag-gray" style="font-size:10px">VOC 연동 · ${esc(species)} · ${_vocYear()}년</span></div>
        <div style="display:flex;gap:6px;align-items:center"><span class="tag tag-gray" style="font-size:10px">총 ${cst.total}건</span>
        <button class="btn btn-ghost btn-sm" onclick="App.navigate('voc')">VOC 관리 →</button></div></div>
      <div class="qd-raw-grid">
        <div class="table-wrap"><table class="data-table compact">
          <thead><tr><th>클레임 유형</th><th>건수</th><th></th></tr></thead>
          <tbody>${typeRows}</tbody></table></div>
        <div class="chart-frame" style="height:150px"><canvas id="${canvasId}"></canvas></div>
      </div>
    </div>`;
};
const vocCompChart = (species, canvasId, h) => {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const cst = LabSpeciesDB.vocComplaintStats(species, _vocYear());
  const c = new Chart(canvas, {
    type: 'bar',
    data: { labels: Object.keys(cst.byMonth).map(m => m + '월'), datasets: [{ label: '컴플레인(월별)', data: Object.values(cst.byMonth), backgroundColor: 'rgba(255,92,122,0.55)', borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 10 } } } },
      scales: { x: { ticks: { color: '#8892a6', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#8892a6', font: { size: 9 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } } },
    },
  });
  if (h && h.charts) h.charts.push(c);
};
const vocCompPrint = (species, no) => {
  const cst = LabSpeciesDB.vocComplaintStats(species, _vocYear());
  const typeTbl = Object.entries(cst.byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<tr><td class="l">${esc(t)}</td><td>${v}</td></tr>`).join('');
  return `
    <div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">${no}. 컴플레인 (VOC 연동 · ${_vocYear()}년)</div>
    <table class="rpt-tbl"><tr><td class="l">${esc(species)} 올해 컴플레인 ${cst.total}건</td></tr></table>
    ${typeTbl ? `<table class="rpt-tbl"><thead><tr><th>클레임 유형</th><th>건수</th></tr></thead><tbody>${typeTbl}</tbody></table>` : ''}`;
};

// ============================================================
// 축종별 구성
// ============================================================

// ── 양축: 성분 + 공정기준율(조단백) + 입자도(Dgw) + 옥수수 등급 ──
const SpeciesLivestockPage = makeSpeciesReport({
  key: 'SpeciesLivestockPage', species: '양축',
  items: ['protein', 'moist', 'fat', 'fiber', 'ash'],
  tools: [{ page: 'cornGrade', label: '옥수수 등급평가' }, { page: 'psa', label: '입자도 측정' }],
  kpis: (recs) => {
    // 공정기준율(조단백): NIR 대비 화학
    let n = 0, ok = 0;
    recs.forEach(r => {
      const pr = LabDB.processRate && LabDB.processRate(r.nirVals && r.nirVals.protein_n, r.vals && r.vals.protein);
      if (!pr) return; n++; if (pr.range <= 2) ok++;
    });
    const psas = LabSpeciesDB.getPSAs('ALL');
    return [
      { label: '공정기준율', value: n ? `${(ok / n * 100).toFixed(0)}%` : '−', sub: `97~103% 이내 · 비교 ${n}건`, tone: n && ok / n < 0.9 ? 'danger' : (n ? 'ok' : '') },
      { label: '입자도 기록', value: fmtNum(psas.length, 0), sub: 'Dgw 측정 누적' },
      vocCompKpi('양축'),
    ];
  },
  extra: (recs, rg) => {
    // 공정기준율 상세
    const prRows = [];
    recs.forEach(r => {
      const pr = LabDB.processRate && LabDB.processRate(r.nirVals && r.nirVals.protein_n, r.vals && r.vals.protein);
      if (pr) prRows.push({ r, ...pr });
    });
    prRows.sort((a, b) => String(b.r.date || '').localeCompare(String(a.r.date || '')));
    const grades = { 만족: prRows.filter(x => x.range <= 1).length, 의심: prRows.filter(x => x.range === 2).length, 불만족: prRows.filter(x => x.range >= 3).length };
    const prTbl = prRows.slice(0, 8).map(x => `<tr>
        <td class="text-muted mono" style="font-size:11px">${String(x.r.date || '').slice(0, 10)}</td>
        <td class="ellipsis" style="max-width:150px">${esc(x.r.name || x.r.code)}</td>
        <td class="mono">${fmtNum(x.r.nirVals.protein_n)}</td><td class="mono">${fmtNum(x.r.vals.protein)}</td>
        <td class="mono"><b>${x.rate}%</b></td><td class="mono">${x.range}</td>
        <td><span class="verdict verdict-${x.grade === '만족' ? 'ok' : x.grade === '의심' ? 'low' : 'high'}">${x.grade}</span></td>
      </tr>`).join('') || '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:14px">NIR·화학 조단백 비교 데이터가 없습니다</td></tr>';

    // 입자도(Dgw) 최근 기록
    const psas = LabSpeciesDB.getPSAs('ALL').slice(0, 8);
    const psaTbl = psas.map(p => {
      const set = LabSpeciesDB.getPsaSet(p.setId);
      const c = set ? LabSpeciesDB.psaCompute(set.sieves, p.weights) : null;
      return `<tr>
        <td class="text-muted mono" style="font-size:11px">${p.date}</td>
        <td class="ellipsis" style="max-width:150px">${esc(p.product || '-')}</td>
        <td class="mono"><b>${c && c.DgwMm != null ? fmtNum(c.DgwMm, 3) + ' mm' : '-'}</b></td>
        <td class="mono">${c && c.Sgw != null ? fmtNum(c.Sgw, 2) : '-'}</td>
        <td class="text-muted">${esc(p.by || '-')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px">입자도 측정 기록이 없습니다 — [입자도 측정]에서 입력</td></tr>';

    // 옥수수 등급 최근 기록 (양축 주원료 원료품질)
    const corns = LabSpeciesDB.getCorns('ALL').slice(0, 8);
    const gm = LabSpeciesDB.GRADE_META;
    const cornTbl = corns.map(c => {
      const ev = LabSpeciesDB.cornEvaluate(c);
      const g = ev.gradeMeta;
      return `<tr>
        <td class="text-muted mono" style="font-size:11px">${c.date}</td>
        <td class="ellipsis" style="max-width:130px">${esc(c.vessel || c.origin || '-')}</td>
        <td class="mono">${c.density != null ? fmtNum(c.density, 0) : '-'}</td>
        <td class="mono">${c.bcfm != null ? fmtNum(c.bcfm) : '-'}</td>
        <td class="mono">${c.normalPct != null ? fmtNum(c.normalPct) : '-'}</td>
        <td>${g ? `<span class="verdict verdict-${g.tone}">${g.label}</span>` : '-'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:14px">옥수수 등급평가 기록이 없습니다 — [옥수수 등급평가]에서 입력</td></tr>';

    return `
      <div class="card" style="margin-top:14px">
        <div class="card-head"><div class="card-title">공정기준율 (조단백 · NIR 대비 화학분석)
          <span class="tag tag-gray" style="font-size:10px">만족 ${grades.만족} · 의심 ${grades.의심} · 불만족 ${grades.불만족}</span></div></div>
        <div class="table-wrap"><table class="data-table compact">
          <thead><tr><th>일자</th><th>제품</th><th>NIR</th><th>화학</th><th>기준율</th><th>Range</th><th>판정</th></tr></thead>
          <tbody>${prTbl}</tbody></table></div>
      </div>
      <div class="qd-raw-grid" style="margin-top:14px">
        <div class="card" style="margin:0">
          <div class="card-head"><div class="card-title">입자도 분석 (Dgw · ASABE S319)</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('psa')">측정 입력 →</button></div>
          <div class="table-wrap"><table class="data-table compact">
            <thead><tr><th>일자</th><th>제품</th><th>Dgw</th><th>Sgw</th><th>담당</th></tr></thead>
            <tbody>${psaTbl}</tbody></table></div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-head"><div class="card-title">옥수수 등급평가 (원료 품질)</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('cornGrade')">평가 입력 →</button></div>
          <div class="table-wrap"><table class="data-table compact">
            <thead><tr><th>일자</th><th>모선/산지</th><th>용적중</th><th>BCFM</th><th>정상립</th><th>등급</th></tr></thead>
            <tbody>${cornTbl}</tbody></table></div>
        </div>
      </div>
      ${vocCompCard('양축', 'SpeciesLivestockPage-voc-month')}`;
  },
  extraCharts: (rg, h) => { vocCompChart('양축', 'SpeciesLivestockPage-voc-month', h); },
  printExtra: (recs) => {
    const prRows = [];
    recs.forEach(r => { const pr = LabDB.processRate && LabDB.processRate(r.nirVals && r.nirVals.protein_n, r.vals && r.vals.protein); if (pr) prRows.push(pr); });
    const n = prRows.length, ok = prRows.filter(x => x.range <= 2).length;
    const psas = LabSpeciesDB.getPSAs('ALL').slice(0, 6);
    const psaTbl = psas.map(p => { const set = LabSpeciesDB.getPsaSet(p.setId); const c = set ? LabSpeciesDB.psaCompute(set.sieves, p.weights) : null;
      return `<tr><td>${p.date}</td><td class="l">${esc(p.product || '-')}</td><td>${c && c.DgwMm != null ? fmtNum(c.DgwMm, 3) : '-'}</td><td>${c && c.Sgw != null ? fmtNum(c.Sgw, 2) : '-'}</td></tr>`; }).join('');
    return `
      <div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">3. 공정기준율 (조단백)</div>
      <table class="rpt-tbl"><tr><td class="l">비교 ${n}건 · 97~103% 이내 ${n ? (ok / n * 100).toFixed(1) : '-'}% · 만족 ${prRows.filter(x => x.range <= 1).length} · 의심 ${prRows.filter(x => x.range === 2).length} · 불만족 ${prRows.filter(x => x.range >= 3).length}</td></tr></table>
      ${psaTbl ? `<div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">4. 입자도(Dgw) 최근 기록</div>
      <table class="rpt-tbl"><thead><tr><th>일자</th><th>제품</th><th>Dgw(mm)</th><th>Sgw</th></tr></thead><tbody>${psaTbl}</tbody></table>` : ''}
      ${vocCompPrint('양축', 5)}`;
  },
});

// ── 양어: 성분(고단백) + 물리검사 취합 ──
const SpeciesAquaPage = makeSpeciesReport({
  key: 'SpeciesAquaPage', species: '양어',
  items: ['protein', 'fat', 'moist', 'ash'],
  tools: [{ page: 'aqua', label: '물리검사 입력' }],
  kpis: () => {
    const aquas = LabSpeciesDB.getAquas('ALL');
    let pass = 0, judged = 0;
    aquas.forEach(a => { const j = LabSpeciesDB.aquaJudge(a, a.spec); if (j.overall === 'PASS') { pass++; judged++; } else if (j.overall === 'FAIL') judged++; });
    return [
      { label: '물리검사 기록', value: fmtNum(aquas.length, 0), sub: '부상침강·새우 누적' },
      { label: '물리검사 합격률', value: judged ? `${(pass / judged * 100).toFixed(0)}%` : '−', sub: `판정 ${judged}건`, tone: judged && pass / judged < 0.9 ? 'danger' : (judged ? 'ok' : '') },
      vocCompKpi('양어'),
    ];
  },
  extra: () => {
    const aquas = LabSpeciesDB.getAquas('ALL').slice(0, 10);
    const rows = aquas.map(a => {
      const j = LabSpeciesDB.aquaJudge(a, a.spec);
      const badge = j.overall === 'PASS' ? '<span class="verdict verdict-ok">합격</span>' : j.overall === 'FAIL' ? '<span class="verdict verdict-high">부적합</span>' : '<span class="text-muted">-</span>';
      return `<tr>
        <td class="text-muted mono" style="font-size:11px">${a.date}</td>
        <td class="ellipsis" style="max-width:150px">${esc(a.sample || '-')}</td>
        <td><span class="tag tag-gray" style="font-size:10px">${esc(a.atype)}</span></td>
        <td class="mono">${a.floatSink != null ? fmtNum(a.floatSink) + '%' : '-'}</td>
        <td class="mono">${a.volWeight != null ? fmtNum(a.volWeight, 0) : '-'}</td>
        <td class="mono">${a.diaAvg != null ? fmtNum(a.diaAvg, 2) : '-'}${a.lenAvg != null ? ' / ' + fmtNum(a.lenAvg, 2) : ''}</td>
        <td class="mono">${a.density != null ? fmtNum(a.density, 2) : '-'}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="text-muted" style="text-align:center;padding:14px">물리검사 기록이 없습니다 — [물리검사 입력]에서 등록</td></tr>';
    return `
      <div class="card" style="margin-top:14px">
        <div class="card-head"><div class="card-title">물리검사 현황 (부상침강 · 흡수/붕괴 · SIZE)</div>
          <button class="btn btn-ghost btn-sm" onclick="App.navigate('aqua')">검사 입력 →</button></div>
        <div class="table-wrap"><table class="data-table compact">
          <thead><tr><th>일자</th><th>시료</th><th>구분</th><th>부상률</th><th>용적중</th><th>직경/길이</th><th>밀도</th><th>판정</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div>
      ${vocCompCard('양어', 'SpeciesAquaPage-voc-month')}`;
  },
  extraCharts: (rg, h) => { vocCompChart('양어', 'SpeciesAquaPage-voc-month', h); },
  printExtra: () => {
    const aquas = LabSpeciesDB.getAquas('ALL').slice(0, 8);
    const comp = vocCompPrint('양어', aquas.length ? 4 : 3);
    if (!aquas.length) return comp;
    const rows = aquas.map(a => { const j = LabSpeciesDB.aquaJudge(a, a.spec);
      return `<tr><td>${a.date}</td><td class="l">${esc(a.sample || '-')}</td><td>${esc(a.atype)}</td><td>${a.floatSink != null ? fmtNum(a.floatSink) : '-'}</td><td>${a.volWeight != null ? fmtNum(a.volWeight, 0) : '-'}</td><td class="${j.overall === 'FAIL' ? 'rpt-bad' : 'rpt-ok'}">${j.overall === 'PASS' ? '합격' : j.overall === 'FAIL' ? '부적합' : '-'}</td></tr>`; }).join('');
    return `<div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">3. 물리검사 최근 기록</div>
      <table class="rpt-tbl"><thead><tr><th>일자</th><th>시료</th><th>구분</th><th>부상률(%)</th><th>용적중</th><th>판정</th></tr></thead><tbody>${rows}</tbody></table>
      ${comp}`;
  },
});

// ── 반려: 성분(등록성분 방향성) + SIZE + 컴플레인 ──
const SpeciesPetPage = makeSpeciesReport({
  key: 'SpeciesPetPage', species: '반려',
  items: ['moist', 'protein', 'fat', 'ash'],
  tools: [{ page: 'pet', label: '반려 성분·SIZE 입력' }],
  kpis: () => {
    const pets = LabSpeciesDB.getPets('ALL');
    let pass = 0, judged = 0;
    pets.forEach(p => { const ev = LabSpeciesDB.petEvaluate(p); if (ev.overall === 'PASS') { pass++; judged++; } else if (ev.overall === 'FAIL') judged++; });
    const cst = LabSpeciesDB.vocComplaintStats('반려', new Date().getFullYear());
    return [
      { label: '등록성분 적합률', value: judged ? `${(pass / judged * 100).toFixed(0)}%` : '−', sub: `방향성 판정 ${judged}건`, tone: judged && pass / judged < 0.95 ? 'danger' : (judged ? 'ok' : '') },
      { label: '컴플레인(올해)', value: fmtNum(cst.total, 0), sub: '유형·월별 집계', tone: cst.total > 0 ? 'danger' : 'ok' },
    ];
  },
  extra: () => {
    // 최근 성분판정 기록
    const pets = LabSpeciesDB.getPets('ALL').slice(0, 8);
    const petRows = pets.map(p => {
      const ev = LabSpeciesDB.petEvaluate(p);
      const ngs = ev.items.filter(i => i.verdict !== 'OK' && i.verdict !== 'NA').map(i => i.label);
      return `<tr>
        <td class="text-muted mono" style="font-size:11px">${p.date}</td>
        <td class="ellipsis" style="max-width:150px">${esc(p.product || p.brand || '-')}</td>
        <td>${ev.overall === 'PASS' ? '<span class="verdict verdict-ok">적합</span>' : ev.overall === 'FAIL' ? '<span class="verdict verdict-high">부적합</span>' : '<span class="text-muted">-</span>'}</td>
        <td class="text-muted" style="font-size:11px">${ngs.length ? esc(ngs.join(', ')) : '−'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:14px">성분·SIZE 판정 기록이 없습니다 — [반려 성분·SIZE 입력]에서 등록</td></tr>';

    // 컴플레인 유형별 (올해)
    const cst = LabSpeciesDB.vocComplaintStats('반려', new Date().getFullYear());
    const typeRows = Object.entries(cst.byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
      .map(([t, v]) => `<tr><td>${esc(t)}</td><td class="mono"><b>${v}</b></td><td><div style="background:#ff5c7a;height:8px;border-radius:4px;width:${Math.min(100, v / Math.max(1, cst.total) * 100 * 2)}%"></div></td></tr>`).join('')
      || '<tr><td colspan="3" class="text-muted" style="text-align:center;padding:14px">올해 컴플레인이 없습니다</td></tr>';

    return `
      <div class="qd-raw-grid" style="margin-top:14px">
        <div class="card" style="margin:0">
          <div class="card-head"><div class="card-title">등록성분 방향성 판정 (수분↓ 조단백↑ …)</div>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('pet')">판정 입력 →</button></div>
          <div class="table-wrap"><table class="data-table compact">
            <thead><tr><th>일자</th><th>제품</th><th>종합판정</th><th>부적합 항목</th></tr></thead>
            <tbody>${petRows}</tbody></table></div>
        </div>
        <div class="card" style="margin:0">
          <div class="card-head"><div class="card-title">컴플레인 유형별 <span class="tag tag-gray" style="font-size:10px">VOC 연동 · ${new Date().getFullYear()}년</span></div>
            <div style="display:flex;gap:6px;align-items:center"><span class="tag tag-gray" style="font-size:10px">총 ${cst.total}건</span>
            <button class="btn btn-ghost btn-sm" onclick="App.navigate('voc')">VOC →</button></div></div>
          <div class="table-wrap"><table class="data-table compact">
            <thead><tr><th>유형</th><th>건수</th><th></th></tr></thead>
            <tbody>${typeRows}</tbody></table></div>
          <div class="chart-frame" style="height:140px;margin-top:8px"><canvas id="SpeciesPetPage-comp-month"></canvas></div>
        </div>
      </div>`;
  },
  extraCharts: (rg, h) => {
    // 컴플레인 월별 바차트
    const canvas = document.getElementById('SpeciesPetPage-comp-month');
    if (!canvas || typeof Chart === 'undefined') return;
    const cst = LabSpeciesDB.vocComplaintStats('반려', new Date().getFullYear());
    const c = new Chart(canvas, {
      type: 'bar',
      data: { labels: Object.keys(cst.byMonth).map(m => m + '월'), datasets: [{ label: '컴플레인(월별)', data: Object.values(cst.byMonth), backgroundColor: 'rgba(255,92,122,0.55)', borderRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#c7d0e0', boxWidth: 12, font: { size: 10 } } } },
        scales: { x: { ticks: { color: '#8892a6', font: { size: 9 } }, grid: { display: false } }, y: { ticks: { color: '#8892a6', font: { size: 9 }, precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } } } },
    });
    h.charts.push(c);
  },
  printExtra: () => {
    const pets = LabSpeciesDB.getPets('ALL');
    let pass = 0, judged = 0;
    pets.forEach(p => { const ev = LabSpeciesDB.petEvaluate(p); if (ev.overall === 'PASS') { pass++; judged++; } else if (ev.overall === 'FAIL') judged++; });
    const cst = LabSpeciesDB.vocComplaintStats('반려', new Date().getFullYear());
    const typeTbl = Object.entries(cst.byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<tr><td class="l">${esc(t)}</td><td>${v}</td></tr>`).join('');
    return `
      <div class="rpt-sub" style="text-align:left;font-weight:700;margin:10px 0 4px">3. 등록성분 적합률 · 컴플레인</div>
      <table class="rpt-tbl"><tr><td class="l">방향성 판정 ${judged}건 · 적합률 ${judged ? (pass / judged * 100).toFixed(1) : '-'}% · 올해 컴플레인 ${cst.total}건</td></tr></table>
      ${typeTbl ? `<table class="rpt-tbl"><thead><tr><th>컴플레인 유형</th><th>건수</th></tr></thead><tbody>${typeTbl}</tbody></table>` : ''}`;
  },
});
