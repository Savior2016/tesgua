"""按月备份:遥测数据按月切分归档,支持下载/删除/合并恢复。

存储在 /data/backups/ttv-YYYY-MM.tar.gz(BACKUP_DIR 可覆盖),归档内容:
- manifest.json:月份、UTC 范围、各表行数
- 按月过滤的表(CSV,HEADER true):positions/drives/charging_processes/charges/states/updates
- 全量参考表:cars/addresses/geofences/car_settings/settings/panel_manual
- users.json(仅随归档保存;合并恢复时不覆盖现有账号)
不含 private.tokens(敏感;换机迁移请用整库导出)。

恢复为合并语义:临时表 + INSERT ... ON CONFLICT DO NOTHING,已有数据不动,
可重复导入。每月 2 号起调度线程自动补齐上月备份(只补缺失,不覆盖)。
独立成模块减少与 main.py 的并发修改冲突(同 parking.py 模式)。
"""
import json
import os
import re
import shutil
import tarfile
import tempfile
import threading
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

router = APIRouter(prefix="/api/backup/monthly", tags=["backup-monthly"])

BACKUP_DIR = os.environ.get("BACKUP_DIR", "/data/backups")
MONTH_RE = re.compile(r"^(20\d{2})-(0[1-9]|1[0-2])$")
FNAME_MONTH_RE = re.compile(r"(20\d{2})-(0[1-9]|1[0-2])")
AUTO_TICK_SECONDS = 3600

# 按月过滤的表: (表名, 过滤列)
MONTHLY_TABLES = [
    ("positions", "date"),
    ("drives", "start_date"),
    ("charging_processes", "start_date"),
    ("charges", "date"),
    ("states", "start_date"),
    ("updates", "start_date"),
]
# 全量附带的参考表
REF_TABLES = ["cars", "addresses", "geofences", "car_settings", "settings", "panel_manual"]
# 恢复顺序(满足外键依赖)
RESTORE_ORDER = ["cars", "addresses", "geofences", "car_settings", "settings",
                 "panel_manual", "positions", "drives", "charging_processes",
                 "charges", "states", "updates"]

_lock = threading.Lock()
_stop = threading.Event()
_thread = None


def _m():
    """延迟引用 main(避免循环导入);请求到来时 main 必然已加载完毕。"""
    from . import main
    return main


def _maintenance_conn():
    """恢复专用的高权限连接:面板连接池(teslahome_panel)对 TeslaMate 表只有 SELECT。

    凭据取 MAINTENANCE_DB_USER(默认 teslamate,表属主)+ MAINTENANCE_DB_PASSWORD
    (compose 里由 POSTGRES_PASSWORD 注入);未配置时给出明确指引而不是权限报错。
    """
    import psycopg
    main = _m()
    pw = os.environ.get("MAINTENANCE_DB_PASSWORD", "")
    if not pw:
        raise HTTPException(
            status_code=503,
            detail="未配置维护账号:请在 .env 设置 POSTGRES_PASSWORD 后重建面板容器")
    return psycopg.connect(host=main.DATABASE_HOST, port=main.DATABASE_PORT,
                           dbname=main.DATABASE_NAME,
                           user=os.environ.get("MAINTENANCE_DB_USER", "teslamate"),
                           password=pw, options="-c timezone=UTC")


def _tz() -> ZoneInfo:
    return ZoneInfo(_m().DISPLAY_TZ)


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    """本地月(1 号 00:00 → 下月 1 号 00:00)换算成 UTC naive 时间戳。

    库中 timestamp without time zone 按 UTC 存储(main.py 连接 options 固定 UTC)。
    """
    if not MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="月份格式应为 YYYY-MM")
    y, mth = int(month[:4]), int(month[5:])
    tz = _tz()
    start = datetime(y, mth, 1, tzinfo=tz)
    end = datetime(y + (mth == 12), mth % 12 + 1, 1, tzinfo=tz)
    return (start.astimezone(timezone.utc).replace(tzinfo=None),
            end.astimezone(timezone.utc).replace(tzinfo=None))


def _current_month() -> str:
    return datetime.now(_tz()).strftime("%Y-%m")


def _validate_month(month: str) -> str:
    if not MONTH_RE.match(month or ""):
        raise HTTPException(status_code=422, detail="月份格式应为 YYYY-MM")
    if month > _current_month():
        raise HTTPException(status_code=422, detail="不能备份未来月份")
    return month


def _archive_path(month: str) -> str:
    return os.path.join(BACKUP_DIR, f"ttv-{month}.tar.gz")


def _read_manifest(path: str) -> dict | None:
    """读取归档内 manifest.json(成员顺序上 manifest 在最前,读到即停)。"""
    try:
        with tarfile.open(path, "r:gz") as tar:
            for member in tar:
                if member.name == "manifest.json":
                    f = tar.extractfile(member)
                    if f:
                        return json.loads(f.read().decode("utf-8"))
                    return None
    except (tarfile.TarError, OSError, ValueError):
        return None
    return None


