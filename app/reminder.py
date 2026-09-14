"""充电提醒:识别家/公司,按通勤+停放耗电推算还能用几天、在哪充电。

纯只读分析(不下发任何车辆指令)。家/公司判定:
  家   = 夜间(01:00–05:00 本地)停放最多的地点聚类
  公司 = 白天(12:00–16:00 本地工作日)停放最多的其他聚类
端点按经纬度聚类(半径 500m),解决同一地点多条 addresses 记录的问题。
用户可通过 POST /api/charging/anchors 纠正,覆盖存 panel_manual kind='anchors'。

预测:通勤腿耗电取家⇄公司行程的 rated 续航差中位数(剔除距离异常的特殊行程),
停放掉电取相邻行程间 (前序结束续航 − 后续起始续航)/停放小时 的中位数(分地点),
并按 positions 清醒采样把停放耗电拆成「哨兵(驻车清醒且非空调) vs 其他驻车耗电」
(_parked_split,口径与活动页 _split_segments 一致),按学到的出发时刻逐事件向后推演。
阈值为可配置的最低表显电量(默认 20%,
POST /api/charging/reminder-config,存 panel_manual kind='settings' key='reminder'):
某趟通勤跑完会跌破阈值 → 必须在这趟出发前充电(给出出发时刻与地点);
停放掉电先跌破 → 给出跌破时刻与停放地点。
"""
import bisect
import statistics
from datetime import datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel

router = APIRouter(prefix="/api/charging", tags=["charging"])

_CLUSTER_M = 500          # 端点聚类半径
_CHARGER_NEAR_M = 1500    # 推荐充电桩与 anchor 的最大距离
_MIN_LEGS = 6             # 做出预测所需的最少通勤腿数(双向合计)
_MIN_LEG_DIR = 2          # 每个方向最少腿数
_HORIZON_DAYS = 30
_NIGHT = (1, 5)           # 夜间停留判定窗口(本地小时)
_DAY = (12, 16)           # 白天停留判定窗口
_MIN_RANGE_FLOOR_KM = 40  # 读不到表显电量时的续航阈值下限
_DEFAULT_MIN_PCT = 20     # 提醒的最低表显电量(%),可在卡片上修改


def _m():
    """延迟引用 main(避免循环导入);请求到来时 main 必然已加载完毕。"""
    from . import main
    return main


def _tz():
    return ZoneInfo(_m().DISPLAY_TZ)


def _local(ms):
    return datetime.fromtimestamp(ms / 1000, _tz())


def _dist_m(lat1, lng1, lat2, lng2):
    """haversine 球面距离(米)。"""
    r = 6371000
    p1, p2 = radians(lat1), radians(lat2)
    dp, dl = p2 - p1, radians(lng2 - lng1)
    a = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * r * asin(sqrt(a))


def _median(values):
    return statistics.median(values) if values else None


def _covers(interval_start_ms, interval_end_ms, win_start_h, win_end_h, weekday_only=False):
    """停放区间是否与本地时间窗口 [win_start_h, win_end_h) 相交(任一本地日)。"""
    start, end = _local(interval_start_ms), _local(interval_end_ms)
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= end:
        if not weekday_only or day.weekday() < 5:
            lo = day.replace(hour=win_start_h)
            hi = day.replace(hour=win_end_h)
            if start < hi and end > lo:
                return True
        day += timedelta(days=1)
    return False


class _Cluster:
    __slots__ = ("lat", "lng", "n", "address_ids", "names", "visits", "nights", "days")

    def __init__(self, lat, lng):
        self.lat, self.lng, self.n = lat, lng, 0
        self.address_ids, self.names = set(), {}
        self.visits = self.nights = self.days = 0

    def add(self, lat, lng, address_id, name):
        self.n += 1
        self.lat += (lat - self.lat) / self.n   # 滚动质心
        self.lng += (lng - self.lng) / self.n
        if address_id is not None:
            self.address_ids.add(address_id)
        if name:
            self.names[name] = self.names.get(name, 0) + 1

    @property
    def label(self):
        return max(self.names, key=self.names.get) if self.names else "未知地点"


