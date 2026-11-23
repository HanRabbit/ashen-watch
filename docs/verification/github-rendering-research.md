# Three.js 实时照明调研与工程落地

2026 年 11 月 23 日。项目使用 Three.js r187 的 WebGL2 渲染器。以下源码按版本固定，运行时无需访问 GitHub。

| 上游实现 | 从源码提取的做法 | 本工程的应用 |
| --- | --- | --- |
| [Three.js r187 的物理光照着色器](https://github.com/mrdoob/three.js/blob/r187/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js) | 用粗糙漫反射的方向反照率计算间接光，在漫反射计算时扣除镜面散射能量。 | 在三类扫描地面上启用 Three 的 EON 粗糙漫反射。矿物颗粒、泥土与积水覆盖率控制粗糙度。材质用法线变化率过滤亚像素 GGX 高光。室内按接收表面和开口调节入射能量，让同一遮挡同时影响漫反射和环境反射。 |
| [realism-effects 的屏幕空间追踪](https://github.com/0beqz/realism-effects/blob/061daeaefb7773d8a1a8e10fa95a184fbcda1fb7/src/ssgi/shader/ssgi.frag) 与[参数定义](https://github.com/0beqz/realism-effects/blob/061daeaefb7773d8a1a8e10fa95a184fbcda1fb7/src/ssgi/SSGIOptions.js) | 深度交叉之后可以二分求精。源码将未命中射线的处理作为单独策略。 | 积水先用粗糙度选择步数，再用 6 次二分定位首个有效交叉。边缘、背面和深度突变会降低反射权重。命中时读取当前帧 HDR 颜色，未命中保留底层材质。此方法可遗漏屏幕外物体和薄栏杆。 |
| [three-mesh-bvh 的 GPU 查询示例](https://github.com/gkjohnson/three-mesh-bvh/blob/1da80c5d6ef8b6625454f8d0da01615dde7a3334/example/gpuPathTracingSimple.js) | 将包围层级上传为纹理，在 GPU 上执行可见性查询。 | 用独立的包围体层级描述墙、楼板和洞口，点光只查询到当前接收点的有限线段。第一个实心遮挡即可终止。门扇使用当前变换。渲染成本取决于有贡献的灯和接收像素。小型活动道具不在这个静态层级中。 |
| [three-gpu-pathtracer 的渲染示例](https://github.com/gkjohnson/three-gpu-pathtracer/blob/c2284c706d706bbe4d30d5689962d6a899031854/README.md) | 示例通过连续采样让图像收敛，并提供环境图过滤以改善收敛。 | 活动玩法采用当前帧光照。世界空间查询解决建筑遮挡，屏幕空间查询解决湿地反射。持续运动的镜头和摆动的提灯是选择这两种追踪方式的依据。 |

复查入口为 `tools/light-source-audit.mjs` 和 `tools/optics-audit.mjs`。另有 `tools/window-air-walk.mjs` 专门串联门房行走、窗边空气和无源对照，见[实机验收](daylight-window-transport.md)。前者保存相机、可见光源和显示图像的线性亮度，后者比较同一帧中光学效果开关与重复绘制的差异。离屏命中数量、最终画面可见差异和整帧耗时分别记录。
