# 南瓜车(灰姑娘款):纯程序化建模,无版权风险(2026-10-12)
# 构成:瓣纹南瓜车身 + 金色拱形门窗(暖光自发光)+ 四轮金轮(后轮大前轮小)
#       + 金色底盘连杆 + 顶部瓜藤/卷须 + 门阶
# 坐标约定:Blender Z-up 建造,车头朝 -Y(导出 yup 后绕 Z 180° 转正,同钢铁侠教训:
# Blender -Y 朝面导出 → glTF +Z = 面板背面,故导出前 R180)
# 用法(服务器):xvfb-run -a blender -b --python scripts/make-pumpkin-carriage.py
import bpy
import math
import os
from mathutils import Matrix, Vector

BASE = '/tmp/pvmodels'
OUT = f'{BASE}/out/pumpkin-carriage.glb'
LENGTH = 4.2      # 归一化总长(含轮)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- 材质 ----------
def mat(name, color, metallic=0.0, rough=0.5, emission=None, estr=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = estr
    return m

ORANGE = mat('pumpkin', (0.78, 0.26, 0.03), rough=0.4)
ORANGE_DARK = mat('pumpkin_dark', (0.55, 0.18, 0.03), rough=0.45)   # 门板
GOLD = mat('gold', (0.83, 0.58, 0.12), metallic=0.9, rough=0.28)
GLOW = mat('window_glow', (1.0, 0.72, 0.25), rough=0.6, emission=(1.0, 0.62, 0.18), estr=2.5)
STEMM = mat('stem', (0.23, 0.30, 0.08), rough=0.7)

created = []
def keep(o, m=None):
    if m:
        o.data.materials.append(m)
    created.append(o)
    return o

# ---------- 南瓜车身(带瓣纹) ----------
def make_pumpkin():
    # 原点建球(不带 location),局部坐标位移完再抬 object.location,
    # 否则位移数学会把球压成饼(操作符 location 只改物体变换,不改顶点)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=64)
    o = bpy.context.active_object
    o.name = 'Body'
    keep(o, ORANGE)
    for v in o.data.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        # 瓣纹:水平角 10 瓣,向极点衰减
        phi = math.atan2(y, x)
        r_xy = math.hypot(x, y)
        if r_xy > 1e-6:
            pole = min(1.0, r_xy / 0.6)              # 靠近极点不动
            lobe = 1.0 - 0.075 * abs(math.cos(phi * 5)) ** 1.5 * pole
            x *= lobe
            y *= lobe
        z *= 0.92
        if z < -0.95:                                # 底略平
            z = -0.95 - (z + 0.95) * 0.25
        v.co = (x * 1.32, y * 1.05, z)
    o.data.update()
    o.location = (0, 0, 1.62)
    for p in o.data.polygons:
        p.use_smooth = True
    return o

body = make_pumpkin()

# ---------- 拱形面板/框(门、窗) ----------
def arch_points(w, h, n=16):
    """拱形轮廓:矩形+半圆顶,逆时针,底部中心在原点"""
    r = w / 2
    straight = h - r
    pts = [(-r, 0), (-r, straight)]
    for i in range(1, n):
        a = math.pi - math.pi * i / n
        pts.append((r * math.cos(a), straight + r * math.sin(a)))
    pts += [(r, straight), (r, 0)]
    return pts

def make_arch_panel(name, w, h, thick, m):
    pts = arch_points(w, h)
    verts = [(x, 0, z) for x, z in pts] + [(x, thick, z) for x, z in pts]
    n = len(pts)
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return keep(o, m)

def make_arch_frame(name, w, h, thick_frame, depth, m):
    """拱形框:外拱-内拱 的环形板"""
    outer = arch_points(w, h)
    inner = arch_points(w - 2 * thick_frame, h - 2 * thick_frame)
    inner = [(x, z + thick_frame) for x, z in inner]   # 内框底抬高
    no, ni = len(outer), len(inner)
    verts = []
    for y in (0, depth):
        verts += [(x, y, z) for x, z in outer]
        verts += [(x, y, z) for x, z in inner]
    faces = []
    # 前后面环(外圈 i 与内圈对应点近似对齐,逐点连)
    for layer in (0, 1):
        base = layer * (no + ni)
        for i in range(no):
            j = (i + 1) % no
            ii = min(i, ni - 1)
            jj = min(j, ni - 1)
            f = (base + i, base + j, base + no + jj, base + no + ii)
            faces.append(f if layer == 0 else tuple(reversed(f)))
    # 外/内侧壁
    for i in range(no):
        j = (i + 1) % no
        faces.append((i, j, no + ni + j, no + ni + i))
    for i in range(ni):
        j = (i + 1) % ni
        faces.append((no + j, no + i, 2 * no + ni + i, 2 * no + ni + j))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return keep(o, m)

def surface_frame(theta, dist_scale=1.0):
    """车身侧面上角度 theta(0=+X 侧)处的表面点与外法线"""
    # 近似椭球面(瓣纹忽略,面板浮在瓣外)
    x = 1.32 * math.cos(theta) * dist_scale
    y = 1.05 * math.sin(theta) * dist_scale
    z = 1.62
    n = Vector((x / 1.32 ** 2, y / 1.05 ** 2, 0)).normalized()
    return Vector((x, y, z)), n

def place_on_body(o, theta, z_off=0.0, out=0.02):
    """把拱形件(局部:宽 X、厚 Y、高 Z)贴到车身侧面 theta 处"""
    p, n = surface_frame(theta)
    p.z += z_off
    q = n.to_track_quat('Y', 'Z')      # 局部 Y(厚)沿法线朝外
    o.matrix_world = (Matrix.Translation(p + n * out)
                      @ q.to_matrix().to_4x4())

# 每侧:中间门(带小窗),两边各一扇窗。两侧 ±X 对称。
for side in (0, math.pi):
    # 门
    door = make_arch_panel(f'Door_{side}', 0.62, 1.15, 0.05, ORANGE_DARK)
    place_on_body(door, side, z_off=-0.55)
    dframe = make_arch_frame(f'DoorFrame_{side}', 0.72, 1.25, 0.06, 0.05, GOLD)
    place_on_body(dframe, side, z_off=-0.60, out=0.035)
    # 门上小圆窗(圆柱轴/圆环面先转到局部 XZ 平面,使圆面沿局部 Y 朝外)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=0.05, vertices=24)
    dw = keep(bpy.context.active_object, GLOW)
    dw.name = f'DoorWin_{side}'
    for v in dw.data.vertices:
        v.co = Matrix.Rotation(math.pi / 2, 4, 'X') @ v.co
    place_on_body(dw, side, z_off=0.28, out=0.045)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.03,
                                     major_segments=24, minor_segments=8)
    dwf = keep(bpy.context.active_object, GOLD)
    dwf.name = f'DoorWinFrame_{side}'
    for v in dwf.data.vertices:
        v.co = Matrix.Rotation(math.pi / 2, 4, 'X') @ v.co
    place_on_body(dwf, side, z_off=0.28, out=0.05)
    # 两侧窗
    for dt in (-0.62, 0.62):
        win = make_arch_panel(f'Win_{side}_{dt}', 0.42, 0.72, 0.04, GLOW)
        place_on_body(win, side + dt, z_off=-0.25)
        wf = make_arch_frame(f'WinFrame_{side}_{dt}', 0.52, 0.82, 0.05, 0.045, GOLD)
        place_on_body(wf, side + dt, z_off=-0.30, out=0.03)

