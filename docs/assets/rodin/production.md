# Ashen Watch · Rodin production register

## Tool capability and budget

- Gen-2.5 accepts text, one to five uploaded subject images, or both. It exports GLB/USDZ/FBX/OBJ/STL; raw mesh targets 500–1,000,000 polygons, quad targets 1,000–50,000. Texture de-lighting can reduce reference highlights. UV quality, separated parts, translucency and exact packing are **inspection criteria**, not guarantees.
- Agentic (beta) fits explicitly constructed objects from references; it can choose procedural n-gons or the high-poly route, exporting GLB/USDZ/FBX/STL. Other optional charged stages: BANG part separation, PolyGen low-poly/texture variants, rigging/skinning/animation. No automatic retries. No need for rigging or physics generation on this prop.
- Retrieval: create a signed image upload, PUT exact bytes, generate once, check status and then retrieve the result. Inspect the actual binary, geometry, UVs, maps and a hardware-rendered view before any runtime swap. Never store temporary credentials.

## Selection, in camera order

| Class | Asset and decision |
| --- | --- |
| A | Watchman and both ghosts: intentionally **excluded from generation**. Keep authored rigs. Carried lantern: existing working glass, emitter, grip and pickup; preserve. Bell, chest, fireplace: imported assets with working mounts/lids, no new call. |
| B | **Corded oil flask**: old 10-segment sphere, straight neck and single torus cannot represent irregular knotted load-bearing cord or a hand-blown vessel. One replacement serves three supply locations. Well and cart already have authored joinery, dressed masonry, ironwork and correct support: preserve rather than regenerate the whole assemblies. |
| C | Grate bars, stones, window cames, debris and flagstones: keep batched geometry. Preserve four existing generated architecture assets and their records in `public/models/rodin/CREDITS.md`. |

## AW–B–01 — Corded lamp-oil flask (B, interactive secondary)

**Approved reference:** `concept/04-props-and-shade.png` cropped at (441,637), 294×360 native pixels. Only the flask is supplied. **Art direction:** damp, austere gatehouse, working equipment rather than ornament. One 0.26 m tall vessel, squat irregular pear body about 0.18 m wide, stable foot, short neck and slightly eccentric stopper. Warm muted olive/amber glass around old oil, dark matte twisted hemp knotted into four or five uneven diamonds, a collar and abraded porous cork. No trail of rope, logo, carrying handle, fire, plinth, bright baked glints or painted ground shadow. Silhouette, real cord crossings and nodes matter above microscopic weave. Expect correctly unpackable UVs/normals and roughness, nonmetallic glass/cork/hemp, restrained reflectance; no bloom or emissive paint. Production goal ≤6,000 triangles, one shared local GLB, ≤1K packed maps and shared instances. Preserve the current bottom origin and pickup logic. Keep the old mesh if loading or quality checks fail. Category B budget: **one reference-guided generation**; no paid refinement unless there is a diagnosed defect.

## AW–A–02 — Gatehouse roof and outer timber gable (A, scene architecture, production priority)

The entrance building is seen on every return and from the wall walk. The current main roof is two tiled boxes and two plain triangular gables. Replace **only the exterior roof assembly**. Preserve the authored gatehouse, hearth, door, window liner, bell bracket, smoke socket and interior rafters. Use the existing two-slope silhouette and a single modest front cross-gable informed by the approved gatehouse in `concept/01-castle.png`; the traced native-resolution reference isolates its slate and exposed timber. Physical envelope ~7.9 m wide × 10 m long; eaves near 3.55 m and ridge about 5.7 m. Cushion between compressed roof and character headroom; no new collider. Slate courses should lap, vary in chipped edges, give narrow shadows, avoid even fish scales or a uniform emboss. Rain-washed charcoal slate has a low, broad sheen. Timber: irregular oak end-grain, silvery brown boards in the front gable, dark joints. Restrained lichen in a damp sheltered edge, no fantasy ornament. No towers, windows, gate, walls, people, ground or chimney furnished by the generator. Single visual GLB, target 18k tris, web-sized base/normal/roughness with no baked sky highlights. Fit and inspect the underside, both ends and top locally; retain gameplay geometry on load failure. One generation for this assembly. Do not generate the watchman or ghosts.
