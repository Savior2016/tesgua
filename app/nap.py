"""Durable, single-worker camp-mode timer. Never replay a start after restart."""
import json
import os
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

router = APIRouter()
lock = threading.RLock()
ACTIVE = {"starting", "active", "stopping", "retrying"}


class NapTimer:
    """午休(定时露营)任务,按 VIN 分槽持久化为 {<vin>: job}。

    旧版单 job 文件(顶层即 job,含 phase 字段)在首次读取时无损迁移为
    {job.vin: job} 并原子写回;迁移失败时保持只读报错(见 read)。
    """

    def __init__(self, path, fetch, command, clock=time.time):
        self.path, self.fetch, self.command, self.clock = Path(path), fetch, command, clock

    def read(self):
        """读取全部任务 {vin: job};旧格式自动迁移。"""
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            raise HTTPException(503, "午休任务文件不可用，请检查服务器并在 Tesla App 确认露营模式") from None
        if not isinstance(data, dict):
            raise HTTPException(503, "午休任务文件不可用，请检查服务器并在 Tesla App 确认露营模式")
        if "phase" in data:  # 旧格式:顶层即单个 job
            job = data
            vin = job.get("vin")
            if not vin:
                raise HTTPException(503, "午休任务文件缺少车辆标识，请检查服务器")
            data = {vin: job}
            try:
                self._write_all(data)
            except OSError:
                pass  # 迁移写回失败不阻塞读取(下次再迁)
        return {v: j for v, j in data.items() if isinstance(j, dict)}

    def _write_all(self, jobs):
        from .fleet import atomic
        atomic(self.path, json.dumps(jobs).encode())

    def job(self, vin):
        return self.read().get(vin) or {}

    def write(self, vin, job):
        jobs = self.read()
        if job:
            jobs[vin] = job
        else:
            jobs.pop(vin, None)
        self._write_all(jobs)

    def public(self, vin):
        job = self.job(vin)
        return {k: job[k] for k in ("phase", "ends_at", "minutes", "until", "ac", "error", "updated_at", "attempts") if k in job}

    def active(self, vin=None):
        """指定车是否有进行中的任务;vin=None 时检查是否任意车有任务。"""
        jobs = self.read()
        if vin is not None:
            return (jobs.get(vin) or {}).get("phase") in ACTIVE
        return any(j.get("phase") in ACTIVE for j in jobs.values())

    def mode(self, vin):
        from .control import _fresh
        cs = self.fetch(vin).get("climate_state") or {}
        if not _fresh(cs):
            raise HTTPException(409, "无法确认当前露营模式，请让车辆在线后重试")
        value = cs.get("climate_keeper_mode")
        modes = {0: "off", 1: "on", 2: "dog", 3: "camp"}
        value = modes.get(value, str(value).lower())
        if value not in ("off", "on", "dog", "camp"):
            raise HTTPException(409, "此车辆暂未返回露营模式状态")
        return value

    def start(self, vin, minutes, until=None, ac="camp"):
        with lock:
            if self.active(vin):
                raise HTTPException(409, "该车已有午休任务，请先结束当前午休")
            if self.mode(vin) != "off":
                raise HTTPException(409, "车辆已开启驻车空调、宠物或露营模式，请先在 Tesla App 关闭后再开始午休")
            now = self.clock()
            ends_at = now + minutes * 60
            if until:  # 计时或到点先到先停
                ends_at = min(ends_at, _until_ts(until, now))
            job = {"phase":"starting", "vin":vin, "minutes":minutes, "ends_at":ends_at,
                   "updated_at":now, "attempts":0, "error":"", "ac":ac}
            if until:
                job["until"] = until
            if ac == "fan":
                # 不开空调:纯定时,不发任何车辆指令;到点由 tick 兜底关露营/空调
                job.update(phase="active")
                self.write(vin, job)
                return self.public(vin)
            self.write(vin, job)  # Persist shutdown obligation before any physical command.
            try:
                result = self.command("set_climate_keeper_mode", {"climate_keeper_mode":3}, vin)
            except Exception:
                job.update(phase="retrying", ends_at=self.clock(), error="开启结果未确认，服务器将检查并关闭露营模式；请同时在 Tesla App 确认")
                self.write(vin, job)
                raise HTTPException(502, job["error"]) from None
            if not result.get("ok"):
                job.update(phase="failed", error="车辆未接受露营指令，请检查车辆在线状态、档位和电量")
                self.write(vin, job)
                raise HTTPException(409, job["error"])
            job.update(phase="active", updated_at=self.clock())
            self.write(vin, job)
            return self.public(vin)

    def stop(self, vin):
        with lock:
            job = self.job(vin)
            if job.get("phase") in ACTIVE:
                job.update(phase="stopping", ends_at=self.clock(), next_retry=0)
                self.write(vin, job)
                self.tick()
            return self.public(vin)

    def tick(self):
        with lock:
            now = self.clock()
            for vin, job in self.read().items():
                if job.get("phase") not in ACTIVE or now < job["ends_at"] or now < job.get("next_retry", 0):
                    continue
                job = dict(job, phase="stopping", updated_at=now)
                self.write(vin, job)
                try:
                    # Never disable Dog/Keep Mode that the owner selected during their break.
                    mode = self.mode(job["vin"])
                    if mode == "camp":  # 露营兜底:车主午休中手动开了又忘关,到点照样关
                        result = self.command("set_climate_keeper_mode", {"climate_keeper_mode":0}, job["vin"])
                        if not result.get("ok"):
                            raise RuntimeError("shutdown not acknowledged")
                    elif mode == "off":
                        # 防忘关:车主午休中可能手动开了空调(非驻车模式),到点顺手关掉;失败不阻塞
                        try:
                            self.command("auto_conditioning_stop", {}, job["vin"])
                        except Exception:
                            pass
                    job.update(phase="completed", error="", updated_at=self.clock())
                except Exception:
                    attempts = job.get("attempts", 0) + 1
                    job.update(phase="retrying", attempts=attempts, next_retry=now+min(300, 15*2**min(attempts, 4)),
                               error="结束尚未确认，将自动重试；请在 Tesla App 检查露营模式")
                self.write(vin, job)


