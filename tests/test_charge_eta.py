"""charge_eta.py 充电剩余时间预测测试(不连库)。"""
from test_security import client, store, login  # noqa: F401 — pytest fixture 注入

from app import charge_eta, main


# ---------- build_curves ----------

def rows_for(pid, loc, curve):
    """curve: {soc: power} 展开成 (pid, loc, soc, power) 行。"""
    return [(pid, loc, soc, p) for soc, p in curve.items()]


def test_build_curves_median_and_zero_filter():
    rows = []
    for pid in (1, 2):
        rows += rows_for(pid, "addr_1", {50: 100, 51: 100})
    # 离群慢充会话(冷电池)被中位数压制
    rows += rows_for(3, "addr_1", {50: 20, 51: 20})
    # 边界 0 值剔除
    rows += [(1, "addr_1", 49, 0), (2, "addr_1", 49, 0)]
    out = charge_eta.build_curves(rows)
    assert out["locs"]["addr_1"][50] == 100
    assert 49 not in out["locs"]["addr_1"]


def test_build_curves_min_sessions():
    rows = rows_for(1, "addr_1", {50: 100})          # 仅 1 次会话 → 不建地点曲线
    rows += rows_for(2, "addr_2", {50: 50})
    rows += rows_for(3, "addr_2", {50: 50})
    out = charge_eta.build_curves(rows)
    assert "addr_1" not in out["locs"]
    assert out["locs"]["addr_2"][50] == 50
    assert out["global"][50]  # 全局池化不受会话数限制


# ---------- power_at ----------

def test_power_at_gap_and_extrapolation():
    curve = {50: 100, 52: 90, 60: 40}
    assert charge_eta.power_at(curve, 50) == 100
    assert charge_eta.power_at(curve, 51) == 90    # 缺口取更高一侧(保守)
    assert charge_eta.power_at(curve, 61) == 40    # 超出顶部用最高已知 bin 外推
    assert charge_eta.power_at({}, 50) is None


# ---------- predict_minutes ----------

def test_predict_minutes_integration_math():
    # 60.0% → 63%,曲线功率 100/50/25 kWh,每 % 0.85 kWh
    curve = {60: 100, 61: 50, 62: 25}
    mins = charge_eta.predict_minutes(60.0, 100, 63, curve, 0.85)
    # 60→61: 0.85/100*60 = 0.51;61→62: 1.02;62→63: 2.04 → 3.57 ≈ 4
    assert mins == 4


def test_predict_minutes_partial_first_bin_uses_actual_power():
    # 60.5%:bin 60 只剩 0.5%,用当前实际功率 200(而非曲线 100)
    curve = {60: 100, 61: 100}
    mins = charge_eta.predict_minutes(60.5, 200, 62, curve, 0.85)
    # 0.5*0.85/200*60 = 0.1275;61→62: 0.85/100*60 = 0.51 → 0.64 ≈ 1(下限 1)
    assert mins == 1


def test_predict_minutes_guards():
    curve = {60: 100}
    assert charge_eta.predict_minutes(60, 0, 80, curve, 0.85) is None    # 预热/暂停
    assert charge_eta.predict_minutes(60, 100, 55, curve, 0.85) is None  # 目标≤当前
    assert charge_eta.predict_minutes(60, 100, 80, {}, 0.85) is None     # 无曲线
    assert charge_eta.predict_minutes(None, 100, 80, curve, 0.85) is None
    # 全程 1kW 充满 40% 超过 12h 上限 → None
    assert charge_eta.predict_minutes(60, 100, 100, {b: 1 for b in range(60, 100)},
                                      0.85) is None


# ---------- estimate(DB 层,monkeypatch) ----------

def _patch_estimate_deps(monkeypatch, *, proc=None, charge_rows=None, pos_lvl=None,
                         tel_limit=None, hist_rows=None, sess_rows=None,
                         kpp=0.85):
    """按 SQL 内容分发假数据。"""
    proc = proc if proc is not None else [
        {"id": 9, "address_id": 1, "geofence_id": None}]
    charge_rows = charge_rows if charge_rows is not None else [
        {"charger_power": 100, "battery_level": 60}]

    def fake_q(sql, params=()):
        if "end_date IS NULL" in sql and "charging_processes" in sql:
            return proc
        if "ORDER BY date DESC LIMIT 1" in sql and "charges" in sql:
            return charge_rows
        if "usable_battery_level" in sql:
            return [{"usable_battery_level": pos_lvl}]
        if "charge_limit_soc" in sql:
            return [{"value": tel_limit}] if tel_limit else []
        if "GROUP BY end_battery_level" in sql:
            return hist_rows or []
        if "JOIN charging_processes" in sql:
            return []          # 历史曲线原始行
        if "BETWEEN" in sql:
            return sess_rows or []
        return []

    monkeypatch.setattr(main, "q", fake_q)
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: kpp)
    charge_eta._cache.clear()


def test_estimate_no_active_session(monkeypatch):
    _patch_estimate_deps(monkeypatch, proc=[])
    assert charge_eta.estimate(1) is None


