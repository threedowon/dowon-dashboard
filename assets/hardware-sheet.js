(() => {
  'use strict';
  const mount = document.getElementById('hardwareMount');
  const help = document.getElementById('hardwareHelp');
  const readonly = document.documentElement.dataset.readonly === 'true';
  function show() {
    if (readonly) {
      help.textContent = '공유 HTML에는 실시간 신청표가 포함되지 않습니다. 새 탭에서 원본 신청표를 열어주세요.';
      return;
    }
    if (location.hash !== '#hardware' || mount.firstElementChild) return;
    const frame = document.createElement('iframe');
    frame.title = 'Hardware Sheet 팀 구매 신청표';
    frame.src = './hardware/';
    frame.className = 'hardware-frame';
    // The sheet runs from this repository with its own styles and shared API.
    // Do not sandbox it: file downloads and product links require normal navigation.
    mount.append(frame);
  }
  window.addEventListener('hashchange', show);
  show();
})();
