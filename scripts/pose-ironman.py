# 钢铁侠 Mark 85 战斗姿态 v9:双臂前伸 + 掌心朝正前 + 手指向上(经典掌心炮)
#   xvfb-run -a blender -b --python pose-ironman.py -- <scene.gltf> <out.glb [preview]>
# 源模型:9A Films / Nihar Arora @ Sketchfab「Iron-Man Mark 85 | Rigged」(CC-BY 4.0)。
# v6:用手骨 + 食指/小指根骨骼的世界位置算掌心法线,绕手指轴扭到正前方,五指逐节摆直朝上。
# v7:导出前整体绕 Z 转 180°(Blender -Y 朝面 → glTF +Z,面板正面是 -Z,v6 因此一直背对观众);
#    掌心烘入 repulsor_L/R 自发光圆盘网格(ov3d.js 光束锚点,按名识别)。
# v9:锚点在烘焙**之前**创建并刚性绑到手骨(vertex group + Armature modifier),随身体一起
#    modifier_apply —— modifier_apply 会把网格顶点落到 armature 局部坐标(比世界大 ~1000 倍),
#    烘后再建的锚点与身体差三个数量级(v8 锚点落到脚底);trimesh 归一化也会把带旋转的小节点
#    写坏(v7 经 normalize_fun.py 后锚点失位),故转正/归一化全部烘进顶点、节点保持 identity。
#    压缩:gltf-transform optimize 默认 simplify 会坍缩锚点小圆柱 → 必须
#    --simplify-lock-border 且关 --join/--flatten/--palette。
import bpy, math, sys
from mathutils import Euler, Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = len(argv) > 2 and argv[2] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# 场景里的无关残留网格(Sketchfab 文件带了个 ±1 的 Icosphere),删掉再处理
for obj in list(bpy.data.objects):
    if obj.type == 'MESH' and not any(m.type == 'ARMATURE' for m in obj.modifiers):
        bpy.data.objects.remove(obj, do_unlink=True)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

def mesh_world_bbox():
    dg = bpy.context.evaluated_depsgraph_get()
    mins = [1e9]*3; maxs = [-1e9]*3
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        eo = obj.evaluated_get(dg)
        me = eo.to_mesh()
        mw = eo.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            for i in range(3):
                mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
        eo.to_mesh_clear()
    return mins, maxs

rmins, rmaxs = mesh_world_bbox()
REST_H = rmaxs[2] - rmins[2]
print('REST BBOX', [round(v,3) for v in rmins], [round(v,3) for v in rmaxs], 'H', round(REST_H,3))

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')

MW = arm.matrix_world
MWi = MW.inverted()

def aim(bone, direction):
    """把骨骼当前指向旋转到世界方向 direction(绕头端点转,子骨骼跟随)。"""
    pb = arm.pose.bones.get(bone)
    if pb is None:
        print('MISS', bone); return
    bpy.context.view_layer.update()
    head_w = MW @ pb.head
    cur = (MW @ pb.tail) - head_w
    rot = cur.normalized().rotation_difference(Vector(direction).normalized())
    R = rot.to_matrix().to_4x4()
    M = MW @ pb.matrix
    M2 = Matrix.Translation(head_w) @ R @ Matrix.Translation(-head_w) @ M
    pb.matrix = MWi @ M2
    bpy.context.view_layer.update()

def move(bone, offset):
    pb = arm.pose.bones.get(bone)
    if pb is None:
        print('MISS', bone); return
    M = MW @ pb.matrix
    M2 = Matrix.Translation(Vector(offset)) @ M
    pb.matrix = MWi @ M2
    bpy.context.view_layer.update()

def rot(bone, x=0.0, y=0.0, z=0.0):
    pb = arm.pose.bones.get(bone)
    if pb is None:
        print('MISS', bone); return
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ')
    bpy.context.view_layer.update()

def head_w(bone):
    return MW @ arm.pose.bones[bone].head

