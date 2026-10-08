#!/usr/bin/env python3
"""趣味 3D 模型归一化与拼装 —— 生成 app/static/models/fun/ 下的展示模型。

统一约定(与 car3d.js 注册表一致):车头/正面 = -Z,地面 = y=0,XZ 居中。
源模型均为 draco 压缩 GLB(需 DracoPy),导出为未压缩 GLB(面板 GLTFLoader
只挂了 MeshoptDecoder,没有 DRACOLoader,不能直接服源码)。

产出:
  sanbengzi.glb  三蹦子  —— Street Vendor Cart(Alan Zimmerman @ poly.pizza, CC-BY 3.0)
  mars-rover.glb 火星车  —— Mars 2020 Perseverance Rover(NASA, 3D Resources)
  yaoyao.glb     摇摇车  —— Quaternius "Car"(CC0)+ 程序化弹簧底座拼装
"""
import numpy as np
import trimesh

SRC = "/tmp/pvmodels"
OUT = "/home/ubuntu/teslamate-visualizer/app/static/models/fun"


def dump_meshes(scene):
    """场景展平成 [(mesh, material_name)] 列表(变换已烘焙)。"""
    return list(scene.dump())


def rot_y(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [0, 1, 0])


def normalize(scene, target_len):
    """XZ 居中、落地(y_min=0)、最长水平轴缩放到 target_len。要求已手动转正。"""
    scene.apply_transform(trimesh.transformations.translation_matrix([0, 0, 0]))
    b = scene.bounds
    ext = b[1] - b[0]
    s = target_len / max(ext[0], ext[2])
    c = (b[0] + b[1]) / 2
    T = (trimesh.transformations.translation_matrix([-c[0], -b[0][1], -c[2]])
         @ trimesh.transformations.scale_matrix(s))
    # 先平移落地再缩放:scale_matrix 会缩放平移前的坐标,合成顺序 = 先 T1 后 S
    T = trimesh.transformations.scale_matrix(s) @ \
        trimesh.transformations.translation_matrix([-c[0], -b[0][1], -c[2]])
    scene.apply_transform(T)
    return scene


def export(scene, path):
    for g in scene.geometry.values():   # trimesh 导出可能丢 NORMAL,先强制算出来
        _ = g.vertex_normals
    scene.export(path)
    # 校验法线(trimesh 导出丢 NORMAL 的坑见 fix-glb-normals.py)
    import json, struct
    with open(path, "rb") as f:
        data = f.read()
    ln = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + ln])
    for m in j.get("meshes", []):
        for p in m.get("primitives", []):
            assert "NORMAL" in p.get("attributes", {}), f"{path} 缺 NORMAL: {m.get('name')}"
    b = trimesh.load(path, force="scene").bounds
    print(f"  -> {path}  ext={np.round(b[1] - b[0], 2)} min_y={b[0][1]:.3f}")


def make_sanbengzi():
    """三轮售货车:长度轴为 x,车头(摩托头)= 较轻的前半。转正到 -Z。"""
    sc = trimesh.load(f"{SRC}/vendor-cart.glb", force="scene")
    meshes = dump_meshes(sc)
    # 灯笼串弧线太高(y≈1.84 起,归一化后会顶到背景弧形墙),裁掉只留雨棚
    meshes = [m for m in meshes if m.bounds[0][1] <= 1.83]
    sc = trimesh.Scene(meshes)
    verts = np.vstack([m.vertices for m in meshes])
    b = sc.bounds
    mid_x = (b[0][0] + b[1][0]) / 2
    front_pos_x = (verts[:, 0] > mid_x).sum() < (verts[:, 0] <= mid_x).sum()  # 轻半=车头
    # rotY(+90): +x → -z;车头在 +x 时直接转,否则转 -90
    deg = 90 if front_pos_x else -90
    sc.apply_transform(rot_y(deg))
    normalize(sc, 4.6)
    print(f"sanbengzi: front_pos_x={front_pos_x} rot={deg}")
    export(sc, f"{OUT}/sanbengzi.glb")


def make_mars_rover():
    """毅力号:长度轴已是 z,地面已对齐,车头(桅杆端)原生朝 -Z(截图核实)。
    减面交给 gltf-transform CLI(trimesh 减面会丢 UV → 贴图全白),这里只归一化。"""
    sc = trimesh.load(f"{SRC}/perseverance.glb", force="scene")
    normalize(sc, 4.2)
    print("mars-rover: no rotation (front = -Z natively)")
    export(sc, f"{OUT}/mars-rover.glb")


def pbr(rgb, metallic=0.0, roughness=0.6, name=""):
    return trimesh.visual.material.PBRMaterial(
        baseColorFactor=[*rgb, 1.0], metallicFactor=metallic,
        roughnessFactor=roughness, name=name)


def torus(major, minor, y):
    t = np.linspace(0, 2 * np.pi, 33)[:-1, None]
    sect = np.hstack([major + minor * np.cos(t), minor * np.sin(t)])  # (半径, 高)
    m = trimesh.creation.revolve(sect, 48)   # 绕 Y 轴扫出水平线圈
    m.apply_translation([0, y, 0])
    return m


