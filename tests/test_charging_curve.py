"""充电曲线接口的纯函数:抽稀 _thin_rows 与电池加热区间 _heater_spans。"""
from app.main import _heater_spans, _thin_rows


def test_thin_keeps_small_input():
    rows = list(range(10))
    assert _thin_rows(rows) == rows


def test_thin_caps_and_keeps_ends():
    rows = list(range(2000))
    out = _thin_rows(rows, cap=800)
    assert len(out) == 800
    assert out[0] == 0 and out[-1] == 1999
    assert out == sorted(set(out))  # 单调不重复


def test_thin_exact_cap():
    rows = list(range(800))
    assert _thin_rows(rows, cap=800) == rows


def test_heater_spans_basic():
    # 点列:[ts, power, voltage, current, heater]
    pts = [[i * 60_000, 10, 228, 16, 1 if 10 <= i <= 20 else 0] for i in range(60)]
    spans = _heater_spans(pts)
    assert spans == [[10 * 60_000, 21 * 60_000]]  # 止于第一个 heater=0 点


def test_heater_spans_unclosed_extends_to_last_point():
    pts = [[i * 60_000, 10, 228, 16, 1 if i >= 5 else 0] for i in range(10)]
    assert _heater_spans(pts) == [[5 * 60_000, 9 * 60_000]]


def test_heater_spans_empty_and_none():
    assert _heater_spans([]) == []
    pts = [[i * 60_000, 10, 228, 16, 0] for i in range(5)]
    assert _heater_spans(pts) == []


def test_heater_spans_multiple():
    pts = [[0, 1, None, None, 0], [1, 1, None, None, 1], [2, 1, None, None, 0],
           [3, 1, None, None, 1], [4, 1, None, None, 0]]
    assert _heater_spans(pts) == [[1, 2], [3, 4]]
