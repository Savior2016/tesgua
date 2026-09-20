"""堵车/红绿灯分析:_drive_traffic 分类器(纯函数,不连库)。

判定口径:车速 <30 km/h 即算堵车(缓行+堵停);堵车中提速超 30 但持续
不超过 20 秒不中断堵车(桥接回填);停车 5–120s 且停车前 15s 内曾 ≥30 km/h
= 红绿灯等待;其余停车 ≥5s = 堵车停留。
"""
from app.main import _drive_traffic


def seq(events):
    """由 (时长秒, 速度km/h) 段列表生成 (ts_ms, speed) 采样序列(约 1s 一条)。"""
    out, t = [], 0
    for dur, speed in events:
        steps = max(1, int(dur))
        for _ in range(steps):
            out.append((t, speed))
            t += 1000
    return out


def test_empty_and_all_moving():
    assert _drive_traffic([]) == {"light_n": 0, "light_s": 0, "jam_s": 0, "jam_km": 0.0}
    r = _drive_traffic(seq([(600, 60)]))
    assert r == {"light_n": 0, "light_s": 0, "jam_s": 0, "jam_km": 0.0}


def test_traffic_light_stop():
    # 行驶 60s → 停 45s(红灯)→ 再行驶
    r = _drive_traffic(seq([(60, 50), (45, 0), (60, 50)]))
    assert r["light_n"] == 1
    assert 40 <= r["light_s"] <= 50
    assert r["jam_s"] == 0
    assert r["jam_km"] == 0.0


def test_short_pause_ignored():
    # 停 3s 属瞬时停顿,不计红灯也不计堵车
    r = _drive_traffic(seq([(60, 50), (3, 0), (60, 50)]))
    assert r["light_n"] == 0
    assert r["light_s"] == 0
    assert r["jam_s"] == 0


def test_long_stop_is_jam():
    # 停 5 分钟 = 堵车停留
    r = _drive_traffic(seq([(60, 50), (300, 0), (60, 50)]))
    assert r["light_n"] == 0
    assert 295 <= r["jam_s"] <= 305
    assert r["jam_km"] == 0.0


def test_crawl_time_and_distance():
    # 以 6 km/h 缓行 600s = 1/6 h → 堵车路程约 1.0 km,堵车时间约 600s
    r = _drive_traffic(seq([(60, 60), (600, 6), (60, 60)]))
    assert 590 <= r["jam_s"] <= 605
    assert 0.95 <= r["jam_km"] <= 1.05
    assert r["light_n"] == 0


def test_gap_over_30s_not_counted():
    # 缓行中出现 60s 采样断档:断档间隙不计入堵车时间
    s = seq([(60, 5)])
    s.append((60 * 1000 + 60 * 1000, 5))  # 距上一条 60s 的断档
    s += [(60 * 1000 + 61 * 1000 + i * 1000, 5) for i in range(30)]
    r = _drive_traffic(s)
    assert r["jam_s"] <= 95  # 60s 缓行 + 30s 续行,不含 60s 断档


def test_mixed_trip():
    # 红灯 45s + 长停 200s + 缓行 100s(8 km/h ≈ 0.22 km)
    r = _drive_traffic(seq([(30, 40), (45, 0), (30, 40), (200, 0), (100, 8), (30, 40)]))
    assert r["light_n"] == 1
    assert 240 <= r["jam_s"] <= 305  # 200 长停 + ~100 缓行
    assert 0.15 <= r["jam_km"] <= 0.30


def test_stop_and_go_is_jam_not_light():
    # 缓行(8 km/h)中反复停 20–40s:走走停停属堵车,不计红灯
    r = _drive_traffic(seq([(60, 8), (30, 0), (60, 8), (20, 0), (60, 8)]))
    assert r["light_n"] == 0
    assert r["jam_s"] >= 160  # 两段停车 + 全部缓行


def test_under_30_is_jam():
    # 持续 25 km/h(<30)整段算堵车;稳定 45 km/h 不算
    r = _drive_traffic(seq([(60, 50), (300, 25), (60, 50)]))
    assert 295 <= r["jam_s"] <= 305
    assert 2.0 <= r["jam_km"] <= 2.2  # 25 km/h × 300s ≈ 2.08 km


def test_brief_speedup_does_not_end_jam():
    # 堵车中偶尔提速到 45 km/h 仅 10s:不中断,整段(含提速段)都算堵车
    r = _drive_traffic(seq([(120, 15), (10, 45), (120, 15)]))
    assert 245 <= r["jam_s"] <= 250
    # 堵车路程含提速段:15×230/3600 + 45×10/3600 ≈ 0.96 + 0.13 ≈ 1.08 km
    assert 1.0 <= r["jam_km"] <= 1.15


def test_sustained_fast_breaks_jam():
    # 提速到 50 km/h 持续 60s(>20s):堵车结束,前后两段缓行分别计
    r = _drive_traffic(seq([(100, 15), (60, 50), (100, 15)]))
    assert 195 <= r["jam_s"] <= 205
    assert 0.8 <= r["jam_km"] <= 0.9  # 只有两段 15 km/h 缓行


def test_brief_pause_inside_jam_bridged():
    # 堵车缓行中瞬时停 3s(<5s 不单独算,但桥接回堵车)
    r = _drive_traffic(seq([(120, 12), (3, 0), (120, 12)]))
    assert r["light_n"] == 0
    assert r["jam_s"] >= 240


def test_trip_ends_while_stopped():
    # 行程结束时仍在停(红灯 30s 未起步):按已停时长结算
    r = _drive_traffic(seq([(60, 50), (30, 0)]))
    assert r["light_n"] == 1
    assert 25 <= r["light_s"] <= 35