def twist_palm(hand, index1, pinky1, side, target=(0.0, -1.0, 0.0)):
    """绕手骨(手指)轴扭转,把掌心法线转到 target(世界方向)。
    掌心法线由食指根→小指根连线 × 手指方向叉积推出;左手/右手叉积序相反。"""
    pb = arm.pose.bones.get(hand)
    if pb is None:
        print('MISS', hand); return
    bpy.context.view_layer.update()
    h = MW @ pb.head
    finger = ((MW @ pb.tail) - h).normalized()
    k = (head_w(index1) - head_w(pinky1)).normalized()   # 小指→食指
    n = finger.cross(k) if side == 'L' else k.cross(finger)
    n = n.normalized()
    tgt = Vector(target).normalized()
    # 只在垂直于手指轴的平面内扭转
    n_p = (n - finger * n.dot(finger)).normalized()
    t_p = (tgt - finger * tgt.dot(finger)).normalized()
    r = n_p.rotation_difference(t_p)
    R = r.to_matrix().to_4x4()
    M = MW @ pb.matrix
    pb.matrix = MWi @ (Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ M)
    bpy.context.view_layer.update()
    # 校验:重算掌心法线
    h2 = MW @ pb.head
    finger2 = ((MW @ pb.tail) - h2).normalized()
    k2 = (head_w(index1) - head_w(pinky1)).normalized()
    n2 = (finger2.cross(k2) if side == 'L' else k2.cross(finger2)).normalized()
    print(f'PALM {hand}: before={[round(v,2) for v in n]} after={[round(v,2) for v in n2]} target={list(target)}')

# ---- 战斗姿态 v6(世界:模型面朝 -Y,上 = +Z;aim 的 Y 负 = 向前) ----
H = REST_H
move('mixamorig:Hips_01', (0.0, -0.01*H, -0.035*H))
# 双腿开立(同 v5)
aim('mixamorig:RightUpLeg_060', (-0.42, -0.10, -1.0))
aim('mixamorig:RightLeg_061', (-0.06, 0.0, -1.0))
aim('mixamorig:RightFoot_062', (-0.30, -1.0, -0.02))   # 脚掌放平(v5 竖成芭蕾脚尖)
aim('mixamorig:LeftUpLeg_00', (0.42, -0.10, -1.0))
aim('mixamorig:LeftLeg_056', (0.06, 0.0, -1.0))
aim('mixamorig:LeftFoot_057', (0.30, -1.0, -0.02))
# 躯干正直微前倾
rot('mixamorig:Spine_02', x=6)
rot('mixamorig:Spine1_03', x=3)
rot('mixamorig:Spine2_04', x=3)
# 双臂前伸(同 v5)
aim('mixamorig:RightArm_033', (-0.22, -0.95, -0.08))
aim('mixamorig:RightForeArm_034', (-0.10, -1.0, -0.38))
aim('mixamorig:LeftArm_09', (0.22, -0.95, -0.08))
aim('mixamorig:LeftForeArm_010', (0.10, -1.0, -0.38))
# 手腕:手指直朝上(略前倾 8°,掌心炮有前冲感)
UP = (0.0, -0.14, 1.0)
aim('mixamorig:RightHand_035', UP)
aim('mixamorig:LeftHand_011', UP)
# 掌心扭到正前方(-Y);在五指望直之前做,掌心法线由根骨骼连线推算
twist_palm('mixamorig:LeftHand_011', 'mixamorig:LeftHandIndex1_016', 'mixamorig:LeftHandPinky1_028', 'L')
twist_palm('mixamorig:RightHand_035', 'mixamorig:RightHandIndex1_040', 'mixamorig:RightHandPinky1_052', 'R')
# 五指:除拇指外逐节顺着手骨方向摆直(略向后扣出张力),拇指侧张
FINGERS = [
    ('Index', '_016', '_017', '_018', '_040', '_041', '_042'),
    ('Middle', '_020', '_021', '_022', '_044', '_045', '_046'),
    ('Ring', '_024', '_025', '_026', '_048', '_049', '_050'),
    ('Pinky', '_028', '_029', '_030', '_052', '_053', '_054'),
]
for name, l1, l2, l3, r1, r2, r3 in FINGERS:
    for b in (f'mixamorig:LeftHand{name}1{l1}', f'mixamorig:RightHand{name}1{r1}'):
        aim(b, (0.0, -0.10, 1.0))
    for b in (f'mixamorig:LeftHand{name}2{l2}', f'mixamorig:RightHand{name}2{r2}'):
        aim(b, (0.0, 0.10, 1.0))    # 中节略后扣
    for b in (f'mixamorig:LeftHand{name}3{l3}', f'mixamorig:RightHand{name}3{r3}'):
        aim(b, (0.0, 0.22, 1.0))    # 末节再扣一点(张力的手型,不是僵直棍)
