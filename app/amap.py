"""导航:高德 Web 服务代理 + 服务端 key 存储。

key 存 panel_manual(kind='settings', key='amap'),随库备份走,绝不进仓库、
不下发到浏览器——所有高德调用都在服务端完成,前端只拿结果。
个人中心提供粘贴入口(仅 admin 可写,GET 只回掩码尾号)。

接口:
- GET  /api/nav/config            {has_key, key_tail}
- POST /api/nav/config            {web_key}  admin;空串=清除
- GET  /api/nav/tips?keywords=    输入提示(目的地/途经路搜索)
- POST /api/nav/route             {origin, destination, waypoints[]} 驾车路径
- GET  /api/nav/along?polyline=&kind=  沿途搜索(服务区 / 特斯拉超充)
"""
import json
import urllib.parse
import urllib.request

from fastapi import APIRouter, HTTPException, Query, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/nav", tags=["nav"])

_KIND = "settings"
_KEY = "amap"
_API = "https://restapi.amap.com"


def _m():
    """延迟引用 main(避免循环导入)。"""
    from . import main
    return main


# ---------- key 存储 ----------

def get_key() -> str:
    row = _m()._manual_all(_KIND).get(_KEY) or {}
    return str(row.get("web_key") or "").strip()


@router.get("/config")
def nav_config():
    key = get_key()
    return {"has_key": bool(key), "key_tail": ("…" + key[-4:]) if key else None}


class ConfigIn(BaseModel):
    web_key: str = ""


