# 贴图授权

`public/textures/` 下的贴图来自 [Poly Haven](https://polyhaven.com)，全部以 **CC0 1.0 通用公共领域奉献** 发布，可自由用于商业与非商业项目，无需署名（此处列出以便溯源与替换）。

每套含 `_diff`（基础色，sRGB）、`_nor`（OpenGL 法线，线性）、`_rough`（粗糙度，线性）、`_ao`（环境光遮蔽，线性）、`_disp`（高度/位移，线性，供视差遮挡贴图 POM 与石板单元分割/积水遮罩使用）。分辨率见下表（美术圣经 5.1：新增套组默认 1K，hero 面可用 2K）。所有石类贴图在着色器里去饱和并压到第 4.1 节冷灰色值（Poly Haven 原图普遍偏暖偏黄）。

## 基础材质（materials.ts）

| 文件前缀 | Poly Haven 资源 | 分辨率 | 用途 |
|---|---|---|---|
| `castle_wall_varriation` | castle_wall_varriation | 2K | 乱石幕墙（`stone`/`stoneDark`、`wallRubble`） |
| `monastery_stone_floor` | monastery_stone_floor | 2K | 庭院主路不规则大石板（`flag`/`floorFlag`），含石板单元分割与积水 |
| `medieval_wood` | medieval_wood | 2K | 发黑旧木：梁、门框、桶、家具（`wood`/`woodBeam`） |
| `brown_planks_05` | brown_planks_05 | 2K | 旧橡木地板底（`woodFloor`） |
| `roof_slates_02` | roof_slates_02 | 2K | 主屋顶深灰石板瓦（`roof`） |
| `gravel_floor` | gravel_floor | 2K | 碎石地与城外地面（`gravel`） |
| `stone_pavers` | stone_pavers | 2K | 庭院边缘旧石板（`floorFlagWorn`），错缝矩形石板 |

## 材质族（materialVariants.ts，圣经 5.1）

| 文件前缀 | Poly Haven 资源 | 分辨率 | 材质族 |
|---|---|---|---|
| `medieval_blocks_03` | medieval_blocks_03 | 1K | `wallAshlar` 礼拜堂整齐方石 |
| `granite_wall` | granite_wall | 1K | `wallTrim` 门窗套/压顶/勒脚/垛口细凿大石 |
| `rustic_stone_wall_02` | rustic_stone_wall_02 | 1K | `wallRough` 墙基/补砌/坍塌粗石 |
| `grey_plaster` | grey_plaster | 1K | `wallPlaster` 石灰抹面（内墙/上半墙） |
| `cobblestone_large_01` | cobblestone_large_01 | 1K | `floorCobble` 井台/侧廊大卵石（去绿） |
| `brown_mud_leaves_01` | brown_mud_leaves_01 | 1K | `floorDirt` 墙脚泥土落叶带 |
| `worn_tile_floor` | worn_tile_floor | 1K | `floorInterior` 门房/礼拜堂室内石板 |
| `weathered_planks` | weathered_planks | 1K | `woodPlank` 门扇/箱板/栅板 |
| `wood_planks_dirt` | wood_planks_dirt | 1K | `woodFloorOld` 上廊/楼梯踏板 |
| `grey_roof_tiles` | grey_roof_tiles | 1K | `roofShingle` 井棚/披檐/门楼瓦 |
| `rock_face` | rock_face | 1K | `rock` 山崖/地窖开凿岩壁 |

其余材质（锻铁、破布、残旗、纸张、铅条玻璃、火焰、雾、火星、藤叶、草叶等）仍由代码在画布上程序化生成，不依赖外部文件。外部贴图加载失败时，石、木、地、瓦会自动回退到程序化贴图，游戏仍可离线运行。