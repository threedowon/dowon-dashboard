/* The guide is bundled with the EXE and never calls the device API. */
(() => {
  const dialog = document.getElementById('codeGuideDialog');
  const article = document.getElementById('codeGuideArticle');
  const menu = document.getElementById('codeGuidePage');
  const contents = document.getElementById('codeGuideContents');
  const status = document.getElementById('codeGuideStatus');
  let bundle, loading;

  function jump(anchor) {
    const heading = [...article.querySelectorAll('[id]')].find(node => node.id === anchor);
    if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); heading.scrollIntoView({block:'start'}); }
    else { article.scrollTop = 0; article.focus({preventScroll:true}); }
  }
  function show(page = 'code', anchor = '') {
    const doc = bundle.pages[page];
    if (!doc) return;
    menu.value = page;
    // Only locally bundled, build-generated documentation is rendered here.
    article.innerHTML = doc.html;
    contents.replaceChildren();
    for (const item of doc.toc) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = item.title;
      button.onclick = () => jump(item.id); contents.append(button);
    }
    for (const code of article.querySelectorAll('pre > code.language-cpp')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'button code-copy'; button.textContent = '코드 복사';
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(code.textContent); status.textContent = '코드를 복사했습니다. Arduino IDE 또는 PlatformIO에 붙여 넣으세요.'; }
        catch { status.textContent = '자동 복사를 사용할 수 없습니다. 코드 내용을 선택해 Ctrl+C로 복사하세요.'; }
      };
      code.parentElement.before(button);
    }
    status.textContent = '';
    jump(anchor);
  }
  async function open() {
    if (!dialog.open) dialog.showModal();
    if (bundle) { show(); return; }
    status.textContent = '가이드를 여는 중입니다…';
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('code-guide.json', {signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error('Guide unavailable');
      bundle = await response.json();
      menu.replaceChildren();
      for (const [key, doc] of Object.entries(bundle.pages)) {
        const option = document.createElement('option'); option.value = key; option.textContent = doc.title; menu.append(option);
      }
      if (dialog.open) show();
    } catch {
      bundle = null;
      status.textContent = '가이드를 열지 못했습니다. 닫았다가 다시 열어 주세요. 계속되면 프로그램을 업데이트해 주세요.';
    } finally { loading = false; }
  }
  document.getElementById('openCodeGuide').onclick = open;
  document.getElementById('codeGuideClose').onclick = () => dialog.close();
  document.getElementById('codeGuideHome').onclick = () => bundle && show();
  menu.onchange = () => bundle && show(menu.value);
  article.addEventListener('click', event => {
    const link = event.target.closest('a[data-guide-page]');
    if (!link) return;
    event.preventDefault(); show(link.dataset.guidePage, link.dataset.guideAnchor);
  });
})();
