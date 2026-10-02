"""Verify the drive-detail speed×energy chart renders with synthetic power data."""
import json, mimetypes, math, os, time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser_smoke import BASE, ROOT

NOW = int(time.time() * 1000)
# 合成一条 10km 行程:60 个点,速度 0→120→0,功率随速度变化含回收段
pts = []
for i in range(60):
    t = i / 59
    lat, lon = 31.0 + t * 0.08, 121.0 + t * 0.05
    ele = 20 + 40 * math.sin(t * math.pi)
    spd = max(0, 120 * math.sin(t * math.pi) ** 0.7)
    pwr = (spd ** 2) / 900 + (8 if i % 7 else -22)   # 驱动功率 + 周期性回收
    if spd < 3:
        pwr = 0.4
    pts.append([lat, lon, round(ele, 1), round(spd, 1), round(pwr, 1)])

routes = json.loads(json.dumps(BASE['routes']))
routes['routes'][0]['points'] = pts

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('BROWSER_EXECUTABLE') or None)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    def route(r):
        path = urlsplit(r.request.url).path
        if path.startswith('/api/'):
            key = path[5:].split('?')[0]
            if key == 'routes':
                return r.fulfill(json=routes)
            value = dict(BASE.get(key, {}))
            if key in ['overview', 'account/status']:
                value['role'] = 'admin'
            return r.fulfill(json=value)
        f = ROOT / ('index.html' if path == '/' else path.lstrip('/'))
        if not f.is_file():
            return r.fulfill(status=404)
        r.fulfill(body=f.read_bytes(), content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
    ctx.route('**/*', route)

    page.goto('http://teslahome.test/', wait_until='load')
    page.wait_for_timeout(2500)
    page.evaluate('''() => {
      document.querySelector('.tabbar .tab[data-page="data"]').click();
    }''')
    page.wait_for_timeout(1500)
    # 数据页默认子页是「行程」(充电已升为顶级 Tab);今日分组默认展开,直接点首条行程
    page.evaluate('document.querySelector("#routes-list .rt-row").click()')
    page.wait_for_timeout(1200)
    wraps = page.locator('#routes-list .rt-detail .rt-elev-wrap')
    titles = wraps.all_text_contents()
    print('detail chart blocks:', [t[:12] for t in titles])
    assert any('速度 × 能耗' in t for t in titles), '速度×能耗 图块缺失'
    canvases = page.locator('#routes-list .rt-detail canvas').count()
    print('canvas count:', canvases)
    assert canvases >= 3, '海拔图/速度能耗图 canvas 未渲染'
    row = page.locator('#routes-list .rt-detail').first
    row.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    page.screenshot(path='/tmp/drive-eng.png', full_page=False)
    print('saved /tmp/drive-eng.png, errors:', errors or 'none')
    browser.close()
