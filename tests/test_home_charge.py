"""家充设置:峰谷计价单元测试 + 接口回归(全部走 mock DB,不连真实库)。"""
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.auth import AccountStore

PASSWORD = "test-only-password-123"


# ---------- 纯函数:谷时段占比 / 费用计算 / 计价裁定 ----------

def test_parse_hhmm():
    from app import main
    assert main._parse_hhmm("23:00") == 1380
    assert main._parse_hhmm("7:30") == 450
    assert main._parse_hhmm("24:00") is None
    assert main._parse_hhmm("23:60") is None
    assert main._parse_hhmm("abc") is None
    assert main._parse_hhmm(None) is None


def test_tou_valley_share_cross_midnight():
    from app import main
    vs, ve = 23 * 60, 7 * 60  # 谷 23:00–07:00
    # 整夜充电全谷
    s = main._tou_valley_share(datetime(2026, 9, 13, 23, 0), datetime(2026, 9, 14, 7, 0), vs, ve)
    assert s == pytest.approx(1.0)
    # 白天充电全峰
    s = main._tou_valley_share(datetime(2026, 9, 14, 10, 0), datetime(2026, 9, 14, 14, 0), vs, ve)
    assert s == 0.0
    # 22:00–24:00:1h 峰 + 1h 谷
    s = main._tou_valley_share(datetime(2026, 9, 14, 22, 0), datetime(2026, 9, 15, 0, 0), vs, ve)
    assert s == pytest.approx(0.5)
    # 跨整天 12:00–次日12:00:谷 8h / 24h
    s = main._tou_valley_share(datetime(2026, 9, 14, 12, 0), datetime(2026, 9, 15, 12, 0), vs, ve)
    assert s == pytest.approx(8 / 24)
    assert main._tou_valley_share(datetime(2026, 9, 14, 1, 0), datetime(2026, 9, 14, 1, 0), vs, ve) is None


def test_tou_valley_share_same_day_window():
    from app import main
    vs, ve = 12 * 60, 14 * 60  # 谷 12:00–14:00(不跨零点)
    s = main._tou_valley_share(datetime(2026, 9, 14, 11, 0), datetime(2026, 9, 14, 15, 0), vs, ve)
    assert s == pytest.approx(0.5)


def test_home_charge_cost():
    from app import main
    entry = {"peak": 1.0, "valley": 0.5, "vstart": "23:00", "vend": "07:00"}
    # 23:00–01:00 全谷,10 kWh → 5 元
    cost, rate = main._home_charge_cost(entry, datetime(2026, 9, 13, 23, 0),
                                        datetime(2026, 9, 14, 1, 0), 10.0)
    assert (cost, rate) == (5.0, 0.5)
    # 22:00–24:00 峰谷各半 → 加权 0.75
    cost, rate = main._home_charge_cost(entry, datetime(2026, 9, 14, 22, 0),
                                        datetime(2026, 9, 15, 0, 0), 10.0)
    assert (cost, rate) == (7.5, 0.75)
    # 只配峰价 = 平价
    assert main._home_charge_cost({"peak": 0.8, "valley": None},
                                  datetime(2026, 9, 14, 22, 0),
                                  datetime(2026, 9, 15, 0, 0), 10.0) == (8.0, 0.8)
    # 只配谷价 = 平价
    assert main._home_charge_cost({"peak": None, "valley": 0.3},
                                  datetime(2026, 9, 14, 10, 0),
                                  datetime(2026, 9, 14, 12, 0), 10.0) == (3.0, 0.3)
    # 未配价 / 无电量
    assert main._home_charge_cost({}, datetime(2026, 9, 14, 0, 0),
                                  datetime(2026, 9, 14, 1, 0), 10.0) is None
    assert main._home_charge_cost(entry, datetime(2026, 9, 14, 0, 0),
                                  datetime(2026, 9, 14, 1, 0), None) is None


def test_home_charge_resolve():
    from app import main
    entry = {"peak": 0.6, "valley": 0.3, "enabled": True}
    cfg = {"master": True, "chargers": {"addr_7": entry}}
    # 自动匹配:总开关 + 地点开关都开
    assert main._home_charge_resolve(cfg, {}, 1, "addr_7") == ("auto", entry)
    # 总开关关闭 → 不计价
    off = {"master": False, "chargers": {"addr_7": entry}}
    assert main._home_charge_resolve(off, {}, 1, "addr_7") == ("none", None)
    # 地点开关关闭 → 不计价
    dis = {"master": True, "chargers": {"addr_7": {**entry, "enabled": False}}}
    assert main._home_charge_resolve(dis, {}, 1, "addr_7") == ("none", None)
    # 手动关闭优先
    assert main._home_charge_resolve(cfg, {"1": {"mode": "off"}}, 1, "addr_7") == ("off", None)
    # 手动指定其他家充,即使其开关关闭也生效
    other = {"peak": 1.0, "valley": None, "enabled": False}
    cfg2 = {"master": True, "chargers": {"addr_7": entry, "addr_9": other}}
    assert main._home_charge_resolve(cfg2, {"1": {"mode": "addr_9"}}, 1, "addr_7") == ("assigned", other)
    # 指定的家充已被删除 → 不计价
    assert main._home_charge_resolve(cfg, {"1": {"mode": "addr_99"}}, 1, "addr_7") == ("none", None)


# ---------- 接口回归 ----------

