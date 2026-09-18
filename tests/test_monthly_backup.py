"""按月备份:月份边界/归档生成/月份识别/合并恢复(全部走 mock DB,不连真实库)。"""
import json
import os
import tarfile
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.auth import AccountStore
from app import monthly_backup as mb

PASSWORD = "test-only-password-123"


# ---------- 纯函数:月份边界 / 月份识别 ----------

def test_month_bounds_shanghai(monkeypatch):
    from app import main
    monkeypatch.setattr(main, "DISPLAY_TZ", "Asia/Shanghai")
    start, end = mb._month_bounds("2026-08")
    # 2026-08-01 00:00 +08:00 = 2026-07-31 16:00 UTC
    assert (start, end) == (datetime(2026, 7, 31, 16, 0), datetime(2026, 8, 31, 16, 0))


def test_month_bounds_year_rollover(monkeypatch):
    from app import main
    monkeypatch.setattr(main, "DISPLAY_TZ", "Asia/Shanghai")
    start, end = mb._month_bounds("2026-12")
    assert (start.year, start.month) == (2026, 11)
    assert (end.year, end.month) == (2026, 12)


def test_month_bounds_invalid():
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        mb._month_bounds("2026-13")
    with pytest.raises(HTTPException):
        mb._month_bounds("2026-8")


def test_validate_month_rejects_future():
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        mb._validate_month("2999-01")


def test_filename_month_fallback():
    assert mb.FNAME_MONTH_RE.search("tesla-home-backup-2026-08.tar.gz").group(0) == "2026-08"
    assert mb.FNAME_MONTH_RE.search("backup.tar.gz") is None


def _build_archive(path, manifest=None, csvs=None, users=b"{}"):
    with tarfile.open(path, "w:gz") as tar:
        if manifest is not None:
            data = json.dumps(manifest).encode()
            info = tarfile.TarInfo("manifest.json")
            info.size = len(data)
            tar.addfile(info, __import__("io").BytesIO(data))
        for name, content in (csvs or {}).items():
            data = content.encode()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, __import__("io").BytesIO(data))
        info = tarfile.TarInfo("users.json")
        info.size = len(users)
        tar.addfile(info, __import__("io").BytesIO(users))


def test_read_manifest(tmp_path):
    p = tmp_path / "a.tar.gz"
    _build_archive(str(p), manifest={"month": "2026-08", "kind": "monthly"},
                   csvs={"cars.csv": "id\n1\n"})
    assert mb._read_manifest(str(p))["month"] == "2026-08"
    assert mb._read_manifest(str(tmp_path / "missing.tar.gz")) is None


# ---------- mock DB ----------

class _FakeCopy:
    def __init__(self, payload=b""):
        self._payload = payload
        self._done = False
        self.written = b""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        if self._done:
            return b""
        self._done = True
        return self._payload

    def write(self, data):
        self.written += data


class _FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def copy(self, sql):
        self.conn.copy_sql.append(sql)
        cp = _FakeCopy(self.conn.copy_payload)
        self.conn.last_copy = cp
        return cp


class _FakeResult:
    rowcount = 2

    def fetchone(self):
        return {"n": 2}


class _FakeConn:
    def __init__(self, payload=b"id,date\n1,2026-08-01 00:00:00\n"):
        self.copy_payload = payload
        self.copy_sql = []
        self.executed = []
        self.committed = False
        self.last_copy = None

    def execute(self, sql, params=()):
        self.executed.append(sql)
        return _FakeResult()

    def cursor(self):
        return _FakeCursor(self)

    def commit(self):
        self.committed = True


class _FakePool:
    def __init__(self, conn):
        self.conn = conn

    def connection(self):
        conn = self.conn

        class _CM:
            def __enter__(self):
                return conn

            def __exit__(self, *a):
                return False

        return _CM()


