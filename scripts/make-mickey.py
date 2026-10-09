# 程序化米老鼠 v2:更圆润的 Q 版比例(大头、贴脸白手套、大黄鞋、标志性细尾巴)
# 纯几何拼装 + 纯色材质,无外部资源;尊重 1928 公有领域形象的经典配色演绎。
# 用法: xvfb-run -a blender -b --python make-mickey-v2.py -- <out.glb> [preview]
# 世界约定:面朝 -Y,上 = +Z;导出前归一化到身高 1.7m、落地、XZ 居中。
import bpy, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
PREVIEW = len(argv) > 1 and argv[1] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)

BLACK = (0.03, 0.03, 0.035, 1)
SKIN = (1.0, 0.82, 0.62, 1)      # 面部肤色
RED = (0.85, 0.08, 0.1, 1)       # 短裤
YELLOW = (1.0, 0.78, 0.12, 1)    # 鞋
WHITE = (0.97, 0.97, 0.97, 1)    # 手套/扣子/眼白

def mat(color, rough=0.45):
    m = bpy.data.materials.new('m'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    m.diffuse_color = color
    return m

M_BLACK = mat(BLACK)
M_SKIN = mat(SKIN, 0.5)
M_RED = mat(RED)
M_YELLOW = mat(YELLOW)
M_WHITE = mat(WHITE, 0.4)
M_NOSE = mat(BLACK, 0.2)         # 鼻尖高光

def sphere(r, loc, scale=(1, 1, 1), material=M_BLACK, seg=32, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
    o = bpy.context.active_object
    o.location = loc
    o.scale = scale
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o

def capsule(r, depth, loc, rot=(0, 0, 0), material=M_BLACK):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=24)
    o = bpy.context.active_object
    o.location = loc
    o.rotation_euler = rot
    o.data.materials.append(material)
    for s in (-1, 1):   # 两端半球帽
        cap = sphere(r, (0, 0, 0), material=material)
        cap.parent = o
        cap.location = (0, 0, s * depth / 2)
    bpy.ops.object.shade_smooth()
    return o

def torus(major, minor, loc, rot=(0, 0, 0), material=M_WHITE, arc=2 * math.pi):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
        major_segments=40, minor_segments=10, location=loc, rotation=rot,
        abso_major_rad=major, abso_minor_rad=minor)
    o = bpy.context.active_object
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o

# ---- 头 ----
sphere(0.32, (0, 0, 1.10))                                   # 头颅(黑)
sphere(0.16, (-0.255, 0.02, 1.37), (1, 0.55, 1))             # 左耳(压扁的圆饼)
sphere(0.16, (0.255, 0.02, 1.37), (1, 0.55, 1))              # 右耳
# 面部肤色面具:略小的球前移下沉,黑色只留在头顶/两侧(放大盖住下巴)
sphere(0.295, (0, -0.060, 1.030), (1, 0.94, 0.98), M_SKIN)
# 眼周隆起(米奇标志性的连体长眼区,两眼几乎相接)
sphere(0.115, (-0.072, -0.225, 1.225), (0.66, 0.55, 1.12), M_SKIN)
sphere(0.115, (0.072, -0.225, 1.225), (0.66, 0.55, 1.12), M_SKIN)
# 眼白(竖长椭圆,内侧相贴)+ 黑瞳靠上
sphere(0.050, (-0.058, -0.285, 1.235), (0.60, 0.30, 1.30), M_WHITE)
sphere(0.050, (0.058, -0.285, 1.235), (0.60, 0.30, 1.30), M_WHITE)
sphere(0.019, (-0.050, -0.318, 1.262), (0.72, 0.42, 1.35), M_NOSE)
sphere(0.019, (0.050, -0.318, 1.262), (0.72, 0.42, 1.35), M_NOSE)
# 吻部 + 大鼻尖
sphere(0.135, (0, -0.26, 0.985), (1.12, 0.88, 0.70), M_SKIN)
sphere(0.056, (0, -0.372, 1.005), (1.12, 0.88, 0.78), M_NOSE)
# 微笑:两端上翘的弧线(曲线 bevel;v2 初版用整环侧面看像叼着圈)
def curve_tube(name, pts, bevel, material):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    ob = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(ob)
    cu.materials.append(material)
    return ob
curve_tube('smile', [(-0.105, -0.315, 0.955), (0, -0.345, 0.925), (0.105, -0.315, 0.955)],
           0.011, M_BLACK)

