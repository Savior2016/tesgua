"""Drive physics: elevation potential work, braking kinetic loss, car mass lookup."""
from datetime import datetime, timedelta

from app.main import _brake_kwh, _car_mass_kg, _elevation_work_kwh

T0 = datetime(2026, 9, 1, 8, 0, 0)
MASS = 1990.0
K = MASS * 9.80665 / 3.6e6  # m → kWh


def seq(vals, step_s=1):
    return [(T0 + timedelta(seconds=i * step_s), v) for i, v in enumerate(vals)]


def test_mass_lookup():
    assert _car_mass_kg("Y") == 1990.0
    assert _car_mass_kg("3") == 1840.0
    assert _car_mass_kg("Cybertruck") == 3100.0
    assert _car_mass_kg(None) == 1990.0
    assert _car_mass_kg("") == 1990.0


def test_elevation_climb_and_drop():
    # 100 → 120 → 105:climb 20m, drop 15m
    climb, drop = _elevation_work_kwh(seq([100, 105, 110, 115, 120, 115, 110, 105]), MASS)
    assert abs(climb - 20 * K) < 1e-9
    assert abs(drop - 15 * K) < 1e-9


def test_elevation_jitter_suppressed():
    # ±2m 抖动不超过 3m 滞后带:不计任何势能变化
    climb, drop = _elevation_work_kwh(seq([100, 102, 100, 101, 99, 100, 102, 100]), MASS)
    assert climb == 0.0 and drop == 0.0


def test_elevation_gap_reanchors():
    # 断流(>60s)后海拔突变不算做功
    s = seq([100, 110], step_s=1)
    s.append((T0 + timedelta(seconds=300), 500.0))
    s.append((T0 + timedelta(seconds=301), 505.0))
    climb, drop = _elevation_work_kwh(s, MASS)
    assert abs(climb - 15 * K) < 1e-9   # 只有 100→110 的 10m 与 500→505 的 5m
    assert drop == 0.0


def test_brake_kwh_deceleration():
    # 60 → 0 km/h 刹停:½m·60² km/h² → J → kWh
    loss = _brake_kwh(seq([60, 45, 30, 15, 0], step_s=2), MASS)
    expect = 0.5 * MASS * 60 ** 2 / 12.96 / 3.6e6
    assert abs(loss - expect) / expect < 0.05


def test_brake_kwh_steady_speed_jitter():
    # 匀速 60 ± 1 读数抖动:3 点平滑后损耗应远小于一次真实刹车(60→0 ≈ 0.077 kWh)
    loss = _brake_kwh(seq([60, 61, 60, 59, 60, 61, 60, 59, 60]), MASS)
    assert loss < 0.005


def test_brake_kwh_acceleration_ignored():
    assert _brake_kwh(seq([0, 20, 40, 60]), MASS) == 0.0
    assert _brake_kwh([], MASS) == 0.0
    assert _brake_kwh(seq([60]), MASS) == 0.0