@pytest.fixture
def env(tmp_path, monkeypatch):
    store = AccountStore(tmp_path / "users.json")
    store.seed("owner:" + PASSWORD)
    store.create_user("guest", PASSWORD, "viewer")
    from app import main
    conn = _FakeConn()
    monkeypatch.setenv("USERS_FILE", str(store.path))
    monkeypatch.setattr(main, "accounts", store)
    monkeypatch.setattr(main, "auth_users", store.users)
    monkeypatch.setattr(main, "_make_session", store.create_session)
    monkeypatch.setattr(main, "_session_user", store.session_user)
    monkeypatch.setattr(main, "pool", _FakePool(conn))
    monkeypatch.setattr(main, "USERS_FILE", str(store.path))
    monkeypatch.setattr(main, "DISPLAY_TZ", "Asia/Shanghai")
    monkeypatch.setattr(mb, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(main, "q", lambda sql, params=(): [
        {"lo": datetime(2026, 8, 12), "hi": datetime(2026, 9, 17)}])

    class _ConnCM:
        def __enter__(self):
            return conn

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(mb, "_maintenance_conn", lambda: _ConnCM())
    client = TestClient(main.app, raise_server_exceptions=False)
    yield client, conn, tmp_path
    client.close()


def login(client, username="owner"):
    r = client.post("/api/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text


# ---------- 生成与列表 ----------

def test_generate_creates_archive_with_manifest(env):
    client, conn, tmp_path = env
    login(client)
    r = client.post("/api/backup/monthly", json={"month": "2026-08"})
    assert r.status_code == 200, r.text
    mf = r.json()
    assert mf["month"] == "2026-08" and mf["kind"] == "monthly"
    assert "positions" in mf["tables"] and "cars" in mf["tables"]
    path = tmp_path / "backups" / "ttv-2026-08.tar.gz"
    assert path.exists()
    with tarfile.open(path) as tar:
        names = tar.getnames()
        assert names[0] == "manifest.json"
        assert "positions.csv" in names and "users.json" in names
        assert "private.tokens" not in " ".join(names)
    # 按月过滤 SQL 带 UTC 边界(上海时区 8 月 = 7-31 16:00 起)
    pos_sql = next(s for s in conn.copy_sql if "FROM positions" in s)
    assert "2026-07-31 16:00:00" in pos_sql and "2026-08-31 16:00:00" in pos_sql


def test_list_marks_backup_state(env):
    client, _, tmp_path = env
    login(client)
    r = client.get("/api/backup/monthly")
    assert r.status_code == 200
    months = r.json()["months"]
    assert [m["month"] for m in months] == ["2026-09", "2026-08"]
    assert months[0]["is_current"] is True and months[0]["backup"] is None
    client.post("/api/backup/monthly", json={"month": "2026-08"})
    months = client.get("/api/backup/monthly").json()["months"]
    aug = next(m for m in months if m["month"] == "2026-08")
    assert aug["backup"] and aug["backup"]["size"] > 0


def test_viewer_forbidden(env):
    client, _, _ = env
    login(client, "guest")
    assert client.get("/api/backup/monthly").status_code == 403
    assert client.post("/api/backup/monthly", json={"month": "2026-08"}).status_code == 403


def test_download_and_delete(env):
    client, _, _ = env
    login(client)
    client.post("/api/backup/monthly", json={"month": "2026-08"})
    r = client.get("/api/backup/monthly/download?months=2026-08")
    assert r.status_code == 200 and r.headers["content-encoding"] == "identity"
    assert len(r.content) > 100
    # 单月 + 多月打包
    r2 = client.get("/api/backup/monthly/download?months=2026-08,2026-09")
    assert r2.status_code == 404  # 2026-09 未备份
    client.post("/api/backup/monthly", json={"month": "2026-09"})
    r3 = client.get("/api/backup/monthly/download?months=2026-08,2026-09")
    assert r3.status_code == 200
    d = tmp_path_check(r3.content)
    assert set(d) == {"tesla-home-backup-2026-08.tar.gz", "tesla-home-backup-2026-09.tar.gz"}
    assert client.delete("/api/backup/monthly/2026-08").status_code == 200
    assert client.get("/api/backup/monthly/download?months=2026-08").status_code == 404


def tmp_path_check(content):
    import io
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as tar:
        return tar.getnames()


# ---------- 合并恢复 ----------

def test_import_detects_month_and_merges(env, tmp_path):
    client, conn, _ = env
    login(client)
    arc = tmp_path / "up.tar.gz"
    _build_archive(str(arc),
                   manifest={"month": "2026-08", "kind": "monthly"},
                   csvs={"cars.csv": "id\n1\n", "positions.csv": "id,date\n1,x\n"})
    with open(arc, "rb") as f:
        r = client.post("/api/backup/monthly/import",
                        files={"file": ("whatever.tar.gz", f, "application/gzip")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["month"] == "2026-08"
    assert d["inserted"]["cars"] == 2 and d["inserted"]["positions"] == 2
    # 合并语义:临时表 + ON CONFLICT DO NOTHING,且不删数据、不动 users
    inserts = [s for s in conn.executed if s.startswith("INSERT INTO")]
    assert any("ON CONFLICT DO NOTHING" in s for s in inserts)
    assert not any("DELETE" in s.upper() for s in conn.executed)
    assert not any("users" in s.lower() for s in conn.executed)
    assert conn.committed


def test_import_month_from_filename_when_no_manifest(env, tmp_path):
    client, conn, _ = env
    login(client)
    arc = tmp_path / "up2.tar.gz"
    _build_archive(str(arc), manifest=None, csvs={"cars.csv": "id\n1\n"})
    with open(arc, "rb") as f:
        r = client.post("/api/backup/monthly/import",
                        files={"file": ("ttv-2026-07.tar.gz", f, "application/gzip")})
    assert r.status_code == 200, r.text
    assert r.json()["month"] == "2026-07"


def test_import_rejects_unparseable(env):
    client, _, _ = env
    login(client)
    r = client.post("/api/backup/monthly/import",
                    files={"file": ("backup.tar.gz", b"not a tar", "application/gzip")})
    assert r.status_code == 422


def test_maintenance_conn_requires_password(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.delenv("MAINTENANCE_DB_PASSWORD", raising=False)
    with pytest.raises(HTTPException) as exc:
        mb._maintenance_conn()
    assert exc.value.status_code == 503
