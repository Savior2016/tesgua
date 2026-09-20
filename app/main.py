"""TeslaMate 遥测可视化面板后端.

只读访问 TeslaMate 的 PostgreSQL 数据库,提供 JSON API。
所有时间戳在库中按 UTC 存储,查询时转换为 DISPLAY_TZ(默认 Asia/Shanghai)输出。
"""

import base64
import bisect
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import urllib.request
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from psycopg.rows import dict_row
from psycopg.conninfo import make_conninfo
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

DATABASE_HOST = os.environ.get("DATABASE_HOST", "database")
DATABASE_PORT = os.environ.get("DATABASE_PORT", "5432")
DATABASE_USER = os.environ.get("DATABASE_USER", "teslamate")
DATABASE_PASS = os.environ.get("DATABASE_PASS", "")
DATABASE_NAME = os.environ.get("DATABASE_NAME", "teslamate")

# 展示时区,来自受信环境变量;校验格式后直接内联进 SQL(避免与位置占位符混用)
DISPLAY_TZ = os.environ.get("DISPLAY_TZ", "Asia/Shanghai")
if not re.fullmatch(r"[A-Za-z_0-9+/.-]{1,64}", DISPLAY_TZ):
    DISPLAY_TZ = "Asia/Shanghai"

# Fail closed on account configuration errors; legacy cookies are intentionally revoked.
from .auth import AccountStore, AuthConfigurationError, SESSION_TTL, verify_password
from ipaddress import ip_address, ip_network
from urllib.parse import urlsplit
import socket
from functools import lru_cache

USERS_FILE = os.environ.get("USERS_FILE", "/data/users.json")
accounts = AccountStore(USERS_FILE)
seeds = os.environ.get("VISUALIZER_USERS", "")
if not seeds and os.environ.get("VISUALIZER_USER") and os.environ.get("VISUALIZER_PASS"):
    seeds = os.environ["VISUALIZER_USER"] + ":" + os.environ["VISUALIZER_PASS"]
accounts.seed(seeds, os.environ.get("PANEL_ADMIN_USERS", ""))
auth_users = accounts.users
_verify_password = verify_password
_make_session = accounts.create_session
_session_user = accounts.session_user
SESSION_COOKIE = "ttv_session"
TRUSTED_PROXIES = tuple(ip_network(x.strip()) for x in
                        os.environ.get("TRUSTED_PROXY_CIDRS", "127.0.0.1/32,::1/128").split(",") if x.strip())
# 设备证书免密:Caddy 验证客户端证书后回源携带 X-Device-Trust 共享头(见 Caddyfile);
# 空值关闭该通道。仅信任来自可信代理的请求,客户端直连伪造的头在 Caddy 层已被剥除。
DEVICE_TRUST_TOKEN = os.environ.get("DEVICE_TRUST_TOKEN", "")
_failures = {}
_failure_lock = threading.Lock()
FAIL_WINDOW, FAIL_THRESHOLD, LOCKOUT = 600, 10, 300


@lru_cache(maxsize=8)
def _proxy_addresses(period):
    addresses = set()
    for host in os.environ.get("TRUSTED_PROXY_HOSTS", "").split(","):
        if not host.strip():
            continue
        try:
            addresses.update(ip_address(row[4][0]) for row in socket.getaddrinfo(host.strip(), None))
        except OSError:
            pass
    return addresses


