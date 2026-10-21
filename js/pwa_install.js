// ============================================================
// pwa_install.js — 현장 단말 앱 설치 버튼
// ============================================================

const PWAInstall = (() => {
  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const button = () => document.getElementById('pwa-install-btn');

  const setButton = (visible, text = '앱 설치') => {
    const btn = button();
    if (!btn) return;
    btn.classList.toggle('hidden', !visible);
    btn.textContent = text;
  };

  const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    // 새 서비스워커가 대기 상태가 되면 즉시 활성화(skipWaiting) → 새 버전 자동 반영
    navigator.serviceWorker.register('./service-worker.js')
      .then((reg) => {
        try { reg.update(); } catch (_) {}
        const promote = (sw) => { if (sw) sw.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage && sw.postMessage('SKIP_WAITING'); }); };
        if (reg.waiting) reg.waiting.postMessage && reg.waiting.postMessage('SKIP_WAITING');
        reg.addEventListener('updatefound', () => promote(reg.installing));
      })
      .catch((err) => console.warn('[PWA] service worker register failed:', err));
    // 새 SW가 제어권을 잡으면(=업데이트 활성화) 페이지 1회 자동 새로고침 → 항상 최신 화면
    //   최초 설치(기존 컨트롤러 없음)일 때는 새로고침하지 않음.
    const hadController = !!navigator.serviceWorker.controller;
    let _reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_reloaded || !hadController) return; _reloaded = true;
      window.location.reload();
    });
  };

  const init = () => {
    registerServiceWorker();
    if (isStandalone()) {
      setButton(false);
      return;
    }

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      setButton(true, '앱 설치');
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      setButton(false);
      App?.toast?.('앱 설치가 완료되었습니다', 'success');
    });

    if (location.protocol === 'file:') {
      setButton(false);
    }
  };

  const prompt = async () => {
    if (isStandalone()) {
      App?.toast?.('이미 앱 모드로 실행 중입니다', 'info');
      return;
    }
    if (!deferredPrompt) {
      App?.toast?.('Android Chrome에서는 메뉴의 "앱 설치" 또는 "홈 화면에 추가"를 사용할 수 있습니다', 'info', 4500);
      return;
    }

    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    setButton(false);
  };

  return { init, prompt };
})();

window.addEventListener('DOMContentLoaded', () => PWAInstall.init());