def _fetch(vin):
    from .control import vehicle_data
    return vehicle_data(vin)


def _command(cmd, args, vin):
    from .control import _forward
    return _forward(cmd, args, vin)


timer = NapTimer(os.environ.get("NAP_FILE", "/data/control-nap.json"), _fetch, _command)
_stop = threading.Event()
_thread = None


def status(car_id: int | None = None):
    """指定车的午休任务状态(car_id=None 时保持旧行为:数据库第一辆车)。"""
    from . import control
    with lock:
        try:
            return timer.public(control._vin(car_id))
        except HTTPException as e:
            if e.status_code == 503:  # 车辆未入库:无任务可管
                return {}
            raise


def ensure_idle():
    """控制授权变更前置检查:任意车有进行中的午休任务都拒绝(授权影响全部车)。"""
    if timer.active():
        raise HTTPException(409, "午休任务尚未结束，请先结束午休再修改控制授权")


def start_worker():
    global _thread
    _stop.clear()
    def run():
        while not _stop.is_set():
            try:
                timer.tick()
            except Exception:
                pass  # Corrupt task is reported by status; never log private task data.
            _stop.wait(2)
    _thread = threading.Thread(target=run, name="nap-shutdown", daemon=True)
    _thread.start()


def stop_worker():
    _stop.set()
    if _thread:
        _thread.join(timeout=55)


def _until_ts(until, now):
    """Next DISPLAY_TZ-local occurrence of HH:MM at or after `now` (tomorrow if past)."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo
    from .main import DISPLAY_TZ
    hour, minute = (int(x) for x in until.split(":"))
    tz = ZoneInfo(DISPLAY_TZ)
    target = datetime.fromtimestamp(now, tz).replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target.timestamp() <= now:
        target += timedelta(days=1)
    return target.timestamp()


class NapRequest(BaseModel):
    minutes: int = Field(ge=5, le=180, strict=True)
    until: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    ac: str = Field(default="camp", pattern=r"^(camp|fan)$")  # camp=露营开空调 / fan=不开空调(纯定时,不动车)


@router.post("/api/control/nap/start")
def start(body: NapRequest, request: Request, car_id: int | None = Query(default=None)):
    from . import main, control
    main.require_admin(request)
    cid = main.get_car_id(car_id)
    return timer.start(control._vin(cid), body.minutes, body.until, body.ac)


@router.post("/api/control/nap/stop")
def stop(request: Request, car_id: int | None = Query(default=None)):
    from . import main, control
    main.require_admin(request)
    cid = main.get_car_id(car_id)
    return timer.stop(control._vin(cid))