def _trusted_proxy(request):
    try:
        peer = ip_address(request.client.host)
        return any(peer in net for net in TRUSTED_PROXIES) or peer in _proxy_addresses(int(time.time() // 30))
    except (ValueError, AttributeError):
        return False


def _client_ip(request):
    if _trusted_proxy(request):
        try:
            return str(ip_address(request.headers.get("x-forwarded-for", "").split(",")[-1].strip()))
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"


def _https(request):
    return request.url.scheme == "https" or (_trusted_proxy(request) and
        request.headers.get("x-forwarded-proto", "").lower() == "https")


def _is_locked(key):
    with _failure_lock:
        now = time.time()
        for k in list(_failures):
            _failures[k] = [t for t in _failures[k] if now - t < FAIL_WINDOW]
            if not _failures[k]:
                del _failures[k]
        fails = _failures.get(key, [])
        return len(fails) >= FAIL_THRESHOLD and now - fails[-FAIL_THRESHOLD] < LOCKOUT


def _record_fail(key):
    with _failure_lock:
        if key not in _failures and len(_failures) >= 4096:
            _failures.pop(next(iter(_failures)))
        _failures.setdefault(key, []).append(time.time())
        _failures[key] = _failures[key][-FAIL_THRESHOLD:]


def require_admin(request):
    if getattr(request.state, "role", "") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")

# 每次理想续航(km)对应的可用电量(kWh),用于估算行程能耗;
# 当充电历史足够时按实际数据自动校准。
DEFAULT_KWH_PER_IDEAL_KM = 0.145
# 每 1% 表显电量对应的墙端电量(kWh),用于停放(哨兵/驻车)耗电换算;
# 由「充电量 ÷ 表显电量增幅」自校准,含充电损耗,与电费口径一致。
DEFAULT_KWH_PER_PCT = 0.75

# 用户手填数据(充电费用 / 桩端总耗电 / 充电桩信息)统一存数据库 panel_manual 表:
# kind = 'cost' | 'charge_extra' | 'charger',key = 充电会话 id / 地点键(addr_<id>/geo_<id>),
# payload = jsonb。随数据库备份走,不再依赖 /data 下的 JSON 文件。
PANEL_MANUAL_DDL = """
CREATE TABLE IF NOT EXISTS panel_manual (
  kind       text        NOT NULL,
  key        text        NOT NULL,
  payload    jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
)
"""

# 旧版 JSON 文件路径,仅作启动时一次性迁移的来源
COST_FILE = os.environ.get("COST_FILE", "/data/charge_costs.json")
EXTRAS_FILE = os.environ.get("EXTRAS_FILE", "/data/charge_extras.json")

pool: ConnectionPool | None = None


def _exec(sql: str, params: tuple = ()) -> None:
    """写库(手填数据入库),显式提交。"""
    assert pool is not None
    with pool.connection() as conn:
        conn.execute(sql, params)
        conn.commit()


def _manual_all(kind: str) -> dict[str, dict]:
    rows = q("SELECT key, payload FROM panel_manual WHERE kind = %s", (kind,))
    return {str(r["key"]): (r["payload"] or {}) for r in rows}


def _load_costs() -> dict[str, float]:
    """用户录入的充电费用 {charge_id: 元}。"""
    out: dict[str, float] = {}
    for k, v in _manual_all("cost").items():
        try:
            out[k] = float(v["cost"])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _save_cost(charge_id: int, cost: float) -> None:
    _exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES ('cost', %s, %s)
        ON CONFLICT (kind, key) DO UPDATE
          SET payload = EXCLUDED.payload, updated_at = now()
        """,
        (str(charge_id), Jsonb({"cost": round(float(cost), 2)})),
    )


def _load_extras() -> dict:
    """充电详情补充数据:charges(桩端总耗电)+ chargers(按地点的桩信息)。"""
    return {"charges": _manual_all("charge_extra"),
            "chargers": _manual_all("charger")}


def _save_charge_extra(charge_id: int, total_kwh: float | None) -> None:
    """录入/清除某次充电的桩端计费总耗电;None = 删除。"""
    if total_kwh is None:
        _exec("DELETE FROM panel_manual WHERE kind = 'charge_extra' AND key = %s",
              (str(charge_id),))
    else:
        _exec(
            """
            INSERT INTO panel_manual (kind, key, payload)
            VALUES ('charge_extra', %s, %s)
            ON CONFLICT (kind, key) DO UPDATE
              SET payload = EXCLUDED.payload, updated_at = now()
            """,
            (str(charge_id), Jsonb({"total_kwh": round(float(total_kwh), 2)})),
        )


def _save_charger(key: str, entry: dict | None) -> None:
    """按地点键存档充电桩信息;entry 为 None 表示删除。"""
    if entry is None:
        _exec("DELETE FROM panel_manual WHERE kind = 'charger' AND key = %s", (key,))
    else:
        _exec(
            """
            INSERT INTO panel_manual (kind, key, payload) VALUES ('charger', %s, %s)
            ON CONFLICT (kind, key) DO UPDATE
              SET payload = EXCLUDED.payload, updated_at = now()
            """,
            (key, Jsonb(entry)),
        )


def _migrate_manual_files(conn) -> None:
    """旧版 JSON 文件里的手填数据一次性迁入 panel_manual(已有键不覆盖)。"""
    ins = ("INSERT INTO panel_manual (kind, key, payload) VALUES (%s, %s, %s) "
           "ON CONFLICT (kind, key) DO NOTHING")
    try:
        with open(COST_FILE, encoding="utf-8") as f:
            for k, v in (json.load(f) or {}).items():
                conn.execute(ins, ("cost", str(k),
                                   Jsonb({"cost": round(float(v), 2)})))
    except (OSError, ValueError, TypeError):
        pass
    try:
        with open(EXTRAS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        for kind, group in (("charge_extra", "charges"), ("charger", "chargers")):
            for k, v in ((data or {}).get(group) or {}).items():
                if isinstance(v, dict):
                    conn.execute(ins, (kind, str(k), Jsonb(v)))
    except (OSError, ValueError, TypeError, AttributeError):
        pass


def _loc_key(address_id, geofence_id) -> str | None:
    """充电地点的稳定键:优先地址,其次地理围栏;都没有则无法跨次自动带出。"""
    if address_id is not None:
        return f"addr_{address_id}"
    if geofence_id is not None:
        return f"geo_{geofence_id}"
    return None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pool
    pool = ConnectionPool(
        conninfo=make_conninfo(host=DATABASE_HOST, port=DATABASE_PORT, dbname=DATABASE_NAME,
                               user=DATABASE_USER, password=DATABASE_PASS, options="-c timezone=UTC"),
        min_size=1,
        max_size=4,
        kwargs={"row_factory": dict_row},
    )
    with pool.connection() as conn:
        conn.execute("SELECT 1")
        # panel_manual and grants are provisioned by the maintenance init service.
        conn.execute("SELECT 1 FROM panel_manual LIMIT 1")
        _migrate_manual_files(conn)
        conn.commit()
    from . import nap, sentry_sched, monthly_backup
    nap.start_worker()
    sentry_sched.start_worker()
    monthly_backup.start_worker()
    try:
        yield
    finally:
        nap.stop_worker()
        sentry_sched.stop_worker()
        monthly_backup.stop_worker()
        pool.close()


app = FastAPI(title="TeslaMate Telemetry Visualizer", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


# Static assets needed before login; all data including map assets requires authentication.
_AUTH_EXACT = {"/api/health", "/api/login", "/api/logout", "/login", "/login.js", "/theme.js", "/style.css",
               "/.well-known/appspecific/com.tesla.3p.public-key.pem",
               # 公开演示页(虚拟数据,无任何真实车辆信息):展示分页动效与界面
               "/demo.html", "/demo.js", "/pageturn.js", "/echarts.min.js",
               "/model-y-l.png", "/model-yl-badge.png",
               # 装饰素材:总览/车况火星背景、控制页好奇号火星车(demo 页也引用)
               "/mars.webp", "/mars-surface.webp", "/starship.svg",
               "/blackhole.webp", "/curiosity-rover.webp"}
_AUTH_PREFIX = ("/fonts/",)


from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, exc):
    if request.url.path.startswith("/api/fleet/"):
        return JSONResponse({"detail": "请检查地区、客户端 ID 和密钥的格式及长度"}, status_code=422)
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(AuthConfigurationError)
async def auth_config_error(request, exc):
    return JSONResponse({"detail": "账号配置不可用，请联系管理员"}, status_code=503)


@app.middleware("http")
async def auth_and_headers(request: Request, call_next):
    path = request.url.path
    try:
        public = path in _AUTH_EXACT or any(path.startswith(p) for p in _AUTH_PREFIX)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if request.headers.get("sec-fetch-site") == "cross-site" or (origin and
                    (urlsplit(origin).netloc != request.url.netloc or
                     urlsplit(origin).scheme != ("https" if _https(request) else "http"))):
                return JSONResponse({"detail": "不允许跨站操作"}, status_code=403)
            # 月度备份导入是大文件上传,单独放宽到 512MB;其余请求仍限 64KB
            max_body = 512 * 1024 * 1024 if path == "/api/backup/monthly/import" else 65536
            length = request.headers.get("content-length", "0")
            if not length.isdigit() or int(length) > max_body:
                return JSONResponse({"detail": "请求内容过大"}, status_code=413)
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                if size > max_body:
                    return JSONResponse({"detail": "请求内容过大"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        if not public:
            users = auth_users()  # raises on missing, corrupt or empty configuration
            user = ""
            if (DEVICE_TRUST_TOKEN and _trusted_proxy(request) and
                    hmac.compare_digest(request.headers.get("x-device-trust", ""), DEVICE_TRUST_TOKEN)):
                user = next((u for u, r in accounts.roles().items() if r == "admin"), "")
            token = request.cookies.get(SESSION_COOKIE, "")
            if not user and token:
                user = _session_user(token)
            header = request.headers.get("Authorization", "")
            if not user and header.startswith("Basic "):
                try:
                    u, pw = base64.b64decode(header[6:], validate=True).decode("utf-8").split(":", 1)
                    key = (_client_ip(request), u[:32])
                    if _is_locked(key):
                        return JSONResponse({"detail": "尝试次数过多，请稍后再试"}, status_code=429)
                    if await run_in_threadpool(_verify_password, pw, users.get(u)):
                        user = u
                    else:
                        _record_fail(key)
                except (ValueError, UnicodeDecodeError):
                    pass
            if not user:
                if path.startswith("/api/"):
                    return JSONResponse({"detail": "未登录"}, status_code=401)
                from urllib.parse import quote
                return RedirectResponse(url=f"/login?next={quote(path)}", status_code=302)
            request.state.user = user
            request.state.role = accounts.roles()[user]
            if request.state.role != "admin" and (
                    path.startswith("/api/backup/") or
                    (request.method not in ("GET", "HEAD", "OPTIONS") and
                     path not in ("/api/account/password", "/api/prefs"))):
                return JSONResponse({"detail": "只读账号不能执行此操作"}, status_code=403)
        response = await call_next(request)
    except AuthConfigurationError:
        response = JSONResponse({"detail": "账号配置不可用，请联系管理员"}, status_code=503)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
    if path.startswith("/api/") and not path.startswith("/api/map/"):
        response.headers["Cache-Control"] = "no-store"
    elif path == "/" or path.endswith((".html", ".js", ".css")):
        # 静态页面与脚本:不发 Cache-Control 时浏览器会按启发式缓存旧版本,
        # 部署后用户可能长时间看不到新页面;no-cache 仍走 ETag 304,开销极小。
        response.headers.setdefault("Cache-Control", "no-cache")
    return response

# 将 UTC 时间戳转为本地墙钟时间 / 绝对毫秒时间戳的 SQL 片段
def local_ts(col: str, alias: str | None = None) -> str:
    """返回两列:本地时间字符串与 epoch 毫秒。

    col 为列表达式(如 d.start_date),alias 为输出列名前缀(默认为列名本身)。
    """
    a = alias or col.split(".")[-1]
    return (
        f"({col} AT TIME ZONE 'UTC' AT TIME ZONE '{DISPLAY_TZ}') AS {a}_local, "
        f"(EXTRACT(EPOCH FROM ({col} AT TIME ZONE 'UTC' AT TIME ZONE '{DISPLAY_TZ}') "
        f"AT TIME ZONE '{DISPLAY_TZ}') * 1000)::bigint AS {a}_ts"
    )


def q(sql: str, params: tuple = ()):
    """执行只读查询(参数按占位符顺序传入)。"""
    assert pool is not None
    with pool.connection() as conn:
        return conn.execute(sql, params).fetchall()


def get_car_id(car_id: int | None) -> int:
    cars = q("SELECT id FROM cars ORDER BY id")
    if not cars:
        raise HTTPException(status_code=503, detail="数据库中没有任何车辆")
    if car_id is None:
        return cars[0]["id"]
    if not any(c["id"] == car_id for c in cars):
        raise HTTPException(status_code=404, detail=f"car_id={car_id} 不存在")
    return car_id


def kwh_per_ideal_km(car_id: int) -> float:
    """根据充电历史校准每理想续航公里的可用电量,失败时用默认值。"""
    row = q(
        """
        SELECT sum(charge_energy_added) AS energy,
               sum(end_ideal_range_km - start_ideal_range_km) AS delta
        FROM charging_processes
        WHERE car_id = %s AND charge_energy_added IS NOT NULL
          AND start_ideal_range_km IS NOT NULL
          AND end_ideal_range_km > start_ideal_range_km
        """,
        (car_id,),
    )[0]
    if row["energy"] and row["delta"] and float(row["delta"]) > 0:
        return float(row["energy"]) / float(row["delta"])
    return DEFAULT_KWH_PER_IDEAL_KM


def kwh_per_pct(car_id: int) -> float:
    """根据充电历史校准每 1% 表显电量对应的墙端电量(kWh)。"""
    row = q(
        """
        SELECT sum(charge_energy_added) AS energy,
               sum(end_battery_level - start_battery_level) AS delta
        FROM charging_processes
        WHERE car_id = %s AND charge_energy_added IS NOT NULL
          AND end_battery_level > start_battery_level
        """,
        (car_id,),
    )[0]
    if row["energy"] and row["delta"] and float(row["delta"]) > 0:
        return float(row["energy"]) / float(row["delta"])
    return DEFAULT_KWH_PER_PCT


# ---------- 家充设置:峰谷电价自动计价 ----------
# 配置存 panel_manual(kind='settings', key='home_charge'):
#   {master: 总开关, chargers: {loc_key: {name, enabled, peak, valley, vstart, vend}}}
# 单次充电的手动指定存 kind='charge_home',key=充电会话 id,payload {mode}:
#   mode = 'auto'(默认,按充电地点匹配)| 'off'(本次不按家充计)| loc_key(指定某个家充)。
# 峰谷口径:谷时段默认 23:00–07:00(每个家充可改),按充电起止时长在峰/谷中的占比
# 分摊计费电量(家充交流功率近似恒定);计费电量 = 总耗电(手填/车端)优先,退回充电量。

HOME_CHARGE_DEFAULT_VSTART = "23:00"
HOME_CHARGE_DEFAULT_VEND = "07:00"


def _home_charge_cfg() -> dict:
    rows = q("SELECT payload FROM panel_manual WHERE kind = 'settings' AND key = 'home_charge'")
    cfg = rows[0]["payload"] if rows else {}
    return {"master": bool(cfg.get("master")), "chargers": cfg.get("chargers") or {}}


def _save_home_charge_cfg(cfg: dict) -> None:
    _exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES ('settings', 'home_charge', %s)
        ON CONFLICT (kind, key) DO UPDATE
          SET payload = EXCLUDED.payload, updated_at = now()
        """,
        (Jsonb(cfg),),
    )


def _parse_hhmm(s) -> int | None:
    """'HH:MM' → 一天中的分钟数,非法返回 None。"""
    if not isinstance(s, str) or not re.fullmatch(r"\d{1,2}:\d{2}", s):
        return None
    h, m = int(s.split(":")[0]), int(s.split(":")[1])
    return h * 60 + m if h < 24 and m < 60 else None


def _tou_valley_share(start: datetime, end: datetime, vs: int, ve: int) -> float | None:
    """谷时段占充电时长的比例(按日分段精确求交;vs/ve 为一天中的分钟数,支持跨零点)。"""
    total = (end - start).total_seconds()
    if total <= 0:
        return None
    valley_sec = 0.0
    day = start.date() - timedelta(days=1)
    while day <= end.date() + timedelta(days=1):
        base = datetime.combine(day, datetime.min.time())
        if vs <= ve:
            wins = [(base + timedelta(minutes=vs), base + timedelta(minutes=ve))]
        else:  # 跨零点:拆成 [vs, 24:00) 与 [00:00, ve) 两段
            wins = [(base + timedelta(minutes=vs), base + timedelta(days=1)),
                    (base, base + timedelta(minutes=ve))]
        for a, b in wins:
            lo, hi = max(a, start), min(b, end)
            if lo < hi:
                valley_sec += (hi - lo).total_seconds()
        day += timedelta(days=1)
    return valley_sec / total


def _home_charge_cost(entry: dict, start: datetime, end: datetime | None,
                      billed_kwh: float | None) -> tuple[float, float] | None:
    """按家充峰谷配置算一次充电的 (费用, 加权单价);计费电量缺失或价格未配返回 None。"""
    if not billed_kwh or billed_kwh <= 0:
        return None
    peak = entry.get("peak")
    valley = entry.get("valley")
    if peak is None and valley is None:
        return None
    if peak is None:
        rate = float(valley)
    elif valley is None:
        rate = float(peak)
    else:
        vs = _parse_hhmm(entry.get("vstart")) or _parse_hhmm(HOME_CHARGE_DEFAULT_VSTART)
        ve = _parse_hhmm(entry.get("vend")) or _parse_hhmm(HOME_CHARGE_DEFAULT_VEND)
        share = _tou_valley_share(start, end, vs, ve) if end is not None else None
        rate = (float(valley) * share + float(peak) * (1 - share)) if share is not None \
            else float(peak)
    return round(rate * billed_kwh, 2), round(rate, 4)


def _home_charge_resolve(cfg: dict, assigns: dict, charge_id: int,
                         loc_key: str | None) -> tuple[str, dict | None]:
    """裁定一次充电的家充计价方式,返回 (mode, 家充配置|None)。

    mode: 'off' = 手动关闭;'assigned' = 手动指定;'auto' = 地点自动匹配;'none' = 不计价。
    手动指定优先于一切(即使该家充开关已关);自动匹配要求总开关与该家充开关都开。
    """
    mode = (assigns.get(str(charge_id)) or {}).get("mode", "auto")
    if mode == "off":
        return "off", None
    chargers = cfg["chargers"]
    if mode != "auto":
        entry = chargers.get(mode)
        return ("assigned", entry) if entry else ("none", None)
    if cfg["master"] and loc_key and loc_key in chargers \
            and chargers[loc_key].get("enabled"):
        return "auto", chargers[loc_key]
    return "none", None


def charge_rate_timeline(car_id: int) -> list[dict]:
    """全部充电会话按开始时间升序,带有效单价(用户录入优先,其次家充自动,最后库内 cost)。"""
    costs = _load_costs()
    extras = _load_extras()["charges"]
    home_cfg = _home_charge_cfg()
    assigns = _manual_all("charge_home")
    rows = q(
        f"""
        SELECT cp.id, {local_ts('cp.start_date', 'start_date')},
               {local_ts('cp.end_date', 'end_date')},
               cp.charge_energy_added, cp.cost, cp.address_id, cp.geofence_id
        FROM charging_processes cp
        WHERE cp.car_id = %s
        ORDER BY cp.start_date
        """,
        (car_id,),
    )
    out = []
    for r in rows:
        energy = float(r["charge_energy_added"]) if r["charge_energy_added"] else None
        entered = costs.get(str(r["id"]))
        cost = entered if entered is not None else (
            float(r["cost"]) if r["cost"] is not None else None)
        cost_home = None
        if cost is None:  # 无家录费用时尝试家充自动计价(手动指定优先)
            _, hentry = _home_charge_resolve(home_cfg, assigns, r["id"],
                                             _loc_key(r["address_id"], r["geofence_id"]))
            if hentry:
                manual_total = (extras.get(str(r["id"])) or {}).get("total_kwh")
                billed = (float(manual_total) if manual_total is not None else energy)
                hc = _home_charge_cost(hentry, r["start_date_local"],
                                       r["end_date_local"], billed)
                if hc:
                    cost_home, cost = hc[0], hc[0]
        rate = cost / energy if (cost is not None and energy and energy > 0) else None
        out.append({
            "id": r["id"], "start_ts": int(r["start_date_ts"]),
            "energy_kwh": round(energy, 2) if energy is not None else None,
            "cost": round(cost, 2) if cost is not None else None,
            "cost_entered": entered is not None,
            "cost_home": cost_home is not None,
            "rate_yuan_kwh": round(rate, 4) if rate is not None else None,
        })
    return out


@app.get("/api/health")
def health():
    try:
        q("SELECT 1")
        return {"status": "ok", "database": "connected", "tz": DISPLAY_TZ}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"status": "error", "database": "unavailable"}, status_code=503)


