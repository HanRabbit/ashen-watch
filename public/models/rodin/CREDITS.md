# Generated Rodin assets for Ashen Watch

Hyper3D Rodin generated the assets listed below. The game GLBs include local fitting and texture packing.

| Asset | Source triangles | Game triangles | Generation |
| --- | ---: | ---: | --- |
| Outer bailey curtain and drum | 35,000 | 35,000 | [Rodin workspace](https://hyper3d.ai/workspace/rodin/3c85f383-8da8-437f-b97d-bca54ce0f0ea) |
| Gatehouse curtain collapse | 12,000 | 17,833 | [Rodin workspace](https://hyper3d.ai/workspace/rodin/dabec627-0a8e-4070-8c16-6300307a14f8) |
| Fallen cloister relief | 8,500 | 8,500 | [Rodin workspace](https://hyper3d.ai/workspace/rodin/5f4fa981-1df1-45f0-988e-58cc9f406f84) |
| Chapel pinnacle | 5,000 | 5,000 per instance | [Rodin workspace](https://hyper3d.ai/workspace/rodin/1b770b5f-a4aa-46f0-8710-449aa30003de) |
| Corded lamp-oil flask (AW–B–01) | 6,000 | 6,000 per instance | [Rodin workspace](https://hyper3d.ai/workspace/rodin/306f611e-1bc0-4590-a2a9-1af0de140987) |
| Gatehouse slate roof and oak gable (AW–A–02) | 41,224 | 19,666 | [Rodin workspace](https://hyper3d.ai/workspace/rodin/1fa2177a-030e-483e-9684-d62e47222998) |

`tools/pack-rodin.py` prepares the textures for the web. The outer curtain is fitted to the playable footprint and reuses the existing Poly Haven masonry scan for close views. The gatehouse collapse retains the fitted Rodin scarp as an internal core; `tools/fit-gate-scarp.mjs` rebuilds the exposed masonry around the same collision profile and creates a new PBR atlas from the project’s existing stone and mortar scans. Both chapel pinnacles share geometry and textures.

`tools/pack-oil-flask.py` fits and finishes the flask from the Rodin PBR artifact. The three placements share one GLB and a single material with embedded base colour, tangent-space normal and packed clearcoat/roughness/metalness maps. See `docs/assets/rodin/production.md` for the source record and acceptance status.

`tools/fit-gatehouse-roof.py` registers the Agentic roof and finishes it using the existing roof slate and weathered plank scans credited in `public/textures/CREDITS.md`.