# 拇指:向侧前方张开(左拇指朝 -X 侧,右拇指朝 +X 侧)
for side, t1, t2, t3 in [('L', '_012', '_013', '_014'), ('R', '_036', '_037', '_038')]:
    sx = -1.0 if side == 'L' else 1.0
    aim(f'mixamorig:{"Left" if side=="L" else "Right"}HandThumb1{t1}', (0.85*sx, -0.35, 0.45))
    aim(f'mixamorig:{"Left" if side=="L" else "Right"}HandThumb2{t2}', (0.75*sx, -0.55, 0.30))
    aim(f'mixamorig:{"Left" if side=="L" else "Right"}HandThumb3{t3}', (0.65*sx, -0.65, 0.25))
# 头:正视前方
aim('mixamorig:Head_06', (0.0, -0.1, 1.0))

# ---- 掌心炮锚点:掌心中心 + 掌心法线 + 掌心宽度(烘发光盘前先取姿态数据) ----
def palm_info(hand, index1, pinky1, side):
    k1, k5 = head_w(index1), head_w(pinky1)
    center = (k1 + k5) / 2
    pb = arm.pose.bones[hand]
    finger = ((MW @ pb.tail) - (MW @ pb.head)).normalized()
    k = (k1 - k5).normalized()
    n = (finger.cross(k) if side == 'L' else k.cross(finger)).normalized()
    return center, n, (k1 - k5).length

REPU = []
for side, hand, i1, p1 in [
    ('L', 'mixamorig:LeftHand_011', 'mixamorig:LeftHandIndex1_016', 'mixamorig:LeftHandPinky1_028'),
    ('R', 'mixamorig:RightHand_035', 'mixamorig:RightHandIndex1_040', 'mixamorig:RightHandPinky1_052'),
]:
    c, n, w = palm_info(hand, i1, p1, side)
    print(f'REPU {side}: center={[round(v,3) for v in c]} normal={[round(v,2) for v in n]} width={round(w,3)}')
    REPU.append((side, c + n * 0.004, n, w * 0.34))

# ---- 取景(摆姿后网格世界包围盒) ----
pmins, pmaxs = mesh_world_bbox()
c = [(pmins[i]+pmaxs[i])/2 for i in range(3)]
size = max(pmaxs[i]-pmins[i] for i in range(3))
print('POSED BBOX', [round(v,3) for v in pmins], [round(v,3) for v in pmaxs])

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 700
d = size * 2.2
for name, loc in [
    ('front', (c[0], c[1]-d, c[2]+size*0.08)),
    ('three-quarter', (c[0]+d*0.7, c[1]-d*0.75, c[2]+size*0.3)),
    ('side', (c[0]+d, c[1], c[2]+size*0.05)),
    ('hand', ((head_w('mixamorig:LeftHand_011') + Vector((0.5,-1.4,0.2))) if True else None)),
]:
    cam_data = bpy.data.cameras.new('cam'); cam_data.clip_end = size*50
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = loc
    look = Vector(c) if name != 'hand' else head_w('mixamorig:LeftHand_011')
    cam.rotation_euler = (look - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam); scene.camera = cam
    scene.render.filepath = f'/tmp/battle6_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')

if PREVIEW:
    sys.exit(0)

# ---- 掌心炮发光盘(绑定手骨随烘焙,ov3d.js 光束锚点;盘面法线 = 掌心方向) ----
# 关键坑:modifier_apply 后网格顶点落在 armature 局部坐标(比世界大 ~1000 倍),
# 烘后再建的锚点会差三个数量级(v8 锚点因此落到脚底)。所以锚点在烘焙**之前**建:
# 放在 rest 姿态掌心位、刚性绑到手骨上,随身体一起 apply,坐标系自然一致。
mrep = bpy.data.materials.new('RepulsorGlow')
mrep.use_nodes = True
_bsdf = mrep.node_tree.nodes['Principled BSDF']
_bsdf.inputs['Base Color'].default_value = (0.35, 0.75, 1.0, 1)
_bsdf.inputs['Emission Color'].default_value = (0.55, 0.85, 1.0, 1)
_bsdf.inputs['Emission Strength'].default_value = 3.0