# MapLibre 矢量地图资源:PMTiles 单文件(Range 请求)+ 字体 glyphs + sprites。
# 要求登录(同源 Cookie):数据是公开 OSM 地图,但不对匿名开放,避免被当免费瓦片站。
MAP_DATA_DIR = os.environ.get("MAP_DATA_DIR", "/data/map")
PMTILES_FILE = os.path.join(MAP_DATA_DIR, "china.pmtiles")


@app.get("/api/map/china.pmtiles")
def map_pmtiles(request: Request):
    """PMTiles 归档的 Range 读取;pmtiles.js 每次只取索引/瓦片所在的一小段。"""
    if not os.path.isfile(PMTILES_FILE):
        raise HTTPException(status_code=503, detail="地图数据未安装：请运行 scripts/update-map-data.sh")
    size = os.path.getsize(PMTILES_FILE)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400"}
    range_header = request.headers.get("range", "")
    m = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header)
    if not m:
        # pmtiles.js 总是带 Range;无 Range 的请求只回头部信息,避免误传整个归档
        return Response(status_code=200, headers={**headers, "Content-Length": "0",
                                                  "X-Archive-Size": str(size)})
    start = int(m.group(1))
    end = int(m.group(2)) if m.group(2) else size - 1
    if start >= size or end < start:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    end = min(end, size - 1)
    length = end - start + 1
    with open(PMTILES_FILE, "rb") as f:
        f.seek(start)
        data = f.read(length)
    return Response(content=data, status_code=206, media_type="application/octet-stream",
                    headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}"})


@app.get("/api/map/fonts/{fontstack}/{rangefile}")
def map_font_glyph(fontstack: str, rangefile: str):
    """SDF 字体分块(fontstack 形如 'Noto Sans Regular',rangefile 形如 '19968-20223.pbf')。"""
    if not re.fullmatch(r"[\w .-]{1,64}", fontstack) or not re.fullmatch(r"\d{1,5}-\d{1,5}\.pbf", rangefile):
        raise HTTPException(status_code=404, detail="字体不存在")
    path = os.path.join(MAP_DATA_DIR, "fonts", fontstack, rangefile)
    if not os.path.isfile(path):  # 某段字符集无字形属正常,404 由前端容错
        raise HTTPException(status_code=404, detail="字体不存在")
    return FileResponse(path, media_type="application/x-protobuf",
                        headers={"Cache-Control": "private, max-age=604800"})


@app.get("/api/map/sprites/{name}")
def map_sprite(name: str):
    if not re.fullmatch(r"(light|dark)(@2x)?\.(json|png)", name):
        raise HTTPException(status_code=404, detail="资源不存在")
    path = os.path.join(MAP_DATA_DIR, "sprites", name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="资源不存在")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=604800"})


@app.get("/api/system")
def system_stats():
    """服务器资源:内存读 /proc/meminfo(容器内可见宿主机内存),
    硬盘取根分区(overlay 即宿主机磁盘)。"""
    mem: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="ascii") as f:
            for line in f:
                key, _, val = line.partition(":")
                mem[key] = int(val.strip().split()[0])  # kB
    except (OSError, ValueError, IndexError):
        mem = {}
    mem_total = mem.get("MemTotal")
    mem_avail = mem.get("MemAvailable", mem.get("MemFree", 0))
    mem_used = mem_total - mem_avail if mem_total else None

    st = os.statvfs("/")
    disk_total = st.f_blocks * st.f_frsize
    disk_used = disk_total - st.f_bavail * st.f_frsize

    return {
        "mem_total_mb": round(mem_total / 1024) if mem_total else None,
        "mem_used_mb": round(mem_used / 1024) if mem_used is not None else None,
        "mem_pct": round(mem_used / mem_total * 100, 1) if mem_total else None,
        "disk_total_gb": round(disk_total / 1e9, 1),
        "disk_used_gb": round(disk_used / 1e9, 1),
        "disk_pct": round(disk_used / disk_total * 100, 1) if disk_total else None,
    }


@app.get("/api/overview")
def overview(request: Request, car_id: int | None = Query(default=None)):
    cid = get_car_id(car_id)
    cars = q("SELECT id, name, model, trim_badging, efficiency FROM cars ORDER BY id")

    pos = q(
        f"""
        SELECT {local_ts('date')}, battery_level, usable_battery_level,
               rated_battery_range_km, ideal_battery_range_km, est_battery_range_km,
               odometer, outside_temp, inside_temp, latitude, longitude,
               speed, power, elevation
        FROM positions
        WHERE car_id = %s
        ORDER BY date DESC LIMIT 1
        """,
        (cid,),
    )
    latest = pos[0] if pos else None

    state_row = q(
        "SELECT state FROM states WHERE car_id = %s ORDER BY start_date DESC LIMIT 1",
        (cid,),
    )
    driving = q(
        "SELECT EXISTS(SELECT 1 FROM drives WHERE car_id = %s AND end_date IS NULL) AS x",
        (cid,),
    )[0]["x"]
    charging = q(
        "SELECT EXISTS(SELECT 1 FROM charging_processes "
        "WHERE car_id = %s AND end_date IS NULL) AS x",
        (cid,),
    )[0]["x"]
    if driving:
        state = "driving"
    elif charging:
        state = "charging"
    else:
        state = state_row[0]["state"] if state_row else "unknown"

    ver = q(
        "SELECT version FROM updates WHERE car_id = %s "
        "ORDER BY start_date DESC LIMIT 1",
        (cid,),
    )
    version = ver[0]["version"] if ver else None

    ratio = kwh_per_ideal_km(cid)
    # 本月/本年边界按展示时区计算,再换算为 UTC 与库中时间戳比较
    local_now = datetime.now(ZoneInfo(DISPLAY_TZ))
    month_start_utc = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) \
        .astimezone(timezone.utc).replace(tzinfo=None)
    # 本周一起算(展示时区),再换算为 UTC
    week_start_utc = (local_now - timedelta(days=local_now.weekday())) \
        .replace(hour=0, minute=0, second=0, microsecond=0) \
        .astimezone(timezone.utc).replace(tzinfo=None)
    year_start_utc = local_now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0) \
        .astimezone(timezone.utc).replace(tzinfo=None)
    totals = q(
        """
        SELECT
          count(*) AS drives_total,
          coalesce(sum(distance) FILTER (WHERE start_date >= %s), 0) AS month_km,
          coalesce(sum(distance) FILTER (WHERE start_date >= %s), 0) AS year_km,
          coalesce(sum(distance) FILTER (WHERE start_date >= %s), 0) AS week_km,
          coalesce(sum(start_ideal_range_km - end_ideal_range_km)
            FILTER (WHERE start_date >= %s
                     AND start_ideal_range_km IS NOT NULL
                     AND end_ideal_range_km IS NOT NULL), 0) AS month_ideal_delta_km
        FROM drives WHERE car_id = %s
        """,
        (month_start_utc, year_start_utc, week_start_utc, month_start_utc, cid),
    )[0]

    chg = q(
        """
        SELECT count(*) AS sessions,
               coalesce(sum(charge_energy_added), 0) AS energy_kwh,
               coalesce(sum(cost), 0) AS cost,
               coalesce(sum(duration_min), 0) AS duration_min
        FROM charging_processes WHERE car_id = %s
        """,
        (cid,),
    )[0]

    return {
        "cars": [
            {
                "id": c["id"],
                "name": c["name"],
                "model": c["model"],
                "trim_badging": c["trim_badging"],
                "efficiency": float(c["efficiency"]) if c["efficiency"] else None,
            }
            for c in cars
        ],
        "role": request.state.role,
        "car_id": cid,
        "state": state,
        "software_version": version,
        "latest": latest,
        "kwh_per_ideal_km": ratio,
        # 每 1% 表显电量对应的电量(kWh),前端「度数」维度的换算系数
        "kwh_per_pct": round(kwh_per_pct(cid), 3),
        "totals": {
            "drives_total": int(totals["drives_total"]),
            "month_km": float(totals["month_km"] or 0),
            "year_km": float(totals["year_km"] or 0),
            "week_km": float(totals["week_km"] or 0),
            "month_energy_kwh": float(totals["month_ideal_delta_km"] or 0) * ratio,
        },
        "charging": {
            "sessions": int(chg["sessions"]),
            "energy_kwh": float(chg["energy_kwh"]),
            "cost": float(chg["cost"] or 0),
            "duration_min": int(chg["duration_min"] or 0),
        },
    }


@app.get("/api/drives/daily")
def drives_daily(car_id: int | None = Query(default=None),
                 days: int = Query(default=30, ge=1, le=90)):
    cid = get_car_id(car_id)
    rows = q(
        f"""
        SELECT (date_trunc('day', start_date AT TIME ZONE 'UTC'
                           AT TIME ZONE '{DISPLAY_TZ}'))::date AS day,
               count(*) AS drives,
               coalesce(sum(distance), 0) AS distance_km,
               coalesce(sum(start_ideal_range_km - end_ideal_range_km)
                 FILTER (WHERE start_ideal_range_km IS NOT NULL
                          AND end_ideal_range_km IS NOT NULL), 0) AS ideal_delta_km
        FROM drives
        WHERE car_id = %s AND start_date >= now() - make_interval(days => %s)
        GROUP BY 1 ORDER BY 1
        """,
        (cid, days),
    )
    return {"days": days, "days_rows": rows}