# 门把手(金球,贴门右缘中高)
for side in (0, math.pi):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, segments=16, ring_count=12)
    k = keep(bpy.context.active_object, GOLD)
    k.name = f'Knob_{side}'
    p, n = surface_frame(side + (-0.17 if side == 0 else 0.17))
    k.location = Vector((p.x, p.y, p.z - 0.45)) + n * 0.08

# ---------- 顶部瓜蒂 + 卷须 ----------
def make_curve_tube(name, points, radius, m, cyclic=False):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for bp, co in zip(sp.bezier_points, points):
        bp.co = co
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    sp.use_cyclic_u = cyclic
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    return keep(o, m)

# 瓜蒂(弯一点的锥形杆)
stem = make_curve_tube('Stem', [(0, 0, 2.42), (0.06, 0.02, 2.66), (0.16, 0.05, 2.84)],
                       0.095, STEMM)
# 卷须(两条螺旋)
for sgn, ph0 in ((1, 0), (-1, math.pi)):
    pts = []
    for i in range(25):
        t = i / 24
        a = ph0 + t * math.pi * 3.2
        r = 0.42 * (1 - t * 0.75)
        pts.append((r * math.cos(a) * sgn, r * math.sin(a), 2.42 + t * 0.30))
    make_curve_tube(f'Vine_{sgn}', pts, 0.042, GOLD)

# ---------- 底盘 + 轮 ----------
# 连杆:前后轴 + 中央纵向梁(金色)
def bar(name, p1, p2, r, m=GOLD):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    mid = (p1 + p2) / 2
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=16)
    o = keep(bpy.context.active_object, m)
    o.name = name
    o.location = mid
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return o

