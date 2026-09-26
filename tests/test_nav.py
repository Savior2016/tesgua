"""阶段四导航:key 存储配置、高德代理(tips/route/along)、能耗规划 plan。"""
import pytest

from app import amap, navplan

from test_security import client, login, store  # noqa: F401  复用 fixture


@pytest.fixture
def nav_env(client, monkeypatch):  # noqa: F811
    """面板手填库打桩 + 高德 HTTP 打桩;返回可变 settings 存储。"""
    from app import main
    settings = {}
    monkeypatch.setattr(main, "_manual_all",
                        lambda kind: dict(settings) if kind == "settings" else {})
    monkeypatch.setattr(main, "_exec",
                        lambda sql, params=(): settings.update(
                            {"amap": params[2].obj if hasattr(params[2], "obj") else {}}))
    # _exec 第三个参数是 Jsonb;直接存 dict 简化
    def fake_exec(sql, params=()):
        payload = params[2]
        settings["amap"] = getattr(payload, "obj", payload)
    monkeypatch.setattr(main, "_exec", fake_exec)
    return settings


# ---------- key 配置 ----------

def test_nav_config_requires_login(client):  # noqa: F811
    assert client.get("/api/nav/config").status_code == 401


def test_nav_config_set_get_clear(client, nav_env):  # noqa: F811
    login(client)
    r = client.get("/api/nav/config")
    assert r.json() == {"has_key": False, "key_tail": None}
    r = client.post("/api/nav/config", json={"web_key": "abcd1234efgh5678"})
    assert r.status_code == 200
    assert r.json()["has_key"] is True
    assert r.json()["key_tail"] == "…5678"  # 只回掩码尾号
    assert nav_env["amap"]["web_key"] == "abcd1234efgh5678"
    r = client.post("/api/nav/config", json={"web_key": ""})
    assert r.json()["has_key"] is False


def test_nav_config_rejects_bad_chars(client, nav_env):  # noqa: F811
    login(client)
    r = client.post("/api/nav/config", json={"web_key": "bad key!"})
    assert r.status_code == 422


def test_nav_config_viewer_forbidden(client, nav_env):  # noqa: F811
    login(client, "guest")  # viewer:中间件挡非 GET
    r = client.post("/api/nav/config", json={"web_key": "abcd1234"})
    assert r.status_code == 403


# ---------- 高德代理 ----------

def test_tips_filters_and_shapes(client, nav_env, monkeypatch):  # noqa: F811
    login(client)
    nav_env["amap"] = {"web_key": "k" * 32}
    monkeypatch.setattr(amap, "_call", lambda path, params: {
        "status": "1",
        "tips": [
            {"name": "亦庄站", "district": "北京市大兴区", "address": "亦庄路",
             "location": "116.5,39.8"},
            {"name": "纯行政区", "district": "北京市", "address": [], "location": ""},
        ]})
    d = client.get("/api/nav/tips?keywords=亦庄").json()
    assert len(d["tips"]) == 1  # 无坐标的提示被过滤
    assert d["tips"][0]["location"] == "116.5,39.8"


def test_tips_503_without_key(client, nav_env):  # noqa: F811
    login(client)
    r = client.get("/api/nav/tips?keywords=x")
    assert r.status_code == 503
    assert "个人中心" in r.json()["detail"]


def test_route_parses_paths(client, nav_env, monkeypatch):  # noqa: F811
    login(client)
    nav_env["amap"] = {"web_key": "k" * 32}
    monkeypatch.setattr(amap, "_call", lambda path, params: {
        "status": "1",
        "route": {"paths": [
            {"distance": "12800", "polyline": "116.1,39.9;116.2,39.9;116.2,40.0",
             "cost": {"duration": "1080", "tolls": "5"}},
            {"distance": "x", "polyline": "", "cost": {}},  # 坏方案被丢弃
        ]}})
    r = client.post("/api/nav/route", json={"origin": "116.1,39.9",
                                            "destination": "116.2,40.0"})
    d = r.json()
    assert len(d["paths"]) == 1
    p = d["paths"][0]
    assert p["distance_km"] == 12.8 and p["duration_min"] == 18 and p["tolls_yuan"] == 5
    assert p["polyline"] == [[116.1, 39.9], [116.2, 39.9], [116.2, 40.0]]


