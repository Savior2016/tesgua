# 趣味展示模型(仅总览 3D 全景,无车身交互热点)

## sanbengzi.glb —— 三蹦子(三轮摩托 / 突突车)

- Author: [iGauravRajput](https://sketchfab.com/iGauravRajput)
- Source: [Autorickshaw 3d model free](https://sketchfab.com/3d-models/autorickshaw-3d-model-free-b6434fe6dd1647af83120763767844a8)(GitHub 镜像:UnKnownnPasta/Abhyas)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:转正(-Z 车头)、落地、归一化至 2.6m 长,减面 50%、纹理转 1024px WebP、
  meshopt 压缩(36MB → 3.9MB,`scripts/make-fun-models.py` + gltf-transform)。

## mars-rover.glb —— 火星车(毅力号,工作构型)

- Source: [NASA Science — Mars Perseverance Rover 3D Model](https://science.nasa.gov/resource/mars-perseverance-rover-3d-model/)(NASA/JPL-Caltech)
- License: NASA 媒体素材,可按 [NASA 媒体使用指南](https://www.nasa.gov/nasa-brand-center/images-and-media/) 自由使用(非商业背书)。
- 构型:表面工作构型,桅杆升起、机械臂展开(钻头触地)。
- 处理:转正(-Z 车头)、落地、归一化至 4.2m,减面 50%、纹理转 1024px WebP、
  meshopt 压缩(11.5MB → 2.2MB)。

## yaoyao.glb —— 摇摇车

- Author: Guido Odendahl / Eric Chadwick
- Source: [Khronos glTF-Sample-Assets — ToyCar](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar)
- License: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- 处理:裁掉展示绒布与相机节点,写实 PBR 玩具车(墨绿火焰涂装)拼装程序化
  大弹簧 + 投币底座(`scripts/make-fun-models.py`),总览 3D 中绕底座铰链缓摇。

## ironman.glb —— 钢铁侠(Mark 85,战斗姿态)

- Author: [9A Films / Nihar Arora](https://sketchfab.com/Nihar-9Afilms)
- Source: [Iron-Man Mark 85 | Rigged](https://sketchfab.com/3d-models/iron-man-mark-85-rigged-dde1085c464d4f8da259fe6669ae4dd2)(GitHub 镜像:avengers2405/movie-list)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 说明:钢铁侠形象版权属 Marvel;此模型为社区作者作品,仅作个人面板娱乐展示。
- 处理:Blender 摆战斗姿态(右臂前伸掌心炮、开立弓步)后烘焙网格
  (`scripts/pose-ironman.py`),转正(-Z 正面)、落地、按身高归一化至 3.0m,
  减面 50%、纹理转 1024px WebP、meshopt 压缩(178MB → 3.5MB)。

## hellokitty.glb —— Hello Kitty

- Source: [ZxSimas/hello-kitty-3d](https://github.com/ZxSimas/hello-kitty-3d)(GitHub,Kitty.glb)
- License: 仓库未附许可;Hello Kitty 形象版权属 Sanrio,仅作个人面板娱乐展示。
- 处理:原模型 UV 取色自平面参考图导致面部空白,Blender 补绘眼睛/鼻子几何
  (`scripts/fix-kitty.py`),剥除损坏的动画轨道,转正(-Z 正面)、落地、
  按身高归一化至 1.8m,meshopt 压缩(275KB → 83KB)。

## mickey.glb —— 米奇(Q 版)

- Source: 程序化几何拼装,无外部素材(`scripts/make-mickey.py`,Blender 无头生成)。
- License: 代码生成;米奇形象版权属 Disney(1928 汽船威利版形象已进入公有领域),
  仅作个人面板娱乐展示。
- 处理:导出即转正(-Z 正面)、落地、按身高归一化至 1.7m,meshopt 压缩(816KB → 155KB)。