@app.get("/api/charging/summary")
def charging_summary(car_id: int | None = Query(default=None),
                     limit: int = Query(default=10, ge=1, le=50)):
    cid = get_car_id(car_id)
    totals = q(
        """
        SELECT count(*) AS sessions,
               coalesce(sum(charge_energy_added), 0) AS energy_kwh,
               coalesce(sum(charge_energy_used), 0) AS energy_used_kwh,
               coalesce(sum(cost), 0) AS cost,
               coalesce(sum(duration_min), 0) AS duration_min
        FROM charging_processes WHERE car_id = %s
        """,
        (cid,),
    )[0]
    rows = q(
        f"""
        SELECT cp.id, {local_ts('cp.start_date', 'start_date')},
               {local_ts('cp.end_date', 'end_date')},
               cp.charge_energy_added, cp.cost, cp.duration_min,
               cp.start_battery_level, cp.end_battery_level,
               cp.start_ideal_range_km, cp.end_ideal_range_km,
               cp.outside_temp_avg,
               a.name AS address_name, a.city AS address_city
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        WHERE cp.car_id = %s
        ORDER BY cp.start_date DESC
        LIMIT %s
        """,
        (cid, limit),
    )
    return {"totals": totals, "sessions": rows}


class ChargeCostIn(BaseModel):
    charge_id: int
    cost: float


@app.post("/api/charging/costs")
def set_charging_cost(payload: ChargeCostIn):
    """录入某次充电的费用(元)。"""
    row = q("SELECT id FROM charging_processes WHERE id = %s", (payload.charge_id,))
    if not row:
        raise HTTPException(status_code=404, detail="充电会话不存在")
    if payload.cost < 0:
        raise HTTPException(status_code=422, detail="费用不能为负")
    _save_cost(payload.charge_id, payload.cost)
    return {"ok": True, "charge_id": payload.charge_id, "cost": round(payload.cost, 2)}


class ChargeExtraIn(BaseModel):
    charge_id: int
    total_kwh: float | None = None  # 桩端计费总耗电(含损耗);null = 清除手填值


class ChargerIn(BaseModel):
    charge_id: int
    name: str = ""
    location: str = ""
    brand: str | None = None  # None = 不改动已存品牌;空串 = 清除


class HomeMasterIn(BaseModel):
    enabled: bool


class HomeChargerIn(BaseModel):
    key: str                       # 地点键 addr_<id> / geo_<id>
    name: str = ""
    enabled: bool = True
    peak: float | None = None      # 峰时单价 ¥/kWh;与 valley 至少配一个
    valley: float | None = None    # 谷时单价 ¥/kWh
    vstart: str | None = None      # 谷时段起点 HH:MM,默认 23:00
    vend: str | None = None        # 谷时段终点 HH:MM,默认 07:00


class HomeAssignIn(BaseModel):
    charge_id: int
    mode: str = "auto"             # auto | off | loc_key(指定某个家充)


@app.get("/api/charging/sessions")
def charging_sessions(car_id: int | None = Query(default=None),
                      days: int = Query(default=30, ge=1, le=730)):
    """充电详情卡片:每次充电一张卡,含手填的总耗电 / 充电桩名称 / 费用与派生指标。

    电费单价 = 费用 ÷ 总耗电(手填优先,其次车端 charge_energy_used,
    都没有则退回充电量);充电后每公里费用 = 费用 ÷ 充电后至下次充电的行驶里程。
    """
    cid = get_car_id(car_id)
    since_ms = _utc_ms(datetime.now(timezone.utc) - timedelta(days=days))
    rows = q(
        f"""
        SELECT cp.id, {local_ts('cp.start_date', 'start_date')},
               {local_ts('cp.end_date', 'end_date')},
               cp.duration_min, cp.charge_energy_added, cp.charge_energy_used,
               cp.start_battery_level, cp.end_battery_level,
               cp.address_id, cp.geofence_id, a.name AS address_name
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        WHERE cp.car_id = %s
        ORDER BY cp.start_date
        LIMIT 500
        """,
        (cid,),
    )
    costs = _load_costs()
    extras = _load_extras()
    home_cfg = _home_charge_cfg()
    home_assigns = _manual_all("charge_home")
    # 充电后行驶里程:本次充电结束 → 下次充电开始之间的行程距离合计
    drives = q(
        f"""
        SELECT {local_ts('d.start_date', 'start_date')}, d.distance
        FROM drives d
        WHERE d.car_id = %s
        ORDER BY d.start_date
        """,
        (cid,),
    )
    drive_ts = [int(d["start_date_ts"]) for d in drives]

    out = []
    for i, r in enumerate(rows):
        start_ts = int(r["start_date_ts"])
        if start_ts < since_ms:
            continue
        end_ts = int(r["end_date_ts"]) if r["end_date_ts"] is not None else None
        nxt_start = int(rows[i + 1]["start_date_ts"]) if i + 1 < len(rows) else None
        seg_end = nxt_start if nxt_start else int(time.time() * 1000)
        i0 = bisect.bisect_right(drive_ts, end_ts if end_ts is not None else start_ts)
        i1 = bisect.bisect_right(drive_ts, seg_end)
        after_km = round(sum(float(drives[j]["distance"] or 0)
                             for j in range(i0, i1)), 1)

        key = _loc_key(r["address_id"], r["geofence_id"])
        saved_charger = extras["chargers"].get(key) if key else None
        extra = extras["charges"].get(str(r["id"])) or {}
        manual_total = extra.get("total_kwh")
        used = float(r["charge_energy_used"]) if r["charge_energy_used"] else None
        energy = float(r["charge_energy_added"]) if r["charge_energy_added"] else None
        total_kwh = round(float(manual_total), 2) if manual_total is not None else used
        cost = costs.get(str(r["id"]))
        # 单价口径:优先总耗电(桩端计费电量),缺失时退回充电量
        denom = total_kwh if total_kwh and total_kwh > 0 else energy
        # 家充计价:手动指定 > 总开关+地点自动匹配;手填费用优先于一切自动计价
        hmode_raw = (home_assigns.get(str(r["id"])) or {}).get("mode", "auto")
        hentry = _home_charge_resolve(home_cfg, home_assigns, r["id"], key)[1]
        hc = (_home_charge_cost(hentry, r["start_date_local"], r["end_date_local"], denom)
              if hentry else None)
        cost_home = hc[0] if hc else None
        effective = cost if cost is not None else cost_home
        rate = round(effective / denom, 4) if effective is not None and denom else None
        per_km = (round(effective / after_km, 4)
                  if effective is not None and after_km > 0 else None)
        out.append({
            "id": r["id"],
            "start_ts": start_ts,
            "end_ts": end_ts,
            "start_local": r["start_date_local"],
            "end_local": r["end_date_local"],
            "duration_min": r["duration_min"],
            "energy_kwh": round(energy, 2) if energy is not None else None,
            "energy_used_kwh": round(used, 2) if used is not None else None,
            "total_kwh": total_kwh,
            "total_kwh_manual": manual_total is not None,
            "start_battery_level": r["start_battery_level"],
            "end_battery_level": r["end_battery_level"],
            "loc_key": key,
            "charger_name": (saved_charger or {}).get("name", ""),
            "charger_location": (saved_charger or {}).get("location",
                                                          r["address_name"] or ""),
            "charger_brand": (saved_charger or {}).get("brand", ""),
            "cost": round(cost, 2) if cost is not None else None,
            "cost_home": cost_home,
            "cost_effective": round(effective, 2) if effective is not None else None,
            "home_mode": hmode_raw,  # auto | off | 指定家充的 loc_key(hmode 为裁定结果)
            "home_name": (hentry or {}).get("name", "") if hentry else "",
            "rate_yuan_kwh": rate,
            "after_km": after_km,
            "per_km_yuan": per_km,
        })
    out.reverse()  # 新的在前
    return {"charges": out}


@app.post("/api/charging/extras")
def set_charging_extra(payload: ChargeExtraIn):
    """录入/清除某次充电的桩端计费总耗电(kWh,含充电损耗)。"""
    row = q("SELECT id FROM charging_processes WHERE id = %s", (payload.charge_id,))
    if not row:
        raise HTTPException(status_code=404, detail="充电会话不存在")
    if payload.total_kwh is not None and not (0 <= payload.total_kwh <= 500):
        raise HTTPException(status_code=422, detail="总耗电需在 0–500 kWh 之间")
    _save_charge_extra(payload.charge_id, payload.total_kwh)
    return {"ok": True, "charge_id": payload.charge_id,
            "total_kwh": (round(float(payload.total_kwh), 2)
                          if payload.total_kwh is not None else None)}


@app.post("/api/charging/charger")
def set_charger(payload: ChargerIn):
    """录入充电桩名称/地点/品牌;按充电地点存档,同一地点的后续充电自动带出。

    brand 为 None 时保留已存品牌(「充电详情」卡片只提交名称与地点)。
    """
    row = q("SELECT address_id, geofence_id FROM charging_processes WHERE id = %s",
            (payload.charge_id,))
    if not row:
        raise HTTPException(status_code=404, detail="充电会话不存在")
    key = _loc_key(row[0]["address_id"], row[0]["geofence_id"])
    if key is None:
        raise HTTPException(status_code=422, detail="该次充电没有地点信息,无法存档")
    name = payload.name.strip()[:80]
    location = payload.location.strip()[:120]
    entry = dict(_manual_all("charger").get(key) or {})
    entry["name"] = name
    entry["location"] = location
    if payload.brand is not None:
        entry["brand"] = payload.brand.strip()[:40]
    if entry.get("name") or entry.get("location") or entry.get("brand"):
        _save_charger(key, entry)
    else:
        _save_charger(key, None)
    return {"ok": True, "loc_key": key, "name": name, "location": location,
            "brand": entry.get("brand", "")}


# ---------- 家充设置接口(写操作由中间件限定管理员) ----------

@app.get("/api/charging/home")
def get_home_charge(request: Request, car_id: int | None = Query(default=None)):
    """家充设置:总开关 + 已配地点列表 + 可添加的充电地点候选(按充电次数排序)。"""
    cid = get_car_id(car_id)
    cfg = _home_charge_cfg()
    locs = q(
        """
        SELECT cp.address_id, cp.geofence_id, a.name AS address_name, g.name AS geofence_name,
               count(*) AS n
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        LEFT JOIN geofences g ON g.id = cp.geofence_id
        WHERE cp.car_id = %s AND (cp.address_id IS NOT NULL OR cp.geofence_id IS NOT NULL)
        GROUP BY cp.address_id, cp.geofence_id, a.name, g.name
        ORDER BY n DESC
        LIMIT 50
        """,
        (cid,),
    )
    label_by_key, count_by_key = {}, {}
    for r in locs:
        k = _loc_key(r["address_id"], r["geofence_id"])
        if not k:
            continue
        label_by_key[k] = r["address_name"] or r["geofence_name"] or k
        count_by_key[k] = int(r["n"])
    chargers = [{
        "key": k,
        "name": e.get("name") or label_by_key.get(k, k),
        "enabled": bool(e.get("enabled")),
        "peak": e.get("peak"), "valley": e.get("valley"),
        "vstart": e.get("vstart") or HOME_CHARGE_DEFAULT_VSTART,
        "vend": e.get("vend") or HOME_CHARGE_DEFAULT_VEND,
        "location": label_by_key.get(k, ""),
        "sessions": count_by_key.get(k, 0),
    } for k, e in cfg["chargers"].items()]
    chargers.sort(key=lambda c: -c["sessions"])
    candidates = [{"key": k, "name": label_by_key[k], "count": count_by_key[k],
                   "added": k in cfg["chargers"]} for k in label_by_key]
    return {"master": cfg["master"], "chargers": chargers, "candidates": candidates,
            "role": getattr(request.state, "role", "viewer"),
            "vstart_default": HOME_CHARGE_DEFAULT_VSTART,
            "vend_default": HOME_CHARGE_DEFAULT_VEND}


