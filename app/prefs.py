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
_OV_MODES = ("car", "data", "3d")  # 总览样式:车模模式 / 数据模式 / 3D 全景
_DEFAULT_OV_MODE = "3d"
_CTL_MODES = ("2d", "3d")  # 控制样式:2D 车身俯视图 / 3D 车模
_DEFAULT_CTL_MODE = "2d"
# 车模显示(test 页 3D 注册表键;y-yl 暂无真模型,占位方案随注册表实现)
_CTL_CAR_MODELS = ("y-yl", "y-juniper", "model-3", "cybertruck", "y-legacy")
# 总览 3D 模型:特斯拉车模 + 趣味模型(sanbengzi/mars-rover/yaoyao 仅总览,无车身热点)
_OV_CAR_MODELS = _CTL_CAR_MODELS + ("sanbengzi", "mars-rover", "yaoyao")
_CAR_MODELS = _OV_CAR_MODELS  # 兼容:旧代码/测试里的并集名单
_DEFAULT_CAR_MODEL = "y-yl"


class PrefsIn(BaseModel):
    # 合并语义:缺省字段保留已存值,各设置(时间范围/总览样式/车模)互不覆盖
    days: int | None = None  # 默认时间范围:1 / 7 / 30 天
    overview_mode: str | None = None  # 总览样式:car(车模)/ data(数据)/ 3d(3D 全景)
    control_mode: str | None = None  # 控制样式:2d(2D 车身)/ 3d(3D 车模)
    car_model: str | None = None  # 控制页 3D 车模:y-yl / y-juniper / model-3 / cybertruck / y-legacy
    ov_car_model: str | None = None  # 总览 3D 模型:特斯拉车模 + 趣味模型(sanbengzi/mars-rover/yaoyao)


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
    ct = row.get("control_mode")
    cm = row.get("car_model")
    ocm = row.get("ov_car_model")
    # 老账号迁移:car_model 存的是趣味模型(旧并集名单允许)→ 视作总览模型的选择
    if cm in _OV_CAR_MODELS and cm not in _CTL_CAR_MODELS and ocm is None:
        ocm = cm
    # 控制页车模兜底 y-yl;总览模型未单独设置时跟随控制页选择(老账号无缝迁移)
    cm = cm if cm in _CTL_CAR_MODELS else _DEFAULT_CAR_MODEL
    return {
        "days": days if days in _DAYS else _DEFAULT_DAYS,
        "overview_mode": ov if ov in _OV_MODES else _DEFAULT_OV_MODE,
        "control_mode": ct if ct in _CTL_MODES else _DEFAULT_CTL_MODE,
        "car_model": cm,
        "ov_car_model": ocm if ocm in _OV_CAR_MODELS else cm,
    }


@router.post("")
def set_prefs(payload: PrefsIn, request: Request):
    """保存当前账号的偏好(合并语义 upsert:只更新传入的字段)。"""
    if payload.days is not None and payload.days not in _DAYS:
        raise HTTPException(status_code=422, detail="days 只能是 1 / 7 / 30")
    if payload.overview_mode is not None and payload.overview_mode not in _OV_MODES:
        raise HTTPException(status_code=422, detail="overview_mode 只能是 car / data / 3d")
    if payload.control_mode is not None and payload.control_mode not in _CTL_MODES:
        raise HTTPException(status_code=422, detail="control_mode 只能是 2d / 3d")
    if payload.car_model is not None and payload.car_model not in _CTL_CAR_MODELS:
        raise HTTPException(status_code=422, detail="car_model 未知车型键(控制页仅特斯拉车模)")
    if payload.ov_car_model is not None and payload.ov_car_model not in _OV_CAR_MODELS:
        raise HTTPException(status_code=422, detail="ov_car_model 未知模型键")
    row = _prefs_of(request.state.user)
    if payload.days is not None:
        row["days"] = payload.days
    if payload.overview_mode is not None:
        row["overview_mode"] = payload.overview_mode
    if payload.control_mode is not None:
        row["control_mode"] = payload.control_mode
    if payload.car_model is not None:
        row["car_model"] = payload.car_model
    if payload.ov_car_model is not None:
        row["ov_car_model"] = payload.ov_car_model
    _m()._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES (%s, %s, %s)
        ON CONFLICT (kind, key) DO UPDATE SET payload = EXCLUDED.payload
        """,
        (_KIND, request.state.user, Jsonb(row)),
    )
    return {"ok": True, **get_prefs(request)}
