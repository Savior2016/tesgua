# 从 three.js 页面抓取蒙皮后的顶点 dump:python3 dump-willie.py <clip> <t> <out.json>
# 前置:把 app/static/vendor、scripts/dump-willie.html(改名 index.html)、willieMickey.glb
# 放同一目录,python3 -m http.server 8899 起本地服务。
import sys, json
from playwright.sync_api import sync_playwright

CLIP, T, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
RAW = "&raw=1" if CLIP == "raw" else ""   # clip=raw:不播动画,导绑定几何(全剪辑只覆盖部分骨骼,会散件)
with sync_playwright() as p:
    br = p.chromium.launch(args=["--use-gl=swiftshader"])
    pg = br.new_context().new_page()
    pg.goto(f"http://127.0.0.1:8899/index.html?clip={CLIP}&t={T}&view=front&dump=1{RAW}", wait_until="commit")
    for _ in range(120):
        if pg.evaluate("() => window.__ready || window.__err || 'wait'") != "wait":
            break
        pg.wait_for_timeout(500)
    dump = pg.evaluate("() => window.__dump || null")
    assert dump, "no dump produced"
    open(OUT, "w").write(dump)
    parts = json.loads(dump)
    xs = [v for pt in parts for v in pt["verts"][0::3]]
    ys = [v for pt in parts for v in pt["verts"][1::3]]
    zs = [v for pt in parts for v in pt["verts"][2::3]]
    print("PARTS", len(parts), "bbox",
          [round(min(xs), 2), round(min(ys), 2), round(min(zs), 2)],
          [round(max(xs), 2), round(max(ys), 2), round(max(zs), 2)])
    br.close()
print("DUMP", OUT)
