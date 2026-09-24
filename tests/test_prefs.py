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
    assert client.get("/api/prefs").json()["overview_mode"] == "car"


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
    assert got == {"days": 30, "overview_mode": "data"}
    client.post("/api/prefs", json={"days": 1})
    assert prefs["owner"] == {"days": 1, "overview_mode": "data"}


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
