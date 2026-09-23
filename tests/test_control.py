import threading
import time
import pytest
from fastapi import HTTPException
from test_security import client, store, login
from app import control, nap


def sample(mode="off"):
    ts=time.time()*1000
    return {"climate_state":{"timestamp":ts,"climate_keeper_mode":mode,"is_climate_on":mode!="off","driver_temp_setting":22,"inside_temp":25},"vehicle_state":{"timestamp":ts,"locked":True,"sentry_mode":False,"ft":1,"rt":0,"fd_window":0,"fp_window":0,"rd_window":0,"rp_window":0},"charge_state":{"timestamp":ts,"charging_state":"Disconnected","charge_port_door_open":False,"charge_limit_soc":80}}


@pytest.fixture
def timer(tmp_path):
    clock=[time.time()]
    calls=[]
    mode=["off"]
    def command(cmd,args,vin):
        calls.append((cmd,args,vin))
        mode[0]="camp" if args['climate_keeper_mode']==3 else "off"
        return {"ok":True}
    t=nap.NapTimer(tmp_path/'nap.json',lambda vin:sample(mode[0]),command,lambda:clock[0])
    return t,clock,calls,mode


def _until_at(ts, offset):
    """HH:MM in DISPLAY_TZ at `ts + offset` seconds, matching nap._until_ts semantics."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from app.main import DISPLAY_TZ
    return datetime.fromtimestamp(ts+offset, ZoneInfo(DISPLAY_TZ)).strftime("%H:%M")


def test_nap_until_caps_end(timer):
    t,clock,calls,mode=timer
    until=_until_at(clock[0],120)
    t.start('synthetic-vin',30,until)
    assert t.public()['until']==until
    assert abs(t.read()['ends_at']-(clock[0]+120))<61  # 到点早于计时,先到先停
    clock[0]+=181;t.tick()
    assert t.public()['phase']=='completed'


def test_nap_until_past_today_falls_back_to_minutes(timer):
    t,clock,calls,mode=timer
    until=_until_at(clock[0],-3600)
    t.start('synthetic-vin',10,until)  # 该时间点今日已过→次日,计时先触发
    assert abs(t.read()['ends_at']-(clock[0]+600))<2
    clock[0]+=601;t.tick()
    assert t.public()['phase']=='completed'


def test_nap_until_validation(client,monkeypatch,timer):
    monkeypatch.setattr(nap,'timer',timer[0]);login(client)
    for value in ['25:00','12:60','1:00','ab:cd',123]:
        assert client.post('/api/control/nap/start',json={'minutes':30,'until':value}).status_code==422
    assert not timer[2]


def test_nap_survives_restart_and_pins_vehicle(timer):
    t,clock,calls,mode=timer
    t.start('synthetic-vin',5)
    assert t.public()['phase']=='active' and 'vin' not in t.public()
    restarted=nap.NapTimer(t.path,t.fetch,t.command,t.clock)
    restarted.tick();assert len(calls)==1
    clock[0]+=301;restarted.tick()
    assert restarted.public()['phase']=='completed'
    assert [x[1]['climate_keeper_mode'] for x in calls]==[3,0]
    assert all(x[2]=='synthetic-vin' for x in calls)
    restarted.tick();assert len(calls)==2


def test_nap_duplicate_and_external_mode(timer):
    t,clock,calls,mode=timer;t.start('synthetic-vin',5)
    with pytest.raises(HTTPException):t.start('another-vin',5)
    mode[0]='dog';clock[0]+=301;t.tick()
    assert len(calls)==1 and t.public()['phase']=='completed'


def test_nap_shutdown_failure_retries(timer):
    t,clock,calls,mode=timer;t.start('synthetic-vin',5)
    original=t.command
    t.command=lambda *a: {'ok':False}
    clock[0]+=301;t.tick()
    assert t.public()['phase']=='retrying'
    assert t.active()
    t.command=original;clock[0]+=301;t.tick()
    assert t.public()['phase']=='completed'


def test_nap_start_timeout_arms_cleanup(timer):
    t,clock,calls,mode=timer
    original=t.command
    def uncertain(*args):
        original(*args)
        raise TimeoutError('private upstream text')
    t.command=uncertain
    with pytest.raises(HTTPException) as e:t.start('synthetic-vin',5)
    assert 'private upstream text' not in e.value.detail
    assert t.public()['phase']=='retrying'
    t.command=original;t.tick()
    assert t.public()['phase']=='completed'
    assert [x[1]['climate_keeper_mode'] for x in calls]==[3,0]


def test_nap_does_not_override_existing_climate(timer):
    t,clock,calls,mode=timer
    for value in ['dog','camp','on',None]:
        mode[0]=value
        with pytest.raises(HTTPException):t.start('synthetic-vin',5)
    assert not calls


def test_nap_config_guard(timer,monkeypatch):
    t,*_=timer;monkeypatch.setattr(nap,'timer',t)
    t.start('synthetic-vin',5)
    with pytest.raises(HTTPException):nap.ensure_idle()
    t.stop();nap.ensure_idle()


def test_state_requires_fresh_explicit_values(monkeypatch):
    p=sample();result=control.normalize_vehicle(p)
    assert result['frunk_open'] is True and result['trunk_open'] is False
    assert result['locked'] is True and result['sentry'] is False
    assert result['climate_temp']==22 and result['charge_port'] is False
    p['vehicle_state']['timestamp']-=180000
    result=control.normalize_vehicle(p)
    assert result['frunk_open'] is None and result['locked'] is None
    monkeypatch.setattr(control,'_snapshot',{})
    monkeypatch.setattr(control,'_live_states',lambda:{})
    monkeypatch.setattr(control,'_optimistic',lambda:{'locked':True})
    # 实报缺失时以持久化的乐观推测为准(否则开关刷新后全部掉回未知/关闭)
    assert control._states()['locked'] is True
    # 新鲜实报的非 None 值覆盖乐观推测
    ts=int(time.time()*1000)
    monkeypatch.setattr(control,'_live_states',lambda:{'climate_on':False,'reported_at':ts})
    merged=control._states()
    assert merged['locked'] is True and merged['climate_on'] is False and merged['source']=='teslamate'


def test_new_endpoints_block_viewer(client):
    login(client,'guest')
    for path in ['refresh','nap/start','nap/stop']:
        assert client.post('/api/control/'+path,json={'minutes':30}).status_code==403


def test_nap_duration_validation(client,monkeypatch,timer):
    monkeypatch.setattr(nap,'timer',timer[0]);login(client)
    for value in [0,181,2.5,True,'30']:
        assert client.post('/api/control/nap/start',json={'minutes':value}).status_code==422
    assert not timer[2]


def command_harness(monkeypatch, online, forward):
    """Stub the command backend: returns the recorded call list."""
    calls=[]
    monkeypatch.setattr(control,'CONTROL_API_URL','http://backend.test')
    monkeypatch.setattr(control,'CONTROL_API_TOKEN','test-token')
    monkeypatch.setattr(control,'_vin',lambda:'vin-test')
    monkeypatch.setattr(control,'_awake_until',0.0)
    monkeypatch.setattr(control,'_teslamate_online',lambda vin:online(vin) if callable(online) else online)
    monkeypatch.setattr(control,'_save_optimistic',lambda patch:None)
    def spy(cmd,args,vin=None):
        calls.append(cmd)
        return forward(cmd,calls)
    monkeypatch.setattr(control,'_forward',spy)
    return calls


def test_command_wakes_sleeping_vehicle_first(client,monkeypatch):
    calls=command_harness(monkeypatch,False,lambda cmd,calls:{'ok':True,'reason':''})
    login(client)
    response=client.post('/api/control/command',json={'cmd':'door_lock','args':{}})
    assert response.status_code==200
    assert calls==['wake_up','door_lock']
    assert response.json()['woke'] is True


def test_command_skips_wake_when_online(client,monkeypatch):
    calls=command_harness(monkeypatch,True,lambda cmd,calls:{'ok':True,'reason':''})
    login(client)
    response=client.post('/api/control/command',json={'cmd':'door_lock','args':{}})
    assert response.status_code==200
    assert calls==['door_lock'] and 'woke' not in response.json()


def test_command_retries_after_mid_command_nap(client,monkeypatch):
    # TeslaMate 状态为 online(预检通过),但执行时车辆恰好入睡:直接唤醒后重发一次
    def forward(cmd,calls):
        if cmd=='door_lock' and calls.count('door_lock')==1:
            return {'ok':False,'reason':'vehicle unavailable: vehicle is offline or asleep'}
        return {'ok':True,'reason':''}
    calls=command_harness(monkeypatch,True,forward)
    login(client)
    response=client.post('/api/control/command',json={'cmd':'door_lock','args':{}})
    assert response.status_code==200 and response.json()['ok'] is True
    assert calls==['door_lock','wake_up','door_lock']


def test_wake_timeout_returns_504(client,monkeypatch):
    monkeypatch.setattr(control,'WAKE_TIMEOUT',0.05)
    monkeypatch.setattr(control,'WAKE_POLL',0.01)
    command_harness(monkeypatch,False,lambda cmd,calls:{'ok':False,'reason':''})
    login(client)
    response=client.post('/api/control/command',json={'cmd':'door_lock','args':{}})
    assert response.status_code==504
    assert '唤醒超时' in response.json()['detail']


def extended():
    """sample() + 新增分段:OTA/舒适/充电细节/车机定时/静态配置。"""
    p=sample()
    p['vehicle_state']['software_update']={"status":"downloading","version":"2026.26.3","download_perc":45}
    p['climate_state'].update({"steering_wheel_heater":True,"defrost_mode":2,"bioweapon_mode":False,
                               "seat_heater_left":3,"seat_heater_right":1,"seat_heater_rear_left":0})
    p['charge_state'].update({"charging_state":"Charging","charge_current_request":16,"charge_amps":14,
                              "charger_power":11,"time_to_full_charge":2.5})
    p['charge_schedule_data']={"schedules":[{"name":"家","days_of_week":"All","start_enabled":True,"start_time":1380,
                                             "end_enabled":True,"end_time":420,"enabled":True,"one_time":False,
                                             "latitude":31.2,"longitude":121.5}]}
    p['preconditioning_schedule_data']={"schedules":[{"name":"上班","days_of_week":"Weekdays","precondition_time":510,
                                                      "enabled":True,"one_time":False,"latitude":31.2,"longitude":121.5}]}
    p['vehicle_config']={"exterior_color":"PearlWhiteMultiCoat","car_type":"modely","wheel_type":"Pinwheel19","vin":"HIDDEN"}
    return p


def test_normalize_extended_fields():
    r=control.normalize_vehicle(extended())
    assert r['ota_status']=='downloading' and r['ota_version']=='2026.26.3' and r['ota_perc']==45
    assert r['wheel_heater'] is True and r['defrost'] is True and r['bioweapon'] is False
    assert r['seats']=={'0':3,'1':1,'2':0}
    assert r['charge_amps']==16 and r['charge_power']==11 and r['charge_eta']==2.5
    cs=r['charge_schedules'][0]
    assert cs['name']=='家' and cs['days']=='All' and cs['start']==1380 and cs['end']==420
    assert 'latitude' not in cs and 'longitude' not in cs  # 坐标绝不入快照
    ps=r['precondition_schedules'][0]
    assert ps['time']==510 and 'latitude' not in ps and 'longitude' not in ps
    assert r['vehicle_config']=={'exterior_color':'PearlWhiteMultiCoat','car_type':'modely','wheel_type':'Pinwheel19'}


def test_normalize_missing_new_sections_keeps_none():
    r=control.normalize_vehicle(sample())
    for key in ['ota_status','charge_amps','charge_power','charge_eta','wheel_heater','defrost','bioweapon','seats']:
        assert r[key] is None
    assert r['charge_schedules']==[] and r['precondition_schedules']==[]
    assert 'vehicle_config' not in r


def test_validate_new_commands():
    args=control._validate_args('share',{'value':' 上海市浦东新区特斯拉中心\n','junk':1})
    assert args['type']=='share_ext_content_raw'
    assert args['value']=={'android.intent.extra.TEXT':'上海市浦东新区特斯拉中心'}
    assert set(args)=={'type','value','locale','timestamp_ms'}
    with pytest.raises(HTTPException):control._validate_args('share',{'value':''})
    with pytest.raises(HTTPException):control._validate_args('share',{'value':'x'*501})
    assert control._validate_args('set_charging_amps',{'charging_amps':16})=={'charging_amps':16}
    with pytest.raises(HTTPException):control._validate_args('set_charging_amps',{'charging_amps':40})
    assert control._validate_args('remote_seat_heater_request',{'heater':2,'level':3})=={'heater':2,'level':3}
    with pytest.raises(HTTPException):control._validate_args('remote_seat_heater_request',{'heater':9,'level':3})
    with pytest.raises(HTTPException):control._validate_args('remote_steering_wheel_heater_request',{'on':1})


def test_state_patch_new_commands():
    assert control._state_patch('set_charging_amps',{'charging_amps':8})=={'charge_amps':8}
    assert control._state_patch('remote_steering_wheel_heater_request',{'on':True})=={'wheel_heater':True}
    assert control._state_patch('set_preconditioning_max',{'on':False})=={'defrost':False}
    assert control._state_patch('set_bioweapon_mode',{'on':True})=={'bioweapon':True}


def test_state_patch_seat_merges_existing(monkeypatch):
    monkeypatch.setattr(control,'_optimistic',lambda:{'seats':{'0':3}})
    assert control._state_patch('remote_seat_heater_request',{'heater':1,'level':2})=={'seats':{'0':3,'1':2}}


def test_command_new_whitelist_entries(client,monkeypatch):
    calls=command_harness(monkeypatch,True,lambda cmd,calls:{'ok':True,'reason':''})
    login(client)
    for body in [{'cmd':'share','args':{'value':'公司'}},{'cmd':'set_charging_amps','args':{'charging_amps':10}},
                 {'cmd':'remote_seat_heater_request','args':{'heater':0,'level':2}},
                 {'cmd':'remote_steering_wheel_heater_request','args':{'on':True}},
                 {'cmd':'set_preconditioning_max','args':{'on':True}},{'cmd':'set_bioweapon_mode','args':{'on':True}}]:
        assert client.post('/api/control/command',json=body).status_code==200, body
    assert calls==['share','set_charging_amps','remote_seat_heater_request',
                   'remote_steering_wheel_heater_request','set_preconditioning_max','set_bioweapon_mode']
    assert client.post('/api/control/command',json={'cmd':'share','args':{'value':''}}).status_code==422


def test_refresh_persists_vehicle_config(client,monkeypatch):
    saved=[]
    monkeypatch.setattr(control,'CONTROL_API_URL','http://backend.test')
    monkeypatch.setattr(control,'CONTROL_API_TOKEN','test-token')
    monkeypatch.setattr(control,'_vin',lambda:'vin-test')
    monkeypatch.setattr(control,'vehicle_data',lambda vin:extended())
    monkeypatch.setattr(control,'_snapshot',{})
    monkeypatch.setattr(control,'_snapshot_checked',0.0)
    monkeypatch.setattr(control,'_snapshot_vin','')
    monkeypatch.setattr(control,'_snapshot_error','')
    monkeypatch.setattr(control,'_config_cached',lambda:{})
    monkeypatch.setattr(control,'_save_config',lambda c:saved.append(c))
    login(client)
    r=client.post('/api/control/refresh')
    assert r.status_code==200 and r.json()['ok'] is True
    assert saved==[{'exterior_color':'PearlWhiteMultiCoat','car_type':'modely','wheel_type':'Pinwheel19'}]
    states=r.json()['states']
    assert states['ota_status']=='downloading' and states['charge_amps']==16
    assert states['charge_schedules'][0]['name']=='家'


def test_refresh_throttled_second_call_does_not_deadlock(client,monkeypatch):
    """回归:10 秒节流窗口内的第二次 refresh 曾在持有 _snapshot_lock 时调用 _states()
    (同一把非重入锁),线程自死锁,随后所有 status 请求排队堵死,控制页瘫痪。"""
    monkeypatch.setattr(control,'CONTROL_API_URL','http://backend.test')
    monkeypatch.setattr(control,'CONTROL_API_TOKEN','test-token')
    monkeypatch.setattr(control,'_vin',lambda:'vin-test')
    monkeypatch.setattr(control,'vehicle_data',lambda vin:sample())
    monkeypatch.setattr(control,'_snapshot',{})
    monkeypatch.setattr(control,'_snapshot_checked',0.0)
    monkeypatch.setattr(control,'_snapshot_vin','')
    monkeypatch.setattr(control,'_snapshot_error','')
    login(client)
    assert client.post('/api/control/refresh').status_code==200
    result={}
    def again():result['r']=client.post('/api/control/refresh')
    th=threading.Thread(target=again,daemon=True);th.start();th.join(10)
    assert not th.is_alive(),'节流窗口内的 refresh 在 _snapshot_lock 上死锁'
    assert result['r'].status_code==200 and result['r'].json()['ok'] is True
