"""面板个人偏好(默认时间范围、总览样式等),按账号隔离。

存 panel_manual 表 kind='prefs'(key=用户名),随数据库备份/迁移走。
独立成模块减少与 main.py 的并发修改冲突(同 vehicle/parking 模式)。
viewer 也可读写自己的偏好:main.py 中间件已对 /api/prefs 放行非 GET。
"""
import re

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
# 总览 3D 模型:特斯拉车模 + 趣味模型(仅总览,无车身热点)
_OV_CAR_MODELS = _CTL_CAR_MODELS + ("sanbengzi", "mars-rover", "yaoyao", "ironman", "batmobile", "spiderman", "f40", "revuelto", "f1lm")
_CAR_MODELS = _OV_CAR_MODELS  # 兼容:旧代码/测试里的并集名单
_DEFAULT_CAR_MODEL = "y-yl"

# 车身颜色:特斯拉官方漆色名(TeslaMate cars.exterior_color)→ 展示用 hex。
# 3D 车漆材质用;未识别的颜色名回退默认(钻黑)。
_TESLA_COLORS = {
    "PearlWhite": ("珍珠白", "#e8e9e7"),
    "SolidBlack": ("纯黑", "#17191d"),
    "DiamondBlack": ("钻石黑", "#1b1d21"),
    "MidnightSilver": ("午夜银", "#5a5e63"),
    "StealthGrey": ("星空灰", "#4b4f55"),
    "DeepBlue": ("深海蓝", "#1e3a75"),
    "RedMulticoat": ("中国红", "#a6121c"),
    "UltraRed": ("烈焰红", "#b70f1e"),
    "Quicksilver": ("水银", "#a9adb2"),
    "MidnightCherryRed": ("午夜樱桃红", "#5e0e14"),
}
_DEFAULT_CAR_COLOR = "#17191d"   # 星钻黑
_CAR_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _detected_car_color() -> tuple[str | None, str | None]:
    """从 TeslaMate cars.exterior_color 读车辆漆色,返回 (hex, 原始名);无车/未识别 → (None, None)。"""
    try:
        rows = _m().q("SELECT exterior_color FROM cars ORDER BY id LIMIT 1")
    except Exception:  # noqa: BLE001 — 读失败只影响颜色展示
        return None, None
    raw = str(rows[0].get("exterior_color") or "") if rows else ""
    hit = _TESLA_COLORS.get(raw)
    return (hit[1], raw) if hit else (None, raw or None)


class PrefsIn(BaseModel):
    # 合并语义:缺省字段保留已存值,各设置(时间范围/总览样式/车模)互不覆盖
    days: int | None = None  # 默认时间范围:1 / 7 / 30 天
    overview_mode: str | None = None  # 总览样式:car(车模)/ data(数据)/ 3d(3D 全景)
    control_mode: str | None = None  # 控制样式:2d(2D 车身)/ 3d(3D 车模)
    car_model: str | None = None  # 控制页 3D 车模:y-yl / y-juniper / model-3 / cybertruck / y-legacy
    ov_car_model: str | None = None  # 总览 3D 模型:特斯拉车模 + 趣味模型(sanbengzi/mars-rover/yaoyao/ironman)
    car_color: str | None = None  # 车身颜色 #rrggbb;空串 = 清除(跟随车辆自动识别)


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
    # 车身颜色:手动覆盖 > TeslaMate 自动识别 > 默认钻黑
    cc = row.get("car_color")
    cc = cc.lower() if isinstance(cc, str) and _CAR_COLOR_RE.match(cc) else None
    detected, detected_raw = _detected_car_color()
    return {
        "days": days if days in _DAYS else _DEFAULT_DAYS,
        "overview_mode": ov if ov in _OV_MODES else _DEFAULT_OV_MODE,
        "control_mode": ct if ct in _CTL_MODES else _DEFAULT_CTL_MODE,
        "car_model": cm,
        "ov_car_model": ocm if ocm in _OV_CAR_MODELS else cm,
        "car_color": cc,                     # 手动覆盖;null = 自动
        "car_color_detected": detected,      # TeslaMate cars.exterior_color 识别结果
        "car_color_detected_name": detected_raw,
        "car_color_effective": cc or detected or _DEFAULT_CAR_COLOR,
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
    if (payload.car_color is not None and payload.car_color != ""
            and not _CAR_COLOR_RE.match(payload.car_color)):
        raise HTTPException(status_code=422, detail="car_color 只能是 #rrggbb 或空串(自动)")
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
    if payload.car_color is not None:
        if payload.car_color == "":
            row.pop("car_color", None)   # 空串 = 清除覆盖,回到自动识别
        else:
            row["car_color"] = payload.car_color.lower()
    _m()._exec(
        """
        INSERT INTO panel_manual (kind, key, payload) VALUES (%s, %s, %s)
        ON CONFLICT (kind, key) DO UPDATE SET payload = EXCLUDED.payload
        """,
        (_KIND, request.state.user, Jsonb(row)),
    )
    return {"ok": True, **get_prefs(request)}