def _cluster_endpoints(drives):
    """按行程顺序贪心聚类全部端点,返回 (clusters, {drive_id: (start_idx, end_idx)})。"""
    clusters, of = [], {}

    def assign(lat, lng, address_id, name):
        for i, c in enumerate(clusters):
            if _dist_m(c.lat, c.lng, lat, lng) <= _CLUSTER_M:
                c.add(lat, lng, address_id, name)
                return i
        c = _Cluster(lat, lng)
        c.add(lat, lng, address_id, name)
        clusters.append(c)
        return len(clusters) - 1

    for d in drives:
        s = e = None
        if d["s_lat"] is not None:
            s = assign(float(d["s_lat"]), float(d["s_lng"]), d["start_address_id"], d["s_name"])
        if d["e_lat"] is not None:
            e = assign(float(d["e_lat"]), float(d["e_lng"]), d["end_address_id"], d["e_name"])
        of[d["id"]] = (s, e)
    return clusters, of


def _anchors(clusters, of, drives, override):
    """判定家/公司 cluster 下标;override = {"home": [addr_ids], "work": [addr_ids]}。"""
    for i in range(len(drives) - 1):
        _, e = of[drives[i]["id"]]
        s2, _ = of[drives[i + 1]["id"]]
        if e is None or e != s2:
            continue
        end_ms, start_ms = drives[i]["end_ts"], drives[i + 1]["start_ts"]
        if _covers(end_ms, start_ms, *_NIGHT):
            clusters[e].nights += 1
        if _covers(end_ms, start_ms, *_DAY, weekday_only=True):
            clusters[e].days += 1
    for s, e in of.values():
        if s is not None:
            clusters[s].visits += 1
        if e is not None:
            clusters[e].visits += 1

    def by_ids(ids):
        for i, c in enumerate(clusters):
            if c.address_ids & set(ids or []):
                return i
        return None

    def auto():
        if not clusters:
            return None, None
        h = max(range(len(clusters)), key=lambda i: (clusters[i].nights, clusters[i].visits))
        rest = [i for i in range(len(clusters)) if i != h]
        w = max(rest, key=lambda i: (clusters[i].days, clusters[i].visits)) if rest else None
        return h, w

    # 单边可空:该侧回退自动识别;纠正结果与自动撞车时保留自动的另一侧
    auto_home, auto_work = auto()
    overridden = bool(override.get("home") or override.get("work"))
    home = by_ids(override.get("home")) if override.get("home") else auto_home
    work = by_ids(override.get("work")) if override.get("work") else auto_work
    if home is not None and home == work:
        work = auto_work if auto_work != home else None
    return home, work, overridden


def _commute_model(drives, of, home, work):
    """通勤腿耗电/出发时刻(分方向)与家/公司停放掉电(km/h),全部取中位数。"""
    if home is None:
        return None
    legs = {"to_work": [], "to_home": []}
    dists = {"to_work": [], "to_home": []}
    departs = {"to_work": [], "to_home": []}
    durations = {"to_work": [], "to_home": []}
    pairs = {"to_work": (home, work), "to_home": (work, home)}
    candidates = []
    for d in drives:
        s, e = of[d["id"]]
        for direction, (a, b) in pairs.items():
            if b is not None and s == a and e == b and d["distance"]:
                candidates.append((direction, d))
    if not candidates:
        return None
    typical_km = _median([float(d["distance"]) for _, d in candidates])
    for direction, d in candidates:
        used = d["start_rated"] - d["end_rated"]
        # 排除特殊行程:距离偏离典型通勤太远,或续航差异常(顺路充过电等)
        if not (0.4 * typical_km <= float(d["distance"]) <= 2.5 * typical_km and 0 < used < typical_km * 2):
            continue
        legs[direction].append(used)
        dists[direction].append(float(d["distance"]))
        departs[direction].append(_local(d["start_ts"]).hour * 60 + _local(d["start_ts"]).minute)
        durations[direction].append((d["end_ts"] - d["start_ts"]) / 60000)

    drain = {"home": [], "work": []}
    anchor_of = {home: "home", work: "work"}
    for i in range(len(drives) - 1):
        _, e = of[drives[i]["id"]]
        s2, _ = of[drives[i + 1]["id"]]
        if e is None or e != s2 or e not in anchor_of:
            continue
        hours = (drives[i + 1]["start_ts"] - drives[i]["end_ts"]) / 3600000
        lost = drives[i]["end_rated"] - drives[i + 1]["start_rated"]
        if hours >= 1 and 0 < lost <= 2 * hours:   # 负值=中间充过电;>2km/h 视为异常
            drain[anchor_of[e]].append(lost / hours)

    return {
        "leg_km": {k: _median(v) for k, v in legs.items()},
        "leg_dist": {k: _median(v) for k, v in dists.items()},
        "depart_min": {k: _median(v) for k, v in departs.items()},
        "leg_min": {k: (_median(v) if v else 60) for k, v in durations.items()},
        "drain_km_h": {k: (_median(v) if v else 0.3) for k, v in drain.items()},
        "samples": sum(len(v) for v in legs.values()),
    }


