# 地图、美术与角色动画集成检查点

这是暂停时的集成快照，不是美术验收完成或正式发布。保留在 `codex/art-map-integration`。

- **地图**：整合 B1 / 1F / 2F 布局、S1–S4、门和道具对位、楼板/地形开洞、跨层导航与视线、越肩镜头避障。
- **渲染**：整合扫描石材、固定在世界中的日月光和阴影、室内外间接光差异、按场景深度截断的高度体积雾、积水反射和 3D 远景。近处雾不靠半透明片叠加，低档用表面雾近似。
- **动画（WIP）**：合入基于实际位移的双脚接触与腿部 IK、走跑过渡和提灯姿态。暂停在首轮实现，不能把脚步单元测试等同于所有方向与楼梯上的视觉验收。

## 验证范围

- 合入动画检查点后，`npm run build` 通过，`npm test` 通过 138 项（12 个测试文件）。
- 合入动画前，同一集成分支上完整浏览器三层路线通过 14/14：键鼠从门房出发，依次经过 S1、S2、礼拜堂西门、S3、2F 栅门和 S4，回到门房门前；没有固定相机、瞬移或控制台错误。
- 合入动画前，电影档从庭院实走上 2F 的昼、夜两趟对照分别通过 4 个沿途取样。昼夜对照只在出发时设光照测试条件，路线和镜头用键鼠行进，不是鬼怪通关测试。
- 最终构建的 1080p 性能、整局浏览器修复矩阵和动画完整动态验收不在本次暂停交付范围内。

## 复跑

先在另一个终端执行 `npm run build && npm run preview`。浏览器工具默认访问 `http://localhost:4173/`。

```sh
npm run verify:route
AW_ROUTE_QUALITY=cinematic AW_VIDEO=1 AW_OUT=/tmp/aw-day node tools/lighting-walk.mjs chrome --headless day
AW_ROUTE_QUALITY=cinematic AW_VIDEO=1 AW_OUT=/tmp/aw-night node tools/lighting-walk.mjs chrome --headless night
AW_URL=http://127.0.0.1:4173 AW_OUT=/tmp/aw-locomotion AW_BROWSER=chrome node tools/locomotion-watchman.mjs yard
```

如果本机 Chrome 提前关闭，可改用已安装的 Playwright Chromium；在本次 macOS 验证中用 `AW_ANGLE=metal` 走硬件渲染。先用 `npx playwright-core install chromium` 安装，然后用 `AW_ANGLE=metal node tools/browser-verify.mjs chromium --headless route`。动画脚本另有 `wall` 和 `stairs` 场景。
