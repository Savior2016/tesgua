"""Vehicle state telemetry via TeslaMate MQTT + parked-session analytics.

订阅 TeslaMate 向本地 mosquitto 广播的车辆状态(retained),把关键状态键的
*变化*落库 car_telemetry 表。零新增 Tesla API 请求、绝不唤醒车辆:所有数据都是
TeslaMate 既有轮询的副产品,面板只是旁听。

落库的状态变迁用于:
- 真实哨兵会话(sentry_mode)——替代「驻车清醒≥30分钟」推断
- 小憩会话(is_user_present,车内有人驻车)
- 午休会话(climate_keeper_mode=camp,露营模式)
- 控制页车锁/车窗/充电口的实报校正(见 control._states)
"""
import bisect
import os
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query
from fastapi import Request

router = APIRouter()

MQTT_HOST = os.environ.get("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))

# 采集的状态键:teslamate/cars/<car_id>/<key>,只记变化
KEYS = {
    "state", "sentry_mode", "is_user_present", "locked",
    "is_climate_on", "climate_keeper_mode",
    "windows_open", "doors_open", "trunk_open", "frunk_open",
    "charge_port_door_open", "shift_state", "plugged_in",
    # 充电目标电量(charge_eta 预测剩余时间的首选目标来源)
    "charge_limit_soc",
}

# 仪表盘实时话题:不落库,只维护最新值快照并扇出给 WebSocket 订阅者
DASH_KEYS = {
    "state", "speed", "power", "heading", "shift_state",
    "battery_level", "rated_battery_range_km", "ideal_battery_range_km",
    "inside_temp", "outside_temp", "elevation", "odometer",
    "latitude", "longitude",
    "active_route_destination", "time_to_full_charge",
    "is_climate_on", "locked", "sentry_mode",
}

ON = {"true", "True", "1"}
# 小憩(车内有人驻车)最短计入时长:过滤解锁取物等碎片
OCCUPIED_MIN_MS = 15 * 60 * 1000
# 真实哨兵会话最短时长(更短的开关属抖动/误触)
SENTRY_MIN_MS = 5 * 60 * 1000
# 驻车清醒残余片段(非哨兵/非小憩)的最短展示时长,与旧推断口径一致
AWAKE_MIN_MS = 30 * 60 * 1000

_lock = threading.Lock()
_last: dict = {}          # {(car_id, key): value} 去重基线
_status = {"connected": False, "last_ts": None}
_client = None

# 仪表盘实时层:_live 保存 DASH_KEYS 最新值;_dash_queues 为 WS 订阅者队列
_live: dict = {}          # {(car_id, key): (value, iso_ts)}
_dash_queues: set = set()  # {queue.Queue}


def subscribe_dash():
    """返回一个接收 (car_id, key, value) 的队列;满即丢(仪表盘只要最新值)。"""
    import queue
    q: queue.Queue = queue.Queue(maxsize=100)
    with _lock:
        _dash_queues.add(q)
    return q


def unsubscribe_dash(q) -> None:
    with _lock:
        _dash_queues.discard(q)


def live_snapshot(car_id: int) -> dict:
    """仪表盘首屏快照:{key: value}(字符串原值)+ 采集器状态。"""
    with _lock:
        data = {k: v for (cid, k), (v, _ts) in _live.items() if cid == car_id}
    return {"values": data, "collector": collector_status()}


# ---------- MQTT 采集 ----------

def _insert(car_id: int, key: str, value: str) -> None:
    from . import main
    main._exec(
        "INSERT INTO car_telemetry (car_id, ts, key, value) VALUES (%s, %s, %s, %s)",
        (car_id, datetime.now(timezone.utc).replace(tzinfo=None), key, value),
    )


def _load_baseline() -> None:
    """启动时加载各 (car_id, key) 的最新值,避免 retained 快照重复落库。"""
    from . import main
    rows = main.q(
        "SELECT DISTINCT ON (car_id, key) car_id, key, value "
        "FROM car_telemetry ORDER BY car_id, key, ts DESC"
    )
    with _lock:
        for r in rows:
            _last[(int(r["car_id"]), r["key"])] = r["value"]


def _on_connect(client, userdata, flags, reason_code, properties=None):
    if str(reason_code) == "Success" or reason_code == 0:
        client.subscribe("teslamate/cars/#")
        _status["connected"] = True


def _on_disconnect(client, userdata, flags, reason_code, properties=None):
    _status["connected"] = False


def _on_message(client, userdata, msg):
    parts = msg.topic.split("/")
    if len(parts) != 4 or not parts[2].isdigit():
        return
    key = parts[3]
    car_id = int(parts[2])
    value = msg.payload.decode("utf-8", "replace")
    if key in DASH_KEYS:
        # 仪表盘实时层:只留最新值并扇出,不落库
        with _lock:
            prev = _live.get((car_id, key))
            if prev is None or prev[0] != value:
                _live[(car_id, key)] = (
                    value, datetime.now(timezone.utc).isoformat())
                for q in _dash_queues:
                    try:
                        q.put_nowait((car_id, key, value))
                    except Exception:
                        pass  # 队列满:丢弃旧帧,订阅者只关心最新值
    if key not in KEYS:
        return
    slot = (car_id, key)
    with _lock:
        if _last.get(slot) == value:
            return
    try:
        _insert(car_id, key, value)
    except Exception:
        return  # 落库失败不更新基线,下一条同值消息会重试
    with _lock:
        _last[slot] = value
    _status["last_ts"] = datetime.now(timezone.utc).isoformat()


def collector_status() -> dict:
    return {"connected": _status["connected"], "last_ts": _status["last_ts"],
            "host": MQTT_HOST}


def start_worker() -> None:
    """订阅守护。连接失败只降级(采集停摆、接口照常),绝不阻塞面板启动。"""
    global _client
    if not MQTT_HOST:
        return
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        return
    try:
        _load_baseline()
    except Exception:
        pass  # 表尚未创建(旧部署首次升级)时,retained 快照会落一轮基线,无害
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = _on_connect
    client.on_disconnect = _on_disconnect
    client.on_message = _on_message
    client.reconnect_delay_set(min_delay=1, max_delay=60)
    try:
        client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
        client.loop_start()
        _client = client
    except Exception:
        pass


def stop_worker() -> None:
    global _client
    if _client is not None:
        try:
            _client.loop_stop()
            _client.disconnect()
        except Exception:
            pass
        _client = None


# ---------- 事件读取(带基线合成) ----------

def _utc_ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def events_since(car_id: int, since_naive: datetime) -> list[tuple[int, str, str]]:
    """窗口内的状态变迁,前置各 key 在窗口前的最后一次值作基线(合成为窗口起点的
    事件),使跨越窗口起点的开口区间能被正确还原。返回 (ts_ms, key, value) 升序。"""
    from . import main
    rows = main.q(
        "SELECT key, value, ts FROM car_telemetry "
        "WHERE car_id = %s AND ts >= %s ORDER BY ts",
        (car_id, since_naive),
    )
    base = main.q(
        "SELECT DISTINCT ON (key) key, value, ts FROM car_telemetry "
        "WHERE car_id = %s AND ts < %s ORDER BY key, ts DESC",
        (car_id, since_naive),
    )
    since_ms = _utc_ms(since_naive)
    out = [(since_ms, r["key"], r["value"]) for r in base]
    out += [(_utc_ms(r["ts"]), r["key"], r["value"]) for r in rows]
    return sorted(out)


def coverage_start(car_id: int) -> int | None:
    """采集覆盖起点(epoch ms);无数据(旧部署/未接入)返回 None。"""
    from . import main
    rows = main.q("SELECT min(ts) AS t FROM car_telemetry WHERE car_id = %s", (car_id,))
    if not rows or rows[0]["t"] is None:
        return None
    return _utc_ms(rows[0]["t"])


# ---------- 区间/会话计算(纯函数) ----------

def build_spans(events: list[tuple[int, str, str]], key: str, on_values: set,
                close_on_offline: bool = True) -> list[tuple[int, int | None]]:
    """某状态键的开启区间 [(s, e|None)]。

    close_on_offline: True 时 state 离开 online 强制关闭开口区间(车内有人/露营等
    在线才能确认的状态);哨兵传 False——哨兵物理上会跨断网持续,offline 只是
    连接中断,重新上线后值未变不会有新事件。
    """
    spans, open_s = [], None
    for ts, k, v in events:
        if k == key:
            if v in on_values:
                if open_s is None:
                    open_s = ts
            elif open_s is not None:
                spans.append((open_s, ts))
                open_s = None
        elif k == "state" and v != "online" and close_on_offline and open_s is not None:
            spans.append((open_s, ts))
            open_s = None
    if open_s is not None:
        spans.append((open_s, None))
    return spans


def _cut(seg: tuple[int, int], intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """从 seg 挖去 intervals 覆盖的部分(与 main._cut_interval 同逻辑,本地副本保纯)。"""
    out, cur = [], seg[0]
    for a, b in sorted(intervals):
        if b <= cur:
            continue
        if a >= seg[1]:
            break
        if a > cur:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < seg[1]:
        out.append((cur, seg[1]))
    return out


def sessions_from_spans(spans: list[tuple[int, int | None]], cut: list[tuple[int, int]],
                        min_ms: int, now_ms: int) -> list[tuple[int, int]]:
    """开启区间 → 挖除 → 过短丢弃 → 会话区间列表。"""
    out = []
    for s, e in spans:
        for a, b in _cut((s, e if e is not None else now_ms), cut):
            if b - a >= min_ms:
                out.append((a, b))
    return sorted(out)


def _overlap(parts: list[tuple[int, int]], span: tuple[int, int]) -> int:
    return sum(max(0, min(b, span[1]) - max(a, span[0])) for a, b in parts)


def session_stats(s: int, e: int, samples: list[tuple[int, int, bool]],
                  kpp: float, rate_at) -> dict | None:
    """单个驻车会话的耗电统计。samples: (ts_ms, level, climate_on) 升序;
    电量取窗口 ±5 分钟内首末采样(与行程起止电量同口径)。不足两个采样返回 None。"""
    inner = [(t, l, c) for t, l, c in samples if s - 300000 <= t <= e + 300000]
    if len(inner) < 2:
        return None
    l0, l1 = inner[0][1], inner[-1][1]
    drop = l0 - l1
    h = (e - s) / 3600000
    strict = [c for t, _, c in inner if s <= t <= e]
    climate_share = (sum(1 for c in strict if c) / len(strict)) if strict else 0.0
    energy = round(drop * kpp, 2) if drop > 0 else 0.0
    rate = rate_at(s)
    return {
        "s": s, "e": e, "dur_min": round((e - s) / 60000),
        "s_lvl": l0, "e_lvl": l1, "drop_pct": drop,
        "energy_kwh": energy,
        "rate_pct_h": round(drop / h, 2) if h > 0 else None,
        "rate_kwh_h": round(drop * kpp / h, 3) if h > 0 else None,
        "cost_yuan": round(energy * rate, 2) if rate is not None else None,
        "has_climate": climate_share >= 0.3,
    }


def overlay_real(seg: dict, samples: list[tuple[int, int, bool]],
                 sentry_spans: list[tuple[int, int | None]],
                 occ_spans: list[tuple[int, int | None]],
                 coverage_start: int, now_ms: int) -> dict:
    """用真实遥测重算 coverage_start 之后的驻车分类。

    seg 须含 main._split_segments 扩展返回的 "awake" 原始驻车清醒片段。
    覆盖起点之前维持推断口径;之后:真实哨兵区间优先,剩余清醒片段里挖小憩
    (is_user_present≥15min),再剩余 ≥30min 的按空调/清醒归入 idle。
    """
    if not coverage_start:
        return seg
    from . import main

    sentry_old = [p for p in seg["sentry"] if p["s"] < coverage_start]
    idle_old = [p for p in seg["idle"]
                if p["s"] < coverage_start or p["kind"] == "asleep"]
    awake = [p for p in seg.get("awake", []) if p["s"] >= coverage_start]

    ts_list = [s[0] for s in samples]

    def piece(a: int, b: int, kind: str, real: bool = False):
        i = bisect.bisect_left(ts_list, a)
        j = bisect.bisect_right(ts_list, b)
        if j - i < 1:
            return None
        l0, l1 = samples[i][1], samples[j - 1][1]
        if l1 - l0 >= 1:  # 电量上升:测量噪声,跳过(与 _split_segments 同口径)
            return None
        inner = samples[i:j]
        p = {"s": a, "e": b, "s_lvl": l0, "e_lvl": l1,
             "delta": l1 - l0, "dur_min": round((b - a) / 60000, 0),
             "kind": kind}
        if real:
            p["real"] = True
        if kind == "occupied":
            p["has_climate"] = sum(1 for s_ in inner if s_[2]) / len(inner) >= 0.3
        return p

    new_sentry, new_idle = [], []
    for p in awake:
        span = (p["s"], p["e"])
        s_parts = [(max(a, span[0]), min(b if b is not None else now_ms, span[1]))
                   for a, b in sentry_spans
                   if (b if b is not None else now_ms) > span[0] and a < span[1]]
        s_parts = [(a, b) for a, b in s_parts if b - a >= SENTRY_MIN_MS]
        for a, b in s_parts:
            q_ = piece(a, b, "sentry", real=True)
            if q_:
                new_sentry.append(q_)
        for ra, rb in _cut(span, s_parts):
            o_parts = [(max(a, ra), min(b if b is not None else now_ms, rb))
                       for a, b in occ_spans
                       if (b if b is not None else now_ms) > ra and a < rb]
            o_parts = [(a, b) for a, b in o_parts if b - a >= OCCUPIED_MIN_MS]
            for a, b in o_parts:
                q_ = piece(a, b, "occupied")
                if q_:
                    new_idle.append(q_)
            for a, b in _cut((ra, rb), o_parts):
                if b - a < AWAKE_MIN_MS:
                    continue
                inner = [s_ for s_ in samples if a <= s_[0] <= b]
                climate = inner and sum(1 for s_ in inner if s_[2]) / len(inner) >= 0.3
                if climate:
                    q_ = piece(a, b, "climate")
                    # 与 _split_segments 同口径:空调段电量未下降不入账
                    if q_ and q_["delta"] <= -1:
                        new_idle.append(q_)
                else:
                    q_ = piece(a, b, "awake")
                    if q_:
                        new_idle.append(q_)

    def merge_by_kind(pieces):
        out = []
        for kind in dict.fromkeys(p["kind"] for p in pieces):
            out += main._merge_pieces([p for p in pieces if p["kind"] == kind])
        return sorted(out, key=lambda p: p["s"])

    return {"sentry": main._merge_pieces(sentry_old + new_sentry),
            "idle": merge_by_kind(idle_old + new_idle),
            "awake": seg.get("awake", [])}


# ---------- 窗口真实区间(activity 重算与本模块接口共用) ----------

def real_spans(car_id: int, since_naive: datetime, now_ms: int):
    """返回 (sentry_spans, presence_spans, nap_spans):窗口(含基线)内的真实开启区间。"""
    events = events_since(car_id, since_naive)
    sentry = build_spans(events, "sentry_mode", ON, close_on_offline=False)
    presence = build_spans(events, "is_user_present", ON)
    nap = build_spans(events, "climate_keeper_mode", {"camp"})
    return sentry, presence, nap


# ---------- 接口 ----------

@router.get("/api/parked/overview")
def parked_overview(request: Request, car_id: int | None = Query(default=None),
                    days: int = Query(default=7, ge=1, le=30)):
    """哨兵/小憩/午休三类驻车会话的耗电统计(活动页两个新模块的数据源)。"""
    from . import main
    cid = main.get_car_id(car_id)
    now = datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    since = now - timedelta(days=days)
    since_ms = int(since.timestamp() * 1000)
    buffered = (since - timedelta(days=3)).replace(tzinfo=None)

    events = events_since(cid, buffered)
    sentry_spans = build_spans(events, "sentry_mode", ON, close_on_offline=False)
    presence_spans = build_spans(events, "is_user_present", ON)
    nap_spans = build_spans(events, "climate_keeper_mode", {"camp"})

    # 行驶/充电区间(哨兵与小憩都须挖除)
    drives = main.q(
        "SELECT start_date, end_date FROM drives WHERE car_id = %s AND start_date >= %s",
        (cid, buffered),
    )
    charges = main.q(
        "SELECT start_date, end_date FROM charging_processes "
        "WHERE car_id = %s AND start_date >= %s AND end_date IS NOT NULL",
        (cid, buffered),
    )
    cut = [(main._utc_ms(d["start_date"]), main._utc_ms(d["end_date"])) for d in drives]
    cut += [(main._utc_ms(c["start_date"]), main._utc_ms(c["end_date"])) for c in charges]

    sentry = sessions_from_spans(sentry_spans, cut, SENTRY_MIN_MS, now_ms)
    nap = sessions_from_spans(nap_spans, [], 3 * 60 * 1000, now_ms)
    # 小憩:挖除行驶/充电/哨兵;与午休重叠过半的归入下方午休列表,不重复展示
    rest_all = sessions_from_spans(presence_spans, cut + sentry, OCCUPIED_MIN_MS, now_ms)
    rest = [r for r in rest_all
            if all(_overlap([n], r) * 2 < r[1] - r[0] for n in nap)]

    samples = main._battery_samples(cid, buffered)
    kpp = main.kwh_per_pct(cid)
    timeline = main.charge_rate_timeline(cid)
    tl_starts = [c["start_ts"] for c in timeline]

    def rate_at(ts: int):
        i = bisect.bisect_right(tl_starts, ts) - 1
        return timeline[i]["rate_yuan_kwh"] if i >= 0 else None

    def build(spans_list):
        out = []
        for s, e in spans_list:
            if e <= since_ms:
                continue
            s_clip = max(s, since_ms)
            st = session_stats(s_clip, e, samples, kpp, rate_at)
            if st:
                st["s_full"] = s  # 会话真实起点(可能被窗口裁剪)
                out.append(st)
        out.sort(key=lambda x: x["s"], reverse=True)
        return out

    return {
        "days": days,
        "kwh_per_pct": round(kpp, 3),
        "coverage_start": coverage_start(cid),
        "collector": collector_status(),
        "sentry": build(sentry),
        "rest": build(rest),
        "nap": build(nap),
    }