AX_F, AX_R = 1.30, -1.30      # 前/后轴 y 位置
W_X = 0.98                    # 轮横向位置
bar('AxleF', (-W_X + 0.02, AX_F, 0.52), (W_X - 0.02, AX_F, 0.52), 0.05)
bar('AxleR', (-W_X + 0.02, AX_R, 0.66), (W_X - 0.02, AX_R, 0.66), 0.05)
# 纵梁(微弯:三段)
bar('BeamF', (0, AX_F, 0.52), (0, 0.45, 0.78), 0.055)
bar('BeamM', (0, 0.45, 0.78), (0, -0.45, 0.78), 0.055)
bar('BeamR', (0, -0.45, 0.78), (0, AX_R, 0.66), 0.055)

# 轮子:轮圈(torus)+ 辐条(8)+ 轮毂
def make_wheel(name, x, y, r):
    # 轮圈:torus 默认躺在 XY 平面,绕 X 立起(轮面 ⊥ X 轴)
    bpy.ops.mesh.primitive_torus_add(major_radius=r * 0.82, minor_radius=r * 0.13,
                                     major_segments=32, minor_segments=10,
                                     location=(x, y, r), rotation=(math.pi / 2, 0, 0))
    rim = keep(bpy.context.active_object, GOLD)
    rim.name = name + '_rim'
    # 轮毂
    bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.16, depth=0.14, vertices=16,
                                        location=(x, y, r), rotation=(0, math.pi / 2, 0))
    hub = keep(bpy.context.active_object, GOLD)
    hub.name = name + '_hub'
    # 辐条
    for i in range(8):
        a = math.pi * 2 * i / 8
        p1 = Vector((x, y, r)) + Vector((0, math.cos(a), math.sin(a))) * r * 0.14
        p2 = Vector((x, y, r)) + Vector((0, math.cos(a), math.sin(a))) * r * 0.80
        sp = bar(f'{name}_sp{i}', p1, p2, r * 0.05)
    return rim

for sx in (-1, 1):
    make_wheel(f'WF{sx}', sx * W_X, AX_F, 0.52)
    make_wheel(f'WR{sx}', sx * W_X, AX_R, 0.66)

# 门阶(两侧)
for side in (0, math.pi):
    p, n = surface_frame(side)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.06, vertices=24,
                                        scale=(1, 0.6, 1))
    st = keep(bpy.context.active_object, GOLD)
    st.name = f'Step_{side}'
    st.location = Vector((n.x * 1.45, n.y * 1.45, 0.68))

# ---------- 转正/归一化/落地 ----------
meshes = created
# 曲线转网格
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    if o.type == 'CURVE':
        o.select_set(True)
bpy.context.view_layer.objects.active = next(o for o in meshes if o.type == 'CURVE')
bpy.ops.object.convert(target='MESH')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

def bbox_of():
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector(map(min, mins, w))
            maxs = Vector(map(max, maxs, w))
    return mins, maxs

bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

mins, maxs = bbox_of()
print('SRC BBOX', [round(v, 2) for v in mins], [round(v, 2) for v in maxs])
s = LENGTH / (maxs.y - mins.y)
# 归一化 + 落地 + 绕 Z 转 180°(Blender -Y 前脸 → 面板正前)
T = (Matrix.Rotation(math.pi, 4, 'Z')
     @ Matrix.Translation((0, 0, -s * mins.z))
     @ Matrix.Scale(s, 4)
     @ Matrix.Translation((-(mins.x + maxs.x) / 2, -(mins.y + maxs.y) / 2, 0)))
for o in meshes:
    o.matrix_world = T @ o.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mins, maxs = bbox_of()
print('NORM BBOX', [round(v, 3) for v in mins], [round(v, 3) for v in maxs])

# ---------- EEVEE 预览 ----------
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
views = {
    'front': Vector((0, -9.5, c0.z + 0.6)),   # 前脸(-Y)
    'side': Vector((9.5, 0, c0.z + 0.4)),     # 侧面(门窗)
    'tq': Vector((6.5, -7.5, c0.z + 3.2)),
}
for name, pos in views.items():
    cd = bpy.data.cameras.new('cam')
    cd.clip_end = 200
    cam = bpy.data.objects.new('cam', cd)
    cam.location = pos
    cam.rotation_euler = (c0 - pos).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    sc.render.filepath = f'/tmp/pumpkin_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cd)

os.makedirs(f'{BASE}/out', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_apply=True, export_yup=True,
                          export_animations=False, export_skins=False)
print('EXPORTED', OUT)
