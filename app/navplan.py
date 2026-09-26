"""导航能耗规划:按本车历史能耗推算路线 SOC 曲线,10% 电量区间带 + 超充停靠规划。

纯计算函数与 HTTP 解耦,便于测试;POI 沿途搜索复用 amap 模块。
"""
import math

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/nav", tags=["nav"])

BAND_STEP = 10          # 电量区间粒度(%)
DEFAULT_RESERVE = 10    # 行驶保底 SOC(%):低于此不规划驾驶
DEFAULT_DEPART = 80     # 默认充到多少走
DEFAULT_ARRIVAL = 20    # 默认到达目的地至少剩多少
FALLBACK_KWH_PER_KM = 0.15


def _m():
    from . import main
    return main


def haversine(a: list[float], b: list[float]) -> float:
    r = 6371.0
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def cumulative_km(pts: list[list[float]]) -> list[float]:
    """折线各点的累计里程(km)。"""
    out = [0.0]
    for i in range(1, len(pts)):
        out.append(out[-1] + haversine(pts[i - 1], pts[i]))
    return out


def energy_per_km(car_id: int) -> float:
    """近 30 天行程的平均墙端等效能耗(kWh/km),样本不足用默认 0.15。"""
    kwh_per_ideal = _m().kwh_per_ideal_km(car_id)
    rows = _m().q(
        """
        SELECT sum(distance) AS km,
               sum(start_ideal_range_km - end_ideal_range_km) AS rng_km
        FROM drives
        WHERE car_id = %s AND start_date > now() - interval '30 days'
          AND distance > 5
        """,
        (car_id,),
    )
    if rows and rows[0]["km"] and rows[0]["rng_km"]:
        km, rng = float(rows[0]["km"]), float(rows[0]["rng_km"])
        if km > 20 and rng > 0:
            return rng * kwh_per_ideal / km
    return FALLBACK_KWH_PER_KM


def soc_profile(cum: list[float], e: float, kwh_per_pct: float,
                start_soc: float) -> list[float]:
    """直行不充电时各点 SOC。"""
    return [start_soc - e * d / kwh_per_pct for d in cum]


def build_bands(pts: list[list[float]], soc: list[float],
                stops_at: dict[int, float] | None = None) -> list[dict]:
    """把路线按 SOC 切成 10% 区间带;stops_at={点索引: 充后 SOC} 处电量跳变。
    返回 [{soc_hi, soc_lo, pts:[[lng,lat],…]}],soc_hi 为该带上沿。"""
    stops_at = stops_at or {}
    bands: list[dict] = []
    cur_hi = math.ceil(soc[0] / BAND_STEP) * BAND_STEP
    cur_pts = [pts[0]]

    def soc_at(i: int) -> float:
        return stops_at.get(i, soc[i]) if i in stops_at else soc[i]

    eff = [soc[0]]
    for i in range(1, len(pts)):
        prev, nxt = soc_at(i - 1), soc_at(i)
        if i in stops_at:  # 充电跳变:先收尾当前带,再从新高电量开新带
            cur_pts.append(pts[i])
            bands.append({"soc_hi": cur_hi, "soc_lo": cur_hi - BAND_STEP, "pts": cur_pts})
            cur_hi = math.ceil(nxt / BAND_STEP) * BAND_STEP
            cur_pts = [pts[i]]
        # 区间内可能跨过多个 10% 边界(大坡/长直路),逐个切开;
        # prev 恰好落在边界上(取整导致)也算跨越,否则会永久错过该带
        while nxt < cur_hi - BAND_STEP and prev >= cur_hi - BAND_STEP:
            boundary = cur_hi - BAND_STEP
            frac = (prev - boundary) / (prev - nxt) if prev != nxt else 0
            mid = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * frac,
                   pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * frac]
            cur_pts.append(mid)
            bands.append({"soc_hi": cur_hi, "soc_lo": boundary, "pts": cur_pts})
            cur_hi = boundary
            cur_pts = [mid]
        cur_pts.append(pts[i])
    bands.append({"soc_hi": cur_hi, "soc_lo": cur_hi - BAND_STEP, "pts": cur_pts})
    # 丢弃 SOC 已低于 0 的尾部(不可达段,前端用灰色画)
    return bands