def _copy_table_to_csv(conn, table: str, dest_path: str,
                       where_col: str | None = None,
                       bounds: tuple[datetime, datetime] | None = None) -> int:
    """COPY (SELECT ...) TO STDOUT CSV 写入 dest_path,返回行数(COUNT 查询)。"""
    if where_col and bounds:
        cond = f"WHERE {where_col} >= '{bounds[0]:%Y-%m-%d %H:%M:%S}' " \
               f"AND {where_col} < '{bounds[1]:%Y-%m-%d %H:%M:%S}'"
    else:
        cond = ""
    count_sql = f"SELECT count(*) AS n FROM {table} {cond}"
    rows = conn.execute(count_sql).fetchone()["n"]
    copy_sql = f"COPY (SELECT * FROM {table} {cond}) TO STDOUT WITH (FORMAT csv, HEADER true)"
    with open(dest_path, "wb") as f:
        with conn.cursor().copy(copy_sql) as copy:
            while data := copy.read():
                f.write(data)
    return rows


def _generate(month: str) -> dict:
    """生成指定月份的归档(覆盖写),返回 manifest。调用方须持有 _lock。"""
    main = _m()
    bounds = _month_bounds(month)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    tmpdir = tempfile.mkdtemp(prefix="ttv-month-")
    try:
        tables: dict[str, int] = {}
        members: list[tuple[str, str]] = []  # (arcname, 本地路径)
        with main.pool.connection() as conn:
            conn.execute("SET TIME ZONE 'UTC'")
            for table, col in MONTHLY_TABLES:
                dest = os.path.join(tmpdir, f"{table}.csv")
                tables[table] = _copy_table_to_csv(conn, table, dest, col, bounds)
                members.append((f"{table}.csv", dest))
            for table in REF_TABLES:
                dest = os.path.join(tmpdir, f"{table}.csv")
                tables[table] = _copy_table_to_csv(conn, table, dest)
                members.append((f"{table}.csv", dest))
        stamp = datetime.now(_tz()).strftime("%Y-%m-%d %H:%M:%S %z")
        manifest = {
            "app": "tesla-home", "format_version": 3, "kind": "monthly",
            "month": month, "tz": main.DISPLAY_TZ,
            "range_utc": [bounds[0].isoformat(), bounds[1].isoformat()],
            "created_at": stamp, "tables": tables,
            "excludes": ["private.tokens"],
            "restore": "Merge semantics: INSERT ... ON CONFLICT DO NOTHING; users.json not restored.",
        }
        mpath = os.path.join(tmpdir, "manifest.json")
        with open(mpath, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False)
        out_tmp = os.path.join(tmpdir, "out.tar.gz")
        with tarfile.open(out_tmp, "w:gz") as tar:
            tar.add(mpath, arcname="manifest.json")
            for arcname, path in members:
                tar.add(path, arcname=arcname)
            tar.add(main.USERS_FILE, arcname="users.json")
        shutil.move(out_tmp, _archive_path(month))  # tmpdir 与 /data 可能不同设备
        manifest["size"] = os.path.getsize(_archive_path(month))
        return manifest
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def _list_months() -> list[dict]:
    """有数据的月份(新→旧)+ 各月备份状态。"""
    main = _m()
    row = main.q("SELECT min(date) AS lo, max(date) AS hi FROM positions")[0]
    months: list[str] = []
    if row["lo"] and row["hi"]:
        tz = _tz()
        lo = row["lo"].replace(tzinfo=timezone.utc).astimezone(tz)
        hi = max(row["hi"].replace(tzinfo=timezone.utc).astimezone(tz),
                 datetime.now(tz))
        cur = (lo.year, lo.month)
        while cur <= (hi.year, hi.month):
            months.append(f"{cur[0]:04d}-{cur[1]:02d}")
            cur = (cur[0] + (cur[1] == 12), cur[1] % 12 + 1)
    months.reverse()
    current = _current_month()
    out = []
    for month in months:
        info = {"month": month, "is_current": month == current, "backup": None}
        path = _archive_path(month)
        if os.path.exists(path):
            mf = _read_manifest(path) or {}
            info["backup"] = {
                "size": os.path.getsize(path),
                "created_at": mf.get("created_at"),
                "tables": mf.get("tables") or {},
            }
        out.append(info)
    return out


# ---------- 端点 ----------

@router.get("")
def list_monthly(request: Request):
    _m().require_admin(request)
    return {"months": _list_months()}


class GenerateRequest(BaseModel):
    month: str


@router.post("")
def generate_monthly(body: GenerateRequest, request: Request):
    _m().require_admin(request)
    month = _validate_month(body.month)
    if not _lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="已有备份任务进行中")
    try:
        return _generate(month)
    finally:
        _lock.release()


