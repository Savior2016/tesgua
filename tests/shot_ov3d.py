"""Screenshot test.html section 3 (ov3d.js stage) for visual iteration.
Usage: python3 shot_ov3d.py out.png [width] [height] [model]"""
import mimetypes, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent / 'app' / 'static'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/ov3d.png')
WIDTH = int(sys.argv[2]) if len(sys.argv) > 2 else 1440
HEIGHT = int(sys.argv[3]) if len(sys.argv) > 3 else 900
MODEL = sys.argv[4] if len(sys.argv) > 4 else 'y-yl'

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('BROWSER_EXECUTABLE') or None)
    ctx = browser.new_context(viewport={'width': WIDTH, 'height': HEIGHT}, device_scale_factor=2)
    ctx.add_init_script(f"localStorage.setItem('ttv-carmodel', '{MODEL}');")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    def route(r):
        path = urlsplit(r.request.url).path
        if path.startswith('/api/'):
            return r.fulfill(json={})
        f = ROOT / ('test.html' if path in ('/', '/test.html') else path.lstrip('/'))
        if not f.is_file():
            return r.fulfill(status=404)
        r.fulfill(body=f.read_bytes(), content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
    ctx.route('**/*', route)

    page.goto('http://teslahome.test/test.html', wait_until='load')
    for _ in range(25):   # 等模型加载完(loading 隐藏)
        page.wait_for_timeout(1000)
        if page.evaluate('document.getElementById("txov-loading").style.display') == 'none':
            break
    page.wait_for_timeout(1500)   # 轨道插值收敛
    page.evaluate('window.__txov && __txov.pause(); document.getElementById("txov-stage").scrollIntoView({block:"center"})')
    page.wait_for_timeout(300)
    print('orbit:', page.evaluate('window.__txov && JSON.stringify(__txov.getOrbit())'))
    box = page.evaluate('''() => { const r = document.getElementById("txov-stage").getBoundingClientRect();
        return {x: r.left, y: r.top, width: r.width, height: r.height}; }''')
    page.screenshot(path=str(OUT), clip=box)
    print('saved', OUT, 'errors:', errors or 'none')
    browser.close()
