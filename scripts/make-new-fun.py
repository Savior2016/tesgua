# 新趣味模型管线(2026-10-10):蝙蝠车 / 蜘蛛侠 / F40 / Revuelto / F1 LM
# 统一处理:摆正(面板正面 = glTF -Z = Blender +Y 侧,即导出前绕 Z 转 180°)、
# 落地(min z = 0)、居中、按目标长度/身高归一化、烘进顶点(节点保持 identity,
# 避免 trimesh 归一化写坏旋转节点的坑)、导出 GLB。
# 之后在服务器上用 gltf-transform 压缩:
#   gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp \
#     --texture-size 1024 --join false --flatten false --palette false \
#     --simplify true --simplify-lock-border true
#
# 用法(服务器,工作目录 /tmp/pvmodels):
#   xvfb-run -a blender -b --python scripts/make-new-fun.py -- <model>
#     model ∈ batmobile | spiderman | f40 | revuelto | f1lm
import bpy
import math
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
MODEL = argv[0]
BASE = '/tmp/pvmodels'
OUT = f'{BASE}/out/{MODEL}.glb'

# ---------------- 配置 ----------------
# length: 车长按真实车长(m);角色按身高
CFG = {
    'batmobile': dict(kind='blend', src=f'{BASE}/batmobile/car.blend', length=5.6),
    'spiderman': dict(kind='gltf', src=f'{BASE}/spiderman/ext/scene.gltf', length=1.88,
                      drop=('Icosphere',)),   # 源模型散落的游离球体,非身体部件
    'f40':       dict(kind='glb', src=f'{BASE}/supercars/f40/f40_raw.glb', length=4.36),
    'revuelto':  dict(kind='glb', src=f'{BASE}/supercars/revuelto/revuelto_raw.glb', length=4.95),
    'f1lm':      dict(kind='glb', src=f'{BASE}/supercars/f1lm/f1lm_raw.glb', length=4.49),
}
cfg = CFG[MODEL]

# 蝙蝠车 blend 里属于车身的网格(其余是展示间:墙/地/格栅/灯箱/底座)
BAT_KEEP = ["Base Body", "Car Bottom", "Foot Stand", "Front Tyre", "Front Tyre Cover",
            "Front Tyre Cover Support", "Front Tyre Body Cover", "Front Vent", "Front Wheel",
            "Front Wheel Support", "Parking Lights", "Gun Base", "Gun Support",
            "Back Tyre.001", "Back Tyre Cover", "Back Tyre Cover.001", "Back Wheel",
            "Back Wheel Inside", "Exhaust", "Silencer", "Side Cover back",
            "Side Cover Forward", "Spoiler", "Spoiler Support"]

# 蝙蝠车材质分组(按网格名):哑光黑装甲 / 枪灰金属 / 座舱玻璃 / 轮胎 / 灯光
BAT_MATS = {
    'armor':  (["Base Body", "Side Cover back", "Side Cover Forward", "Spoiler",
                "Spoiler Support", "Front Tyre Body Cover", "Front Tyre Cover",
                "Front Tyre Cover Support", "Back Tyre Cover", "Back Tyre Cover.001",
                "Car Bottom", "Foot Stand", "Front Vent"],
               dict(color=(0.016, 0.018, 0.022), rough=0.42, metal=0.55)),
    'gunmetal': (["Gun Base", "Gun Support", "Exhaust", "Silencer",
                  "Front Wheel", "Back Wheel", "Back Wheel Inside", "Front Wheel Support"],
                 dict(color=(0.05, 0.055, 0.06), rough=0.35, metal=0.9)),
    'tyre':   (["Front Tyre", "Back Tyre.001"],
               dict(color=(0.012, 0.012, 0.013), rough=0.92, metal=0.0)),
    'light':  (["Parking Lights"],
               dict(color=(0.9, 0.92, 0.95), rough=0.3, metal=0.0, emis=(1.0, 0.98, 0.9), emis_strength=4.0)),
}

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------- 导入 ----------------
if cfg['kind'] == 'blend':
    bpy.ops.wm.open_mainfile(filepath=cfg['src'])
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name not in BAT_KEEP:
            bpy.data.objects.remove(o)
        elif o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o)
elif cfg['kind'] == 'glb':
    bpy.ops.import_scene.gltf(filepath=cfg['src'])
else:
    bpy.ops.import_scene.gltf(filepath=cfg['src'])
bpy.context.view_layer.update()

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for name in cfg.get('drop', ()):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)
        meshes.remove(o)
