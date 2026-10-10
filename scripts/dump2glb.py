# willie dump JSON → 静态 GLB + 归一化(转正/落地/定高/居中)
# 用法: python3 dump2glb.py <in.json> <out.glb> <height> <rotY_deg>
import sys
import numpy as np
import trimesh

SRC, OUT, H, ROT = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
import json
parts = json.load(open(SRC))

scene = trimesh.Scene()
for i, pt in enumerate(parts):
    V = np.array(pt['verts'], dtype=np.float64).reshape(-1, 3)
    F = (np.array(pt['faces'], dtype=np.int64).reshape(-1, 3)
         if pt['faces'] is not None else np.arange(len(V), dtype=np.int64).reshape(-1, 3))
    c = pt['color']
    rgba = [int(c[j:j+2], 16) for j in (0, 2, 4)] + [255]
    tm = trimesh.Trimesh(vertices=V, faces=F, process=False)
    tm.visual = trimesh.visual.ColorVisuals(mesh=tm, face_colors=np.array(rgba, dtype=np.uint8))
    scene.add_geometry(tm, geom_name=f'part{i}')

# rotY 旋转 + 定高 + 落地 + XZ 居中
a = np.radians(ROT)
R = np.eye(4)
R[0, 0], R[0, 2], R[2, 0], R[2, 2] = np.cos(a), np.sin(a), -np.sin(a), np.cos(a)
scene.apply_transform(R)
b = scene.bounds
s = H / (b[1][1] - b[0][1])
cx, cz = (b[0][0] + b[1][0]) / 2, (b[0][2] + b[1][2]) / 2
T = np.eye(4)
T[:3, :3] *= s
T[:3, 3] = [-cx * s, -b[0][1] * s, -cz * s]
scene.apply_transform(T)
print('FINAL BBOX', np.round(scene.bounds, 3).tolist())
scene.export(OUT)
print('OK', OUT)
