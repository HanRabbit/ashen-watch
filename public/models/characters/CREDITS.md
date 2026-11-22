# Character models (art pass 2)

All models CC-BY 4.0, downloaded from Objaverse (Sketchfab mirrors). Normalized in code
(`src/render/characterAssets.ts`): uniform scale, feet on ground, facing local -Z.

- `hunter.glb` — "Hunter Avatar" by 3DRaven — https://sketchfab.com/3d-models/93c6c4f6455849bb9095d02a309fdded — license CC-BY.
  Mixamo rig (79 joints) + baked Idle clip. Top hat collapsed in code and replaced with a
  procedural hood + shoulder cloak; Walk/Run clips authored procedurally on the same rig.
- `reaper.glb` — "Reaper" by Hanako.com — https://sketchfab.com/3d-models/1ea16626fced4a04ad33e6d5d564bef0 — license CC-BY.
  Static mesh; scythe node hidden. Used as the grey ghost base with cloth-flutter / dissolve shader.
- `creature.glb` — "Scary Creature" by shedmon — https://sketchfab.com/3d-models/b996bf84da3d49edb52202cb4fab457c — license CC-BY.
  CAT rig (69 joints) + baked Idle clip. Used as the wraith base with smoke/fresnel shader.