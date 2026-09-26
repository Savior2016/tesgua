"""telemetry.py 纯函数与 overlay 重算测试(不连库、不连 MQTT)。"""
from test_security import client, store, login  # noqa: F401 — pytest fixture 注入

from app import main, telemetry

H = 3600_000
M = 60_000
ON = telemetry.ON


def ev(ts, key, value):
    return (ts, key, value)


# ---------- build_spans ----------

def test_spans_simple_on_off():
    events = [ev(0, "state", "online"), ev(10 * M, "sentry_mode", "true"),
              ev(70 * M, "sentry_mode", "false")]
    assert telemetry.build_spans(events, "sentry_mode", ON, close_on_offline=False) \
        == [(10 * M, 70 * M)]


def test_spans_open_ended_and_baseline():
    # 基线事件(窗口起点合成)直接是开启态 → 从窗口起点开口
    events = [ev(0, "sentry_mode", "true"), ev(0, "state", "online")]
    assert telemetry.build_spans(events, "sentry_mode", ON, close_on_offline=False) \
        == [(0, None)]


def test_spans_close_on_offline_policy():
    events = [ev(0, "state", "online"), ev(5 * M, "is_user_present", "true"),
              ev(30 * M, "state", "offline"), ev(90 * M, "state", "online"),
              ev(95 * M, "is_user_present", "false")]
    # presence:离线即关闭
    assert telemetry.build_spans(events, "is_user_present", ON) == [(5 * M, 30 * M)]
    # 哨兵:离线不断(物理上跨断网持续)
    events2 = [ev(0, "state", "online"), ev(5 * M, "sentry_mode", "true"),
               ev(30 * M, "state", "offline"), ev(90 * M, "state", "online"),
               ev(95 * M, "sentry_mode", "false")]
    assert telemetry.build_spans(events2, "sentry_mode", ON,
                                 close_on_offline=False) == [(5 * M, 95 * M)]


def test_spans_reopen_after_offline():
    events = [ev(0, "state", "online"), ev(5 * M, "is_user_present", "true"),
              ev(30 * M, "state", "offline"), ev(90 * M, "state", "online"),
              ev(91 * M, "is_user_present", "true"), ev(120 * M, "is_user_present", "false")]
    assert telemetry.build_spans(events, "is_user_present", ON) \
        == [(5 * M, 30 * M), (91 * M, 120 * M)]


# ---------- sessions_from_spans ----------

def test_sessions_cut_and_min_duration():
    spans = [(0, 2 * H), (3 * H, None)]
    cut = [(30 * M, 45 * M)]  # 挖去行驶
    out = telemetry.sessions_from_spans(spans, cut, 15 * M, now_ms=4 * H)
    assert out == [(0, 30 * M), (45 * M, 2 * H), (3 * H, 4 * H)]
    # 最小时长过滤
    out = telemetry.sessions_from_spans([(0, 10 * M)], [], 15 * M, now_ms=10 * M)
    assert out == []


# ---------- session_stats ----------

def samples_5min(start, levels, climate=False):
    return [(start + i * 5 * M, l, climate) for i, l in enumerate(levels)]


def test_session_stats_drop_and_rate():
    samples = samples_5min(0, [80, 79, 79, 78, 78, 77])  # 30 分钟掉 3%
    st = telemetry.session_stats(0, 30 * M, samples, 0.85, lambda ts: 0.5)
    assert st["s_lvl"] == 80 and st["e_lvl"] == 77 and st["drop_pct"] == 3
    assert st["energy_kwh"] == round(3 * 0.85, 2)
    assert st["rate_pct_h"] == 6.0
    assert st["cost_yuan"] == round(3 * 0.85 * 0.5, 2)
    assert st["has_climate"] is False


def test_session_stats_needs_two_samples():
    assert telemetry.session_stats(0, 30 * M, [(10 * M, 80, False)], 0.85,
                                   lambda ts: None) is None
    # 电量不降 → 能耗 0,费用 0
    samples = samples_5min(0, [80, 80, 80])
    st = telemetry.session_stats(0, 10 * M, samples, 0.85, lambda ts: 0.5)
    assert st["energy_kwh"] == 0.0 and st["cost_yuan"] == 0.0


# ---------- overlay_real ----------

def make_seg():
    """一段覆盖起点之后的驻车清醒片段(推断曾判为哨兵)。"""
    awake = [{"s": 0, "e": 2 * H, "s_lvl": 80, "e_lvl": 78, "delta": -2,
              "dur_min": 120}]
    return {"sentry": [dict(awake[0], kind="sentry")], "idle": [],
            "awake": awake}


