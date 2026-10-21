"""多车支持:按车存储键、旧全局数据回退、VIN 解析的单元测试(全部走 mock DB)。"""
import json
import time

import pytest
from fastapi import HTTPException

from app import control, nap, sentry_sched


# ---------- nap:旧单 job 文件迁移 + 按 VIN 分槽 ----------

def _nap_timer(tmp_path, mode="off"):
    ts = time.time() * 1000
    payload = {"climate_state": {"timestamp": ts, "climate_keeper_mode": mode}}
    return nap.NapTimer(tmp_path / "nap.json", lambda vin: payload,
                        lambda cmd, args, vin: {"ok": True})


def test_nap_migrates_legacy_single_job_file(tmp_path):
    """旧格式(顶层即 job)首次读取时包装为 {vin: job} 并写回,内容不丢。"""
    path = tmp_path / "nap.json"
    legacy = {"phase": "active", "vin": "vin-a", "minutes": 30,
              "ends_at": time.time() + 600, "updated_at": time.time(), "attempts": 0, "error": ""}
    path.write_text(json.dumps(legacy))
    t = _nap_timer(tmp_path)
    t.path = path
    pub = t.public("vin-a")
    assert pub["phase"] == "active" and pub["minutes"] == 30
    assert json.loads(path.read_text()) == {"vin-a": legacy}  # 已原子写回新格式
    assert t.active("vin-a") and not t.active("vin-b")


def test_nap_active_any_car_guard(tmp_path):
    """ensure_idle 语义:任意车有进行中任务都算忙(控制授权变更前置检查)。"""
    t = _nap_timer(tmp_path)
    t.start("vin-a", 5)
    assert t.active()  # 不指定 vin:任意车
    assert t.active("vin-a") and not t.active("vin-b")


# ---------- control._vin:按 car_id 解析 + CONTROL_VIN 锁定 ----------

def _mock_cars(monkeypatch, rows):
    from app import main
    monkeypatch.setattr(main, "q",
                        lambda sql, params=(): [r for r in rows
                                                if not params or r["id"] == params[0]])


def test_vin_resolves_by_car_id(monkeypatch):
    monkeypatch.setattr(control, "CONTROL_VIN", "")
    _mock_cars(monkeypatch, [{"id": 1, "vin": "VIN-FIRST"}, {"id": 2, "vin": "VIN-SECOND"}])
    assert control._vin() == "VIN-FIRST"           # 不传保持旧行为(首辆车)
    assert control._vin(2) == "VIN-SECOND"
    with pytest.raises(HTTPException):
        control._vin(99)


def test_vin_env_locks_vehicle(monkeypatch):
    """设置 CONTROL_VIN 时恒定锁定该车,忽略 car_id(老部署行为完全不变)。"""
    monkeypatch.setattr(control, "CONTROL_VIN", "VIN-ENV")
    _mock_cars(monkeypatch, [{"id": 1, "vin": "VIN-FIRST"}])
    assert control._vin() == "VIN-ENV"
    assert control._vin(2) == "VIN-ENV"


# ---------- home_charge / delivery:按车 key + 旧全局回退 ----------

def test_home_charge_cfg_per_car_with_legacy_fallback(monkeypatch):
    from app import main
    rows = {"home_charge": {"master": True, "chargers": {"addr_7": {"peak": 1.0}}},
            "home_charge:2": {"master": False, "chargers": {}}}
    monkeypatch.setattr(main, "q", lambda sql, params=(): [
        {"key": k, "payload": v} for k, v in rows.items()])
    # 车 2 有按车配置:用自己的
    assert main._home_charge_cfg(2)["master"] is False
    # 车 1 无按车配置:回退旧全局 key
    assert main._home_charge_cfg(1)["master"] is True
    assert "addr_7" in main._home_charge_cfg(1)["chargers"]


def test_home_charge_save_uses_per_car_key(monkeypatch):
    from app import main
    written = []
    monkeypatch.setattr(main, "_exec", lambda sql, params=(): written.append(params))
    main._save_home_charge_cfg(3, {"master": True, "chargers": {}})
    assert written[0][0] == "home_charge:3"


def test_delivery_read_per_car_with_legacy_fallback(monkeypatch):
    from app import vehicle
    store = {"delivery_date": {"date": "2024-01-15"},
             "delivery_date:2": {"date": "2025-06-01"}}
    monkeypatch.setattr(vehicle, "_m", lambda: type("M", (), {
        "_manual_all": staticmethod(lambda kind: store)})())
    assert vehicle._read(2)["date"] == "2025-06-01"   # 按车配置优先
    assert vehicle._read(1)["date"] == "2024-01-15"   # 回退旧全局
    assert vehicle._read(9)["date"] == "2024-01-15"   # 无按车配置的车也回退


# ---------- sentry_sched:按车时段 + 旧全局归属首车 ----------

def test_sentry_schedule_per_car_with_legacy_first_car_fallback(monkeypatch):
    from app import main
    rows = {"slots": {"slots": [{"start": "22:00", "end": "07:00", "enabled": True}]},
            "slots:2": {"slots": [{"start": "12:00", "end": "13:00", "enabled": True}]}}
    monkeypatch.setattr(main, "_manual_all", lambda kind: rows)
    monkeypatch.setattr(main, "q", lambda sql, params=(): [{"id": 1}])
    # 首辆车:无按车配置时回退旧全局
    assert sentry_sched._read(1)["slots"][0]["start"] == "22:00"
    # 第二辆车:读自己的按车配置,绝不回退到首车的时段
    assert sentry_sched._read(2)["slots"][0]["start"] == "12:00"
    # 第三辆车:什么都没有(不回退)
    assert sentry_sched._read(3) == {}


def test_sentry_desired_overnight():
    slots = [{"start": "22:00", "end": "07:00", "enabled": True}]
    from datetime import datetime
    night = datetime(2026, 1, 1, 23, 30)
    noon = datetime(2026, 1, 1, 12, 0)
    assert sentry_sched.desired(slots, night) is True
    assert sentry_sched.desired(slots, noon) is False
    assert sentry_sched.desired([{**slots[0], "enabled": False}], night) is False


# ---------- parking:旧记录归属首车 ----------

def test_parking_belongs():
    from app import parking
    assert parking._belongs({"car_id": 2}, 2, 1) is True
    assert parking._belongs({"car_id": 2}, 1, 1) is False
    assert parking._belongs({}, 1, 1) is True   # 旧记录归首车
    assert parking._belongs({}, 2, 1) is False