def _parked_split(drives, of, home, work, positions, km_per_pct):
    """家/公司停放耗电拆分:哨兵(驻车清醒且非空调)vs 其他驻车耗电。

    positions: (ts_ms, battery_level, climate) 升序,仅覆盖清醒时段(休眠无上报)。
    间隙选取与 _commute_model 的 drain 口径一致;对每个间隙:
      清醒连续段(采样间隔 ≤ AWAKE_GAP_MS)中 ≥ SENTRY_MIN_DURATION_MS 且
      空调样本 <30% 的判为哨兵段,段内电量%降幅 ÷ 哨兵小时 = 哨兵 %/h 速率;
      哨兵耗电 km = 速率 × 哨兵小时 × km_per_pct(封顶为该间隙总损失),
      其余损失归「其他驻车耗电」(休眠掉电 + 空调等)。
    返回 {anchor: {sentry_rate, base_rate, sentry_share}};数据不足返回 None。
    """
    if not positions or not km_per_pct:
        return None
    main = _m()
    ts_list = [p[0] for p in positions]
    anchor_of = {home: "home", work: "work"}
    intervals = {"home": [], "work": []}
    for i in range(len(drives) - 1):
        _, e = of[drives[i]["id"]]
        s2, _ = of[drives[i + 1]["id"]]
        if e is None or e != s2 or e not in anchor_of:
            continue
        hours = (drives[i + 1]["start_ts"] - drives[i]["end_ts"]) / 3600000
        lost = drives[i]["end_rated"] - drives[i + 1]["start_rated"]
        if hours >= 1 and 0 < lost <= 2 * hours:
            intervals[anchor_of[e]].append(
                (drives[i]["end_ts"], drives[i + 1]["start_ts"], hours, lost))

    out = {}
    for key, ivs in intervals.items():
        if not ivs:
            continue
        per = []           # 每间隙 (哨兵分钟, 小时数, 损失 km)
        sentry_drop = 0.0  # 哨兵段内电量%降幅合计
        had_samples = False
        for a_ms, b_ms, hours, lost in ivs:
            lo = bisect.bisect_left(ts_list, a_ms)
            hi = bisect.bisect_right(ts_list, b_ms)
            samples = positions[lo:hi]
            sentry_min = 0.0
            if samples:
                had_samples = True
                runs, run = [], [samples[0]]
                for s in samples[1:]:
                    if s[0] - run[-1][0] > main.AWAKE_GAP_MS:
                        runs.append(run)
                        run = [s]
                    else:
                        run.append(s)
                runs.append(run)
                for r in runs:
                    dur = r[-1][0] - r[0][0]
                    if dur < main.SENTRY_MIN_DURATION_MS:
                        continue
                    if sum(1 for s in r if s[2]) / len(r) >= 0.3:
                        continue          # 空调段不算哨兵
                    sentry_min += dur / 60000
                    sentry_drop += max(0.0, r[0][1] - r[-1][1])
            per.append((sentry_min, hours, lost))
        if not had_samples:
            continue
        sentry_h_total = sum(p[0] for p in per) / 60
        pct_rate = sentry_drop / sentry_h_total if sentry_h_total > 0 else 0.0
        sentry_km = idle_km = total_h = 0.0
        for sentry_min, hours, lost in per:
            s_h = sentry_min / 60
            s_km = min(lost, pct_rate * s_h * km_per_pct)
            sentry_km += s_km
            idle_km += lost - s_km
            total_h += hours
        idle_h = max(0.0, total_h - sentry_h_total)
        out[key] = {
            "sentry_rate": sentry_km / sentry_h_total if sentry_h_total > 0 else 0.0,
            "base_rate": idle_km / idle_h if idle_h > 0 else 0.0,
            "sentry_share": min(1.0, max(0.0, sentry_h_total / total_h)) if total_h > 0 else 0.0,
        }
    return out or None


