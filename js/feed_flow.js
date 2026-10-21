// ============================================================
// feed_flow.js — 사료 빈(사일로) 흐름성 시뮬레이터
//
//   외관 시뮬레이터(feed_appearance.js)가 계산한 미분율·수분·유지·입도를 그대로 받아
//   그 사료를 빈에 넣었을 때 어떻게 흐르는지를 판정한다.
//
//   ── 왜 외관 시뮬레이터에 붙였나 ──
//   흐름성을 좌우하는 값이 전부 외관 계산의 부산물이다.
//   미분율(냉각·PDI), 잔류수분(조질·냉각), 유지 후첨, 입도.
//   조질온도를 내려 미분이 늘면 외관만 나빠지는 게 아니라 빈에서 아칭이 생긴다 —
//   그 인과를 한 화면에서 보게 하는 것이 목적이다.
//
//   ── 모델 근거 ──
//   Jenike 벌크 고체 유동 이론의 단순화 버전이다.
//     · 벽마찰각 → 임계 호퍼 반각 → Mass flow / Funnel flow 판정
//     · 무제한 항복강도(σc) → 아치 최소 배출구경 · 래트홀 직경
//     · Beverloo 식 → 배출 유량
//   전단시험(Jenike shear cell) 실측값이 없으므로 σc 는 미분·수분·유지에서
//   경험식으로 추정한다. 설비 설계 근거로는 쓸 수 없고, 조건 비교·교육용이다.
// ============================================================