# ---- 身体 ----
capsule(0.170, 0.20, (0, 0, 0.615))                          # 黑色躯干
sphere(0.230, (0, 0, 0.435), (1.06, 1.0, 0.70), M_RED)       # 红短裤
# 大白扣(椭圆,竖向)
sphere(0.040, (-0.092, -0.238, 0.455), (1, 0.35, 1.35), M_WHITE)
sphere(0.040, (0.092, -0.238, 0.455), (1, 0.35, 1.35), M_WHITE)
# 手臂:自然下垂略外张;袖口白环 + 白手套(连指 + 拇指球)
for sx in (-1, 1):
    capsule(0.056, 0.28, (sx * 0.205, -0.01, 0.575),
            (math.radians(-6), sx * math.radians(14), 0))
    # 袖口(腕部白环,横放)
    torus(0.058, 0.020, (sx * 0.253, -0.028, 0.435),
          (math.radians(84), sx * math.radians(14), 0))
    sphere(0.088, (sx * 0.272, -0.045, 0.360), (0.95, 1.0, 1.05), M_WHITE)  # 手套
    sphere(0.030, (sx * 0.205, -0.115, 0.365), (1, 1, 1), M_WHITE)          # 拇指
# 腿 + 大黄鞋(鞋头长圆前伸,标志性)
capsule(0.056, 0.15, (-0.10, 0, 0.235))
capsule(0.056, 0.15, (0.10, 0, 0.235))
sphere(0.095, (-0.125, -0.105, 0.052), (1.02, 1.75, 0.58), M_YELLOW)
sphere(0.095, (0.125, -0.105, 0.052), (1.02, 1.75, 0.58), M_YELLOW)
# 细尾巴:从短裤后缘甩出的 S 形细鞭(曲线 bevel)
cu = bpy.data.curves.new('tail', 'CURVE')
cu.dimensions = '3D'
cu.bevel_depth = 0.012
cu.bevel_resolution = 3
sp = cu.splines.new('BEZIER')
sp.bezier_points.add(3)
for bp, co in zip(sp.bezier_points, [
        (0, 0.185, 0.46), (0.03, 0.27, 0.52), (0.07, 0.31, 0.66), (0.055, 0.30, 0.80)]):
    bp.co = co
    bp.handle_left_type = 'AUTO'
    bp.handle_right_type = 'AUTO'
tail = bpy.data.objects.new('tail', cu)
bpy.context.scene.collection.objects.link(tail)
cu.materials.append(M_BLACK)

# ---- 转正 + 归一化:面板正面 = -Z(Blender -Y 面朝导出后为 +Z,绕 Z 转 180°),
# 身高 1.7m、落地、XZ 居中 ----
def measure():
    mn = [1e9]*3; mx = [-1e9]*3
    for o in bpy.data.objects:
        if o.type == 'MESH':
            mw = o.matrix_world
            for c in o.bound_box:
                w = mw @ Vector(c)
                for i in range(3):
                    mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
        elif o.type == 'CURVE':
            for sp in o.data.splines:
                pts = sp.bezier_points if sp.type == 'BEZIER' else sp.points
                for p0 in pts:
                    w = o.matrix_world @ p0.co
                    for i in range(3):
                        mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

R180 = Matrix.Rotation(3.14159265, 4, 'Z')
for o in bpy.data.objects:
    if o.type in ('MESH', 'CURVE'):
        o.matrix_world = R180 @ o.matrix_world
bpy.context.view_layer.update()
mins, maxs = measure()
H = maxs[2] - mins[2]
s = 1.7 / H
cx, cy = (mins[0]+maxs[0])/2, (mins[1]+maxs[1])/2
T = Matrix.Translation(Vector((-cx*s, -cy*s, -mins[2]*s))) @ Matrix.Scale(s, 4)
for o in bpy.data.objects:
    if o.type in ('MESH', 'CURVE'):
        o.matrix_world = T @ o.matrix_world
bpy.context.view_layer.update()
mins, maxs = measure()
# 曲线(微笑/尾巴)转网格(GLTF 不导出 CURVE)
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.type == 'CURVE':
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
bpy.ops.object.convert(target='MESH')

# ---- 取景预览 ----
c = [(mins[i]+maxs[i])/2 for i in range(3)]
size = max(maxs[i]-mins[i] for i in range(3))
print('BBOX', [round(v, 2) for v in mins], [round(v, 2) for v in maxs])
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = sc.render.resolution_y = 700
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
    sc.collection.objects.link(cam); sc.camera = cam
    sc.render.filepath = f'/tmp/mickeyv2_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')
if PREVIEW:
    sys.exit(0)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