def test_estimate_zero_power(monkeypatch):
    _patch_estimate_deps(monkeypatch,
                         charge_rows=[{"charger_power": 0, "battery_level": 60}])
    assert charge_eta.estimate(1) is None


def test_estimate_uses_telemetry_target(monkeypatch):
    # 未知地点(无历史曲线)→ 全局缩放兜底;target 来自 charge_limit_soc=80
    hist = []
    for pid in (1, 2):
        hist += [(pid, 99, None, s, 100) for s in range(60, 80)]  # 全局 100kW 平台
    _patch_estimate_deps(monkeypatch, pos_lvl=60.0, tel_limit="80",
                         charge_rows=[{"charger_power": 50, "battery_level": 60}],
                         sess_rows=[{"battery_level": 40, "charger_power": 50}])
    monkeypatch_hist = [(r[0], r[1], r[2], r[3], r[4]) for r in hist]

    def fake_q(sql, params=()):
        if "JOIN charging_processes" in sql:
            return [{"pid": p, "address_id": a, "geofence_id": g,
                     "battery_level": s, "charger_power": pw}
                    for p, a, g, s, pw in monkeypatch_hist]
        return None

    # 与 _patch_estimate_deps 的 fake_q 合并
    base_q = main.q
    def merged(sql, params=()):
        r = fake_q(sql, params)
        return r if r is not None else base_q(sql, params)
    monkeypatch.setattr(main, "q", merged)

    out = charge_eta.estimate(1)
    # 缩放系数 50/100=0.5 → 曲线全 50kW;60→80 共 20% × 0.85/50×60 = 20.4 分
    assert out == {"minutes": 20, "target_pct": 80}


def test_estimate_target_fallback_chain(monkeypatch):
    # 无 telemetry → 历史众数 82
    hist = []
    for pid, end in ((1, 82), (2, 82), (3, 80)):
        hist += [{"pid": pid, "address_id": 1, "geofence_id": None,
                  "battery_level": s, "charger_power": 100}
                 for s in range(60, 82)]
    _patch_estimate_deps(monkeypatch, pos_lvl=60.0, tel_limit=None,
                         hist_rows=[{"end_battery_level": 82, "n": 2}])

    base_q = main.q
    def merged(sql, params=()):
        if "JOIN charging_processes" in sql:
            return hist
        return base_q(sql, params)
    monkeypatch.setattr(main, "q", merged)

    out = charge_eta.estimate(1)
    # 本地点曲线全 100kW:60→82 共 22% × 0.85/100×60 = 11.22 ≈ 11
    assert out == {"minutes": 11, "target_pct": 82}


def test_estimate_curve_cache(monkeypatch):
    _patch_estimate_deps(monkeypatch, pos_lvl=60.0, tel_limit="80")
    calls = []
    real_q = main.q
    def counting(sql, params=()):
        calls.append(sql)
        return real_q(sql, params)
    monkeypatch.setattr(main, "q", counting)
    charge_eta.estimate(1)
    charge_eta.estimate(1)
    hist_queries = [s for s in calls if "JOIN charging_processes" in s]
    assert len(hist_queries) == 1  # 第二次命中缓存


# ---------- overview 集成 ----------

def _overview_q(sql, params=()):
    """overview 端点的最小假数据集。"""
    if "EXISTS" in sql and "end_date IS NULL" in sql:
        return [{"x": "charging_processes" in sql}]
    if "FROM states" in sql:
        return [{"state": "online"}]
    if "drives_total" in sql:
        return [{"drives_total": 0, "month_km": 0, "year_km": 0,
                 "week_km": 0, "month_ideal_delta_km": 0}]
    if "duration_min" in sql and "charging_processes" in sql:
        return [{"sessions": 0, "energy_kwh": 0, "cost": 0, "duration_min": 0}]
    return []


def test_overview_includes_charge_eta_when_charging(client, monkeypatch):
    login(client)
    monkeypatch.setattr(main, "get_car_id", lambda cid: 1)
    monkeypatch.setattr(charge_eta, "estimate",
                        lambda cid: {"minutes": 23, "target_pct": 80})
    monkeypatch.setattr(main, "q", _overview_q)
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.85)
    monkeypatch.setattr(main, "kwh_per_ideal_km", lambda cid: 0.15)
    body = client.get("/api/overview").json()
    assert body["state"] == "charging"
    assert body["charge_eta"] == {"minutes": 23, "target_pct": 80}


def test_overview_no_charge_eta_when_not_charging(client, monkeypatch):
    login(client)
    monkeypatch.setattr(main, "get_car_id", lambda cid: 1)
    monkeypatch.setattr(charge_eta, "estimate",
                        lambda cid: (_ for _ in ()).throw(AssertionError("不应调用")))

    def fake_q(sql, params=()):
        rows = _overview_q(sql, params)
        if "EXISTS" in sql:
            return [{"x": False}]
        if "FROM states" in sql:
            return [{"state": "asleep"}]
        return rows

    monkeypatch.setattr(main, "q", fake_q)
    monkeypatch.setattr(main, "kwh_per_pct", lambda cid: 0.85)
    monkeypatch.setattr(main, "kwh_per_ideal_km", lambda cid: 0.15)
    body = client.get("/api/overview").json()
    assert body["charge_eta"] is None
