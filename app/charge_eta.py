"""充电剩余时间预测:按充电地点的历史 SOC→功率曲线积分估算。

车机剩余时间按瞬时功率线性外推,不考虑高 SOC 降功率,实测偏差很大。
同一地点的充电曲线高度稳定(平台功率 + 固定降功率拐点),因此:
- 每地点建 SOC(int bin)→ 非零功率中位数曲线(<2 次会话的地点不建模)
- 剩余时间 = 当前 bin 剩余部分(用当前实际功率) + 后续每 bin kwh_per_pct/P(bin) 积分
- 未知地点:全局池化曲线按本次平台期功率缩放兜底
"""
import statistics
import threading
import time

MIN_SESSIONS_PER_LOC = 2   # 地点历史少于此次数不建独立曲线(走全局缩放)
CURVE_TTL_S = 600
# 平台期区间(缩放兜底用):此区间内快充功率基本恒定
PLATEAU_LO, PLATEAU_HI = 25, 55
MAX_ETA_MIN = 12 * 60      # sanity cap,超出视为不可预测
MIN_POWER_KW = 1.0         # 低于此功率视为预热/暂停,不预测

_cache: dict = {}          # cid → (monotonic_ts, curves)
_lock = threading.Lock()


def _loc_key(address_id, geofence_id):
    if geofence_id:
        return f"geo_{geofence_id}"
    if address_id:
        return f"addr_{address_id}"
    return None


def _median_nz(powers):
    vals = [p for p in powers if p and p > 0]
    return statistics.median(vals) if vals else None


def build_curves(rows):
    """rows: [(pid, loc_key, soc:int, power)],返回
    {"locs": {loc: {bin: median_p}}, "global": {bin: median_p}}。
    每 bin 取非零功率中位数——0 值是会话起止边界的占位,冷电池慢充等
    离群会话也被中位数压制。"""
    by_loc_bin: dict = {}
    by_glob_bin: dict = {}
    loc_pids: dict = {}
    for pid, loc, soc, power in rows:
        if soc is None or power is None:
            continue
        b = int(soc)
        by_glob_bin.setdefault(b, []).append(float(power))
        if loc:
            by_loc_bin.setdefault((loc, b), []).append(float(power))
            loc_pids.setdefault(loc, set()).add(pid)
    locs = {}
    for loc, pids in loc_pids.items():
        if len(pids) < MIN_SESSIONS_PER_LOC:
            continue
        curve = {}
        for (lc, b), powers in by_loc_bin.items():
            if lc != loc:
                continue
            m = _median_nz(powers)
            if m:
                curve[b] = m
        if curve:
            locs[loc] = curve
    glob = {b: m for b, powers in by_glob_bin.items()
            if (m := _median_nz(powers))}
    return {"locs": locs, "global": glob}


def power_at(curve, soc_bin):
    """查 bin 功率;缺口取更高一侧已知 bin(降功率段保守),
    超出顶部覆盖用最高已知 bin 外推。"""
    if not curve:
        return None
    if soc_bin in curve:
        return curve[soc_bin]
    higher = [b for b in curve if b > soc_bin]
    if higher:
        return curve[min(higher)]
    return curve[max(curve)]


def _plateau(curve):
    vals = [p for b, p in curve.items() if PLATEAU_LO <= b <= PLATEAU_HI]
    return statistics.median(vals) if vals else None


def scale_curve(curve, factor):
    return {b: p * factor for b, p in curve.items()}


def predict_minutes(cur_soc, cur_power, target, curve, kwh_per_pct):
    """纯积分:当前 bin 剩余部分用实际功率,后续整 bin 用模型功率。"""
    if cur_soc is None or target is None or target <= cur_soc:
        return None
    if not cur_power or cur_power < MIN_POWER_KW:
        return None
    if not curve:
        return None
    frac = cur_soc % 1
    # 整点电量(60.0)时当前 bin 全额剩余,也算进当前实际功率段
    first = (1.0 - frac) if frac else 1.0
    total_min = first * kwh_per_pct / cur_power * 60
    for b in range(int(cur_soc) + 1, int(target)):
        p = power_at(curve, b)
        if not p or p < MIN_POWER_KW:
            return None
        total_min += kwh_per_pct / p * 60
    if total_min > MAX_ETA_MIN:
        return None
    return max(1, int(round(total_min)))


# ---------- DB 层 ----------