def palm_info_rest(hand, index1, pinky1, side):
    k1 = MW @ arm.data.bones[index1].head_local
    k5 = MW @ arm.data.bones[pinky1].head_local
    center = (k1 + k5) / 2
    hb = arm.data.bones[hand]
    finger = ((MW @ hb.tail_local) - (MW @ hb.head_local)).normalized()
    k = (k1 - k5).normalized()
    n = (finger.cross(k) if side == 'L' else k.cross(finger)).normalized()
    return center, n, (k1 - k5).length

for side, hand, i1, p1 in [
    ('L', 'mixamorig:LeftHand_011', 'mixamorig:LeftHandIndex1_016', 'mixamorig:LeftHandPinky1_028'),
    ('R', 'mixamorig:RightHand_035', 'mixamorig:RightHandIndex1_040', 'mixamorig:RightHandPinky1_052'),
]:
    c, n, w = palm_info_rest(hand, i1, p1, side)
    bpy.ops.mesh.primitive_cylinder_add(radius=w * 0.34, depth=0.004, vertices=24)
    disc = bpy.context.active_object
    disc.name = f'repulsor_{side}'
    disc.data.transform(Matrix.Translation(c + n * 0.004) @ n.to_track_quat('Z', 'Y').to_matrix().to_4x4())
    disc.data.materials.append(mrep)
    vg = disc.vertex_groups.new(name=hand)
    vg.add(list(range(len(disc.data.vertices))), 1.0, 'REPLACE')
    mod = disc.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    print(f'DISC {side} rest_center={[round(v,4) for v in c]}')

# ---- 烘焙:应用 Armature modifier(含锚点),删骨骼,导出 ----
bpy.ops.object.mode_set(mode='OBJECT')
for obj in list(bpy.data.objects):
    if obj.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        if mod.type == 'ARMATURE':
            bpy.ops.object.modifier_apply(modifier=mod.name)
for obj in list(bpy.data.objects):
    if obj.type == 'ARMATURE':
        bpy.data.objects.remove(obj, do_unlink=True)

# ---- 转正 + 归一化:全部烘进顶点,对象变换归 identity ----
# 面板正面 = glTF -Z,而 Blender -Y 朝面导出后落在 +Z → 绕 Z 转 180°。
# 归一化(2.4m/落地/居中)也在这里做:此前交给 normalize_fun.py(trimesh),
# 但 trimesh 会把带旋转的小锚点节点写坏(v8-norm 里 repulsor 落到 (0,0.07,0.39));
# 顶点全烘后下游任何工具都没有节点变换可处理,最稳。
R180 = Matrix.Rotation(math.pi, 4, 'Z')
for o in bpy.data.objects:
    if o.type == 'MESH':
        if o.data.users > 1:
            o.data = o.data.copy()
        o.data.transform(R180 @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()

mins = [1e9] * 3
maxs = [-1e9] * 3
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for c in o.bound_box:          # matrix_world 已是 identity,bound_box 即世界坐标
        for i in range(3):
            mins[i] = min(mins[i], c[i])
            maxs[i] = max(maxs[i], c[i])
s = 2.4 / (maxs[2] - mins[2])    # Blender z-up,按身高归一
print('NORM bbox', [round(v, 4) for v in mins], [round(v, 4) for v in maxs], 's=', round(s, 4))
M = Matrix.Translation((-(mins[0] + maxs[0]) / 2 * s,
                        -(mins[1] + maxs[1]) / 2 * s,
                        -mins[2] * s)) @ Matrix.Scale(s, 4)
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.transform(M)
        if o.name.startswith('repulsor'):
            print(f'NORM {o.name} v0={[round(v,4) for v in o.data.vertices[0].co]}')
bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_image_format='AUTO', export_materials='EXPORT',
                          export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
