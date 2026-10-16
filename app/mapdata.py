"""离线矢量地图数据:状态查询 + 服务端后台下载(个人中心「离线地图」卡片)。

首次部署 /data/map 为空,地图页 503;管理员可在个人中心一键下载,
也可以宿主机跑 scripts/update-map-data.sh(两者产物相同)。
数据源:Protomaps 每日构建(OSM/Natural Earth,ODbL)+ basemaps-assets 字体/sprites,
均为公开资源;下载全程在服务端进行,浏览器只轮询状态。
"""
import os
import subprocess
import tarfile
import tempfile
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/map", tags=["map"])

MAP_DIR = Path(os.environ.get("MAP_DATA_DIR", "/data/map"))
PMTILES_VERSION = "1.30.1"
BBOX = "73.0,17.5,135.5,54.0"  # 中国及周边(与 scripts/update-map-data.sh 一致)
FONTS_BASE = "https://protomaps.github.io/basemaps-assets/fonts"
SPRITES_BASE = "https://protomaps.github.io/basemaps-assets/sprites/v4"
FONT_STACKS = ("Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic")

_lock = threading.Lock()
_job = None  # {"stage","detail","error","started_at","done"}


def _status_files():
    pm = MAP_DIR / "china.pmtiles"
    fonts = sum(1 for stack in FONT_STACKS for _ in (MAP_DIR / "fonts" / stack).glob("*.pbf")) \
        if (MAP_DIR / "fonts").is_dir() else 0
    sprites = len(list((MAP_DIR / "sprites").glob("*"))) if (MAP_DIR / "sprites").is_dir() else 0
    return {
        "installed": pm.is_file(),
        "size_mb": round(pm.stat().st_size / 1048576) if pm.is_file() else 0,
        "fonts": fonts,
        "sprites": sprites,
    }


@router.get("/status")
def map_status(request: Request):
    # 登录由全局中间件保证(未登录访问 /api/* 会被重定向/401)
    with _lock:
        job = dict(_job) if _job else None
    return {**_status_files(), "job": job}


@router.post("/download")
def map_download(request: Request):
    from . import main
    main.require_admin(request)
    global _job
    with _lock:
        if _job and not _job.get("done"):
            raise HTTPException(409, "地图数据正在下载中，请稍候")
        _job = {"stage": "starting", "detail": "", "error": "", "started_at": int(time.time()), "done": False}
    threading.Thread(target=_run, name="map-download", daemon=True).start()
    return {"ok": True}


def _set(stage, detail=""):
    with _lock:
        _job.update(stage=stage, detail=detail)


def _finish(error=""):
    with _lock:
        _job.update(stage="error" if error else "done", error=error, done=True)


def _urlretrieve(url, dest, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "tesgua-map-downloader"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)


def _ensure_cli():
    cli = Path("/tmp/pmtiles-bin/pmtiles")
    if cli.is_file() and os.access(cli, os.X_OK):
        return cli
    cli.parent.mkdir(parents=True, exist_ok=True)
    tarball = cli.parent / "pmtiles.tar.gz"
    _urlretrieve(
        f"https://github.com/protomaps/go-pmtiles/releases/download/v{PMTILES_VERSION}/"
        f"go-pmtiles_{PMTILES_VERSION}_Linux_x86_64.tar.gz", tarball)
    with tarfile.open(tarball) as tf:
        tf.extract(cli.parent, filter="data")
    cli.chmod(0o755)
    tarball.unlink()
    return cli


def _run():
    try:
        MAP_DIR.mkdir(parents=True, exist_ok=True)
        _set("cli", "下载 pmtiles 工具")
        cli = _ensure_cli()

        build = (datetime.now() - timedelta(days=3)).strftime("%Y%m%d")
        _set("pmtiles", f"提取中国区矢量瓦片(构建 {build},约 12GB,耗时取决于服务器带宽)")
        tmp_out = MAP_DIR / "china.pmtiles.new"
        with subprocess.Popen(
            [str(cli), "extract", f"https://build.protomaps.com/{build}.pmtiles",
             str(tmp_out), f"--bbox={BBOX}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        ) as proc:
            for line in proc.stdout or ():
                line = line.strip()
                if line:
                    _set("pmtiles", line[-120:])  # 进度行很长,只留尾部
            rc = proc.wait()
        if rc != 0 or not tmp_out.is_file():
            tmp_out.unlink(missing_ok=True)
            raise RuntimeError("pmtiles 提取失败,请检查服务器网络后重试")
        tmp_out.replace(MAP_DIR / "china.pmtiles")

        _set("fonts", "下载字体分块")
        for stack in FONT_STACKS:
            d = MAP_DIR / "fonts" / stack
            d.mkdir(parents=True, exist_ok=True)
            for lo in range(0, 65281, 256):
                f = d / f"{lo}-{lo + 255}.pbf"
                if f.is_file() and f.stat().st_size:
                    continue
                _set("fonts", f"{stack} {lo}/{65280}")
                try:
                    _urlretrieve(f"{FONTS_BASE}/{stack.replace(' ', '%20')}/{lo}-{lo + 255}.pbf",
                                 f, timeout=15)
                except Exception:  # 某段无字形属正常,404 由前端容错
                    f.unlink(missing_ok=True)

        _set("sprites", "下载 POI 图标")
        sd = MAP_DIR / "sprites"
        sd.mkdir(parents=True, exist_ok=True)
        for flav in ("light", "dark"):
            for v in ("", "@2x"):
                for ext in ("json", "png"):
                    _urlretrieve(f"{SPRITES_BASE}/{flav}{v}.{ext}", sd / f"{flav}{v}.{ext}", timeout=15)
        _finish()
    except Exception as exc:  # noqa: BLE001 — 错误只留通用描述,不带内部路径/URL 细节
        _finish(str(exc)[:150] or "下载失败,请稍后重试")
