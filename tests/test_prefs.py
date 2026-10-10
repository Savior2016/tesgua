"""个人偏好(默认时间范围):/api/prefs 读写、校验、viewer 放行(全部走 mock,不连真实库)。"""
import pytest
from fastapi.testclient import TestClient

from app.auth import AccountStore

PASSWORD = "test-only-password-123"


@pytest.fixture
def env(tmp_path, monkeypatch):
    store = AccountStore(tmp_path / "users.json")
    store.seed("owner:" + PASSWORD)
    store.create_user("guest", PASSWORD, "viewer")
    from app import main
    prefs = {}  # {用户名: {"days": N}},模拟 panel_manual kind='prefs'
    monkeypatch.setenv("USERS_FILE", str(store.path))
    monkeypatch.setattr(main, "accounts", store)
    monkeypatch.setattr(main, "auth_users", store.users)
    monkeypatch.setattr(main, "_make_session", store.create_session)
    monkeypatch.setattr(main, "_session_user", store.session_user)
    monkeypatch.setattr(main, "_manual_all", lambda kind: prefs if kind == "prefs" else {})

    def fake_exec(sql, params=()):
        if "INSERT INTO panel_manual" in sql and params[0] == "prefs":
            prefs[params[1]] = dict(params[2].obj)

    monkeypatch.setattr(main, "_exec", fake_exec)
    client = TestClient(main.app, raise_server_exceptions=False)
    yield client, prefs
    client.close()


def login(client, username="owner"):
    r = client.post("/api/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text


def test_default_days(env):
    client, _ = env
    login(client)
    assert client.get("/api/prefs").json()["days"] == 7


def test_set_and_get(env):
    client, prefs = env
    login(client)
    r = client.post("/api/prefs", json={"days": 30})
    assert r.status_code == 200 and r.json()["days"] == 30
    assert client.get("/api/prefs").json()["days"] == 30
    assert prefs["owner"] == {"days": 30}


def test_invalid_days(env):
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"days": 3}).status_code == 422
    assert client.post("/api/prefs", json={"days": 0}).status_code == 422


def test_per_user_isolation(env):
    client, _ = env
    login(client, "owner")
    client.post("/api/prefs", json={"days": 1})
    login(client, "guest")
    assert client.get("/api/prefs").json()["days"] == 7  # guest 未设置,不受 owner 影响


def test_viewer_can_write(env):
    client, prefs = env
    login(client, "guest")
    r = client.post("/api/prefs", json={"days": 1})
    assert r.status_code == 200, r.text  # 中间件已放行 /api/prefs
    assert prefs["guest"] == {"days": 1}


def test_unauthenticated(env):
    client, _ = env
    assert client.get("/api/prefs").status_code == 401
    assert client.post("/api/prefs", json={"days": 1}).status_code == 401


def test_default_overview_mode(env):
    client, _ = env
    login(client)
    assert client.get("/api/prefs").json()["overview_mode"] == "3d"


def test_set_overview_mode(env):
    client, prefs = env
    login(client)
    r = client.post("/api/prefs", json={"overview_mode": "data"})
    assert r.status_code == 200 and r.json()["overview_mode"] == "data"
    assert client.get("/api/prefs").json()["overview_mode"] == "data"
    assert prefs["owner"] == {"overview_mode": "data"}


def test_merge_semantics(env):
    """合并语义:只发 overview_mode 不清空已存的 days,反之亦然。"""
    client, prefs = env
    login(client)
    client.post("/api/prefs", json={"days": 30})
    client.post("/api/prefs", json={"overview_mode": "data"})
    assert prefs["owner"] == {"days": 30, "overview_mode": "data"}
    got = client.get("/api/prefs").json()
    assert got == {"days": 30, "overview_mode": "data", "control_mode": "2d",
                   "car_model": "y-yl", "ov_car_model": "y-yl",
                   "car_color": None, "car_color_detected": None,
                   "car_color_detected_name": None, "car_color_effective": "#17191d"}
    client.post("/api/prefs", json={"days": 1})
    assert prefs["owner"] == {"days": 1, "overview_mode": "data"}


def test_default_control_mode(env):
    client, _ = env
    login(client)
    assert client.get("/api/prefs").json()["control_mode"] == "2d"


def test_set_control_mode(env):
    client, prefs = env
    login(client)
    r = client.post("/api/prefs", json={"control_mode": "3d"})
    assert r.status_code == 200 and r.json()["control_mode"] == "3d"
    assert client.get("/api/prefs").json()["control_mode"] == "3d"
    assert prefs["owner"] == {"control_mode": "3d"}


def test_invalid_control_mode(env):
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"control_mode": "4d"}).status_code == 422


def test_default_car_model(env):
    client, _ = env
    login(client)
    assert client.get("/api/prefs").json()["car_model"] == "y-yl"


