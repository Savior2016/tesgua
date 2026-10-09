# 通用模型转正归一化:Blender 无头导入 gltf/glb,可选旋转,按身高归一,落地居中,导出 GLB
# 用法: xvfb-run -a blender -b --python convert_model.py -- <in> <out.glb> <height> [rx ry rz]
import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, HEIGHT = argv[0], argv[1], float(argv[2])
RX, RY, RZ = (float(a) for a in argv[3:6]) if len(argv) > 3 else (0.0, 0.0, 0.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# 世界包围盒(仅网格)
def bbox():
    mins = [1e9]*3; maxs = [-1e9]*3
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        mw = o.matrix_world
        for corner in o.bound_box:
            w = mw @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
    return mins, maxs

print('RAW BBOX', *[round(v,2) for v in bbox()[0]], '|', *[round(v,2) for v in bbox()[1]])

# 旋转(绕世界原点,应用欧拉角到所有根对象)
if RX or RY or RZ:
    for o in bpy.data.objects:
        if o.parent is None:
            o.rotation_euler = (o.rotation_euler.x + math.radians(RX),
                                o.rotation_euler.y + math.radians(RY),
                                o.rotation_euler.z + math.radians(RZ))
    bpy.context.view_layer.update()
    print('ROT BBOX', *[round(v,2) for v in bbox()[0]], '|', *[round(v,2) for v in bbox()[1]])

mins, maxs = bbox()
h = maxs[2] - mins[2]   # Blender z-up:身高沿 z
s = HEIGHT / h
cx, cy = (mins[0]+maxs[0])/2, (mins[1]+maxs[1])/2
for o in bpy.data.objects:
    if o.parent is None:
        o.location = ((o.location.x - cx) * s, (o.location.y - cy) * s, (o.location.z - mins[2]) * s)
        o.scale = tuple(v * s for v in o.scale)
bpy.context.view_layer.update()
print('FINAL BBOX', *[round(v,2) for v in bbox()[0]], '|', *[round(v,2) for v in bbox()[1]])

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_image_format='AUTO', export_materials='EXPORT',
                          export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