def test_along_dedupes_and_filters_names(client, nav_env, monkeypatch):  # noqa: F811
    login(client)
    nav_env["amap"] = {"web_key": "k" * 32}

    def fake_call(path, params):
        return {"status": "1", "pois": [
            {"id": "A", "name": "昌平服务区", "location": "116.2,40.1", "address": "G6"},
            {"id": "A", "name": "昌平服务区", "location": "116.2,40.1", "address": "G6"},
            {"id": "B", "name": "不相关便利店", "location": "116.3,40.1", "address": ""},
        ]}
    monkeypatch.setattr(amap, "_call", fake_call)
    d = client.get("/api/nav/along?kind=service&polyline=116.1,39.9;116.4,40.2").json()
    names = [p["name"] for p in d["pois"]]
    assert names == ["昌平服务区"]  # 去重 + 名字过滤


def test_along_bad_kind(client, nav_env):  # noqa: F811
    login(client)
    assert client.get("/api/nav/along?kind=evil&polyline=116.1,39.9;116.2,40.0").status_code == 422


# ---------- 能耗规划 ----------

@pytest.fixture
def plan_env(client, nav_env, monkeypatch):  # noqa: F811
    from app import main
    login(client)
    nav_env["amap"] = {"web_key": "k" * 32}
    monkeypatch.setattr(navplan, "energy_per_km", lambda cid: 0.18)
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.75)
    monkeypatch.setattr(main, "q", lambda *a: [{"id": 1}])
    return nav_env


# ~111km 直线(经度 1° 约 85km at 40N,用 1.3° ≈ 111km)
POLY_111KM = ";".join(f"{116.0 + i * 0.01:.6f},40.0" for i in range(131))


def test_plan_direct_when_enough_soc(client, plan_env):  # noqa: F811
    r = client.post("/api/nav/plan", json={
        "polyline": POLY_111KM, "start_soc": 90, "arrival_soc": 20})
    d = r.json()
    assert d["reachable"] is True
    assert d["stops"] == []
    assert 60 < d["arrival_soc"] < 75   # 111km × 0.18 / 0.75 ≈ 26.6% 消耗
    assert d["bands"]
    assert all(len(b["pts"]) >= 2 for b in d["bands"])


def test_plan_adds_supercharger_stop(client, plan_env, monkeypatch):  # noqa: F811
    # 起点 35% 电:直达只剩 ~8% → 需要途中充电
    monkeypatch.setattr(amap, "along", lambda polyline, kind: {"kind": kind, "pois": [
        {"id": "S1", "name": "特斯拉超级充电站(中途)",
         "location": f"{116.0 + 60 * 0.01:.6f},40.0", "address": ""},
    ]})
    r = client.post("/api/nav/plan", json={
        "polyline": POLY_111KM, "start_soc": 35, "arrival_soc": 20,
        "depart_soc": 80})
    d = r.json()
    assert d["reachable"] is True
    assert len(d["stops"]) == 1
    s = d["stops"][0]
    assert s["id"] == "S1"
    assert s["arrive_soc"] >= 10          # 保底电量
    # 只充「刚好够到终点+缓冲」:need = 20 + 59.7km×0.24% + 3 ≈ 37%,不超 depart_soc=80 的 cap
    assert 30 < s["depart_soc"] < 45
    assert d["arrival_soc"] >= 20


def test_plan_unreachable_without_stations(client, plan_env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(amap, "along", lambda polyline, kind: {"kind": kind, "pois": []})
    r = client.post("/api/nav/plan", json={
        "polyline": POLY_111KM, "start_soc": 25, "arrival_soc": 20})
    d = r.json()
    assert d["reachable"] is False


def test_plan_per_stop_target(client, plan_env, monkeypatch):  # noqa: F811
    monkeypatch.setattr(amap, "along", lambda polyline, kind: {"kind": kind, "pois": [
        {"id": "S1", "name": "特斯拉超级充电站(中途)",
         "location": f"{116.0 + 60 * 0.01:.6f},40.0", "address": ""},
    ]})
    r = client.post("/api/nav/plan", json={
        "polyline": POLY_111KM, "start_soc": 35, "arrival_soc": 20,
        "depart_soc": 80, "stop_targets": {"S1": 50}})
    d = r.json()
    assert d["stops"][0]["depart_soc"] == 50
    # 充到 50%:后半程 59.7km × 0.24%/km ≈ 14.3%,到达剩 ~35.7%,仍可达但低于默认 80% 方案
    assert d["reachable"] is True
    assert 30 < d["arrival_soc"] < 40