def _simulate(now_ms, start_range, start_loc, model, home, work, threshold_km):
    """从当前续航逐事件推演,找出必须充电的时机:

    - 若某趟通勤腿跑完后续航会跌破 threshold_km,则必须在这趟出发前充电
      → {"kind": "before_leg", "charge_at": 出发地, "charge_by_ms": 出发时刻, "next_leg": 方向}
    - 若停放掉电本身会先跌破阈值(等不到下一趟)
      → {"kind": "parked", "charge_at": 当前地点, "charge_by_ms": 跌破时刻, "next_leg": None}
    返回 (outcome, events):outcome 为 None 表示推演窗口(_HORIZON_DAYS)内无需充电;
    events 为逐趟推测行程 [{ts, direction, leg_km, parked_km, sentry_km, idle_km,
    parked_h, dist_km, remain_km}],direction 为 None 表示该事件是纯停放掉电跌破
    阈值(无通勤腿);sentry_km/idle_km 为 None 表示停放耗电未能拆分(回退单一速率)。
    """
    def parked_outcome(loc, t):
        return {"kind": "parked", "charge_at": loc, "charge_by_ms": t, "next_leg": None}

    if model["leg_km"]["to_work"] is None or model["leg_km"]["to_home"] is None \
            or model["depart_min"]["to_work"] is None or model["depart_min"]["to_home"] is None \
            or work is None:
        # 只有一个锚点:没有通勤腿,仅按停放掉电线性推演
        daily = model["drain_km_h"]["home"] * 24
        if daily <= 0:
            return None, []
        days = (start_range - threshold_km) / daily
        if days > _HORIZON_DAYS:
            return None, []
        return parked_outcome("home", now_ms + max(0, days) * 86400000), []

    if start_range <= threshold_km:
        return {"kind": "now", "charge_at": start_loc, "charge_by_ms": now_ms, "next_leg": None}, []
    loc, rng, t = start_loc, start_range, now_ms
    legs = {"home": ("to_work", "work"), "work": ("to_home", "home")}
    end = now_ms + _HORIZON_DAYS * 86400000
    events = []
    for _ in range(_HORIZON_DAYS * 2 + 2):
        direction, dest = legs[loc]
        dep = model["depart_min"][direction]
        day = _local(t).replace(hour=0, minute=0, second=0, microsecond=0)
        leave = day + timedelta(minutes=dep)
        if leave.timestamp() * 1000 <= t:
            leave += timedelta(days=1)
        leave_ms = leave.timestamp() * 1000
        # 停放掉电:有拆分时按 哨兵时间占比×哨兵速率 + 其余×基础速率 推算
        span_h = (leave_ms - t) / 3600000
        split = (model.get("parked_split") or {}).get(loc)
        if split:
            sentry_h = span_h * split["sentry_share"]
            sentry_km = sentry_h * split["sentry_rate"]
            idle_km = (span_h - sentry_h) * split["base_rate"]
            parked_km = sentry_km + idle_km
        else:
            sentry_h = None
            sentry_km = idle_km = None
            parked_km = model["drain_km_h"][loc] * span_h
        # 停放期间跌破阈值:等不到这趟出发就得充
        if parked_km > 0 and rng - parked_km <= threshold_km:
            frac = (rng - threshold_km) / parked_km
            cross = t + frac * span_h * 3600000
            events.append({"ts": cross, "direction": None,
                           "leg_km": 0, "parked_km": rng - threshold_km,
                           "sentry_km": sentry_km * frac if split else None,
                           "idle_km": idle_km * frac if split else None,
                           "sentry_h": sentry_h * frac if split else None,
                           "parked_h": span_h * frac,
                           "remain_km": threshold_km})
            return parked_outcome(loc, cross), events
        rng -= parked_km                                        # 停放掉电
        leg_km = model["leg_km"][direction]
        events.append({"ts": leave_ms, "direction": direction,
                       "leg_km": leg_km, "parked_km": parked_km,
                       "sentry_km": sentry_km, "idle_km": idle_km,
                       "sentry_h": sentry_h,
                       "parked_h": span_h,
                       "dist_km": model["leg_dist"].get(direction),
                       "remain_km": rng - leg_km})
        if rng - leg_km <= threshold_km:
            # 这趟跑完就跌破阈值 → 必须在上一趟行程结束(到达本地)后充电
            return {"kind": "before_leg", "charge_at": loc,
                    "charge_by_ms": t, "next_leg": direction}, events
        rng -= leg_km                                           # 通勤腿
        loc, t = dest, leave_ms + model["leg_min"][direction] * 60000   # 行程时长取中位数
        if t >= end:
            break
    return None, events


