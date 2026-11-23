# 守夜人动作与庭院空气｜实机验证

## 看的是什么

- [走跑侧拍](watchman-locomotion.mp4)：守夜人从站立、行走、加速跑、减速到停步。两次独立跑动分别从提灯侧和空手侧跟拍，未移动或拖拽角色骨骼。摄影机为动作检查而设，不是宣传动画。
- [昼夜路线](court-atmosphere-route.mp4)：普通跟随镜头，真实键鼠穿过庭院、登楼到城墙。是两段实走的节选；完整路线有 12 个采样点/时段，没有固定相机代替实走。
- 走跑来源和重建命令见 [角色资产说明](../../public/models/characters/CREDITS.md)。原版三段循环来自同一套骨架，但周期不同。采样按落脚相位对齐，由实际位移驱动；人体比例、脚掌落点、提灯手和碰撞仍由游戏求解。没有引入新的移动速度或动作输入。

## 如何复现

构建并运行本地预览，将 `AW_URL` 指向该预览。工具会检查 WebGL 的真实硬件名称，拒绝软件渲染器。`AW_OUT` 为每次运行选用单独目录。

```sh
npm run build
npm test
export AW_URL=http://127.0.0.1:4199 AW_ANGLE=metal AW_VIDEO=1
AW_OUT=.cache/review/profile node tools/watchman-profile.mjs
AW_PROFILE_REVERSE=1 AW_OUT=.cache/review/reverse node tools/watchman-profile.mjs
for n in yard wall jamb stairs; do
  AW_OUT=.cache/review/motion/$n node tools/locomotion-watchman.mjs "$n"
done
for p in day night; do
  AW_W=1600 AW_H=900 AW_ART_WALK=1 AW_OUT=.cache/review/air/$p node tools/lighting-walk.mjs chromium --headless "$p"
done
```

动作轮廓记录的是**完成 IK 后**的真实蒙皮骨骼位置。剔除变速后的前 450 ms 再比较平地稳定段：旧版走/跑膝屈曲角中位数约 56°/70°，改造后在多次侧拍中约为 30–31°/42–44°；髋部垂直行程由约 22/34 cm 降至行走约 11–12 cm、冲刺约 11–15 cm。`wall` 在实心墙面持续按前进键；`jamb` 在相邻门洞擦过边柱，碰撞改向后仍需保持着地脚不滑。楼梯另走地下一层至一层并原路下行，而非以平地测试代替。实机该路线着地脚未测出可见滑移；陡阶上仍有空中脚踝单帧约 17 cm 的垂直峰值，快速跨阶不如平地平顺。

## 光照取样

电影档在 Apple M3 Max / ANGLE Metal 下以 1600×900 运行，读取 800×450 的体积光照缓冲。白天及夜晚的完整移动路线分别约 59.89 和 59.86 FPS，两条路线的 P95 帧间隔均约 16.7 ms，每个采样点均确认体积通道已启用，浏览器没有报错。这是单机、单分辨率的帧间隔，不是孤立的 GPU pass 耗时或所有硬件的性能保证。

体积通道读取同一帧的场景深度和日/月方向光阴影；雾密度包含室外低洼湿气、风和屋内遮挡。高档降低分辨率和采样数，低档保留解析高度雾；没有声称使用全场景路径追踪。