print('MESHES', len(meshes))

# 先烘修改器再动变换:镜像/实体化/阵列/骨骼蒙皮都让 bound_box 只反映未求值的
# 局部网格(蝙蝠车靠 MIRROR 拼左右、蜘蛛侠靠 ARMATURE 摆姿),直接量包围盒或
# transform_apply 都会拿到错误几何。convert 逐网格把当前求值结果烘成新网格。
for o in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if o.modifiers:
        bpy.ops.object.convert(target='MESH')
bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# 断父子关系(保留世界变换):glTF/Blend 导入的网格常挂在 Sketchfab_model 等
# 空节点下;不脱钩的话 transform_apply 只烘局部矩阵,父节点变换会再压一遍 → 双重变换
for o in meshes:
    if o.parent is not None:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
# 空骨架/空节点/曲线一并清掉,不随模型导出
for o in list(bpy.data.objects):
    if o.type not in ('MESH', 'CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)
bpy.context.view_layer.update()

def bbox_of(objs):
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for o in objs:
        mw = o.matrix_world
        for c in o.bound_box:
            w = mw @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    return mins, maxs

# ---------------- 蝙蝠车材质 ----------------
if MODEL == 'batmobile':
    for group, (names, spec) in BAT_MATS.items():
        mat = bpy.data.materials.new(f'bat_{group}')
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*spec['color'], 1)
        bsdf.inputs['Roughness'].default_value = spec['rough']
        bsdf.inputs['Metallic'].default_value = spec['metal']
        if spec.get('emis'):
            bsdf.inputs['Emission Color'].default_value = (*spec['emis'], 1)
            bsdf.inputs['Emission Strength'].default_value = spec['emis_strength']
        for name in names:
            o = bpy.data.objects.get(name)
            if not o:
                print('MISS MESH', name)
                continue
            o.data.materials.clear()
            o.data.materials.append(mat)
    # 座舱区域:Base Body 顶部黑色罩面已在装甲组;BvS 原车座舱是深色亚克力,无需单独玻璃

# ---------------- 变换:归一化 → 转正 → 落地 ----------------
# 注意:全部烘进顶点(apply transform),节点保持 identity
mins, maxs = bbox_of(meshes)
print('SRC BBOX', [round(v, 3) for v in mins], [round(v, 3) for v in maxs])

if MODEL == 'spiderman':
    cur = maxs.z - mins.z          # 站立身高沿 Z
else:
    cur = maxs.y - mins.y          # 车长沿 Y(长轴)
if cur <= 0:
    cur = max(maxs[i] - mins[i] for i in range(3))
s = cfg['length'] / cur
print('SCALE', round(s, 4))

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 缩放 + 绕 Z 转 180°(Blender -Y 朝面 → glTF +Z;转正后面板正面 -Z)
T = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(s, 4)
for o in meshes:
    o.matrix_world = T @ o.matrix_world
bpy.context.view_layer.update()
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mins, maxs = bbox_of(meshes)
cen = Vector(((mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2, mins.z))
for o in meshes:
    o.matrix_world = Matrix.Translation(-cen) @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mins, maxs = bbox_of(meshes)
print('NORM BBOX', [round(v, 3) for v in mins], [round(v, 3) for v in maxs])

# ---------------- 预览渲染 ----------------
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)
try:
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = 900
sc.render.resolution_y = 700
w = bpy.data.worlds.new('W')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.38, 0.42, 1)
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('S', 'SUN'))
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
sun.data.energy = 3.5
sc.collection.objects.link(sun)
size = cfg['length']
c0 = Vector((0, 0, (maxs.z + mins.z) / 2))
views = {
    'front': Vector((0, size * 1.9, c0.z + size * 0.25)),      # +Y 侧 = 面板正面
    'tq': Vector((size * 1.15, size * 1.3, c0.z + size * 0.65)),
}
for name, pos in views.items():
    cd = bpy.data.cameras.new('cam')
    cd.clip_end = size * 100
    cam = bpy.data.objects.new('cam', cd)
    cam.location = pos
    cam.rotation_euler = (c0 - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = f'/tmp/newfun_{MODEL}_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)

# 渲染完清掉相机灯光再导出
for o in list(sc.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)

import os
os.makedirs(f'{BASE}/out', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_apply=True, export_yup=True,
                          export_animations=False, export_skins=False,
                          export_materials='EXPORT')
print('EXPORTED', OUT)
