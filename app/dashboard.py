"""行车仪表盘:MQTT 实时状态快照 + WebSocket 推送。

数据全部来自 telemetry 的 MQTT 旁听(零新增 Tesla API 调用、零唤醒)。
WebSocket 不走 main.py 的 HTTP 中间件,须自行验签会话 cookie。
"""
import asyncio
import contextlib
import json
import queue as _queue

from fastapi import APIRouter, Query, WebSocket

from . import telemetry

router = APIRouter()


@router.get("/api/dash/snapshot")
def snapshot(car_id: int | None = Query(default=None)):
    """仪表盘首屏:MQTT 最新值 + 当前行程基线 + 充电 ETA(充电中)。

    行程基线(drives 未结束行的起始里程/电量)让前端能实时算
    本次里程与能耗,无需轮询整段行程数据。
    """
    from . import main
    cid = main.get_car_id(car_id)
    snap = telemetry.live_snapshot(cid)

    trip = None
    rows = main.q(
        "SELECT start_date, start_odometer, start_battery_level, "
        "start_ideal_range_km FROM drives "
        "WHERE car_id = %s AND end_date IS NULL "
        "ORDER BY start_date DESC LIMIT 1",
        (cid,),
    )
    if rows:
        r = rows[0]
        trip = {
            "start_ts": telemetry._utc_ms(r["start_date"]),
            "start_odometer": float(r["start_odometer"]) if r["start_odometer"] else None,
            "start_battery_level": r["start_battery_level"],
            "start_ideal_range_km": float(r["start_ideal_range_km"])
            if r["start_ideal_range_km"] else None,
        }

    eta = None
    if snap["values"].get("state") == "charging":
        from . import charge_eta
        try:
            eta = charge_eta.estimate(cid)
        except Exception:
            eta = None

    snap.update({
        "car_id": cid,
        "trip": trip,
        "kwh_per_pct": round(main.kwh_per_pct(cid), 3),
        "charge_eta": eta,
    })
    return snap


@router.websocket("/api/dash/ws")
async def dash_ws(ws: WebSocket, car_id: int | None = Query(default=None)):
    """实时推送 MQTT 变化帧 {k, v}。会话 cookie 验签,失败 4401。"""
    from . import main
    token = ws.cookies.get(main.SESSION_COOKIE, "")
    if not token or not main._session_user(token):
        await ws.close(code=4401)
        return
    cid = main.get_car_id(car_id)
    await ws.accept()
    q = telemetry.subscribe_dash()
    # q.get 带 5s 超时:to_thread 的线程不可被取消,若无超时,
    # 断开后线程永远阻塞在 get 上,事件循环关闭时 join 卡死
    idle = 0
    try:
        while True:
            try:
                cid_m, key, value = await asyncio.to_thread(q.get, True, 5.0)
                idle = 0
            except _queue.Empty:
                idle += 1
                if idle % 6 == 1:  # 每 ~30s 一个保活帧
                    await ws.send_text(json.dumps({"k": "_ping", "v": ""}))
                continue
            if cid_m != cid:
                continue
            await ws.send_text(json.dumps({"k": key, "v": value}))
    except Exception:
        pass  # 客户端断开/网络异常:清理订阅即可
    finally:
        telemetry.unsubscribe_dash(q)
        with contextlib.suppress(Exception):
            await ws.close()
