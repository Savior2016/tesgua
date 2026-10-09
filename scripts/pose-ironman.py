# 钢铁侠战斗姿态烘焙 —— Blender 无头脚本(xvfb-run -a blender -b --python ...)。
# 输入:Mark 85 rigged glTF(Mixamo 骨骼);做法:aim() 按世界方向逐级旋转骨骼
# (掌心炮前伸/弓步/前倾),预览渲染后应用 Armature modifier 烘焙成静态 GLB。
# 预览图:/tmp/battle_front.png、/tmp/battle_three-quarter.png。
import bpy, math, sys
from mathutils import Euler, Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = len(argv) > 2 and argv[2] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')

MW = arm.matrix_world
MWi = MW.inverted()

def aim(bone, direction, twist=0.0):
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

def rot(bone, x=0.0, y=0.0, z=0.0):
    pb = arm.pose.bones.get(bone)
    if pb is None:
        print('MISS', bone); return
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = Euler((math.radians(x), math.radians(y), math.radians(z)), 'XYZ')
    bpy.context.view_layer.update()

# ---- 战斗姿态(世界:模型面朝 -Y,上 = +Z;aim 的 Y 负 = 向前) ----
# 右臂前伸掌心炮:上臂→前臂→手腕逐级指向前方偏下
aim('mixamorig:RightArm_033', (0.08, -1.0, 0.02))
aim('mixamorig:RightForeArm_034', (0.04, -1.0, 0.04))
aim('mixamorig:RightHand_035', (0.0, -1.0, 0.0))
# 左臂:后摆外展
aim('mixamorig:LeftArm_09', (-0.55, 0.35, -0.75))
aim('mixamorig:LeftForeArm_010', (-0.35, 0.55, -0.75))
# 躯干前倾 + 微侧转(脊椎三段叠加)
rot('mixamorig:Spine_02', x=9)
rot('mixamorig:Spine1_03', x=5, y=-5)
rot('mixamorig:Spine2_04', x=5, y=-5)
# 头:回正前倾的视角,平视前方
aim('mixamorig:Head_06', (0.02, -0.12, 1.0))
# 腿部:小幅前后开立(右腿前),避免脚掌离地的悬空感
aim('mixamorig:RightUpLeg_060', (-0.14, -0.45, -1.0))
aim('mixamorig:RightLeg_061', (0.02, -0.08, -1.0))
aim('mixamorig:LeftUpLeg_00', (0.18, 0.38, -1.0))
aim('mixamorig:LeftLeg_056', (0.03, 0.06, -1.0))

# ---- 取景(骨骼世界坐标) ----
mins = [1e9]*3; maxs = [-1e9]*3
for pb in arm.pose.bones:
    for pt in (pb.head, pb.tail):
        w = MW @ pt
        for i in range(3):
            mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
c = [(mins[i]+maxs[i])/2 for i in range(3)]
size = max(maxs[i]-mins[i] for i in range(3))
print('POSED BBOX', [round(v,2) for v in mins], [round(v,2) for v in maxs])

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 700
d = size * 1.6
for name, loc, eul in [
    ('front', (c[0], c[1]-d, c[2]+size*0.05), (math.radians(85),0,0)),
    ('three-quarter', (c[0]+d*0.7, c[1]-d*0.8, c[2]+size*0.25), (math.radians(72),0,math.radians(38))),
]:
    cam_data = bpy.data.cameras.new('cam'); cam_data.clip_end = size*20
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = loc; cam.rotation_euler = eul
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
