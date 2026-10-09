# Hello Kitty 五官补丁:模型 UV 取色自平面图导致面部空白,手动补眼睛+鼻子
# 用法: xvfb-run -a blender -b --python fix_kitty.py -- <in.glb> <out.glb> [preview]
import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = len(argv) > 2 and argv[2] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# 网格世界包围盒
def bbox(objs=None):
    mins = [1e9]*3; maxs = [-1e9]*3
    for o in (objs or bpy.data.objects):
        if o.type != 'MESH': continue
        mw = o.matrix_world
        for corner in o.bound_box:
            w = mw @ Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
    return mins, maxs

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
mins, maxs = bbox(meshes)
print('BBOX', [round(v,2) for v in mins], [round(v,2) for v in maxs])
H = maxs[2] - mins[2]
# 头部:上 40% 的顶点区间
head_lo = mins[2] + H*0.55
hx0, hx1 = mins[0], maxs[0]
hw = (hx1 - hx0) / 2
hcx = (hx0 + hx1) / 2
# 面部朝向:蝴蝶结在头部一侧;先按 -Y 为正面试(预览确认)
face_y = mins[1]
hz = head_lo + H*0.18   # 眼睛高度(头部下三分之一处)

def add_eye(x, z, ry=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=H*0.045, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.scale = (1.0, 0.35, 1.35)
    o.location = (x, face_y - H*0.012, z)
    m = bpy.data.materials.new('eye'); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.02, 0.02, 0.02, 1)
    bsdf.inputs['Roughness'].default_value = 0.35
    o.data.materials.append(m)
    return o

def add_nose(x, z):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=H*0.038, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.scale = (1.25, 0.35, 0.9)
    o.location = (x, face_y - H*0.014, z)
    m = bpy.data.materials.new('nose'); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (1.0, 0.75, 0.1, 1)
    bsdf.inputs['Roughness'].default_value = 0.4
    o.data.materials.append(m)
    return o

add_eye(hcx - hw*0.42, hz)
add_eye(hcx + hw*0.42, hz)
add_nose(hcx, hz - H*0.075)

# 预览取景
c = [(mins[i]+maxs[i])/2 for i in range(3)]
size = max(maxs[i]-mins[i] for i in range(3))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 700
d = size * 1.8
for name, loc in [
    ('negY', (c[0], c[1]-d, c[2]+size*0.1)),
    ('posY', (c[0], c[1]+d, c[2]+size*0.1)),
    ('tq',    (c[0]+d*0.65, c[1]-d*0.75, c[2]+size*0.25)),
]:
    cam_data = bpy.data.cameras.new('cam'); cam_data.clip_end = size*50
    cam = bpy.data.objects.new('cam', cam_data)
    cam.location = loc
    cam.rotation_euler = (Vector(c) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam); scene.camera = cam
    scene.render.filepath = f'/tmp/kitty_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')
if PREVIEW:
    sys.exit(0)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_image_format='AUTO', export_materials='EXPORT',
                          export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
