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
- 处理:Blender 摆战斗姿态 v9(开立站姿、双臂前伸、掌心朝正前、手指向上的
  经典掌心炮;掌心朝向由食/小指根骨骼推算掌心法线后绕手骨扭转校正,脚掌放平;
  repulsor_L/R 自发光圆盘刚性绑到手骨上随身体一起烘焙作光束锚点,光束由
  ov3d.js 运行时生成;转正/归一化全部烘进顶点,`scripts/pose-ironman.py`),
  转正(-Z 正面)、落地、按身高归一化至 2.4m,纹理转 1024px WebP、
  meshopt 压缩(171MB → 3.6MB,simplify 需 --lock-border 否则锚点被坍缩)。

## hellokitty.glb —— Hello Kitty

- Source: [ZxSimas/hello-kitty-3d](https://github.com/ZxSimas/hello-kitty-3d)(GitHub,hello_kitty.glb 雕塑版)
- License: 仓库未附许可;Hello Kitty 形象版权属 Sanrio,仅作个人面板娱乐展示。
- 处理:v2 换用仓库中更圆润的雕塑版白模(自带蝴蝶结/鼻子/胡须几何,原 Kitty.glb
  已弃用,`scripts/fix-kitty.py` 随之归档),按网格名程序化着色(白身/黑胡须/黄鼻子/
  红蝴蝶结)并补黑色椭圆眼(`scripts/make-kitty-v2.py`;v3 起眼睛由射线求交半嵌进
  脸盘表面,不再悬空),Blender 内归一化至 1.8m、转正(-Z 正面)、落地,
  meshopt 压缩(4.8MB → 126KB)。

## mickey.glb —— 米奇(汽船威利橡皮管风格)

- Source: [frankilito/steamboat-willie](https://github.com/frankilito/steamboat-willie)(GitHub,assets/models/willieMickey.glb)
- License: 仓库未附许可;该仓库为 1928 年公有领域作品《Steamboat Willie》的独立再创作
  (无手套、饼切眼、圆鼻、短裤大鞋的黑白橡皮管风格),仅作个人面板娱乐展示。
- 处理:v4 换用该仓库的 rigged 米奇(11 段动画;v2 程序化拼装版已弃用,归档于
  `scripts/make-mickey.py`)。源模型静止姿态是散件,且所有动画剪辑只覆盖部分骨骼
  (17 关节最多 13),采样动画会留下悬空四肢(v3 因此废弃);v4 起直接导出绑定几何
  (绑定姿态本身即组装好的站姿):`scripts/dump-willie.html` + `scripts/dump-willie.py`
  (clip=raw)浏览器内导出顶点,`scripts/dump2glb.py` 归一化),转正(-Z 正面)、落地、
  归一化至 1.7m,meshopt 压缩(1.2MB → 66KB)。
