# 趣味展示模型(仅总览 3D 全景,无车身交互热点)

## sanbengzi.glb —— 三蹦子(三轮售货摩托)

- Artist: [Alan Zimmerman](https://poly.pizza/u/Alan%20Zimmerman)
- Source: [Street Vendor Cart](https://poly.pizza/m/f_LuAcP2_Yh)
- License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- 处理:裁掉过高的灯笼串弧线,转正(-Z 车头)、落地、归一化至 4.6m 长,meshopt 压缩
  (`scripts/make-fun-models.py`)。

## mars-rover.glb —— 火星车(毅力号)

- Source: [NASA 3D Resources — Mars 2020 Perseverance Rover](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Mars%202020%20Perseverance%20Rover)
- License: NASA 媒体素材,可按 [NASA 媒体使用指南](https://www.nasa.gov/nasa-brand-center/images-and-media/) 自由使用(非商业背书)。
- 处理:减面 55%、同材质合并、纹理转 1024px WebP、meshopt 压缩(10.4MB → 1.3MB)。

## yaoyao.glb —— 摇摇车

- Artist: [Quaternius](https://poly.pizza/u/Quaternius)
- Source: [Car](https://poly.pizza/m/HQ0hvRM2XR)
- License: [CC0](https://creativecommons.org/publicdomain/zero/1.0/)
- 处理:卡通小车重新上色(糖果黄),程序化拼装大弹簧 + 投币底座
  (`scripts/make-fun-models.py`),总览 3D 中绕底座铰链缓摇。