def make_yaoyao():
    """摇摇车 = 卡通小车(Quaternius Car 重新上色)+ 大弹簧 + 投币底座。"""
    car = trimesh.load(f"{SRC}/quaternius-car.glb", force="scene")
    # 卡通车转正:楔形车头 = 斜面更长的一端。沿 z 质量分布:车头低扁(顶点少),车尾高(顶点多)
    cm = dump_meshes(car)
    cverts = np.vstack([m.vertices for m in cm])
    cb = car.bounds
    mid_z = (cb[0][2] + cb[1][2]) / 2
    front_pos_z = (cverts[:, 2] > mid_z).sum() < (cverts[:, 2] <= mid_z).sum()
    if front_pos_z:
        car.apply_transform(rot_y(180))
    # 上色:车身糖果黄,塑料质感。注意必须改 scene.geometry 里的原网格——
    # dump() 返回的是副本,改副本会被丢弃
    for m in car.geometry.values():
        name = getattr(getattr(m.visual, "material", None), "name", "") or ""
        if name == "Main":
            m.visual = trimesh.visual.TextureVisuals(material=pbr([0.97, 0.68, 0.08], 0.05, 0.45, "Main"))
        else:
            base = getattr(getattr(m.visual, "material", None), "baseColorFactor", None)
            if base is None:
                base = [0.2, 0.2, 0.2, 1]
            base = list(base[:3])
            if max(base) > 1:   # trimesh 有时把 0-255 整型颜色原样塞进 factor
                base = [c / 255 for c in base]
            m.visual = trimesh.visual.TextureVisuals(material=pbr(base, 0.05, 0.5, name or "trim"))
    # 小车缩放到 1.9m 长
    b = car.bounds
    s_car = 1.9 / (b[1][2] - b[0][2])
    car.apply_transform(trimesh.transformations.scale_matrix(s_car))

    red = pbr([0.86, 0.12, 0.16], 0.0, 0.5, "base_red")
    yellow = pbr([0.95, 0.72, 0.10], 0.0, 0.5, "plate_yellow")
    steel = pbr([0.75, 0.77, 0.80], 0.9, 0.3, "spring_steel")
    dark = pbr([0.08, 0.08, 0.09], 0.1, 0.6, "slot_dark")

    parts = []
    # 底座:两层圆角感方台(底层大红,上层黄色踏板)
    base_bot = trimesh.creation.box([1.50, 0.16, 2.30]); base_bot.apply_translation([0, 0.08, 0])
    base_bot.visual.material = red; parts.append(base_bot)
    base_top = trimesh.creation.box([1.36, 0.07, 2.16]); base_top.apply_translation([0, 0.195, 0])
    base_top.visual.material = yellow; parts.append(base_top)
    # 大弹簧:三节渐收线圈 + 顶部托盘(trimesh 圆柱/环面默认轴向 = Z,需转平/转竖)
    rx90 = trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0])
    for i, (r, y) in enumerate([(0.30, 0.31), (0.27, 0.43), (0.24, 0.55)]):
        ring = torus(r, 0.05, y); ring.visual.material = steel; parts.append(ring)
    plate = trimesh.creation.cylinder(0.42, 0.06, sections=32)
    plate.apply_transform(rx90); plate.apply_translation([0, 0.63, 0])
    plate.visual.material = steel; parts.append(plate)
    # 投币箱:尾部右侧立杆 + 箱子 + 投币口
    pole = trimesh.creation.cylinder(0.035, 0.72, sections=16)
    pole.apply_transform(rx90); pole.apply_translation([0.52, 0.58, 0.92])
    pole.visual.material = steel; parts.append(pole)
    box = trimesh.creation.box([0.30, 0.36, 0.18]); box.apply_translation([0.52, 1.12, 0.92])
    box.visual.material = red; parts.append(box)
    slot = trimesh.creation.box([0.16, 0.03, 0.02]); slot.apply_translation([0.52, 1.18, 0.825])
    slot.visual.material = dark; parts.append(slot)
    # 小车放上托盘(车头 -Z 已在上方处理)
    cb = car.bounds
    car.apply_transform(trimesh.transformations.translation_matrix(
        [-(cb[0][0] + cb[1][0]) / 2, 0.66 - cb[0][1], -(cb[0][2] + cb[1][2]) / 2 - 0.05]))
    for m in dump_meshes(car):
        parts.append(m)

    sc = trimesh.Scene(parts)
    # 记录摇摆铰链高度(底座顶面):供 ov3d.js cfg.rockPivotY 使用
    pivot_y = 0.23
    # 整体缩放到底座长 ~3.6m
    b = sc.bounds
    s_all = 3.6 / (b[1][2] - b[0][2])
    sc.apply_transform(trimesh.transformations.scale_matrix(s_all))
    b = sc.bounds
    sc.apply_transform(trimesh.transformations.translation_matrix(
        [-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2]))
    print(f"yaoyao: front_pos_z={front_pos_z} pivotY={pivot_y * s_all:.3f}")
    export(sc, f"{OUT}/yaoyao.glb")


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    make_sanbengzi()
    make_mars_rover()
    make_yaoyao()
