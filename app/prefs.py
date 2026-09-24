"""面板个人偏好(默认时间范围、总览样式等),按账号隔离。

存 panel_manual 表 kind='prefs'(key=用户名),随数据库备份/迁移走。
独立成模块减少与 main.py 的并发修改冲突(同 vehicle/parking 模式)。
viewer 也可读写自己的偏好:main.py 中间件已对 /api/prefs 放行非 GET。
"""
from fastapi import APIRouter, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel

router = APIRouter(prefix="/api/prefs", tags=["prefs"])

_KIND = "prefs"
_DAYS = (1, 7, 30)
_DEFAULT_DAYS = 7
_OV_MODES = ("car", "data")  # 总览样式:车模模式 / 数据模式
_DEFAULT_OV_MODE = "car"


class PrefsIn(BaseModel):
    # 合并语义:缺省字段保留已存值,两个设置(时间范围/总览样式)互不覆盖
    days: int | None = None  # 默认时间范围:1 / 7 / 30 天
    overview_mode: str | None = None  # 总览样式:car(车模)/ data(数据)


def _m():
    """延迟引用 main(避免循环导入);请求到来时 main 必然已加载完毕。"""
    from . import main
    return main


def _prefs_of(user: str) -> dict:
    return dict(_m()._manual_all(_KIND).get(user) or {})


@router.get("")
def get_prefs(request: Request):
    """当前账号的偏好;未设置返回默认值。"""
    row = _prefs_of(request.state.user)
    days = row.get("days")
    ov = row.get("overview_mode")
    return {
        "days": days if days in _DAYS else _DEFAULT_DAYS,
        "overview_mode": ov if ov in _OV_MODES else _DEFAULT_OV_MODE,
    }


@router.post("")
def set_prefs(payload: PrefsIn, request: Request):
    """保存当前账号的偏好(合并语义 upsert:只更新传入的字段)。"""
    if payload.days is not None and payload.days not in _DAYS:
        raise HTTPException(status_code=422, detail="days 只能是 1 / 7 / 30")
    if payload.overview_mode is not None and payload.overview_mode not in _OV_MODES:
        raise HTTPException(status_code=422, detail="overview_mode 只能是 car / data")
    row = _prefs_of(request.state.user)
    if payload.days is not None:
        row["days"] = payload.days
    if payload.overview_mode is not None:
        row["overview_mode"] = payload.overview_mode
    _m()._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES (%s, %s, %s)
        ON CONFLICT (kind, key) DO UPDATE SET payload = EXCLUDED.payload
        """,
        (_KIND, request.state.user, Jsonb(row)),
    )
    return {"ok": True, **get_prefs(request)}
