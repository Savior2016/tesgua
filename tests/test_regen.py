"""动能回收积分:_regen_kwh(纯函数,不连库)。

口径:负功率按时间梯形积分;相邻采样间隔 >60s 不积分(断流/休眠);
正功率(驱动耗电)不产生回收。
"""
from datetime import datetime, timedelta

from app.main import _regen_kwh


def seq(events):
    """由 (时长秒, 功率kW) 段列表生成 (时间, 功率) 采样序列(约 1s 一条)。"""
    out, t = [], datetime(2026, 1, 1, 8, 0, 0)
    for dur, pw in events:
        for _ in range(max(1, int(dur))):
            out.append((t, pw))
            t += timedelta(seconds=1)
    return out


def test_empty_and_positive_only():
    assert _regen_kwh([]) == 0.0
    assert _regen_kwh(seq([(60, 30)])) == 0.0   # 纯驱动无回收


def test_constant_regen():
    # -20 kW 持续 60 个采样(59 个积分区间)≈ 59×20/3600 ≈ 0.328 kWh
    r = _regen_kwh(seq([(60, -20)]))
    assert 0.32 <= r <= 0.34


def test_trapezoid_between_levels():
    # -10 kW × 30s 后 -30 kW × 30s:区间均值在过渡处取梯形
    r = _regen_kwh(seq([(30, -10), (30, -30)]))
    # 29×10 + 1×20 + 29×30 = 290+20+870 = 1180 W·s → /3600 ≈ 0.328 kWh
    assert 0.32 <= r <= 0.34


def test_gap_over_60s_not_integrated():
    # 两个 -20 kW 采样间隔 5 分钟:断流不积分,回收为 0
    t0 = datetime(2026, 1, 1, 8, 0, 0)
    samples = [(t0, -20.0), (t0 + timedelta(seconds=300), -20.0)]
    assert _regen_kwh(samples) == 0.0


def test_mixed_drive_and_regen():
    # 驱动 30 kW × 60s(无回收)→ 回收 -30 kW × 60s ≈ 59×30/3600 ≈ 0.49 kWh
    r = _regen_kwh(seq([(60, 30), (60, -30)]))
    assert 0.48 <= r <= 0.50
