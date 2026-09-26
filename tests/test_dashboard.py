"""阶段三仪表盘:telemetry 广播扇出 / snapshot 端点 / WebSocket 鉴权与推送。"""
import json
from types import SimpleNamespace

import pytest
from starlette.websockets import WebSocketDisconnect

from app import telemetry

from test_security import client, login, store  # noqa: F401  复用 fixture


@pytest.fixture(autouse=True)
def _clean_dash_state():
    telemetry._live.clear()
    telemetry._last.clear()
    yield
    for q in list(telemetry._dash_queues):
        telemetry.unsubscribe_dash(q)
    telemetry._live.clear()
    telemetry._last.clear()


def _msg(car_id, key, value):
    return SimpleNamespace(topic=f"teslamate/cars/{car_id}/{key}",
                           payload=str(value).encode())


def _feed(monkeypatch, car_id, key, value):
    """伪造一条 MQTT 消息;_insert 打桩避免触库。"""
    monkeypatch.setattr(telemetry, "_insert", lambda *a: None)
    telemetry._on_message(None, None, _msg(car_id, key, value))


# ---------- 广播扇出 ----------

def test_fanout_delivers_dash_keys(monkeypatch):
    q = telemetry.subscribe_dash()
    _feed(monkeypatch, 1, "speed", "42")
    assert q.get_nowait() == (1, "speed", "42")
    assert telemetry._live[(1, "speed")][0] == "42"


def test_fanout_skips_unchanged_value(monkeypatch):
    q = telemetry.subscribe_dash()
    _feed(monkeypatch, 1, "speed", "42")
    _feed(monkeypatch, 1, "speed", "42")  # 同值不重复广播
    _feed(monkeypatch, 1, "speed", "43")
    assert q.get_nowait() == (1, "speed", "42")
    assert q.get_nowait() == (1, "speed", "43")
    assert q.empty()


def test_fanout_ignores_unknown_topics_and_keys(monkeypatch):
    q = telemetry.subscribe_dash()
    _feed(monkeypatch, 1, "not_a_dash_key", "x")
    telemetry._on_message(None, None, SimpleNamespace(topic="bad/topic", payload=b"x"))
    assert q.empty()
    assert telemetry._live == {}


def test_full_queue_drops_without_blocking(monkeypatch):
    q = telemetry.subscribe_dash()
    for i in range(150):  # maxsize=100,超出部分丢弃且不阻塞 paho 线程
        _feed(monkeypatch, 1, "speed", str(i))
    assert q.qsize() == 100
    assert telemetry._live[(1, "speed")][0] == "149"


def test_live_snapshot_filters_car(monkeypatch):
    _feed(monkeypatch, 1, "speed", "60")
    _feed(monkeypatch, 2, "speed", "90")
    snap = telemetry.live_snapshot(1)
    assert snap["values"] == {"speed": "60"}
    assert "collector" in snap


# ---------- snapshot 端点 ----------

def _fake_q(monkeypatch, main, drives_rows=None):
    """按 SQL 分发:cars 查询返回一辆车,drives 基线返回给定行,其余空。"""
    def fake(sql, *a):
        if "FROM cars" in sql:
            return [{"id": 1}]
        if "FROM drives" in sql:
            return drives_rows or []
        return []
    monkeypatch.setattr(main, "q", fake)


def test_snapshot_endpoint(client, monkeypatch):  # noqa: F811
    from app import main
    login(client)
    _fake_q(monkeypatch, main)
    monkeypatch.setattr(telemetry, "live_snapshot",
                        lambda cid: {"values": {"speed": "12", "state": "online"},
                                     "collector": {"connected": True}})
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.85)
    r = client.get("/api/dash/snapshot")
    assert r.status_code == 200
    d = r.json()
    assert d["values"]["speed"] == "12"
    assert d["trip"] is None
    assert d["kwh_per_pct"] == 0.85
    assert d["charge_eta"] is None  # 非充电态不算 ETA


def test_snapshot_endpoint_requires_login(client, monkeypatch):  # noqa: F811
    r = client.get("/api/dash/snapshot")
    assert r.status_code in (401, 403)


def test_snapshot_charging_includes_eta(client, monkeypatch):  # noqa: F811
    from app import charge_eta, main
    login(client)
    _fake_q(monkeypatch, main)
    monkeypatch.setattr(telemetry, "live_snapshot",
                        lambda cid: {"values": {"state": "charging"}, "collector": {}})
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.85)
    monkeypatch.setattr(charge_eta, "estimate",
                        lambda cid: {"minutes": 23, "target_pct": 97})
    d = client.get("/api/dash/snapshot").json()
    assert d["charge_eta"] == {"minutes": 23, "target_pct": 97}


def test_snapshot_trip_baseline(client, monkeypatch):  # noqa: F811
    from app import main
    from datetime import datetime
    login(client)
    rows = [{"start_date": datetime(2026, 9, 26, 8, 0, 0),
             "start_odometer": 10000.5, "start_battery_level": 80,
             "start_ideal_range_km": 400.0}]
    _fake_q(monkeypatch, main, drives_rows=rows)
    monkeypatch.setattr(telemetry, "live_snapshot",
                        lambda cid: {"values": {"state": "driving"}, "collector": {}})
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.85)
    d = client.get("/api/dash/snapshot").json()
    assert d["trip"]["start_odometer"] == 10000.5
    assert d["trip"]["start_battery_level"] == 80
    assert d["trip"]["start_ts"] > 0


# ---------- WebSocket ----------

def test_ws_rejects_without_cookie(client):  # noqa: F811
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/dash/ws"):
            pass
    assert exc.value.code == 4401


def test_ws_streams_broadcast(monkeypatch, client):  # noqa: F811
    import time
    from app import main
    login(client)  # cookie 存入 client,WS 握手自带
    _fake_q(monkeypatch, main)  # get_car_id 查 cars 表
    with client.websocket_connect("/api/dash/ws") as ws:
        # 等服务端完成订阅注册再喂消息,否则帧在队列创建前扇出会丢失
        for _ in range(100):
            if telemetry._dash_queues:
                break
            time.sleep(0.05)
        assert telemetry._dash_queues, "服务端未注册订阅队列"
        _feed(monkeypatch, 1, "speed", "88")
        _feed(monkeypatch, 2, "speed", "99")  # 别的车:不应推送
        deadline_msgs = []
        for _ in range(5):
            m = json.loads(ws.receive_text())
            deadline_msgs.append(m)
            if m["k"] == "speed":
                break
        assert {"k": "speed", "v": "88"} in deadline_msgs
        assert all(not (m["k"] == "speed" and m["v"] == "99") for m in deadline_msgs)