def test_overlay_pre_coverage_untouched():
    seg = {"sentry": [{"s": 0, "e": H, "kind": "sentry", "s_lvl": 80, "e_lvl": 79,
                       "delta": -1, "dur_min": 60}],
           "idle": [], "awake": []}
    out = telemetry.overlay_real(seg, [], [], [], coverage_start=10 * H, now_ms=20 * H)
    assert out["sentry"] == seg["sentry"] and out["idle"] == []


def test_overlay_no_coverage_returns_seg():
    seg = make_seg()
    assert telemetry.overlay_real(seg, [], [], [], None, 2 * H) is seg


def test_overlay_real_sentry_confirmed():
    seg = make_seg()
    samples = samples_5min(0, [80, 79, 79, 78, 78] + [78] * 20)  # 覆盖 2 小时
    out = telemetry.overlay_real(seg, samples, [(10 * M, 100 * M)], [],
                                 coverage_start=-1, now_ms=2 * H)
    assert len(out["sentry"]) == 1
    p = out["sentry"][0]
    assert p["s"] == 10 * M and p["e"] == 100 * M and p.get("real") is True
    assert p["kind"] == "sentry"
    # 哨兵区间外的残余清醒(0-10min、100-120min)不足 30 分钟,不单独入账
    assert out["idle"] == []


def test_overlay_inferred_sentry_without_real_demoted():
    seg = make_seg()
    samples = samples_5min(0, [80] + [79] * 24)  # 2 小时基本不掉电
    out = telemetry.overlay_real(seg, samples, [], [], coverage_start=-1, now_ms=2 * H)
    assert out["sentry"] == []
    # 整段清醒 2 小时、非哨兵非小憩 → 归入 idle(kind='awake')
    assert len(out["idle"]) == 1 and out["idle"][0]["kind"] == "awake"


def test_overlay_presence_carves_occupied():
    seg = make_seg()
    samples = samples_5min(0, [80, 79, 79, 78] + [78] * 21)
    occ = [(20 * M, 80 * M)]  # 车内有人 60 分钟
    out = telemetry.overlay_real(seg, samples, [], occ, coverage_start=-1, now_ms=2 * H)
    occ_pieces = [p for p in out["idle"] if p["kind"] == "occupied"]
    assert len(occ_pieces) == 1
    assert occ_pieces[0]["s"] == 20 * M and occ_pieces[0]["e"] == 80 * M
    # 剩余两段各 ≥30min?0-20min 不足,80-120min=40min → 一段 awake
    rest = [p for p in out["idle"] if p["kind"] == "awake"]
    assert len(rest) == 1 and rest[0]["s"] == 80 * M


def test_overlay_asleep_pieces_pass_through():
    seg = make_seg()
    seg["idle"].append({"s": 3 * H, "e": 6 * H, "s_lvl": 78, "e_lvl": 76,
                        "delta": -2, "dur_min": 180, "kind": "asleep"})
    samples = samples_5min(0, [80] * 25)
    out = telemetry.overlay_real(seg, samples, [], [], coverage_start=-1, now_ms=6 * H)
    assert any(p["kind"] == "asleep" and p["s"] == 3 * H for p in out["idle"])


# ---------- 接口 ----------

def test_parked_overview_endpoint(client, monkeypatch):
    login(client)
    import time
    base = int(time.time() * 1000) - 2 * H  # 2 小时前(须在 days 窗口内)
    events = [
        (base, "state", "online"),
        (base + 10 * M, "sentry_mode", "true"),
        (base + 70 * M, "sentry_mode", "false"),
    ]
    samples = samples_5min(base, [80, 79, 79, 78] + [78] * 15)
    monkeypatch.setattr(telemetry, "events_since", lambda cid, since: events)
    monkeypatch.setattr(telemetry, "coverage_start", lambda cid: base - 1000)
    monkeypatch.setattr(main, "get_car_id", lambda cid: 1)
    monkeypatch.setattr(main, "q", lambda *a: [])
    monkeypatch.setattr(main, "_battery_samples", lambda cid, since: samples)
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.85)
    monkeypatch.setattr(main, "charge_rate_timeline", lambda cid: [])
    resp = client.get("/api/parked/overview?days=30")
    assert resp.status_code == 200
    body = resp.json()
    # 哨兵会话跨越到今天(基线是合成事件,会话与 30 天窗口相交即纳入)
    assert len(body["sentry"]) == 1
    st = body["sentry"][0]
    # 采样窗口 ±5 分钟放宽:首样 5 分钟处 79%、末样 78% → 掉 1%
    assert st["drop_pct"] == 1 and st["rate_pct_h"] == 1.0
    assert body["rest"] == [] and body["nap"] == []
    assert body["collector"]["connected"] is False


def test_parked_overview_requires_login(client):
    assert client.get("/api/parked/overview").status_code == 401
