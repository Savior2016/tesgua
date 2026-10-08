#!/usr/bin/env python3
"""趣味 3D 模型归一化与拼装 —— 生成 app/static/models/fun/ 下的展示模型。

统一约定(与 car3d.js 注册表一致):车头/正面 = -Z,地面 = y=0,XZ 居中。
导出为未压缩 GLB(压缩交给 gltf-transform CLI;面板 GLTFLoader 只挂了
MeshoptDecoder,没有 DRACOLoader)。

产出(写实风格):
  sanbengzi.glb  三蹦子  —— Autorickshaw(iGauravRajput @ Sketchfab, CC-BY 4.0)
  mars-rover.glb 火星车  —— Perseverance 工作构型(NASA science 站,机械臂展开)
  yaoyao.glb     摇摇车  —— Khronos ToyCar(CC0, 写实 PBR)+ 程序化弹簧底座
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
    """三轮摩托(突突车):长度轴为 x,车头(风挡/单前轮)= +x(截图核实)。
    rotY(+90): +x → -z。归一化到 2.6m 长。
    Tripo 导出缺 metallicFactor(glTF 默认 1.0 → 无环境贴图下全黑),强制归零。"""
    sc = trimesh.load(f"{SRC}/rickshaw/rickshaw.glb", force="scene")
    for m in sc.geometry.values():
        mat = getattr(m.visual, "material", None)
        if mat is not None and hasattr(mat, "metallicFactor"):
            mat.metallicFactor = 0.0
    sc.apply_transform(rot_y(90))
    normalize(sc, 2.6)
    print("sanbengzi: rickshaw front=+X rot=90")
    export(sc, f"{OUT}/sanbengzi.glb")


def make_mars_rover():
    """毅力号工作构型(NASA science 站版本,机械臂已展开触地):
    桅杆/钻头和机械臂在 +z(节点位置核实),rotY(180) 转正。
    减面压缩交给 gltf-transform CLI(trimesh 减面会丢 UV → 贴图全白),这里只归一化。"""
    sc = trimesh.load(f"{SRC}/perseverance-science.glb", force="scene")
    sc.apply_transform(rot_y(180))
    normalize(sc, 4.2)
    print("mars-rover: science deployed pose, front=+Z rot=180")
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
    """摇摇车 = Khronos ToyCar(写实 PBR 玩具车,CC0)+ 大弹簧 + 投币底座。
    裁掉展示绒布(Fabric)和相机节点;车头(格栅/大灯)= +z(截图核实),rotY(180) 转正。
    保留原车漆/火焰贴花,不重上色。"""
    car = trimesh.load(f"{SRC}/toycar.glb", force="scene")
    drop = set()
    for node in car.graph.nodes_geometry:
        _, geom = car.graph.get(node)
        if 'fabric' in node.lower() or 'camera' in node.lower():
            drop.add(geom)
    car.delete_geometry(list(drop))
    car.apply_transform(rot_y(180))
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
    print(f"yaoyao: toycar composite pivotY={pivot_y * s_all:.3f}")
    export(sc, f"{OUT}/yaoyao.glb")


def make_ironman():
    """钢铁侠 Mark 85(LLIypuk @ Sketchfab, CC-BY 4.0):站姿人形,已落地 y=0。
    面朝 +Z(截图核实),rotY(180) 转正为正面 -Z。按身高归一化到 2.4m(展示感,圆盘为车尺度):
    normalize() 按水平轴缩放不适合人形,这里直接用高度。"""
    sc = trimesh.load(f"{SRC}/ironman/scene.gltf", force="scene")
    sc.apply_transform(rot_y(180))
    b = sc.bounds
    s = 2.4 / (b[1][1] - b[0][1])
    sc.apply_transform(trimesh.transformations.scale_matrix(s))
    b = sc.bounds
    sc.apply_transform(trimesh.transformations.translation_matrix(
        [-(b[0][0] + b[1][0]) / 2, -b[0][1], -(b[0][2] + b[1][2]) / 2]))
    print("ironman: mark85 standing, front=+Z rot=180, height=2.4")
    export(sc, f"{OUT}/ironman.glb")


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    make_sanbengzi()
    make_mars_rover()
    make_yaoyao()
    make_ironman()