@pytest.fixture
def env(tmp_path, monkeypatch):
    store = AccountStore(tmp_path / "users.json")
    store.seed("owner:" + PASSWORD)
    store.create_user("guest", PASSWORD, "viewer")
    from app import main
    cfg = {"master": False, "chargers": {}}
    assigns = {}
    monkeypatch.setenv("USERS_FILE", str(store.path))
    monkeypatch.setattr(main, "accounts", store)
    monkeypatch.setattr(main, "auth_users", store.users)
    monkeypatch.setattr(main, "_make_session", store.create_session)
    monkeypatch.setattr(main, "_session_user", store.session_user)
    monkeypatch.setattr(main, "get_car_id", lambda car_id: 1)
    monkeypatch.setattr(main, "_home_charge_cfg",
                        lambda: {"master": cfg["master"], "chargers": dict(cfg["chargers"])})
    monkeypatch.setattr(main, "_save_home_charge_cfg",
                        lambda c: cfg.update({"master": c["master"],
                                              "chargers": dict(c["chargers"])}))
    monkeypatch.setattr(main, "_manual_all",
                        lambda kind: assigns if kind == "charge_home" else {})

    def fake_q(sql, params=()):
        if "FROM panel_manual" in sql:
            return []
        if "FROM addresses" in sql:
            return [] if params and params[0] == 99999 else [{"?column?": 1}]
        if "FROM geofences" in sql:
            return [{"?column?": 1}]
        if "count(*)" in sql:  # 充电地点候选
            return [{"address_id": 7, "geofence_id": None, "address_name": "家",
                     "geofence_name": None, "n": 12}]
        if "FROM charging_processes" in sql:  # 会话存在性检查
            return [] if params and params[0] == 99999 else [{"?column?": 1}]
        return []

    monkeypatch.setattr(main, "q", fake_q)
    monkeypatch.setattr(main, "_exec", lambda sql, params=(): None)
    client = TestClient(main.app, raise_server_exceptions=False)
    yield client, cfg, assigns
    client.close()


def login(client, username="owner"):
    r = client.post("/api/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text


def test_home_get_structure(env):
    client, cfg, _ = env
    login(client)
    r = client.get("/api/charging/home")
    assert r.status_code == 200
    d = r.json()
    assert d["master"] is False and d["role"] == "admin"
    assert d["candidates"][0]["key"] == "addr_7"
    assert d["candidates"][0]["added"] is False


def test_home_master_and_charger_flow(env):
    client, cfg, _ = env
    login(client)
    assert client.post("/api/charging/home/master", json={"enabled": True}).json()["master"] is True
    r = client.post("/api/charging/home/charger", json={
        "key": "addr_7", "name": "车位充电桩", "enabled": True,
        "peak": 1.2, "valley": 0.35, "vstart": "22:00", "vend": "06:00"})
    assert r.status_code == 200, r.text
    d = client.get("/api/charging/home").json()
    assert d["master"] is True
    ch = d["chargers"][0]
    assert ch["key"] == "addr_7" and ch["name"] == "车位充电桩"
    assert ch["peak"] == 1.2 and ch["valley"] == 0.35
    assert ch["vstart"] == "22:00" and ch["vend"] == "06:00"
    assert d["candidates"][0]["added"] is True
    # 删除后列表清空
    assert client.delete("/api/charging/home/charger", params={"key": "addr_7"}).status_code == 200
    assert client.get("/api/charging/home").json()["chargers"] == []


def test_home_charger_validation(env):
    client, _, _ = env
    login(client)
    assert client.post("/api/charging/home/charger", json={
        "key": "bad", "peak": 0.5}).status_code == 422
    assert client.post("/api/charging/home/charger", json={
        "key": "addr_7", "name": "无价"}).status_code == 422
    assert client.post("/api/charging/home/charger", json={
        "key": "addr_7", "peak": 99}).status_code == 422
    assert client.post("/api/charging/home/charger", json={
        "key": "addr_7", "peak": 0.5, "vstart": "25:00"}).status_code == 422
    assert client.post("/api/charging/home/charger", json={
        "key": "addr_99999", "peak": 0.5}).status_code == 404


def test_home_assign(env):
    client, cfg, assigns = env
    login(client)
    client.post("/api/charging/home/charger", json={"key": "addr_7", "peak": 0.6, "valley": 0.3})
    # 指定家充
    r = client.post("/api/charging/home/assign", json={"charge_id": 42, "mode": "addr_7"})
    assert r.status_code == 200 and r.json()["mode"] == "addr_7"
    # 未配置的家充不可指定
    assert client.post("/api/charging/home/assign",
                       json={"charge_id": 42, "mode": "addr_8"}).status_code == 422
    # 关闭本次家充计价
    assert client.post("/api/charging/home/assign",
                       json={"charge_id": 42, "mode": "off"}).status_code == 200
    # 恢复自动 → 记录删除
    assert client.post("/api/charging/home/assign",
                       json={"charge_id": 42, "mode": "auto"}).status_code == 200
    # 会话不存在
    assert client.post("/api/charging/home/assign",
                       json={"charge_id": 99999, "mode": "off"}).status_code == 404


def test_home_write_requires_admin(env):
    client, _, _ = env
    login(client, "guest")
    assert client.get("/api/charging/home").json()["role"] == "viewer"
    assert client.post("/api/charging/home/master", json={"enabled": True}).status_code == 403
    assert client.post("/api/charging/home/charger",
                       json={"key": "addr_7", "peak": 0.5}).status_code == 403
    assert client.post("/api/charging/home/assign",
                       json={"charge_id": 1, "mode": "off"}).status_code == 403
    assert client.delete("/api/charging/home/charger",
                         params={"key": "addr_7"}).status_code == 403