def _curves(cid):
    from . import main
    with _lock:
        hit = _cache.get(cid)
        if hit and time.monotonic() - hit[0] < CURVE_TTL_S:
            return hit[1]
    rows = main.q(
        """
        SELECT c.charging_process_id AS pid, cp.address_id, cp.geofence_id,
               c.battery_level, c.charger_power
        FROM charges c
        JOIN charging_processes cp ON cp.id = c.charging_process_id
        WHERE cp.car_id = %s
          AND c.battery_level IS NOT NULL AND c.charger_power IS NOT NULL
        """,
        (cid,),
    )
    curves = build_curves([
        (r["pid"], _loc_key(r["address_id"], r["geofence_id"]),
         r["battery_level"], r["charger_power"])
        for r in rows
    ])
    with _lock:
        _cache[cid] = (time.monotonic(), curves)
    return curves


def _target_pct(cid, loc):
    """目标电量:MQTT 实报 charge_limit_soc > 该地点历史结束电量众数 > 80。"""
    from . import main
    row = main.q(
        "SELECT value FROM car_telemetry "
        "WHERE car_id = %s AND key = 'charge_limit_soc' ORDER BY ts DESC LIMIT 1",
        (cid,),
    )
    if row:
        try:
            v = int(float(row[0]["value"]))
            if 50 <= v <= 100:
                return v
        except (TypeError, ValueError):
            pass
    if loc:
        col = "geofence_id" if loc.startswith("geo_") else "address_id"
        row = main.q(
            f"""
            SELECT end_battery_level, count(*) AS n
            FROM charging_processes
            WHERE car_id = %s AND {col} = %s AND end_battery_level IS NOT NULL
            GROUP BY end_battery_level ORDER BY n DESC, end_battery_level DESC
            LIMIT 1
            """,
            (cid, int(loc.split("_", 1)[1])),
        )
        if row:
            return int(row[0]["end_battery_level"])
    return 80


def estimate(cid):
    """充电中返回 {"minutes": N, "target_pct": M},无法预测返回 None。"""
    from . import main
    active = main.q(
        "SELECT id, address_id, geofence_id FROM charging_processes "
        "WHERE car_id = %s AND end_date IS NULL "
        "ORDER BY start_date DESC LIMIT 1",
        (cid,),
    )
    if not active:
        return None
    proc = active[0]
    loc = _loc_key(proc["address_id"], proc["geofence_id"])

    last = main.q(
        "SELECT charger_power, battery_level FROM charges "
        "WHERE charging_process_id = %s ORDER BY date DESC LIMIT 1",
        (proc["id"],),
    )
    if not last or not last[0]["charger_power"] \
            or float(last[0]["charger_power"]) < MIN_POWER_KW:
        return None
    cur_power = float(last[0]["charger_power"])

    pos = main.q(
        "SELECT usable_battery_level FROM positions "
        "WHERE car_id = %s ORDER BY date DESC LIMIT 1",
        (cid,),
    )
    cur_soc = None
    if pos and pos[0]["usable_battery_level"] is not None:
        cur_soc = float(pos[0]["usable_battery_level"])
    elif last[0]["battery_level"] is not None:
        cur_soc = float(last[0]["battery_level"])
    if cur_soc is None:
        return None

    target = _target_pct(cid, loc)
    if target <= cur_soc:
        return None

    curves = _curves(cid)
    curve = curves["locs"].get(loc)
    if curve is None:
        glob = curves["global"]
        if not glob:
            return None
        # 未知地点:按平台期功率缩放全局曲线
        sess = main.q(
            "SELECT battery_level, charger_power FROM charges "
            "WHERE charging_process_id = %s AND battery_level BETWEEN %s AND %s "
            "AND charger_power > 0",
            (proc["id"], PLATEAU_LO, PLATEAU_HI),
        )
        sess_plateau = statistics.median(
            [float(r["charger_power"]) for r in sess]) if sess else None
        glob_plateau = _plateau(glob)
        if sess_plateau and glob_plateau:
            factor = sess_plateau / glob_plateau
        else:
            here = power_at(glob, int(cur_soc))
            if not here:
                return None
            factor = cur_power / here
        curve = scale_curve(glob, factor)

    minutes = predict_minutes(cur_soc, cur_power, target, curve,
                              main.kwh_per_pct(cid))
    if minutes is None:
        return None
    return {"minutes": minutes, "target_pct": target}
