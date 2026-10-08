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
