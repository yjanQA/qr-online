// ============================================================
// feature_flags.js — 기능 스위치 (가장 먼저 불러온다)
//
//   QR 기능은 2026-11-06 화면에서 숨겼다. 입고는 송장 스캔(invoice_scan.js)으로 처리한다.
//   코드·데이터(qr.js, ScanPage, 기록의 qrCode, 상태값 QR_ISSUED)는 지우지 않았다.
//   이미 인쇄된 QR 라벨의 링크(?page=scan&id=…)와 일지 현장 QR 링크는 계속 열린다.
//
//   복구 방법: 아래 qr 값을 true 로 바꾸면 메뉴·버튼·문구가 모두 돌아온다.
//     · 화면 표시는 QR_ON(스크립트), .qr-only / data-noqr(index.html·CSS) 세 곳으로만 갈린다.
//     · manifest.webmanifest 의 앱 바로가기만 스위치로 못 바꾼다. 원래 값은 git 이력을 본다.
// ============================================================

window.FEATURES = { qr: false };

const QR_ON = window.FEATURES.qr === true;

// 입고번호 표시. 사전입고번호가 없는 건은 내부 id(QR-…)를 쓰는데, 숨긴 동안에는 접두어를 뺀다.
const recvNo = (r) => r.preRegId || (QR_ON ? r.id : String(r.id).replace(/^QR-/, ''));

if (!QR_ON) {
  document.documentElement.classList.add('no-qr');
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-noqr]').forEach(el => { el.textContent = el.dataset.noqr; });
  });
}
