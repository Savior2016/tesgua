"""面板个人偏好(默认时间范围等),按账号隔离。

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


class PrefsIn(BaseModel):
    days: int  # 默认时间范围:1 / 7 / 30 天


def _m():
    """延迟引用 main(避免循环导入);请求到来时 main 必然已加载完毕。"""
    from . import main
    return main


@router.get("")
def get_prefs(request: Request):
    """当前账号的偏好;未设置返回默认值。"""
    row = _m()._manual_all(_KIND).get(request.state.user) or {}
    days = row.get("days")
    return {"days": days if days in _DAYS else _DEFAULT_DAYS}


@router.post("")
def set_prefs(payload: PrefsIn, request: Request):
    """保存当前账号的偏好(upsert)。"""
    if payload.days not in _DAYS:
        raise HTTPException(status_code=422, detail="days 只能是 1 / 7 / 30")
    _m()._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES (%s, %s, %s)
        ON CONFLICT (kind, key) DO UPDATE SET payload = EXCLUDED.payload
        """,
        (_KIND, request.state.user, Jsonb({"days": payload.days})),
    )
    return {"ok": True, "days": payload.days}
