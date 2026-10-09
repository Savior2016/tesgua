# 程序化米老鼠(Q版):纯几何拼装 + 纯色材质,无外部资源
# 用法: xvfb-run -a blender -b --python make_mickey.py -- <out.glb> [preview]
# 世界约定:面朝 -Y,上 = +Z
import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
PREVIEW = len(argv) > 1 and argv[1] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)

BLACK = (0.03, 0.03, 0.035, 1)
SKIN = (1.0, 0.82, 0.62, 1)      # 面部肤色
RED = (0.85, 0.08, 0.1, 1)       # 短裤
YELLOW = (1.0, 0.78, 0.12, 1)    # 鞋
WHITE = (0.97, 0.97, 0.97, 1)    # 手套/扣子/眼白

def mat(color, rough=0.55):
    m = bpy.data.materials.new('m'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = color   # 工作台预览用
    return m

M_BLACK, M_SKIN, M_RED, M_YELLOW, M_WHITE = (mat(c) for c in (BLACK, SKIN, RED, YELLOW, WHITE))

def sphere(r, loc, scale=(1,1,1), material=M_BLACK, seg=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
    o = bpy.context.active_object
    o.location = loc; o.scale = scale
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o

def capsule(r, depth, loc, rot=(0,0,0), material=M_BLACK):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=24)
    o = bpy.context.active_object
    o.location = loc; o.rotation_euler = rot
    o.data.materials.append(material)
    # 两端半球
    for s in (-1, 1):
        cap = sphere(r, (0,0,0), material=material)
        cap.parent = o
        cap.location = (0, 0, s * depth/2)
    bpy.ops.object.shade_smooth()
    return o

# ---- 头(黑色底) ----
sphere(0.34, (0, 0, 1.06))                              # 头颅
sphere(0.175, (-0.27, 0.02, 1.34))                      # 左耳
sphere(0.175, (0.27, 0.02, 1.34))                       # 右耳
# ---- 面部肤色面具:略小的球前移下沉,只在脸前部露出 ----
sphere(0.305, (0, -0.075, 1.0), (1, 1, 0.95), M_SKIN)
# 眼周隆起(米奇标志性的长眼区)
sphere(0.13, (-0.105, -0.26, 1.17), (0.62, 0.5, 1.05), M_SKIN)
sphere(0.13, (0.105, -0.26, 1.17), (0.62, 0.5, 1.05), M_SKIN)
# 眼睛:白椭圆 + 黑瞳
sphere(0.055, (-0.1, -0.335, 1.18), (0.62, 0.32, 1.15), M_WHITE)
sphere(0.055, (0.1, -0.335, 1.18), (0.62, 0.32, 1.15), M_WHITE)
sphere(0.022, (-0.09, -0.365, 1.155), (0.7, 0.4, 1.2), M_BLACK)
sphere(0.022, (0.09, -0.365, 1.155), (0.7, 0.4, 1.2), M_BLACK)
# 吻部 + 鼻尖
sphere(0.155, (0, -0.3, 0.94), (1.15, 0.85, 0.72), M_SKIN)
sphere(0.058, (0, -0.42, 0.98), (1.15, 0.9, 0.8), M_BLACK)
# 微笑嘴:黑色细环段
bpy.ops.mesh.primitive_torus_add(major_radius=0.075, minor_radius=0.011, major_segments=32, minor_segments=8,
                                 location=(0, -0.385, 0.905), rotation=(math.radians(78), 0, 0))
bpy.context.active_object.data.materials.append(M_BLACK)

# ---- 身体 ----
capsule(0.185, 0.22, (0, 0, 0.62))                      # 黑色躯干
sphere(0.24, (0, 0, 0.42), (1.06, 1.0, 0.72), M_RED)    # 红短裤
sphere(0.032, (-0.09, -0.225, 0.45), (1, 0.4, 1.3), M_WHITE)   # 扣子
sphere(0.032, (0.09, -0.225, 0.45), (1, 0.4, 1.3), M_WHITE)
# 手臂:肩部外张微向前,白手套
capsule(0.062, 0.3, (-0.26, -0.02, 0.63), (0, math.radians(55), math.radians(-15)))
capsule(0.062, 0.3, (0.26, -0.02, 0.63), (0, math.radians(-55), math.radians(15)))
sphere(0.095, (-0.42, -0.09, 0.5), (1, 1, 1.08), M_WHITE)      # 左手套
sphere(0.095, (0.42, -0.09, 0.5), (1, 1, 1.08), M_WHITE)
# 腿 + 黄鞋
capsule(0.062, 0.16, (-0.11, 0, 0.22))
capsule(0.062, 0.16, (0.11, 0, 0.22))
sphere(0.1, (-0.13, -0.09, 0.055), (1.0, 1.6, 0.55), M_YELLOW)
sphere(0.1, (0.13, -0.09, 0.055), (1.0, 1.6, 0.55), M_YELLOW)

# ---- 取景预览 ----
mins = [1e9]*3; maxs = [-1e9]*3
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    mw = o.matrix_world
    for corner in o.bound_box:
        w = mw @ Vector(corner)
        for i in range(3):
            mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
c = [(mins[i]+maxs[i])/2 for i in range(3)]
size = max(maxs[i]-mins[i] for i in range(3))
print('BBOX', [round(v,2) for v in mins], [round(v,2) for v in maxs])
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = scene.render.resolution_y = 700
d = size * 1.7
for name, loc in [
    ('front', (c[0], c[1]-d, c[2]+size*0.05)),
    ('tq',    (c[0]+d*0.65, c[1]-d*0.75, c[2]+size*0.2)),
    ('side',  (c[0]+d, c[1], c[2]+size*0.05)),
]:
    cam_data = bpy.data.cameras.new('cam'); cam_data.clip_end = size*50
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = loc
    cam.rotation_euler = (Vector(c) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam); scene.camera = cam
    scene.render.filepath = f'/tmp/mickey_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')
if PREVIEW:
    sys.exit(0)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
