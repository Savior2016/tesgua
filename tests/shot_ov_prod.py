"""Screenshot the production overview page in 3D mode with synthetic telemetry.
Reuses browser_smoke.BASE mock; verifies #car-card.ov3d chrome removal + two-row backdrop.
Usage: python3 shot_ov_prod.py out.png [width] [height] [model]"""
import mimetypes, os, sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser_smoke import BASE  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent / 'app' / 'static'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/ov-prod.png')
WIDTH = int(sys.argv[2]) if len(sys.argv) > 2 else 1440
HEIGHT = int(sys.argv[3]) if len(sys.argv) > 3 else 900
MODEL = sys.argv[4] if len(sys.argv) > 4 else 'y-yl'

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('BROWSER_EXECUTABLE') or None)
    ctx = browser.new_context(viewport={'width': WIDTH, 'height': HEIGHT}, device_scale_factor=2)
    ctx.add_init_script(f"localStorage.setItem('ttv-carmodel', '{MODEL}'); localStorage.setItem('ttv-ovmode', '3d');")
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    def route(r):
        path = urlsplit(r.request.url).path
        if path.startswith('/api/'):
            key = path[5:]
            if key in BASE:
                return r.fulfill(json=BASE[key])
            return r.fulfill(json={})
        f = ROOT / ('index.html' if path == '/' else path.lstrip('/'))
        if not f.is_file():
            return r.fulfill(status=404)
        r.fulfill(body=f.read_bytes(), content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
    ctx.route('**/*', route)

    page.goto('http://teslahome.test/', wait_until='load')
    for _ in range(30):   # 等 3D 模型加载完(loading 隐藏)
        page.wait_for_timeout(1000)
        if page.evaluate('''() => { const l = document.getElementById("txov-loading");
            return l && getComputedStyle(l).display === "none"; }'''):
            break
    page.wait_for_timeout(1500)   # 轨道插值收敛
    page.evaluate('window.__txov && __txov.pause()')
    page.wait_for_timeout(300)
    print('card ov3d class:', page.evaluate('document.getElementById("car-card").className'))
    print('status label present:', page.evaluate('!!document.querySelector(".txov-status")'))
    print('orbit:', page.evaluate('window.__txov && JSON.stringify(__txov.getOrbit())'))
    page.screenshot(path=str(OUT), full_page=False)
    print('saved', OUT, 'errors:', errors or 'none')
    browser.close()
