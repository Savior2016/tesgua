# Hello Kitty 姿势+五官补丁:双臂经骨骼自然下垂后烘焙;模型 UV 取色自平面图导致面部空白,补眼睛+鼻子
# 用法: xvfb-run -a blender -b --python scripts/fix-kitty.py -- <Kitty_noanim.glb> <out.glb> [preview]
import bpy, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
PREVIEW = len(argv) > 2 and argv[2] == 'preview'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
def world_bbox():
    dg = bpy.context.evaluated_depsgraph_get()
    mins=[1e9]*3; maxs=[-1e9]*3
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        eo = o.evaluated_get(dg); me = eo.to_mesh(); mw = eo.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            for i in range(3):
                mins[i]=min(mins[i],w[i]); maxs[i]=max(maxs[i],w[i])
        eo.to_mesh_clear()
    return mins, maxs

if arm:
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    MW = arm.matrix_world; MWi = MW.inverted()
    for b in arm.pose.bones:
        h = MW @ b.head
        print('BONE', b.name, [round(v,3) for v in h])
    def aim(bone, direction):
        pb = arm.pose.bones.get(bone)
        if pb is None: print('MISS', bone); return
        bpy.context.view_layer.update()
        head_w = MW @ pb.head
        cur = (MW @ pb.tail) - head_w
        rot = cur.normalized().rotation_difference(Vector(direction).normalized())
        R = rot.to_matrix().to_4x4()
        M = MW @ pb.matrix
        pb.matrix = MWi @ (Matrix.Translation(head_w) @ R @ Matrix.Translation(-head_w) @ M)
        bpy.context.view_layer.update()
    # 双臂下垂:沿身体向斜下方(模型面朝 -Y;±X = 左右)
    for b in arm.pose.bones:
        h = MW @ b.head
        if b.name.startswith('Arm'):
            sx = 1.0 if h.x > 0 else -1.0
            aim(b.name, (0.55*sx, -0.05, -1.0))
    bpy.ops.object.mode_set(mode='OBJECT')
    # 烘焙:应用 Armature 修改器,删骨骼
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH': continue
        bpy.context.view_layer.objects.active = obj
        for mod in list(obj.modifiers):
            if mod.type == 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(arm, do_unlink=True)

mins, maxs = world_bbox()
print('BBOX', [round(v,2) for v in mins], [round(v,2) for v in maxs])
H = maxs[2] - mins[2]
head_lo = mins[2] + H*0.55
hw = (maxs[0]-mins[0]) / 2
hcx = (mins[0]+maxs[0]) / 2
face_y = mins[1]
hz = head_lo + H*0.18

def add_blob(x, z, radius, scale, yoff, color, rough):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=24, ring_count=16)
    o = bpy.context.active_object
    o.scale = scale
    o.location = (x, face_y + yoff, z)
    m = bpy.data.materials.new('face'); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*color, 1)
    o.data.materials.append(m)

add_blob(hcx - hw*0.42, hz, H*0.045, (1.0,0.35,1.35), -H*0.012, (0.02,0.02,0.02), 0.35)
add_blob(hcx + hw*0.42, hz, H*0.045, (1.0,0.35,1.35), -H*0.012, (0.02,0.02,0.02), 0.35)
add_blob(hcx, hz - H*0.075, H*0.038, (1.25,0.35,0.9), -H*0.014, (1.0,0.75,0.1), 0.4)

c = [(mins[i]+maxs[i])/2 for i in range(3)]
size = max(maxs[i]-mins[i] for i in range(3))
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = scene.render.resolution_y = 700
d = size * 1.8
for name, loc in [('negY',(c[0],c[1]-d,c[2]+size*0.1)), ('tq',(c[0]+d*0.65,c[1]-d*0.75,c[2]+size*0.25)), ('side',(c[0]+d,c[1],c[2]+size*0.05))]:
    cd = bpy.data.cameras.new('cam'); cd.clip_end = size*50
    cam = bpy.data.objects.new('cam', cd)
    cam.location = loc
    cam.rotation_euler = (Vector(c)-Vector(loc)).to_track_quat('-Z','Y').to_euler()
    scene.collection.objects.link(cam); scene.camera = cam
    scene.render.filepath = f'/tmp/kitty2_{name}.png'
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
print('PREVIEW OK')
if PREVIEW: sys.exit(0)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='AUTO',
                          export_materials='EXPORT', export_yup=True, export_apply=True)
print('EXPORT OK', OUT)
