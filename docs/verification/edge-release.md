# 2026-11-24 · 外露边缘与电影版集成

- [边缘对照](edge-wear-comparison.jpg) / [实走与绘制统计](edge-release-readings.json)：Apple M3 Max / ANGLE Metal、1280×720，电影档。玩家以键鼠走到两处城墙步道、入口阶梯、祭台和北拱；在每个站点另外拍了同坐标近照。图中没有用调色或锐化制造前后差别。
- 石阶只削踏鼻，承重端、踏面和两端仍接实。窗台处理唇口而不改玻璃座。门框、家具、木梁和铁件按不同尺度收棱；已有手工削边的石板和井台不二次细分，也不改角色网格、远景树冠或碰撞代理。
- 另从开局用真实键鼠连续走过 B1／1F／2F 四段楼梯，取到地下室油瓶、从内部开教堂西门、修复栅门并返回门房；10 个跟随镜头停靠点，14/14 项通过。
- 校核：闭合性、绕序、UV、平面和肩部法线、门铰、台面高度、两向楼梯接缝、窗洞净空。各视角的 GPU 提交三角数有小幅增加（含阴影和深度等重复 pass）；实走有细微姿态差异，不把调用数差值当成 FPS 提升。
- [光照实拍](surface-light-views.jpg) / [测量与负对照](surface-light-readings.json)：室外主光接触阴影比离地投影窄，夜间提灯可照到铺石旁的低洼泥地。高与电影档都实走了教堂；夜间、封闭地下室和关光对照没有可读的窗光增益。独立门房玻璃焦散选区在改前、改后都没有检出，本次不把它计为通过。
- 合并：#3 的替代角色与 #7 电影版适配共用一份资源，保留旧角色、步态、独立回退与原署名；没有重新生成角色。#5 的流畅档只限制 3D 绘制缓冲；移动、转身和开门实时刷新主光投影，只有静止时降频。保留电影档作为初始档，已有设置不变。#7 的方向提示与精简任务面板沿用游戏导航和可交互规则。

复测（先在另一个终端运行 `npm run preview`）：

```sh
AW_URL=http://localhost:4173 node tools/edge-walk.mjs
AW_URL=http://localhost:4173 node tools/release-smoke.mjs
AW_URL=http://localhost:4173 AW_REQUIRE_LAMP=1 node tools/surface-light-walk.mjs
AW_URL=http://localhost:4173 AW_CHAPEL_ROUTE=1 AW_CHAPEL_PERF=1 node tools/window-air-walk.mjs chromium --headless
```
