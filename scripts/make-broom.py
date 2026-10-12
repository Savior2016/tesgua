# 飞天扫帚(Stylized Broomstick,trashart @ Sketchfab,CC-BY 4.0)
# 源:/tmp/pvmodels/broom1/scene.gltf(Dkingofcode/DevPortfolio 镜像)
# 处理:刷头朝 -Y(= glTF +Z = 面板后方)、悬浮 0.45m、柄尖微翘、归一化 2.2m 长。
# 坐标:Blender +Y → glTF -Z = 面板前方,所以柄尖(+Y 端)即车头方向,不用转正。
# 用法(服务器):xvfb-run -a blender -b --python scripts/make-broom.py
import bpy
import math
import os
from mathutils import Matrix, Vector

BASE = '/tmp/pvmodels'
SRC = f'{BASE}/broom1/scene.gltf'
OUT = f'{BASE}/out/broomstick.glb'
LENGTH = 2.2      # 归一化总长
HOVER = 0.45      # 悬浮高度(最低点离台面)
TILT = 4.0        # 抬头角度(柄尖微翘)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.context.view_layer.update()

meshes = [o for o in bpy.data.objects if o.type == 'MESH']

def bbox_of():
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for o in meshes:
        mw = o.matrix_world
        for c in o.bound_box:
            w = mw @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    return mins, maxs

mins, maxs = bbox_of()
print('SRC BBOX', [round(v, 2) for v in mins], [round(v, 2) for v in maxs])

# 断父子,烘进局部变换
for o in meshes:
    if o.parent is not None:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 源模型已沿 Y 轴躺平、刷头在 -Y(后方)——直接归一化 + 悬浮 + 微抬头
mins, maxs = bbox_of()
s = LENGTH / (maxs.y - mins.y)
T = (Matrix.Translation((0, 0, HOVER - s * mins.z))
     @ Matrix.Scale(s, 4)
     @ Matrix.Translation((-(mins.x + maxs.x) / 2, -(mins.y + maxs.y) / 2, -(mins.z + maxs.z) / 2)))
for o in meshes:
    o.matrix_world = T @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# 抬头:绕 X 轴微转(+Y 端抬起),枢轴在扫帚中心
mins, maxs = bbox_of()
pivot = Vector((0, 0, (mins.z + maxs.z) / 2))
Rt = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(TILT), 4, 'X') @ Matrix.Translation(-pivot)
for o in meshes:
    o.matrix_world = Rt @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mins, maxs = bbox_of()
print('NORM BBOX', [round(v, 3) for v in mins], [round(v, 3) for v in maxs])

# ---- EEVEE 预览 ----
sc = bpy.context.scene
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
c0 = Vector((0, 0, (mins.z + maxs.z) / 2))
for name, pos in {'front': Vector((0, -5, c0.z)), 'tq': Vector((2.6, -3.2, c0.z + 1.6))}.items():
    cd = bpy.data.cameras.new('cam')
    cd.clip_end = 200
    cam = bpy.data.objects.new('cam', cd)
    cam.location = pos
    cam.rotation_euler = (c0 - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = f'/tmp/broom_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)

os.makedirs(f'{BASE}/out', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_apply=True, export_yup=True,
                          export_animations=False, export_skins=False)
print('EXPORTED', OUT)
