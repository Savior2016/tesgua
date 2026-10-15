# 美少女模型批量构建第二批(2026-10-15):13 个新角色,管线同 make-girls.py
# 源均为 Sketchfab 转存(CC-BY 4.0,署名见 app/static/models/fun/CREDITS.md),
# 下载在 /tmp/pvmodels/r2/。要点同第一批:烘姿态脱离骨架、Icosphere 参照球按名剔除;
# 新增 drop_tree(连子树一起删,对付 cyber_girl 的重复骨架整支);
# kindred 的 scene.gltf 已预先打补丁(emissiveTexture → baseColorTexture,
# 源材质全黑 unlit,不补则在 three.js 里渲染成黑剪影);
# anime_fox_girl 的 Object_283 是 7m 黑色挡板,cyber_girl 的 WhitehairPreview 是
# 第二份完整角色拷贝,spirit_blossom_kindred 的 Object_4 是 7m VFX 大平面,均剔除。
# 用法(服务器):xvfb-run -a blender -b --python scripts/make-girls2.py
#   然后逐个 gltf-transform optimize(参数同 make-broom.py)
import bpy, math, os
from mathutils import Matrix, Vector

BASE = "/home/ubuntu/pvmodels"
MODELS = {
  "aerith":     dict(src="r2/aerith_default",                H=2.60, drop=["Icosphere"]),
  "foxgirl":    dict(src="r2/anime_fox_girl",                H=2.60, drop=["Icosphere", "Object_283"]),
  "miyu":       dict(src="r2/blue_archivekasumizawa_miyu",   H=2.50, drop=["Icosphere"]),
  "cybergirl":  dict(src="r2/cyber_girl",                    H=2.60, drop=["Icosphere", "WhitehairPreview"]),
  "elfgirl":    dict(src="r2/elf_girl",                      H=2.60, drop=["Icosphere"]),
  "miku":       dict(src="r2/hatsune_miku",                  H=2.60, drop=["Icosphere"]),
  "lightning":  dict(src="r2/lightning_-_white_mage",        H=2.60, drop=["Icosphere"]),
  "missgalaxy": dict(src="r2/miss_galaxy",                   H=2.70, drop=["Icosphere"]),
  "schoolgirl": dict(src="r2/school_girl_3d_model",          H=2.55, drop=["Icosphere"]),
  "kindred":    dict(src="r2/spirit_blossom_kindred",        H=2.60, drop=["Object_4"]),
  "tifa-chibi": dict(src="r2/tifa_-_itadaki_street_special", H=1.90, drop=["Icosphere"]),
  "veera":      dict(src="r2/veera_aov",                     H=2.60, drop=["Icosphere"]),
  "ganyu":      dict(src="r2/ys",                            H=2.60, drop=["Icosphere"]),
}

def drop_tree(o):
    for c in list(o.children):
        drop_tree(c)
    print("DROP", o.name)
    bpy.data.objects.remove(o, do_unlink=True)

def build(key, cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    srcdir = os.path.join(BASE, cfg["src"])
    src = os.path.join(srcdir, "scene.gltf")
    if not os.path.exists(src):
        src = next(os.path.join(srcdir, f) for f in os.listdir(srcdir) if f.endswith((".gltf", ".glb")))
    bpy.ops.import_scene.gltf(filepath=src)
    bpy.context.view_layer.update()
    targets = [o.name for o in bpy.data.objects
               if any(o.name == d or o.name.startswith(d + ".") for d in cfg["drop"])]
    for n in targets:
        o = bpy.data.objects.get(n)
        if o:
            drop_tree(o)
    # 烘姿态:取 depsgraph 评估网格(含骨架 modifier),脱离骨架/父子
    dg = bpy.context.evaluated_depsgraph_get()
    baked = []
    for o in [x for x in bpy.data.objects if x.type == "MESH"]:
        oe = o.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(oe, depsgraph=dg)
        no = bpy.data.objects.new(o.name, me)
        no.matrix_world = oe.matrix_world.copy()
        bpy.context.collection.objects.link(no)
        baked.append(no)
    for o in [x for x in bpy.data.objects if x not in baked]:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = baked

    def bbox_of():
        mins = Vector((1e9,) * 3)
        maxs = Vector((-1e9,) * 3)
        for o in meshes:
            mw = o.matrix_world
            for c in o.bound_box:
                w = mw @ Vector(c)
                mins = Vector(map(min, mins, w))
                maxs = Vector(map(max, maxs, w))
        return mins, maxs

    mins, maxs = bbox_of()
    print(key, "SRC BBOX", [round(v, 2) for v in mins], [round(v, 2) for v in maxs])
    h = maxs.z - mins.z
    s = cfg["H"] / h
    # 归一化:XY 居中、落地、高度 H、绕 Z 转 180°(Blender -Y 前脸 → 面板 -Z 正前)
    T = (Matrix.Rotation(math.pi, 4, "Z")
         @ Matrix.Translation((0, 0, -s * mins.z))
         @ Matrix.Scale(s, 4)
         @ Matrix.Translation((-(mins.x + maxs.x) / 2, -(mins.y + maxs.y) / 2, 0)))
    for o in meshes:
        o.matrix_world = T @ o.matrix_world
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # 二次落地:烘进顶点后包围盒会变,按新 bbox 再压一次 z=0
    mins, maxs = bbox_of()
    if abs(mins.z) > 1e-4:
        dz = -mins.z
        for o in meshes:
            o.matrix_world = Matrix.Translation((0, 0, dz)) @ o.matrix_world
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        mins, maxs = bbox_of()
    print(key, "NORM BBOX", [round(v, 3) for v in mins], [round(v, 3) for v in maxs])
    out = os.path.join(BASE, "raw", key + ".glb")
    os.makedirs(os.path.join(BASE, "raw"), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB",
                              export_apply=True, export_yup=True,
                              export_animations=False, export_skins=False)
    print(key, "EXPORTED", out, os.path.getsize(out) // 1024, "KB")

for key, cfg in MODELS.items():
    build(key, cfg)
