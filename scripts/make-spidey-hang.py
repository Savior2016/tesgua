# 蜘蛛侠:经典蛛丝倒挂姿态(2026-10-12)
# 在 make-new-fun.py 站立版基础上,先对 UE 骨架摆倒挂 pose,再烘进网格:
#   - 骨盆绕面向轴(Y)转 180° → 倒挂且仍面朝 +Y(面板正面)
#   - 右腿伸直脚踝挂蛛丝,左腿屈膝垂落,双臂放松下垂
#   - 蛛丝为后加的圆柱网格(脚踝骨世界坐标 → 向上出画)
#   - 身体归一化到 1.6m 高,最低点抬离台面 0.32m(悬空倒挂)
# 用法(服务器,工作目录任意):
#   xvfb-run -a blender -b --python scripts/make-spidey-hang.py
# 之后在服务器上压缩:
#   gltf-transform optimize spiderman.glb out.glb --compress meshopt \
#     --texture-compress webp --texture-size 1024 --join false --flatten false \
#     --palette false --simplify true --simplify-lock-border true
import bpy
import math
import os
from mathutils import Matrix, Vector

BASE = '/tmp/pvmodels'
SRC = f'{BASE}/spiderman/ext/scene.gltf'
OUT = f'{BASE}/out/spiderman.glb'
BODY_H = 1.6      # 倒挂后身体纵向跨度(不含蛛丝)
LIFT = 0.32       # 最低点抬离台面的高度
WEB_R = 0.011     # 蛛丝半径
WEB_UP = 1.8      # 蛛丝自最高点再向上延伸(出画)

# ---- 倒挂 pose:单腿伸直挂蛛丝(脚踝绕丝),另一腿屈膝,双臂自然下垂 ----
# 注意:
# 1. spine/neck/head 链一旋转就会拉花网格(该模型脊椎链蒙皮有怪骨),
#    骨盆翻转出来的自然垂头效果已经够经典,不动脊椎。
# 2. 不要抬手臂!肩部修正骨(R_Shoulder_Fix 等,父级在躯干)不随大臂动,
#    一抬臂就拉出长刺,而这些修正骨蒙着大片躯干也不能跟着转(会全身碎裂)。
#    腿部没有这个问题,所以蛛丝挂脚踝。
POSE = [
    # (骨骼, 轴, 角度) —— 必须按父先子后顺序
    ('pelvis_05',      'Y', 180),   # 整体倒挂,仍面朝 +Y
    # 右腿向上伸直,脚踝挂丝
    ('thigh_r_0199',   'X', -8),
    ('calf_r_0180',    'X', 8),
    ('foot_r_0208',    'X', 55),    # 绷直脚背,顺着腿的方向
    # 左腿屈膝自然垂落
    ('thigh_l_0175',   'X', 40),
    ('calf_l_0176',    'X', -105),
    ('foot_l_0184',    'X', 45),
    # 双臂放松下垂,肘部略弯
    ('lowerarm_l_013', 'X', -40),
    ('lowerarm_r_065', 'X', -45),
]
WEB_ANCHOR_BONE = 'foot_r_0208'     # 蛛丝锚点:右脚踝

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
bpy.context.view_layer.update()

# 游离装饰球,非身体部件
for name in ('Icosphere',):
    o = bpy.data.objects.get(name)
    if o:
        bpy.data.objects.remove(o)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

def rot_bone(name, axis, deg):
    """绕骨骼头在世界空间旋转 pose 骨(可预测,不用猜局部轴向)"""
    pb = arm.pose.bones[name]
    M = arm.matrix_world
    head_w = M @ pb.head
    T = Matrix.Translation(head_w)
    R = Matrix.Rotation(math.radians(deg), 4, axis)
    pb.matrix = M.inverted() @ T @ R @ T.inverted() @ (M @ pb.matrix)
    bpy.context.view_layer.update()

for name, axis, deg in POSE:
    rot_bone(name, axis, deg)
for n in ('hand_r_066', 'hand_l_014'):
    print('BONEPOS', n, [round(v, 1) for v in (arm.matrix_world @ arm.pose.bones[n].head)])

# 记录脚踝世界坐标(蛛丝锚点),并记下之后网格要经历的组合变换
hand_w = arm.matrix_world @ arm.pose.bones[WEB_ANCHOR_BONE].head

# ---- 烘骨架/修改器进网格(同 make-new-fun:convert 逐网格) ----
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if o.modifiers:
        bpy.ops.object.convert(target='MESH')
bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