def _threshold(model):
    legs = [v for v in (model["leg_km"]["to_work"], model["leg_km"]["to_home"]) if v]
    return max(_MIN_RANGE_FLOOR_KM, 1.5 * max(legs)) if legs else _MIN_RANGE_FLOOR_KM


def _cluster_view(i, clusters):
    if i is None:
        return None
    c = clusters[i]
    return {"label": c.label, "address_ids": sorted(c.address_ids),
            "visits": c.visits, "nights": c.nights, "days": c.days}


def _charger_near(cluster, charges, chargers):
    """anchor 附近历史充电最多的地点;没有则回退到全局最常充的桩。
    名称优先取充电桩档案(panel_manual kind='charger')。"""
    if not charges:
        return None
    counts = {}
    for ch in charges:
        if ch["address_id"] is not None:
            counts[ch["address_id"]] = counts.get(ch["address_id"], 0) + 1
    if not counts:
        return None
    main = _m()

    def view(address_id, near):
        ch = next(c for c in charges if c["address_id"] == address_id)
        saved = chargers.get(main._loc_key(address_id, None)) or {}
        return {"name": saved.get("name") or ch["name"] or "该地点充电桩",
                "location": saved.get("location") or "", "times": counts[address_id],
                "near_anchor": near}

    if cluster is not None:
        near = [(aid, n) for (aid, n) in counts.items()
                if any(c["address_id"] == aid and c["lat"] is not None and
                       _dist_m(cluster.lat, cluster.lng, float(c["lat"]), float(c["lng"])) <= _CHARGER_NEAR_M
                       for c in charges)]
        if near:
            return view(max(near, key=lambda x: x[1])[0], True)
    return view(max(counts, key=counts.get), False)