def chargers_on_route(chargers: list[dict], pts: list[list[float]],
                      cum: list[float], max_off_km: float = 5.0) -> list[dict]:
    """把充电站投影到路线上:最近点索引 + 路线里程;偏离路线太远的丢弃。
    返回按 at_km 升序的 [{...,pt_idx,at_km}]。"""
    out = []
    for c in chargers:
        try:
            lng, lat = (float(x) for x in str(c["location"]).split(","))
        except (ValueError, KeyError):
            continue
        best_i, best_d = -1, max_off_km
        step = max(1, len(pts) // 800)  # 长路线抽稀匹配,够用且快
        for i in range(0, len(pts), step):
            d = haversine([lng, lat], pts[i])
            if d < best_d:
                best_i, best_d = i, d
        if best_i >= 0:
            out.append({**c, "pt_idx": best_i, "at_km": round(cum[best_i], 1)})
    out.sort(key=lambda c: c["at_km"])
    return out


def plan_stops_on_route(cum: list[float], start_soc: float,
                        chargers: list[dict], kwh_per_pct: float, e: float,
                        reserve: float, depart_soc: float, arrival_min: float,
                        targets: dict[str, float] | None = None) -> tuple[list[dict], float, bool]:
    """贪心规划。返回 (stops, arrival_soc, reachable)。
    - 每站到达 SOC 不得低于 reserve;充到 depart_soc(或 targets[id])走
    - 选站策略:当前电量可达范围内的最远站(最少停站)
    - 直达可行(到达 >= arrival_min)则不停站"""
    targets = targets or {}
    total_km = cum[-1]

    def range_km(soc: float) -> float:
        return max(0.0, (soc - reserve) * kwh_per_pct / e)

    arrival_direct = start_soc - e * total_km / kwh_per_pct
    if arrival_direct >= arrival_min:
        return [], arrival_direct, True

    stops: list[dict] = []
    pos_km, soc = 0.0, start_soc
    guard = 0
    while guard < 20:
        guard += 1
        remain_km = total_km - pos_km
        if soc - e * remain_km / kwh_per_pct >= arrival_min:
            return stops, soc - e * remain_km / kwh_per_pct, True
        reach = range_km(soc)
        # 可达站:在 (pos_km, pos_km+reach] 内
        candidates = [c for c in chargers
                      if pos_km + 0.5 < c["at_km"] <= pos_km + reach]
        if not candidates:
            return stops, soc - e * remain_km / kwh_per_pct, False
        nxt = candidates[-1]  # 最远可达
        arrive = soc - e * (nxt["at_km"] - pos_km) / kwh_per_pct
        if arrive < reserve:
            return stops, arrive, False
        # 充多少:用户指定优先;否则「刚好够到终点+3% 缓冲」,封顶 depart_soc
        # (时间最优,长途不用每站都充满;想要更高电量可手动调 depart_soc/单站目标)
        need = arrival_min + e * (total_km - nxt["at_km"]) / kwh_per_pct + 3
        dep = targets.get(str(nxt.get("id"))) or min(depart_soc, max(need, arrive + 5))
        dep = round(max(arrive + 5, min(100, dep)), 1)
        stops.append({"id": str(nxt.get("id")), "name": nxt.get("name"),
                      "location": nxt.get("location"), "at_km": nxt["at_km"],
                      "arrive_soc": round(arrive, 1), "depart_soc": dep})
        pos_km, soc = nxt["at_km"], dep
    return stops, 0.0, False


class PlanIn(BaseModel):
    polyline: str = Field(min_length=5)   # "lng,lat;…"(高德原始格式)
    start_soc: float = Field(ge=1, le=100)
    arrival_soc: float = Field(default=DEFAULT_ARRIVAL, ge=0, le=100)
    depart_soc: float = Field(default=DEFAULT_DEPART, ge=20, le=100)
    reserve_soc: float = Field(default=DEFAULT_RESERVE, ge=0, le=50)
    stop_targets: dict[str, float] = Field(default_factory=dict)


@router.post("/plan")
def plan(payload: PlanIn):
    """路线能耗规划:10% SOC 区间带 + 超充停靠建议(含每站到达/出发电量)。"""
    from . import amap
    pts = []
    for pair in payload.polyline.split(";"):
        try:
            lng, lat = pair.split(",")
            pts.append([float(lng), float(lat)])
        except ValueError:
            continue
    if len(pts) < 2:
        raise HTTPException(status_code=422, detail="polyline 至少需要两个点")
    cid = _m().get_car_id(None)
    e = energy_per_km(cid)
    kwh_per_pct = _m().kwh_per_pct(cid)
    cum = cumulative_km(pts)

    # 沿途特斯拉超充(复用 amap 沿途搜索,失败时按无站处理)
    try:
        chargers = amap.along(polyline=payload.polyline, kind="supercharger")["pois"]
    except HTTPException:
        chargers = []
    on_route = chargers_on_route(chargers, pts, cum, max_off_km=8.0)

    stops, arrival, reachable = plan_stops_on_route(
        cum, payload.start_soc, on_route, kwh_per_pct, e,
        payload.reserve_soc, payload.depart_soc, payload.arrival_soc,
        payload.stop_targets)

    # 含停站的 SOC 曲线(停站点跳变),再切区间带
    soc = soc_profile(cum, e, kwh_per_pct, payload.start_soc)
    stops_at = {}
    if stops:
        # 重算:每站之间用充后电量出发
        soc = []
        cur_soc, prev_km = payload.start_soc, 0.0
        stop_by_km = {s["at_km"]: s for s in stops}
        stop_iter = iter(sorted(stop_by_km))
        next_stop = next(stop_iter, None)
        for d in cum:
            if next_stop is not None and d >= next_stop - 1e-9:
                s = stop_by_km[next_stop]
                soc.append(s["arrive_soc"])
                cur_soc, prev_km = s["depart_soc"], next_stop
                idx = len(soc) - 1
                stops_at[idx] = s["depart_soc"]
                next_stop = next(stop_iter, None)
            else:
                # 不取整:连续点差值极小,取整会让 prev 恰好压在 10% 边界上
                soc.append(cur_soc - e * (d - prev_km) / kwh_per_pct)
    bands = build_bands(pts, soc, stops_at)

    return {
        "total_km": round(cum[-1], 1),
        "kwh_per_km": round(e, 3),
        "arrival_soc_direct": round(
            payload.start_soc - e * cum[-1] / kwh_per_pct, 1),
        "arrival_soc": round(arrival, 1),
        "reachable": reachable,
        "stops": stops,
        "bands": bands,
        "chargers_found": len(on_route),
    }