# 肩部修正骨(R_Shoulder_Fix/R_Trapezius 等,父级在躯干)不随手臂旋转,部分权重
# 顶点被拉成细长刺(渲染里那根"红蛛丝")。修正骨本身蒙着大片躯干,不能跟着转
# (试过,全身碎裂),只能事后剪。按位置剪不可靠(刺尖位置随姿势变),改按
# 边长:刺是拉长面片,边长达几十上百,正常网格边 <10;删除"所有邻边都超长"
# 的顶点(刺尖/中段),共用顶点留在身体上不会破洞。
import bmesh
for o in meshes:
    bm = bmesh.new()
    bm.from_mesh(o.data)
    LONG = 15.0
    doomed = [v for v in bm.verts if v.link_edges and
              all(e.calc_length() > LONG for e in v.link_edges)]
    if doomed:
        bmesh.ops.delete(bm, geom=doomed, context='VERTS')
        bm.to_mesh(o.data)
        print('PRUNE-EDGE', o.name, len(doomed))
    bm.free()
bpy.context.view_layer.update()

# 自带蛛丝诊断(已确认"红蛛丝"实为肩部修正骨拉刺,非独立网格,见 PRUNE);
# 保留打印方便以后排查别的飞点
WGN = ('weapon_r_085', 'weapon_r_end_0283', 'weapon_l_034', 'weapon_l_end_0251')
for o in meshes:
    idx = {o.vertex_groups[n].index for n in WGN if n in o.vertex_groups}
    if not idx:
        continue
    mw = o.matrix_world
    pts = [(mw @ v.co) for v in o.data.vertices
           if any(g.group in idx and g.weight > 0.02 for g in v.groups)]
    if pts:
        print('STRAND', o.name, len(pts),
              'x', round(min(p.x for p in pts), 1), round(max(p.x for p in pts), 1),
              'y', round(min(p.y for p in pts), 1), round(max(p.y for p in pts), 1),
              'z', round(min(p.z for p in pts), 1), round(max(p.z for p in pts), 1))

# 断父子(保留世界变换)再清掉骨架/空节点
for o in meshes:
    if o.parent is not None:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
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

# ---- 归一化:缩放 → 转正(绕 Z 180°) → 居中 + 抬离台面 ----
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mins, maxs = bbox_of(meshes)
print('SRC BBOX', [round(v, 3) for v in mins], [round(v, 3) for v in maxs])
s = BODY_H / (maxs.z - mins.z)   # 倒挂后身高沿 Z
print('SCALE', round(s, 5))

T1 = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Scale(s, 4)
for o in meshes:
    o.matrix_world = T1 @ o.matrix_world
bpy.context.view_layer.update()
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mins, maxs = bbox_of(meshes)
cen = Vector(((mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2, mins.z - LIFT))
T2 = Matrix.Translation(-cen)
for o in meshes:
    o.matrix_world = T2 @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mins, maxs = bbox_of(meshes)
print('NORM BBOX', [round(v, 3) for v in mins], [round(v, 3) for v in maxs])

# ---- 蛛丝:从脚踝锚点向上出画的白色圆柱 ----
anchor = T2 @ T1 @ hand_w      # 锚点跟随同样的归一化变换
web_top = maxs.z + WEB_UP
depth = web_top - anchor.z + 0.15
bpy.ops.mesh.primitive_cylinder_add(radius=WEB_R, depth=depth,
                                    location=(anchor.x, anchor.y, anchor.z + depth / 2 - 0.1))
web = bpy.context.active_object
web.name = 'WebStrand'
wm = bpy.data.materials.new('web_silk')
wm.use_nodes = True
bsdf = wm.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.92, 0.93, 0.96, 1)
bsdf.inputs['Roughness'].default_value = 0.45
bsdf.inputs['Metallic'].default_value = 0.15
web.data.materials.append(wm)
print('WEB anchor', [round(v, 3) for v in anchor], 'top', round(web_top, 3))

# ---- EEVEE 预览 ----
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
c0 = Vector((0, 0, (maxs.z + mins.z) / 2))
views = {
    'front': Vector((0, BODY_H * 2.2, c0.z)),
    'tq': Vector((BODY_H * 1.2, BODY_H * 1.5, c0.z + 0.6)),
}
for name, pos in views.items():
    cd = bpy.data.cameras.new('cam')
    cd.clip_end = 200
    cam = bpy.data.objects.new('cam', cd)
    cam.location = pos
    cam.rotation_euler = (c0 - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = f'/tmp/spidey_hang_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)

for o in list(sc.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o)

os.makedirs(f'{BASE}/out', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_apply=True, export_yup=True,
                          export_animations=False, export_skins=False,
                          export_materials='EXPORT')
print('EXPORTED', OUT)
