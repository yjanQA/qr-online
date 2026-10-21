// ============================================================
// feed_appearance.js — 사료 외관 시뮬레이터
//
//   배합비(원료 구성비) + 공정조건 → 완제품 외관을 캔버스로 그린다.
//   성상 4종(펠릿 / 크럼블 / 매쉬 / EP) 을 모두 지원한다.
//
//   ── 이 화면의 성격 ──
//   물리 예측기가 아니다. 전분 호화도·리그닌 결착·조질 증기량 같은
//   실측 입력이 시스템에 없으므로, 사료공학 경험식으로 "그럴듯한" 외관을
//   그려 보여주는 교육·기준 공유용 시각화다.
//   추정 PDI 옆에 해당 제품의 실측 PDI 평균을 같이 띄워
//   경험식이 실제와 얼마나 벌어지는지 항상 눈에 보이게 했다.
//
//   ── 계산 흐름 ──
//   원료명 → MATERIAL_TRAITS 패턴 매칭 → 색/전분/유지/섬유/단백/결착 지수
//     → 배합비 가중합(색은 착색력 tint 가중)  = 원료 기여
//     → 공정조건(온도·수분·리텐션·다이·냉각) = 호화도·갈변도
//     → 외관 지표(색상·광택·거칠기·크랙·미분·PDI·팽화도)
//     → 캔버스 렌더링(실제 mm 스케일)
// ============================================================

