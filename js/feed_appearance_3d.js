// ============================================================
// feed_appearance_3d.js — 사료 외관 3D 렌더러 (실물 사진 근사)
//
//   feed_appearance.js 가 계산한 외관 지표(색·광택·거칠기·크랙·팽화도·치수)를
//   받아 three.js 로 실제 3D 장면을 그린다. 계산식은 그쪽에 있고 여기는 그리기만 한다.
//
//   ── 사진처럼 보이게 하는 요소 ──
//   · 알갱이 형상 : 펠릿은 다이 자국이 난 원기둥 + 커터에 부러진 거친 끝면,
//                   크럼블은 파쇄면이 살아 있는 조각, EP 는 칼로 잘린 팽화립,
//                   매쉬는 가루 바닥 위에 입도 분포대로 흩어진 입자
//   · 표면 질감   : 셰이더에서 3D 노이즈로 색 얼룩·섬유 반점·광물 알갱이·크랙·기공을
//                   만들고, 같은 높이값으로 법선을 흔들어 요철을 낸다(텍스처 파일 없음)
//   · 쌓임        : 높이맵 위에 하나씩 떨어뜨려 서로 기대어 쌓이게 한다
//   · 조명·촬영   : 스튜디오 반사광 + 부드러운 그림자 + 틈새 차폐(GTAO),
//                   확대 뷰는 접사처럼 초점 밖을 흐린다. 옆에 mm 눈금자를 둔다.
//
//   단위는 mm. three.js 는 화면을 처음 열 때 CDN 에서 불러오며(index.html importmap),
//   못 불러오면 ready() 가 false 로 남아 호출부가 기존 2D 그림을 쓴다.
// ============================================================

