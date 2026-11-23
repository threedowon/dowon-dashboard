"""Render repository docs into the offline reader; run after changing these docs."""
import hashlib
import html
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

import markdown
from markdown.extensions.toc import slugify_unicode

ROOT = Path(__file__).resolve().parent
PAGES = {
    'code': ('devices/CODE-GUIDE.md', 'Arduino·ESP32 코드 작성'),
    'fsr': ('devices/fsr/README.md', 'FSR 배선과 보정'),
    'sen0610': ('devices/sen0610/README.md', 'SEN0610 배선과 설정'),
    'fsr-source': ('devices/fsr/src/main.cpp', 'FSR 전체 소스'),
    'sen0610-source': ('devices/sen0610/src/main.cpp', 'SEN0610 전체 소스'),
    'manual': ('LOCAL-TESTER.md', 'Signal Tester 사용 설명서'),
    'readme': ('README.md', '실행과 설정 백업'),
    'devices': ('devices/README.md', '센서 펌웨어 안내'),
}
OUTPUT = ROOT/'signal_tester_ui/code-guide.json'


def build():
    pages = {}
    by_path = {(ROOT/path).resolve(): key for key, (path, _) in PAGES.items()}
    for key, (path, title) in PAGES.items():
        file = ROOT/path
        source = file.read_text(encoding='utf-8')
        toc = []
        if file.suffix == '.cpp':
            body = '<pre><code class="language-cpp">'+html.escape(source)+'</code></pre>'
        else:
            renderer = markdown.Markdown(extensions=['fenced_code', 'tables', 'toc'],
                                         extension_configs={'toc': {'slugify': slugify_unicode}})
            body = renderer.convert(source)
            def headings(items):
                for item in items:
                    if item['level'] == 2:
                        toc.append({'id': item['id'], 'title': html.unescape(item['name'])})
                    headings(item['children'])
            headings(renderer.toc_tokens)

            def link(match):
                url = html.unescape(match[1])
                parsed = urlsplit(url)
                if parsed.scheme or parsed.netloc:
                    if parsed.scheme not in ('https', 'http'):
                        raise ValueError('Unsupported guide link: '+url)
                    return 'href="'+html.escape(url, quote=True)+'" target="_blank" rel="noopener noreferrer" title="온라인 자료"'
                target = (file.parent/unquote(parsed.path)).resolve() if parsed.path else file.resolve()
                page = by_path.get(target)
                if page:
                    return ('href="#" data-guide-page="'+page+'" data-guide-anchor="'+
                            html.escape(re.sub(r'-+', '-', unquote(parsed.fragment)), quote=True)+'"')
                raise ValueError('Add linked document to offline bundle: '+url)
            body = re.sub(r'href="([^"]*)"', link, body)
        pages[key] = {'title': title, 'html': body, 'toc': toc, 'source': path,
                      'sha256': hashlib.sha256(source.encode('utf-8')).hexdigest()}
    return {'pages': pages}


if __name__ == '__main__':
    OUTPUT.write_text(json.dumps(build(), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('Built offline sensor code guide.')
