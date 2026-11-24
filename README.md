# 灰烬守夜（Ashen Watch）

PC 浏览器上的单人第三人称 3D 垂直切片，用 TypeScript、Vite 和 Three.js 实现。玩法与验收标准见 [PRD.md](PRD.md)。

## 环境

- Node.js 20 或更高（开发时用的是 24.14）
- 桌面版 Chrome 或 Edge

## 启动

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器，http://localhost:5173/
npm run build      # 类型检查 + 生产构建，产物在 dist/
npm run preview    # 用静态服务器预览 dist/，http://localhost:4173/
```

`dist/` 使用相对路径，可以放到任意静态 HTTP 目录下运行。直接双击 `dist/index.html`（`file://`）无法加载模块脚本，需要经 HTTP 访问。

## 操作

| 动作 | 键盘 + 鼠标 | 纯鼠标 |
|---|---|---|
| 转向 | 移动鼠标 | 移动鼠标 |
| 移动 | WASD | 按住左键前进，松开停止 |
| 冲刺 | 按住 Shift | 滚轮向上开启，向下退出 |
| 交互 | E | 右键短按 |
| 举灯 | 按住右键 | 右键长按（250 ms 以上） |
| 提灯开关 | F | 工具栏「提灯」 |
| 用热食 | H | 工具栏「热食」 |
| 任务与资源 | Tab | 中键打开工具栏后点「任务」 |
| 暂停 | Esc | 中键打开工具栏 |

操作方式、键位、灵敏度、亮度、音量与画质（电影／高／流畅）在标题或暂停界面的「设置」里修改，与进度分开保存。默认电影档保留全分辨率、环境遮蔽与软阴影。流畅档仅限制 3D 绘制缓冲区（最长边 960、最短边 540），界面仍为原生分辨率；静止时降低主光阴影刷新，行走、转身或开门时实时更新。

默认角色沿用已校准步态的守夜人和灰影。用 `?cast=tripo` 打开游戏可切换为 PR 提供的两套替代模型，仍使用同一套游戏交互和步态；任一模型加载失败时仅该角色回退。

一局约 10–15 分钟：白天 6 分钟、黄昏 1.5 分钟、夜晚 6 分钟。白天忙完可回门房床铺「休息到黄昏」，黄昏准备好了可在壁炉旁「等到入夜」。两只鬼都怕光：按住举灯时它们不敢扑，祭台旁和侧廊中段的火盆投 1 份油可亮 3 分钟。这些数值与 PRD 不一致，差异见 [docs/STEP2.md](docs/STEP2.md)。

## 预设与调试参数

发布预设是默认值，不需要任何参数。以下参数只用于开发和自动化验收：

| 参数 | 作用 |
|---|---|
| `?probe=1` | 暴露只读探针 `window.__awProbe`（状态、帧时间、显卡、寻路查询），不改变玩法 |
| `?preset=dev` | 开发预设：白天与黄昏的时钟 6 倍速，显示调试信息，暴露 `window.__awDev` |
| `?preset=dev&dayscale=N` | 调整白天与黄昏的时钟倍率（上限 120） |
| `?preset=dev&timescale=N` | 调整整个模拟的倍率（上限 60） |

## 测试与验证

```bash
npm run typecheck                  # 类型检查
npm test                           # 模拟层单元测试（不需要浏览器）
npm run verify:step2               # 第二步浏览器矩阵（需先启动 preview）
npm run verify:browser             # 浏览器内验收：需要先 npm run preview
npm run verify:route               # 真实键鼠实走 B1 / 1F / 2F 和四条楼梯
node tools/smoke.mjs chrome        # 浏览器冒烟
node tools/shots.mjs chrome        # 重拍 docs/verification/ 下的实机截图
node tools/perf.mjs chrome         # 夜间性能取样：主路往返的帧率与掉帧位置
node tools/feel.mjs chrome         # 手感测量：行走是否匀速、原地转向时镜头是否跳变
```

浏览器脚本通过 `playwright-core` 驱动本机已安装的 Chrome 或 Edge（第一个参数写 `chrome` 或 `msedge`），不会下载浏览器。加 `--headless` 可无窗口运行。默认访问 `http://localhost:4173/`，可用环境变量 `AW_URL` 改地址。

本轮三层地图、光照和角色动画的合并状态见 [集成检查点](docs/INTEGRATION-CHECKPOINT.md)。历史验收结果见 [docs/VERIFICATION.md](docs/VERIFICATION.md)，仍在使用占位资源的项目见 [docs/PLACEHOLDERS.md](docs/PLACEHOLDERS.md)，美术强化_pass 见 [docs/ART-PASS.md](docs/ART-PASS.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `src/config.ts` | 时段、移动、燃烧、伤害、修复价格与预设的集中配置 |
| `src/sim/` | 固定步长模拟：关卡数据、碰撞、寻路、双鬼、存档、进度管理。不依赖渲染 |
| `src/render/` | Three.js 场景、材质、道具、角色与镜头 |
| `src/ui/` | HUD 与各界面 |
| `src/input.ts`、`src/audio.ts`、`src/settings.ts` | 输入、合成音、设置 |
| `tests/` | 模拟层测试与机器人玩家驱动 |
| `tools/` | 浏览器冒烟、验收与截图脚本 |
| `concept/`、`ART-ASSETS.md`、`CONCEPT-PROMPTS.md` | 概念图与美术资料 |
| `public/textures/` | Poly Haven CC0 贴图（石、木、地、瓦、碎石），授权见 `CREDITS.md` |
| `docs/ART-PASS.md`、`docs/art-pass/` | 2026-11-22 美术强化的说明与前后对照截图 |

## 存档

进度保存在浏览器的 `localStorage`（键 `ashen-watch/save`），只保留最近一份黄昏快照和已完成标志。存档版本为 2，更早的存档会提示不兼容，需要新开局。存档损坏、版本不兼容或存储被禁用时，标题界面会说明原因并允许新开局；存储不可用时，本次会话内仍可重试当晚。

第二步的最新实现、玩法数值和验收结果见 [docs/STEP2.md](docs/STEP2.md)。
