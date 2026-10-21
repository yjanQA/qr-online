// ============================================================
// process_flow_data.js — 제조공정도 원본 데이터
//
//   출처: DOC-N-230 제조공정도 및 제조설명서 (V25, 2026.01.02)
//     · 우성사료 1공장 제조공정도 및 제조설명서_260205.xlsx  → 논산 1공장 양축 (8개 라인)
//     · 우성사료 2공장 제조공정도 및 제조설명서_260205.xlsx  → 논산 2공장 특수 (7개 라인)
//
//   원본 엑셀은 "열 = 원료 라인 / 행 = 공정 단계" 로 그려져 있다.
//   현장이 이미 그 그림에 익숙하므로 배치를 바꾸지 않고 그대로 옮겼다.
//   번호(1-1, 2-7 …)와 공정명·공정설명·작업기구는 제조설명서 원문 그대로다.
//
//   ※ 문서가 개정되면 여기 LANES / LEVELS / NODES 를 함께 고쳐야 한다.
// ============================================================

const ProcessFlowData = (() => {

  // ── 공통 문구 (여러 라인이 같은 설명을 쓴다) ──
  const D_IN = '원료는 HACCP 지정업체 및 수입업체는 수입필증·검역증명서, 자가품질검사서 등 문서를 확인하고, 외관상태(이미·이취·이물)를 확인한 후 적합한 원료만 입고한다.';
  const D_KEEP = '벽과 바닥 간 적정거리를 이격하여 식별표를 부착하고, 선입선출이 가능하도록 적재 관리한다.';
  const D_FEED = '1. 투입 전 원료정선망이 제대로 설치되어 있는지 확인한다.\n2. 확인된 원료는 원료투입구에 투입한다.';
  const D_SCALE = '스케일을 이용하여 원료별 무게를 측정한다.';
  const D_MIX = '배합기를 이용하여 원료를 배합한다.';
  const D_GRIND = '분쇄기를 통하여 분쇄를 진행한다.';
  const D_PACK = '1. 검수가 완료된 포장지로 포장한다.\n2. 제품별에 맞게 포장지를 선택하여 포장한다.';
  const D_STORE = '완제품이 바닥과 벽에 접하지 않도록 파렛트에 적재한다.';
  const D_SHIP = '1. 보관 중인 제품의 출고는 선입선출이 이루어지도록 식별표를 부착하여 적재·관리한다.\n2. 운반 차량은 제품의 포장 특성에 따라 제품이 쏠리지 않도록 한다.';

  // ============================================================
  // 논산 1공장 — 양축 (가루·펠렛·후레이크·갓돈·EXT·액상·용수·부자재)
  // ============================================================
  const F1 = {
    key: 'F1',
    factory: 'NS',
    title: '논산 1공장 양축 제조공정도',
    subtitle: '8개 원료 라인이 이물선별을 거쳐 포장으로 합류합니다',
    legend: [
      ['MG', '마그네트'], ['RD', '로타리 드레서'], ['ST', '시프터'],
    ],
    lanes: [
      { key: 'L1', no: 1, title: '가루',     material: '옥수수, 소맥 등',      group: '공정' },
      { key: 'L2', no: 2, title: '펠렛',     material: '옥수수, 소맥 등',      group: '공정' },
      { key: 'L3', no: 3, title: '후레이크', material: '옥수수, 루핀',         group: '공정' },
      { key: 'L4', no: 4, title: '갓돈',     material: '옥수수, 어분 등',      group: '공정' },
      { key: 'L5', no: 5, title: 'EXT',      material: '옥수수, 쌀 등',        group: '공정' },
      { key: 'L6', no: 6, title: '액상',     material: '대두유, 당밀 등',      group: '공정' },
      { key: 'L7', no: 7, title: '용수',     material: '상수도(수돗물)',       group: '용수' },
      { key: 'L8', no: 8, title: '부자재',   material: '포장지(내/외)',        group: '부자재' },
    ],
    // type: 'node' 공정 상자 / 'marker' 설비 표시줄 / 'merge' 합류 지점
    levels: [
      { key: 'v1', label: '입고·검수',  type: 'node' },
      { key: 'v2', label: '하차·보관',  type: 'node' },
      { key: 'v3', label: '투입·스팀',  type: 'node' },
      { key: 'v4', label: '분쇄·계량',  type: 'node' },
      { key: 'v5', label: '계량·배합',  type: 'node' },
      { key: 'v6', label: '배합',         type: 'node' },
      { key: 'v7', label: '미분쇄',       type: 'node' },
      { key: 'v8', label: '가공',         type: 'node' },
      { key: 'v9', label: '2차배합·분쇄', type: 'node' },
      { key: 'm1', label: '이물 선별',    type: 'marker', text: 'MG · RD · ST', lanes: ['L1', 'L5'] },
      { key: 'v10', label: '포장',        type: 'node', merged: true },
      { key: 'v11', label: '보관',        type: 'node', merged: true },
      { key: 'v12', label: '운송',        type: 'node', merged: true },
    ],
    nodes: [
      // 1 가루
      { lane: 'L1', level: 'v1', no: '1-1', name: '입고/검수', ccp: ['CCP-1C-1', 'CCP-1C-2', 'CCP-1C-3'], desc: D_IN + '\nCCP 설명서 참조', tools: 'NIR · 샘플러' },
      { lane: 'L1', level: 'v2', no: '1-2', name: '하차/보관', desc: D_KEEP, tools: '팔레트 · 낱가리카드 · 사일로/부사일로' },
      { lane: 'L1', level: 'v3', no: '1-3', name: '원료투입', desc: D_FEED, tools: '원료투입구' },
      { lane: 'L1', level: 'v4', no: '1-4', name: '분쇄', desc: '분쇄기를 통하여 원료별 분쇄를 진행한다.', tools: '분쇄기' },
      { lane: 'L1', level: 'v5', no: '1-5', name: '계량', desc: D_SCALE, tools: '스케일' },
      { lane: 'L1', level: 'v6', no: '1-6', name: '배합', desc: D_MIX, tools: '배합기' },
      // 2 펠렛
      { lane: 'L2', level: 'v1', no: '2-1', name: '입고/검수', ccp: ['CCP-1C-1', 'CCP-1C-2', 'CCP-1C-3'], desc: D_IN + '\nCCP 설명서 참조', tools: 'NIR · 샘플러' },
      { lane: 'L2', level: 'v2', no: '2-2', name: '하차/보관', desc: D_KEEP, tools: '팔레트 · 낱가리카드 · 원료보관창고' },
      { lane: 'L2', level: 'v3', no: '2-3', name: '원료투입', desc: D_FEED, tools: '원료투입구' },
      { lane: 'L2', level: 'v4', no: '2-4', name: '분쇄', desc: '분쇄기를 통하여 원료별 분쇄를 진행한다.', tools: '분쇄기' },
      { lane: 'L2', level: 'v5', no: '2-5', name: '계량', desc: D_SCALE, tools: '스케일' },
      { lane: 'L2', level: 'v6', no: '2-6', name: '배합', desc: D_MIX, tools: '배합기' },
      { lane: 'L2', level: 'v8', no: '2-7', name: '가공 (펠렛·CL)', desc: '1. 분쇄된 원료를 펠렛팅하여 제품을 생산한다.\n2. 스팀온도 50~80℃ (제품별 상이)', tools: '펠렛기 · CL' },
      // 3 후레이크
      { lane: 'L3', level: 'v1', no: '3-1', name: '입고/검수', ccp: ['CCP-1C-1'], desc: D_IN + '\nCCP 설명서 참조', tools: 'NIR · 샘플러' },
      { lane: 'L3', level: 'v2', no: '3-2', name: '하차/보관', desc: D_KEEP, tools: '팔레트 · 낱가리카드 · 원료보관창고' },
      { lane: 'L3', level: 'v3', no: '3-3', name: '원료투입', desc: D_FEED, tools: '원료투입구' },
      { lane: 'L3', level: 'v5', no: '3-4', name: '계량', desc: D_SCALE, tools: '스케일 · 계량저울 · 스테인레스 스쿱' },
      { lane: 'L3', level: 'v8', no: '3-5', name: '가공 (후레이크·DR·CL)', desc: '1. 원료를 압출하여 제품을 성형한다.\n2. 스팀온도 90~100℃ (제품별 상이)', tools: '후레이크 · DR · CL' },
      { lane: 'L3', level: 'v9', no: '3-6', name: '2차 배합', desc: '배합기를 이용하여 제품을 배합한다.', tools: '배합기' },
      // 4 갓돈
      { lane: 'L4', level: 'v1', no: '4-1', name: '입고/검수', ccp: ['CCP-1C-1', 'CCP-1B'], desc: D_IN + '\nCCP 설명서 참조', tools: 'NIR · 샘플러' },
      { lane: 'L4', level: 'v2', no: '4-2', name: '하차/보관', desc: D_KEEP, tools: '팔레트 · 낱가리카드 · 원료보관창고' },
      { lane: 'L4', level: 'v3', no: '4-3', name: '원료투입', desc: D_FEED, tools: '원료투입구' },
      { lane: 'L4', level: 'v4', no: '4-4', name: '분쇄', desc: '분쇄기를 통하여 원료별 분쇄를 진행한다.', tools: '분쇄기' },
      { lane: 'L4', level: 'v5', no: '4-5', name: '계량', desc: D_SCALE, tools: '스케일' },
      { lane: 'L4', level: 'v6', no: '4-6', name: '배합', desc: D_MIX, tools: '배합기' },
      { lane: 'L4', level: 'v7', no: '4-7', name: '미분쇄', desc: '분쇄기를 통하여 배합물을 미분쇄한다.', tools: '분쇄기' },
      { lane: 'L4', level: 'v8', no: '4-8', name: '가공 (펠렛·CL)', desc: '1. 분쇄된 원료를 압출하여 제품을 성형한다.\n2. 스팀온도 50~80℃ (제품별 상이)', tools: '펠렛기 · CL' },
      // 5 EXT
      { lane: 'L5', level: 'v1', no: '5-1', name: '입고/검수', ccp: ['CCP-1C-1'], desc: D_IN + '\nCCP 설명서 참조', tools: 'NIR · 샘플러' },
      { lane: 'L5', level: 'v2', no: '5-2', name: '하차/보관', desc: D_KEEP, tools: '팔레트 · 낱가리카드 · 원료보관창고' },
      { lane: 'L5', level: 'v3', no: '5-3', name: '원료투입', desc: D_FEED, tools: '원료투입구' },
      { lane: 'L5', level: 'v4', no: '5-4', name: '계량', desc: D_SCALE, tools: '스케일' },
      { lane: 'L5', level: 'v5', no: '5-5', name: '배합', desc: D_MIX, tools: '배합기' },
      { lane: 'L5', level: 'v7', no: '5-6', name: '분쇄', desc: D_GRIND, tools: '분쇄기' },
      { lane: 'L5', level: 'v8', no: '5-7', name: '가공 (EXT·DR·CL)', desc: '분쇄된 원료를 압출하여 제품을 성형한다.', tools: 'EXT · DR · CL' },
      { lane: 'L5', level: 'v9', no: '5-8', name: '분쇄', desc: D_GRIND + '\n- EXT콘 : 1.5, 5.5mm 분쇄', tools: '분쇄기' },
      // 6 액상
      { lane: 'L6', level: 'v1', no: '6-1', name: '입고/검수', desc: '원료는 HACCP 지정업체 및 수입업체는 수입필증·검역증명서, 자가품질검사서 등 문서를 확인하고, 외관상태(이미·이취·이물)를 1차 확인한 후 2차 화학분석을 통과한 원료만 입고한다.', tools: '샘플러 · 화학분석' },
      { lane: 'L6', level: 'v2', no: '6-2', name: '하차/보관', desc: '1. 액상 탱크에 보관한다.\n2. 보관온도는 원료별로 상이하다. (액상원료 체크리스트)', tools: '액상탱크' },
      { lane: 'L6', level: 'v5', no: '6-3', name: '계량', desc: '1. 계량펌프를 이용하여 자동계량한다.\n2. 계량된 액상원료는 배합·가공·포장 등 각 단계별 구간에 투입된다.', tools: '계량펌프' },
      // 7 용수
      { lane: 'L7', level: 'v1', no: '7-1', name: '입수', desc: '1. 상수도를 활용한다.\n2. 연 2회 마시는물 기준으로 분석을 진행하여 품질을 확인한다.', tools: '샘플러 · 화학분석' },
      { lane: 'L7', level: 'v2', no: '7-2', name: '보관(물탱크)', desc: '물탱크에 보관한다.', tools: '물탱크' },
      { lane: 'L7', level: 'v3', no: '7-3', name: '스팀', desc: '보일러를 이용하여 물을 가열하여 스팀을 생산한다.', tools: '보일러' },
      { lane: 'L7', level: 'v5', no: '7-4', name: '계량', desc: '1. 계량펌프를 이용하여 자동계량한다.\n2. 계량된 물은 배합단계에, 스팀은 가공단계에 투입된다.', tools: '계량펌프 · 작업패널' },
      // 8 부자재
      { lane: 'L8', level: 'v1', no: '8-1', name: '입고/검수', desc: '포장지 외관(찍힘·오염 등), 사료관리법 표기사항, 오타, 수량 등을 확인한다.', tools: '용기 및 포장 검사 체크시트' },
      { lane: 'L8', level: 'v2', no: '8-2', name: '보관(창고)', desc: D_KEEP, tools: '제품 보관창고' },
      // 합류 이후 (전 라인 공통)
      { lane: 'MERGE', level: 'v10', no: '1-7', name: '포장 (지대·벌크·톤백)', desc: D_PACK, tools: '포장기' },
      { lane: 'MERGE', level: 'v11', no: '1-8', name: '보관', desc: D_STORE, tools: '지게차 · 제품보관창고' },
      { lane: 'MERGE', level: 'v12', no: '1-9', name: '운송 (영업소·대리점)', desc: D_SHIP, tools: '운송차량' },
    ],
    // 라인이 합류 지점으로 들어가는 마지막 노드
    merges: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'],
  };

  // ============================================================
  // 논산 2공장 — 특수 (EXT 양어·반려 / 조분쇄 / 뱀장어 / 액상 / 향미제 / 용수 / 부자재)
  // ============================================================
  const F2 = {
    key: 'F2',
    factory: 'NS',
    title: '논산 2공장 특수 제조공정도',
    subtitle: 'EXT 라인이 주공정이며, 포장 후 대포장·소포장으로 갈라집니다',
    legend: [
      ['MG', '마그네트 자석'], ['RD', '로타리 드레서'], ['RMG', '로타리 마그네트'], ['ST', '시프터'],
    ],
    lanes: [
      { key: 'L1', no: 1, title: 'EXT 양어·반려', material: '원료',                     group: '공정' },
      { key: 'L2', no: 2, title: '조분쇄',          material: '옥수수, 대두박, 소맥피',   group: '공정' },
      { key: 'L3', no: 3, title: '뱀장어',          material: '원료',                     group: '공정' },
      { key: 'L4', no: 4, title: '액상',            material: '어유, 계유',               group: '공정' },
      { key: 'L5', no: 5, title: '향미제(반려)',    material: '분말·액상',                group: '공정' },
      { key: 'L6', no: 6, title: '용수',            material: '상수도(수돗물)',           group: '용수' },
      { key: 'L7', no: 7, title: '부자재',          material: '포장지(내/외)',            group: '부자재' },
    ],
    levels: [
      { key: 'v1',  label: '입고·검수', type: 'node' },
      { key: 'v2',  label: '보관',        type: 'node' },
      { key: 'm1',  label: '',            type: 'marker', text: 'RD · RMG · MG', lanes: ['L1', 'L2'] },
      { key: 'v3',  label: '조분쇄·스팀', type: 'node' },
      { key: 'm2',  label: '',            type: 'marker', text: 'MG', lanes: ['L1', 'L2'] },
      { key: 'v4',  label: '원료투입',    type: 'node' },
      { key: 'v5',  label: '계량',        type: 'node' },
      { key: 'v6',  label: '배합',        type: 'node' },
      { key: 'm3',  label: '',            type: 'marker', text: 'MG', lanes: ['L1', 'L1'] },
      { key: 'v7',  label: '미분쇄',      type: 'node' },
      { key: 'm4',  label: '',            type: 'marker', text: 'ST', lanes: ['L1', 'L1'] },
      { key: 'v8',  label: 'EXT 가공',  type: 'node' },
      { key: 'v9',  label: '건조·2차배합', type: 'node' },
      { key: 'm5',  label: '',            type: 'marker', text: 'MG', lanes: ['L1', 'L1'] },
      { key: 'v10', label: '냉각',        type: 'node' },
      { key: 'm6',  label: '',            type: 'marker', text: 'MG · ST', lanes: ['L1', 'L1'] },
      { key: 'v11', label: '진공코팅',    type: 'node' },
      { key: 'm7',  label: '',            type: 'marker', text: 'ST', lanes: ['L1', 'L1'] },
      { key: 'v12', label: '포장',        type: 'node' },
      { key: 'm8',  label: '',            type: 'marker', text: '금속 / 중량 검출기', lanes: ['L2', 'L2'] },
      { key: 'v13', label: '이물검출',   type: 'node' },
      { key: 'v14', label: '보관',        type: 'node' },
      { key: 'v15', label: '운송',        type: 'node' },
    ],
    nodes: [
      // 1 EXT
      { lane: 'L1', level: 'v1',  no: '1-1',  name: '입고/검수', desc: D_IN, tools: 'NIR · 샘플러' },
      { lane: 'L1', level: 'v2',  no: '1-2',  name: '보관(원료창고)', desc: D_KEEP, tools: '팔레트 · 낫가리카드' },
      { lane: 'L1', level: 'v4',  no: '1-3',  name: '원료투입', desc: D_FEED, tools: '정선망' },
      { lane: 'L1', level: 'v5',  no: '1-4',  name: '계량', desc: '원료를 배합비에 맞게 계량한다.', tools: '스케일' },
      { lane: 'L1', level: 'v6',  no: '1-5',  name: '배합', desc: D_MIX, tools: '배합기' },
      { lane: 'L1', level: 'v7',  no: '1-6',  name: '미분쇄', desc: '분쇄기를 통하여 분쇄를 진행한다.', tools: '분쇄기' },
      { lane: 'L1', level: 'v8',  no: '1-7',  name: '가공(EXT)', desc: '1. 분쇄된 원료를 압출하여 제품을 성형한다.\n2. 스팀온도 100~135℃ (제품별 상이)', tools: 'EXT' },
      { lane: 'L1', level: 'v9',  no: '1-8',  name: '가공(DRY)', ccp: ['CCP-2B'], desc: '1. 성형된 제품을 65℃ 이상 30분 이상 가열건조 진행\nCCP-2B : 살모넬라 불검출', tools: 'DRY' },
      { lane: 'L1', level: 'v10', no: '1-9',  name: '가공(COOLER)', desc: '가열건조된 제품의 열을 식히는 용도', tools: 'COOLER' },
      { lane: 'L1', level: 'v11', no: '1-10', name: '진공코팅', desc: '1. 냉각된 제품에 액상원료(어유·계유)를 투입한다.\n2. 반려의 경우 향미제(액상·분말)를 투입한다.\n3. 진공을 주어 원료가 제품에 잘 투입되도록 한다.', tools: '진공코팅기' },
      { lane: 'L1', level: 'v12', no: '1-11', name: '대포장', desc: '검수가 완료된 포장지로 자동 포장한다.', tools: '대포장기' },
      { lane: 'L1', level: 'v14', no: '1-14', name: '보관', desc: D_STORE, tools: '지게차 · 제품보관창고' },
      { lane: 'L1', level: 'v15', no: '1-15', name: '운송 (영업소·대리점)', desc: D_SHIP, tools: '운반차' },
      // 2 조분쇄 → 소포장 분기도 이 열에 그린다(원본 배치와 동일)
      { lane: 'L2', level: 'v1',  no: '2-1',  name: '입고/검수', desc: '1. 해당원료 : 옥수수, 대두박, 소맥피, 단백피\n2. 부두(수입) 또는 납품업체(내자)를 통해 공장 입고 시 원료의 성분을 검사한다.', tools: 'NIR · 화학분석 · 샘플러' },
      { lane: 'L2', level: 'v2',  no: '2-2',  name: '보관(원료창고)', desc: '사일로 또는 부사일로에 보관한다.', tools: '사일로 · 부사일로' },
      { lane: 'L2', level: 'v3',  no: '2-3',  name: '조분쇄 - H.M', pipeBreak: true, desc: '햄머밀을 통해 조분쇄를 진행한다.', tools: '분쇄기' },
      { lane: 'L2', level: 'v12', no: '1-12', name: '소포장', desc: '검수가 완료된 포장지로 자동 포장한다.', tools: '수직수평자동포장기 · 내포장지' },
      { lane: 'L2', level: 'v13', no: '1-13', name: 'X-Ray (소포장)', ccp: ['CCP-3P'], desc: '1. 작업 시작 전 시편을 통과시켜 작동상태를 확인한다.\n2. 모든 제품은 X-Ray 검출기를 통과시켜 이물 혼입 여부를 확인한다.\nCCP-3P : 금속 Fe·SUS 2.0mm / 비금속 Glass·Ceramic 4.0mm 이상 불검출', tools: 'X-Ray 검출기 · 시편' },
      { lane: 'L2', level: 'v14', no: '1-14', name: '보관', desc: D_STORE, tools: '지게차 · 제품보관창고' },
      { lane: 'L2', level: 'v15', no: '1-15', name: '운송 (영업소·대리점)', desc: D_SHIP, tools: '운반차' },
      // 3 뱀장어
      { lane: 'L3', level: 'v1',  no: '3-1',  name: '입고/검수', ccp: ['CCP-1B'], desc: '어분 - 입고 후 살모넬라 및 물성검사를 진행한다.\nCCP-1B : 살모넬라 불검출', tools: 'PCR · NIR · 반죽테스트' },
      { lane: 'L3', level: 'v2',  no: '3-2',  name: '보관', desc: '검수 완료 후 물성별로 구분보관한다.', tools: '팔레트 · 낫가리카드' },
      { lane: 'L3', level: 'v4',  no: '3-3',  name: '원료투입', desc: D_FEED, tools: '정선망' },
      { lane: 'L3', level: 'v5',  no: '3-4',  name: '계량', desc: '원료를 배합비에 맞게 계량한다.', tools: '스케일' },
      { lane: 'L3', level: 'v6',  no: '3-5',  name: '1차 배합 (어분+첨가제)', desc: D_MIX, tools: '배합기' },
      { lane: 'L3', level: 'v7',  no: '3-6',  name: '미분쇄', desc: D_GRIND, tools: '분쇄기' },
      { lane: 'L3', level: 'v9',  no: '3-7',  name: '2차 배합 (1차배합물+전분)', desc: D_MIX, tools: '배합기' },
      { lane: 'L3', level: 'v12', no: '1-11', name: '대포장', desc: '검수가 완료된 포장지로 자동 포장한다.', tools: '대포장기' },
      { lane: 'L3', level: 'v14', no: '1-14', name: '보관', desc: D_STORE, tools: '지게차 · 제품보관창고' },
      { lane: 'L3', level: 'v15', no: '1-15', name: '운송 (영업소·대리점)', desc: D_SHIP, tools: '운반차' },
      // 4 액상
      { lane: 'L4', level: 'v1',  no: '4-1',  name: '입고/검수', desc: '원료는 HACCP 지정업체 및 수입업체는 수입필증·검역증명서, 자가품질검사서 등 문서를 확인하고, 외관상태를 1차 확인한 후 2차 화학분석을 통과한 원료만 입고한다.\n[액상원료 AV(산가) 10 이하 관리]', tools: '샘플러 · 화학분석' },
      { lane: 'L4', level: 'v2',  no: '4-2',  name: '보관', desc: '어유·계유 탱크에 보관한다.', tools: '액상탱크' },
      { lane: 'L4', level: 'v5',  no: '4-3',  name: '계량', desc: '1. 계량펌프를 이용하여 자동계량한다.\n2. 계량된 액상원료는 진공코팅기(1-10)에 투입된다.', tools: '계량펌프' },
      // 5 향미제
      { lane: 'L5', level: 'v1',  no: '5-1',  name: '입고/검수', desc: '원료는 HACCP 지정업체 및 수입업체는 수입필증·검역증명서, 자가품질검사서 등 문서를 확인하고, 외관상태를 1차 확인한 후 입고한다.', tools: '샘플러 · 화학분석' },
      { lane: 'L5', level: 'v2',  no: '5-2',  name: '보관', desc: '1. 분말향미제는 반려 원료창고 및 향미제 탱크 내에 보관한다.\n2. 액상향미제는 상온에 보관한다.', tools: '향미제 탱크' },
      { lane: 'L5', level: 'v5',  no: '5-3',  name: '계량', desc: '1. 계량펌프를 이용하여 자동계량한다.\n2. 계량된 액상원료는 진공코팅기(1-10)에 투입된다.', tools: '계량펌프' },
      // 6 용수
      { lane: 'L6', level: 'v1',  no: '6-1',  name: '입수', desc: '1. 상수도를 활용한다.\n2. 연 2회 마시는물 기준으로 분석을 진행하여 품질을 확인한다.', tools: '샘플러 · 화학분석' },
      { lane: 'L6', level: 'v2',  no: '6-2',  name: '보관(물탱크)', desc: '물탱크에 보관한다.', tools: '물탱크' },
      { lane: 'L6', level: 'v3',  no: '6-3',  name: '보일러(스팀)', desc: '보일러를 이용하여 물을 가열하여 스팀을 생산한다.', tools: '보일러' },
      { lane: 'L6', level: 'v5',  no: '6-4',  name: '계량', desc: '1. 계량펌프를 이용하여 자동계량한다.\n2. 계량된 물은 EXT(1-7)에 투입된다.', tools: '계량펌프 · 작업패널' },
      // 7 부자재
      { lane: 'L7', level: 'v1',  no: '7-1',  name: '입고/검수', desc: '포장지 외관(찍힘·오염 등), 사료관리법 표기사항, 오타, 수량 등을 확인한다.', tools: '용기 및 포장검사 체크시트' },
      { lane: 'L7', level: 'v2',  no: '7-2',  name: '보관', desc: D_KEEP, tools: '낫가리카드 · 팔레트' },
    ],
    // 원본 엑셀은 서로 다른 흐름을 같은 열에 그린다. 어디서 어디로 가는지 화살표로 명시한다.
    links: [
      { from: 'L2|2-3',  to: 'L1|1-5'  },   // 조분쇄 원료 → 배합
      { from: 'L1|1-10', to: 'L2|1-12' },   // 진공코팅 → 소포장
      { from: 'L4|4-3',  to: 'L1|1-10' },   // 액상 계량 → 진공코팅
      { from: 'L5|5-3',  to: 'L1|1-10' },   // 향미제 계량 → 진공코팅
      { from: 'L6|6-4',  to: 'L1|1-7'  },   // 용수 계량 → EXT
      { from: 'L3|3-7',  to: 'L3|1-11' },   // 2차배합 → 대포장
    ],
    merges: [],
  };

  // 라인별 색 — 원료 라인을 눈으로 구분하기 위한 것(문서에는 색 구분이 없다)
  const LANE_TONE = {
    공정: 'proc', 용수: 'water', 부자재: 'pack',
  };

  return { F1, F2, LANE_TONE, list: [F1, F2] };
})();
