# Character models & textures (art pass 3)

The two default models are CC-BY 4.0, downloaded from Objaverse (Sketchfab mirrors). Normalized in code
(`src/render/characterAssets.ts`): uniform scale, feet on ground, facing local -Z.
All model materials are re-normalized to the art bible §4.5/§5 palette in code.

- `hunter.glb` — "Hunter Avatar" by 3DRaven — https://sketchfab.com/3d-models/93c6c4f6455849bb9095d02a309fdded — license CC-BY.
  Mixamo rig (79 joints) + baked Idle clip. Top hat collapsed in code and replaced with a
  procedural hood + shoulder mantle + knee cloak; locomotion retargeted from the Quaternius animation library (below). Body texture desaturated/darkened to bible leather/cloth values.
- `reaper.glb` — "Reaper" by Hanako.com — https://sketchfab.com/3d-models/1ea16626fced4a04ad33e6d5d564bef0 — license CC-BY.
  Static mesh; scythe node hidden. Grey ghost base with cloth-flutter / dissolve shader,
  added tattered rag layers (shoulders / waist / hem), hood void and dim cold eyes.

The wraith (黑影) is fully procedural (`RagWraith` in `src/render/characters.ts`): a quadrupedal
hunched body built from tattered cloth strips per concept/05 and art bible §9. The previous
`creature.glb` ("Wendigo Animation" by Matthew-David, CC-BY) was removed in art pass 3 because
its antlered bipedal dancer silhouette violated the bible; no external model is used for it now.

## Textures (CC0, ambientCG)

- `fabric_color.jpg` / `fabric_normal.jpg` / `fabric_rough.jpg` — Fabric030 — https://ambientcg.com/view?id=Fabric030 — CC0.
  Woven linen base for the watchman hood/cloak/mantle, tinted to bible cloth `#2f2a26`.
- `leather_color.jpg` / `leather_normal.jpg` / `leather_rough.jpg` — Leather026 — https://ambientcg.com/view?id=Leather026 — CC0.
  Pebbled leather base for belt / straps / cuffs, tinted to bible leather `#4a3a2c`.

Every external texture has a procedural canvas fallback in code so the game runs offline.

## Locomotion performances — Quaternius (CC0 1.0)

`Walk_Loop`, `Jog_Fwd_Loop`, and `Sprint_Loop` are from the Standard edition of
[Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) by Quaternius.
[Author’s original download](https://opengameart.org/content/universal-animation-library) ·
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). The original archive’s [license notice](licenses/Quaternius-UAL.txt) is included here.

Rebuild from the archive’s `Godot/AnimationLibrary_Godot_Standard.glb`:
`node tools/bake-watchman-motion.mjs /path/to/AnimationLibrary_Godot_Standard.glb`.
The bake samples the authored body-space joint trajectories at 64 phases per loop, aligns left
contact across speeds, and stores only millimetre-quantized landmarks. No source mesh, skin,
or unrelated clips ship. In game, the hands, knees and feet can adapt to the watchman’s
proportions, carried lantern and actual ground instead of inheriting the mannequin’s bind pose.

## 用户提供的 Tripo 模型

- tripo-watchkeeper.glb：守夜人，由用户提供的 Tripo GLB 优化而来，保留蒙皮和动作片段。
- tripo-ash-wraith.fbx 和对应 .fbm 贴图：灰影，来自用户提供的 Tripo ZIP。

以上两项为 PR #3 / #7 随附的可选模型与贴图，不适用本页其他资产的 CC0 / CC-BY 标注。
