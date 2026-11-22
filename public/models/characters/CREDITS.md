# Character models (art pass 2)

All models CC-BY 4.0, downloaded from Objaverse (Sketchfab mirrors). Normalized in code
(`src/render/characterAssets.ts`): uniform scale, feet on ground, facing local -Z.

- `hunter.glb` — "Hunter Avatar" by 3DRaven — https://sketchfab.com/3d-models/93c6c4f6455849bb9095d02a309fdded — license CC-BY.
  Mixamo rig (79 joints) + baked Idle clip. Top hat collapsed in code and replaced with a
  procedural hood + shoulder cloak; Walk/Run clips authored procedurally on the same rig.
- `reaper.glb` — "Reaper" by Hanako.com — https://sketchfab.com/3d-models/1ea16626fced4a04ad33e6d5d564bef0 — license CC-BY.
  Static mesh; scythe node hidden. Used as the grey ghost base with cloth-flutter / dissolve shader.
- `creature.glb` — "Wendigo Animation" by Matthew-David — https://sketchfab.com/3d-models/242e99d9fe2f4eec91841fd3e8b01021 — license CC-BY.
  Mixamo rig (66 joints) + baked idle clip. Skull-maned shadow creature used as the wraith base
  with smoke/fresnel shader, spine spikes and afterimages.