const FeedAppearancePage = (() => {

  // ============================================================
  // 1. 원료 외관 특성 테이블
  //    rgb   : 분쇄 상태의 원료 색
  //    tint  : 착색력 — 소량으로도 전체 색을 끌고 가는 원료는 크게 준다
  //    starch: 전분 지수(호화 → 결착·광택)
  //    fat   : 유지 지수(다이 윤활 → 내구도 저하, 광택 상승)
  //    fiber : 조섬유 지수(표면 거칠기·반점)
  //    prot  : 조단백 지수(열가소성 결착, 갈변 기여)
  //    bind  : 자체 결착력(소맥 글루텐·당밀이 최상위)
  //    grit  : 분쇄 후에도 남는 거친 입자 성향
  // ============================================================
  const MATERIAL_TRAITS = [
    // ── 곡류 ──
    { re: /옥수수|콘그리트|CORN/i,      t: { rgb: [216, 178,  86], tint: 1.4, starch: .74, fat: .04, fiber: .02, prot: .09, bind: .50, grit: .35 } },
    { re: /소맥피|밀기울|WHEAT\s*BRAN/i, t: { rgb: [168, 130,  84], tint: 1.1, starch: .22, fat: .04, fiber: .12, prot: .16, bind: .40, grit: .70 } },
    { re: /소맥|밀\b|WHEAT/i,           t: { rgb: [200, 172, 124], tint: 1.0, starch: .68, fat: .02, fiber: .03, prot: .13, bind: .88, grit: .25 } },
    { re: /보리|맥주박|BARLEY/i,        t: { rgb: [196, 176, 132], tint: 1.0, starch: .58, fat: .02, fiber: .06, prot: .11, bind: .60, grit: .40 } },
    { re: /수수|마일로|MILO|SORGHUM/i,  t: { rgb: [186, 142,  96], tint: 1.1, starch: .70, fat: .03, fiber: .03, prot: .10, bind: .45, grit: .35 } },
    { re: /타피오카|카사바|TAPIOCA/i,   t: { rgb: [238, 232, 216], tint: 1.2, starch: .82, fat: .01, fiber: .03, prot: .02, bind: .70, grit: .30 } },
    { re: /미강|쌀겨|RICE\s*BRAN/i,     t: { rgb: [186, 152,  98], tint: 1.0, starch: .20, fat: .17, fiber: .09, prot: .14, bind: .30, grit: .45 } },
    { re: /쇄미|싸라기|정맥|현미|쌀/,    t: { rgb: [232, 226, 208], tint: 1.0, starch: .76, fat: .02, fiber: .01, prot: .08, bind: .55, grit: .20 } },

    // ── 강한 색소 원료 (tint 높음) ──
    { re: /옥수수글루텐|콘글루텐|CGM/i, t: { rgb: [228, 176,  34], tint: 5.5, starch: .16, fat: .03, fiber: .02, prot: .60, bind: .55, grit: .20 } },
    { re: /소맥글루텐|활성글루텐/,      t: { rgb: [214, 186, 130], tint: 1.6, starch: .12, fat: .02, fiber: .01, prot: .75, bind: .95, grit: .15 } },
    { re: /당밀|MOLASSES/i,             t: { rgb: [ 54,  30,  16], tint: 6.0, starch: .00, fat: .00, fiber: .00, prot: .05, bind: .95, grit: .00 } },
    { re: /혈분|혈장|BLOOD/i,           t: { rgb: [ 96,  38,  32], tint: 5.0, starch: .00, fat: .01, fiber: .00, prot: .85, bind: .60, grit: .20 } },
    { re: /알팔파|목초|티모시|헤이/,     t: { rgb: [116, 138,  66], tint: 4.0, starch: .04, fat: .02, fiber: .26, prot: .17, bind: .25, grit: .85 } },
    { re: /해조|다시마|미역|켈프/,       t: { rgb: [ 74,  86,  62], tint: 4.5, starch: .05, fat: .01, fiber: .08, prot: .12, bind: .45, grit: .40 } },

    // ── 박류(단백) ──
    { re: /대두박|탈피대두|SBM|SOYBEAN\s*MEAL/i, t: { rgb: [208, 180, 122], tint: 1.0, starch: .06, fat: .02, fiber: .06, prot: .46, bind: .58, grit: .30 } },
    { re: /대두|전지대두|SOY/i,         t: { rgb: [214, 190, 132], tint: 1.0, starch: .10, fat: .18, fiber: .05, prot: .36, bind: .45, grit: .30 } },
    { re: /채종박|카놀라|RAPESEED|CANOLA/i, t: { rgb: [138, 108,  70], tint: 1.6, starch: .05, fat: .03, fiber: .12, prot: .36, bind: .45, grit: .55 } },
    { re: /팜박|코코넛박|야자박|COPRA|PKE/i, t: { rgb: [156, 124,  84], tint: 1.2, starch: .06, fat: .07, fiber: .15, prot: .18, bind: .30, grit: .75 } },
    { re: /면실|COTTONSEED/i,           t: { rgb: [148, 118,  86], tint: 1.4, starch: .03, fat: .04, fiber: .13, prot: .40, bind: .40, grit: .60 } },
    { re: /참깨박|호마박|아마박|해바라기/, t: { rgb: [142, 116,  82], tint: 1.3, starch: .04, fat: .05, fiber: .14, prot: .34, bind: .40, grit: .60 } },
    { re: /주정박|DDGS|DDG/i,           t: { rgb: [200, 150,  70], tint: 2.0, starch: .08, fat: .10, fiber: .08, prot: .28, bind: .35, grit: .50 } },
    { re: /효모|YEAST/i,                t: { rgb: [198, 164, 108], tint: 1.4, starch: .05, fat: .02, fiber: .01, prot: .45, bind: .55, grit: .15 } },

    // ── 동물성 ──
    { re: /어분|피시밀|FISH\s*MEAL|FM\b/i, t: { rgb: [152, 118,  82], tint: 1.6, starch: .01, fat: .09, fiber: .01, prot: .62, bind: .55, grit: .35 } },
    { re: /육골분|육분|MBM|우모분|계육분/, t: { rgb: [162, 122,  86], tint: 1.4, starch: .01, fat: .10, fiber: .01, prot: .55, bind: .45, grit: .40 } },
    { re: /유청|훼이|WHEY|탈지분유|유장/i, t: { rgb: [238, 226, 190], tint: 1.3, starch: .02, fat: .01, fiber: .00, prot: .14, bind: .70, grit: .10 } },
    { re: /크릴|오징어|스퀴드|SQUID/i,   t: { rgb: [178, 118,  92], tint: 2.4, starch: .00, fat: .12, fiber: .00, prot: .58, bind: .60, grit: .20 } },

    // ── 유지 ──
    { re: /우지|돈지|계지|동물성유지|탤로우|TALLOW/i, t: { rgb: [236, 224, 190], tint: 1.0, starch: 0, fat: 1.0, fiber: 0, prot: 0, bind: .05, grit: 0 } },
    { re: /대두유|팜유|채종유|미강유|어유|식물성유지|유지|OIL|LECITHIN|레시틴/i, t: { rgb: [232, 214, 148], tint: 1.0, starch: 0, fat: 1.0, fiber: 0, prot: 0, bind: .05, grit: 0 } },

    // ── 광물·첨가 ──
    { re: /석회석|탄산칼슘|패분|굴껍질|LIMESTONE/i, t: { rgb: [242, 242, 236], tint: 1.5, starch: 0, fat: 0, fiber: 0, prot: 0, bind: .10, grit: .55 } },
    { re: /인산|제일인산|제이인산|MDCP|DCP/i,       t: { rgb: [236, 234, 226], tint: 1.3, starch: 0, fat: 0, fiber: 0, prot: 0, bind: .12, grit: .45 } },
    { re: /식염|정제염|소금|SALT|NACL/i,            t: { rgb: [252, 252, 250], tint: 1.6, starch: 0, fat: 0, fiber: 0, prot: 0, bind: .05, grit: .70 } },
    { re: /제올라이트|벤토나이트|점토|카올린|고령토/, t: { rgb: [206, 200, 186], tint: 1.4, starch: 0, fat: 0, fiber: 0, prot: 0, bind: .55, grit: .40 } },
    { re: /중조|중탄산|산화마그네슘|황산|염화/,      t: { rgb: [244, 244, 240], tint: 1.2, starch: 0, fat: 0, fiber: 0, prot: 0, bind: .08, grit: .50 } },
    { re: /비타민|미네랄|프리믹스|첨가제|보조사료|아미노|라이신|메치오닌|효소/, t: { rgb: [214, 200, 170], tint: 1.0, starch: .10, fat: .02, fiber: .01, prot: .10, bind: .25, grit: .25 } },
    { re: /리그닌|바인더|점결|BINDER/i,             t: { rgb: [178, 148, 104], tint: 1.2, starch: .05, fat: 0, fiber: .05, prot: .02, bind: 1.0, grit: .20 } },
  ];

  // 미등록 원료 기본값 — 일반적인 곡물·박류 혼합 색
  const DEFAULT_TRAIT = { rgb: [184, 154, 108], tint: 1.0, starch: .30, fat: .04, fiber: .05, prot: .20, bind: .40, grit: .35 };

  const traitOf = (name) => {
    const n = String(name || '');
    for (const row of MATERIAL_TRAITS) if (row.re.test(n)) return row.t;
    return DEFAULT_TRAIT;
  };

  // ============================================================
  // 2. 상태
  // ============================================================
  const FORMS = {
    pellet:  { label: '펠릿',   desc: '조질 후 다이 압출 · 원기둥' },
    crumble: { label: '크럼블', desc: '펠릿을 롤로 파쇄한 각진 조각' },
    mash:    { label: '매쉬',   desc: '분쇄·배합만 거친 가루' },
    ep:      { label: 'EP',     desc: '압출 팽화 · 기공 있는 구형' },
  };

  // 공정조건 기본값 — 국내 배합사료 통상 조건
  const DEFAULTS = {
    form: 'pellet',
    grind: 0.75,   // 분쇄 Dgw (mm)
    temp: 82,      // 조질 증기온도 (℃)
    moist: 16.0,   // 조질 수분 (%)
    reten: 30,     // 리텐션 타임 (s)
    die: 4.0,      // 다이 직경 (mm)
    ld: 9,         // 다이 압축비 L/D
    cut: 1.8,      // 커터 길이비 (길이 = 직경 × 이 값)
    cool: 10,      // 냉각 시간 (min)
    postFat: 1.0,  // 후첨 유지 (%)
    press: 60,     // EP 스크류 압력 (bar)
  };

  const VIEWS = {
    appearance: { label: '외관',      desc: '알갱이 생김새' },
    flow:       { label: '빈 흐름성', desc: '사일로 배출 거동' },
  };

  let state = {
    ...DEFAULTS,
    ...FeedFlow.DEFAULTS,   // 빈 형상·벽면 재질 등 흐름성 파라미터
    view: 'appearance',
    recipeId: '',        // 선택된 배합비 id ('' = 수동 입력)
    manual: [],          // 수동 입력 원료 [{name, pct}]
    snapshot: null,      // A/B 비교용 스냅샷
    render3d: true,      // 3D 실사 렌더(불러오지 못하면 자동으로 2D)
  };

  const safe = (v) => String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const mixRGB = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  const css = (rgb, alpha) => `rgba(${Math.round(clamp(rgb[0],0,255))},${Math.round(clamp(rgb[1],0,255))},${Math.round(clamp(rgb[2],0,255))},${alpha ?? 1})`;
  const shade = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

  // 시드 고정 난수 — 조건을 조금 바꿨는데 알갱이 배치가 통째로 뒤집히면
  // 무엇 때문에 달라졌는지 눈으로 비교할 수 없다. 배치는 고정하고 형태만 변한다.
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // ============================================================
  // 3. 현재 배합 얻기
  // ============================================================
  const currentIngredients = () => {
    if (state.recipeId) {
      const r = (typeof DB !== 'undefined' ? DB.getFormulaRecipeById(state.recipeId) : null);
      if (r && Array.isArray(r.ingredients)) {
        return r.ingredients
          .map(i => ({ name: i.materialName || i.materialCode || '', pct: Number(i.pct) || 0 }))
          .filter(i => i.pct > 0);
      }
    }
    return state.manual.filter(i => i && Number(i.pct) > 0);
  };

  const currentRecipe = () => (state.recipeId && typeof DB !== 'undefined')
    ? DB.getFormulaRecipeById(state.recipeId) : null;

  // ============================================================
  // 4. 원료 기여 계산
  // ============================================================
  const blendTraits = (ings) => {
    const sum = ings.reduce((s, i) => s + i.pct, 0);
    if (sum <= 0) {
      return { ok: false, rgb: [196, 186, 170], starch: 0, fat: 0, fiber: 0, prot: 0, bind: 0, grit: 0, rows: [], total: 0 };
    }
    let colW = 0, col = [0, 0, 0];
    let starch = 0, fat = 0, fiber = 0, prot = 0, bind = 0, grit = 0;
    const rows = [];

    ings.forEach(i => {
      const t = traitOf(i.name);
      const w = i.pct / sum;                 // 물성은 순수 질량 가중
      const cw = w * t.tint;                 // 색은 착색력 가중
      colW += cw;
      col[0] += t.rgb[0] * cw; col[1] += t.rgb[1] * cw; col[2] += t.rgb[2] * cw;
      starch += t.starch * w; fat += t.fat * w; fiber += t.fiber * w;
      prot += t.prot * w;     bind += t.bind * w; grit += t.grit * w;
      rows.push({ name: i.name, pct: i.pct, share: w, trait: t, colorWeight: cw });
    });

    rows.sort((a, b) => b.pct - a.pct);
    return {
      ok: true,
      rgb: [col[0] / colW, col[1] / colW, col[2] / colW],
      starch, fat, fiber, prot, bind, grit, rows, total: sum,
    };
  };

  // ============================================================
  // 5. 공정조건 → 외관 지표
  // ============================================================
  const calcAppearance = (st) => {
    const ings = currentIngredients();
    const b = blendTraits(ings);
    const isEP = st.form === 'ep';
    const isMash = st.form === 'mash';

    // 총 유지 = 배합 내 유지 + 후첨 유지
    const totalFat = b.fat + (st.postFat / 100);

    // ── 열이력 계수 ──
    const tF = isMash ? 0 : clamp((st.temp - 55) / 40, 0, 1.15);
    const mF = isMash ? 0 : clamp((st.moist - 12) / 6, 0, 1.1);
    const rF = isMash ? 0 : clamp(Math.log10(Math.max(st.reten, 5) / 5) / Math.log10(24), 0, 1);
    const pF = isEP ? clamp((st.press - 20) / 100, 0, 1.2) : 0;

    // ── 냉각 부족 ── 덜 식은 채로 나오면 표면이 물러 미분·파손이 는다
    const coolShort = 1 - clamp((st.cool - 3) / 12, 0, 1);

    // ── 조질 수분 최적점 ── 16.5% 부근이 최적. 모자라도, 넘쳐도 결착이 나빠진다.
    const moistOpt = isMash ? 0 : clamp(1 - Math.pow((st.moist - 16.5) / 4, 2), 0, 1);

    // ── 전분 호화도 ──
    //   호화는 열과 수분이 동시에 있어야 일어난다. 항을 더하면
    //   증기온도가 60℃ 밑이어도 수분만 높으면 호화된 것으로 계산되어
    //   저온 조질의 외관 불량이 전혀 재현되지 않는다. 그래서 곱한다.
    const gel = clamp(
      b.starch
      * Math.pow(tF, 0.9)
      * (0.35 + 0.65 * mF)
      * (0.45 + 0.55 * rF)
      * (isEP ? 2.3 + 0.5 * pF : 1.9),
      0, 1);

    // ── 마이야르 갈변 (단백·환원당이 있어야 진행) ──
    const brown = isMash ? 0
      : clamp((0.55 * tF + 0.45 * rF) * (0.30 + 0.70 * clamp(b.prot + b.starch * 0.3, 0, 1)) * (isEP ? 1.25 : 1), 0, 1);

    // ── 펠렛 내구도(PDI) 추정 ──
    //   국내 배합사료의 실측 PDI 는 대개 85~95% 대에 몰려 있다.
    //   계수는 통상 조건(82℃ / 16% / L:D 9 / 유지 5%)에서 87 부근,
    //   악조건(저온·고유지·고섬유)에서 70 아래로 떨어지도록 맞췄다.
    let pdi = 78
      + b.bind * 14
      + gel * 12
      + clamp((st.ld - 6) / 8, 0, 1) * 6
      + moistOpt * 5
      - totalFat * 90
      - b.fiber * 40
      - clamp((st.die - 3) / 9, 0, 1) * 2
      - coolShort * 4;
    pdi = clamp(pdi, 55, 99);
    if (isEP) pdi = clamp(pdi + 3, 55, 99);

    // ── 미분율 ──
    const fines = isMash ? 100
      : clamp((100 - pdi) * 0.32 + coolShort * 3 + (st.form === 'crumble' ? 5.5 : 0), 0.2, 26);

    // ── 표면 광택 ── 표면으로 나온 유지 + 호화된 전분층
    const gloss = clamp(0.10 + gel * 0.32 + clamp(st.postFat / 4, 0, 1) * 0.42 + tF * 0.14, 0, 1);

    // ── 표면 거칠기 ──
    const rough = clamp(0.12 + b.fiber * 2.4 + b.grit * 0.30 + clamp((st.grind - 0.5) / 1.0, 0, 1) * 0.32 - gel * 0.28, 0.05, 1);

    // ── 크랙 ── 수분 과다 + 급속 냉각 시 표면 균열
    const crack = isMash ? 0
      : clamp((st.moist - 15) / 4 * 0.45 + coolShort * 0.45 + b.fiber * 1.2 - gel * 0.30, 0, 1);

    // ── 팽화도 (EP 전용) ──
    const expand = isEP
      ? clamp(0.10 + b.starch * 1.05 * (0.35 + 0.65 * tF) + pF * 0.35 - totalFat * 1.6, 0, 1.35)
      : 0;

    // ── 최종 색 ──
    const BROWN = [86, 50, 26];
    let rgb = mixRGB(b.rgb, BROWN, brown * 0.42);
    if (isEP) rgb = mixRGB(rgb, [255, 246, 226], clamp(expand * 0.22, 0, 0.3)); // 팽화 기공이 빛을 산란 → 밝아짐
    rgb = mixRGB(rgb, [255, 252, 244], gloss * 0.07);

    // ── 치수 ──
    const diaMm = isMash ? st.grind : (isEP ? st.die * (1 + expand) : st.die);
    const lenMm = isMash ? st.grind
      : isEP ? diaMm * 0.95
      : st.form === 'crumble' ? st.die * 0.85
      : st.die * st.cut;

    // ── 길이 편차 ── 커터가 짧게 자를수록, 결착이 약할수록 들쭉날쭉
    const lenCv = clamp(0.10 + (1 - clamp((pdi - 55) / 40, 0, 1)) * 0.28 + clamp((2.4 - st.cut) / 2, 0, 1) * 0.12, 0.06, 0.55);

    return { form: st.form, b, ings, gel, brown, pdi, fines, gloss, rough, crack, expand, rgb, diaMm, lenMm, lenCv, totalFat, isEP, isMash };
  };

  // ============================================================
  // 6. 실측 PDI 비교 — 경험식이 실제와 얼마나 벌어지는지 보여준다
  // ============================================================
  const actualPdi = () => {
    const r = currentRecipe();
    if (!r || !r.productCode || typeof DB === 'undefined') return null;
    let list = [];
    try { list = DB.getProductAnalysesByProduct(r.productCode) || []; } catch (e) { return null; }
    const vals = list.map(a => Number(a.pelletDurability)).filter(v => v > 0);
    if (!vals.length) return null;
    return { avg: vals.reduce((s, v) => s + v, 0) / vals.length, n: vals.length };
  };

  // ============================================================
  // 7. 캔버스 렌더링
  // ============================================================

  // 캔버스를 DPR 보정해서 준비 — 안 하면 고해상도 화면에서 알갱이가 뭉개진다
  const prep = (canvas) => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.width;
    const h = Number(canvas.dataset.h) || 300;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    canvas.dataset.ctx = '2d';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  };

  // 표면 반점 — 섬유질·거친 입자가 표면에 드러난 것.
  //   개수는 반드시 실제 표면적(mm²) 기준이어야 한다.
  //   픽셀 면적 기준으로 잡으면 확대뷰에서 수천 개가 찍혀 알갱이가 아니라 색종이가 된다.
  //   반점을 찍은 뒤에는 ctx 의 current path 가 마지막 반점으로 남는다.
  //   호출부가 곧바로 stroke() 하면 조각 외곽선 대신 반점에 테두리가 그려져
  //   알갱이 위에 정체불명의 고리가 생긴다. 그래서 도형은 Path2D 로 들고 다닌다.
  const drawSpecks = (ctx, areaMm2, a, rand, pxPerMm, spreadX, spreadY) => {
    const n = Math.min(900, Math.round(areaMm2 * 4.5 * (0.35 + a.rough)));
    for (let s = 0; s < n; s++) {
      const px = (rand() - 0.5) * spreadX, py = (rand() - 0.5) * spreadY;
      const dark = rand() > 0.38;
      const rMm = 0.035 + rand() * 0.075;
      const rPx = Math.max(0.3, rMm * pxPerMm);
      ctx.fillStyle = css(shade(a.rgb, dark ? 0.64 : 1.20), 0.22 + rand() * 0.26);
      ctx.beginPath();
      ctx.ellipse(px, py, rPx, rPx * (0.6 + rand() * 0.5), rand() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // ── 펠릿 한 알 (원기둥을 옆에서 본 모습) ──
  const drawPellet = (ctx, x, y, ang, lenPx, diaPx, a, rand, pxPerMm) => {
    const L = Math.max(lenPx, 2), D = Math.max(diaPx, 2);
    const lenMm = L / pxPerMm, diaMm = D / pxPerMm;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);

    // 절단면 모서리 — 잘 붙은 펠릿은 각이 살고, 무른 펠릿은 모서리가 뭉개진다
    const rr = D / 2 * (0.10 + 0.32 * (1 - clamp((a.pdi - 55) / 40, 0, 1)));

    // 몸통 — 원기둥 음영(위 밝고 아래 어둡게)
    const g = ctx.createLinearGradient(0, -D / 2, 0, D / 2);
    g.addColorStop(0.00, css(shade(a.rgb, 1.18)));
    g.addColorStop(0.32, css(shade(a.rgb, 1.04)));
    g.addColorStop(1.00, css(shade(a.rgb, 0.66)));
    ctx.fillStyle = g;
    roundRect(ctx, -L / 2, -D / 2, L, D, rr);
    ctx.fill();

    // 다이 통과 자국 — 길이 방향 미세 줄무늬. 너무 작으면 노이즈만 되므로 생략
    if (D > 11) {
      const stripes = Math.max(2, Math.round(D / 5));
      ctx.lineWidth = Math.max(0.4, D * 0.025);
      for (let s = 0; s < stripes; s++) {
        const sy = -D / 2 + D * (s + 0.5) / stripes;
        ctx.strokeStyle = css(shade(a.rgb, 0.88), 0.14 + a.rough * 0.26);
        ctx.beginPath(); ctx.moveTo(-L / 2 + rr, sy); ctx.lineTo(L / 2 - rr, sy); ctx.stroke();
      }
    }

    drawSpecks(ctx, lenMm * diaMm, a, rand, pxPerMm, L - rr * 1.4, D * 0.84);

    // 표면 크랙 — 끝에서 끝까지 그으면 균열이 아니라 이음매로 보인다. 부분 균열로 남긴다.
    if (a.crack > 0.18 && D > 6) {
      const n = Math.round(a.crack * 3.4);
      ctx.strokeStyle = css(shade(a.rgb, 0.44), 0.22 + a.crack * 0.32);
      ctx.lineWidth = Math.max(0.35, D * 0.028);
      for (let c = 0; c < n; c++) {
        const cx = (rand() - 0.5) * L * 0.66;
        const from = -D / 2 + D * (0.05 + rand() * 0.2);
        const to = from + D * (0.30 + rand() * 0.45);
        ctx.beginPath();
        ctx.moveTo(cx, from);
        ctx.lineTo(cx + (rand() - 0.5) * D * 0.35, Math.min(to, D / 2 - D * 0.05));
        ctx.stroke();
      }
    }

    // 광택 하이라이트
    if (a.gloss > 0.12) {
      const hg = ctx.createLinearGradient(0, -D / 2, 0, 0);
      hg.addColorStop(0, `rgba(255,255,255,${(a.gloss * 0.42).toFixed(3)})`);
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      roundRect(ctx, -L / 2 + rr, -D / 2 + D * 0.05, L - rr * 2, D * 0.34, D * 0.14);
      ctx.fill();
    }

    // 커터 절단면 — 양 끝의 얕은 단차
    if (L > 8) {
      ctx.strokeStyle = css(shade(a.rgb, 0.72), 0.45);
      ctx.lineWidth = Math.max(0.35, D * 0.03);
      [-1, 1].forEach(side => {
        const ex = side * (L / 2 - rr * 0.75);
        ctx.beginPath();
        ctx.moveTo(ex, -D / 2 + rr * 0.6); ctx.lineTo(ex, D / 2 - rr * 0.6);
        ctx.stroke();
      });
    }

    ctx.strokeStyle = css(shade(a.rgb, 0.50), 0.5);
    ctx.lineWidth = Math.max(0.35, D * 0.028);
    roundRect(ctx, -L / 2, -D / 2, L, D, rr); ctx.stroke();

    ctx.restore();
  };

  // ── EP 팽화립 ──
  //   팽화립은 각진 다각형이 아니라 부풀어 오른 덩어리다.
  //   꼭짓점을 직선으로 이으면 견과류처럼 보이므로 2차 베지어로 매끄럽게 잇는다.
  const drawEP = (ctx, x, y, dPx, a, rand, pxPerMm) => {
    const R = Math.max(dPx / 2, 2);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rand() * Math.PI * 2);

    const n = 12, wob = 0.05 + a.expand * 0.10;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const th = i / n * Math.PI * 2;
      const rr = R * (1 + (rand() - 0.5) * 2 * wob);
      pts.push([Math.cos(th) * rr, Math.sin(th) * rr]);
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const shape = new Path2D();
    const m0 = mid(pts[n - 1], pts[0]);
    shape.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const cur = pts[i], nx = pts[(i + 1) % n], m = mid(cur, nx);
      shape.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
    }
    shape.closePath();

    const g = ctx.createRadialGradient(-R * 0.32, -R * 0.36, R * 0.08, 0, 0, R * 1.18);
    g.addColorStop(0, css(shade(a.rgb, 1.20)));
    g.addColorStop(0.55, css(a.rgb));
    g.addColorStop(1, css(shade(a.rgb, 0.62)));
    ctx.fillStyle = g; ctx.fill(shape);
    ctx.save(); ctx.clip(shape);

    // 기공 — 표면에 파인 구멍이다. 밝은 하이라이트를 넣으면 구슬처럼 보인다.
    const dMm = dPx / pxPerMm;
    const pores = Math.round(dMm * dMm * (1.2 + a.expand * 5.5));
    for (let p = 0; p < pores; p++) {
      const th = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * R * 0.92;
      const px = Math.cos(th) * rr, py = Math.sin(th) * rr;
      const pr = Math.max(0.35, R * (0.035 + rand() * 0.055));
      const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
      pg.addColorStop(0, css(shade(a.rgb, 0.44), 0.75));
      pg.addColorStop(1, css(shade(a.rgb, 0.80), 0.10));
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
    drawSpecks(ctx, dMm * dMm * 0.7, a, rand, pxPerMm, R * 1.5, R * 1.5);

    // 광택 — 경계가 뚜렷하면 스티커처럼 보인다. 가장자리를 흐린다.
    if (a.gloss > 0.12) {
      const hx = -R * 0.34, hy = -R * 0.40, hr = R * 0.42;
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, `rgba(255,255,255,${(a.gloss * 0.34).toFixed(3)})`);
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = css(shade(a.rgb, 0.52), 0.42);
    ctx.lineWidth = Math.max(0.35, R * 0.05);
    ctx.stroke(shape);
    ctx.restore();
  };

  // ── 크럼블 조각 / 매쉬 입자 (파쇄면이 살아 있는 각진 조각) ──
  const drawChip = (ctx, x, y, sizePx, a, rand, angular, pxPerMm) => {
    const R = Math.max(sizePx / 2, 0.6);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rand() * Math.PI * 2);
    const n = angular ? 5 + Math.floor(rand() * 3) : 6 + Math.floor(rand() * 4);
    const shape = new Path2D();
    for (let i = 0; i < n; i++) {
      const th = i / n * Math.PI * 2;
      const rr = R * (angular ? (0.58 + rand() * 0.70) : (0.72 + rand() * 0.48));
      const px = Math.cos(th) * rr, py = Math.sin(th) * rr;
      i === 0 ? shape.moveTo(px, py) : shape.lineTo(px, py);
    }
    shape.closePath();
    const g = ctx.createLinearGradient(0, -R, 0, R);
    g.addColorStop(0, css(shade(a.rgb, 1.14 + rand() * 0.12)));
    g.addColorStop(1, css(shade(a.rgb, 0.64 + rand() * 0.12)));
    ctx.fillStyle = g; ctx.fill(shape);

    if (R > 4 && pxPerMm) {
      ctx.save(); ctx.clip(shape);
      const dMm = sizePx / pxPerMm;
      drawSpecks(ctx, dMm * dMm, a, rand, pxPerMm, R * 1.6, R * 1.6);
      ctx.restore();
    }
    if (R > 1.6) {
      ctx.strokeStyle = css(shade(a.rgb, 0.48), 0.38);
      ctx.lineWidth = Math.max(0.3, R * 0.07); ctx.stroke(shape);
    }
    if (a.gloss > 0.2 && R > 2.5) {
      ctx.fillStyle = `rgba(255,255,255,${(a.gloss * 0.26).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(-R * 0.2, -R * 0.3, R * 0.28, R * 0.16, -0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  const roundRect = (ctx, x, y, w, h, r) => {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  // 트레이 시야폭(mm) — 알갱이가 가로로 대략 14개 들어오는 폭.
  // 성상마다 알갱이 크기가 10배 넘게 차이 나므로 고정 배율로는 맞출 수 없다.
  const viewWidthMm = (a) => {
    if (a.isMash) return clamp(a.diaMm * 55, 24, 70);
    if (a.isEP) return a.diaMm * 14;
    if (a.form === 'crumble') return a.lenMm * 14;
    return Math.max(a.lenMm, a.diaMm) * 14;
  };

  // 확대 뷰 시야폭(mm) — 한 알이 화면 가운데를 채우고 뒤로 몇 알이 흐리게 보이는 폭
  const macroViewMm = (a) => {
    if (a.isMash) return clamp(a.diaMm * 22, 8, 40);
    if (a.isEP) return a.diaMm * 3.2;
    if (a.form === 'crumble') return a.lenMm * 3.8;
    return Math.max(a.lenMm, a.diaMm) * 2.1;
  };

  // ── 3D 실사 렌더 연결 ──
  //   한 캔버스에는 2D/WebGL 중 한 가지 컨텍스트만 붙는다.
  //   종류가 바뀌면(3D 로딩 전 2D 로 그렸던 캔버스 등) 같은 속성의 새 캔버스로 갈아끼운다.
  const has3D = () => typeof FeedAppearance3D !== 'undefined';
  const canvasFor = (id, kind) => {
    let cv = document.getElementById(id);
    if (!cv) return null;
    if (cv.dataset.ctx && cv.dataset.ctx !== kind) {
      if (has3D()) FeedAppearance3D.release(id);
      const nc = cv.cloneNode(false);
      delete nc.dataset.ctx;
      cv.replaceWith(nc);
      cv = nc;
    }
    if (kind === '3d') cv.dataset.ctx = '3d';
    return cv;
  };
  const want3D = (a) => state.render3d && a.b.ok && has3D() && FeedAppearance3D.ready();

  // 3D 로 그려보고, 안 되면 기존 2D 로 그린다
  const drawView = (id, a, kind, render2D) => {
    if (want3D(a)) {
      const cv = canvasFor(id, '3d');
      const opt = { viewMm: kind === 'macro' ? macroViewMm(a) : viewWidthMm(a), grind: state.grind };
      if (cv && FeedAppearance3D.draw(cv, a, kind, opt)) return true;
    }
    const cv = canvasFor(id, '2d');
    if (cv) render2D(cv, a);
    return false;
  };

  const drawTrayBase = (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fafafa'; roundRect(ctx, 6, 6, w - 12, h - 12, 4); ctx.fill();
    ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = 1; ctx.stroke();
  };

  // ── 트레이(샘플 접시) 뷰 — 실제 스케일 ──
  const renderTray = (canvas, a) => {
    const { ctx, w, h } = prep(canvas);
    const rand = rng(20260814);
    drawTrayBase(ctx, w, h);

    if (!a.b.ok) {
      ctx.fillStyle = '#5C5E62'; ctx.font = '13px "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('배합비를 선택하거나 원료를 입력하면 외관이 그려집니다', w / 2, h / 2);
      return;
    }

    const pxPerMm = (w - 24) / viewWidthMm(a);

    // 미분층 — 알갱이보다 먼저 깔아 바닥에 가라앉은 것처럼 보이게
    const dustN = Math.min(2600, Math.round(a.fines * (a.isMash ? 12 : 30)));
    for (let i = 0; i < dustN; i++) {
      const px = 10 + rand() * (w - 20), py = 10 + rand() * (h - 20);
      ctx.fillStyle = css(shade(a.rgb, 0.85 + rand() * 0.3), 0.22 + rand() * 0.32);
      ctx.beginPath(); ctx.arc(px, py, 0.4 + rand() * 1.0, 0, Math.PI * 2); ctx.fill();
    }

    if (a.isMash) {
      // 매쉬 — 입도 분포(로그정규 근사)로 가루 베드를 깐다
      const dPx = a.diaMm * pxPerMm;
      const n = clamp(Math.round((w * h) / (dPx * dPx) * 2.2), 400, 9000);
      const sigma = 0.32 + a.rough * 0.30;
      for (let i = 0; i < n; i++) {
        const u = rand(), v = rand();
        const gauss = Math.sqrt(-2 * Math.log(Math.max(u, 1e-6))) * Math.cos(2 * Math.PI * v);
        const dMm = clamp(a.diaMm * Math.exp(gauss * sigma), 0.04, 4);
        drawChip(ctx, 10 + rand() * (w - 20), 10 + rand() * (h - 20), dMm * pxPerMm, a, rand, false, pxPerMm);
      }
    } else if (a.isEP) {
      const dPx = a.diaMm * pxPerMm;
      const step = dPx * 1.04;
      for (let row = 0; row * step * 0.86 < h; row++) {
        for (let col = 0; col * step < w; col++) {
          const px = 12 + col * step + (row % 2) * step * 0.5 + (rand() - 0.5) * step * 0.16;
          const py = 14 + row * step * 0.86 + (rand() - 0.5) * step * 0.16;
          if (px > w - 8 || py > h - 8) continue;
          drawEP(ctx, px, py, dPx * (0.88 + rand() * 0.26), a, rand, pxPerMm);
        }
      }
    } else if (a.form === 'crumble') {
      const base = a.lenMm * pxPerMm;
      const n = clamp(Math.round((w * h) / (base * base) * 3.0), 120, 4000);
      for (let i = 0; i < n; i++) {
        drawChip(ctx, 10 + rand() * (w - 20), 10 + rand() * (h - 20), base * (0.45 + rand() * 1.05), a, rand, true, pxPerMm);
      }
    } else {
      // 펠릿 — 쏟아부은 것처럼 방향 랜덤으로 겹쳐 깐다
      const dPx = a.diaMm * pxPerMm, lPx = a.lenMm * pxPerMm;
      const step = Math.max(dPx, lPx * 0.78);
      for (let row = 0; row * step * 0.92 < h; row++) {
        for (let col = 0; col * step < w; col++) {
          const px = 12 + col * step + (rand() - 0.5) * step * 0.45;
          const py = 14 + row * step * 0.92 + (rand() - 0.5) * step * 0.4;
          if (px > w - 8 || py > h - 8) continue;
          const lenPx = lPx * (1 + (rand() - 0.5) * 2 * a.lenCv);
          drawPellet(ctx, px, py, (rand() - 0.5) * Math.PI * 1.6, lenPx, dPx * (0.94 + rand() * 0.12), a, rand, pxPerMm);
        }
      }
    }

    drawScaleBar(ctx, w, h, pxPerMm);
  };

  // ── 확대 뷰 — 알갱이 한 알을 크게 ──
  const renderMacro = (canvas, a) => {
    const { ctx, w, h } = prep(canvas);
    const rand = rng(777);
    drawTrayBase(ctx, w, h);
    if (!a.b.ok) return;

    if (a.isMash) {
      // 매쉬는 한 알을 키워봐야 의미가 없다 — 입도 스펙트럼을 굵은 순으로 늘어놓는다
      const ratios = [2.6, 1.9, 1.4, 1.0, 0.72, 0.52, 0.36];
      const sizesMm = ratios.map(k => a.diaMm * k);
      const gap = 16;
      const pxPerMm = (w - 36 - gap * (sizesMm.length - 1)) / sizesMm.reduce((s, v) => s + v, 0);
      let x = 18;
      ctx.fillStyle = '#5C5E62'; ctx.font = '11px "Noto Sans KR", sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('입자 크기 스펙트럼 — Dgw ' + a.diaMm.toFixed(2) + 'mm 기준 분포', 12, 20);
      sizesMm.forEach(dMm => {
        const s = dMm * pxPerMm;
        drawChip(ctx, x + s / 2, h / 2, s, a, rand, false, pxPerMm);
        ctx.fillStyle = '#5C5E62'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText(dMm.toFixed(2), x + s / 2, h - 14);
        x += s + gap;
      });
      // 각 입자 밑에 mm 가 적혀 있으므로 스케일바를 겹쳐 그리지 않는다
      return;
    }

    const longMm = a.isEP ? a.diaMm : Math.max(a.lenMm, a.diaMm);
    const tallMm = a.isEP ? a.diaMm : a.diaMm;
    const pxPerMm = Math.min((w - 120) / longMm, (h - 70) / tallMm);

    if (a.isEP) {
      drawEP(ctx, w / 2, h / 2, a.diaMm * pxPerMm, a, rand, pxPerMm);
    } else if (a.form === 'crumble') {
      drawChip(ctx, w / 2, h / 2, a.lenMm * pxPerMm, a, rand, true, pxPerMm);
    } else {
      drawPellet(ctx, w / 2, h / 2, 0, a.lenMm * pxPerMm, a.diaMm * pxPerMm, a, rand, pxPerMm);
    }

    // 치수선 — 크럼블은 파쇄 조각이라 직경·길이를 나눌 수 없다. 조각 크기 하나만 적는다.
    const isCrumble = a.form === 'crumble';
    const dHalf = (isCrumble ? a.lenMm : a.diaMm) * pxPerMm / 2;
    const lHalf = (a.isEP ? a.diaMm : a.lenMm) * pxPerMm / 2;
    ctx.strokeStyle = '#3E6AE1'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(w / 2 + lHalf + 12, h / 2 - dHalf); ctx.lineTo(w / 2 + lHalf + 12, h / 2 + dHalf);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#3E6AE1'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText(isCrumble ? `조각 ${a.lenMm.toFixed(2)}mm` : `Ø ${a.diaMm.toFixed(2)}mm`, w / 2 + lHalf + 17, h / 2 + 4);

    if (!a.isEP && !isCrumble) {
      ctx.strokeStyle = '#3E6AE1'; ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(w / 2 - lHalf, h / 2 + dHalf + 14); ctx.lineTo(w / 2 + lHalf, h / 2 + dHalf + 14);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'center';
      ctx.fillText(`L ${a.lenMm.toFixed(2)}mm`, w / 2, h / 2 + dHalf + 28);
    }

    drawScaleBar(ctx, w, h, pxPerMm);
  };

  const drawScaleBar = (ctx, w, h, pxPerMm) => {
    // 눈에 편한 길이(0.5/1/2/5/10/20mm) 중 40~130px 에 들어오는 것을 고른다
    const cand = [0.2, 0.5, 1, 2, 5, 10, 20, 50];
    const mm = cand.find(c => c * pxPerMm >= 40 && c * pxPerMm <= 130)
      || cand.reduce((best, c) => Math.abs(c * pxPerMm - 70) < Math.abs(best * pxPerMm - 70) ? c : best, 1);
    const barPx = mm * pxPerMm;
    const x = w - barPx - 16, y = h - 16;

    // 알갱이 위에 겹쳐도 읽히도록 흰 바탕을 깐다
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(ctx, x - 8, y - 22, barPx + 16, 28, 3); ctx.fill();

    ctx.strokeStyle = '#171A20'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + barPx, y); ctx.lineTo(x + barPx, y - 4);
    ctx.stroke();
    ctx.fillStyle = '#171A20'; ctx.font = '10px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    ctx.fillText(`${mm} mm`, x + barPx / 2, y - 7);
  };

  // ============================================================
  // 8. 화면
  // ============================================================
  const slider = (key, label, min, max, step, unit, hint) => `
    <div class="fa-ctl">
      <div class="fa-ctl-head">
        <label>${label}</label>
        <span class="fa-ctl-val" id="fa-val-${key}">${state[key]}${unit}</span>
      </div>
      <input type="range" id="fa-${key}" min="${min}" max="${max}" step="${step}" value="${state[key]}"
             oninput="FeedAppearancePage.onSlide('${key}', this.value, '${unit}')">
      ${hint ? `<div class="fa-ctl-hint">${hint}</div>` : ''}
    </div>`;

  const controlPanel = () => {
    const f = state.form;
    if (f === 'mash') {
      return slider('grind', '분쇄 입도 Dgw', 0.2, 1.6, 0.05, ' mm', '롤러밀/해머밀 통과 후 기하평균 입경')
        + slider('postFat', '유지 후첨', 0, 5, 0.1, ' %', '가루 표면 코팅 — 광택과 뭉침에 영향');
    }
    if (f === 'ep') {
      return slider('grind', '분쇄 입도 Dgw', 0.2, 1.2, 0.05, ' mm', '압출 전 원료 미분쇄 정도')
        + slider('temp', '압출 배럴온도', 90, 150, 1, ' ℃', '전분 호화·팽화의 1차 동인')
        + slider('moist', '투입 수분', 18, 32, 0.5, ' %', '수분이 낮을수록 팽화가 강해진다')
        + slider('press', '다이 직전 압력', 20, 120, 1, ' bar', '토출 순간 압력차 → 팽화도')
        + slider('die', '다이 직경', 1.0, 12, 0.1, ' mm', '팽화 전 구멍 직경 (실제 입경은 팽화 후)')
        + slider('reten', '체류 시간', 5, 90, 1, ' s', '배럴 내 열이력 — 갈변에 직결')
        + slider('cool', '건조·냉각', 3, 25, 1, ' min', '')
        + slider('postFat', '후첨 유지(코팅)', 0, 12, 0.1, ' %', '진공 코팅 유지 — 광택 급상승');
    }
    // pellet / crumble
    return slider('grind', '분쇄 입도 Dgw', 0.3, 1.6, 0.05, ' mm', '거칠수록 표면 반점·거칠기 증가')
      + slider('temp', '조질 증기온도', 55, 95, 1, ' ℃', '전분 호화 — 결착의 핵심')
      + slider('moist', '조질 수분', 12, 20, 0.1, ' %', '16% 부근이 통상 최적 · 과하면 크랙')
      + slider('reten', '리텐션 타임', 5, 120, 1, ' s', '컨디셔너 체류 — 길수록 호화·갈변 진행')
      + slider('die', '다이 직경', 1.5, 12, 0.1, ' mm', '')
      + slider('ld', '다이 압축비 L/D', 4, 16, 0.5, '', '높을수록 치밀·매끈 · 생산성은 저하')
      + slider('cut', '커터 길이비 (L/Ø)', 1.0, 3.5, 0.1, '', '펠릿 길이 = 직경 × 이 값')
      + slider('cool', '냉각 시간', 3, 25, 1, ' min', '짧으면 잔열·잔수분 → 표면 크랙·미분')
      + slider('postFat', '후첨 유지', 0, 6, 0.1, ' %', '내구도를 깎는 대신 광택이 오른다');
  };

  const gaugeRow = (label, value, pct, tone, note) => `
    <div class="fa-gauge">
      <div class="fa-gauge-top"><span>${label}</span><strong>${value}</strong></div>
      <div class="fa-gauge-bar"><i class="${tone || ''}" style="width:${clamp(pct, 0, 100).toFixed(1)}%"></i></div>
      ${note ? `<div class="fa-ctl-hint">${note}</div>` : ''}
    </div>`;

  const metricsPanel = (a) => {
    if (!a.b.ok) return '<div class="text-sm text-muted">배합 입력 대기</div>';
    const act = actualPdi();
    const gap = act ? (a.pdi - act.avg) : null;
    const pdiTone = a.pdi >= 92 ? 'ok' : a.pdi >= 85 ? '' : 'bad';
    const finesTone = a.fines <= 3 ? 'ok' : a.fines <= 8 ? '' : 'bad';

    return `
      <div class="fa-colorchip">
        <div class="fa-swatch" style="background:${css(a.rgb)}"></div>
        <div>
          <div class="fa-swatch-label">예상 색상</div>
          <div class="fa-swatch-hex">${rgbHex(a.rgb)}</div>
          <div class="fa-ctl-hint">원료 착색 + 갈변 ${(a.brown * 100).toFixed(0)}%</div>
        </div>
      </div>
      ${a.isMash ? '' : gaugeRow('추정 PDI (펠렛 내구도)', a.pdi.toFixed(1) + ' %', (a.pdi - 50) / 49 * 100, pdiTone,
        act ? `실측 평균 ${act.avg.toFixed(1)}% (n=${act.n}) · 추정 ${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%p`
            : '이 제품의 실측 PDI 데이터 없음')}
      ${gaugeRow('미분율', a.fines.toFixed(1) + ' %', a.isMash ? 100 : a.fines / 26 * 100, finesTone,
        a.isMash ? '매쉬는 전량 분체' : '체 통과분 기준 추정')}
      ${gaugeRow('전분 호화도', (a.gel * 100).toFixed(0) + ' %', a.gel * 100, a.gel > 0.5 ? 'ok' : '')}
      ${gaugeRow('표면 광택', (a.gloss * 100).toFixed(0) + ' %', a.gloss * 100, '')}
      ${gaugeRow('표면 거칠기', (a.rough * 100).toFixed(0) + ' %', a.rough * 100, a.rough > 0.6 ? 'bad' : '')}
      ${a.isMash ? '' : gaugeRow('크랙 발생 경향', (a.crack * 100).toFixed(0) + ' %', a.crack * 100, a.crack > 0.5 ? 'bad' : a.crack < 0.2 ? 'ok' : '')}
      ${a.isEP ? gaugeRow('팽화도', '×' + (1 + a.expand).toFixed(2), a.expand / 1.35 * 100, a.expand > 0.5 ? 'ok' : '') : ''}
      <div class="fa-dims">
        ${a.form === 'crumble'
          ? `<div><label>조각 크기</label><span>${a.lenMm.toFixed(2)} mm</span></div>`
          : `<div><label>${a.isMash ? '평균 입경' : '직경'}</label><span>${a.diaMm.toFixed(2)} mm</span></div>
             ${a.isMash || a.isEP ? '' : `<div><label>길이</label><span>${a.lenMm.toFixed(2)} mm</span></div>`}`}
        <div><label>총 유지</label><span>${(a.totalFat * 100).toFixed(2)} %</span></div>
        <div><label>조섬유 지수</label><span>${(a.b.fiber * 100).toFixed(1)} %</span></div>
      </div>`;
  };

  const rgbHex = (rgb) => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();

  const contribTable = (a) => {
    if (!a.b.ok) return '';
    const rows = a.b.rows.slice(0, 14);
    const colSum = a.b.rows.reduce((s, r) => s + r.colorWeight, 0) || 1;
    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>원료</th><th class="td-right">배합비</th><th>색</th>
            <th class="td-right">착색 기여</th><th class="td-right">결착</th>
            <th class="td-right">유지</th><th class="td-right">섬유</th><th>외관 영향</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const t = r.trait;
            const notes = [];
            if (t.bind >= 0.8) notes.push('강한 결착 — 표면 치밀');
            if (t.fat >= 0.5) notes.push('다이 윤활 — 내구도 저하·광택');
            if (t.fiber >= 0.11) notes.push('표면 거칠기·반점');
            if (t.tint >= 3) notes.push('강한 착색력');
            if (t.grit >= 0.7) notes.push('거친 입자 잔류');
            if (t === DEFAULT_TRAIT) notes.push('특성 미등록 — 기본값 적용');
            return `<tr>
              <td>${safe(r.name)}</td>
              <td class="td-right mono">${r.pct.toFixed(2)}%</td>
              <td><span class="fa-dot" style="background:${css(t.rgb)}"></span></td>
              <td class="td-right mono">${(r.colorWeight / colSum * 100).toFixed(1)}%</td>
              <td class="td-right mono">${(t.bind * 100).toFixed(0)}</td>
              <td class="td-right mono">${(t.fat * 100).toFixed(0)}</td>
              <td class="td-right mono">${(t.fiber * 100).toFixed(0)}</td>
              <td class="text-sm text-muted">${notes.join(' · ') || '-'}</td>
            </tr>`;
          }).join('')}
          ${a.b.rows.length > 14 ? `<tr><td colspan="8" class="text-sm text-muted">외 ${a.b.rows.length - 14}종 (배합비 낮은 순 생략)</td></tr>` : ''}
        </tbody>
      </table>
      ${Math.abs(a.b.total - 100) > 0.5 ? `<div class="fa-warn">배합비 합계가 ${a.b.total.toFixed(2)}% 입니다 — 100% 기준으로 정규화해 계산했습니다.</div>` : ''}`;
  };

  const manualRows = () => {
    const list = state.manual.length ? state.manual : [{ name: '', pct: '' }];
    return list.map((row, idx) => `
      <div class="fa-manual-row">
        <input type="text" class="form-input" placeholder="원료명 (예: 옥수수)" value="${safe(row.name)}"
               oninput="FeedAppearancePage.onManual(${idx}, 'name', this.value)" list="fa-material-list">
        <input type="number" class="form-input" placeholder="%" step="0.01" value="${row.pct === '' ? '' : row.pct}"
               oninput="FeedAppearancePage.onManual(${idx}, 'pct', this.value)">
        <button class="btn btn-sm" onclick="FeedAppearancePage.removeManual(${idx})">✕</button>
      </div>`).join('');
  };

  const materialDatalist = () => {
    let names = [];
    try { names = (DB.getMaterials() || []).map(m => m.name).filter(Boolean).slice(0, 800); } catch (e) { names = []; }
    return `<datalist id="fa-material-list">${names.map(n => `<option value="${safe(n)}">`).join('')}</datalist>`;
  };

  const render = () => {
    let recipes = [];
    try { recipes = (DB.getFormulaRecipes() || []).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); } catch (e) { recipes = []; }
    const a = calcAppearance(state);
    const isFlow = state.view === 'flow';
    const f = isFlow ? FeedFlow.calc(a, state) : null;

    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">배합비 · 생산</div>
            <h2>사료 외관·흐름성 시뮬레이터</h2>
            <p>${isFlow
              ? '외관 탭에서 계산된 미분율·수분·유지·입도를 그대로 받아, 그 사료를 빈에 넣었을 때의 배출 거동을 판정합니다.'
              : '배합비와 공정조건을 바꾸면 완제품 외관이 실제 mm 스케일로 다시 그려집니다. 펠릿 · 크럼블 · 매쉬 · EP 전 성상 지원.'}</p>
          </div>
          <div class="module-metrics">
            ${isFlow ? `
              <div><span>${a.b.ok ? f.FI.toFixed(0) : '-'}</span><label>유동지수</label></div>
              <div><span>${a.b.ok ? (f.massFlow ? '전면' : '깔때기') : '-'}</span><label>유동 패턴</label></div>
              <div><span>${a.b.ok ? Math.round(f.Bmin) : '-'}</span><label>최소구경(mm)</label></div>
              <div><span>${a.b.ok ? f.repose.toFixed(0) : '-'}</span><label>안식각(°)</label></div>
            ` : `
              <div><span>${FORMS[state.form].label}</span><label>성상</label></div>
              <div><span>${a.b.ok ? a.diaMm.toFixed(1) : '-'}</span><label>직경(mm)</label></div>
              <div><span>${a.b.ok && !a.isMash ? a.pdi.toFixed(0) : '-'}</span><label>추정 PDI</label></div>
              <div><span>${a.b.ok ? a.fines.toFixed(1) : '-'}</span><label>미분율(%)</label></div>
            `}
          </div>
        </div>

        <div class="fa-viewtabs">
          ${Object.entries(VIEWS).map(([k, v]) => `
            <button class="fa-viewtab ${state.view === k ? 'active' : ''}" onclick="FeedAppearancePage.setView('${k}')">
              ${v.label}<em>${v.desc}</em>
            </button>`).join('')}
        </div>

        <div class="fa-notice">
          <strong>이 화면은 예측기가 아니라 시각화 도구입니다.</strong>
          ${isFlow
            ? 'Jenike 유동이론을 단순화한 것으로, 전단시험(shear cell) 실측값이 없어 항복강도를 미분·수분·유지에서 추정합니다. 조건 비교와 원인 파악에는 쓸 수 있으나 <strong>빈·호퍼 설계 근거로는 사용하지 마십시오.</strong>'
            : '전분 호화도·증기 주입량 같은 실측값이 시스템에 없어, 사료공학 경험식으로 외관을 추정해 그립니다. 추정 PDI는 반드시 옆에 표기된 실측 PDI 평균과 함께 보시고, 판정 근거로는 사용하지 마십시오.'}
        </div>

        <div class="fa-source card mb-16">
          <div class="fa-source-main">
            <div>
              <label class="form-label">배합비 불러오기</label>
              <select class="form-input" id="fa-recipe" onchange="FeedAppearancePage.onRecipe(this.value)">
                <option value="">— 원료 직접 입력 —</option>
                ${recipes.map(r => `<option value="${safe(r.id)}" ${state.recipeId === r.id ? 'selected' : ''}>${safe(r.productName || r.productCode)} · ${safe(r.version || '')} (원료 ${r.ingredients.length}종)</option>`).join('')}
              </select>
              ${recipes.length === 0 ? '<div class="fa-ctl-hint">등록된 배합비가 없습니다. 아래에 원료를 직접 입력하거나 배합비 관리에서 먼저 등록하십시오.</div>' : ''}
            </div>
            <div>
              <label class="form-label">성상</label>
              <div class="fa-form-tabs">
                ${Object.entries(FORMS).map(([k, v]) => `
                  <button class="fa-form-tab ${state.form === k ? 'active' : ''}" onclick="FeedAppearancePage.setForm('${k}')" title="${v.desc}">${v.label}</button>`).join('')}
              </div>
              <div class="fa-ctl-hint">${FORMS[state.form].desc}</div>
            </div>
          </div>
          ${state.recipeId ? '' : `
            <div class="fa-manual">
              <label class="form-label">원료 직접 입력</label>
              ${manualRows()}
              <div class="flex gap-8 mt-8">
                <button class="btn btn-sm" onclick="FeedAppearancePage.addManual()">＋ 원료 추가</button>
                <button class="btn btn-sm" onclick="FeedAppearancePage.loadPreset()">예시 배합 불러오기</button>
              </div>
            </div>`}
        </div>

        <div class="fa-layout">
          <div class="card fa-controls">
            <div class="card-title mb-12">${isFlow ? '빈 · 호퍼 조건' : '공정조건'}</div>
            ${isFlow ? FeedFlow.controls(state) : controlPanel()}
            ${isFlow ? `
              <div class="ff-inherit">
                <div class="ff-inherit-title">외관 탭에서 받아온 값</div>
                <div><label>미분율</label><span>${a.b.ok ? (a.isMash ? '전량 분체' : a.fines.toFixed(1) + ' %') : '-'}</span></div>
                <div><label>제품 수분(환산)</label><span>${a.b.ok ? f.storeMoist.toFixed(1) + ' %' : '-'}</span></div>
                <div><label>총 유지</label><span>${a.b.ok ? (a.totalFat * 100).toFixed(2) + ' %' : '-'}</span></div>
                <div><label>${a.isMash ? '평균 입경' : '알갱이 치수'}</label><span>${a.b.ok ? (a.isMash ? a.diaMm.toFixed(2) : `Ø${a.diaMm.toFixed(1)} × ${a.lenMm.toFixed(1)}`) + ' mm' : '-'}</span></div>
                <div><label>냉각 시간</label><span>${state.cool} 분</span></div>
                <div class="fa-ctl-hint">이 값들은 외관 탭의 공정조건에서 계산됩니다. 여기서 직접 고칠 수 없습니다.</div>
              </div>` : ''}
            <div class="flex gap-8 mt-12">
              <button class="btn btn-sm" onclick="FeedAppearancePage.reset()">기본값 복원</button>
              ${isFlow ? '' : `<button class="btn btn-sm btn-primary" onclick="FeedAppearancePage.snap()">현재 조건 담기</button>`}
            </div>
            ${!isFlow && state.snapshot ? `
              <div class="fa-snap">
                <div class="fa-snap-head">
                  <span>비교 기준 (담아둔 조건)</span>
                  <button class="btn btn-sm" onclick="FeedAppearancePage.clearSnap()">✕</button>
                </div>
                <canvas id="fa-canvas-snap" data-h="150"></canvas>
                <div class="fa-snap-diff" id="fa-snap-diff"></div>
              </div>` : ''}
          </div>

          <div class="fa-view">
            ${isFlow ? `
              <div class="card mb-16">
                <div class="card-title mb-12">빈 단면 — 유동 패턴</div>
                <canvas id="ff-canvas-bin" data-h="520"></canvas>
              </div>
              <div class="card">
                <div class="card-title mb-12">안식각 — 쏟았을 때 쌓이는 모양</div>
                <canvas id="ff-canvas-repose" data-h="210"></canvas>
              </div>
            ` : `
              <div class="card mb-16">
                <div class="fa-view-head mb-12">
                  <div class="card-title">확대 — 알갱이 한 알 <span class="fa-dims-cap" id="fa-macro-dims"></span></div>
                  <div class="fa-render-tabs">
                    <button class="fa-render-tab ${state.render3d ? 'active' : ''}" onclick="FeedAppearancePage.setRender(true)">3D 실사</button>
                    <button class="fa-render-tab ${state.render3d ? '' : 'active'}" onclick="FeedAppearancePage.setRender(false)">2D 도식</button>
                  </div>
                </div>
                <canvas id="fa-canvas-macro" data-h="${state.render3d ? 300 : 230}"></canvas>
              </div>
              <div class="card">
                <div class="card-title mb-12">샘플 트레이 — 실제 스케일</div>
                <canvas id="fa-canvas-tray" data-h="${state.render3d ? 400 : 330}"></canvas>
                <div class="fa-3d-hint" id="fa-3d-hint"></div>
              </div>
            `}
          </div>

          <div class="card fa-metrics">
            <div class="card-title mb-12">${isFlow ? '흐름성 지표' : '외관 지표'}</div>
            <div id="fa-metrics-body">${isFlow ? FeedFlow.metrics(f) : metricsPanel(a)}</div>
          </div>
        </div>

        <div class="card mt-16">
          <div class="card-title mb-12">${isFlow ? '개선 제안 — 우선순위 순' : '원료별 외관 기여'}</div>
          <div id="fa-contrib">${isFlow ? FeedFlow.advice(f) : contribTable(a)}</div>
        </div>

        ${materialDatalist()}
      </div>`;
  };

  // ============================================================
  // 9. 이벤트
  // ============================================================
  let raf = null;

  // 슬라이더는 페이지를 다시 그리지 않는다 — 포커스가 날아가 드래그가 끊긴다.
  // 캔버스와 지표만 갱신한다.
  const paint = () => {
    const a = calcAppearance(state);
    const m = document.getElementById('fa-metrics-body');
    const c = document.getElementById('fa-contrib');

    if (state.view === 'flow') {
      const f = FeedFlow.calc(a, state);
      const bin = document.getElementById('ff-canvas-bin');
      const rep = document.getElementById('ff-canvas-repose');
      if (bin) FeedFlow.renderBin(bin, f);
      if (rep) FeedFlow.renderRepose(rep, f);
      if (m) m.innerHTML = FeedFlow.metrics(f);
      if (c) c.innerHTML = FeedFlow.advice(f);
      return;
    }

    const is3D = drawView('fa-canvas-macro', a, 'macro', renderMacro);
    drawView('fa-canvas-tray', a, 'tray', renderTray);
    paintHint(a, is3D);
    if (m) m.innerHTML = metricsPanel(a);
    if (c) c.innerHTML = contribTable(a);
    paintSnapshot(a);
  };

  // 슬라이더 연속 입력만 rAF 로 묶는다.
  // 첫 페인트까지 rAF 에 맡기면 백그라운드 탭·비활성 창에서 rAF 가 멈춰
  // 화면에 돌아왔을 때 캔버스가 기본 300x150 빈 상태로 남는다.
  const repaint = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = null; paint(); });
  };

  const paintSnapshot = (a) => {
    if (!state.snapshot) return;
    drawView('fa-canvas-snap', calcAppearance(state.snapshot), 'snap', renderTray);
    const el = document.getElementById('fa-snap-diff');
    if (!el) return;
    const s = calcAppearance(state.snapshot);
    if (!s.b.ok || !a.b.ok) { el.innerHTML = ''; return; }
    const d = (label, now, base, unit, digits) => {
      const diff = now - base;
      const tone = Math.abs(diff) < 0.05 ? '' : diff > 0 ? 'up' : 'down';
      return `<div><label>${label}</label><span class="${tone}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(digits ?? 1)}${unit}</span></div>`;
    };
    el.innerHTML = d('PDI', a.pdi, s.pdi, '%p')
      + d('미분율', a.fines, s.fines, '%p')
      + d('광택', a.gloss * 100, s.gloss * 100, '%p', 0)
      + d('크랙', a.crack * 100, s.crack * 100, '%p', 0);
  };

  // 3D 상태 안내 — 조작법, 또는 2D 로 대체된 이유
  const paintHint = (a, is3D) => {
    const el = document.getElementById('fa-3d-hint');
    const dims = document.getElementById('fa-macro-dims');
    if (dims) {
      dims.textContent = !a.b.ok || !is3D ? ''
        : a.isMash ? `Dgw ${a.diaMm.toFixed(2)} mm`
        : a.form === 'crumble' ? `조각 ${a.lenMm.toFixed(2)} mm`
        : a.isEP ? `Ø ${a.diaMm.toFixed(2)} mm`
        : `Ø ${a.diaMm.toFixed(2)} × L ${a.lenMm.toFixed(2)} mm`;
    }
    if (!el) return;
    if (!state.render3d || !a.b.ok) { el.textContent = ''; return; }
    if (is3D) {
      el.textContent = matchMedia('(pointer: coarse)').matches
        ? '한 번 누르면 회전·확대 조작이 켜집니다 · 아래 눈금자는 실제 크기 기준'
        : '드래그 회전 · 휠 확대 · 우클릭 드래그 이동 · 더블클릭 원위치 · 아래 눈금자는 실제 크기 기준';
    } else if (has3D() && !FeedAppearance3D.ready()) {
      el.textContent = '3D 렌더러 불러오는 중… (사내망에서 불러오지 못하면 2D 도식으로 표시됩니다)';
    } else {
      el.textContent = '3D 를 쓸 수 없는 환경이라 2D 도식으로 표시했습니다.';
    }
  };

  const setRender = (on) => {
    state.render3d = !!on;
    App.refreshPage();
  };

  // 3D 렌더러는 외관 화면을 처음 열 때 불러온다. 다 받으면 그 자리에서 3D 로 갈아 그린다.
  const ensure3D = () => {
    if (!state.render3d || !has3D() || FeedAppearance3D.ready()) return;
    FeedAppearance3D.load().then(ok => {
      if (document.getElementById('fa-canvas-tray') && state.view === 'appearance') {
        if (ok) repaint(); else paintHint(calcAppearance(state), false);
      }
    });
  };

  const onSlide = (key, value, unit) => {
    state[key] = Number(value);
    const el = document.getElementById('fa-val-' + key);
    if (el) el.textContent = value + (unit || '');
    repaint();
  };

  const setView = (v) => {
    if (!VIEWS[v]) return;
    state.view = v;
    App.refreshPage();
  };

  // 빈 조건은 셀렉트·체크박스라 슬라이더와 별도 핸들러가 필요하다.
  // 배출구 라벨(슬롯폭/직경)이 호퍼 형식에 따라 바뀌므로 형식 변경은 전체를 다시 그린다.
  const onFlowSelect = (key, value) => {
    state[key] = value;
    if (key === 'bin') App.refreshPage(); else repaint();
  };
  const onFlowToggle = (key, on) => { state[key] = !!on; repaint(); };

  const setForm = (f) => {
    if (!FORMS[f]) return;
    state.form = f;
    // 성상마다 통상 조건대가 다르다 — 탭을 바꾸면 그 성상의 기본값으로 맞춰준다
    if (f === 'ep')        Object.assign(state, { temp: 125, moist: 24, press: 60, die: 3.0, reten: 25, cool: 12, postFat: 6, grind: 0.5 });
    else if (f === 'mash') Object.assign(state, { grind: 0.75, postFat: 1.0 });
    else if (f === 'crumble') Object.assign(state, { temp: 80, moist: 16, reten: 30, die: 3.2, ld: 9, cut: 1.8, cool: 10, postFat: 1.0, grind: 0.7 });
    else                   Object.assign(state, { temp: 82, moist: 16, reten: 30, die: 4.0, ld: 9, cut: 1.8, cool: 10, postFat: 1.0, grind: 0.75 });
    App.refreshPage();
  };

  const onRecipe = (id) => { state.recipeId = id; App.refreshPage(); };

  const onManual = (idx, field, value) => {
    if (!state.manual[idx]) state.manual[idx] = { name: '', pct: '' };
    state.manual[idx][field] = field === 'pct' ? (value === '' ? '' : Number(value)) : value;
    repaint();
  };

  const addManual = () => { state.manual.push({ name: '', pct: '' }); App.refreshPage(); };

  const removeManual = (idx) => {
    state.manual.splice(idx, 1);
    App.refreshPage();
  };

  // 등록 배합비가 없는 환경에서도 화면이 바로 의미를 갖도록 하는 표준 예시
  const loadPreset = () => {
    state.manual = [
      { name: '옥수수', pct: 45 },
      { name: '소맥', pct: 12 },
      { name: '대두박', pct: 18 },
      { name: '채종박', pct: 6 },
      { name: '소맥피', pct: 8 },
      { name: '주정박(DDGS)', pct: 5 },
      { name: '당밀', pct: 2 },
      { name: '동물성유지', pct: 1.5 },
      { name: '석회석', pct: 1.2 },
      { name: '인산칼슘', pct: 0.6 },
      { name: '식염', pct: 0.3 },
      { name: '비타민미네랄 프리믹스', pct: 0.4 },
    ];
    App.refreshPage();
    App.toast('예시 배합(육성돈 기준 유사)을 불러왔습니다', 'success');
  };

  const reset = () => {
    // 흐름성 탭에서는 빈 조건만 되돌린다 — 공정조건까지 날리면 외관 탭 작업이 사라진다
    if (state.view === 'flow') {
      Object.assign(state, FeedFlow.DEFAULTS);
      App.refreshPage();
      App.toast('빈·호퍼 조건을 기본값으로 복원했습니다', 'success');
      return;
    }
    Object.assign(state, DEFAULTS, { form: state.form });
    setForm(state.form);
  };

  const snap = () => {
    state.snapshot = JSON.parse(JSON.stringify({ ...state, snapshot: null }));
    App.refreshPage();
    App.toast('현재 조건을 비교 기준으로 담았습니다', 'success');
  };

  const clearSnap = () => { state.snapshot = null; App.refreshPage(); };

  const afterRender = () => {
    paint();
    ensure3D();
    if (!afterRender._bound) {
      afterRender._bound = true;
      // 창 크기가 바뀌면 캔버스 폭이 달라진다 — DPR 보정을 다시 태워야 흐려지지 않는다
      window.addEventListener('resize', () => {
        if (document.getElementById('fa-canvas-tray') || document.getElementById('ff-canvas-bin')) repaint();
      });
    }
  };

  return {
    render, afterRender,
    onSlide, setForm, setView, onFlowSelect, onFlowToggle,
    onRecipe, onManual, addManual, removeManual,
    loadPreset, reset, snap, clearSnap, setRender,
  };
})();
