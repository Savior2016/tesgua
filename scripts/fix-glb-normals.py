#!/usr/bin/env python3
"""Fix missing vertex normals in the optimized Model Y GLB.

The trimesh optimization pipeline dropped NORMAL attributes (three.js then
renders all lit materials black). This recomputes smooth vertex normals from
the face geometry and re-exports the GLB in place.

Usage: python3 scripts/fix-glb-normals.py <glb_path>
"""
import sys

import numpy as np
import trimesh

GLB = sys.argv[1] if len(sys.argv) > 1 else 'app/static/models/model-y.glb'

scene = trimesh.load(GLB)
meshes = scene.dump(concatenate=False)

CAR_CENTER = np.array([0.0, 0.7, 0.0])   # 车体近似中心

fixed = trimesh.Scene()
for g in meshes:
    # vertex_normals 为惰性计算;显式赋值强制写入导出数据
    g.vertex_normals = np.asarray(g.vertex_normals, dtype=np.float64).copy()
    assert np.isfinite(g.vertex_normals).all(), 'NaN normals'
    # 法线朝内的网格(如 glass_body)翻转:法线应背离车体中心
    align = float((g.vertex_normals * (g.vertices - CAR_CENTER)).sum(axis=1).mean())
    if align < 0:
        g.invert()
        mat = getattr(getattr(g.visual, 'material', None), 'name', '?')
        print(f'inverted: {mat} ({len(g.vertices)} verts, align={align:.3f})')
    fixed.add_geometry(g)

fixed.export(GLB)

# 自检:重新解析 GLB,确认每个 primitive 都有单位 NORMAL
import json, struct  # noqa: E402

data = open(GLB, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
gltf = json.loads(data[20:20 + jlen])
bin_start = 20 + jlen + 8
binbuf = data[bin_start:]

missing = bad = total = 0
for mesh in gltf['meshes']:
    for prim in mesh['primitives']:
        total += 1
        idx = prim['attributes'].get('NORMAL')
        if idx is None:
            missing += 1
            continue
        acc = gltf['accessors'][idx]
        bv = gltf['bufferViews'][acc['bufferView']]
        off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        arr = np.frombuffer(binbuf, dtype=np.float32, count=acc['count'] * 3, offset=off).reshape(-1, 3)
        if np.linalg.norm(arr, axis=1).mean() < 0.9:
            bad += 1
print(f'primitives={total} missing_normal={missing} bad_normal={bad}')
assert missing == 0 and bad == 0, 'normal fix failed'
print('OK:', GLB)
