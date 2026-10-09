# 钢铁侠 Mark 85 战斗姿态摆姿 + 烘焙导出(无头 Blender):
#   xvfb-run -a blender -b --python scripts/pose-ironman.py -- <scene.gltf> <out.glb [preview]>
# 源模型:9A Films / Nihar Arora @ Sketchfab「Iron-Man Mark 85 | Rigged」(CC-BY 4.0)。
# 姿态:弓步冲拳(右臂掌心炮前伸、左臂收拳、躯干前倾扭转、后腿脚跟抬起)。
# 导出后由 make-fun-models.py 同款 trimesh 归一化(rotY180/身高 3.0m/落地/居中)+ gltf-transform 压缩。
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

# 静置姿态下网格的世界包围盒(模型节点带 ~0.0033 缩放,世界尺寸远小于原生单位)
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
    """世界空间平移骨骼(用于 Hips 整体下蹲/前移)。"""
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

# ---- 战斗姿态 v2:弓步冲拳(世界:模型面朝 -Y,上 = +Z;aim 的 Y 负 = 向前) ----
# 位移量按静置身高换算(模型世界尺寸很小,不能按米拍脑袋)
H = REST_H
# 重心:前移 + 下蹲
move('mixamorig:Hips_01', (0.02*H, -0.075*H, -0.085*H))
# 右腿(前弓):大腿前下方,小腿近垂直,脚掌平贴地
aim('mixamorig:RightUpLeg_060', (-0.05, -0.75, -0.7))
aim('mixamorig:RightLeg_061', (0.03, 0.05, -1.0))
aim('mixamorig:RightFoot_062', (0.0, -0.88, -0.47))
# 左腿(后蹬):大腿后下方,小腿近垂直,脚跟抬起脚尖点地
aim('mixamorig:LeftUpLeg_00', (0.2, 0.7, -0.72))
aim('mixamorig:LeftLeg_056', (0.05, 0.25, -1.0))
aim('mixamorig:LeftFoot_057', (0.0, 0.45, -0.9))
# 躯干:明显前倾 + 向左扭转(右拳打出时肩线对准目标)
rot('mixamorig:Spine_02', x=13)
rot('mixamorig:Spine1_03', x=7, y=-8)
rot('mixamorig:Spine2_04', x=7, y=-8)
# 右臂掌心炮:胸口高度直线前冲,略外让(正脸不被手掌挡住),肘微屈
aim('mixamorig:RightArm_033', (0.14, -0.95, 0.08))
aim('mixamorig:RightForeArm_034', (0.22, -1.0, -0.02))
aim('mixamorig:RightHand_035', (0.2, -1.0, -0.02))
# 左臂:收拳蓄势——上臂后下摆,前臂外张,拳在肩侧(不挡脸)
aim('mixamorig:LeftArm_09', (-0.35, 0.55, -0.75))
aim('mixamorig:LeftForeArm_010', (0.5, 0.3, 0.75))
aim('mixamorig:LeftHand_011', (0.15, -0.8, 0.45))
# 头:视线压向目标
aim('mixamorig:Head_06', (0.02, -0.28, 1.0))

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
]:
    cam_data = bpy.data.cameras.new('cam'); cam_data.clip_end = size*50
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = loc
    cam.rotation_euler = (Vector(c) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam); scene.camera = cam
    scene.render.filepath = f'/tmp/battle_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')

if PREVIEW:
    sys.exit(0)

# ---- 烘焙:应用 Armature modifier,删骨骼,导出 ----
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

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_image_format='AUTO', export_materials='EXPORT',
                          export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
