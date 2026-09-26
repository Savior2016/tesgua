"""Offline browser regression with synthetic telemetry only.
Set BROWSER_EXECUTABLE to an installed Chromium/Edge, or install Playwright Chromium.
"""
import json
import mimetypes
import os
import time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1] / "app/static"
NOW = int(time.time() * 1000)
XSS = '<img src="data:image/png;base64,invalid" onerror="window.__auditXss=true">'
CAR = {"id":1,"name":"合成测试车辆","model":"Y","trim_badging":"long_range","efficiency":0.15}
BASE = {
 "overview": {"role":"admin","car_id":1,"cars":[CAR],"state":"offline","software_version":"test","update_pending":True,
   "latest":{"date_ts":NOW-18*3600000,"usable_battery_level":75,"battery_level":75,"rated_battery_range_km":400,"ideal_battery_range_km":400,"odometer":10000,"inside_temp":24,"outside_temp":20},
   "kwh_per_ideal_km":0.15,"kwh_per_pct":0.75,"totals":{"drives_total":3,"month_km":300,"week_km":100,"year_km":2000,"month_energy_kwh":45},"charging":{"sessions":2,"energy_kwh":40,"cost":30,"duration_min":60}},
 "drives/daily":{"days_rows":[{"day":"2026-09-01","distance":30,"drives":2}]},
 "charging/summary":{"totals":{},"sessions":[]},
 "charging/sessions":{"charges":[{"id":7,"start_ts":NOW-7200000,"end_ts":NOW-3600000,"start_local":"2026-09-14 01:00:00","end_local":"2026-09-14 02:00:00","duration_min":60,"energy_kwh":10.0,"energy_used_kwh":None,"total_kwh":None,"total_kwh_manual":False,"start_battery_level":40,"end_battery_level":55,"loc_key":"addr_7","charger_name":"","charger_location":"家","charger_brand":"","cost":None,"cost_home":5.0,"cost_effective":5.0,"home_mode":"auto","home_name":"车位桩","rate_yuan_kwh":0.5,"after_km":60.0,"per_km_yuan":0.0833}]},
 "charging/home":{"master":True,"role":"admin","chargers":[{"key":"addr_7","name":"车位桩","enabled":True,"peak":1.0,"valley":0.5,"vstart":"23:00","vend":"07:00","location":"家","sessions":12}],"candidates":[{"key":"addr_7","name":"家","count":12,"added":True},{"key":"addr_9","name":"公司","count":8,"added":False}],"vstart_default":"23:00","vend_default":"07:00"},
 # 充电会话逐点曲线(功率/电压/电流/电池加热):i=10..20 加热中
 "charging/curve":{"charge_id":7,
   "points":[[NOW-7200000+i*60000, 10 if i%2 else 11, 228, 16, 1 if 10<=i<=20 else 0] for i in range(60)],
   "heater_spans":[[NOW-7200000+600000, NOW-7200000+1260000]]},
 "routes":{"routes":[{"id":1,"start_date_ts":NOW-3600000,"end_date_ts":NOW,"distance":10,"duration_min":30,"speed_max":80,"start_ideal_range_km":400,"end_ideal_range_km":388,"start_name":XSS,"end_name":"合成终点","points":[[0,0,50,0],[0.005,0.005,65,35],[0.01,0.01,80,125]]}]},
 "activity":{"days":7,"battery":[[NOW-3600000,80],[NOW,75]],"drives":[],"charges":[],
   "sentry":[{"s":NOW-6*3600000,"e":NOW-5*3600000,"s_lvl":76,"e_lvl":75,"delta":-1,"dur_min":60,"kind":"sentry","real":True,"rate_pct_h":-1.0,"energy_kwh":0.75,"cost_yuan":0.38}],
   "idle":[{"s":NOW-4*3600000,"e":NOW-3*3600000,"s_lvl":74,"e_lvl":73,"delta":-1,"dur_min":60,"kind":"occupied","has_climate":True,"energy_kwh":0.75,"cost_yuan":0.38}],
   "kwh_per_pct":0.75},
 # 真实遥测驻车会话(哨兵耗电曲线点 + 小憩/午休列表行,均可点击弹详情)
 "parked/overview":{"days":7,"kwh_per_pct":0.75,"coverage_start":NOW-86400000,
   "collector":{"connected":True,"last_ts":None},
   "sentry":[{"s":NOW-6*3600000,"e":NOW-5*3600000,"s_full":NOW-6*3600000,"dur_min":60,"s_lvl":76,"e_lvl":75,"drop_pct":1,"energy_kwh":0.75,"rate_pct_h":1.0,"rate_kwh_h":0.75,"cost_yuan":0.38,"has_climate":False}],
   "rest":[{"s":NOW-4*3600000,"e":NOW-3*3600000,"s_full":NOW-4*3600000,"dur_min":60,"s_lvl":74,"e_lvl":72,"drop_pct":2,"energy_kwh":1.5,"rate_pct_h":2.0,"rate_kwh_h":1.5,"cost_yuan":0.75,"has_climate":True}],
   "nap":[{"s":NOW-2*3600000,"e":NOW-3600000,"s_full":NOW-2*3600000,"dur_min":60,"s_lvl":72,"e_lvl":70,"drop_pct":2,"energy_kwh":1.5,"rate_pct_h":2.0,"rate_kwh_h":1.5,"cost_yuan":0.75,"has_climate":False}]},
 "efficiency/trend":{"points":[{"start_ts":NOW-3600000,"eff_wh_km":145,"distance":10,"duration_min":30,"start_name":XSS,"end_name":"合成终点"}]},
 "tpms/trend":{"wheels":{w:[[NOW-3600000,2.9],[NOW,2.9]] for w in ['fl','fr','rl','rr']}},
 "tpms/weekly":{"weeks":[{"week":"2026-W37","start":"09-08","fl":2.88,"fr":2.92,"rl":2.9,"rr":2.85},
   {"week":"2026-W38","start":"09-15","fl":2.9,"fr":3.0,"rl":2.9,"rr":2.9},
   {"week":"2026-W39","start":"09-22","fl":2.9,"fr":3.0,"rl":2.9,"rr":2.9}]},
 "energy/monthly":{"kwh_per_ideal_km":0.15,"months":[{"month":"2026-08","eff_wh_km":140,"drive_km":500,"temp_c":27},
   {"month":"2026-09","eff_wh_km":130,"drive_km":400,"temp_c":23}]},
 "system":{"disk_pct":20,"mem_pct":30},
 "battery/health":{"health_pct":98,"current_kwh":75,"nominal_kwh":76.5,"samples":8,"last_ts":NOW},
 "energy/cycles":{"cycles":[]},
 "temp/trend":{"inside":[[NOW-3600000,22],[NOW,24]],"outside":[[NOW-3600000,18],[NOW,20]]},
 "parking/fees":{"fees":[],"month_total":0,"total":0},"vehicle/delivery":{"date":"2026-01-01"},
 "vehicle/lifetime":{"car_id":1,"total_km":10000,"drive_km":2000,"since":NOW-40*86400000,"drive_kwh":300,"parked_kwh":40,"total_kwh":340,"total_cost":250.5,"sessions":10,"priced_sessions":9,"rate_yuan_kwh":0.65,"charged_kwh":410,"nominal_kwh":85.4,"cycles":4.8},
 "charging/reminder":{"ready":True,"overridden":False,"reason":"",
   "home":{"label":XSS,"address_ids":[1],"visits":20,"nights":15,"days":2},
   "work":{"label":"合成公司","address_ids":[8],"visits":18,"nights":1,"days":14},
   "candidates":[{"key":0,"label":XSS,"address_ids":[1],"visits":20,"nights":15,"days":2},
                 {"key":1,"label":"合成公司","address_ids":[8],"visits":18,"nights":1,"days":14}],
   "current_range_km":180.5,"battery_pct":44,"current_loc":"work","min_pct":20,"threshold_km":80.0,"days_left":2.6,"charge_by_ts":NOW+2*86400000,
   "charge_at":"work","charge_kind":"before_leg","next_leg":"to_home","charge_place":"公司 · 合成公司",
   "charger":{"name":"合成快充","location":"合成路","times":3},
   "leg_km":{"to_work":27.0,"to_home":27.0},"drain_km_day":{"home":7.2,"work":6.0},"sample_legs":20},
 "control/status":{"configured":False,"states":{"locked":None,"climate_on":None,"charging":None,"cable":None}},
 "account/status":{"user":"owner","users":["owner","guest"],"role":"admin","roles":{"owner":"admin","guest":"viewer"},"tesla":{"authorized":True,"token_updated_ts":NOW},"cars":[dict(CAR,vin_tail="------")],"sync":{"positions":10,"drives":2,"charges":2,"last_data_ts":NOW},"steps":{"deployed":True,"authorized":True,"car_detected":True,"synced":True}}
}


