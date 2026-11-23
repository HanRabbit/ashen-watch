# 庭院材质、磨边与动作过渡｜验收

- 泥地由同源颜色、OpenGL 法线、AO、粗糙度和高度图构成，扫描来源见[贴图授权](../../public/textures/CREDITS.md)。实际网格提供轮迹和厘米级的床面高低差，近距离的视差处理只补微小凹陷。低档跳过视差采样，保留几何和法线。
- 每块实体旗石从扫描里的单块石面取样，而不是把一片路面贴到一块石头上。不同朝向、磨钝和崩口发生在实体边缘；贴水、贴泥的边另有湿度和粗糙度变化。三处旧破损的泥底融入同一层地面，散石支承面和门、楼梯、排水槽仍按原设计保留。
- 动作沿用已有的动作捕捉片段；起停和反向时限制视觉根节点的滞后，空中脚重新计划落点，支撑脚不拖地。快速转镜头有单独的角速度上限，镜头碰撞和角色移动规则不变。

## 复现

```sh
npm run build
npm test
# 另开终端：npm run preview -- --port 4199 --strictPort
export AW_ANGLE=metal
for p in day night; do
  AW_URL=http://127.0.0.1:4199/ AW_W=1600 AW_H=900 AW_VIDEO=1 AW_GROUND_WALK=1 \
    AW_OUT=.cache/surface-continuity/$p-check node tools/lighting-walk.mjs chromium --headless "$p"
done
for n in transitions wall jamb stairs; do
  AW_URL=http://127.0.0.1:4199 AW_OUT=.cache/surface-continuity/motion-check node tools/locomotion-watchman.mjs "$n"
done
```

`AW_GROUND_WALK` 确认扫描法线、高度图及视差步数。按两个方向实走车道、碎石边和排水槽，夜间携灯。普通跟随镜头，真实键鼠输入，未固定相机。Apple M3 Max / ANGLE Metal，1600×900，电影档昼夜各采七点，均约 60.0 FPS、P95 帧间隔 16.7–16.8 ms。另在 1280×720 低档确认两类地面的视差步数均为 0，法线和实体起伏仍保留。这是该机器的整帧计数，不是所有设备的性能承诺。

同一硬件上的动作回放通过起停、走跑切换、反向、侧移、顶墙、擦门框和 1F↔B1 往返。平地过渡回放里，连续支撑帧的踝滑动峰值由 30.2 mm 降至低于 0.1 mm（不包括换脚）。下楼回放的 13 次触地中，空中到落地的单帧踝下落峰值由约 161 mm 降至约 62 mm，未改真实鞋底的防穿插尺寸。空中跨阶仍有较快的抬脚和落脚，不能用触地数字代表整段楼梯动画。