@router.post("/config")
def set_config(payload: ConfigIn, request: Request):
    _m().require_admin(request)
    key = payload.web_key.strip()
    if key and not all(ch.isalnum() for ch in key):
        raise HTTPException(status_code=422, detail="key 应只含字母和数字")
    _m()._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES (%s, %s, %s)
        ON CONFLICT (kind, key) DO UPDATE SET payload = EXCLUDED.payload
        """,
        (_KIND, _KEY, Jsonb({"web_key": key})),
    )
    return {"ok": True, **nav_config()}


# ---------- 高德调用 ----------

def _call(path: str, params: dict) -> dict:
    key = get_key()
    if not key:
        raise HTTPException(status_code=503,
                            detail="未配置高德 key,请先在个人中心「导航服务」粘贴")
    qs = urllib.parse.urlencode({**params, "key": key})
    url = f"{_API}{path}?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        raise HTTPException(status_code=502, detail="高德服务连接失败")
    if str(data.get("status")) != "1":
        info = str(data.get("info") or "未知错误")
        code = str(data.get("infocode") or "")
        raise HTTPException(status_code=502, detail=f"高德返回错误:{info}({code})")
    return data


# ---------- 输入提示 ----------

@router.get("/tips")
def tips(keywords: str = Query(min_length=1, max_length=50)):
    """目的地/途经路输入提示;只回前端需要的字段。"""
    data = _call("/v3/assistant/inputtips", {
        "keywords": keywords, "datatype": "all", "citylimit": "false"})
    out = []
    for t in data.get("tips") or []:
        loc = t.get("location")
        if not loc or not isinstance(loc, str) or "," not in loc:
            continue  # 无坐标的提示(纯行政区等)无法规划,跳过
        out.append({
            "name": str(t.get("name") or ""),
            "district": str(t.get("district") or ""),
            "address": str(t.get("address") or "") if isinstance(t.get("address"), str) else "",
            "location": loc,  # "lng,lat"(高德坐标)
        })
    return {"tips": out[:10]}


# ---------- 路径规划 ----------

class RouteIn(BaseModel):
    origin: str          # "lng,lat"
    destination: str     # "lng,lat"
    waypoints: list[str] = Field(default_factory=list, max_length=16)


def _parse_path(p: dict) -> dict | None:
    """v5 driving 单条方案 → 前端结构(polyline 解码为 [[lng,lat],…])。
    v5 的整段 polyline 只在 show_fields 命中时返回,且通常为空;
    可靠来源是逐 step 的 polyline,拼接去重。"""
    poly = p.get("polyline")
    if not poly:
        parts = [str(s.get("polyline") or "")
                 for s in p.get("steps") or [] if isinstance(s, dict)]
        poly = ";".join(x for x in parts if x)
    if not poly:
        return None
    pts = []
    for pair in str(poly).split(";"):
        try:
            lng, lat = pair.split(",")
            pts.append([round(float(lng), 6), round(float(lat), 6)])
        except ValueError:
            continue
    if len(pts) < 2:
        return None
    cost = p.get("cost") or {}
    try:
        duration_min = round(float(cost.get("duration", 0)) / 60)
    except (TypeError, ValueError):
        duration_min = None
    return {
        "distance_km": round(float(p.get("distance") or 0) / 1000, 1),
        "duration_min": duration_min,
        "tolls_yuan": float(cost.get("tolls") or 0),
        "polyline": pts,
    }


@router.post("/route")
def route(payload: RouteIn):
    """驾车路径规划,返回至多 3 条备选方案。"""
    params = {
        "origin": payload.origin,
        "destination": payload.destination,
        "strategy": 0,             # 速度优先;备选方案由 show_fields 无法控制,高德默认返多条
        "show_fields": "cost,polyline",
    }
    if payload.waypoints:
        params["waypoints"] = ";".join(payload.waypoints[:16])
    data = _call("/v5/direction/driving", params)
    paths = []
    for p in (data.get("route") or {}).get("paths") or []:
        parsed = _parse_path(p)
        if parsed:
            paths.append(parsed)
    if not paths:
        raise HTTPException(status_code=404, detail="没有可行的驾车路线")
    return {"paths": paths[:3]}


# ---------- 沿途搜索(服务区 / 特斯拉超充) ----------

_KINDS = {
    "service": "服务区",          # 高速服务区
    "supercharger": "特斯拉超级充电站",
}


def _sample_points(pts: list[list[float]], step_km: float) -> list[list[float]]:
    """沿折线按里程等距抽样(haversine 近似),首尾必含。"""
    if not pts:
        return []
    import math

    def dist(a, b):
        r = 6371.0
        p1, p2 = math.radians(a[1]), math.radians(b[1])
        dp, dl = p2 - p1, math.radians(b[0] - a[0])
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.asin(math.sqrt(h))

    out = [pts[0]]
    acc = 0.0
    for i in range(1, len(pts)):
        acc += dist(pts[i - 1], pts[i])
        if acc >= step_km:
            out.append(pts[i])
            acc = 0.0
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    return out


@router.get("/along")
def along(polyline: str = Query(min_length=5), kind: str = Query(default="service")):
    """沿途搜索:polyline 为 "lng,lat;lng,lat;…"(同高德原始格式)。
    按 ~40km 抽样做周边搜索,按 POI id 去重,返回沿线候选。"""
    if kind not in _KINDS:
        raise HTTPException(status_code=422, detail=f"kind 仅支持 {'/'.join(_KINDS)}")
    pts = []
    for pair in polyline.split(";"):
        try:
            lng, lat = pair.split(",")
            pts.append([float(lng), float(lat)])
        except ValueError:
            continue
    if len(pts) < 2:
        raise HTTPException(status_code=422, detail="polyline 至少需要两个点")
    radius = "20000" if kind == "service" else "30000"  # 超充稀少,搜索半径放宽
    seen: dict[str, dict] = {}
    for lng, lat in _sample_points(pts, 40):
        try:
            data = _call("/v3/place/around", {
                "location": f"{lng},{lat}", "keywords": _KINDS[kind],
                "radius": radius, "offset": 20, "page": 1,
            })
        except HTTPException:
            continue  # 单个采样点失败不拖垮整体
        for poi in data.get("pois") or []:
            pid = str(poi.get("id") or "")
            name = str(poi.get("name") or "")
            loc = poi.get("location")
            if not pid or not loc or pid in seen:
                continue
            # 关键词搜索会混入不相关 POI,名字须命中
            must = "服务区" if kind == "service" else "特斯拉"
            if must not in name:
                continue
            seen[pid] = {"id": pid, "name": name, "location": loc,
                         "address": str(poi.get("address") or "")
                         if isinstance(poi.get("address"), str) else ""}
    return {"kind": kind, "pois": list(seen.values())[:100]}
