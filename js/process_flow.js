// ============================================================
// process_flow.js — 제조공정도 (DOC-N-230 V25, 2026.01.02 기준)
//
//   원본 엑셀이 "열 = 원료 라인 / 행 = 공정 단계" 로 그려져 있고
//   현장이 그 그림에 익숙하므로 배치를 바꾸지 않았다.
//   같은 높이에 있으면 같은 성격의 공정이라는 뜻이라, 왼쪽에 단계 이름을
//   고정 띠로 두면 7~8개 라인을 가로로 한눈에 비교할 수 있다.
//
//   데이터(번호·공정명·공정설명·작업기구)는 process_flow_data.js 에 원문 그대로 있고
//   여기서는 그리기와 상호작용만 한다.
//
//   ── 애니메이션 ──
//   외부 라이브러리 없이 브라우저 기본 기능만 쓴다.
//     · 배관 그려지기 → stroke-dasharray / dashoffset
//     · 노드 순차 등장 → CSS animation-delay 스태거
//     · 원료 흐름     → 굵은 점선의 stroke-dashoffset 행진
//     · CCP 맥박      → CSS keyframes
//   현장 휴대폰에서 오프라인(PWA)으로 열리는 앱이라 외부 스크립트를
//   앱 셸에 더하는 값이 이 화면 하나로는 서지 않는다.
// ============================================================