@router.get("/reminder")
def reminder(car_id: int | None = None):
    main = _m()
    cid = main.get_car_id(car_id)
    drives = [
        {**r, "distance": float(r["distance"] or 0),
         "start_rated": float(r["start_rated_range_km"] or 0),
         "end_rated": float(r["end_rated_range_km"] or 0),
         "start_ts": float(r["start_ts"]), "end_ts": float(r["end_ts"])}
        for r in main.q(
            """
            SELECT d.id, d.distance, d.start_address_id, d.end_address_id,
                   d.start_rated_range_km, d.end_rated_range_km,
                   EXTRACT(EPOCH FROM d.start_date) * 1000 AS start_ts,
                   EXTRACT(EPOCH FROM d.end_date) * 1000 AS end_ts,
                   sa.latitude AS s_lat, sa.longitude AS s_lng,
                   COALESCE(sa.name, sa.display_name) AS s_name,
                   ea.latitude AS e_lat, ea.longitude AS e_lng,
                   COALESCE(ea.name, ea.display_name) AS e_name
            FROM drives d
            LEFT JOIN addresses sa ON sa.id = d.start_address_id
            LEFT JOIN addresses ea ON ea.id = d.end_address_id
            WHERE d.car_id = %s AND d.end_date IS NOT NULL
              AND d.start_date > now() - interval '90 days'
            ORDER BY d.start_date
            """,
            (cid,),
        )
    ]
    charges = main.q(
        """
        SELECT cp.address_id, a.latitude AS lat, a.longitude AS lng,
               COALESCE(a.name, a.display_name) AS name
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        WHERE cp.car_id = %s AND cp.start_date > now() - interval '180 days'
        """,
        (cid,),
    )
    latest = main.q(
        """
        SELECT battery_level, rated_battery_range_km
        FROM positions WHERE car_id = %s AND rated_battery_range_km IS NOT NULL
        ORDER BY date DESC LIMIT 1
        """,
        (cid,),
    )
    # 清醒时段电量采样(按分钟聚合降压,只看驻车样本——拆分只需间隙内的数据,
    # 行驶样本反正会被间隙 bisect 排除),用于停放耗电的哨兵/其他拆分
    positions = [
        (float(r["ts"]), float(r["lvl"]), bool(r["climate"]))
        for r in main.q(
            """
            SELECT EXTRACT(EPOCH FROM date_trunc('minute', date)) * 1000 AS ts,
                   AVG(battery_level) AS lvl,
                   BOOL_OR(COALESCE(is_climate_on, false)) AS climate
            FROM positions
            WHERE car_id = %s AND date > now() - interval '90 days'
              AND battery_level IS NOT NULL
              AND (speed IS NULL OR speed = 0)
            GROUP BY 1 ORDER BY 1
            """,
            (cid,),
        )
    ]

    override = main._manual_all("anchors").get("places") or {}
    saved_cfg = main._manual_all("settings").get("reminder") or {}
    try:
        min_pct = int(saved_cfg.get("min_pct", _DEFAULT_MIN_PCT))
    except (TypeError, ValueError):
        min_pct = _DEFAULT_MIN_PCT
    min_pct = max(5, min(50, min_pct))
    clusters, of = _cluster_endpoints(drives)
    home, work, overridden = _anchors(clusters, of, drives, override)
    candidates = sorted(
        ({"key": i, **_cluster_view(i, clusters)} for i in range(len(clusters))),
        key=lambda c: -c["visits"])
    result = {"ready": False, "overridden": overridden,
              "home": _cluster_view(home, clusters), "work": _cluster_view(work, clusters),
              "candidates": candidates}
    if home is None:
        result["reason"] = "暂无足够行程数据识别常用地点"
        return result

    model = _commute_model(drives, of, home, work)
    if model is None or model["samples"] < _MIN_LEGS \
            or len([1 for v in model["leg_km"].values() if v]) < 2 \
            or work is None or home == work:
        result["reason"] = (f"家⇄公司通勤样本不足(需 ≥{_MIN_LEGS} 趟,"
                            f"当前 {model['samples'] if model else 0} 趟),继续积累行程数据"
                            if work is not None else "只识别到一个常用地点,暂无法推算通勤")
        return result

    if latest and latest[0]["rated_battery_range_km"] is not None:
        current_range = float(latest[0]["rated_battery_range_km"])
    elif latest and latest[0]["battery_level"] is not None:
        # 缺少 rated 续航时按校准系数由表显电量折算
        current_range = float(latest[0]["battery_level"]) * main.kwh_per_pct(cid) / main.kwh_per_ideal_km(cid)
    else:
        result["reason"] = "无法读取当前续航,请等待车辆数据同步"
        return result

    # 阈值:表显电量百分比 × 当前满电续航(由最新 rated 续航 ÷ 表显电量推算,随电池衰减自适应)
    battery_pct = float(latest[0]["battery_level"]) if latest and latest[0]["battery_level"] else None
    full_range = None
    if battery_pct and battery_pct > 0:
        full_range = current_range / (battery_pct / 100)
        threshold_km = full_range * (min_pct / 100)
    else:
        threshold_km = _threshold(model)   # 读不到表显电量时退回续航公里数阈值

    # 停放耗电拆分(哨兵 vs 其他驻车耗电);拆不出时回退单一 drain 速率
    km_per_pct = full_range / 100 if full_range else None
    model["parked_split"] = _parked_split(drives, of, home, work, positions, km_per_pct)

    last_loc = of[drives[-1]["id"]][1] if drives else None
    start_loc = "home" if last_loc in (None, home) else ("work" if last_loc == work else "home")
    now_ms = datetime.now(_tz()).timestamp() * 1000
    outcome, events = _simulate(now_ms, current_range, start_loc, model, home, work, threshold_km)

    # 逐趟推测行程明细(前端折叠展示);续航 km 同时按满电续航折算成表显 %
    projection = []
    for ev in events[:60]:
        item = {"ts": int(ev["ts"]), "direction": ev["direction"],
                "leg_km": round(ev["leg_km"], 1), "parked_km": round(ev["parked_km"], 1),
                "parked_h": round(ev.get("parked_h") or 0, 1),
                "remain_km": round(ev["remain_km"], 1)}
        if ev.get("dist_km") is not None:
            item["dist_km"] = round(ev["dist_km"], 1)
        if ev.get("sentry_km") is not None:
            item["sentry_km"] = round(ev["sentry_km"], 1)
            item["idle_km"] = round(ev["idle_km"], 1)
            item["sentry_h"] = round(ev.get("sentry_h") or 0, 1)
            item["idle_h"] = round((ev.get("parked_h") or 0) - (ev.get("sentry_h") or 0), 1)
        if full_range:
            item["remain_pct"] = round(ev["remain_km"] / full_range * 100)
            item["leg_pct"] = round(ev["leg_km"] / full_range * 100, 1)
            item["parked_pct"] = round(ev["parked_km"] / full_range * 100, 1)
            if ev.get("sentry_km") is not None:
                item["sentry_pct"] = round(ev["sentry_km"] / full_range * 100, 1)
                item["idle_pct"] = round(ev["idle_km"] / full_range * 100, 1)
        projection.append(item)

    if outcome is None:
        result.update(ready=True, days_left=None, min_pct=min_pct, projection=projection,
                      reason=f"当前续航约 {round(current_range)} km,未来 {_HORIZON_DAYS} 天内不会低于 {min_pct}%")
        return result

    charge_by_ms, charge_at = outcome["charge_by_ms"], outcome["charge_at"]
    anchor_cluster = clusters[home if charge_at == "home" else work]
    charger = _charger_near(anchor_cluster, charges, main._manual_all("charger"))
    result.update(
        ready=True,
        current_range_km=round(current_range, 1),
        battery_pct=round(battery_pct) if battery_pct else None,
        current_loc=("home" if last_loc == home else "work" if last_loc == work else None),
        min_pct=min_pct,
        threshold_km=round(threshold_km, 1),
        days_left=round(max(0, (charge_by_ms - now_ms) / 86400000), 1),
        charge_by_ts=int(charge_by_ms),
        charge_at=charge_at,
        charge_kind=outcome["kind"],
        next_leg=outcome["next_leg"],
        charge_place=("家" if charge_at == "home" else "公司") + " · " + anchor_cluster.label,
        charger=charger,
        leg_km={k: round(v, 1) for k, v in model["leg_km"].items()},
        drain_km_day={k: round(v * 24, 1) for k, v in model["drain_km_h"].items()},
        sample_legs=model["samples"],
        projection=projection,
        reason="",
    )
    return result