def run():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=os.environ.get("BROWSER_EXECUTABLE") or None)
        for role in ["admin", "viewer"]:
            errors, writes = [], []
            failed = set()
            ctx = browser.new_context(viewport={"width":390,"height":844})
            def route_handler(route):
                path = urlsplit(route.request.url).path
                if path.startswith("/api/"):
                    key = path[5:]
                    if route.request.method not in ("GET", "HEAD"):
                        writes.append(key)
                        route.fulfill(status=403, json={"detail":"test blocks mutations"})
                    elif key in failed:
                        route.fulfill(status=503, json={"detail":"simulated unavailable"})
                    elif key.startswith("map/"):
                        route.fulfill(status=503, json={"detail":"simulated map data unavailable"})
                    else:
                        data = dict(BASE.get(key, {}))
                        if key in ["overview","account/status"]:data['role']=role
                        route.fulfill(json=data)
                    return
                filename = "login.html" if path == "/login" else ("index.html" if path == "/" else path.lstrip("/"))
                source = (ROOT / filename).resolve()
                if not source.is_relative_to(ROOT) or not source.is_file():
                    route.fulfill(status=404);return
                route.fulfill(body=source.read_bytes(),content_type=mimetypes.guess_type(str(source))[0] or 'application/octet-stream',headers={"Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'"})
            ctx.route("**/*",route_handler)
            ctx.add_init_script("HTMLElement.prototype.requestFullscreen=function(){return Promise.reject(new Error('smoke: fullscreen disabled'))}")
            page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto('http://teslahome.test/',wait_until='networkidle')
            assert page.locator('#car-name').inner_text() == '合成测试车辆'
            assert page.locator('#state-text').inner_text() != '数据连接失败'
            # 顶栏 OTA 徽标:overview.update_pending → 「OTA <version> 更新中」
            assert page.locator('#ota-text').inner_text() == 'OTA test 更新中'
            assert page.locator('.vehicle-readings').count()==0
            assert page.locator('#tpms-on-fl').count()==1
            # 车况页「生涯总览」:总里程/总耗电量/充电总费用(火星背景卡,隐藏页也已渲染)
            assert page.locator('#life-km').inner_text() == '10,000'
            assert page.locator('#life-kwh').inner_text() == '340'
            assert '未计价' in page.locator('#life-cost-sub').inner_text()
            assert page.locator('#life-cycles').inner_text() == '4.8'
            # 充电中:overview.charge_eta → 风挡电量下方显示「约剩 N 分」+ .charging 扫光
            BASE['overview']['state'] = 'charging'
            BASE['overview']['charge_eta'] = {"minutes": 23, "target_pct": 80}
            page.locator('#car-name').click()
            page.wait_for_timeout(400)
            assert page.locator('#car-batt-range').text_content() == '约剩 23 分'
            assert page.locator('.car-svg.charging').count() == 1
            # 还原为非充电态:恢复剩余里程小字
            BASE['overview']['state'] = 'offline'
            BASE['overview'].pop('charge_eta')
            page.locator('#car-name').click()
            page.wait_for_timeout(400)
            assert page.locator('#car-batt-range').text_content() == '400 km'
            # 温度卡片:渐变温度线(visualMap 按值着色)+ 温差带(_ 前缀内部系列不进图例/tooltip)
            opt = page.evaluate("echarts.getInstanceByDom(document.querySelector('#chart-temp')).getOption()")
            assert len(opt['visualMap']) == 1 and opt['visualMap'][0]['seriesIndex'] == [2, 3]
            names = [s['name'] for s in opt['series']]
            assert names == ['_band_base', '_band_delta', '车内', '车外']
            # 仪表盘:5 套皮肤容器 + 圆点切换;离线 mock 下 WS/快照失败须静默容忍,驻车覆盖层照常渲染
            page.locator('.tab[data-page="dash"]').click()
            page.wait_for_selector('.dash-skin[data-skin="minimal"].on', timeout=4000)  # 默认极简数字(进场动画完成后挂载)
            assert page.locator('#page-dash .dash-skin').count()==5
            assert page.locator('#dash-dots .dash-dot').count()==5
            assert page.locator('#page-dash #ds-m-speed').count()==1
            assert page.locator('#page-dash #ds-m-powerfill').count()==1
            assert page.locator('#dash-parked:not([hidden])').count()==1  # 非行车态驻车布局
            for skin in ['gauges','map','aviator','spacex','minimal']:
                page.locator('.dash-dot[data-skin="'+skin+'"]').click();page.wait_for_timeout(80)
                assert page.locator('.dash-skin[data-skin="'+skin+'"].on').count()==1, skin
                assert page.locator('.dash-dot[data-skin="'+skin+'"].on').count()==1, skin
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.evaluate('if(document.fullscreenElement) document.exitFullscreen()')  # 窄屏自动全屏会罩住 Dock,先退出
            page.wait_for_timeout(150)
            page.locator('.tab[data-page="nav"]').click();page.wait_for_timeout(400)
            # 导航页:搜索框/途经点输入/地图容器;离线 mock 下(nav/config 无 key)提示去个人中心
            assert page.locator('#nav-dest-inp').count()==1
            assert page.locator('#nav-via-inp').count()==1
            assert page.locator('#nav-map').count()==1
            assert '个人中心' in page.locator('#nav-msg').inner_text()
            page.locator('.tab[data-page="data"]').click();page.wait_for_timeout(120)
            assert page.locator('.dtab[data-sub="charging"].on').count()==1
            assert page.locator('#page-charging.active').count()==1
            for width in [320,390,1440]:
                page.set_viewport_size({"width":width,"height":900})
                for tab in ['overview','dash','nav','data','control']:
                    page.evaluate('if(document.fullscreenElement) document.exitFullscreen()')  # dash 窄屏自动全屏先退出
                    page.locator('.tab[data-page="'+tab+'"]').click();page.wait_for_timeout(80)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (role,width,tab)
                    if tab == 'data':
                        for sub in ['charging','drives','activity','vehicle']:
                            page.locator('.dtab[data-sub="'+sub+'"]').click();page.wait_for_timeout(60)
                            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (role,width,tab,sub)
            page.set_viewport_size({"width":390,"height":844})
            # 行程详情:展开后渲染键值表格 + 海拔高度图,收起后图表销毁
            page.locator('.tab[data-page="data"]').click()
            page.locator('.dtab[data-sub="drives"]').click()
            page.wait_for_timeout(100)
            page.locator('.rt-row').first.click()
            page.wait_for_timeout(150)
            assert page.locator('.rt-row.open + .rt-detail .rt-kv-item').count()==9
            assert page.evaluate("!!echarts.getInstanceByDom(document.querySelector('.rt-elev'))")
            assert page.locator('.rt-map.maplibregl-map').count()==1  # 详情小地图
            assert page.locator('.rt-speed-legend').count()==1  # 轨迹按车速变色 + 色带图例
            assert not page.evaluate('window.__auditXss===true')
            page.locator('.rt-row').first.click()
            page.wait_for_timeout(80)
            assert page.evaluate("!echarts.getInstanceByDom(document.querySelector('.rt-elev'))")
            assert page.locator('.rt-map.maplibregl-map').count()==0  # 收起后小地图销毁
            # 地图点选轨迹:对应行程行自动展开并渲染海拔图,标题含起终点落差
            page.wait_for_function("!!(window.__ttvMap && window.__ttvMap.getSource('ttv-routes'))")
            page.evaluate("""() => {
              const m = window.__ttvMap;
              const p = m.project([0.005, 0.005]);
              m.fire('click', {lngLat: m.unproject([p.x, p.y]), point: p});
            }""")
            page.wait_for_timeout(150)
            assert page.locator('.rt-row.open').count()==1
            assert page.evaluate("!!echarts.getInstanceByDom(document.querySelector('.rt-elev'))")
            assert page.locator('.rt-map.maplibregl-map').count()==1
            assert '落差' in page.locator('.rt-elev-title').inner_text()
            # 家充设置卡:总开关 + 地点行;管理员可见添加行与开关,viewer 全部只读
            page.locator('.dtab[data-sub="charging"]').click()
            page.wait_for_timeout(100)
            page.locator('#hc-head').click()
            page.wait_for_timeout(80)
            assert page.locator('#hc-body .hc-master .tsw').count()==1
            assert page.locator('#hc-body .hc-row').count()==1
            if role=='admin':
                assert page.locator('#hc-body .hc-add select').count()==1
                assert not page.evaluate("document.querySelector('#hc-body .hc-master input').disabled")
            else:
                assert page.locator('#hc-body .hc-add').count()==0
                assert page.evaluate("document.querySelector('#hc-body .hc-master input').disabled")
                assert page.evaluate("document.querySelector('#hc-body .hc-row input.hc-name').disabled")
            # 充电详情:家充自动电费标签 + 计价方式(admin 下拉 / viewer 文本)
            page.locator('#cs-head').click()
            page.wait_for_timeout(80)
            assert page.locator('.cs-tag-home').count()==1
            if role=='admin':
                assert page.locator('.cs-home-sel').count()==1
                assert page.locator('.cs-home-sel').input_value()=='auto'
            else:
                assert page.locator('.cs-home-sel').count()==0
            # 充电曲线:展开懒加载渲染 ECharts(按上报情况画轴+加热底纹),收起后销毁
            page.locator('.cs-curve-toggle').first.click()
            page.wait_for_timeout(200)
            assert page.evaluate("!!echarts.getInstanceByDom(document.querySelector('.cs-curve-chart'))")
            assert page.locator('.cs-curve-toggle.open').count()==1
            # 主题切换触发全量重渲染:展开的曲线必须自动恢复(挂在 isConnected 检查之后)
            page.locator('#theme-btn').click()
            page.wait_for_timeout(300)
            assert page.evaluate("!!echarts.getInstanceByDom(document.querySelector('.cs-curve-chart'))")
            page.locator('#theme-btn').click()
            page.wait_for_timeout(300)
            page.locator('.cs-curve-toggle').first.click()
            page.wait_for_timeout(80)
            assert page.evaluate("!echarts.getInstanceByDom(document.querySelector('.cs-curve-chart'))")
            page.locator('.dtab[data-sub="activity"]').click()
            page.wait_for_timeout(100)
            page.locator('#chart-efficiency').scroll_into_view_if_needed()
            page.evaluate("echarts.getInstanceByDom(document.getElementById('chart-efficiency')).dispatchAction({type:'showTip',seriesIndex:0,dataIndex:0})")
            page.wait_for_timeout(100)
            assert not page.evaluate('window.__auditXss===true')
            assert page.locator('[onerror]').count()==0
            # 哨兵耗电卡:1 个点 + 加权平均虚线;小憩/午休各一行;活动事件含小憩 chip
            opt = page.evaluate("echarts.getInstanceByDom(document.querySelector('#chart-sentry-drain')).getOption()")
            assert len(opt['series'][0]['data']) == 1
            assert opt['series'][0]['markLine']
            assert page.locator('#rest-list .pkd-row').count() == 1
            assert page.locator('#nap-list .pkd-row').count() == 1
            assert page.locator('#events-list .ev-chip.cat-nap').count() == 1
            assert '(实报)' in page.locator('#events-list .ev-row:has(.ev-chip.cat-sentry) .ev-desc').first.inner_text()
            # 小憩行点击 → 详情弹窗;关闭后点击哨兵曲线点 → 哨兵详情
            page.locator('#rest-list .pkd-row').first.click()
            page.wait_for_timeout(80)
            assert page.evaluate("document.getElementById('parked-dialog').open")
            assert page.locator('#parked-dialog-title').inner_text() == '小憩详情'
            assert page.locator('#parked-dialog-body .rt-kv-item').count() == 8
            page.locator('#parked-dialog-close').click()
            assert not page.evaluate("document.getElementById('parked-dialog').open")
            page.locator('#chart-sentry-drain').scroll_into_view_if_needed()
            page.evaluate('scrollBy(0, -140)')  # 图表下移,让数据点避开 sticky 顶栏遮挡区
            pt = page.evaluate("""() => {
              const c = echarts.getInstanceByDom(document.getElementById('chart-sentry-drain'));
              const d = c.getOption().series[0].data[0];
              return c.convertToPixel({seriesIndex: 0}, Array.isArray(d) ? d : d.value);
            }""")
            bb = page.locator('#chart-sentry-drain').bounding_box()
            page.mouse.click(bb['x'] + pt[0], bb['y'] + pt[1])
            page.wait_for_timeout(80)
            assert page.evaluate("document.getElementById('parked-dialog').open")
            assert page.locator('#parked-dialog-title').inner_text() == '哨兵详情'
            page.locator('#parked-dialog-close').click()
            assert not page.evaluate('window.__auditXss===true')
            # 旧版主 Tab 记忆值迁移:ttv-tab='drives' → 落在「数据」页行程子页
            page.evaluate("localStorage.setItem('ttv-tab','drives')")
            page.reload(wait_until='networkidle')
            page.wait_for_timeout(400)
            assert page.evaluate("document.querySelector('.tab[data-page=\"data\"]').classList.contains('on')")
            assert page.locator('.dtab[data-sub="drives"].on').count()==1
            assert page.locator('#page-drives.active').count()==1
            page.evaluate("localStorage.setItem('ttv-tab','overview')")
            page.goto('http://teslahome.test/account.html',wait_until='networkidle')
            assert page.locator('#teslamate-link').get_attribute('href')=='http://localhost:4000'
            assert page.locator('#authorization-guide').count()==0
            assert page.locator('#nu-role').count()==0
            # 备份管理已迁至 /backup.html,整库导入为禁用说明钮
            page.goto('http://teslahome.test/backup.html',wait_until='networkidle')
            assert page.locator('#bk-import-note').is_visible()
            assert not errors, errors
            assert not writes, writes
            page.evaluate("localStorage.setItem('ttv-theme','light')")
            page.reload(wait_until='networkidle')
            assert page.locator('html').get_attribute('data-theme')=='light'
            output=os.environ.get('BROWSER_SCREENSHOTS')
            if output and role=='admin':
                Path(output).mkdir(parents=True,exist_ok=True)
                page.goto('http://teslahome.test/',wait_until='networkidle')  # 从 backup.html 回到主面板
                page.wait_for_timeout(600)
                page.screenshot(path=str(Path(output)/'synthetic-overview.png'),full_page=True)
                # 数据页(二级导航)与占位页截图
                page.locator('.tab[data-page="data"]').click();page.wait_for_timeout(800)
                page.screenshot(path=str(Path(output)/'synthetic-data.png'),full_page=True)
                page.locator('.tab[data-page="dash"]').click();page.wait_for_timeout(600)
                page.screenshot(path=str(Path(output)/'synthetic-dash.png'),full_page=True)
            ctx.close()
            print(role, 'browser regression passed',flush=True)
        browser.close()


if __name__=='__main__':run()