def test_set_car_model(env):
    client, prefs = env
    login(client)
    r = client.post("/api/prefs", json={"car_model": "model-3"})
    assert r.status_code == 200 and r.json()["car_model"] == "model-3"
    assert client.get("/api/prefs").json()["car_model"] == "model-3"
    assert prefs["owner"] == {"car_model": "model-3"}


def test_invalid_car_model(env):
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"car_model": "model-s"}).status_code == 422


def test_control_car_model_rejects_fun_models(env):
    """控制页车模只接受特斯拉车模;趣味模型是总览专属。"""
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"car_model": "sanbengzi"}).status_code == 422


def test_ov_car_model(env):
    """总览 3D 模型:独立偏好,接受趣味模型,与控制页互不影响。"""
    client, prefs = env
    login(client)
    r = client.post("/api/prefs", json={"ov_car_model": "mars-rover"})
    assert r.status_code == 200 and r.json()["ov_car_model"] == "mars-rover"
    assert r.json()["car_model"] == "y-yl"
    assert prefs["owner"] == {"ov_car_model": "mars-rover"}


def test_ov_car_model_fun_models(env):
    """趣味模型白名单与前端注册表一致(hellokitty/mickey 曾漏配导致保存 422;后由蝙蝠车/蜘蛛侠/超跑替换)。"""
    client, _ = env
    login(client)
    for key in ("sanbengzi", "mars-rover", "yaoyao", "ironman", "batmobile", "spiderman", "f40", "revuelto", "f1lm"):
        r = client.post("/api/prefs", json={"ov_car_model": key})
        assert r.status_code == 200, key
        assert r.json()["ov_car_model"] == key


def test_ov_car_model_defaults_to_car_model(env):
    """总览模型未单独设置时跟随控制页车模(老账号无缝迁移)。"""
    client, _ = env
    login(client)
    client.post("/api/prefs", json={"car_model": "cybertruck"})
    assert client.get("/api/prefs").json()["ov_car_model"] == "cybertruck"


def test_fun_car_model_migrates_to_ov(env):
    """旧并集名单时代存了趣味模型的账号:迁移为总览模型选择,控制页回默认。"""
    client, prefs = env
    login(client)
    prefs["owner"] = {"car_model": "yaoyao"}
    got = client.get("/api/prefs").json()
    assert got["car_model"] == "y-yl" and got["ov_car_model"] == "yaoyao"


def test_invalid_ov_car_model(env):
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"ov_car_model": "model-s"}).status_code == 422


def test_default_car_color(env):
    """未设置且无车辆识别结果时:覆盖为空,生效色为默认钻黑。"""
    client, _ = env
    login(client)
    got = client.get("/api/prefs").json()
    assert got["car_color"] is None
    assert got["car_color_effective"] == "#17191d"


def test_set_car_color(env):
    client, prefs = env
    login(client)
    r = client.post("/api/prefs", json={"car_color": "#A6121C"})
    assert r.status_code == 200
    got = r.json()
    assert got["car_color"] == "#a6121c"  # 统一存小写
    assert got["car_color_effective"] == "#a6121c"
    assert prefs["owner"] == {"car_color": "#a6121c"}


def test_clear_car_color(env):
    """空串 = 清除手动覆盖,回到自动识别/默认。"""
    client, prefs = env
    login(client)
    client.post("/api/prefs", json={"car_color": "#1e3a75"})
    r = client.post("/api/prefs", json={"car_color": ""})
    assert r.status_code == 200
    got = r.json()
    assert got["car_color"] is None
    assert got["car_color_effective"] == "#17191d"
    assert prefs["owner"] == {}


def test_invalid_car_color(env):
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"car_color": "red"}).status_code == 422
    assert client.post("/api/prefs", json={"car_color": "#12345"}).status_code == 422


def test_detected_car_color_fallback(env, monkeypatch):
    """TeslaMate cars.exterior_color 识别结果作为未手动覆盖时的生效色。"""
    from app import prefs as prefs_mod
    monkeypatch.setattr(prefs_mod, "_detected_car_color", lambda: ("#1b1d21", "DiamondBlack"))
    client, _ = env
    login(client)
    got = client.get("/api/prefs").json()
    assert got["car_color"] is None
    assert got["car_color_detected"] == "#1b1d21"
    assert got["car_color_detected_name"] == "DiamondBlack"
    assert got["car_color_effective"] == "#1b1d21"
    # 手动覆盖优先于识别结果
    client.post("/api/prefs", json={"car_color": "#e8e9e7"})
    assert client.get("/api/prefs").json()["car_color_effective"] == "#e8e9e7"


def test_invalid_overview_mode(env):
    client, _ = env
    login(client)
    assert client.post("/api/prefs", json={"overview_mode": "fancy"}).status_code == 422


def test_viewer_can_write_overview_mode(env):
    client, prefs = env
    login(client, "guest")
    r = client.post("/api/prefs", json={"overview_mode": "data"})
    assert r.status_code == 200, r.text  # 中间件已放行 /api/prefs
    assert prefs["guest"] == {"overview_mode": "data"}
