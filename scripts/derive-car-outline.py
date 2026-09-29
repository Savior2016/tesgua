#!/usr/bin/env python3
"""Derive the 2D top-view car SVG paths from the 3D Model Y GLB projection.

Projects body/glass meshes to the ground plane (top view) and fits concave
hulls, so the 2D overview car is literally the shadow of the 3D model.

Usage: python3 scripts/derive-car-outline.py [glb_path]
Output: SVG path data for body / windshield / glass roof / rear glass / tires.
"""
import sys

import numpy as np
import trimesh
import alphashape

GLB = sys.argv[1] if len(sys.argv) > 1 else '/tmp/model-y.glb'

# Model axes: X = length (front = -X), Y = height, Z = width.
# SVG: front at top. viewBox 340x460, car spans y40..424 like the current design.
S = 384 / 4.7507          # px per meter
def to_svg(x, z):         # model coords -> svg coords
    return (170 + z * S, 40 + (x + 2.3751) * S)

scene = trimesh.load(GLB)
meshes = scene.dump(concatenate=False)


def mat_name(g):
    return getattr(getattr(g.visual, 'material', None), 'name', '')


def outline(gs, alpha=2.5, simplify_m=0.02, n=48):
    """Projected concave hull -> n evenly sampled points (model coords)."""
    pts = np.concatenate([g.vertices[:, [2, 0]] for g in gs])  # (z, x)
    poly = alphashape.alphashape(pts, alpha)
    poly = poly.simplify(simplify_m)
    ring = poly.exterior
    # 按弧长均匀采样
    seg = ring.length / n
    samples = [ring.interpolate(i * seg) for i in range(n)]
    return [(p.x, p.y) for p in samples]  # (z, x) model


def catmull_rom_svg(points, closed=True):
    """(z,x) 模型坐标点列 -> Catmull-Rom 平滑 SVG 路径(车头朝上)。"""
    pts = [to_svg(x, z) for z, x in points]
    n = len(pts)
    d = [f'M{pts[0][0]:.1f} {pts[0][1]:.1f}']
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p0[1][0] + (p0[2][0] - p0[0][0]) / 6, p0[1][1] + (p0[2][1] - p0[0][1]) / 6)
        c2 = (p0[2][0] - (p0[3][0] - p0[1][0]) / 6, p0[2][1] - (p0[3][1] - p0[1][1]) / 6)
        d.append(f'C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p0[2][0]:.1f} {p0[2][1]:.1f}')
    if closed:
        d.append('Z')
    return ' '.join(d)


by_mat = {}
for g in meshes:
    by_mat.setdefault(mat_name(g), []).append(g)

# 车身:body + fenders(含后视镜、轮拱)
body_path = catmull_rom_svg(outline(by_mat['body'] + by_mat['fenders'], alpha=2.0, n=56))
print('BODY:', body_path)
print()

# 玻璃:按世界包围盒识别(前=-X)
glass = by_mat['glass_body']
def mesh_xrange(g):
    return g.bounds[0][0], g.bounds[1][0]
windshield = min(glass, key=lambda g: mesh_xrange(g)[0])          # 最靠前
roof = max(glass, key=lambda g: len(g.vertices))                  # 最大件=玻璃顶
rear = max(glass, key=lambda g: mesh_xrange(g)[1])                # 最靠后
print('WS:', catmull_rom_svg(outline([windshield], alpha=2.5, n=20)))
print()
print('ROOF:', catmull_rom_svg(outline([roof], alpha=2.5, n=24)))
print()
print('REAR:', catmull_rom_svg(outline([rear], alpha=2.5, n=16)))
print()

# 轮胎:四轮接地包围盒(取 tires 中 4 个最大件)
tires = sorted(by_mat['tires'], key=lambda g: -len(g.vertices))[:4]
for g in tires:
    b = g.bounds
    (x0, y0), (x1, y1) = to_svg(b[0][0], b[0][2]), to_svg(b[1][0], b[1][2])
    print(f'TIRE: x={min(x0,x1):.1f} y={min(y0,y1):.1f} w={abs(x1-x0):.1f} h={abs(y1-y0):.1f}')
print()

# 前大灯:glass_front_lights 两枚(左/右)
for i, g in enumerate(sorted(by_mat['glass_front_lights'], key=lambda g: g.bounds[0][2])):
    print(f'HL{i}:', catmull_rom_svg(outline([g], alpha=3.0, simplify_m=0.008, n=14)))
    print()

# 尾灯:chrome_rear_lights 按左/右分组(z<0 / z>0)
rl = by_mat['chrome_rear_lights']
for i, grp in enumerate([[g for g in rl if (g.bounds[0][2] + g.bounds[1][2]) / 2 < 0],
                         [g for g in rl if (g.bounds[0][2] + g.bounds[1][2]) / 2 > 0]]):
    print(f'TL{i}:', catmull_rom_svg(outline(grp, alpha=3.0, simplify_m=0.008, n=14)))
    print()
