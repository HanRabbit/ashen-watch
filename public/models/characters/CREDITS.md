# Character models & textures (art pass 3)

Models CC-BY 4.0, downloaded from Objaverse (Sketchfab mirrors). Normalized in code
(`src/render/characterAssets.ts`): uniform scale, feet on ground, facing local -Z.
All model materials are re-normalized to the art bible §4.5/§5 palette in code.

- `hunter.glb` — "Hunter Avatar" by 3DRaven — https://sketchfab.com/3d-models/93c6c4f6455849bb9095d02a309fdded — license CC-BY.
  Mixamo rig (79 joints) + baked Idle clip. Top hat collapsed in code and replaced with a
  procedural hood + shoulder mantle + knee cloak; Walk/Run clips authored procedurally on the
  same rig. Body texture desaturated/darkened to bible leather/cloth values.
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