@app.post("/api/charging/home/master")
def set_home_master(payload: HomeMasterIn):
    """家充自动计价总开关:开启后,在已开启家充地点的充电默认按峰谷电价计费。"""
    cfg = _home_charge_cfg()
    cfg["master"] = payload.enabled
    _save_home_charge_cfg(cfg)
    return {"ok": True, "master": cfg["master"]}


@app.post("/api/charging/home/charger")
def set_home_charger(payload: HomeChargerIn):
    """添加/更新一个家充地点(峰谷电价、开关、谷时段);key 为充电地点键。"""
    if not re.fullmatch(r"(addr|geo)_\d{1,10}", payload.key):
        raise HTTPException(status_code=422, detail="地点键无效")
    for p in (payload.peak, payload.valley):
        if p is not None and not (0 <= p <= 50):
            raise HTTPException(status_code=422, detail="电价需在 0–50 ¥/kWh 之间")
    if payload.peak is None and payload.valley is None:
        raise HTTPException(status_code=422, detail="峰时电价与谷时电价至少填写一个")
    for t in (payload.vstart, payload.vend):
        if t is not None and _parse_hhmm(t) is None:
            raise HTTPException(status_code=422, detail="时段格式应为 HH:MM")
    tbl = "addresses" if payload.key.startswith("addr_") else "geofences"
    if not q(f"SELECT 1 FROM {tbl} WHERE id = %s", (int(payload.key.split("_")[1]),)):
        raise HTTPException(status_code=404, detail="地点不存在")
    cfg = _home_charge_cfg()
    entry = dict(cfg["chargers"].get(payload.key) or {})
    entry.update({
        "name": payload.name.strip()[:80],
        "enabled": payload.enabled,
        "peak": round(float(payload.peak), 4) if payload.peak is not None else None,
        "valley": round(float(payload.valley), 4) if payload.valley is not None else None,
        "vstart": payload.vstart or None,
        "vend": payload.vend or None,
    })
    cfg["chargers"][payload.key] = entry
    _save_home_charge_cfg(cfg)
    return {"ok": True, "key": payload.key}


@app.delete("/api/charging/home/charger")
def del_home_charger(key: str = Query(...)):
    """删除一个家充地点;指向它的单次手动指定一并清除(回退自动)。"""
    cfg = _home_charge_cfg()
    if key not in cfg["chargers"]:
        raise HTTPException(status_code=404, detail="家充地点不存在")
    cfg["chargers"].pop(key, None)
    _save_home_charge_cfg(cfg)
    _exec("DELETE FROM panel_manual WHERE kind = 'charge_home' AND payload->>'mode' = %s",
          (key,))
    return {"ok": True}


@app.post("/api/charging/home/assign")
def set_home_assign(payload: HomeAssignIn):
    """单次充电的家充计价指定:auto 跟随地点(默认)/ off 不计 / loc_key 指定某个家充。"""
    if not q("SELECT 1 FROM charging_processes WHERE id = %s", (payload.charge_id,)):
        raise HTTPException(status_code=404, detail="充电会话不存在")
    if payload.mode == "auto":
        _exec("DELETE FROM panel_manual WHERE kind = 'charge_home' AND key = %s",
              (str(payload.charge_id),))
    else:
        if payload.mode != "off" and payload.mode not in _home_charge_cfg()["chargers"]:
            raise HTTPException(status_code=422, detail="家充地点无效")
        _exec(
            """
            INSERT INTO panel_manual (kind, key, payload) VALUES ('charge_home', %s, %s)
            ON CONFLICT (kind, key) DO UPDATE
              SET payload = EXCLUDED.payload, updated_at = now()
            """,
            (str(payload.charge_id), Jsonb({"mode": payload.mode})),
        )
    return {"ok": True, "charge_id": payload.charge_id, "mode": payload.mode}


# ---------- 堵车 / 红绿灯分析(启发式,特斯拉不上报红绿灯位置) ----------
# 停车 <5s 视为瞬时停顿(让行/掉头)不计;停车 5–120s 且停车前 15 秒内曾
# 以 ≥20 km/h 行驶(车流原本通畅)= 红绿灯等待;缓行车流中的走走停停与
# 停车 >120s = 堵车停留;0 < speed < 10 km/h 的缓行区间计入堵车时间,
# 堵车路程按缓行段 速度×时间 积分。行驶时 positions 约 0.3s 一条,精度足够。
TRAFFIC_LIGHT_MIN_S = 5.0
TRAFFIC_LIGHT_MAX_S = 120.0
TRAFFIC_FLOW_KMH = 20.0     # 停车前 15s 内的最高车速达到该值才算通畅车流
TRAFFIC_FLOW_WINDOW_MS = 15000
JAM_CRAWL_KMH = 10.0


def _drive_traffic(samples: list[tuple[int, float]]) -> dict:
    """由单条行程的 (ts_ms, speed_kmh) 序列分析堵车与红绿灯等待。

    返回 {light_n 红灯次数, light_s 红灯等待秒, jam_s 堵车秒(长停+走走停停+缓行),
    jam_km 堵车路程(缓行段积分)}。采样断档 >30s 的间隙不计入缓行。
    """
    light_n, light_s, jam_s, jam_km = 0, 0.0, 0.0, 0.0
    # 行驶采样(停车前车流速度回看用):刹车末段车速必然 <10,不能用停车前一拍判断
    moving = [(ms, s) for ms, s in samples if s > 0]
    mts = [ms for ms, _ in moving]

    def flow_before(stop_ms: int) -> float:
        i = bisect.bisect_left(mts, stop_ms - TRAFFIC_FLOW_WINDOW_MS)
        j = bisect.bisect_left(mts, stop_ms)
        return max((s for _, s in moving[i:j]), default=0.0)

    stop_start: int | None = None  # 当前停车段起始 ms
    prev_ms: int | None = None

    def settle_stop(end_ms: int) -> None:
        nonlocal light_n, light_s, jam_s
        dur = (end_ms - stop_start) / 1000
        if dur < TRAFFIC_LIGHT_MIN_S:
            return
        if (dur <= TRAFFIC_LIGHT_MAX_S
                and flow_before(stop_start) >= TRAFFIC_FLOW_KMH):
            light_n += 1
            light_s += dur
        else:
            jam_s += dur

    for ms, speed in samples:
        if stop_start is not None and speed > 0:
            settle_stop(ms)
            stop_start = None
        if speed == 0:
            if stop_start is None:
                stop_start = ms
        elif speed < JAM_CRAWL_KMH and prev_ms is not None and stop_start is None:
            dt = (ms - prev_ms) / 1000
            if dt <= 30:
                jam_s += dt
                jam_km += speed * dt / 3600
        prev_ms = ms
    if stop_start is not None and prev_ms is not None:
        settle_stop(prev_ms)  # 行程结束时仍在停:按已停时长结算
    return {"light_n": light_n, "light_s": round(light_s),
            "jam_s": round(jam_s), "jam_km": round(jam_km, 2)}


