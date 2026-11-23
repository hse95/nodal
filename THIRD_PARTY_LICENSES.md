# Third-party licenses

Nodal's own code is released under the MIT license (see `LICENSE`). It depends on the open-source packages below. All of them permit redistribution as part of a public web application.

## Shipped with the app

| Package | Version | License | Used for | How it is loaded |
|---|---|---|---|---|
| [solid-js](https://github.com/solidjs/solid) | 1.9 | MIT | user interface | bundled in the main script |
| [three](https://github.com/mrdoob/three.js) | 0.170 | MIT | 3D viewport (WebGL2), orbit controls | bundled in the main script |
| [katex](https://github.com/KaTeX/KaTeX) | 0.16 | MIT (code), SIL OFL 1.1 (its math fonts) | typeset formulas in panels, notes, expressions and the verification table | separate script, style sheet and fonts, downloaded only when the first formula is shown |
| [manifold-3d](https://github.com/elalish/manifold) | 3.5 | Apache-2.0 | solid and mesh booleans | WebAssembly module, downloaded only when a boolean component first runs |
| [rhino3dm](https://github.com/mcneel/rhino3dm) | 8.35 | MIT | reading and writing .3dm files | WebAssembly module, downloaded only on the first 3DM import or export |

Apache-2.0 notice for manifold-3d: Copyright the Manifold Authors. Licensed under the Apache License, Version 2.0; a copy of the license is at <https://www.apache.org/licenses/LICENSE-2.0>. Nodal uses the unmodified package from npm.

rhino3dm is the MIT-licensed JavaScript/WebAssembly build of the openNURBS toolkit by Robert McNeel & Associates.

## LGPL components

**None.** The build brief allowed OpenCascade (LGPL-2.1 with exception, through opencascade.js) for B-rep modeling. It is not included in this version (see `DECISIONS.md`), so no LGPL code is distributed with Nodal. If it is added later it must stay a separately loaded, replaceable WebAssembly module, and this file must say so.

## Added in version 0.5.0

| Package or data | Use | License |
|---|---|---|
| three-gpu-pathtracer 0.0.23 | The Render button (path tracing); loaded on demand | MIT |
| three-mesh-bvh 0.7.8 | Used by the path tracer | MIT |
| three.js example modules (RoomEnvironment, EffectComposer, GTAOPass, OutputPass, GLTFExporter) | Lighting, ambient occlusion, glTF export | MIT |
| AISC shape dimensions and properties (W and rectangular HSS), values of the AISC Shapes Database v15.0 as distributed with the steelpy package | The AISC Shape component and the AISC 360 check | steelpy: Apache-2.0. The values are published by the American Institute of Steel Construction; check them against the current Steel Construction Manual. |

## Development and test tools (not shipped)

| Package | License |
|---|---|
| vite, vite-plugin-solid, vitest, tsx, @types/three, @types/node | MIT |
| typescript, @playwright/test | Apache-2.0 |

## Algorithms re-implemented from the literature

No third-party source code was copied. The following were written for Nodal from the cited publications: sparse LDLᵀ factorization after T. A. Davis (2005); NURBS algorithms after Piegl & Tiller (1997); the MITC4, DKT and incompatible-mode elements after their original papers. Full references are in `docs/theory-manual.md`.

Nodal does not contain code, documentation, icons or branding from Grasshopper, Rhino, Karamba3D, Kangaroo or any other proprietary product. Component names and descriptions are Nodal's own.
