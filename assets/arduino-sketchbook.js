(() => {
  'use strict';
  const cards = [...document.querySelectorAll('[data-sketch]')].map(card => {
    const file = card.querySelector('[data-sketch-file]');
    const code = card.querySelector('[data-sketch-code]');
    const copy = card.querySelector('[data-sketch-copy]');
    const select = card.querySelector('[data-sketch-select]');
    const retry = card.querySelector('[data-sketch-retry]');
    const status = card.querySelector('[data-sketch-status]');
    let revision = 0, started = false;
    const selectCode = () => { code.focus(); code.select(); code.setSelectionRange(0, code.value.length); };
    async function load() {
      started = true;
      const current = ++revision;
      code.value = '';
      code.placeholder = '코드를 불러오는 중…';
      code.setAttribute('aria-busy', 'true');
      copy.disabled = select.disabled = true;
      retry.hidden = true;
      status.textContent = '파일을 불러오는 중…';
      try {
        const response = await fetch(`signal-tester/devices/${card.dataset.sketch}/${file.value}`);
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Source unavailable');
        const text = await response.text();
        if (!text.trim()) throw new Error('Empty source');
        if (current !== revision) return;
        code.value = text;
        code.setAttribute('aria-label', `${card.dataset.sketch.toUpperCase()} ${file.value}`);
        copy.disabled = select.disabled = false;
        status.textContent = `${file.value} · ${text.trimEnd().split('\n').length}줄 · 전체 코드를 복사할 수 있습니다.`;
      } catch {
        if (current !== revision) return;
        code.placeholder = '파일을 불러오지 못했습니다.';
        status.textContent = '다시 불러오거나 위의 다운로드 링크를 사용해 주세요.';
        retry.hidden = false;
      } finally {
        if (current === revision) code.setAttribute('aria-busy', 'false');
      }
    }
    copy.addEventListener('click', async () => {
      const current = revision;
      const text = code.value;
      try {
        await navigator.clipboard.writeText(text);
        if (current === revision) status.textContent = '복사했습니다. 편집기에 붙여넣으세요.';
      } catch {
        if (current !== revision) return;
        selectCode();
        status.textContent = '전체 코드를 선택했습니다. Ctrl+C 또는 ⌘C로 복사하세요.';
      }
    });
    select.addEventListener('click', () => {
      selectCode();
      status.textContent = 'Ctrl+C 또는 ⌘C로 복사한 뒤 편집기에 붙여넣으세요.';
    });
    file.addEventListener('change', load);
    retry.addEventListener('click', load);
    return () => { if (!started) load(); };
  });
  const activate = () => { if (location.hash === '#arduino') cards.forEach(load => load()); };
  window.addEventListener('hashchange', activate);
  activate();
})();
