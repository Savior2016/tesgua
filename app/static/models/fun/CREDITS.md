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
- 处理:Blender 摆战斗姿态 v10(直立站姿、双臂前伸下压、掌心朝正前、手指向上的
  经典掌心炮;掌心朝向由食/小指根骨骼推算掌心法线后绕手骨扭转校正;腿部保持绑定
  姿态——开立蹲姿+髋部下移会悬空踮脚;repulsor_L/R 自发光圆盘刚性绑到手骨上随
  身体一起烘焙作光束锚点,光束由 ov3d.js 运行时生成;转正/归一化全部烘进顶点,
  `scripts/pose-ironman.py`),转正(-Z 正面)、落地、按身高归一化至 2.4m,
  纹理转 1024px WebP、meshopt 压缩(171MB → 3.5MB,simplify 需 --lock-border
  否则锚点被坍缩)。

## batmobile.glb —— 蝙蝠车(BvS 版)

- Source: [arsalanmalek/3d_model_batmobile_bvs](https://github.com/arsalanmalek/3d_model_batmobile_bvs)(Blender 源文件)
- License: 仓库未附许可;蝙蝠车形象版权属 DC,仅作个人面板娱乐展示。
- 处理:从展示间场景中提取车身 24 个网格,重新指定哑光黑装甲/枪灰金属/轮胎/
  车灯自发光材质,转正(-Z 车头)、落地、归一化至 5.6m,meshopt 压缩。

## pumpkin-carriage.glb —— 南瓜车(灰姑娘款)

- Source: 纯程序化建模(`scripts/make-pumpkin-carriage.py`),无第三方素材。
- License: 本项目自产,随项目许可。
- 构成:瓣纹南瓜车身 + 金色拱形门/窗(暖光自发光)+ 四轮金轮(后大前小)
  + 底盘连杆 + 瓜蒂/卷须 + 门阶;归一化至 4.2m 长,meshopt 压缩。

## broomstick.glb —— 飞天扫帚

- Author: [trashart](https://sketchfab.com/trash-art)
- Source: [Stylized Broomstick](https://sketchfab.com/3d-models/stylized-broomstick-ba2dc348a8b2446185341d42c849d1da)(GitHub 镜像:Dkingofcode/DevPortfolio)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:刷头朝后、悬浮 0.45m、柄尖微翘 4°,归一化至 2.8m 长,
  纹理转 1024px WebP、meshopt 压缩(`scripts/make-broom.py`)。

## azura.glb —— 舞姬阿库娅(火焰纹章if)

- Author: [Yann (Kokusho)](https://sketchfab.com/Kokusho)
- Source: [Dancing Girl from Fire Emblem If](https://sketchfab.com/3d-models/dancing-girl-from-fire-emblem-if-bf3b946f6dbb448eb25811e87e006f08)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 说明:角色形象版权属 Nintendo/IS;此模型为社区作者作品,仅作个人面板娱乐展示。
- 处理:自带舞蹈姿态烘焙成静态几何,转正(-Z 正面)、落地、按身高归一化至 2.55m,
  纹理转 1024px WebP、meshopt 压缩(`scripts/make-girls.py`)。

## stargirl.glb —— 星星装少女

- Author: [raine](https://sketchfab.com/coolmantwo07)
- Source: [sexy anime girl](https://sketchfab.com/3d-models/sexy-anime-girl-d73f2cd0967f48a98fbb49dfb450bc2b)(GitHub 镜像:proginvert/3d_resources)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:删隐藏参照球,姿态烘焙成静态几何,转正、落地、归一化至 2.75m,
  纹理转 1024px WebP、meshopt 压缩(`scripts/make-girls.py`)。

## bikini.glb —— 泳装少女

- Author: [Grell](https://sketchfab.com/grell)
- Source: [Bikini Girl_SF_101](https://sketchfab.com/3d-models/bikini-girl-sf-101-568316e9e1724a288b1559ef96abeff9)(GitHub 镜像:IngRamirezJezhuah/Porfl_web)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:顶点色模型(无贴图),姿态烘焙、转正、落地、归一化至 2.75m,
  meshopt 压缩(`scripts/make-girls.py`)。

## mia.glb —— 哥特黑裙 Mia

- Author: [ChamberSu1996](https://sketchfab.com/chambersu1996)
- Source: [anime girl Mia Ter Excited Preview](https://sketchfab.com/3d-models/anime-girl-mia-ter-excited-preview-bda66b935705449dad31f6c5d96780a7)(GitHub 镜像:kateBea/Mikoto)
- License: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)(仅非商业用途,本项目为个人面板)
- 处理:删隐藏参照球,姿态烘焙成静态几何,转正、落地、归一化至 2.75m,
  纹理转 1024px WebP、meshopt 压缩(`scripts/make-girls.py`)。

## miku-chibi.glb —— Q版初音未来(带展示底座)

- Author: [Senpai-3689](https://sketchfab.com/Senpai3689)
- Source: [Hatsune Miku Chibi w/ Stand](https://sketchfab.com/3d-models/hatsune-miku-chibi-w-stand-7310aaeb8370428e966bdcff414273e7)(GitHub 镜像:kookmin-sw/capstone-2021-6)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 说明:初音未来形象版权属 Crypton Future Media;此模型为社区作者作品,仅作个人面板娱乐展示。
- 处理:删地面阴影板(保留手办底座),转正、落地、连底座归一化至 2.30m,
  meshopt 压缩(`scripts/make-girls.py`)。

## zeze.glb —— 女仆装 Zeze

- Author: [DrewBurger](https://sketchfab.com/DrewBurger)(原画:てんてこ @10te5_maimai)
- Source: [zeze 3d anime girl](https://sketchfab.com/3d-models/zeze-3d-anime-girl-e35bbebf648f4824b4308bf23718e57e)(GitHub 镜像:valentinov8060/multiple-marker)
- License: Sketchfab Free Standard(非 CC,仅作个人面板娱乐展示)
- 处理:源模型贴图全在 emissive 槽且 emissiveFactor=0,渲染全黑;删除每个网格的
  Material.002 描边壳与参照方块,把 Body/Hair/Material.001 三张手绘贴图重建为
  Principled 基础色,转正、落地、归一化至 2.75m,纹理转 1024px WebP、meshopt 压缩
  (`scripts/make-girls.py` 的 fix_zeze)。

## f40.glb —— 法拉利 F40

- Author: [Black Snow](https://skfb.ly/oRnMV)
- Source: [supercar3d/supercar_3D_asssets](https://github.com/supercar3d/supercar_3D_asssets)(basic/ferrari/f40)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(fan-made,与法拉利官方无关)
- 处理:Draco 解码后转正(-Z 车头)、落地、归一化至 4.36m,meshopt 压缩。

## revuelto.glb —— 兰博基尼 Revuelto

- Author: [Ddiaz Design](https://skfb.ly/prv6Y)
- Source: [supercar3d/supercar_3D_asssets](https://github.com/supercar3d/supercar_3D_asssets)(basic/lamborghini/revuelto)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(fan-made,与兰博基尼官方无关)
- 处理:源模型为 1:100 微缩尺度,Draco 解码后转正(-Z 车头)、落地、归一化至
  4.95m,meshopt 压缩。

## f1lm.glb —— 迈凯伦 F1 LM

- Author: [Ajay Gawde](https://skfb.ly/oBRUy)
- Source: [supercar3d/supercar_3D_asssets](https://github.com/supercar3d/supercar_3D_asssets)(basic/mclaren/f1lm,Low Poly)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(fan-made,与迈凯伦官方无关)
- 处理:Draco 解码后转正(-Z 车头)、落地、归一化至 4.49m,meshopt 压缩。

## aerith.glb —— 爱丽丝(最终幻想7)

- Author: [mega mix](https://sketchfab.com/oscar3dmodel)
- Source: [Aerith Default](https://sketchfab.com/3d-models/aerith-default-9e0f7fe57386466cb34959ab4f7eb4c5)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属 Square Enix,仅个人娱乐展示)
- 处理:删隐藏参照球 Icosphere(源模型绑定姿态仅 0.02m),烘姿态、转正、落地、
  归一化至 2.6m,纹理转 1024px WebP、meshopt 压缩(`scripts/make-girls2.py`)。

## foxgirl.glb —— 狐耳少女

- Author: [darknessvoid403](https://sketchfab.com/darknessvoid403)
- Source: [Anime fox girl](https://sketchfab.com/3d-models/anime-fox-girl-c6365aa1a75b4b01992ecab01e7afa2f)(GitHub 镜像:IngRamirezJezhuah/Porfl_web)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:删参照球 Icosphere 与 7m 黑色挡板 Object_283,烘姿态、转正、落地、
  归一化至 2.6m(含大尾巴),纹理转 1024px WebP、meshopt 压缩。

## miyu.glb —— 霞泽美游(碧蓝档案)

- Author: [Onerui(momo)](https://sketchfab.com/hswangrui)
- Source: [[Blue Archive]Kasumizawa Miyu](https://sketchfab.com/3d-models/blue-archivekasumizawa-miyu-108d81dfd5a44dab92e4dccf0cc51a02)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属 Nexon,仅个人娱乐展示)
- 处理:删参照球 ×2,烘姿态、转正、落地、归一化至 2.5m,纹理转 1024px WebP、meshopt 压缩。

## cybergirl.glb —— 机械少女

- Author: [Rotmill](https://sketchfab.com/Rotmill)
- Source: [Cyber Girl](https://sketchfab.com/3d-models/cyber-girl-46640796f0dd4fbab5eba5262d542e25)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:源文件含两份完整角色拷贝,删 WhitehairPreview 整支骨架(第二份)与参照球,
  烘姿态、转正、落地、归一化至 2.6m,纹理转 1024px WebP、meshopt 压缩。

## elfgirl.glb —— 精灵少女

- Author: [halloween](https://sketchfab.com/yellow09)
- Source: [Elf Girl](https://sketchfab.com/3d-models/elf-girl-52f2e84961b94760b7805c178890d644)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:源模型 42m 巨大尺度,烘姿态、转正、落地、归一化至 2.6m,meshopt 压缩。

## miku.glb —— 初音未来(吉他手)

- Author: [Craft Tama](https://sketchfab.com/rizky08)
- Source: [Hatsune Miku](https://sketchfab.com/3d-models/hatsune-miku-a25f6548a8684500ac0004559484a4f9)(GitHub 镜像:proginvert/3d_resources)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属 Crypton,仅个人娱乐展示)
- 处理:删参照球 Icosphere(源模型绑定姿态仅 0.02m),烘姿态、转正、落地、
  归一化至 2.6m,纹理转 1024px WebP、meshopt 压缩。

## lightning.glb —— 雷霆·白魔道士(最终幻想13)

- Author: [loriscangini](https://sketchfab.com/loriscangini)
- Source: [Lightning - White Mage](https://sketchfab.com/3d-models/lightning-white-mage-21bdf07cc34946fa8c1755289d1ed631)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属 Square Enix,仅个人娱乐展示)
- 处理:删参照球 Icosphere,烘姿态、转正、落地、归一化至 2.6m,meshopt 压缩。

## missgalaxy.glb —— 银河小姐

- Author: [Donte_Loves_Art](https://sketchfab.com/Donte_Loves_Art)
- Source: [Miss Galaxy](https://sketchfab.com/3d-models/miss-galaxy-32ca79bf7c4043dcbc36d28b22436303)(GitHub 镜像:kateBea/Mikoto)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:烘姿态、转正、落地、归一化至 2.7m,纹理转 1024px WebP、meshopt 压缩。

## schoolgirl.glb —— 水手服少女

- Author: [Free3Diz](https://sketchfab.com/Free3Diz)
- Source: [School Girl 3D Model](https://sketchfab.com/3d-models/school-girl-3d-model-b38d51241fe845c2afbf47ecaa0203cf)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 处理:烘姿态、转正、落地、归一化至 2.55m,meshopt 压缩。

## kindred.glb —— 灵魂莲华千珏(英雄联盟)

- Author: [Retronous](https://sketchfab.com/Retronous)
- Source: [Spirit Blossom Kindred](https://sketchfab.com/3d-models/spirit-blossom-kindred-85187f9f246f4702b7c137dcc6c0fc12)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属 Riot Games,仅个人娱乐展示)
- 处理:源材质全部 unlit 且基础色为黑、颜色贴图塞在 emissive 槽(three.js 会渲染成
  黑剪影),已把 emissiveTexture 改写为 baseColorTexture;删 7m VFX 大平面 Object_4,
  烘姿态、转正、落地、归一化至 2.6m,纹理转 1024px WebP、meshopt 压缩。

## tifa-chibi.glb —— Q版蒂法(最终幻想7 富豪街)

- Author: [DrewsDigitalDesigns](https://sketchfab.com/drewsdigitaldesigns)
- Source: [Tifa - Itadaki Street Special](https://sketchfab.com/3d-models/tifa-itadaki-street-special-82924c34383444ffb59cfe211a89cf04)(GitHub 镜像:valentinov8060/multiple-marker)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属 Square Enix,仅个人娱乐展示)
- 处理:三头身 Q 版,烘姿态、转正、落地、归一化至 1.9m,meshopt 压缩。

## veera.glb —— 魅魔薇拉(传说对决)

- Author: [PetalThePotato](https://sketchfab.com/PetalThePotato)
- Source: [Veera (AOV)](https://sketchfab.com/3d-models/veera-aov-b0671e78716c400cb1018f8e0a017431)(GitHub 镜像:IngRamirezJezhuah/Porfl_web)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属腾讯 Garena,仅个人娱乐展示)
- 处理:删参照球 Icosphere,烘姿态、转正、落地、归一化至 2.6m,纹理转 1024px WebP、meshopt 压缩。

## ganyu.glb —— 甘雨·玄玉瑶芳(原神)

- Author: [jacenrick](https://sketchfab.com/jacenrick)
- Source: [genshin impact ganyu Twilight Blossom](https://sketchfab.com/3d-models/genshin-impact-ganyu-twilight-blossom-ff16a088e2d44562bdbedbde20009ae8)(GitHub 镜像:byiyuebai/OpenGL_Engine_530)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)(角色版权属米哈游,仅个人娱乐展示)
- 处理:删参照球 Icosphere,烘姿态、转正、落地、归一化至 2.6m,纹理转 1024px WebP、meshopt 压缩。