const FeedFlow = (() => {

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const D2R = Math.PI / 180;

  // ── 벽면 재질별 벽마찰각(도) ──
  //   같은 사료라도 벽이 무엇이냐로 Mass flow 여부가 갈린다. 라이너 효과를 보려고 넣었다.
  const WALLS = {
    UHMW:     { label: 'UHMW-PE 라이너', phi: 13 },
    SUS_BA:   { label: 'STS304 BA(경면)', phi: 15 },
    SUS_2B:   { label: 'STS304 2B',       phi: 18 },
    EPOXY:    { label: '에폭시 도장',      phi: 21 },
    GALV:     { label: '용융아연도금',     phi: 23 },
    STEEL:    { label: '일반 강판(흑판)',  phi: 26 },
    CONCRETE: { label: '콘크리트',         phi: 31 },
  };

  // ── 호퍼 형식 ──
  //   웨지(슬롯)형이 원추형보다 훨씬 관대하다. 같은 사료로 아칭이 나면 형식부터 본다.
  const BINS = {
    CONE:  { label: '원추 호퍼 (원형 배출구)', slot: false },
    WEDGE: { label: '웨지 호퍼 (슬롯 배출구)', slot: true },
  };

  const DEFAULTS = {
    wall: 'STEEL',
    bin: 'CONE',
    binDia: 3000,      // 동체 직경 (mm)
    binHeight: 6000,   // 동체 높이 (mm)
    halfAngle: 30,     // 호퍼 반각 — 수직에서 벌어진 각 (deg)
    outlet: 250,       // 배출구 직경(원추) / 슬롯 폭(웨지) (mm)
    storeDays: 3,      // 저장 일수
    aeration: false,   // 에어레이션·바이브레이터 사용
  };

  // 성상별 기준값 — 벌크밀도(kg/m³)와 안식각(도)
  const FORM_BASE = {
    pellet:  { rho: 640, repose: 29 },
    crumble: { rho: 590, repose: 36 },
    mash:    { rho: 550, repose: 40 },
    ep:      { rho: 340, repose: 27 },
  };

  // ============================================================
  // 모델
  // ============================================================
  const calc = (a, st) => {
    const base = FORM_BASE[a.form] || FORM_BASE.pellet;
    const isMash = !!a.isMash;

    // 배출 계산용 유효 입경 / 맞물림 아치용 최대 치수
    const dEff = isMash ? a.diaMm : Math.max(a.diaMm, a.lenMm * 0.6);
    const dMax = isMash ? a.diaMm * 3 : Math.max(a.diaMm, a.lenMm);

    const coolOk = clamp((st.cool - 3) / 12, 0, 1);
    const coolShort = 1 - coolOk;
    const aged = clamp(st.storeDays / 60, 0, 1);

    // ── 저장 수분 환산 ──
    //   외관 탭의 수분은 컨디셔너(조질) 기준이다. 빈에 들어가는 것은 냉각·건조를 거친
    //   제품이므로 그대로 쓰면 항상 과하게 젖은 것으로 계산된다.
    //   매쉬는 조질 공정이 없어 원료 수분대로 보고, EP 는 건조 폭이 훨씬 크다.
    const storeMoist = isMash ? 12.5
      : a.form === 'ep' ? clamp(st.moist - (10 + 6 * coolOk), 6, 14)
      : clamp(st.moist - (0.8 + 2.2 * coolOk), 9, 18);
    const wetTerm = Math.max(0, storeMoist - 12.5) / 6 * 0.45;

    // ── 미분 기여 ──
    //   매쉬는 a.fines 가 100(전량 분체)이라 그대로 쓰면 응집성이 최대로 튄다.
    //   매쉬의 흐름성은 미분율이 아니라 입도(Dgw)가 결정한다.
    const finesTerm = isMash
      ? clamp((0.9 - a.diaMm) / 0.7, 0, 1) * 0.55
      : (a.fines / 100) * 1.10;

    // ── 응집성 지수 C ──
    //   흐름을 막는 힘. 미분과 유지가 지배적이다.
    //   현장에서 "펠릿은 잘 나오는데 미분 많은 로트만 막힌다"는 말이 이 항이다.
    const C = clamp(
        finesTerm
      + wetTerm
      + a.totalFat * 1.60
      + coolShort * 0.22
      + aged * 0.28
      + (isMash ? 0.16 : 0)
      - (a.form === 'ep' ? 0.06 : 0),
      0.02, 1.4);

    // 무제한 항복강도(kPa) — 아치를 지탱하는 강도. 전단시험 대신 C 로 추정한다.
    //   선형으로 두면 자유유동 펠릿에도 1 kPa 대가 나와 없는 아칭을 경고한다.
    //   실제 벌크 고체의 항복강도는 응집이 임계를 넘을 때 급격히 올라가므로 지수로 잡는다.
    const sigmaC = 4.5 * Math.pow(C, 2.2);

    // 벌크밀도 — 미분이 공극을 채우고 유지가 다져 약간 올라간다
    const rho = base.rho * (1 + (isMash ? 0 : a.fines / 100 * 0.10)
      + Math.max(0, storeMoist - 12.5) * 0.004 + a.totalFat * 0.30);

    // 안식각
    const repose = clamp(
      base.repose + (isMash ? finesTerm * 14 : a.fines * 0.35)
      + Math.max(0, storeMoist - 12.5) * 1.1
      + a.rough * 7 - a.gloss * 3 + aged * 3, 22, 55);

    const phiI = clamp(repose + 2 + C * 6, 25, 55);   // 내부마찰각
    const phiW = clamp((WALLS[st.wall] || WALLS.STEEL).phi
      + Math.max(0, storeMoist - 12.5) * 0.9 + a.totalFat * 22 + aged * 2, 8, 40);  // 벽마찰각

    // ── Mass flow 판정 ──
    //   벽마찰이 크면 임계 반각이 작아진다(호퍼가 더 급해야 한다).
    const critCone = clamp(40 - 0.78 * phiW, 5, 38);
    const critAngle = BINS[st.bin].slot ? critCone + 10 : critCone;
    const massFlow = st.halfAngle <= critAngle;

    // ── 최소 배출구경 ──
    //   응집 아치와 알갱이 맞물림 아치 중 큰 쪽이 지배한다.
    const H = BINS[st.bin].slot ? 1.15 : 2.2;
    const archCohesive = H * sigmaC * 1000 / (rho * 9.81) * 1000;    // mm
    const archInterlock = isMash ? 0 : 8 * dMax;                     // mm
    const archFloor = isMash ? 150 : 0;                              // 분체 경험 하한
    const Bmin = Math.max(archCohesive, archInterlock, archFloor);
    const arching = st.outlet < Bmin;

    // ── 래트홀 ──
    //   Funnel flow 에서만 생긴다. 중심만 빠지고 벽면은 그대로 남는다.
    //   판정 기준은 배출구가 아니라 유동 채널이다. 안정 구멍 직경이 채널보다 커야
    //   구멍이 무너지지 않고 남는다. 배출구 기준으로만 보면 정상 배출에도 경고가 뜬다.
    const ratDia = 6.0 * sigmaC * 1000 / (rho * 9.81) * 1000;        // mm
    const channelDia = Math.max(st.outlet * 1.5, st.binDia * 0.33);
    //   아칭이면 애초에 배출이 없으니 래트홀은 생기지 않고,
    //   안정 구멍이 빈 직경보다 크면 그건 래트홀이 아니라 전체 정체다.
    const ratholing = !massFlow && !arching && ratDia > channelDia && ratDia < st.binDia;
    const stagnant = !massFlow && !arching && ratDia >= st.binDia;   // 빈 전체가 안 움직임

    // ── 잔류율 ──
    const over = Math.max(0, st.halfAngle - critAngle);
    const residual = massFlow ? clamp(C * 2.5, 0, 3)
      : clamp(6 + over * 0.85 + C * 22, 4, 48);

    // ── 배출 유량 (Beverloo) ──
    const Dm = st.outlet / 1000, dm = dEff / 1000;
    const eff = Math.max(0, Dm - 1.4 * dm);
    const slotLen = BINS[st.bin].slot ? Math.max(st.outlet * 3, 600) / 1000 : 0;
    const wRaw = BINS[st.bin].slot
      ? 0.58 * rho * Math.sqrt(9.81) * slotLen * Math.pow(eff, 1.5)
      : 0.58 * rho * Math.sqrt(9.81) * Math.pow(eff, 2.5);
    const flowFactor = (massFlow ? 1 : 0.62) * clamp(1 - C * 0.55, 0.15, 1) * (st.aeration ? 1.15 : 1);
    const kgs = arching ? 0 : wRaw * flowFactor;
    const tph = kgs * 3.6;

    // ── 편석 ──
    //   Funnel flow 는 선입후출이라 미분이 중심에 몰리고 배출 말미에 한꺼번에 나온다.
    const segregation = clamp((massFlow ? 12 : 45) + a.fines * 1.6 + (isMash ? 12 : 0) - (st.aeration ? 5 : 0), 5, 95);

    // ── 고착·브리징 ──
    const caking = clamp(C * 62 + coolShort * 12 + aged * 18, 3, 98);

    // ── 종합 유동지수 (높을수록 잘 흐름) ──
    const FI = clamp(100 - (repose - 25) * 1.7 - C * 46 - (massFlow ? 0 : 12) - (arching ? 25 : 0), 0, 100);
    const grade = FI >= 75 ? { k: 'GOOD', label: '양호', cls: 'ok' }
      : FI >= 55 ? { k: 'FAIR', label: '보통', cls: '' }
      : FI >= 35 ? { k: 'POOR', label: '불량', cls: 'bad' }
      : { k: 'VBAD', label: '매우 불량', cls: 'bad' };

    // ── 빈 용적·저장량 ──
    const rBin = st.binDia / 2000, rOut = st.outlet / 2000;
    const hHop = (rBin - rOut) / Math.tan(st.halfAngle * D2R);
    const volCyl = Math.PI * rBin * rBin * (st.binHeight / 1000);
    const volHop = Math.PI / 3 * hHop * (rBin * rBin + rBin * rOut + rOut * rOut);
    const capacity = (volCyl + volHop) * rho / 1000;   // ton

    return {
      a, st, isMash, dEff, dMax, C, sigmaC, rho, repose, phiI, phiW,
      critAngle, critCone, massFlow, Bmin, archCohesive, archInterlock, arching,
      ratDia, ratholing, stagnant, residual, kgs, tph, segregation, caking, FI, grade,
      hHopM: hHop, capacity, coolShort, coolOk, aged, storeMoist,
    };
  };

  // ============================================================
  // 캔버스 준비 — DPR 보정. 안 하면 고해상도 화면에서 선이 뭉갠다.
  // ============================================================
  const prepCanvas = (canvas) => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.width;
    const h = Number(canvas.dataset.h) || 300;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  };

  const css = (rgb, alpha) => `rgba(${Math.round(clamp(rgb[0], 0, 255))},${Math.round(clamp(rgb[1], 0, 255))},${Math.round(clamp(rgb[2], 0, 255))},${alpha ?? 1})`;
  const shade = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

  const rng = (seed) => {
    let x = seed >>> 0;
    return () => {
      x = (x + 0x6D2B79F5) >>> 0;
      let t = Math.imul(x ^ (x >>> 15), 1 | x);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const arrow = (ctx, x, y, len, color, width) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width || 1.4;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + len - 5); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x - 3.4, y + len - 6); ctx.lineTo(x + 3.4, y + len - 6);
    ctx.closePath(); ctx.fill();
  };

  // 사각/영역 해칭 — 잔류(dead zone) 표시
  const hatch = (ctx, path, color) => {
    ctx.save(); ctx.clip(path);
    const b = 2000;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    for (let i = -b; i < b; i += 7) {
      ctx.beginPath(); ctx.moveTo(i, -b); ctx.lineTo(i + b * 2, b * 2 - 0); ctx.stroke();
    }
    ctx.restore();
  };

  // ============================================================
  // 빈 단면도
  // ============================================================
  const renderBin = (canvas, f) => {
    const { ctx, w, h } = prepCanvas(canvas);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    if (!f.a.b.ok) {
      ctx.fillStyle = '#5C5E62'; ctx.font = '13px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('배합비를 입력하면 흐름 패턴이 그려집니다', w / 2, h / 2);
      return;
    }

    const st = f.st;
    const rand = rng(20260814);

    // ── 실제 치수 → 화면 스케일 ──
    const totalHmm = st.binHeight + f.hHopM * 1000;
    // 실제 사일로는 세로로 길다. 호퍼 각도를 눈으로 읽어야 하므로 가로·세로를 같은 배율로 둔다
    // (한쪽만 줄이면 30° 호퍼가 45° 처럼 보인다). 대신 여백을 줄여 최대한 크게 그린다.
    const padTop = 22, padBot = 42, padSide = 60;
    const scale = Math.min((w - padSide * 2) / st.binDia, (h - padTop - padBot) / totalHmm);
    const cx = w / 2;
    const topY = padTop;
    const cylH = st.binHeight * scale;
    const hopH = f.hHopM * 1000 * scale;
    const rBin = st.binDia / 2 * scale;
    const rOut = st.outlet / 2 * scale;
    const cylBot = topY + cylH;
    const outY = cylBot + hopH;

    // 빈 내부 경로 (동체 + 호퍼)
    const inner = new Path2D();
    inner.moveTo(cx - rBin, topY);
    inner.lineTo(cx - rBin, cylBot);
    inner.lineTo(cx - rOut, outY);
    inner.lineTo(cx + rOut, outY);
    inner.lineTo(cx + rBin, cylBot);
    inner.lineTo(cx + rBin, topY);
    inner.closePath();

    // 사료 충전 — 외관 시뮬레이터가 계산한 실제 색을 쓴다
    const g = ctx.createLinearGradient(cx - rBin, 0, cx + rBin, 0);
    g.addColorStop(0, css(shade(f.a.rgb, 0.78)));
    g.addColorStop(0.42, css(f.a.rgb));
    g.addColorStop(1, css(shade(f.a.rgb, 0.70)));
    ctx.fillStyle = g; ctx.fill(inner);

    // 알갱이 질감
    ctx.save(); ctx.clip(inner);
    const grains = 900;
    for (let i = 0; i < grains; i++) {
      const px = cx - rBin + rand() * rBin * 2, py = topY + rand() * (cylH + hopH);
      ctx.fillStyle = css(shade(f.a.rgb, rand() > 0.5 ? 1.18 : 0.74), 0.30);
      ctx.beginPath(); ctx.arc(px, py, 0.7 + rand() * 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // ── 흐름 패턴 ──
    const ACC = '#3E6AE1', DANGER = '#c0392b', DEAD = 'rgba(23,26,32,0.13)';

    if (f.massFlow) {
      // 전면 유동 — 수평 층이 그대로 내려온다
      ctx.save(); ctx.clip(inner);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
      for (let y = topY + 22; y < cylBot; y += 26) {
        ctx.beginPath(); ctx.moveTo(cx - rBin + 3, y); ctx.lineTo(cx + rBin - 3, y); ctx.stroke();
      }
      ctx.restore();
      const n = 5;
      for (let i = 0; i < n; i++) {
        const px = cx - rBin * 0.72 + (rBin * 1.44) * i / (n - 1);
        arrow(ctx, px, topY + 34, Math.min(64, cylH * 0.5), ACC, 1.6);
      }
    } else {
      // 깔때기 유동 — 중심 채널만 흐르고 벽면은 죽는다.
      // 채널은 재료 표면까지 올라온다(빈이 차 있으면 표면에 깔때기가 생긴다).
      const chW = Math.max(rOut * 1.5, rBin * 0.33);
      const channel = new Path2D();
      channel.moveTo(cx - chW, topY);
      channel.lineTo(cx - rOut, outY);
      channel.lineTo(cx + rOut, outY);
      channel.lineTo(cx + chW, topY);
      channel.closePath();

      // 잔류 영역 = 빈 내부에서 채널을 뺀 부분.
      // even-odd 규칙으로 클립하면 채널만 정확히 빠진다(다시 칠하는 편법이 필요 없다).
      const deadZone = new Path2D();
      deadZone.addPath(inner);
      deadZone.addPath(channel);
      ctx.save();
      ctx.clip(deadZone, 'evenodd');
      ctx.fillStyle = 'rgba(23,26,32,0.10)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(23,26,32,0.22)'; ctx.lineWidth = 1;
      for (let i = -h; i < w + h; i += 8) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = ACC; ctx.lineWidth = 1.3; ctx.setLineDash([5, 4]);
      ctx.stroke(channel); ctx.setLineDash([]);
      arrow(ctx, cx, topY + 20, Math.min(74, (outY - topY) * 0.34), ACC, 1.8);

      // 잔류 라벨
      ctx.fillStyle = '#393C41'; ctx.font = '600 10.5px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
      const labY = topY + cylH * 0.62;
      ctx.fillText('잔류', cx - (rBin + chW) / 2, labY);
      ctx.fillText('잔류', cx + (rBin + chW) / 2, labY);

      // 래트홀 — 중심이 관통해 구멍이 남고 벽면 사료는 그대로 붙어 있다
      if (f.ratholing) {
        const rr = Math.min(f.ratDia / 2 * scale, rBin * 0.88);
        const hole = new Path2D();
        hole.moveTo(cx - rr, topY);
        hole.lineTo(cx - rOut, outY);
        hole.lineTo(cx + rOut, outY);
        hole.lineTo(cx + rr, topY);
        hole.closePath();
        ctx.fillStyle = '#ffffff'; ctx.fill(hole);
        ctx.strokeStyle = DANGER; ctx.lineWidth = 1.6; ctx.setLineDash([5, 3]);
        ctx.stroke(hole); ctx.setLineDash([]);
        ctx.fillStyle = DANGER; ctx.font = '600 11px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`래트홀 Ø${Math.round(f.ratDia)}mm`, cx, topY + 14);
        ctx.font = '10px "Noto Sans KR", sans-serif';
        ctx.fillText('중심만 빠지고 벽면은 남습니다', cx, topY + 28);
      }
    }

    // ── 아칭 ──
    //   배출구가 작으면 아치가 화면에서도 작아져 눈에 안 띈다. 최소 크기를 보장한다.
    if (f.arching) {
      const aw = Math.max(rOut * 2.0, 26);
      const ah = Math.max(rOut * 2.2, 30);
      ctx.beginPath();
      ctx.moveTo(cx - aw, outY - 1);
      ctx.quadraticCurveTo(cx, outY - ah * 2, cx + aw, outY - 1);
      ctx.closePath();
      ctx.fillStyle = 'rgba(192,57,43,0.22)'; ctx.fill();
      ctx.strokeStyle = DANGER; ctx.lineWidth = 3; ctx.stroke();
      // 배출구를 막고 있다는 것을 알리는 정지 표시
      ctx.strokeStyle = DANGER; ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(cx - 7, outY + 12); ctx.lineTo(cx + 7, outY + 26);
      ctx.moveTo(cx + 7, outY + 12); ctx.lineTo(cx - 7, outY + 26);
      ctx.stroke();
    }

    // 빈 외곽선
    ctx.strokeStyle = '#171A20'; ctx.lineWidth = 2; ctx.stroke(inner);

    // 배출구 개구부 — 아칭이 아니면 빠져나가는 사료를 그린다
    if (!f.arching) {
      ctx.fillStyle = css(f.a.rgb, 0.9);
      ctx.beginPath();
      ctx.moveTo(cx - rOut * 0.8, outY);
      ctx.quadraticCurveTo(cx, outY + 26, cx + rOut * 0.8, outY);
      ctx.closePath(); ctx.fill();
      arrow(ctx, cx, outY + 8, 24, '#171A20', 1.4);
    }

    // ── 치수·각도 주기 ──
    // 알갱이 질감 위에 글자가 얹히면 안 읽힌다. 흰 테두리를 깔고 쓴다.
    const tag = (text, x, y, align, color, font) => {
      ctx.font = font || '10px "JetBrains Mono", monospace';
      ctx.textAlign = align || 'left';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color || '#5C5E62';
      ctx.fillText(text, x, y);
    };

    ctx.strokeStyle = '#5C5E62'; ctx.lineWidth = 1;

    // 호퍼 반각 — 수직 기준선 + 호
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx - rBin, cylBot); ctx.lineTo(cx - rBin, cylBot + hopH + 8); ctx.stroke();
    ctx.setLineDash([]);
    const arcR = Math.min(34, hopH * 0.55);
    ctx.strokeStyle = '#3E6AE1'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx - rBin, cylBot, arcR, Math.PI / 2 - Math.atan2(rBin - rOut, hopH), Math.PI / 2);
    ctx.stroke();
    tag(`${st.halfAngle}°`, cx - rBin + 7, cylBot + arcR + 2, 'left', '#3E6AE1', '600 11px "JetBrains Mono", monospace');

    // 동체 직경
    ctx.strokeStyle = '#5C5E62'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - rBin, topY - 8); ctx.lineTo(cx + rBin, topY - 8); ctx.stroke();
    tag(`Ø${st.binDia}`, cx, topY - 12, 'center');

    // 배출구
    ctx.beginPath(); ctx.moveTo(cx + rOut + 4, outY); ctx.lineTo(cx + rOut + 30, outY); ctx.stroke();
    tag(`${BINS[st.bin].slot ? '슬롯폭 ' : 'Ø'}${st.outlet}`, cx + rOut + 34, outY + 3, 'left');

    // 패턴 라벨 — 왼쪽 아래
    tag(f.massFlow ? '전면 유동 (Mass Flow)' : '깔때기 유동 (Funnel Flow)', 10, h - 22, 'left',
      f.massFlow ? '#1f7a4d' : '#9a6a00', '600 12px "Noto Sans KR", sans-serif');
    tag(`임계 반각 ${f.critAngle.toFixed(0)}° · 현재 ${st.halfAngle}° · 벽마찰각 ${f.phiW.toFixed(0)}°`,
      10, h - 8, 'left', '#5C5E62', '10.5px "Noto Sans KR", sans-serif');

    // 아칭 경고 — 오른쪽 아래. 패턴 라벨과 겹치지 않고 캔버스를 벗어나지도 않는다.
    if (f.arching) {
      tag('아칭 — 배출 정지', w - 10, h - 22, 'right', DANGER, '600 12px "Noto Sans KR", sans-serif');
      tag(`필요 최소 구경 ${Math.round(f.Bmin)}mm (현재 ${st.outlet}mm)`,
        w - 10, h - 8, 'right', DANGER, '10.5px "Noto Sans KR", sans-serif');
    }
  };

  // ============================================================
  // 안식각 — 쏟았을 때 쌓이는 모양
  // ============================================================
  const renderRepose = (canvas, f) => {
    const { ctx, w, h } = prepCanvas(canvas);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    if (!f.a.b.ok) return;
    const rand = rng(555);

    const baseY = h - 26;
    const halfW = Math.min(w * 0.30, (baseY - 44) / Math.tan(f.repose * D2R));
    const peakH = halfW * Math.tan(f.repose * D2R);
    const cx = w / 2, peakY = baseY - peakH;

    // 바닥
    ctx.strokeStyle = '#171A20'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(12, baseY); ctx.lineTo(w - 12, baseY); ctx.stroke();

    // 더미 — 실제 안식각으로 그린다
    const pile = new Path2D();
    pile.moveTo(cx - halfW, baseY);
    // 응집성이 크면 사면이 곧지 않고 부풀어 오른다(무너지지 않고 버틴다)
    const bulge = f.C * 0.22;
    pile.quadraticCurveTo(cx - halfW * (0.5 - bulge), peakY + peakH * (0.5 - bulge), cx, peakY);
    pile.quadraticCurveTo(cx + halfW * (0.5 - bulge), peakY + peakH * (0.5 - bulge), cx + halfW, baseY);
    pile.closePath();

    const g = ctx.createLinearGradient(cx - halfW, peakY, cx + halfW, baseY);
    g.addColorStop(0, css(shade(f.a.rgb, 1.14)));
    g.addColorStop(1, css(shade(f.a.rgb, 0.72)));
    ctx.fillStyle = g; ctx.fill(pile);

    ctx.save(); ctx.clip(pile);
    for (let i = 0; i < 700; i++) {
      const px = cx - halfW + rand() * halfW * 2, py = peakY + rand() * peakH;
      ctx.fillStyle = css(shade(f.a.rgb, rand() > 0.5 ? 1.2 : 0.72), 0.32);
      ctx.beginPath(); ctx.arc(px, py, 0.6 + rand() * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = css(shade(f.a.rgb, 0.5), 0.6); ctx.lineWidth = 1; ctx.stroke(pile);

    // 각도 표기
    ctx.strokeStyle = '#3E6AE1'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx - halfW, baseY); ctx.lineTo(cx, peakY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx - halfW, baseY, 34, -f.repose * D2R, 0); ctx.stroke();
    ctx.fillStyle = '#3E6AE1'; ctx.font = '600 12px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${f.repose.toFixed(1)}°`, cx - halfW + 40, baseY - 8);

    ctx.fillStyle = '#5C5E62'; ctx.font = '10.5px "Noto Sans KR", sans-serif';
    ctx.fillText('안식각 — 작을수록 잘 퍼지고 잘 흐른다', 12, 18);
  };

  // ============================================================
  // 컨트롤 · 지표 · 진단
  // ============================================================
  const slider = (key, label, min, max, step, unit, hint, value) => `
    <div class="fa-ctl">
      <div class="fa-ctl-head">
        <label>${label}</label>
        <span class="fa-ctl-val" id="fa-val-${key}">${value}${unit}</span>
      </div>
      <input type="range" id="fa-${key}" min="${min}" max="${max}" step="${step}" value="${value}"
             oninput="FeedAppearancePage.onSlide('${key}', this.value, '${unit}')">
      ${hint ? `<div class="fa-ctl-hint">${hint}</div>` : ''}
    </div>`;

  const controls = (st) => `
    <div class="fa-ctl">
      <div class="fa-ctl-head"><label>호퍼 형식</label></div>
      <select class="form-input" onchange="FeedAppearancePage.onFlowSelect('bin', this.value)">
        ${Object.entries(BINS).map(([k, v]) => `<option value="${k}" ${st.bin === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
      <div class="fa-ctl-hint">웨지(슬롯)형은 원추형보다 임계 반각이 약 10° 관대합니다.</div>
    </div>
    <div class="fa-ctl">
      <div class="fa-ctl-head"><label>벽면 재질</label></div>
      <select class="form-input" onchange="FeedAppearancePage.onFlowSelect('wall', this.value)">
        ${Object.entries(WALLS).map(([k, v]) => `<option value="${k}" ${st.wall === k ? 'selected' : ''}>${v.label} (${v.phi}°)</option>`).join('')}
      </select>
      <div class="fa-ctl-hint">벽마찰각이 낮을수록 전면 유동이 쉬워집니다.</div>
    </div>
    ${slider('halfAngle', '호퍼 반각', 5, 60, 1, ' °', '수직에서 벌어진 각. 작을수록(급할수록) 전면 유동에 유리', st.halfAngle)}
    ${slider('outlet', BINS[st.bin].slot ? '슬롯 폭' : '배출구 직경', 50, 800, 10, ' mm', '아칭을 막는 가장 확실한 수단', st.outlet)}
    ${slider('binDia', '동체 직경', 1000, 8000, 100, ' mm', '', st.binDia)}
    ${slider('binHeight', '동체 높이', 1000, 15000, 100, ' mm', '', st.binHeight)}
    ${slider('storeDays', '저장 기간', 0, 60, 1, ' 일', '길수록 시간 경화(caking)로 흐름이 나빠집니다', st.storeDays)}
    <div class="fa-ctl">
      <label class="fa-check">
        <input type="checkbox" ${st.aeration ? 'checked' : ''} onchange="FeedAppearancePage.onFlowToggle('aeration', this.checked)">
        에어레이션 · 바이브레이터 사용
      </label>
    </div>`;

  const gauge = (label, value, pct, tone, note) => `
    <div class="fa-gauge">
      <div class="fa-gauge-top"><span>${label}</span><strong>${value}</strong></div>
      <div class="fa-gauge-bar"><i class="${tone || ''}" style="width:${clamp(pct, 0, 100).toFixed(1)}%"></i></div>
      ${note ? `<div class="fa-ctl-hint">${note}</div>` : ''}
    </div>`;

  const metrics = (f) => {
    if (!f.a.b.ok) return '<div class="text-sm text-muted">배합 입력 대기</div>';
    const st = f.st;
    return `
      <div class="ff-verdict ${f.grade.cls}">
        <div>
          <label>종합 유동성</label>
          <strong>${f.FI.toFixed(0)}<em>/100</em></strong>
          <span>${f.grade.label}</span>
        </div>
        <div class="ff-pattern ${f.massFlow ? 'ok' : 'warn'}">
          ${f.massFlow ? '전면 유동' : '깔때기 유동'}
        </div>
      </div>

      ${f.arching ? `<div class="ff-alert bad">
        <strong>아칭 발생 조건입니다.</strong>
        배출구 ${st.outlet}mm 는 필요 최소 ${Math.round(f.Bmin)}mm 보다 작습니다 — 배출이 멈춥니다.
        ${f.archInterlock > f.archCohesive
          ? `지배 원인은 <b>알갱이 맞물림</b>(최대 치수 ${f.dMax.toFixed(1)}mm × 8)입니다.`
          : `지배 원인은 <b>응집(미분·수분·유지)</b>입니다.`}
      </div>` : ''}
      ${f.ratholing ? `<div class="ff-alert warn">
        <strong>래트홀 위험.</strong> 중심 Ø${Math.round(f.ratDia)}mm 만 빠지고 벽면은 남을 수 있습니다.
      </div>` : ''}
      ${f.stagnant ? `<div class="ff-alert bad">
        <strong>전체 정체 위험.</strong> 안정 구멍 직경(Ø${Math.round(f.ratDia)}mm)이 빈 직경보다 큽니다 —
        배출을 시작해도 사료가 통째로 서 있을 수 있습니다.
      </div>` : ''}

      ${gauge('안식각', f.repose.toFixed(1) + ' °', (f.repose - 20) / 35 * 100, f.repose <= 32 ? 'ok' : f.repose >= 42 ? 'bad' : '',
        '30° 이하 자유유동 · 40° 이상 흐름 불량')}
      ${gauge('응집성 지수', f.C.toFixed(2), f.C / 1.4 * 100, f.C <= 0.35 ? 'ok' : f.C >= 0.8 ? 'bad' : '',
        `추정 항복강도 ${f.sigmaC.toFixed(2)} kPa`)}
      ${gauge('벽마찰각', f.phiW.toFixed(0) + ' °', f.phiW / 40 * 100, f.phiW <= 20 ? 'ok' : f.phiW >= 30 ? 'bad' : '',
        `임계 반각 ${f.critAngle.toFixed(0)}° · 현재 ${st.halfAngle}°`)}
      ${gauge('잔류율', f.residual.toFixed(1) + ' %', f.residual / 48 * 100, f.residual <= 5 ? 'ok' : f.residual >= 20 ? 'bad' : '',
        f.massFlow ? '전면 유동이라 선입선출이 유지됩니다' : '벽면 정체 — 선입후출·묵은 사료 잔류')}
      ${gauge('편석 위험', f.segregation.toFixed(0) + ' %', f.segregation, f.segregation <= 25 ? 'ok' : f.segregation >= 55 ? 'bad' : '',
        '미분이 몰려 배출 말미 성분이 달라질 위험')}
      ${gauge('고착 위험', f.caking.toFixed(0) + ' %', f.caking, f.caking <= 25 ? 'ok' : f.caking >= 55 ? 'bad' : '',
        `저장 ${st.storeDays}일 기준`)}

      <div class="fa-dims">
        <div><label>최소 배출구경</label><span>${Math.round(f.Bmin)} mm</span></div>
        <div><label>배출 유량</label><span>${f.arching ? '0' : f.tph.toFixed(0)} t/h</span></div>
        <div><label>벌크밀도</label><span>${Math.round(f.rho)} kg/m³</span></div>
        <div><label>빈 저장량</label><span>${f.capacity.toFixed(1)} t</span></div>
        <div><label>내부마찰각</label><span>${f.phiI.toFixed(0)} °</span></div>
        <div><label>호퍼 높이</label><span>${(f.hHopM * 1000).toFixed(0)} mm</span></div>
      </div>`;
  };

  // ── 개선 제안 ──
  //   지표만 보여주면 "그래서 뭘 하라는 거냐"가 된다. 조치를 순서대로 뽑아준다.
  const advice = (f) => {
    if (!f.a.b.ok) return '';
    const st = f.st, out = [];

    if (f.arching) {
      out.push({ t: 'bad', h: `배출구를 ${Math.ceil(f.Bmin / 10) * 10}mm 이상으로 확대`,
        d: f.archInterlock > f.archCohesive
          ? `알갱이 맞물림 아치가 지배합니다. 최대 치수(${f.dMax.toFixed(1)}mm)의 8배가 기준입니다. 다이 직경을 줄여 알갱이를 작게 만드는 것도 같은 효과입니다.`
          : `응집 아치가 지배합니다. 구경 확대와 함께 아래 미분·수분·유지 항목을 같이 잡아야 재발하지 않습니다.` });
    }
    if (!f.massFlow) {
      out.push({ t: 'warn', h: `호퍼 반각을 ${Math.floor(f.critAngle)}° 이하로 (현재 ${st.halfAngle}°)`,
        d: `지금은 깔때기 유동입니다. 반각을 줄이거나, 벽마찰각이 낮은 라이너로 임계 반각을 키우십시오.` });
      if (st.wall !== 'UHMW') {
        const better = st.bin === 'WEDGE' ? 'SUS_2B' : 'UHMW';
        out.push({ t: 'info', h: `벽면에 ${WALLS[better].label} 적용 검토`,
          d: `벽마찰각이 ${f.phiW.toFixed(0)}° → 약 ${WALLS[better].phi}°로 내려가면 임계 반각이 ${(40 - 0.78 * WALLS[better].phi + (BINS[st.bin].slot ? 10 : 0)).toFixed(0)}°까지 올라갑니다.` });
      }
      if (st.bin === 'CONE') {
        out.push({ t: 'info', h: '웨지(슬롯) 호퍼로 변경 검토',
          d: '같은 사료·같은 반각에서 임계 반각이 약 10° 관대해지고, 아치 최소 구경도 절반 수준으로 내려갑니다.' });
      }
    }
    if (f.a.fines > 6) {
      out.push({ t: 'warn', h: `미분율 저감 (현재 ${f.a.fines.toFixed(1)}%)`,
        d: `응집성의 가장 큰 항입니다. 외관 탭에서 조질온도·리텐션을 올리고 냉각시간을 확보하면 PDI가 오르며 미분이 줄어듭니다.` });
    }
    if (f.storeMoist > 13.5 && !f.isMash) {
      out.push({ t: 'warn', h: `제품 수분 ${f.storeMoist.toFixed(1)}% → 13% 이하로`,
        d: `조질 수분 ${st.moist}%에서 냉각 ${st.cool}분을 거친 환산값입니다. 잔류 수분은 벽마찰각과 시간 경화를 동시에 키웁니다. 냉각을 늘리거나 조질 수분을 먼저 낮추십시오.` });
    }
    if (f.a.totalFat > 0.05) {
      out.push({ t: 'warn', h: `총 유지 ${(f.a.totalFat * 100).toFixed(1)}% — 후첨 위치 재검토`,
        d: '유지가 표면에 있으면 알갱이끼리 점착하고 벽에도 붙습니다. 빈 앞이 아니라 빈 이후(출하 직전) 코팅으로 옮기면 흐름성을 지킬 수 있습니다.' });
    }
    if (f.coolShort > 0.4) {
      out.push({ t: 'warn', h: `냉각 시간 확보 (현재 ${st.cool}분)`,
        d: '덜 식은 사료를 빈에 넣으면 상부에서 결로가 생겨 벽면에 고착됩니다.' });
    }
    if (st.storeDays > 14 && f.caking > 40) {
      out.push({ t: 'info', h: `저장 기간 단축 (현재 ${st.storeDays}일)`,
        d: '시간 경화가 진행되는 구간입니다. 재고 회전을 올리거나 정기 배출로 다져짐을 풀어주십시오.' });
    }
    if (f.residual > 15) {
      out.push({ t: 'info', h: `잔류 ${f.residual.toFixed(0)}% — 선입선출이 깨집니다`,
        d: '벽면에 묵은 사료가 남아 유통기한·품질 추적이 흐트러집니다. 정기 완전배출(빈 비우기) 주기를 정해두십시오.' });
    }
    if (!st.aeration && f.FI < 55) {
      out.push({ t: 'info', h: '에어레이션·바이브레이터 보조 검토',
        d: '근본 대책은 아니지만 배출 재개에는 효과가 있습니다. 다만 진동은 오히려 더 다져질 수 있어 공기 주입이 낫습니다.' });
    }

    if (!out.length) {
      out.push({ t: 'ok', h: '현재 조건에서 흐름 문제는 예상되지 않습니다',
        d: `전면 유동이며 배출구가 최소 구경(${Math.round(f.Bmin)}mm)을 넘습니다. 미분율·수분·유지를 지금 수준으로 유지하십시오.` });
    }

    return `<div class="ff-advice">${out.map((o, i) => `
      <div class="ff-advice-row ${o.t}">
        <span class="ff-advice-no">${i + 1}</span>
        <div><strong>${o.h}</strong><p>${o.d}</p></div>
      </div>`).join('')}</div>`;
  };

  return { WALLS, BINS, DEFAULTS, calc, renderBin, renderRepose, controls, metrics, advice };
})();
