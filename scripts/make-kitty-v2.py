# Hello Kitty v2:ZxSimas/hello-kitty-3d 中的 hello_kitty.glb 雕塑版(更圆润的正品比例),
# 原文件无材质,按网格名着色(白身/黑胡须/黄鼻子/红蝴蝶结),补黑色椭圆眼,归一化导出。
# 用法: xvfb-run -a blender -b --python make-kitty-v2.py -- <hello_kitty.glb> <out.glb> [preview]
# 世界:面朝 -Y,上 = +Z(导出 export_yup,后续 trimesh rotY180 转正为 -Z 正面)
import bpy, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = len(argv) > 2 and argv[2] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

def mat(color, rough=0.5):
    m = bpy.data.materials.new('m'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = color
    return m

WHITE = mat((0.96, 0.96, 0.96, 1), 0.55)
BLACK = mat((0.02, 0.02, 0.02, 1), 0.35)
YELLOW = mat((1.0, 0.75, 0.1, 1), 0.4)
RED = mat((0.85, 0.08, 0.12, 1), 0.45)

# 按检视结果逐网格着色
COLOR = {
    'PM3D_Sphere3D1_3_PM3D_Sphere3D1_3_0': WHITE,     # 头
    'PM3D_Sphere3D1_4_PM3D_Sphere3D1_4_0': RED,       # 蝴蝶结(左耳前上)
    'PM3D_Sphere3D1_5_PM3D_Sphere3D1_5_0': WHITE,     # 脸盘
    'PM3D_Sphere3D1_6_PM3D_Sphere3D1_6_0': YELLOW,    # 鼻子
    'PM3D_Cylinder3D2_1_PM3D_Cylinder3D2_1_0': BLACK, # 胡须
    'Extract17_Extract17_0': WHITE,                   # 上身
    'Extract4_Extract4_0': WHITE,                     # 身体
    'PM3D_Sphere3D1_PM3D_Sphere3D1_0': WHITE,         # 身体
    'PM3D_Sphere3D1_1_PM3D_Sphere3D1_1_0': WHITE,     # 手臂
    'PM3D_Sphere3D1_2_PM3D_Sphere3D1_2_0': WHITE,     # 腿脚
}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.name in COLOR:
        o.data.materials.clear()
        o.data.materials.append(COLOR[o.name])

# 眼睛:黑色竖椭圆,贴在脸盘正面凸起的眼位上(前推压过眼凸,保证两侧都露出)
def eye(x, tag):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0022, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.name = tag
    o.scale = (0.85, 0.35, 1.30)
    o.location = (x, -0.0195, 0.0328)
    o.data.materials.append(BLACK)
eye(-0.0076, "eyeL")
eye(0.0076, "eyeR")
bpy.context.view_layer.update()   # 强制刷新 matrix_world(无头模式下延迟求值会把右眼落在原点)

# ---- 转正 + 归一化:面板正面 = -Z(Blender -Y 面朝导出后为 +Z,绕 Z 转 180°),
# 身高 1.8m、落地、XZ 居中(逐网格左乘世界变换,不受层级影响;export_apply 烘进几何) ----
R180 = Matrix.Rotation(3.14159265, 4, 'Z')
for o in bpy.data.objects:
    if o.type in ('MESH', 'CURVE'):
        o.matrix_world = R180 @ o.matrix_world
bpy.context.view_layer.update()
# 旋转后重量包围盒再归一化
mins = [1e9]*3; maxs = [-1e9]*3
for o in bpy.data.objects:
    if o.type == 'MESH':
        mw = o.matrix_world
        for c in o.bound_box:
            w = mw @ Vector(c)
            for i in range(3):
                mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
H = maxs[2] - mins[2]
s = 1.8 / H
cx, cy = (mins[0]+maxs[0])/2, (mins[1]+maxs[1])/2
T = Matrix.Translation(Vector((-cx*s, -cy*s, -mins[2]*s))) @ Matrix.Scale(s, 4)
for o in bpy.data.objects:
    if o.type == 'MESH':
        o.matrix_world = T @ o.matrix_world
bpy.context.view_layer.update()

# 重新量取景包围盒
mins = [1e9]*3; maxs = [-1e9]*3
dg = bpy.context.evaluated_depsgraph_get()
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    eo = o.evaluated_get(dg)
    mw = eo.matrix_world
    for c in o.bound_box:
        w = mw @ Vector(c)
        for i in range(3):
            mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
print('BBOX', [round(v,2) for v in mins], [round(v,2) for v in maxs])
c = [(mins[i]+maxs[i])/2 for i in range(3)]
size = max(maxs[i]-mins[i] for i in range(3))
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = sc.render.resolution_y = 700
d = size * 1.8
for name, loc in [('front', (c[0], c[1]-d, c[2]+size*0.05)),
                  ('tq', (c[0]+d*0.65, c[1]-d*0.75, c[2]+size*0.2)),
                  ('side', (c[0]+d, c[1], c[2]+size*0.05))]:
    cd = bpy.data.cameras.new('cam'); cd.clip_end = size*50
    cam = bpy.data.objects.new('cam', cd); cam.location = loc
    cam.rotation_euler = (Vector(c)-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(cam); sc.camera = cam
    sc.render.filepath = f'/tmp/kittyv2_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')
if PREVIEW:
    sys.exit(0)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
