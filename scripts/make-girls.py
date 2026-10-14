# 美少女模型批量构建(2026-10-14):导入 → 删散件 → 烘姿态 → 归一化 → 转正 → 导出 GLB
# 源均为 Sketchfab 转存(署名见 app/static/models/fun/CREDITS.md),下载到 /tmp/pvmodels/:
#   cand_dancer  = Dancing Girl from Fire Emblem If (valentinov8060/multiple-marker)
#   cand_sexy    = sexy anime girl (proginvert/3d_resources)
#   cand_bikini101 = Bikini Girl_SF_101 (IngRamirezJezhuah/Porfl_web)
#   cand_mia     = anime girl Mia Ter Excited Preview (kateBea/Mikoto)
#   cand_mikustand = Hatsune Miku Chibi w/ Stand (kookmin-sw/capstone-2021-6)
#   cand_zeze    = zeze 3d anime girl (valentinov8060/multiple-marker,女仆装)
# 要点:姿态经 depsgraph 评估烘焙成静态网格(new_from_object),脱离骨架导出;
# 源模型自带隐藏参照球(Icosphere)/地面阴影板(test_kage)需按名删除;
# zeze 的贴图全塞在 emissive 槽且 emissiveFactor=0(导入后无贴图节点),
# 且每个网格带一层 Material.002 黑色描边壳 → fix_zeze 删壳重建材质;
# 烘进顶点后包围盒会变,二次落地压 z=0;统一转 180° 使正面朝面板 -Z。
# 用法(服务器):xvfb-run -a blender -b --python scripts/make-girls.py
#   然后逐个 gltf-transform optimize(参数同 make-broom.py)
import bpy, math, os
from mathutils import Matrix, Vector

BASE = "/tmp/pvmodels"
MODELS = {
  "azura":      dict(src="cand_dancer/scene.gltf",    H=2.55, drop=[]),
  "stargirl":   dict(src="cand_sexy/scene.gltf",      H=2.75, drop=["Icosphere"]),
  "bikini":     dict(src="cand_bikini101/scene.gltf", H=2.75, drop=[]),
  "mia":        dict(src="cand_mia/scene.gltf",       H=2.75, drop=["Icosphere"]),
  "miku-chibi": dict(src="cand_mikustand/scene.gltf", H=2.30, drop=["test_kage"]),
  "zeze":       dict(src="cand_zeze/scene.gltf",      H=2.75, drop=[], fix="zeze"),
}

def fix_zeze():
    # 删 Material.002 描边壳与无贴图杂件(Material = 参照方块 Cube)
    for o in [x for x in bpy.data.objects if x.type == "MESH"]:
        names = [m.name if m else "" for m in o.data.materials]
        if names and (all(n.startswith("Material.002") for n in names)
                      or all(n == "Material" for n in names)):
            bpy.data.objects.remove(o, do_unlink=True)
    # 重建材质:emissive 贴图转正为基础色贴图
    TEX = {"Body": "Body_emissive.png", "Hair": "Hair_emissive.png",
           "Material.001": "Material.001_emissive.png"}
    for name, png in TEX.items():
        mat = bpy.data.materials.get(name)
        if not mat:
            continue
        mat.use_nodes = True
        nt = mat.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.inputs["Roughness"].default_value = 0.7
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(BASE, "cand_zeze/textures", png))
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

def build(key, cfg):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(BASE, cfg["src"]))
    bpy.context.view_layer.update()
    if cfg.get("fix") == "zeze":
        fix_zeze()
    for name in cfg["drop"]:
        o = bpy.data.objects.get(name)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
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
