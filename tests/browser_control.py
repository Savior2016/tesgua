"""Synthetic control interactions: no Tesla requests and no real vehicle commands."""
import json, mimetypes, os, time
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from browser_smoke import BASE, ROOT

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('BROWSER_EXECUTABLE') or None)
    for role in ['admin','viewer']:
        for width in [320,390,1440]:
            ctx=browser.new_context(viewport={'width':width,'height':900});page=ctx.new_page();errors=[];commands=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            state={'configured':True,'ever_configured':True,'role':role,
                   'states':{'locked':True,'sentry':True,'frunk_open':True,'trunk_open':False,'charge_port':False,'windows_open':False,
                             'climate_on':True,'climate_temp':22,'inside_temp':25,'charging':False,'cable':True,'charge_limit':80,
                             'charge_amps':16,'charge_power':11,'charge_eta':2.5,'defrost':False,'wheel_heater':False,
                             'seats':{'0':3},'ota_status':'available','ota_version':'2026.26.3',
                             'charge_schedules':[{'name':'家','days':'All','start':1380,'end':420,'enabled':True,'one_time':False}],
                             'precondition_schedules':[],
                             'reported_at':int(time.time()*1000),'source':'fleet'},
                   'vehicle':{'car_type':'modely','exterior_color':'PearlWhiteMultiCoat','wheel_type':'Pinwheel19'},
                   'nap':{}}
            def route(r):
                path=urlsplit(r.request.url).path
                if path.startswith('/api/'):
                    key=path[5:]
                    if key=='control/status':return r.fulfill(json=state)
                    if r.request.method=='POST':
                        commands.append((key,r.request.post_data_json))
                        if role=='viewer':return r.fulfill(status=403,json={'detail':'只读'})
                        if key=='control/refresh':return r.fulfill(json={'ok':True,'states':state['states']})
                        if key=='control/nap/start':state['nap']={'phase':'active','ends_at':time.time()+1800,'minutes':30}
                        if key=='control/nap/stop':state['nap']={'phase':'completed','ends_at':time.time()}
                        return r.fulfill(json=state['nap'] if '/nap/' in key else {'ok':True})
                    value=dict(BASE.get(key,{}))
                    if key in ['overview','account/status']:value['role']=role
                    return r.fulfill(json=value)
                f=ROOT/('index.html' if path=='/' else path.lstrip('/'))
                if not f.is_file():return r.fulfill(status=404)
                r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
            ctx.route('**/*',route)
            page.goto('http://teslahome.test/#control',wait_until='networkidle')
            assert page.locator('#page-control').is_visible()
            assert page.locator('#ctl-model-temp').text_content()=='22.0°C'
            # 状态为视觉效果:开启部位带 .on 发光,标签只保留静态名称
            assert 'on' in (page.locator('[data-zone="frunk"]').get_attribute('class') or '').split()
            assert page.locator('[data-zone="frunk"] .zone-lab').text_content()=='前备箱'
            assert 'on' in (page.locator('[data-zone="lock"]').get_attribute('class') or '').split()
            # 五张模块瓦片(空调/充电/车灯/午休/导航推送),滑动开关只有前四张有
            assert page.locator('.ctl-module[data-panel]').count()==5
            assert page.locator('.ctl-module-open').count()==5
            assert page.locator('.ctl-module .ctl-slide').count()==4
            # OTA 徽标 + 车辆静态配置(车型/颜色 + 车身按实车配色)
            assert page.locator('#ctl-backend .ctl-be-label.warn').text_content()=='OTA 2026.26.3 可下载'
            assert page.locator('#ctl-card-sub').text_content()=='Model Y · 珍珠白 · Pinwheel19'
            assert page.evaluate("document.querySelector('#page-control .ctl-car').style.getPropertyValue('--car-body')")=='#f2f2f0'
            # #control 深链只生效一次:hash 被清除,刷新后靠 localStorage 停留当前页
            assert page.evaluate('location.hash')==''
            assert not page.locator('#ctl-setup').is_visible()
            # 模块网格在车模区域的滑层里:先上滑展开(peek 按钮),瓦片才可交互
            page.locator('#ctl-sheet-peek').click()
            assert page.locator('#ctl-sheet.open #ctl-sheet-home').is_visible()
            # 模块滑动开关:键盘 Enter 触发开/关(空调当前开 → 发关闭);滑动本身即确认,无确认窗
            if role=='admin':
                assert 'on' in (page.locator('[data-panel="climate"]').get_attribute('class') or '').split()
                page.locator('[data-panel="climate"] .ctl-slide').press('Enter')
                page.wait_for_function("document.querySelector('#ctl-operation-message').textContent.includes('指令已接受')")
            else:
                page.locator('[data-panel="climate"] .ctl-slide').press('Enter')
                page.wait_for_function("document.querySelector('#ctl-operation-message').textContent.includes('只读')")
            for name in ['climate','charge','lights','nap','nav']:
                page.locator('[data-panel="'+name+'"] .ctl-module-open').click()
                assert page.locator('#ctl-sheet.open #ctl-sheet-detail').is_visible()
                box=page.locator('#ctl-sheet').bounding_box();assert box['x']>=0 and box['x']+box['width']<=width
                if name=='climate':
                    if role=='admin':
                        page.locator('#ctl-temp-input').fill('23.5')
                        page.get_by_role('button',name='设置温度',exact=True).click()
                        page.wait_for_function("document.querySelector('#ctl-dialog-message').textContent.includes('指令已接受')")
                        # 冬季组:除霜/方向盘加热滑块 + 主驾座椅加热档位(状态上报了 3 档)
                        assert page.locator('#ctl-dialog-body .ctl-slide-row').count()>=3
                        seg=page.locator('#ctl-dialog-body .ctl-seg').last
                        assert seg.locator('button.on').text_content()=='3'
                        seg.locator('button').nth(2).click()
                        page.wait_for_function("document.querySelector('#ctl-dialog-message').textContent.includes('指令已接受')")
                    else:
                        assert page.get_by_role('button',name='设置温度',exact=True).is_disabled()
                        assert page.locator('#ctl-dialog-body .ctl-slide-row .ctl-slide').count()>=1
                if name=='charge':
                    # 实时功率/预计充满 + 电流设置 + 车机定时充电只读列表
                    assert page.locator('#ctl-amps-input').input_value()=='16'
                    assert page.locator('#ctl-dialog-body').text_content().__contains__('11 kW')
                    assert page.locator('#ctl-dialog-body').text_content().__contains__('预计剩余 2 小时 30 分')
                    assert page.locator('#ctl-dialog-body').text_content().__contains__('家 · 每天 · 23:00 · – 07:00')
                    if role=='admin':
                        page.locator('#ctl-amps-input').fill('10')
                        page.get_by_role('button',name='设置电流',exact=True).click()
                        page.wait_for_function("document.querySelector('#ctl-dialog-message').textContent.includes('指令已接受')")
                if name=='nav':
                    if role=='admin':
                        page.locator('#ctl-nav-input').fill('公司')
                        page.get_by_role('button',name='推送到车机',exact=True).click()
                        page.wait_for_function("document.querySelector('#ctl-dialog-message').textContent.includes('指令已接受')")
                    else:
                        assert page.get_by_role('button',name='推送到车机',exact=True).is_disabled()
                if name=='nap' and role=='admin':
                    nap_switch=page.locator('#ctl-dialog-body .ctl-slide-row .ctl-slide')
                    nap_switch.press('Enter')
                    page.wait_for_function("document.querySelector('#ctl-nap-status').textContent.includes('剩余')")
                    nap_switch.press('Enter')
                    page.wait_for_function("document.querySelector('#ctl-nap-status').textContent==='已结束'")
                page.keyboard.press('Escape')  # 详情 → 模块网格
                assert not page.locator('#ctl-sheet-detail').is_visible()
            page.keyboard.press('Escape')  # 网格 → 车模
            assert page.locator('#ctl-sheet.open').count()==0
            # 前备箱:滑动触发后弹出自定义二次确认窗
            if role=='admin':
                page.locator('[data-zone="frunk"]').dispatch_event('click')
                assert page.locator('#ctl-sheet.open #ctl-sheet-detail').is_visible()
                page.locator('#ctl-dialog-body .ctl-slide').press('Enter')
                assert page.locator('#ctl-confirm[open]').is_visible()
                page.locator('#ctl-confirm-yes').click()
                page.wait_for_function("document.querySelector('#ctl-dialog-message').textContent.includes('指令已接受')")
                page.keyboard.press('Escape')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            if role=='admin':
                assert ('control/command',{'cmd':'set_temps','args':{'driver_temp':23.5}}) in commands
                assert ('control/command',{'cmd':'auto_conditioning_stop','args':{}}) in commands
                assert ('control/command',{'cmd':'remote_seat_heater_request','args':{'heater':0,'level':2}}) in commands
                assert ('control/command',{'cmd':'set_charging_amps','args':{'charging_amps':10}}) in commands
                assert ('control/command',{'cmd':'share','args':{'value':'公司'}}) in commands
                assert ('control/command',{'cmd':'actuate_trunk','args':{'which_trunk':'front'}}) in commands
                # 指令成功后的延迟状态刷新(control/refresh)是否落在断言前取决于时序,剔除再计数
                assert len([c for c in commands if c[0]!='control/refresh'])==8
            else:assert not commands
            # No configuration: show one tidy link; a partially configured user returns via account settings.
            state.update(configured=False,ever_configured=False)
            page.reload(wait_until='networkidle')
            assert page.locator('#ctl-setup').is_visible()
            if role=='admin' and width==390:
                folder=Path(os.environ.get('TEMP','/tmp'))/'teslahome-control-screens';folder.mkdir(exist_ok=True)
                page.screenshot(path=str(folder/'mobile.png'),full_page=True)
                page.locator('#ctl-sheet-peek').click()
                page.locator('[data-panel="nap"] .ctl-module-open').click();page.screenshot(path=str(folder/'nap.png'))
            page.goto('http://teslahome.test/account.html',wait_until='networkidle')
            assert page.locator('#control-settings-entry').is_visible()==(role=='admin')
            assert not errors,errors
            ctx.close();print('CONTROL_BROWSER',role,width,'passed',flush=True)
    browser.close()