const ProcessFlowPage = (() => {

  const esc = (v) => String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const nl2br = (v) => esc(v).replaceAll('\n', '<br>');

  let planKey = 'F1';      // F1 = 1공장 / F2 = 2공장
  let selected = null;     // 선택된 노드 키 (lane|no)
  let flowOn = true;

  const plan = () => (planKey === 'F2' ? ProcessFlowData.F2 : ProcessFlowData.F1);

  // ============================================================
  // 좌표계 — 왼쪽 단계 띠 + 라인 컬럼
  // ============================================================
  const RAIL_W = 118;
  const LANE_W = 170;
  const LANE_GAP = 14;
  const PAD_X = 12;
  const HEAD_H = 76;
  const NODE_H = 54;
  const NODE_GAP = 26;
  const MARK_H = 22;
  // 설비 표시줄 뒤 간격 — 합류 버스가 이 줄 위로 겹쳐 그려지지 않도록 넉넉히 둔다
  const MARK_GAP = 30;

  const laneX = (i) => PAD_X + RAIL_W + i * (LANE_W + LANE_GAP);

  const layout = () => {
    const p = plan();
    const rows = [];
    let y = HEAD_H + 18;
    p.levels.forEach(lv => {
      const h = lv.type === 'marker' ? MARK_H : NODE_H;
      rows.push({ ...lv, y, h, cy: y + h / 2 });
      y += h + (lv.type === 'marker' ? MARK_GAP : NODE_GAP);
    });
    const width = PAD_X * 2 + RAIL_W + p.lanes.length * LANE_W + (p.lanes.length - 1) * LANE_GAP;
    return { rows, width, height: y + 10, byKey: Object.fromEntries(rows.map(r => [r.key, r])) };
  };

  // ============================================================
  // 실데이터 — CCP 상태
  // ============================================================
  const ccpStatusMap = () => {
    const map = {};
    try {
      (DB.getCCPStatus(plan().factory) || []).forEach(s => { map[s.def.code || s.def.id] = s; });
    } catch (_) {}
    return map;
  };

  const nodeState = (n, ccpMap) => {
    const ccps = (n.ccp || []).map(c => ccpMap[c]).filter(Boolean);
    const dev = ccps.reduce((a, s) => a + (s.deviations || 0), 0);
    return { ccps, dev, level: dev > 0 ? 'danger' : (n.ccp || []).length ? 'ccp' : 'ok' };
  };

  const nodeKey = (n) => `${n.lane}|${n.no}`;
  const findNode = (key) => plan().nodes.find(n => nodeKey(n) === key);

  // SVG 는 자동 줄바꿈이 없어 폭에 맞춰 직접 잘라준다.
  //   띠(11.5px)와 노드(13px)는 글자폭이 달라 charW 를 따로 받는다.
  const fit = (s, w, charW = 12.4) => {
    const max = Math.floor((w - 18) / charW);
    const t = String(s);
    return t.length > max ? t.slice(0, Math.max(1, max - 1)) + '…' : t;
  };

  // 공정명이 길면 두 줄로 나눈다. 쉼표·괄호·공백에서 끊어야 읽힌다.
  const wrap2 = (s, w) => {
    const max = Math.floor((w - 22) / 12.4);
    const t = String(s).trim();
    if (t.length <= max) return [t];
    let cut = -1;
    for (const sep of [' (', '(', ', ', ' ']) {
      const i = t.lastIndexOf(sep, max);
      if (i >= 1) { cut = i + (sep === ' (' ? 1 : sep === '(' ? 0 : sep.length); break; }
    }
    if (cut < 0) cut = max;
    const a = t.slice(0, cut).trim();
    let b = t.slice(cut).trim();
    const max2 = Math.floor((w - 16) / 12.0);
    if (b.length > max2) b = b.slice(0, max2 - 1) + '…';
    return [a, b];
  };

  // ============================================================
  // SVG
  // ============================================================
  const svgHtml = () => {
    const p = plan();
    const L = layout();
    const ccpMap = ccpStatusMap();
    const laneIdx = Object.fromEntries(p.lanes.map((l, i) => [l.key, i]));
    const lvOrder = Object.fromEntries(p.levels.map((lv, i) => [lv.key, i]));

    const byLane = {};
    p.nodes.forEach(n => { (byLane[n.lane] = byLane[n.lane] || []).push(n); });
    Object.values(byLane).forEach(arr => arr.sort((a, b) => lvOrder[a.level] - lvOrder[b.level]));

    // 라인별 세로 배관 — 노드 사이를 잇는다(빈 레벨은 건너뛰므로 한 줄로 이어진다).
    //   pipeBreak 가 붙은 노드에서 끊는다. 원본 엑셀은 서로 다른 흐름을 같은 열에 그려서
    //   그대로 이으면 한 줄로 이어진 것처럼 보인다(예: 조분쇄 → 소포장).
    const pipes = p.lanes.map(l => {
      const arr = byLane[l.key] || [];
      if (arr.length < 2) return '';
      const x = laneX(laneIdx[l.key]) + LANE_W / 2;
      const segs = [];
      let start = 0;
      arr.forEach((n, i) => {
        if (n.pipeBreak || i === arr.length - 1) {
          if (i > start) {
            segs.push(`M ${x} ${L.byKey[arr[start].level].y + NODE_H} L ${x} ${L.byKey[arr[i].level].y}`);
          }
          start = i + (n.pipeBreak ? 1 : 0);
        }
      });
      return segs.length ? `<path class="pf-pipe" d="${segs.join(' ')}"></path>` : '';
    }).join('');

    // 합류 — 1공장은 8개 라인이 포장으로 모인다
    let mergePath = '';
    const mergeNodes = (byLane.MERGE || []);
    let mergeX = 0;
    if (mergeNodes.length) {
      const firstRow = L.byKey[mergeNodes[0].level];
      const xs = p.lanes.map(l => laneX(laneIdx[l.key]) + LANE_W / 2);
      mergeX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const busY = firstRow.y - 15;
      const segs = [];
      p.lanes.forEach(l => {
        const arr = byLane[l.key] || [];
        if (!arr.length) return;
        const x = laneX(laneIdx[l.key]) + LANE_W / 2;
        const y = L.byKey[arr[arr.length - 1].level].y + NODE_H;
        segs.push(`M ${x} ${y} L ${x} ${busY}`);
      });
      segs.push(`M ${Math.min(...xs)} ${busY} L ${Math.max(...xs)} ${busY}`);
      segs.push(`M ${mergeX} ${busY} L ${mergeX} ${firstRow.y}`);
      for (let i = 0; i < mergeNodes.length - 1; i++) {
        const a = L.byKey[mergeNodes[i].level], b = L.byKey[mergeNodes[i + 1].level];
        segs.push(`M ${mergeX} ${a.y + NODE_H} L ${mergeX} ${b.y}`);
      }
      mergePath = `<path class="pf-pipe pf-merge" d="${segs.join(' ')}"></path>`;
    }

    // 라인 간 연결 — 어느 공정이 어느 공정으로 들어가는지 화살표로 잇는다
    const nodeBox = (key) => {
      const n = p.nodes.find(x => nodeKey(x) === key);
      if (!n || !L.byKey[n.level] || laneIdx[n.lane] === undefined) return null;
      const bx = laneX(laneIdx[n.lane]);
      return { x: bx, cx: bx + LANE_W / 2, y: L.byKey[n.level].y, h: NODE_H, w: LANE_W };
    };
    const links = (p.links || []).map(lk => {
      const a = nodeBox(lk.from), b = nodeBox(lk.to);
      if (!a || !b) return '';
      const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
      const x1 = a.cx < b.cx ? a.x + a.w : a.x;
      const x2 = a.cx < b.cx ? b.x : b.x + b.w;
      const mx = (x1 + x2) / 2;
      return `<path class="pf-link" data-from="${esc(lk.from)}" data-to="${esc(lk.to)}"
                    d="M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"
                    marker-end="url(#pf-arrow)"></path>`;
    }).join('');

    // ── 흐름 경로 ──
    //   라인마다 "원료가 지나가는 전체 길"을 꼭짓점 목록으로 만든다.
    //   꼭짓점을 공정 상자의 중심에 두면, 특정 공정부터의 하류 경로를
    //   그 지점부터 잘라내기만 하면 되므로 연결선 뒤가 끊겨 보이지 않는다.
    const routes = [];
    p.lanes.forEach(l => {
      const arr = byLane[l.key] || [];
      if (!arr.length) return;
      const chains = [];
      let chain = [];
      arr.forEach(n => { chain.push(n); if (n.pipeBreak) { chains.push(chain); chain = []; } });
      if (chain.length) chains.push(chain);

      const x = laneX(laneIdx[l.key]) + LANE_W / 2;
      chains.forEach((ch, ci) => {
        const isLast = ci === chains.length - 1;
        const pts = ch.map(n => [x, L.byKey[n.level].y + NODE_H / 2]);
        const keys = ch.map(nodeKey);
        if (isLast && mergeNodes.length) {
          const busY = L.byKey[mergeNodes[0].level].y - 15;
          pts.push([x, busY], [mergeX, busY]);
          keys.push('', '');
          mergeNodes.forEach(m => {
            pts.push([mergeX, L.byKey[m.level].y + NODE_H / 2]);
            keys.push(nodeKey(m));
          });
        }
        if (pts.length >= 2) routes.push({ id: `${l.key}-${ci}`, pts, keys });
      });
    });

    // 연결선이 닿는 곳부터의 하류 경로.
    //   액상 계량을 고르면 진공코팅에서 끊기지 않고 대포장·보관·운송까지 이어져 흐른다.
    const spurs = [];
    (p.links || []).forEach((lk, i) => {
      const r = routes.find(x => x.keys.includes(lk.to));
      if (!r) return;
      const idx = r.keys.indexOf(lk.to);
      const pts = r.pts.slice(idx), keys = r.keys.slice(idx);
      if (pts.length < 2) return;
      spurs.push({ id: `sp${i}`, trigger: lk.from, pts, keys, spur: true });
    });

    const dOf = (pts) => pts.map((q, i) => `${i ? 'L' : 'M'} ${q[0]} ${q[1]}`).join(' ');

    // ── 전체 흐름(선택 없음) ──
    //   라인마다 경로를 하나씩 그리면 합류 버스와 포장~운송 구간에 8줄이 겹쳐 올라가
    //   두껍고 지저분해 보인다(대시 위상까지 어긋나 더 어지럽다).
    //   그래서 겹치는 구간은 한 번만 그린다: 라인별 세로줄 + 버스 1줄 + 합류 세로 1줄.
    const allSegs = routes.map(r => {
      const upToBus = mergeNodes.length
        ? r.pts.slice(0, r.keys.indexOf('') + 1)   // 버스 진입점까지만
        : r.pts;
      return upToBus.length >= 2 ? dOf(upToBus) : '';
    }).filter(Boolean);
    if (mergeNodes.length) {
      const busY = L.byKey[mergeNodes[0].level].y - 15;
      const xs = p.lanes.map(l => laneX(laneIdx[l.key]) + LANE_W / 2);
      allSegs.push(`M ${Math.min(...xs)} ${busY} L ${Math.max(...xs)} ${busY}`);
      const endY = L.byKey[mergeNodes[mergeNodes.length - 1].level].y + NODE_H / 2;
      allSegs.push(`M ${mergeX} ${busY} L ${mergeX} ${endY}`);
    }

    // 선택했을 때는 경로 하나만 흐르므로 겹칠 일이 없다.
    const flow =
      `<path class="pf-route pf-route-all" data-all="1" d="${allSegs.join(' ')}"></path>` +
      [...routes, ...spurs].map(r => {
        const nodes = r.keys.filter(Boolean).join(',');
        const attrs = `data-route="${esc(r.id)}" data-nodes="${esc(nodes)}"` +
          (r.spur ? ` data-spur="1" data-trigger="${esc(r.trigger)}"` : '');
        return `<path id="pfr-${esc(r.id)}" class="pf-route" ${attrs} d="${dOf(r.pts)}"></path>`;
      }).join('');

    // 왼쪽 단계 띠
    const rail = L.rows.filter(r => r.type === 'node' && r.label).map(r => `
      <g class="pf-rail">
        <rect x="${PAD_X}" y="${r.y}" width="${RAIL_W - 12}" height="${NODE_H}" rx="6"></rect>
        <text x="${PAD_X + (RAIL_W - 12) / 2}" y="${r.cy + 4}">${esc(fit(r.label, RAIL_W - 12, 11.6))}</text>
      </g>`).join('');

    // 라인 머리
    const heads = p.lanes.map((l, i) => {
      const x = laneX(i);
      const tone = ProcessFlowData.LANE_TONE[l.group] || 'proc';
      return `
        <g class="pf-head pf-tone-${tone}" data-lane="${l.key}" tabindex="0" role="button"
           aria-label="${esc(l.title + ' 라인 전체 보기')}" style="--d:${(0.12 + i * 0.05).toFixed(2)}s">
          <rect x="${x}" y="8" width="${LANE_W}" height="${HEAD_H - 10}" rx="8"></rect>
          <circle class="pf-head-no" cx="${x + 21}" cy="31" r="12"></circle>
          <text class="pf-head-non" x="${x + 21}" y="35">${l.no}</text>
          <text class="pf-head-t" x="${x + 41}" y="36">${esc(fit(l.title, LANE_W - 34, 12.0))}</text>
          <text class="pf-head-m" x="${x + 12}" y="57">${esc(fit(l.material, LANE_W, 11.2))}</text>
        </g>`;
    }).join('');

    // 설비 표시줄
    const markers = L.rows.filter(r => r.type === 'marker').map(r => {
      const a = laneIdx[r.lanes[0]], b = laneIdx[r.lanes[1]];
      if (a === undefined || b === undefined) return '';
      const x1 = laneX(a), x2 = laneX(b) + LANE_W;
      return `
        <g class="pf-mark">
          <rect x="${x1}" y="${r.y}" width="${x2 - x1}" height="${MARK_H}" rx="5"></rect>
          <text x="${(x1 + x2) / 2}" y="${r.cy + 4}">${esc(r.text)}</text>
        </g>`;
    }).join('');

    // 공정 노드
    let idx = 0;
    const nodes = p.nodes.map(n => {
      const row = L.byKey[n.level];
      if (!row) return '';
      const st = nodeState(n, ccpMap);
      let x, w;
      if (n.lane === 'MERGE') {
        w = 300; x = mergeX - w / 2;
      } else {
        x = laneX(laneIdx[n.lane]); w = LANE_W;
      }
      const d = (0.3 + idx * 0.02).toFixed(3); idx += 1;
      return `
        <g class="pf-node pf-lv-${st.level}" data-key="${esc(nodeKey(n))}"
           style="--d:${d}s" tabindex="0" role="button" aria-label="${esc(n.no + ' ' + n.name)}">
          <rect class="pf-box" x="${x}" y="${row.y}" width="${w}" height="${NODE_H}" rx="7"></rect>
          <text class="pf-no" x="${x + 11}" y="${row.y + 19}">${esc(n.no)}</text>
          ${(() => {
            const ls = wrap2(n.name, w);
            return ls.length === 1
              ? `<text class="pf-name" x="${x + 11}" y="${row.y + 39}">${esc(ls[0])}</text>`
              : `<text class="pf-name" x="${x + 11}" y="${row.y + 34}">${esc(ls[0])}</text>
                 <text class="pf-name pf-name2" x="${x + 11}" y="${row.y + 48}">${esc(ls[1])}</text>`;
          })()}
          ${(n.ccp || []).length ? `
            <g class="pf-ccpmark" transform="translate(${x + w - 15} ${row.y + 16})">
              <circle class="pf-ccp-pulse" r="10"></circle>
              <circle class="pf-ccp-dot" r="7.5"></circle>
              <text class="pf-ccp-n" y="4">${n.ccp.length}</text>
            </g>` : ''}
          ${st.dev > 0 ? `
            <g class="pf-alarm" transform="translate(${x + w - 15} ${row.y + NODE_H - 14})">
              <circle r="8"></circle><text y="4">!</text>
            </g>` : ''}
        </g>`;
    }).join('');

    return `
      <svg class="pf-svg" viewBox="0 0 ${L.width} ${L.height}" preserveAspectRatio="xMidYMin meet"
           role="img" aria-label="${esc(p.title)}">
        <defs>
          <marker id="pf-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 7 4 L 0 7 z" class="pf-arrowhead"></path>
          </marker>
        </defs>
        ${rail}${pipes}${mergePath}${links}${flow}${markers}${heads}${nodes}
      </svg>`;
  };

  // ============================================================
  // 상세 패널
  // ============================================================
  const limitText = (d) => {
    if (d.limitType === 'pass') return '불검출 / 적합';
    if (d.limitType === 'min') return `${d.clMin}${d.unit} 이상`;
    if (d.limitType === 'max') return `${d.clMax}${d.unit} 이하`;
    const r = [d.clMin, d.clMax].filter(v => v !== null && v !== undefined);
    return r.length ? r.join(' ~ ') : '-';
  };

  const detailHtml = () => {
    const p = plan();
    if (!selected) {
      return `<div class="pf-detail-empty">
        <b>${esc(p.title)}</b>
        <p>${esc(p.subtitle)}</p>
        <p>공정 상자를 누르면 제조설명서의 <b>공정설명·작업기구</b>와
        해당 공정의 <b>CCP 한계기준·오늘 이탈</b>이 여기 나옵니다.</p>
        <div class="pf-legendbox">
          ${p.legend.map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join('')}
        </div>
      </div>`;
    }
    const n = findNode(selected);
    if (!n) return '';
    const lane = p.lanes.find(l => l.key === n.lane);
    const st = nodeState(n, ccpStatusMap());

    return `
      <div class="pf-detail-head">
        <div>
          <div class="pf-detail-no">${esc(n.no)} · ${esc(lane ? `${lane.no} ${lane.title}` : '전 라인 공통')}</div>
          <h3>${esc(n.name)}</h3>
        </div>
        <button class="btn btn-sm" onclick="ProcessFlowPage.select('')" title="닫기">✕</button>
      </div>

      <div class="pf-sec">공정 설명</div>
      <div class="pf-desc">${nl2br(n.desc)}</div>

      <div class="pf-sec">작업기구 및 도구</div>
      <div class="pf-tools">${String(n.tools || '-').split('·').map(t =>
        `<span class="pf-tool">${esc(t.trim())}</span>`).join('')}</div>

      ${st.ccps.length ? `
        <div class="pf-sec">중요관리점 (CCP)</div>
        ${st.ccps.map(c => `
          <div class="pf-ccp-card ${c.deviations ? 'dev' : ''}">
            <div class="pf-ccp-top">
              <strong>${esc(c.def.code)}</strong>
              ${c.deviations ? `<em class="pf-dev">오늘 이탈 ${c.deviations}건</em>` : '<em class="pf-okmark">정상</em>'}
            </div>
            <div class="pf-ccp-name">${esc(c.def.name)}</div>
            <div class="pf-ccp-grid">
              <div><label>관리항목</label><span>${esc(c.def.param)}</span></div>
              <div><label>한계기준</label><span>${esc(limitText(c.def))}</span></div>
              <div><label>모니터링</label><span>${esc(c.def.monitorCycle)}</span></div>
              <div><label>최근 측정</label><span>${c.last
                ? `${esc(c.last.value)}${esc(c.def.unit)} · ${esc(String(c.last.measuredAt || '').slice(0, 10))}`
                : '기록 없음'}</span></div>
            </div>
            <div class="pf-ccp-action"><label>개선조치</label>${esc(c.def.action)}</div>
          </div>`).join('')}
      ` : (n.ccp || []).length ? `
        <div class="pf-sec">중요관리점 (CCP)</div>
        <div class="pf-none">${esc(n.ccp.join(', '))} — 앱에 등록된 CCP 정의가 없습니다. 스마트 HACCP 에서 등록하십시오.</div>
      ` : ''}

      <div class="pf-links">
        ${(n.ccp || []).length ? '<button class="btn btn-sm btn-primary" onclick="App.navigate(\'ccp\')">CCP 모니터링</button>' : ''}
        <button class="btn btn-sm" onclick="App.navigate('haccpHA')">위해요소분석</button>
        <button class="btn btn-sm" onclick="App.navigate('haccpDocs')">기준서·문서</button>
      </div>`;
  };

  // ============================================================
  // 화면
  // ============================================================
  const render = () => {
    const p = plan();
    const ccpMap = ccpStatusMap();
    const ccpNodes = p.nodes.filter(n => (n.ccp || []).length);
    const devTotal = ccpNodes.reduce((a, n) => a + nodeState(n, ccpMap).dev, 0);
    const ccpCodes = [...new Set(ccpNodes.flatMap(n => n.ccp))];

    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">스마트제조</div>
            <h2>제조공정도</h2>
            <p>${esc(p.subtitle)} 공정 상자를 누르면 제조설명서 내용이 나옵니다.</p>
            <div class="pf-docref">근거 DOC-N-230 제조공정도 및 제조설명서 (V25, 2026.01.02) — 번호·공정명·공정설명·작업기구는 원문 그대로입니다.</div>
          </div>
          <div class="module-metrics">
            <div><span>${p.lanes.length}</span><label>원료 라인</label></div>
            <div><span>${p.nodes.length}</span><label>공정 단계</label></div>
            <div><span>${ccpCodes.length}</span><label>중요관리점</label></div>
            <div><span>${devTotal}</span><label>오늘 이탈</label></div>
          </div>
        </div>

        ${devTotal ? `<div class="pf-alert">
          오늘 한계기준 이탈이 <b>${devTotal}건</b> 발생했습니다. 공정도에서 느낌표가 붙은 상자를 확인하십시오.
        </div>` : ''}

        <div class="pf-layout">
          <div class="card pf-canvas">
            <div class="pf-toolbar">
              <div class="pf-tabs">
                ${ProcessFlowData.list.map(f => `
                  <button class="pf-tab ${planKey === f.key ? 'active' : ''}"
                          onclick="ProcessFlowPage.setPlan('${f.key}')">${esc(f.title.replace(' 제조공정도', ''))}</button>`).join('')}
              </div>
              <div class="pf-toolbar-right">
                <div class="pf-legend">
                  <span><i class="ok"></i> 일반</span>
                  <span><i class="ccp"></i> 중요관리점</span>
                  <span><i class="danger"></i> 이탈</span>
                </div>
                <label class="pf-switch">
                  <input type="checkbox" ${flowOn ? 'checked' : ''} onchange="ProcessFlowPage.toggleFlow(this.checked)">
                  흐름
                </label>
                <button class="btn btn-sm" onclick="ProcessFlowPage.replay()">다시 재생</button>
              </div>
            </div>
            <div class="pf-svg-wrap" id="pf-wrap">${svgHtml()}</div>
          </div>

          <aside class="card pf-detail" id="pf-detail">${detailHtml()}</aside>
        </div>
      </div>`;
  };

  // ── 진입 애니메이션 ──
  const runIntro = () => {
    const wrap = document.getElementById('pf-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('.pf-pipe').forEach(pipe => {
      let len = 400;
      try { len = pipe.getTotalLength() || 400; } catch (_) {}
      pipe.style.strokeDasharray = len;
      pipe.style.strokeDashoffset = len;
    });
    void wrap.getBoundingClientRect();   // 리플로우 강제 — 없으면 전환이 처음부터 재생되지 않는다
    wrap.classList.add('pf-play');
  };

  const afterRender = () => {
    runIntro();
    applyFlow();
    const wrap = document.getElementById('pf-wrap');
    if (!wrap) return;
    // 이벤트 위임 — 노드마다 핸들러를 달면 재렌더 때마다 쌓인다
    wrap.addEventListener('click', (e) => {
      const g = e.target.closest('.pf-node');
      if (g) { select(g.dataset.key); return; }
      const h = e.target.closest('.pf-head');
      if (h) selectLane(h.dataset.lane);
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = e.target.closest('.pf-node');
      if (g) { e.preventDefault(); select(g.dataset.key); return; }
      const h = e.target.closest('.pf-head');
      if (h) { e.preventDefault(); selectLane(h.dataset.lane); }
    });
  };

  // ── 이벤트 ──
  //   전체 재렌더는 진입 애니메이션이 매번 처음부터 돌아 눈이 아프다.
  //   선택은 클래스 토글 + 패널 교체로만 처리한다.
  // 고른 공정이 속한 "경로 전체"를 살린다.
  //   가루 공정을 누르면 1-1~1-6 과 합류 뒤 포장·보관·운송까지 한 줄로 켜지고
  //   그 경로에만 점선이 흐른다. 아무것도 고르지 않으면 전 경로가 흐른다.
  const applyFlow = () => {
    const wrap = document.getElementById('pf-wrap');
    if (!wrap) return;
    const all = [...wrap.querySelectorAll('.pf-route')];
    const base = all.filter(r => !r.dataset.spur && !r.dataset.all);
    const spur = all.filter(r => r.dataset.spur);
    const activeIds = new Set();
    const activeKeys = new Set();
    const keysOf = (el) => (el.dataset.nodes || '').split(',').filter(Boolean);

    const allPath = wrap.querySelector('.pf-route-all');
    if (allPath) allPath.classList.toggle('on', flowOn && !selected);

    if (!selected) {
      // 겹치는 구간을 한 번만 그린 '전체 경로'로 대신한다(위 allPath).
    } else {
      base.forEach(r => {
        if (!keysOf(r).includes(selected)) return;
        activeIds.add(r.dataset.route);
        keysOf(r).forEach(k => activeKeys.add(k));
      });
      // 경로에 안 잡히는 짧은 라인(노드 1~2개)은 그 라인을 통째로 살린다
      if (!activeKeys.size) {
        const lane = selected.split('|')[0];
        plan().nodes.filter(n => n.lane === lane).forEach(n => activeKeys.add(nodeKey(n)));
      }
      // 연결선을 타고 하류로 이어간다.
      //   액상 → 진공코팅이면 진공코팅과 그 아래(대포장·보관·운송)까지 함께 켜져야 한다.
      //   사슬로 이어질 수 있으므로 더 켜지지 않을 때까지 반복한다.
      for (let pass = 0; pass < 4; pass++) {
        let grew = false;
        spur.forEach(r => {
          if (activeIds.has(r.dataset.route)) return;
          if (!activeKeys.has(r.dataset.trigger)) return;
          activeIds.add(r.dataset.route);
          keysOf(r).forEach(k => activeKeys.add(k));
          grew = true;
        });
        if (!grew) break;
      }
    }

    all.forEach(r => {
      if (r.dataset.all) return;   // 전체 경로는 위에서 따로 처리
      r.classList.toggle('on', flowOn && activeIds.has(r.dataset.route));
    });

    wrap.querySelectorAll('.pf-link').forEach(l => {
      const on = !selected || activeKeys.has(l.dataset.from);
      l.classList.toggle('on', flowOn && on);
      l.classList.toggle('dim', !!selected && !on);
    });

    wrap.querySelectorAll('.pf-node').forEach(g => {
      const k = g.dataset.key;
      g.classList.toggle('sel', k === selected);
      g.classList.toggle('route', !!selected && activeKeys.has(k));
      g.classList.toggle('dim', !!selected && !activeKeys.has(k));
    });

    // 라인 머리는 "그 라인에서 원료가 출발하는가"로 판단한다.
    //   하류로 이어졌다는 이유만으로 머리를 켜면(예: 향미제를 골랐는데 EXT 머리가 밝음)
    //   머리는 밝은데 그 아래 앞부분 공정은 흐려서 앞뒤가 맞지 않아 보인다.
    const originLanes = new Set();
    if (selected) {
      plan().lanes.forEach(l => {
        const first = plan().nodes.find(n => n.lane === l.key);
        if (first && activeKeys.has(nodeKey(first))) originLanes.add(l.key);
      });
    }
    wrap.querySelectorAll('.pf-head').forEach(h => {
      h.classList.toggle('dim', !!selected && !originLanes.has(h.dataset.lane));
    });
    wrap.querySelectorAll('.pf-pipe').forEach(pp => pp.classList.toggle('dim', !!selected));
  };

  const select = (key) => {
    selected = (!key || selected === key) ? null : key;
    applyFlow();
    const d = document.getElementById('pf-detail');
    if (d) d.innerHTML = detailHtml();
  };

  // 라인 머리 클릭 = 그 라인의 첫 공정을 고른 것으로 본다(= 라인 전체가 켜진다)
  const selectLane = (laneKey) => {
    const first = plan().nodes.find(n => n.lane === laneKey);
    if (first) select(nodeKey(first));
  };

  const setPlan = (k) => {
    if (planKey === k) return;
    planKey = k; selected = null;
    App.refreshPage();
  };

  const toggleFlow = (on) => { flowOn = on; applyFlow(); };

  const replay = () => {
    const wrap = document.getElementById('pf-wrap');
    if (!wrap) return;
    wrap.classList.remove('pf-play');
    void wrap.getBoundingClientRect();
    runIntro();
    applyFlow();
    const svg = wrap.querySelector('svg');
    try { svg.setCurrentTime(0); } catch (_) {}
  };

  return { render, afterRender, select, selectLane, setPlan, toggleFlow, replay };
})();