@app.get("/api/routes")
def routes(car_id: int | None = Query(default=None),
           days: int = Query(default=7, ge=1, le=30)):
    """所选时间范围内全部行程轨迹(每条抽稀到约 220 点以内)。"""
    cid = get_car_id(car_id)
    drives = q(
        f"""
        SELECT d.id, {local_ts('d.start_date', 'start_date')},
               {local_ts('d.end_date', 'end_date')},
               d.distance, d.duration_min, d.speed_max,
               d.start_ideal_range_km, d.end_ideal_range_km,
               a1.name AS start_name, a2.name AS end_name
        FROM drives d
        LEFT JOIN addresses a1 ON a1.id = d.start_address_id
        LEFT JOIN addresses a2 ON a2.id = d.end_address_id
        WHERE d.car_id = %s AND d.start_date >= now() - make_interval(days => %s)
          AND d.distance > 0.1
        ORDER BY d.start_date
        """,
        (cid, days),
    )
    pts = q(
        """
        SELECT drive_id, date, latitude, longitude, elevation, speed
        FROM positions
        WHERE car_id = %s AND drive_id IS NOT NULL AND latitude IS NOT NULL
          AND date >= now() - make_interval(days => %s)
        ORDER BY drive_id, date
        """,
        (cid, days),
    )
    # 轨迹点:[纬度, 经度, 海拔(可空), 速度 km/h(可空)]
    # ——海拔供行程详情的高度图用,速度供详情小地图按车速变色绘制
    by_id: dict[int, list[list[float]]] = {}
    speed_seq: dict[int, list[tuple[int, float]]] = {}  # 堵车/红灯分析用全分辨率速度序列
    for p in pts:
        did = int(p["drive_id"])
        by_id.setdefault(did, []).append(
            [float(p["latitude"]), float(p["longitude"]),
             float(p["elevation"]) if p["elevation"] is not None else None,
             float(p["speed"]) if p["speed"] is not None else None])
        if p["speed"] is not None:
            speed_seq.setdefault(did, []).append(
                (_utc_ms(p["date"]), float(p["speed"])))
    out = []
    for d in drives:
        points = by_id.get(d["id"], [])
        d["traffic"] = _drive_traffic(speed_seq.get(d["id"], []))
        if len(points) > 220:
            keep = max(1, len(points) // 220)
            points = points[::keep]
        d["points"] = points
        out.append(d)
    return {"routes": out}


# ---------- 活动时间线:电量曲线 + 行驶/充电/哨兵/驻车耗电分段 ----------

# 驻车期间相邻采样间隔超过该值视为车辆进入休眠(样本来自 5 分钟分桶)
AWAKE_GAP_MS = 75 * 60 * 1000
# 驻车清醒持续达到该时长才判定为哨兵开启(短暂唤醒如 App 查看不算)
SENTRY_MIN_DURATION_MS = 30 * 60 * 1000


def _utc_ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def _battery_samples(cid: int, since_naive: datetime) -> list[tuple[int, int, bool]]:
    """电量采样:5 分钟一桶取首条(哨兵/驻车分段用),驻车时约 30 分钟一条自然保留。"""
    rows = q(
        """
        SELECT DISTINCT ON (b) date, battery_level, is_climate_on
        FROM (
            SELECT date, battery_level, is_climate_on,
                   floor(extract(epoch FROM date) / 300)::bigint AS b
            FROM positions
            WHERE car_id = %s AND date >= %s AND battery_level IS NOT NULL
        ) t
        ORDER BY b, date
        """,
        (cid, since_naive),
    )
    return [
        (_utc_ms(r["date"]), int(r["battery_level"]),
         bool(r["is_climate_on"]) if r["is_climate_on"] is not None else False)
        for r in rows
    ]


def _cut_interval(seg: tuple[int, int], intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """从区间 seg 中挖去 intervals 覆盖的部分,返回剩余片段。"""
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


def _split_segments(samples: list[tuple[int, int, bool]],
                    intervals: list[tuple[int, int]]) -> dict:
    """由电量采样序列切出哨兵与驻车耗电时段。

    samples: (ts_ms, battery_level, is_climate_on),按时间升序。
    intervals: 行驶/充电区间(与采样同一时间基准),用于挖除。
    哨兵判定:驻车清醒 ≥ 30 分钟且非空调预热(特斯拉驻车长时间清醒≈哨兵开启;
    接电时哨兵掉电可能为 0)。驻车耗电:休眠间隙中的电量下降。
    """
    sentry, idle = [], []

    # 1) 清醒连续段(相邻采样间隔 ≤ AWAKE_GAP_MS)
    runs = []
    if samples:
        run_start_ts, run_start_lvl = samples[0][0], samples[0][1]
        prev = samples[0]
        for cur in samples[1:]:
            if cur[0] - prev[0] > AWAKE_GAP_MS:
                runs.append((run_start_ts, prev[0], run_start_lvl, prev[1]))
                run_start_ts, run_start_lvl = cur[0], cur[1]
            prev = cur
        runs.append((run_start_ts, prev[0], run_start_lvl, prev[1]))

    ts_list = [s[0] for s in samples]

    def level_range(a: int, b: int) -> tuple[int, int, list]:
        """区间 [a, b] 内的首末电量与全部样本(供哨兵/空调判定)。"""
        i = bisect.bisect_left(ts_list, a)
        j = bisect.bisect_right(ts_list, b)
        if i >= j:
            return None
        return samples[i][1], samples[j - 1][1], samples[i:j]

    # 2) 清醒段挖去行驶/充电后,剩余驻车清醒片段
    for rs, re, _, _ in runs:
        for ps, pe in _cut_interval((rs, re), intervals):
            if pe - ps < SENTRY_MIN_DURATION_MS:
                continue
            lr = level_range(ps, pe)
            if not lr:
                continue
            l0, l1, inner = lr
            if l1 - l0 >= 1:  # 驻车电量上升:测量噪声,跳过
                continue
            climate = sum(1 for s in inner if s[2]) / len(inner) >= 0.3
            piece = {
                "s": ps, "e": pe, "s_lvl": l0, "e_lvl": l1,
                "delta": l1 - l0, "dur_min": round((pe - ps) / 60000, 0),
            }
            if climate:
                if piece["delta"] <= -1:  # 空调预热耗电归入「非行驶耗电」
                    piece["kind"] = "climate"
                    idle.append(piece)
            else:
                piece["kind"] = "sentry"
                sentry.append(piece)

    # 3) 休眠间隙中的电量下降 → 驻车(非行驶)耗电
    for (t0, l0, _), (t1, l1, _) in zip(samples, samples[1:]):
        if t1 - t0 <= AWAKE_GAP_MS:
            continue
        if any(a < t1 and b > t0 for a, b in intervals):
            continue  # 间隙横跨行驶/充电,无法归因,跳过
        if l1 - l0 <= -1:
            idle.append({
                "s": t0, "e": t1, "s_lvl": l0, "e_lvl": l1,
                "delta": l1 - l0, "dur_min": round((t1 - t0) / 60000, 0),
                "kind": "asleep",
            })

    def merge(pieces: list[dict]) -> list[dict]:
        pieces.sort(key=lambda p: p["s"])
        out = []
        for p in pieces:
            if out and p["s"] - out[-1]["e"] < 30 * 60 * 1000:
                last = out[-1]
                last["e"] = p["e"]
                last["e_lvl"] = p["e_lvl"]
                last["delta"] = last["e_lvl"] - last["s_lvl"]
                last["dur_min"] = round((last["e"] - last["s"]) / 60000, 0)
            else:
                out.append(dict(p))
        return out

    return {"sentry": merge(sentry), "idle": merge(idle)}


@app.get("/api/activity")
def activity(car_id: int | None = Query(default=None),
             days: int = Query(default=7, ge=1, le=30)):
    """电量曲线 + 行驶/充电/哨兵/驻车耗电分段(时间轴标注用)。"""
    cid = get_car_id(car_id)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_naive = since.replace(tzinfo=None)

    # 电量采样:5 分钟一桶取首条,驻车时约 30 分钟一条自然保留
    samples = _battery_samples(cid, since_naive)

    # 行驶/充电多取 2 小时:窗口边缘的行程需参与分段挖除,展示时再按窗口过滤
    buffered = since_naive - timedelta(hours=2)
    since_ms = _utc_ms(since)
    drives_all = q(
        f"""
        SELECT d.id, {local_ts('d.start_date', 'start_date')},
               {local_ts('d.end_date', 'end_date')},
               d.distance, d.duration_min,
               d.start_ideal_range_km, d.end_ideal_range_km,
               a1.name AS start_name, a2.name AS end_name
        FROM drives d
        LEFT JOIN addresses a1 ON a1.id = d.start_address_id
        LEFT JOIN addresses a2 ON a2.id = d.end_address_id
        WHERE d.car_id = %s AND d.start_date >= %s
        ORDER BY d.start_date
        """,
        (cid, buffered),
    )
    charges_all = q(
        f"""
        SELECT cp.id, {local_ts('cp.start_date', 'start_date')},
               {local_ts('cp.end_date', 'end_date')},
               cp.charge_energy_added, cp.cost, cp.duration_min,
               cp.start_battery_level, cp.end_battery_level,
               a.name AS address_name
        FROM charging_processes cp
        LEFT JOIN addresses a ON a.id = cp.address_id
        WHERE cp.car_id = %s AND cp.start_date >= %s
        ORDER BY cp.start_date
        """,
        (cid, buffered),
    )
    drives = [d for d in drives_all if int(d["start_date_ts"]) >= since_ms]
    charges = [c for c in charges_all if int(c["start_date_ts"]) >= since_ms]

    intervals = [
        (int(d["start_date_ts"]), int(d["end_date_ts"])) for d in drives_all
    ] + [
        (int(c["start_date_ts"]), int(c["end_date_ts"])) for c in charges_all
        if c["end_date_ts"] is not None
    ]

    seg = _split_segments(samples, intervals)

    def with_rate(pieces):
        for p in pieces:
            h = (p["e"] - p["s"]) / 3600000
            p["rate_pct_h"] = round(p["delta"] / h, 2) if h > 0 else None
        return pieces

    # 金额估算:事件发生时最近一次充电的单价 × 事件能耗
    ratio = kwh_per_ideal_km(cid)
    kpp = kwh_per_pct(cid)
    timeline = charge_rate_timeline(cid)
    tl_starts = [c["start_ts"] for c in timeline]
    tl_by_id = {c["id"]: c for c in timeline}

    def rate_at(ts: int):
        i = bisect.bisect_right(tl_starts, ts) - 1
        return timeline[i]["rate_yuan_kwh"] if i >= 0 else None

    def price(ts: int, kwh: float):
        r = rate_at(ts)
        return round(kwh * r, 2) if (r is not None and kwh is not None) else None

    for c in charges:
        t = tl_by_id.get(c["id"])
        if t:
            c["cost"] = t["cost"]
            c["cost_entered"] = t["cost_entered"]
            c["rate_yuan_kwh"] = t["rate_yuan_kwh"]

    for d in drives:
        # 行程起止电量:取行程窗口(前后放宽 5 分钟)内的首末电量采样
        s_ms, e_ms = int(d["start_date_ts"]), int(d["end_date_ts"])
        pts = [l for t, l, _ in samples if s_ms - 300000 <= t <= e_ms + 300000]
        if len(pts) >= 2:
            d["start_battery_level"] = pts[0]
            d["end_battery_level"] = pts[-1]
        if d["start_ideal_range_km"] is None or d["end_ideal_range_km"] is None:
            continue
        delta_km = float(d["start_ideal_range_km"] - d["end_ideal_range_km"])
        if delta_km <= 0:
            continue
        kwh = delta_km * ratio
        d["energy_kwh"] = round(kwh, 2)
        d["cost_yuan"] = price(int(d["start_date_ts"]), kwh)
        if d["cost_yuan"] is not None and d["distance"]:
            d["cost_per_km_yuan"] = round(d["cost_yuan"] / float(d["distance"]), 4)

    for p in seg["sentry"] + seg["idle"]:
        kwh = -p["delta"] * kpp
        p["energy_kwh"] = round(kwh, 2)
        p["cost_yuan"] = price(p["s"], kwh)

    return {
        "days": days,
        "battery": [[s[0], s[1]] for s in samples],
        "drives": drives,
        "charges": charges,
        "sentry": with_rate(seg["sentry"]),
        "idle": seg["idle"],
        "kwh_per_pct": round(kpp, 3),
    }


@app.get("/api/efficiency/trend")
def efficiency_trend(car_id: int | None = Query(default=None),
                     days: int = Query(default=30, ge=1, le=90)):
    """每次行程的平均能耗(Wh/km)时间轴,由理想续航差值 × 校准系数估算。
    只统计超过 2 km 的行程(挪车等短行程能耗失真,不计入)。"""
    cid = get_car_id(car_id)
    ratio = kwh_per_ideal_km(cid)
    rows = q(
        f"""
        SELECT d.id, {local_ts('d.start_date', 'start_date')},
               d.distance, d.duration_min,
               d.start_ideal_range_km, d.end_ideal_range_km,
               a1.name AS start_name, a2.name AS end_name
        FROM drives d
        LEFT JOIN addresses a1 ON a1.id = d.start_address_id
        LEFT JOIN addresses a2 ON a2.id = d.end_address_id
        WHERE d.car_id = %s AND d.start_date >= now() - make_interval(days => %s)
          AND d.distance > 2
        ORDER BY d.start_date
        """,
        (cid, days),
    )
    points = []
    for r in rows:
        if (r["start_ideal_range_km"] is None or r["end_ideal_range_km"] is None
                or not r["distance"]):
            continue
        delta_km = float(r["start_ideal_range_km"] - r["end_ideal_range_km"])
        if delta_km <= 0:
            continue
        points.append({
            "start_ts": int(r["start_date_ts"]),
            "eff_wh_km": round(delta_km * ratio * 1000 / float(r["distance"]), 0),
            "distance": float(r["distance"]),
            "duration_min": int(r["duration_min"] or 0),
            "start_name": r["start_name"], "end_name": r["end_name"],
        })
    return {"kwh_per_ideal_km": ratio, "points": points}


@app.get("/api/battery/health")
def battery_health(car_id: int | None = Query(default=None)):
    """满电容量估算与电池健康度。

    每次充电:满电容量 ≈ 充电量 ÷ 表显电量增幅 × 100(口径含充电损耗,
    只用于相对比较)。基准 = 全部有效估算的最高值,真实值 = 最新一次充电
    的估算值,健康度 = 最新 ÷ 最高。两道离群过滤(增幅 ≥10%、容量 30–150
    kWh)必须保留:否则一次异常偏高的估算会永久抬高基准、压低健康度。
    """
    cid = get_car_id(car_id)
    rows = q(
        f"""
        SELECT {local_ts('cp.start_date', 'start_date')},
               cp.charge_energy_added, cp.start_battery_level, cp.end_battery_level
        FROM charging_processes cp
        WHERE cp.car_id = %s AND cp.charge_energy_added IS NOT NULL
          AND cp.end_battery_level > cp.start_battery_level
        ORDER BY cp.start_date
        """,
        (cid,),
    )
    points = []
    for r in rows:
        delta = int(r["end_battery_level"]) - int(r["start_battery_level"])
        if delta < 10:  # 增幅太小,估算误差大
            continue
        cap = float(r["charge_energy_added"]) / delta * 100
        if 30 <= cap <= 150:  # 合理区间过滤离群值
            points.append({"ts": int(r["start_date_ts"]), "kwh": round(cap, 1)})
    if not points:
        return {"current_kwh": None, "nominal_kwh": None, "health_pct": None,
                "samples": 0, "last_ts": None}
    nominal = max(p["kwh"] for p in points)
    current = points[-1]["kwh"]
    return {
        "current_kwh": round(current, 1),
        "nominal_kwh": round(nominal, 1),
        "health_pct": round(min(100.0, current / nominal * 100), 1),
        "samples": len(points),
        "last_ts": points[-1]["ts"],
    }


@app.get("/api/energy/cycles")
def energy_cycles(car_id: int | None = Query(default=None),
                  limit: int = Query(default=6, ge=1, le=20)):
    """按充电周期划分能量去向:每次充电结束 → 下次充电开始(进行中的周期到现在)。

    相邻两次充电间隔 <30 分钟或间隔内无行驶的,合并为同一周期(充电中断续充)。
    每段:充至电量 level_after;未充 = 100 - level_after;周期内行驶能耗按
    理想续航差值 × 校准系数折算;哨兵/驻车耗电(含驻车空调与休眠掉电)由
    电量采样分段(_split_segments),单位均为电池 %。周期末剩余 = 下次充电起始电量,
    进行中的周期 = 当前可用电量。
    """
    cid = get_car_id(car_id)
    ratio = kwh_per_ideal_km(cid)
    charges = q(
        f"""
        SELECT cp.id, cp.end_date AS end_date_utc,
               {local_ts('cp.start_date', 'start_date')},
               {local_ts('cp.end_date', 'end_date')},
               cp.start_battery_level, cp.end_battery_level, cp.charge_energy_added
        FROM charging_processes cp
        WHERE cp.car_id = %s AND cp.end_date IS NOT NULL
          AND cp.start_battery_level IS NOT NULL AND cp.end_battery_level IS NOT NULL
        ORDER BY cp.start_date DESC
        LIMIT %s
        """,
        (cid, limit * 3 + 3),  # 多取:零碎充电会被合并,且最旧一组需要下一次充电界定期末剩余
    )
    if not charges:
        return {"cycles": []}
    charges.reverse()  # 升序

    # 每次充电的满电容量估算(供 % → kWh 换算);全局最近几次中位数作回退
    def cap_of(c):
        delta = int(c["end_battery_level"]) - int(c["start_battery_level"])
        if delta >= 10 and c["charge_energy_added"]:
            cap = float(c["charge_energy_added"]) / delta * 100
            if 30 <= cap <= 150:
                return round(cap, 1)
        return None

    valid_caps = [cap for cap in (cap_of(c) for c in charges) if cap is not None]
    recent = valid_caps[-3:]
    current_cap = sorted(recent)[len(recent) // 2] if recent \
        else round(kwh_per_pct(cid) * 100, 1)

    lat = q(
        "SELECT usable_battery_level FROM positions "
        "WHERE car_id = %s AND usable_battery_level IS NOT NULL "
        "ORDER BY date DESC LIMIT 1",
        (cid,),
    )
    usable_now = int(lat[0]["usable_battery_level"]) if lat else None

    oldest_naive = charges[0]["end_date_utc"]
    samples = _battery_samples(cid, oldest_naive)
    drive_rows = q(
        f"""
        SELECT {local_ts('d.start_date', 'start_date')},
               {local_ts('d.end_date', 'end_date')},
               d.start_ideal_range_km, d.end_ideal_range_km, d.distance
        FROM drives d
        WHERE d.car_id = %s AND d.start_date >= %s
        ORDER BY d.start_date
        """,
        (cid, oldest_naive),
    )
    drives = []
    for d in drive_rows:
        kwh = 0.0
        if (d["start_ideal_range_km"] is not None
                and d["end_ideal_range_km"] is not None):
            delta = float(d["start_ideal_range_km"] - d["end_ideal_range_km"])
            if delta > 0:
                kwh = delta * ratio
        drives.append((int(d["start_date_ts"]), int(d["end_date_ts"]), kwh,
                       float(d["distance"] or 0)))

    now_ms = int(time.time() * 1000)

    # 分组:相邻两次充电间隔 <30 分钟或间隔内没有行驶 → 合并为同一周期
    # (例如充电中断后马上续充,或插上电未开走又补电)
    groups = []
    for c in charges:
        if groups:
            prev_end = int(groups[-1][-1]["end_date_ts"])
            gap = int(c["start_date_ts"]) - prev_end
            drove = any(a < int(c["start_date_ts"]) and b > prev_end
                        for a, b, _, _ in drives)
            if gap < 30 * 60 * 1000 or not drove:
                groups[-1].append(c)
                continue
        groups.append([c])

    cycles_all = []
    for gi, grp in enumerate(groups):
        first, last = grp[0], grp[-1]
        s = int(first["end_date_ts"])
        nxt = groups[gi + 1][0] if gi + 1 < len(groups) else None
        e = int(nxt["start_date_ts"]) if nxt else now_ms
        cyc_samples = [smp for smp in samples if s <= smp[0] <= e]
        # 挖除行驶与(被合并进来的)中途充电区间,避免电量跳变污染耗电归因
        cyc_iv = [(a, b) for a, b, _, _ in drives if a < e and b > s]
        cyc_iv += [(int(c["start_date_ts"]), int(c["end_date_ts"]))
                   for c in grp[1:]]
        seg = _split_segments(cyc_samples, cyc_iv)
        sentry_pct = max(0.0, -sum(p["delta"] for p in seg["sentry"]))
        # 驻车耗电合并:驻车开空调(kind='climate')与休眠间隙掉电(kind='asleep')
        # 都算「车未行驶时的耗电」,哨兵(驻车清醒且无空调)单列
        idle_pct = max(0.0, -sum(p["delta"] for p in seg["idle"]))
        drive_kwh = sum(k for a, _, k, _ in drives if s <= a < e)
        drive_km = sum(km for a, _, _, km in drives if s <= a < e)
        # 合并组的满电容量:总充电量 ÷ 总增幅,比单次更稳
        cap = None
        delta_grp = int(last["end_battery_level"]) - int(first["start_battery_level"])
        added_grp = sum(float(c["charge_energy_added"] or 0) for c in grp)
        if delta_grp >= 10 and added_grp > 0:
            cap_g = added_grp / delta_grp * 100
            if 30 <= cap_g <= 150:
                cap = round(cap_g, 1)
        cap = cap or cap_of(last) or current_cap
        level_after = int(last["end_battery_level"])
        remaining = int(nxt["start_battery_level"]) if nxt else usable_now
        if remaining is None:  # 无最新电量:用残差兜底
            remaining = max(0.0, level_after - drive_kwh / cap * 100
                            - sentry_pct - idle_pct)
        cycles_all.append({
            "charge_id": last["id"],
            "charge_count": len(grp),
            "charge_end_ts": int(last["end_date_ts"]),
            "charge_end_local": last["end_date_local"],
            "level_after": level_after,
            "uncharged_pct": max(0, 100 - level_after),
            "cap_kwh": cap,
            "drive_pct": round(drive_kwh / cap * 100, 1),
            "drive_kwh": round(drive_kwh, 2),
            "drive_km": round(drive_km, 1),
            "sentry_pct": round(sentry_pct, 1),
            "idle_pct": round(idle_pct, 1),
            "remaining_pct": round(float(remaining), 1),
            "active": nxt is None,
        })
    return {"cycles": cycles_all[-limit:][::-1]}  # 新的在前


@app.get("/api/tpms/trend")
def tpms_trend(car_id: int | None = Query(default=None),
               days: int = Query(default=7, ge=1, le=30)):
    """四轮胎压(bar)时间轴,按分桶取首条降采样。"""
    cid = get_car_id(car_id)
    step = 120 if days <= 2 else 300 if days <= 7 else 900
    rows = q(
        """
        SELECT DISTINCT ON (b) date, tpms_pressure_fl, tpms_pressure_fr,
               tpms_pressure_rl, tpms_pressure_rr
        FROM (
            SELECT date, tpms_pressure_fl, tpms_pressure_fr,
                   tpms_pressure_rl, tpms_pressure_rr,
                   floor(extract(epoch FROM date) / %s)::bigint AS b
            FROM positions
            WHERE car_id = %s AND date >= now() - make_interval(days => %s)
              AND (tpms_pressure_fl IS NOT NULL OR tpms_pressure_fr IS NOT NULL
                   OR tpms_pressure_rl IS NOT NULL OR tpms_pressure_rr IS NOT NULL)
        ) t
        ORDER BY b, date
        """,
        (step, cid, days),
    )
    wheels = {"fl": [], "fr": [], "rl": [], "rr": []}
    for r in rows:
        ts = _utc_ms(r["date"])
        for key, col in (("fl", "tpms_pressure_fl"), ("fr", "tpms_pressure_fr"),
                         ("rl", "tpms_pressure_rl"), ("rr", "tpms_pressure_rr")):
            if r[col] is not None:
                wheels[key].append([ts, float(r[col])])
    return {"days": days, "step_seconds": step, "wheels": wheels}


@app.get("/api/temp/trend")
def temp_trend(car_id: int | None = Query(default=None),
               days: int = Query(default=7, ge=1, le=30)):
    """车内/车外温度(°C)时间轴,按分桶取首条降采样;仅车辆清醒时段上报。"""
    cid = get_car_id(car_id)
    step = 120 if days <= 2 else 300 if days <= 7 else 900
    rows = q(
        """
        SELECT DISTINCT ON (b) date, inside_temp, outside_temp
        FROM (
            SELECT date, inside_temp, outside_temp,
                   floor(extract(epoch FROM date) / %s)::bigint AS b
            FROM positions
            WHERE car_id = %s AND date >= now() - make_interval(days => %s)
              AND (inside_temp IS NOT NULL OR outside_temp IS NOT NULL)
        ) t
        ORDER BY b, date
        """,
        (step, cid, days),
    )
    inside, outside = [], []
    for r in rows:
        ts = _utc_ms(r["date"])
        if r["inside_temp"] is not None:
            inside.append([ts, float(r["inside_temp"])])
        if r["outside_temp"] is not None:
            outside.append([ts, float(r["outside_temp"])])
    return {"days": days, "step_seconds": step, "inside": inside, "outside": outside}


# ---------- 车况页「生涯总览」(总里程 / 总耗电量 / 充电总费用) ----------

# 驻车耗电聚合要扫全量 positions(约 1s),结果内存缓存 10 分钟
_lifetime_cache: dict[int, tuple[float, dict]] = {}
_LIFETIME_TTL = 600.0


@app.get("/api/vehicle/lifetime")
def vehicle_lifetime(car_id: int | None = Query(default=None)):
    """总里程(表显)、总耗电量(行驶+驻车)、充电总费用。

    总耗电量 = 全部行程理想续航差 × kwh_per_ideal_km
             + 驻车时段表显电量降幅合计 × kwh_per_pct(排除行程/充电区间);
    充电总费用与各次计价(手填费用 > 家充峰谷自动价)同 /api/charging/sessions 口径。
    能耗与费用仅覆盖 TeslaMate 统计区间(since 起),总里程为车辆表显全生涯。
    """
    cid = get_car_id(car_id)
    hit = _lifetime_cache.get(cid)
    if hit and time.monotonic() - hit[0] < _LIFETIME_TTL:
        return hit[1]

    latest = q(
        "SELECT odometer FROM positions WHERE car_id = %s AND odometer IS NOT NULL "
        "ORDER BY date DESC LIMIT 1",
        (cid,),
    )
    since = q("SELECT min(date) AS d FROM positions WHERE car_id = %s", (cid,))[0]["d"]
    drv = q(
        """
        SELECT coalesce(sum(distance), 0) AS km,
               coalesce(sum(start_ideal_range_km - end_ideal_range_km)
                 FILTER (WHERE start_ideal_range_km IS NOT NULL
                          AND end_ideal_range_km IS NOT NULL), 0) AS ideal_delta_km
        FROM drives WHERE car_id = %s
        """,
        (cid,),
    )[0]
    drive_kwh = float(drv["ideal_delta_km"]) * kwh_per_ideal_km(cid)

    # 驻车耗电:相邻采样(间隔 ≤6h)表显电量下降合计,行程/充电区间内的下降不计
    parked = q(
        """
        WITH p AS (
          SELECT date, battery_level,
                 lag(battery_level) OVER w AS prev_lvl,
                 lag(date) OVER w AS prev_date
          FROM positions
          WHERE car_id = %s AND battery_level IS NOT NULL
          WINDOW w AS (ORDER BY date)
        ), drops AS (
          SELECT date, prev_lvl - battery_level AS drop_pct
          FROM p WHERE battery_level < prev_lvl
             AND date - prev_date < interval '6 hours'
        )
        SELECT coalesce(sum(drop_pct), 0) AS pct FROM drops d
        WHERE NOT EXISTS (SELECT 1 FROM drives dr WHERE dr.car_id = %s
                          AND d.date BETWEEN dr.start_date AND coalesce(dr.end_date, now()))
          AND NOT EXISTS (SELECT 1 FROM charging_processes cp WHERE cp.car_id = %s
                          AND d.date BETWEEN cp.start_date AND coalesce(cp.end_date, now()))
        """,
        (cid, cid, cid),
    )[0]
    parked_kwh = float(parked["pct"]) * kwh_per_pct(cid)

    # 充电总费用:手填 > 家充峰谷自动,计费电量 = 总耗电(手填/车端)优先退回充电量
    rows = q(
        f"""
        SELECT cp.id, {local_ts('cp.start_date', 'start_date')},
               {local_ts('cp.end_date', 'end_date')},
               cp.charge_energy_added, cp.charge_energy_used,
               cp.start_battery_level, cp.end_battery_level,
               cp.address_id, cp.geofence_id
        FROM charging_processes cp WHERE cp.car_id = %s ORDER BY cp.start_date
        """,
        (cid,),
    )
    costs = _load_costs()
    extras = _load_extras()
    home_cfg = _home_charge_cfg()
    home_assigns = _manual_all("charge_home")
    total_cost = 0.0
    priced_kwh = 0.0
    priced_sessions = 0
    charged_kwh = 0.0
    nominal_kwh = 0.0  # 估算满电容量基准,口径同 /api/battery/health(有效估算的最高值)
    for r in rows:
        extra = extras["charges"].get(str(r["id"])) or {}
        manual_total = extra.get("total_kwh")
        used = float(r["charge_energy_used"]) if r["charge_energy_used"] else None
        energy = float(r["charge_energy_added"]) if r["charge_energy_added"] else None
        total_kwh = float(manual_total) if manual_total is not None else used
        denom = total_kwh if total_kwh and total_kwh > 0 else energy
        cost = costs.get(str(r["id"]))
        if cost is None:
            key = _loc_key(r["address_id"], r["geofence_id"])
            hentry = _home_charge_resolve(home_cfg, home_assigns, r["id"], key)[1]
            hc = (_home_charge_cost(hentry, r["start_date_local"], r["end_date_local"], denom)
                  if hentry else None)
            cost = hc[0] if hc else None
        if cost is not None:
            total_cost += cost
            priced_sessions += 1
            priced_kwh += denom or 0.0
        # 电池循环:累计充电量 ÷ 估算满电容量
        if energy:
            charged_kwh += energy
            delta = int(r["end_battery_level"] or 0) - int(r["start_battery_level"] or 0)
            if delta >= 10:
                cap = energy / delta * 100
                if 30 <= cap <= 150:
                    nominal_kwh = max(nominal_kwh, cap)

    data = {
        "car_id": cid,
        "total_km": round(float(latest[0]["odometer"]), 1) if latest else None,
        "drive_km": round(float(drv["km"]), 1),
        "since": _utc_ms(since) if since else None,
        "drive_kwh": round(drive_kwh, 1),
        "parked_kwh": round(parked_kwh, 1),
        "total_kwh": round(drive_kwh + parked_kwh, 1),
        "total_cost": round(total_cost, 2),
        "sessions": len(rows),
        "priced_sessions": priced_sessions,
        "rate_yuan_kwh": (round(total_cost / priced_kwh, 4)
                          if priced_kwh > 0 else None),
        "charged_kwh": round(charged_kwh, 1),
        "nominal_kwh": round(nominal_kwh, 1) if nominal_kwh > 0 else None,
        "cycles": (round(charged_kwh / nominal_kwh, 1)
                   if nominal_kwh > 0 else None),
    }
    _lifetime_cache[cid] = (time.monotonic(), data)
    return data


# ---------- 个人中心 ----------

class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class UserAdd(BaseModel):
    username: str
    password: str
    role: str = "viewer"


@app.get("/api/device/cert/info")
def device_cert_info(request: Request):
    """设备证书状态与 p12 导出密码(仅管理员;enabled=免密通道是否已配置)。"""
    require_admin(request)
    password = ""
    try:
        with open("/data/pki/EXPORT_PASSWORD.txt", encoding="utf-8") as f:
            password = f.read().strip()
    except OSError:
        pass
    return {"enabled": bool(DEVICE_TRUST_TOKEN),
            "available": os.path.exists("/data/pki/iphone.p12"),
            "export_password": password}


@app.get("/api/device/cert")
def device_cert(request: Request):
    """下载 iPhone 免密设备证书(p12),仅管理员。证书由 scripts/make-device-cert.sh 生成;
    导出密码存 data/pki/EXPORT_PASSWORD.txt。吊销/换机:重跑该脚本 --new-ca 并重建 caddy。"""
    require_admin(request)
    p12 = "/data/pki/iphone.p12"
    if not os.path.exists(p12):
        raise HTTPException(status_code=404, detail="设备证书未生成:请先在服务器上运行 scripts/make-device-cert.sh")
    return FileResponse(p12, media_type="application/x-pkcs12", filename="iphone.p12")


@app.get("/api/account/status")
def account_status(request: Request):
    """个人中心:当前账号、账号列表、Tesla 授权/车辆/数据同步状态(指引步骤亮灯用)。

    TeslaMate 把 Tesla API 令牌加密存于 private.tokens;各查询均容错,
    全新部署(TeslaMate 尚未建表/无数据)时返回未就绪状态而非报错。
    """
    status: dict = {
        "user": getattr(request.state, "user", ""),
        "role": request.state.role,
        "users": sorted(auth_users()) if request.state.role == "admin" else [request.state.user],
        "roles": accounts.roles() if request.state.role == "admin" else {},
        "tesla": {"authorized": False, "token_updated_ts": None},
        "cars": [],
        "sync": {"last_data_ts": None, "positions": 0, "drives": 0, "charges": 0},
    }
    try:
        row = q("SELECT count(*) AS n, max(updated_at) AS last "
                "FROM private.tokens WHERE refresh IS NOT NULL")[0]
        status["tesla"] = {
            "authorized": int(row["n"]) > 0,
            "token_updated_ts": _utc_ms(row["last"]) if row["last"] else None,
        }
    except Exception:  # noqa: BLE001 — 表可能尚未创建
        pass
    try:
        status["cars"] = [
            {"id": r["id"], "name": r["name"], "model": r["model"],
             "trim": r["trim_badging"], "vin_tail": (r["vin"] or "")[-6:]}
            for r in q("SELECT id, name, model, trim_badging, vin FROM cars ORDER BY id")
        ]
    except Exception:  # noqa: BLE001
        pass
    try:
        row = q("SELECT max(date) AS last, count(*) AS n FROM positions")[0]
        status["sync"]["last_data_ts"] = _utc_ms(row["last"]) if row["last"] else None
        status["sync"]["positions"] = int(row["n"])
        status["sync"]["drives"] = int(q("SELECT count(*) AS n FROM drives")[0]["n"])
        status["sync"]["charges"] = int(
            q("SELECT count(*) AS n FROM charging_processes")[0]["n"])
    except Exception:  # noqa: BLE001
        pass
    status["steps"] = {
        "deployed": True,
        "authorized": status["tesla"]["authorized"],
        "car_detected": bool(status["cars"]),
        "synced": status["sync"]["positions"] > 0,
    }
    return status


@app.post("/api/account/password")
def change_password(body: PasswordChange, request: Request):
    key = (_client_ip(request), "password:" + request.state.user)
    if _is_locked(key):
        raise HTTPException(status_code=429, detail="尝试次数过多，请稍后再试")
    try:
        accounts.change_password(request.state.user, body.current_password, body.new_password)
    except ValueError as exc:
        _record_fail(key)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.post("/api/account/users")
def add_user(body: UserAdd, request: Request):
    require_admin(request)
    try:
        accounts.create_user(body.username, body.password, body.role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@app.delete("/api/account/users/{name}")
def remove_user(name: str, request: Request):
    require_admin(request)
    try:
        accounts.remove_user(name, request.state.user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


class LoginBody(BaseModel):
    username: str
    password: str


@app.get("/login")
def login_page(request: Request):
    """登录页(静态资源挂载之前注册以覆盖 /login):已登录用户直接回首页。"""
    token = request.cookies.get(SESSION_COOKIE, "")
    if token and _session_user(token):
        return RedirectResponse(url="/", status_code=302)
    return FileResponse(os.path.join(os.path.dirname(__file__), "static", "login.html"))


@app.post("/api/login")
def login(body: LoginBody, request: Request):
    """网页登录:校验账号后下发 HMAC 签名会话 Cookie(30 天);失败按 IP 限流。"""
    ip = (_client_ip(request), body.username[:32])
    if _is_locked(ip):
        raise HTTPException(status_code=429, detail="尝试次数过多,请稍后再试")
    stored = auth_users().get(body.username)
    if stored is None or not _verify_password(body.password, stored):
        _record_fail(ip)
        raise HTTPException(status_code=401, detail="用户名或密码不正确")
    resp = JSONResponse({"ok": True, "user": body.username})
    resp.set_cookie(
        SESSION_COOKIE, _make_session(body.username),
        max_age=SESSION_TTL, httponly=True, samesite="lax", path="/",
        secure=_https(request),
    )
    return resp


@app.post("/api/logout")
def logout(request: Request):
    """退出登录:清除会话 Cookie。"""
    accounts.revoke(request.cookies.get(SESSION_COOKIE, ""))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


from .backup import router as backup_router
from .control import router as control_router
from .parking import router as parking_router
from .vehicle import router as vehicle_router
from .prefs import router as prefs_router
app.include_router(backup_router)   # 须在 app.mount("/") 之前注册
from .fleet import router as fleet_router
app.include_router(fleet_router)
app.include_router(control_router)
from .nap import router as nap_router
app.include_router(nap_router)
from .sentry_sched import router as sentry_sched_router
app.include_router(sentry_sched_router)
app.include_router(parking_router)
app.include_router(vehicle_router)
app.include_router(prefs_router)
from .reminder import router as reminder_router
app.include_router(reminder_router)
from .monthly_backup import router as monthly_backup_router
app.include_router(monthly_backup_router)

app.mount("/", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"),
                           html=True), name="static")