class ReminderConfigIn(BaseModel):
    min_pct: int          # 提醒的最低表显电量 5–50%


@router.post("/reminder-config")
def set_reminder_config(body: ReminderConfigIn, request: Request):
    main = _m()
    main.require_admin(request)
    if not (5 <= body.min_pct <= 50):
        raise HTTPException(status_code=422, detail="最低电量需在 5–50% 之间")
    main._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES ('settings', 'reminder', %s)
        ON CONFLICT (kind, key) DO UPDATE
          SET payload = EXCLUDED.payload, updated_at = now()
        """,
        (Jsonb({"min_pct": body.min_pct}),),
    )
    return {"ok": True, "min_pct": body.min_pct}


class AnchorsIn(BaseModel):
    home: list[int] = []   # 家聚类包含的 address_id;空 = 恢复自动识别
    work: list[int] = []


@router.post("/anchors")
def set_anchors(body: AnchorsIn, request: Request):
    main = _m()
    main.require_admin(request)
    if len(body.home) > 50 or len(body.work) > 50 or \
            any(not isinstance(i, int) or i < 0 for i in body.home + body.work):
        raise HTTPException(status_code=422, detail="地点参数无效")
    if set(body.home) & set(body.work):
        raise HTTPException(status_code=422, detail="家和公司不能是同一地点")
    main._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES ('anchors', 'places', %s)
        ON CONFLICT (kind, key) DO UPDATE
          SET payload = EXCLUDED.payload, updated_at = now()
        """,
        (Jsonb({"home": sorted(set(body.home)), "work": sorted(set(body.work))}),),
    )
    return {"ok": True}
