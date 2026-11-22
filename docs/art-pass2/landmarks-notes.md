# landmarks / scenery（art pass 2）合并说明

代号 `landmarks`，分支 `art2-landmarks`。只新增视觉，不改玩法 / 碰撞 / 寻路（`src/sim/**` 未动），
`npm run typecheck` 零错误、`npm test` 108 项全过。所有几何程序化生成，**未下载任何外部资源**
（无新增贴图 / 模型，故 CREDITS.md 无需改动；离线可运行，无加载回退问题）。

## 改动的文件

- 新增 `src/render/landmarks.ts`：礼拜堂哥特化 + 环境叙事小物 + `hideLegacy(levelGroup)`。
- 新增 `src/render/scenery.ts`：山顶城堡、第二城门塔楼、松林三层、山雾分层、外墙延伸。
- `src/render/view.ts`：**仅 4 行**（2 行 import + 构造函数 2 行），把两个 group 加进场景并调用
  `hideLegacy`。合并时若主管大改 view.ts，只需保留这 4 行（位置：import 区与
  `this.scene.add(this.level.group, ...)` 之后）。

## 不需要改 staticLevel.ts

旧远景与旧礼拜堂屋顶**没有**通过删 staticLevel 的行来处理，而是 `landmarks.ts` 导出的
`hideLegacy(levelGroup)` 在运行时按世界坐标 AABB 逐三角形剔除（Batch 按材质合并网格，无法按名字分离）：

- 隐藏旧远景圆锥城堡：staticLevel 中唯一的 `MeshBasicMaterial` 合并网格（`far` batch）整格 `visible=false`。
- 剔除旧礼拜堂：东/西坡旧瓦、南/北旧山墙、旧钟架山墙与立柱/小尖塔/十字、旧正门罩拱、旧系梁、
  4 个旧扶壁、外廊披檐在正门 bay 的开洞段与洞内托梁。AABB 列表见 `hideLegacy` 内 `boxes`。
- 保留：礼拜堂 0..7 m 碰撞墙身、西墙下层尖拱窗与窗花、侧门、东墙窗、地面、井台、所有陈设。

因此 **staticLevel.ts 无需任何删除**；若主管希望彻底清理死几何（减少顶点），可参照 `boxes` 的坐标
在 staticLevel.ts 删除对应 `b.geo/b.box` 调用（约 86–120 行的屋顶/山墙/钟架/扶壁段），但非必需。

## 坐标与遮挡要点（供后续调整参考）

- 渲染 z = -sim.z。`landmarks.ts` 全部走 `Batch`（模拟坐标）；`scenery.ts` 的城堡/塔楼几何用
  原始 `translate`，已显式取 `cz = -czSim`、`gz = -gzSim`（窗灯走 Batch 用 sim 坐标）。
- 城堡放在 sim (70, 60)、基座 y=25、主楼顶 ~63 m：从参考机位 REF_CAM 看方位角 ~54°，
  恰好落在礼拜堂 flèche 右侧、且高于屋脊遮挡线（~23°），故白天见雾中尖顶、夜晚见剪影 + 暖窗。
  若移动城堡，需重新核对「屋脊遮挡仰角」，否则会被礼拜堂屋顶完全挡住（曾踩坑）。
- 第二城门塔楼 sim (-11, 78)：参考机位左缘、庭院机位正北远处。
- 城堡/塔楼用 `MeshBasicMaterial(fog:false)` + 每帧手动雾混合（`castle.onBeforeRender` 读
  `scene.fog.far` 推断昼夜：昼 135 → 夜 52），并带高度渐变顶点色避免纸片感；暖窗 `winMat.opacity`
  随夜色升起。礼拜堂新玻璃 `glassMat` 同理在 `onBeforeRender` 里设 `emissiveIntensity`（夜 0.17，
  带铅条 emissiveMap），**不依赖 view.ts 的 update**。

## 验收截图（docs/art-pass2/）

- 改前：`landmarks-ref-day-before.png`、`landmarks-ref-night-before.png`、`landmarks-a13-courtyard-day-before.png`
- 改后：`landmarks-ref-day.png`、`landmarks-ref-night.png`、`landmarks-a13-courtyard-day.png`、
  `landmarks-a13-courtyard-night-lamp-on.png`、`landmarks-a13-chapel-day.png`、`landmarks-a13-chapel-chest-night.png`

## 剩余问题 / 取舍

- 白天整体曝光偏亮、天空偏平（地面发白）属 view.ts / 调色域，由另一位代理负责，本任务未动。
- 城堡为程序化剪影（无贴图细节），近看会显低模；定位是「雾中远景」，符合概念图层级。
- 松林为低模锥体 InstancedMesh（~650 棵、三层），远处靠雾渐淡；未用 billboard impostor。
- 正门 bay 的外廊披檐被开洞并加 pent roof 罩棚；若主管改外廊结构需同步 `hideLegacy` 的开洞 AABB。
- 乌鸦 / 烛台 / 祈祷布条为静态小物，尺寸小，参考机位下不明显，近看可读。