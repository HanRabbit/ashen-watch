# 贴图授权

`public/textures/` 下的贴图来自 [Poly Haven](https://polyhaven.com)，全部以 **CC0 1.0 通用公共领域奉献** 发布，可自由用于商业与非商业项目，无需署名（此处列出以便溯源与替换）。

下载分辨率为 2k JPG，每套含 `_diff`（基础色，sRGB）、`_nor`（OpenGL 法线，线性）、`_rough`（粗糙度，线性）、`_ao`（环境光遮蔽，线性，uv 通道）、`_disp`（高度/位移，线性，供视差遮挡贴图 POM 与地面湿度遮罩使用）。

| 文件前缀 | Poly Haven 资源 | 用途 |
|---|---|---|
| `castle_wall_varriation` | castle_wall_varriation | 城堡灰石墙（`stone` / `stoneDark`），深浅不一的矩形砌块 |
| `stone_pavers` | stone_pavers | 庭院大块石板地（`flag`），错缝矩形石板、宽缝 |
| `medieval_wood` | medieval_wood | 发黑旧木：门扇、梁、桶、家具（`wood`） |
| `brown_planks_05` | brown_planks_05 | 门房木地板（`woodFloor`） |
| `roof_slates_02` | roof_slates_02 | 深灰石板瓦屋面（`roof`） |
| `gravel_floor` | gravel_floor | 碎石地与城外地面（`gravel`） |

其余材质（锻铁、破布、残旗、纸张、玻璃、火焰、雾、火星、藤叶、草叶等）仍由代码在画布上程序化生成，不依赖外部文件。外部贴图加载失败时，石、木、地、瓦会自动回退到程序化贴图，游戏仍可离线运行。