const FeedAppearance3D = (() => {
  let T = null, M = null;          // three 모듈, 애드온 묶음
  let loading = null, failed = false;

  const load = () => {
    if (T) return Promise.resolve(true);
    if (failed) return Promise.resolve(false);
    if (!loading) {
      loading = (async () => {
        try {
          const probe = document.createElement('canvas');
          if (!probe.getContext('webgl2')) throw new Error('WebGL2 미지원 기기');
          const [three, env, comp, rpass, gtao, bokeh, outp, ctrl, bgu] = await Promise.all([
            import('three'),
            import('three/addons/environments/RoomEnvironment.js'),
            import('three/addons/postprocessing/EffectComposer.js'),
            import('three/addons/postprocessing/RenderPass.js'),
            import('three/addons/postprocessing/GTAOPass.js'),
            import('three/addons/postprocessing/BokehPass.js'),
            import('three/addons/postprocessing/OutputPass.js'),
            import('three/addons/controls/OrbitControls.js'),
            import('three/addons/utils/BufferGeometryUtils.js'),
          ]);
          T = three;
          M = {
            RoomEnvironment: env.RoomEnvironment, EffectComposer: comp.EffectComposer,
            RenderPass: rpass.RenderPass, GTAOPass: gtao.GTAOPass, BokehPass: bokeh.BokehPass,
            OutputPass: outp.OutputPass, OrbitControls: ctrl.OrbitControls,
            mergeVertices: bgu.mergeVertices,
          };
          return true;
        } catch (e) {
          failed = true;
          console.warn('[외관 3D] 3D 렌더러를 불러오지 못해 2D 로 표시합니다 —', e && e.message);
          return false;
        }
      })();
    }
    return loading;
  };

  const ready = () => !!T;

  // ============================================================
  // 1. 노이즈 (형상 변형용) — 시드 고정이라 조건을 바꿔도 알갱이 생김새가 유지된다
  // ============================================================
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  const hash3 = (x, y, z) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  // 형상 하나에 수만 번 불린다 — 호출마다 함수 객체를 만들지 않도록 풀어서 쓴다
  const vnoise = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi;
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
    const a0 = hash3(xi, yi, zi),         a1 = hash3(xi + 1, yi, zi);
    const b0 = hash3(xi, yi + 1, zi),     b1 = hash3(xi + 1, yi + 1, zi);
    const c0 = hash3(xi, yi, zi + 1),     c1 = hash3(xi + 1, yi, zi + 1);
    const d0 = hash3(xi, yi + 1, zi + 1), d1 = hash3(xi + 1, yi + 1, zi + 1);
    const ab = (a0 + (a1 - a0) * xf) + ((b0 + (b1 - b0) * xf) - (a0 + (a1 - a0) * xf)) * yf;
    const cd = (c0 + (c1 - c0) * xf) + ((d0 + (d1 - d0) * xf) - (c0 + (c1 - c0) * xf)) * yf;
    return ab + (cd - ab) * zf;
  };
  const fbm = (x, y, z, oct = 4) => {
    let a = 0.5, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, z); n += a; x = x * 2.03 + 1.7; y = y * 2.03 + 9.2; z = z * 2.03 + 3.1; a *= 0.5; }
    return s / n;
  };
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-6))) * Math.cos(2 * Math.PI * rand());

  // ============================================================
  // 2. 사료 재질 — 물리 기반 재질에 표면 질감 셰이더를 끼워 넣는다
  // ============================================================
  const GLSL_COMMON = `
    uniform float uDetail, uLoose, uGrainFreq, uFreq, uSpeckFreq, uSpeck, uGrit, uVar, uBump, uCrack, uCrackFreq, uPore, uPoreFreq, uPoreR;
    varying vec3 vLocal; varying float vSeed; varying float vCap;
    float fa_h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
    float fa_vn(vec3 p) {
      vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(fa_h13(i), fa_h13(i + vec3(1,0,0)), f.x), mix(fa_h13(i + vec3(0,1,0)), fa_h13(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(fa_h13(i + vec3(0,0,1)), fa_h13(i + vec3(1,0,1)), f.x), mix(fa_h13(i + vec3(0,1,1)), fa_h13(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float fa_fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * fa_vn(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
    // 눌려 붙은 원료 입자 — 가장 가까운 두 점까지 거리와 그 입자의 고유값
    vec3 fa_cell(vec3 p) {
      vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0, id = 0.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(fa_h13(i + g), fa_h13(i + g + 17.1), fa_h13(i + g + 41.7));
        vec3 r = g + o - f; float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = fa_h13(i + g + 73.3); } else if (d < d2) { d2 = d; }
      }
      return vec3(sqrt(d1), sqrt(d2), id);
    }
    float fa_worley(vec3 p) {
      vec3 i = floor(p), f = fract(p); float d = 1.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(fa_h13(i + g), fa_h13(i + g + 17.1), fa_h13(i + g + 41.7));
        vec3 r = g + o - f; d = min(d, dot(r, r));
      }
      return sqrt(d);
    }`;

  const GLSL_SURFACE = `
    vec3 faP = vLocal;
    vec3 faS = fract(vec3(vSeed * 0.1271, vSeed * 0.3737, vSeed * 0.7191)) * 97.0;
    float faInst = fa_h13(faS + 3.7);
    float faN = fa_fbm(faP * uFreq + faS);
    float faFine = fa_vn(faP * uFreq * 5.3 + faS.yzx);
    // 알갱이마다 조금씩 다른 색 + 표면 얼룩
    vec3 faCol = diffuseColor.rgb * (1.0 + (faInst - 0.5) * uVar) * (0.84 + 0.32 * faN);
    // 원료 입자 결 — 입자마다 색이 조금씩 다르고 경계가 살짝 파인다
    // 입자 결은 셀 계산이 무겁다 — 알갱이가 작게 보이는 트레이에서는 값 노이즈로 대신한다
    vec3 faG = vec3(0.0, 1.0, 0.5);
    if (uDetail > 0.5 || uLoose > 0.5) faG = fa_cell(faP * uGrainFreq + faS * 0.37);
    else faG.z = fa_vn(faP * uGrainFreq + faS * 0.37);
    // 압착된 표면이라 경계는 거의 안 보이고, 입자마다 색만 조금 다르다
    float faEdge = 1.0 - smoothstep(0.0, 0.22, faG.y - faG.x);
    faCol *= 1.0 + (faG.z - 0.5) * mix(0.16, 0.26, step(0.5, uLoose));
    faCol *= 1.0 - faEdge * mix(0.012, 0.10, step(0.5, uLoose));
    // 매쉬 — 원료마다 색이 다른 가루. 입자(또는 바닥의 셀)마다 원료를 하나씩 정한다.
    if (uLoose > 0.5) {
      float k = uLoose > 1.5 ? faG.z : faInst;
      if (k < 0.11)      faCol *= vec3(0.82, 0.70, 0.56);                     // 밀기울·박류 껍질
      else if (k < 0.14) faCol = mix(faCol, vec3(0.90, 0.89, 0.85), 0.50);    // 석회석·광물
      else if (k > 0.86) faCol *= vec3(1.06, 0.98, 0.80);                     // 옥수수 분쇄 알갱이
      faCol *= 0.92 + 0.16 * fa_vn(faP * uGrainFreq * 3.1 + faS);             // 셀 안의 잔가루 얼룩
    }
    // 섬유질(어두운 반점)·광물 알갱이(흰 반점)
    float faSk  = fa_vn(faP * uSpeckFreq + faS.zxy);
    float faSk2 = fa_vn(faP * uSpeckFreq * 1.7 + faS + 11.0);
    float faDark  = smoothstep(1.0 - uSpeck * 0.32, 1.0 - uSpeck * 0.32 + 0.05, faSk);
    float faLight = smoothstep(1.0 - uGrit * 0.22, 1.0 - uGrit * 0.22 + 0.04, faSk2);
    faCol = mix(faCol, faCol * vec3(0.55, 0.50, 0.46), faDark * 0.85);
    faCol = mix(faCol, mix(faCol, vec3(0.92, 0.90, 0.85), 0.6), faLight * 0.8);
    // 파단면 — 겉보다 열을 덜 받아 밝고 거칠다
    faCol = mix(faCol, faCol * 1.10, vCap * 0.7);
    float fH = (faN - 0.5) * uBump * (1.0 + vCap * 1.6) + (faFine - 0.5) * uBump * 0.45
             - faDark * uBump * 0.6 + faLight * uBump * 0.4
             - faEdge * uBump * mix(0.10 + vCap * 0.12, 0.9, step(0.5, uLoose)) + (faG.z - 0.5) * uBump * 0.3;
    // 표면 크랙 — 부분적으로만 갈라진다
    if (uCrack > 0.15) {
      float c1 = fa_vn(faP * uCrackFreq + faS);
      float ln = 1.0 - smoothstep(0.0, 0.018 + 0.012 * uCrack, abs(c1 - 0.5));
      float gt = smoothstep(0.62 - uCrack * 0.35, 0.72 - uCrack * 0.35, fa_vn(faP * uCrackFreq * 0.31 + faS.zyx));
      float cm = ln * gt * (1.0 - vCap);
      faCol *= 1.0 - cm * 0.45;
      fH -= cm * uBump * 2.0;
    }
    // EP 기공 — 팽화로 터진 구멍
    if (uPore > 0.0) {
      float w = fa_worley(faP * uPoreFreq + faS);
      float pm = 1.0 - smoothstep(uPoreR * 0.55, uPoreR, w);
      faCol *= 1.0 - pm * 0.42;
      fH -= pm * uBump * 2.5;
    }
    diffuseColor.rgb = faCol;`;

  // 높이값의 화면 미분으로 법선을 흔든다(텍스처 없는 범프). 높이는 mm, 위치도 mm 라 비율이 맞다.
  const GLSL_NORMAL = `
    {
      vec3 sX = dFdx(-vViewPosition); vec3 sY = dFdy(-vViewPosition);
      vec3 R1 = cross(sY, normal); vec3 R2 = cross(normal, sX);
      float det = dot(sX, R1) * faceDirection;
      vec2 dH = vec2(dFdx(fH), dFdy(fH));
      vec3 g = sign(det) * (dH.x * R1 + dH.y * R2);
      normal = normalize(abs(det) * normal - g);
    }`;

  const makeFeedMaterial = (u, seedOff) => {
    const mat = new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
    // 재질마다 값을 따로 가진다 — 공유하면 가루 바닥 설정이 입자 재질에도 번진다
    const uni = { uSeedOff: { value: seedOff }, uDetail: { value: 1 } };
    Object.keys(u).forEach(k => { uni[k] = { value: u[k].value }; });
    mat.userData.uni = uni;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aCap; uniform float uSeedOff;
          varying vec3 vLocal; varying float vSeed; varying float vCap;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLocal = position; vCap = aCap;
          #ifdef USE_INSTANCING
            vSeed = float(gl_InstanceID) + uSeedOff;
          #else
            vSeed = uSeedOff;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GLSL_SURFACE)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor + faDark * 0.12 + vCap * 0.18 + (faFine - 0.5) * 0.12, 0.05, 1.0);`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GLSL_NORMAL);
    };
    mat.customProgramCacheKey = () => 'feed3d-surface-v1';
    return mat;
  };

  // 외관 지표 → 재질 값
  const surfaceParams = (a, opt) => {
    const D = Math.max(a.isMash ? a.diaMm : Math.min(a.diaMm, a.lenMm || a.diaMm), 0.2);
    const grind = Math.max(opt.grind || 0.75, 0.2);
    const fiber = a.b.fiber || 0, grit = a.b.grit || 0;
    return {
      color: a.rgb,
      roughness: clamp(0.93 - a.gloss * 0.62, 0.26, 0.96),
      // 유지 코팅 광택 — 세게 주면 가장자리가 회색 금속처럼 반사된다
      clearcoat: clamp((a.gloss - 0.22) * 0.9, 0, 0.5),
      clearcoatRoughness: clamp(0.55 - a.gloss * 0.2, 0.3, 0.55),
      u: {
        uLoose:     { value: a.isMash ? 1 : 0 },
        uGrainFreq: { value: (a.isMash ? 1.6 : 2.4) / grind },
        uFreq:      { value: 1.15 / grind },
        uSpeckFreq: { value: 2.6 / grind },
        uSpeck:     { value: clamp(a.rough * 0.85 + fiber * 3.0, 0.06, 0.95) },
        uGrit:      { value: clamp(grit * 0.9 + 0.08, 0.05, 0.8) },
        uVar:       { value: a.isMash ? 0.10 : 0.16 },
        uBump:      { value: clamp(D * (0.005 + a.rough * 0.016), 0.004, 0.4) },
        uCrack:     { value: a.isMash || a.isEP ? 0 : a.crack },
        uCrackFreq: { value: 1.6 / D },
        uPore:      { value: a.isEP ? 1 : 0 },
        uPoreFreq:  { value: (8.0 + a.expand * 5) / Math.max(a.diaMm, 0.5) },
        uPoreR:     { value: clamp(0.13 + a.expand * 0.09, 0.10, 0.26) },
      },
    };
  };

  const applySurface = (mat, sp) => {
    mat.color.setRGB(sp.color[0] / 255, sp.color[1] / 255, sp.color[2] / 255, T.SRGBColorSpace);
    mat.roughness = sp.roughness;
    mat.clearcoat = sp.clearcoat;
    mat.clearcoatRoughness = sp.clearcoatRoughness;
    const uni = mat.userData.uni;
    Object.keys(sp.u).forEach(k => { uni[k].value = sp.u[k].value; });
    if (mat.userData.bed) uni.uLoose.value = 2;
  };

  // ============================================================
  // 3. 알갱이 형상
  // ============================================================
  // 위치로 정한 변형이라 이음매 정점이 같이 움직인다 → 합친 뒤 법선을 다시 계산
  const finish = (geo, capArr) => {
    geo.setAttribute('aCap', new T.Float32BufferAttribute(capArr, 1));
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    const g = M.mergeVertices(geo, 1e-4);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };

  // 펠릿 — 원기둥을 옆으로 돌려 만든다(회전축 Y). 끝면은 커터에 부러진 파단면.
  const buildPellet = (D, L, seed, p) => {
    const R = D / 2, bev = R * p.bev;
    const pts = [];
    const capRings = p.capRings || 14, arc = p.arc || 5;
    const sideN = Math.max(4, Math.round(L / D * (p.sideK || 9)));
    for (let i = 0; i <= capRings; i++) pts.push(new T.Vector2((R - bev) * i / capRings, -L / 2));
    for (let i = 1; i <= arc; i++) { const t = -Math.PI / 2 + Math.PI / 2 * i / arc; pts.push(new T.Vector2(R - bev + bev * Math.cos(t), -L / 2 + bev + bev * Math.sin(t))); }
    for (let i = 1; i < sideN; i++) pts.push(new T.Vector2(R, -L / 2 + bev + (L - 2 * bev) * i / sideN));
    for (let i = 0; i < arc; i++) { const t = Math.PI / 2 * i / arc; pts.push(new T.Vector2(R - bev + bev * Math.cos(t), L / 2 - bev + bev * Math.sin(t))); }
    for (let i = capRings; i >= 0; i--) pts.push(new T.Vector2((R - bev) * i / capRings, L / 2));

    const geo = new T.LatheGeometry(pts, p.radial);
    const pos = geo.attributes.position;
    const cap = new Float32Array(pos.count);
    const fs = 3.0 / D, fc = 5.0 / D, sx = seed * 13.7;
    const tilt = [(hash3(seed, 1, 2) - 0.5) * 0.35, (hash3(seed, 3, 4) - 0.5) * 0.35,
                  (hash3(seed, 5, 6) - 0.5) * 0.35, (hash3(seed, 7, 8) - 0.5) * 0.35];
    const stripes = Math.max(10, Math.round(D * 4.5));
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const r = Math.hypot(x, z), th = Math.atan2(z, x);
      const capW = smooth(L / 2 - bev * 1.3, L / 2, Math.abs(y));
      const sideW = 1 - capW;
      const n = fbm(x * fs + sx, y * fs, z * fs);
      // 몸통: 미세 요철 + 다이 통과 줄무늬
      // 다이를 통과한 몸통은 매끈하다 — 요철은 아주 얕게, 줄무늬는 머리카락 굵기로
      const dr = (n - 0.5) * D * 0.014 * p.rough
        + p.stri * D * 0.0045 * Math.sin(th * stripes + n * 3.0);
      // 끝면: 비스듬한 절단 + 뜯긴 요철
      const top = y > 0;
      const tx = top ? tilt[0] : tilt[2], tz = top ? tilt[1] : tilt[3];
      // 커터에 부러진 면 — 큰 굴곡(뜯겨 나간 덩어리) + 잘게 부서진 요철
      const nc = fbm(x * fc * 0.45 + sx + (top ? 5 : 0), z * fc * 0.45, seed * 3.1, 3);
      const nf = fbm(x * fc * 1.8 + sx, z * fc * 1.8, seed * 5.3 + (top ? 2 : 0), 4);
      const dy = (top ? 1 : -1) * ((nc - 0.5) * D * 0.26 * p.brk + (nf - 0.5) * D * 0.10 * p.brk) + (tx * x + tz * z);
      const rimTear = (fbm(th * 2.0 + sx, y * fc, 7.7, 3) - 0.5) * D * 0.08 * p.brk * capW;
      if (r > 1e-5) {
        const nr = r + dr * sideW + rimTear;
        x = nr * Math.cos(th); z = nr * Math.sin(th);
      }
      y = y + dy * capW;
      pos.setXYZ(i, x, y, z);
      cap[i] = smooth(0.25, 0.85, capW);
    }
    return finish(geo, cap);
  };

  // 크럼블 조각 — 부풀린 구에 파단 평면 몇 개를 쳐서 각진 조각으로 만든다
  const buildChunk = (S, seed, detail, angular, flat = 1) => {
    const geo = new T.IcosahedronGeometry(1, detail);
    const pos = geo.attributes.position;
    const cap = new Float32Array(pos.count);
    const r = rng(seed * 7919 + 13);
    const sc = [0.8 + r() * 0.5, (0.55 + r() * 0.35) * flat, 0.8 + r() * 0.5];
    const planes = [];
    const nPl = angular ? 3 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
    for (let k = 0; k < nPl; k++) {
      const v = new T.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      planes.push({ n: v, d: angular ? 0.45 + r() * 0.35 : 0.7 + r() * 0.2 });
    }
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = fbm(v.x * 1.7 + seed, v.y * 1.7, v.z * 1.7, 3);
      v.multiplyScalar(1 + (n - 0.5) * 0.35);
      let flat = 0;
      planes.forEach(pl => {
        const dd = v.dot(pl.n) - pl.d;
        if (dd > 0) { v.addScaledVector(pl.n, -dd); flat = 1; }
      });
      v.set(v.x * sc[0], v.y * sc[1], v.z * sc[2]).multiplyScalar(S / 2);
      const f2 = fbm(v.x * 4 / S + seed, v.y * 4 / S, v.z * 4 / S, 3);
      v.multiplyScalar(1 + (f2 - 0.5) * 0.06);
      pos.setXYZ(i, v.x, v.y, v.z);
      cap[i] = flat;
    }
    return finish(geo, cap);
  };

  // 크럼블 — 펠릿(원기둥)을 롤로 부순 조각. 원기둥에서 시작해 파단 평면으로 잘라낸다.
  //   한쪽엔 매끈한 펠릿 겉면, 나머지는 각진 파단면이 남는다.
  const buildCrumb = (S, seed, detail) => {
    const geo = new T.IcosahedronGeometry(1, detail);
    const pos = geo.attributes.position;
    const cap = new Float32Array(pos.count);
    const r = rng(seed * 6007 + 3);
    const planes = [];
    const nPl = 3 + Math.floor(r() * 2);
    for (let k = 0; k < nPl; k++) {
      const v = new T.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize();
      planes.push({ n: v, d: 0.12 + r() * 0.42 });
    }
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      // 구 → 원기둥(반지름 1, 반높이 0.9)
      const radial = Math.hypot(v.x, v.z);
      const t = Math.max(radial, Math.abs(v.y) / 0.9, 1e-4);
      v.divideScalar(t);
      let c = Math.abs(v.y) > 0.88 ? 0.6 : 0;      // 원래 펠릿 끝면
      planes.forEach(pl => {
        const dd = v.dot(pl.n) - pl.d;
        if (dd > 0) { v.addScaledVector(pl.n, -dd); c = 1; }
      });
      const n = fbm(v.x * 3.2 + seed, v.y * 3.2, v.z * 3.2, 3);
      v.multiplyScalar((1 + (n - 0.5) * (c > 0.9 ? 0.10 : 0.03)) * S / 2);
      pos.setXYZ(i, v.x, v.y, v.z);
      cap[i] = c;
    }
    return finish(geo, cap);
  };

  // EP — 압출물을 칼로 자른 팽화립. 몸통은 부풀고, 양쪽 절단면은 납작하고 거칠다.
  const buildEP = (Dm, seed, wob, segs) => {
    const R = Dm / 2;
    const geo = new T.SphereGeometry(1, segs, Math.round(segs * 0.66));
    const pos = geo.attributes.position;
    const cap = new Float32Array(pos.count);
    const r = rng(seed * 104729 + 7);
    const cutA = 0.70 + r() * 0.12, cutB = 0.70 + r() * 0.12;
    const v = new T.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = fbm(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4, 3);
      v.multiplyScalar(1 + (n - 0.5) * 2 * wob);
      let c = 0;
      if (v.y > cutA) { v.y = cutA + (v.y - cutA) * 0.08; c = 1; }
      if (v.y < -cutB) { v.y = -cutB + (v.y + cutB) * 0.08; c = 1; }
      v.x *= 1.0; v.z *= 0.96;
      pos.setXYZ(i, v.x * R, v.y * R, v.z * R);
      cap[i] = c;
    }
    return finish(geo, cap);
  };

  // ============================================================
  // 4. 쌓기 — 높이맵 위에 하나씩 떨어뜨린다
  // ============================================================
  class HeightField {
    constructor(w, d, cell) {
      this.cell = cell; this.w = w; this.d = d;
      this.nx = Math.ceil(w / cell) + 1; this.nz = Math.ceil(d / cell) + 1;
      this.h = new Float32Array(this.nx * this.nz);
    }
    idx(x, z) {
      const i = Math.round((x + this.w / 2) / this.cell), k = Math.round((z + this.d / 2) / this.cell);
      if (i < 0 || k < 0 || i >= this.nx || k >= this.nz) return -1;
      return k * this.nx + i;
    }
    get(x, z) { const i = this.idx(x, z); return i < 0 ? 0 : this.h[i]; }
    maxIn(x, z, r) {
      let m = 0; const c = this.cell;
      for (let dz = -r; dz <= r; dz += c) for (let dx = -r; dx <= r; dx += c) {
        if (dx * dx + dz * dz > r * r) continue;
        m = Math.max(m, this.get(x + dx, z + dz));
      }
      return m;
    }
    raise(x0, x1, z0, z1, fn) {
      const c = this.cell, hw = this.w / 2, hd = this.d / 2;
      const i0 = Math.max(0, Math.floor((x0 + hw) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x1 + hw) / c));
      const k0 = Math.max(0, Math.floor((z0 + hd) / c)), k1 = Math.min(this.nz - 1, Math.ceil((z1 + hd) / c));
      for (let k = k0; k <= k1; k++) {
        const z = k * c - hd, row = k * this.nx;
        for (let i = i0; i <= i1; i++) {
          const t = fn(i * c - hw, z);
          if (t > this.h[row + i]) this.h[row + i] = t;
        }
      }
    }
  }

  const UP = () => new T.Vector3(0, 1, 0);

  // 원기둥 하나를 눕혀서 놓는다 — 양 끝이 받치는 높이 차만큼 기울어진다
  const placeCylinder = (hf, x, z, yaw, L, R, rand) => {
    const ux = Math.cos(yaw), uz = Math.sin(yaw), vx = -uz, vz = ux;
    const s = [];
    for (let i = 0; i <= 8; i++) {
      const t = -L / 2 + L * i / 8;
      for (const w of [-0.65, 0, 0.65]) s.push([t, hf.get(x + ux * t + vx * w * R, z + uz * t + vz * w * R)]);
    }
    let hA = 0, hB = 0;
    s.forEach(([t, h]) => { if (t < 0) hA = Math.max(hA, h); else hB = Math.max(hB, h); });
    const slope = clamp((hB - hA) / Math.max(L, 1e-3), -0.5, 0.5);
    let yc = R;
    s.forEach(([t, h]) => { yc = Math.max(yc, h - slope * t + R); });
    const ext = L / 2 + R;
    hf.raise(x - ext, x + ext, z - ext, z + ext, (px, pz) => {
      const dx = px - x, dz = pz - z;
      const t = dx * ux + dz * uz, d = dx * vx + dz * vz;
      if (Math.abs(t) > L / 2 || Math.abs(d) >= R) return -1;
      return yc + slope * t + Math.sqrt(R * R - d * d);
    });
    const pitch = Math.atan(slope);
    const dir = new T.Vector3(ux * Math.cos(pitch), Math.sin(pitch), uz * Math.cos(pitch)).normalize();
    const q = new T.Quaternion().setFromUnitVectors(UP(), dir)
      .multiply(new T.Quaternion().setFromAxisAngle(UP(), rand() * Math.PI * 2));
    return { pos: new T.Vector3(x, yc, z), q };
  };

  // 형상 표본점 — 돌린 뒤 실제로 바닥에 닿는 점을 찾는 데 쓴다
  const samplePoints = (geo, n = 140) => {
    const p = geo.attributes.position, step = Math.max(1, Math.floor(p.count / n)), out = [];
    for (let i = 0; i < p.count; i += step) out.push(new T.Vector3().fromBufferAttribute(p, i));
    return out;
  };

  // 덩어리(크럼블·EP) — 무작위로 돌린 실제 형상의 아랫점들이 받침에 닿는 높이에 얹는다.
  //   반지름으로 어림하면 돌린 방향에 따라 공중에 뜨거나 파묻힌다.
  const placeLump = (hf, x, z, pts, s, rand) => {
    const q = new T.Quaternion().setFromEuler(new T.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2));
    const rot = pts.map(p => p.clone().applyQuaternion(q).multiplyScalar(s));
    let yc = 0, top = 0, rad = 0;
    rot.forEach(p => {
      yc = Math.max(yc, hf.get(x + p.x, z + p.z) - p.y);
      top = Math.max(top, p.y);
      rad = Math.max(rad, Math.hypot(p.x, p.z));
    });
    hf.raise(x - rad, x + rad, z - rad, z + rad, (px, pz) => {
      const d2 = ((px - x) ** 2 + (pz - z) ** 2) / (rad * rad);
      return d2 >= 1 ? -1 : yc + top * Math.sqrt(1 - d2) * 0.92;
    });
    return { pos: new T.Vector3(x, yc, z), q, s };
  };

  // 쏟아 부은 모양 — 가운데가 봉긋한 더미 + 가장자리로 흩어진 알갱이
  const dropPoint = (rand, W, Dd, keepOut) => {
    for (let k = 0; k < 20; k++) {
      let x, z;
      if (rand() < 0.68) { x = gauss(rand) * W * 0.24; z = gauss(rand) * Dd * 0.26; }
      else { x = (rand() - 0.5) * W * 0.92; z = (rand() - 0.5) * Dd * 0.92; }
      if (Math.abs(x) > W / 2 * 0.96 || Math.abs(z) > Dd / 2 * 0.96) continue;
      if (keepOut && z > keepOut) continue;
      return [x, z];
    }
    return [0, 0];
  };

  // ============================================================
  // 5. 눈금자 — 실제 크기를 가늠하는 기준물
  // ============================================================
  const buildRuler = (len, width) => {
    const ppm = clamp(Math.floor(3800 / len), 6, 48);
    const cw = Math.min(4096, Math.round(len * ppm)), ch = Math.round(width * ppm);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = Math.max(32, ch);
    const g = cv.getContext('2d');
    g.fillStyle = '#d8dadd'; g.fillRect(0, 0, cv.width, cv.height);
    // 헤어라인 가공 결
    for (let i = 0; i < cv.height; i += 2) { g.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.08})`; g.fillRect(0, i, cv.width, 1); }
    const px = cv.width / len;
    const labelEvery = len > 160 ? 20 : len > 35 ? 10 : 5;
    g.fillStyle = '#1b1d20'; g.textBaseline = 'top';
    g.font = `${Math.max(10, Math.round(cv.height * 0.26))}px "JetBrains Mono", monospace`;
    for (let mm = 0; mm <= len - 2; mm++) {
      const x = 6 + mm * px;
      if (x > cv.width - 2) break;
      const big = mm % 10 === 0, mid = mm % 5 === 0;
      const h = cv.height * (big ? 0.42 : mid ? 0.30 : 0.18);
      g.fillRect(Math.round(x), 0, Math.max(1, px * 0.09), h);
      if (mm % labelEvery === 0 && mm > 0) g.fillText(String(mm / 10 >= 1 && labelEvery >= 10 ? mm / 10 : mm), x + 2, h + 2);
    }
    if (labelEvery >= 10) g.fillText('cm', cv.width - cv.height * 0.6, cv.height * 0.62);
    else g.fillText('mm', cv.width - cv.height * 0.7, cv.height * 0.62);
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    const steel = new T.MeshStandardMaterial({ color: 0xc4c8ce, metalness: 0.85, roughness: 0.38 });
    const top = new T.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.42 });
    const thick = clamp(width * 0.05, 0.3, 1.2);
    const m = new T.Mesh(new T.BoxGeometry(len, thick, width), [steel, steel, top, steel, steel, steel]);
    m.position.y = thick / 2;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };

  // ============================================================
  // 6. 장면 한 개 (캔버스 하나에 하나)
  // ============================================================
  class View {
    constructor(canvas, kind) {
      this.canvas = canvas; this.kind = kind;
      const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(pointer: coarse)').matches;
      this.quality = kind === 'snap' ? 'low' : lowEnd ? 'mid' : 'high';

      const r = this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
      // 고해상도 화면에서 배율 2 는 픽셀이 4배라 내장 그래픽에서 버벅인다 — 1.5 로 묶는다
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1.25));
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.NeutralToneMapping;   // 색 왜곡이 가장 적은 톤매핑 — 예상 색상을 그대로 보여야 한다
      r.toneMappingExposure = 1.0;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFSoftShadowMap;

      const s = this.scene = new T.Scene();
      s.background = new T.Color(0xdcdad5);
      const pm = new T.PMREMGenerator(r);
      this.envTex = pm.fromScene(new M.RoomEnvironment(), 0.04).texture;
      pm.dispose();
      s.environment = this.envTex;
      s.environmentIntensity = 0.42;

      this.camera = new T.PerspectiveCamera(kind === 'macro' ? 24 : 28, 1, 0.1, 5000);

      // 주광(왼쪽 위 창가 방향) — 그림자를 만든다
      const key = this.key = new T.DirectionalLight(0xfff6ea, 3.0);
      key.castShadow = true;
      key.shadow.mapSize.set(this.quality === 'high' ? 4096 : 2048, this.quality === 'high' ? 4096 : 2048);
      key.shadow.bias = -0.0002;
      s.add(key, key.target);
      const fill = new T.DirectionalLight(0xe8eeff, 0.35);
      fill.position.set(1, 0.6, 1);
      s.add(fill);

      // 시료 받침 — 무광 백색 시료지
      this.floorMat = new T.MeshStandardMaterial({ color: 0xe2e0db, roughness: 0.92, metalness: 0 });
      this.floor = new T.Mesh(new T.PlaneGeometry(1, 1), this.floorMat);
      this.floor.rotation.x = -Math.PI / 2;
      this.floor.receiveShadow = true;
      s.add(this.floor);

      this.group = new T.Group();
      s.add(this.group);
      this.materials = [];
      this.geoKey = '';
      this.viewMm = 0;

      if (kind !== 'snap') {
        const c = this.controls = new M.OrbitControls(this.camera, canvas);
        c.enableDamping = false;
        c.maxPolarAngle = Math.PI * 0.46;
        c.minPolarAngle = 0.05;
        c.addEventListener('change', () => { if (!this.quiet) this.render(); });
        // 휴대폰에서는 화면을 스크롤하다 장면이 돌아가 버린다 — 한 번 눌러야 조작이 켜진다
        if (matchMedia('(pointer: coarse)').matches) {
          c.enabled = false;
          canvas.style.touchAction = 'pan-y';
          canvas.addEventListener('click', () => { c.enabled = true; canvas.style.touchAction = 'none'; }, { once: true });
        }
        canvas.addEventListener('dblclick', () => this.fitCamera(true));
      }
      this.setupComposer();
    }

    setupComposer() {
      this.composer = null;
      try {
        const r = this.renderer;
        const rt = new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, samples: 4 });
        const comp = new M.EffectComposer(r, rt);
        comp.addPass(new M.RenderPass(this.scene, this.camera));
        if (this.quality !== 'low') {
          const ao = this.ao = new M.GTAOPass(this.scene, this.camera, 2, 2);
          ao.blendIntensity = 1.0;
          comp.addPass(ao);
        }
        if (this.kind === 'macro') {
          this.bokeh = new M.BokehPass(this.scene, this.camera, { focus: 50, aperture: 0.0002, maxblur: 0.006 });
          comp.addPass(this.bokeh);
        }
        comp.addPass(new M.OutputPass());
        this.composer = comp;
      } catch (e) {
        console.warn('[외관 3D] 후처리 생략 —', e && e.message);
        this.composer = null; this.ao = null; this.bokeh = null;
      }
    }

    resize() {
      const w = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 600;
      // 휴대폰처럼 좁은 화면에서는 세로로 길어져 빈 바닥만 보인다 — 높이를 폭에 맞춰 줄인다
      const want = Number(this.canvas.dataset.h) || 300;
      const h = Math.max(200, Math.min(want, Math.round(w * (this.kind === 'macro' ? 0.8 : 0.9))));
      this.canvas.style.height = h + 'px';
      if (w === this.w && h === this.h) return false;
      this.w = w; this.h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.composer) {
        this.composer.setPixelRatio(this.renderer.getPixelRatio());
        this.composer.setSize(w, h);
      }
      return true;
    }

    // 같은 형상·재질은 다시 만들지 않는다. 슬라이더를 오갈 때 형상 생성이 가장 비싸다.
    //   캐시에 든 형상·풀에 든 재질은 장면에서 빼도 버리지 않고, 화면을 닫을 때 한꺼번에 버린다.
    clearGroup() {
      this.group.children.slice().forEach(o => {
        this.group.remove(o);
        if (o.geometry && !o.geometry.userData.cached) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m && !m.userData.pooled) { if (m.map) m.map.dispose(); m.dispose(); } });
      });
      this.materials = [];
    }

    geo(key, make) {
      this.geoCache = this.geoCache || new Map();
      this.usedGeo = this.usedGeo || new Set();
      this.usedGeo.add(key);
      let g = this.geoCache.get(key);
      if (!g) {
        g = make();
        g.userData.cached = true;
        this.geoCache.set(key, g);
      }
      return g;
    }

    // 이번 장면에 안 쓰인 형상은 캐시가 커지면 버린다
    trimGeoCache() {
      if (!this.geoCache || this.geoCache.size <= 60) return;
      this.geoCache.forEach((g, k) => { if (!this.usedGeo.has(k)) { g.dispose(); this.geoCache.delete(k); } });
    }

    feedMat(seedOff) {
      this.matPool = this.matPool || new Map();
      let m = this.matPool.get(seedOff);
      if (!m) {
        m = makeFeedMaterial(this.sp.u, seedOff);
        m.userData.pooled = true;
        this.matPool.set(seedOff, m);
      }
      applySurface(m, this.sp);
      m.userData.uni.uDetail.value = this.kind === 'macro' ? 1 : 0;
      if (!this.materials.includes(m)) this.materials.push(m);
      return m;
    }

    addInstanced(geo, mat, items) {
      if (!items.length) { if (!geo.userData.cached) geo.dispose(); return; }
      const im = new T.InstancedMesh(geo, mat, items.length);
      const m4 = new T.Matrix4(), sc = new T.Vector3();
      items.forEach((it, i) => {
        sc.setScalar(it.s || 1);
        m4.compose(it.pos, it.q, sc);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }

    // 성상·치수가 바뀔 때만 형상을 새로 만든다. 색·광택 같은 재질값은 매번 바로 반영한다.
    build(a, opt) {
      this.clearGroup();
      const macro = this.kind === 'macro';
      const Wv = opt.viewMm;                      // 화면 가운데에 들어와야 할 폭
      const W = Wv * (macro ? 1.6 : 1.3), Dd = W * 0.85;
      this.extent = W;
      this.floor.scale.set(W * 8, W * 8, 1);

      const cell = clamp(Math.min(a.diaMm, a.lenMm || a.diaMm) / 10, 0.02, 1.2);
      const hf = new HeightField(W, Dd, cell);
      const rand = rng(macro ? 777 : 20260814);

      // 눈금자 — 트레이 앞쪽 가장자리. 그 줄에는 알갱이를 떨어뜨리지 않는다.
      //   확대 뷰는 한 알을 크게 보는 화면이라 눈금자가 알갱이 밑에 깔린다 — 치수는 제목 옆 글자로 보인다.
      const aspect = (this.w || 800) / (this.h || 300);
      const elev = macro ? 0.52 : 0.92;
      const visDepth = (Wv / aspect) / Math.sin(elev);
      // 길이는 1cm 단위로 끊는다 — 실제 자처럼 보이고, 시야가 조금 바뀌어도 같은 자를 다시 쓴다
      const rw = Math.round(clamp(Wv * (macro ? 0.10 : 0.075), 2.5, 30) * 2) / 2;
      const rlen = Math.max(10, Math.round(Wv * 0.62 / 10) * 10);
      const rz = Math.min(visDepth / 2 - rw * 0.75, Dd / 2 - rw);
      if (!macro) {
        // 눈금 그림(큰 텍스처)을 매번 올리면 다시 그릴 때마다 수백 ms 가 든다 — 같은 크기면 재사용
        const rkey = rlen.toFixed(1) + '|' + rw.toFixed(1);
        if (!this.ruler || this.ruler.key !== rkey) {
          if (this.ruler) this.disposeRuler();
          const mesh = buildRuler(rlen, rw);
          mesh.geometry.userData.cached = true;
          mesh.material.forEach(m => { m.userData.pooled = true; });
          this.ruler = { key: rkey, mesh };
        }
        const ruler = this.ruler.mesh;
        ruler.position.set(-Wv * 0.5 + rlen / 2 + Wv * 0.04, ruler.position.y, rz);
        ruler.rotation.y = 0.012;
        this.group.add(ruler);
      }
      const keepOut = macro ? Infinity : rz - rw * 0.5 - cell * 2;

      if (a.isMash) this.buildMash(a, opt, hf, W, Dd, rand, keepOut, macro);
      else if (a.isEP) this.buildLumps('ep', a, hf, W, Dd, rand, keepOut, macro);
      else if (a.form === 'crumble') this.buildLumps('crumble', a, hf, W, Dd, rand, keepOut, macro);
      else this.buildPellets(a, hf, W, Dd, rand, keepOut, macro);

      if (!a.isMash && !macro) this.buildFines(a, hf, W, Dd, rand, keepOut, macro);

      // 가장 높이 쌓인 곳 — 카메라 초점·그림자 범위에 쓴다
      let top = 0; for (let i = 0; i < hf.h.length; i++) top = Math.max(top, hf.h[i]);
      this.pileTop = top;
      // 확대 뷰는 가운데 놓인 주인공 알갱이의 실제 높이 절반에 맞춘다
      this.focusY = macro ? (a.isMash ? top * 0.6 : hf.maxIn(0, 0, Math.min(a.diaMm, a.lenMm || a.diaMm) * 0.4) * 0.5) : top * 0.35;
    }

    buildPellets(a, hf, W, Dd, rand, keepOut, macro) {
      const D = a.diaMm, L = a.lenMm;
      const quantiles = [-1.3, -0.7, -0.25, 0.25, 0.7, 1.3];
      const pdiF = clamp((a.pdi - 55) / 40, 0, 1);
      const r2 = (v) => Math.round(v * 20) / 20;
      const prm = {
        bev: r2(0.06 + 0.18 * (1 - pdiF)),
        rough: r2(0.5 + a.rough),
        stri: r2(0.6 + (1 - a.gel) * 0.8),
        brk: r2(0.55 + (1 - pdiF) * 0.7),
        // 트레이 알갱이는 화면에서 수십 px 이라 형상을 성기게 만든다(정점 수 1/3)
        radial: macro ? 48 : 20,
        capRings: macro ? 14 : 6,
        arc: macro ? 5 : 3,
        sideK: macro ? 9 : 4,
      };
      const variants = quantiles.map((qv, i) => {
        const len = Math.max(D * 0.55, L * (1 + qv * a.lenCv * 0.8));
        const k = ['p', D.toFixed(3), len.toFixed(3), i, prm.bev.toFixed(2), prm.rough.toFixed(1), prm.stri.toFixed(1), prm.brk.toFixed(2), prm.radial, prm.capRings].join('|');
        return { len, geo: this.geo(k, () => buildPellet(D, len, i + 1, prm)), items: [] };
      });
      if (macro) {
        const main = variants[3];
        main.items.push(placeCylinder(hf, 0, 0, -0.38, main.len, D / 2, rand));
        for (let k = 0; k < 5; k++) {
          const v = variants[k % variants.length];
          const x = (rand() - 0.5) * W * 0.9, z = -L * (1.6 + rand() * 2.6);
          v.items.push(placeCylinder(hf, x, z, rand() * Math.PI, v.len, D / 2, rand));
        }
      } else {
        const n = clamp(Math.round(W * Dd * 1.0 / (L * D)), 40, 700);
        for (let i = 0; i < n; i++) {
          const v = variants[Math.floor(rand() * variants.length)];
          const [x, z] = dropPoint(rand, W, Dd, keepOut);
          v.items.push(placeCylinder(hf, x, z, rand() * Math.PI * 2, v.len, D / 2 * (0.97 + rand() * 0.06), rand));
        }
      }
      variants.forEach((v, i) => this.addInstanced(v.geo, this.feedMat(i * 1000), v.items));
    }

    buildLumps(kind, a, hf, W, Dd, rand, keepOut, macro) {
      const ep = kind === 'ep';
      const size = ep ? a.diaMm : a.lenMm;
      const nVar = 6;
      const detail = macro ? 3 : 2;
      const variants = [];
      for (let i = 0; i < nVar; i++) {
        const wob = Math.round((0.04 + a.expand * 0.07) * 200) / 200;
        const geo = ep
          ? this.geo(['e', size.toFixed(3), i, wob, macro].join('|'), () => buildEP(size, i + 1, wob, macro ? 72 : 24))
          : this.geo(['c', size.toFixed(3), i, detail].join('|'), () => buildCrumb(size, i + 1, detail + 1));
        variants.push({ geo, pts: geo.userData.pts || (geo.userData.pts = samplePoints(geo)), items: [] });
      }
      const put = (x, z, sMul) => {
        const v = variants[Math.floor(rand() * nVar)];
        v.items.push(placeLump(hf, x, z, v.pts, sMul, rand));
      };
      if (macro) {
        put(0, 0, 1);
        for (let k = 0; k < 6; k++) put((rand() - 0.5) * W * 0.9, -size * (1.4 + rand() * 2.4), 0.8 + rand() * 0.4);
      } else {
        const per = ep ? size * size * 0.95 : size * size * 0.42;
        const n = clamp(Math.round(W * Dd * (ep ? 1.0 : 1.1) / per), 40, ep ? 600 : 1100);
        for (let i = 0; i < n; i++) {
          const [x, z] = dropPoint(rand, W, Dd, keepOut);
          put(x, z, ep ? 0.9 + rand() * 0.22 : 0.45 + rand() * 1.0);
        }
      }
      variants.forEach((v, i) => this.addInstanced(v.geo, this.feedMat(i * 1000 + 37), v.items));
    }

    // 미분 — 알갱이 사이·바닥에 깔린 가루
    buildFines(a, hf, W, Dd, rand, keepOut, macro) {
      const D = Math.min(a.diaMm, a.lenMm || a.diaMm);
      const n = Math.round(clamp(a.fines * (macro ? 10 : 45), 0, macro ? 160 : 1600));
      if (!n) return;
      const geo = this.geo('fines', () => buildChunk(1, 91, 0, false));
      const items = [];
      for (let i = 0; i < n; i++) {
        const [x, z] = macro ? [(rand() - 0.5) * W * 0.8, (rand() - 0.5) * Dd * 0.6] : dropPoint(rand, W, Dd, keepOut);
        const s = D * (0.05 + rand() * 0.12);
        const yc = hf.get(x, z) + s * 0.3;
        items.push({ pos: new T.Vector3(x, yc, z), q: new T.Quaternion().setFromEuler(new T.Euler(rand() * 6, rand() * 6, rand() * 6)), s });
      }
      this.addInstanced(geo, this.feedMat(7777), items);
    }

    // 매쉬 — 가루 바닥(높이맵 지형) + 입도 분포대로 굴러다니는 입자
    buildMash(a, opt, hf, W, Dd, rand, keepOut, macro) {
      const g = a.diaMm;
      const segX = macro ? 240 : 200, segZ = Math.round(segX * Dd / W);
      const bed = new T.PlaneGeometry(W * 1.3, Dd * 1.3, segX, segZ);
      bed.rotateX(-Math.PI / 2);
      const pos = bed.attributes.position;
      const cap = new Float32Array(pos.count);
      const f = 0.9 / g;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const rr = Math.hypot(x / (W * 0.48), z / (Dd * 0.48));
        const mound = Math.max(0, 1 - rr * rr) * g * (macro ? 2.5 : 5);
        const y = mound + (fbm(x * f, z * f, 3.3) - 0.5) * g * 0.7 + (fbm(x * f * 4, z * f * 4, 8.1, 3) - 0.5) * g * 0.45;
        pos.setY(i, Math.max(0.02, y));
        const k = hf.idx(x, z); if (k >= 0) hf.h[k] = Math.max(hf.h[k], y);
      }
      bed.setAttribute('aCap', new T.Float32BufferAttribute(cap, 1));
      bed.computeVertexNormals();
      const bedMat = this.feedMat(9001);
      bedMat.userData.bed = true;           // 가루 바닥 — 입자색을 셀 단위로 섞는다
      bedMat.userData.uni.uLoose.value = 2;
      const bedMesh = new T.Mesh(bed, bedMat);
      bedMesh.receiveShadow = true; bedMesh.castShadow = true;
      this.group.add(bedMesh);
      // 높이맵 빈 칸(격자 차이) 메우기
      for (let k = 1; k < hf.h.length; k++) if (hf.h[k] === 0) hf.h[k] = hf.h[k - 1];

      // 각진 곡물 조각 4종 + 얇은 박편(밀기울·박류 껍질) 2종
      const variants = [0, 1, 2, 3, 4, 5].map(i => ({ geo: this.geo('m' + i, () => buildChunk(1, 300 + i, 1, i % 3 !== 2, i >= 4 ? 0.35 : 1)), items: [] }));
      const sigma = 0.32 + a.rough * 0.30;
      const n = clamp(Math.round(W * Dd / (g * g) * (macro ? 0.45 : 0.6)), 600, macro ? 3500 : 7000);
      for (let i = 0; i < n; i++) {
        const s = clamp(g * Math.exp(gauss(rand) * sigma), 0.05, 4);
        const x = (rand() - 0.5) * W * 0.94, z = (rand() - 0.5) * Dd * 0.94;
        if (z > keepOut) continue;
        const yc = hf.get(x, z) + s * 0.22;
        variants[i % 6].items.push({ pos: new T.Vector3(x, yc, z), q: new T.Quaternion().setFromEuler(new T.Euler(rand() * 6, rand() * 6, rand() * 6)), s });
      }
      variants.forEach((v, i) => this.addInstanced(v.geo, this.feedMat(9100 + i * 1000), v.items));
    }

    // 카메라 — 사용자가 돌려 놓은 각도는 유지하고 거리·중심만 맞춘다
    fitCamera(resetAngle) {
      const macro = this.kind === 'macro';
      const Wv = this.viewMm;
      const vfov = T.MathUtils.degToRad(this.camera.fov);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
      const dist = (Wv / 2) / Math.tan(hfov / 2) * (macro ? 1.0 : 1.04);
      const target = new T.Vector3(0, this.focusY || 0, macro ? 0 : Wv * 0.02);
      const sph = new T.Spherical();
      if (!resetAngle && this.controls && this.hasFit) {
        sph.setFromVector3(this.camera.position.clone().sub(this.controls.target));
      } else {
        sph.set(1, macro ? Math.PI / 2 - 0.52 : Math.PI / 2 - 0.92, macro ? 0.18 : 0.10);
      }
      sph.radius = dist;
      this.camera.position.copy(target).add(new T.Vector3().setFromSpherical(sph));
      this.camera.near = Math.max(0.05, dist * 0.05);
      this.camera.far = dist * 20;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(target);
      if (this.controls) {
        this.controls.target.copy(target);
        this.controls.minDistance = dist * 0.25;
        this.controls.maxDistance = dist * 3;
        this.quiet = true; this.controls.update(); this.quiet = false;
      }
      this.hasFit = true;

      // 주광·그림자 범위
      const E = this.extent || Wv;
      this.key.position.set(-E * 0.9, E * 1.6, -E * 0.55);
      this.key.target.position.set(0, 0, 0);
      const sc = this.key.shadow.camera;
      sc.left = -E * 0.75; sc.right = E * 0.75; sc.top = E * 0.75; sc.bottom = -E * 0.75;
      sc.near = E * 0.2; sc.far = E * 4;
      sc.updateProjectionMatrix();
      // 법선 방향 보정은 알갱이 크기의 1~2% 수준이어야 한다 — 크면 그림자가 밀려나 바닥에 흰 판처럼 뜬다
      this.key.shadow.normalBias = Math.max(0.004, (this.cellHint || 0.2) * 0.015);

      if (this.ao) {
        try {
          const rad = Math.max(0.05, (this.cellHint || 0.3) * 1.4);
          this.ao.updateGtaoMaterial({ radius: rad, distanceExponent: 1.2, thickness: rad * 1.4, scale: 1.0,
            samples: this.quality === 'high' ? 16 : 8 });
          this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
        } catch (_) { /* 버전 차이 — 기본값으로 둔다 */ }
      }
    }

    update(a, opt) {
      const sized = this.resize();
      this.sp = surfaceParams(a, opt);
      const key = [a.form, a.diaMm.toFixed(2), (a.lenMm || 0).toFixed(2), a.lenCv.toFixed(2),
        a.expand.toFixed(2), Math.round(a.pdi), Math.round(a.fines), (opt.grind || 0).toFixed(2),
        Math.round(a.rough * 10), opt.viewMm.toFixed(1), this.w, this.h].join('|');
      this.materials.forEach(m => applySurface(m, this.sp));
      if (key === this.geoKey) { clearTimeout(this.tmr); this.render(); return; }

      this.pending = { a, opt, key, sized: sized || this.pending?.sized };
      if (!this.hasFit || this.kind === 'snap') { this.rebuild(); return; }
      // 슬라이더를 끄는 동안에는 색·광택만 바로 바꾸고, 형상은 손을 멈춘 뒤 한 번에 다시 만든다
      this.render();
      clearTimeout(this.tmr);
      this.tmr = setTimeout(() => this.rebuild(), 180);
    }

    rebuild() {
      clearTimeout(this.tmr);
      const p = this.pending; if (!p) return;
      this.pending = null;
      if (!this.canvas.isConnected) return;
      const { a, opt, key, sized } = p;
      this.sp = surfaceParams(a, opt);
      const viewChanged = Math.abs(opt.viewMm - this.viewMm) > this.viewMm * 0.02 || sized;
      this.viewMm = opt.viewMm;
      this.cellHint = Math.min(a.diaMm, a.lenMm || a.diaMm) / 2;
      this.usedGeo = new Set();
      this.build(a, opt);
      this.trimGeoCache();
      this.geoKey = key;
      // 시야가 바뀌면 거리만 다시 맞춘다(돌려 놓은 각도는 유지)
      if (viewChanged || !this.hasFit) this.fitCamera(!this.hasFit);
      this.render();
    }

    render() {
      if (this.bokeh) {
        const tgt = this.controls ? this.controls.target : new T.Vector3();
        const dist = this.camera.position.distanceTo(tgt);
        this.bokeh.uniforms.focus.value = dist;
        // 초점에서 알갱이 지름의 두세 배 벗어나면 흐려지는 접사 심도
        this.bokeh.uniforms.aperture.value = 0.0045 / Math.max(this.cellHint * 6, 0.5);
        this.bokeh.uniforms.maxblur.value = 0.006;
      }
      if (this.composer) this.composer.render();
      else this.renderer.render(this.scene, this.camera);
    }

    disposeRuler() {
      const m = this.ruler && this.ruler.mesh;
      if (!m) return;
      m.geometry.dispose();
      m.material.forEach(x => { if (x.map) x.map.dispose(); x.dispose(); });
      this.ruler = null;
    }

    dispose() {
      try {
        clearTimeout(this.tmr);
        this.clearGroup();
        this.disposeRuler();
        if (this.geoCache) this.geoCache.forEach(g => g.dispose());
        if (this.matPool) this.matPool.forEach(m => m.dispose());
        this.floor.geometry.dispose(); this.floorMat.dispose();
        this.envTex.dispose();
        if (this.controls) this.controls.dispose();
        if (this.composer) { this.composer.passes.forEach(p => p.dispose && p.dispose()); this.composer.dispose?.(); }
        this.renderer.dispose();
        this.renderer.forceContextLoss();
      } catch (_) {}
    }
  }

  // ============================================================
  // 7. 외부 인터페이스
  // ============================================================
  const views = new Map();   // canvas id → View

  // 화면이 다시 그려져 캔버스가 바뀌었거나 사라졌으면 이전 WebGL 을 정리한다(컨텍스트 누수 방지)
  const sweep = () => {
    views.forEach((v, id) => {
      if (!v.canvas.isConnected || document.getElementById(id) !== v.canvas) { v.dispose(); views.delete(id); }
    });
  };

  // 앱에는 화면을 떠날 때 부르는 훅이 없다 — 본문이 갈아끼워지면 스스로 정리한다
  let observing = false;
  const watchPage = () => {
    if (observing) return;
    const host = document.getElementById('page-content');
    if (!host || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => { if (views.size) sweep(); }).observe(host, { childList: true });
    observing = true;
  };

  // a: calcAppearance 결과, kind: 'tray' | 'macro' | 'snap', opt: { viewMm, grind }
  const draw = (canvas, a, kind, opt) => {
    if (!T || !canvas) return false;
    watchPage();
    sweep();
    let v = views.get(canvas.id);
    if (!v) {
      try { v = new View(canvas, kind); }
      catch (e) { console.warn('[외관 3D] 장면 생성 실패 —', e && e.message); return false; }
      views.set(canvas.id, v);
    }
    try { v.update(a, opt); }
    catch (e) { console.warn('[외관 3D] 그리기 실패 —', e && e.message); return false; }
    return true;
  };

  const release = (id) => {
    const v = views.get(id);
    if (v) { v.dispose(); views.delete(id); }
  };

  return { load, ready, draw, release, sweep };
})();