@router.get("/download")
def download_monthly(request: Request, months: str):
    main = _m()
    main.require_admin(request)
    picked = [m.strip() for m in (months or "").split(",") if m.strip()]
    if not picked or len(picked) > 120:
        raise HTTPException(status_code=422, detail="请勾选至少一个月")
    paths = []
    for mth in picked:
        _validate_month(mth)
        p = _archive_path(mth)
        if not os.path.exists(p):
            raise HTTPException(status_code=404, detail=f"{mth} 尚未备份")
        paths.append((mth, p))
    if len(paths) == 1:
        mth, p = paths[0]
        return FileResponse(p, filename=f"tesla-home-backup-{mth}.tar.gz",
                            media_type="application/gzip",
                            headers={"Content-Encoding": "identity", "Cache-Control": "no-store"})
    tmpdir = tempfile.mkdtemp(prefix="ttv-months-")
    name = f"tesla-home-backups-{paths[0][0]}_{paths[-1][0]}.tar.gz"
    out = os.path.join(tmpdir, name)
    try:
        with tarfile.open(out, "w:gz") as tar:
            for mth, p in paths:
                tar.add(p, arcname=f"tesla-home-backup-{mth}.tar.gz")
    except BaseException:
        shutil.rmtree(tmpdir, ignore_errors=True)
        raise
    return FileResponse(out, filename=name, media_type="application/gzip",
                        headers={"Content-Encoding": "identity", "Cache-Control": "no-store"},
                        background=BackgroundTask(shutil.rmtree, tmpdir, True))


@router.delete("/{month}")
def delete_monthly(month: str, request: Request):
    _m().require_admin(request)
    _validate_month(month)
    path = _archive_path(month)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="该月没有备份文件")
    os.remove(path)
    return {"deleted": month}


def _restore_csv(conn, table: str, csv_path: str) -> int:
    """临时表 + COPY FROM + INSERT ON CONFLICT DO NOTHING(合并语义)。"""
    tmp = f"tmp_restore_{table}"
    conn.execute(f"CREATE TEMP TABLE {tmp} (LIKE public.{table}) ON COMMIT DROP")
    with open(csv_path, "rb") as f:
        with conn.cursor().copy(
                f"COPY {tmp} FROM STDIN WITH (FORMAT csv, HEADER true)") as copy:
            while data := f.read(1 << 20):
                copy.write(data)
    cur = conn.execute(f"INSERT INTO public.{table} SELECT * FROM {tmp} ON CONFLICT DO NOTHING")
    return cur.rowcount


@router.post("/import")
def import_monthly(request: Request, file: UploadFile):
    main = _m()
    main.require_admin(request)
    if not _lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="已有备份任务进行中")
    tmpdir = tempfile.mkdtemp(prefix="ttv-restore-")
    try:
        up = os.path.join(tmpdir, "upload.tar.gz")
        with open(up, "wb") as f:
            shutil.copyfileobj(file.file, f)
        manifest = _read_manifest(up) or {}
        month = manifest.get("month")
        if not month:  # 兜底:从上传文件名识别 YYYY-MM
            m = FNAME_MONTH_RE.search(file.filename or "")
            month = m.group(0) if m else None
        if not month or not MONTH_RE.match(month):
            raise HTTPException(status_code=422, detail="无法识别备份月份(文件名或 manifest 中应有 YYYY-MM)")
        if manifest.get("kind") not in (None, "monthly"):
            raise HTTPException(status_code=422, detail="该文件不是按月备份,请使用整库恢复流程")
        with tarfile.open(up, "r:gz") as tar:
            tar.extractall(tmpdir, filter="data")
        inserted: dict[str, int] = {}
        with _maintenance_conn() as conn:
            conn.execute("SET TIME ZONE 'UTC'")
            for table in RESTORE_ORDER:
                csv_path = os.path.join(tmpdir, f"{table}.csv")
                if os.path.exists(csv_path):
                    inserted[table] = _restore_csv(conn, table, csv_path)
            conn.commit()
        return {"month": month, "inserted": inserted,
                "note": "合并恢复完成:已有数据未改动,面板账号不会被覆盖"}
    except HTTPException:
        raise
    except (tarfile.TarError, OSError) as exc:
        raise HTTPException(status_code=422, detail=f"备份包无法解析:{exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"恢复失败(数据库未改动或已回滚):{exc}") from exc
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        _lock.release()


# ---------- 自动生成线程:每月 2 号起补齐上月备份(只补缺失,不覆盖) ----------

def _auto_loop():
    while not _stop.wait(AUTO_TICK_SECONDS):
        try:
            tz = _tz()
            now = datetime.now(tz)
            if now.day < 2:
                continue
            prev = datetime(now.year if now.month > 1 else now.year - 1,
                            now.month - 1 if now.month > 1 else 12, 1)
            month = f"{prev.year:04d}-{prev.month:02d}"
            if os.path.exists(_archive_path(month)):
                continue
            if _lock.acquire(blocking=False):
                try:
                    _generate(month)
                finally:
                    _lock.release()
        except Exception:  # noqa: BLE001 — 自动生成失败不影响服务,下轮重试
            continue


def start_worker() -> None:
    global _thread
    if _thread:
        return
    _stop.clear()
    _thread = threading.Thread(target=_auto_loop, name="monthly-backup", daemon=True)
    _thread.start()


def stop_worker() -> None:
    _stop.set()
    if _thread:
        _thread.join(timeout=5)
