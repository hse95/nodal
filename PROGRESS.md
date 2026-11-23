# Progress

Last updated 2026-11-22 (version 0.5.0). Written so that a new session can pick up from here.

## State

Version 0.5.0 is built, tested and deployed. Versions 0.2.0 to 0.5.0 change the display, the editor and the verification tools only (see CHANGELOG.md); the solver in `src/fe` is unchanged since 0.1.0. Live app: <https://hse95.github.io/nodal/> (deployed by `.github/workflows/ci.yml` on every push to `main`).

| Check | Result |
|---|---|
| `npm run typecheck` | clean (strict mode) |
| `npm test` | 321 tests pass: data trees and engine (51), benchmarks (28), benchmarks rebuilt from components (28), cross-check and sparse solver (59), components and geometry (12), examples (40), templates (11), editor helpers, formulas and icons (14), nonlinear (4), assistant (26), design benchmarks (23), new components (18), step-by-step method, PDF and aliases (7) |
| `npm run test:ui` | 31 browser tests pass in headless Chrome against the production build, each asserting an empty console |
| Verification | 28 of 28 benchmarks pass, 93 checks, in the tests and in the in-app panel |
| CI | type check, tests, build, browser tests and deploy all green on GitHub |

The live URL returns the app's HTML. The no-console-errors check was run on the identical production build locally and on the GitHub runner; the build environment could not open the live URL in a browser (outbound access to github.io is blocked there), so that last step should be confirmed once by opening the link.

## Measured performance

Solver, `npm run bench` (Node 22, 2-core cloud VM; a current laptop is usually faster):

| Model | Free DOF | Non-zeros in the factor | Factorization | Whole analysis |
|---|---|---|---|---|
| Plane frame, 60 bays × 140 stories | 51,240 | 5.3 M | 1.1 s | 1.7 s |
| Shell plate, 91 × 91 nodes | 48,606 | 11.0 M | 3.8 s | 5.3 s |
| 3D building frame, 12 × 12 bays × 50 stories | 50,700 | 22.5 M | 18.9 s | 21.1 s |

Target: about 50,000 DOF in a few seconds. **Met for plane frames, borderline for shells, not met for 3D frames.** The cause is the scalar up-looking factorization; a supernodal or multifrontal kernel with dense blocks (or a compiled WASM kernel) should give a factor of 3 to 5.

Interface:

| Target | Measured |
|---|---|
| Canvas about 60 fps with 500 components | 60 fps median while panning 500 components (headless Chrome, software rendering) |
| First load under about 3 MB | 1.04 MB (1,021 kB script, 303 kB gzipped; 22 kB CSS) |
| Heavy modules lazy | Manifold 0.59 MB, rhino3dm 2.75 MB and KaTeX 0.29 MB (plus its fonts) load on first use only |
| All 28 benchmarks in the browser | about 5 s |

## Not done, against the brief

1. **OpenCascade / B-rep kernel**: no trimmed surfaces, solid fillets or shelling; **no STEP or IGES import or export**. Solids are closed meshes.
2. **Rust/WASM solver kernel**: not built (the WASM target could not be installed here), so the brief's "benchmark both" was not possible.
3. **WebGPU**: not used.
4. **Large-displacement frames and shells**: the nonlinear analysis follows large displacements for truss and cable members only.
5. **Two-node spring element**: only nodal spring supports exist.
6. **Performance target for 3D frames** (above).
7. **Accessibility and tablet**: partial; see PLAN.md phase 10.

## Known limitations of what is there

- Triangular shells have a constant-strain membrane: use quadrilaterals where possible.
- Shell stresses are element-center values averaged at nodes; peaks at edges are underestimated on coarse meshes.
- Shell loads are lumped to nodes; no shell temperature load; no line loads on shell edges.
- No lateral–torsional buckling, no warping torsion, no shear-center offset for channels and angles.
- Second-order analysis treats tension-/compression-only members as ordinary bars.
- Modal mass comes from element density only.
- Curve offset does not trim self-intersections; fillet works on polylines; loft, sweep and surface offset are interpolated approximations.
- The utilization is a simplified stress ratio; there are no design-code checks.
- Rotated supports are treated as global-axis supports for cable members in the nonlinear analysis.
- The "duplicate elements" warning is the only guard against accidentally doubled geometry (it caught a doubled leg in the tower example during development).

## Added in 0.2.0, and what is still rough there

- `src/ui/preview.ts` decides which outputs are drawn (only the last stage of a structural chain). The rule works on what is wired, so two separate Result Views of the same model are both drawn on top of each other; switch one off.
- Force diagrams label member ends and peaks. A member split into elements is recognized by collinear elements meeting at an unsupported node with no third member; values at such nodes are written only at a local peak.
- Templates (`src/templates/index.ts`) are tested by `tests/templates.test.ts`. The three building blocks are not solved in the tests because they wait for wires.
- Text size scales canvas components through the zoom, so on the canvas it has the same effect as zooming in. Legible zoom enlarges titles and port names when zoomed out, up to what fits; below about 45 % zoom text is still too small to read.
- Typeset formulas need KaTeX to load once (about 0.3 MB); until then a plain-text form is shown.
- The side panels still take about 480 px, so on a screen narrower than about 1300 px the canvas and the 3D view are cramped. The layout buttons (canvas only, 3D only, stacked) are the remedy for now.
- The 3D view follows the model after a fit. This is not yet a setting.

## How to continue

- Solver speed: replace `factorLDL` in `src/fe/sparse.ts` with a supernodal version; `scripts/perf.ts` measures it and every benchmark guards it.
- B-rep: add opencascade.js as a lazily loaded module behind `src/io/formats.ts` (STEP/IGES) and new surface components; keep it out of the first load.
- Frames in large displacement: a co-rotational beam in `solveNonlinear` (`src/fe/analysis.ts`); benchmark with the elastica cantilever.
- A better membrane triangle (for example an Allman-type or ANDES element) in `src/fe/shell.ts`; benchmark B22 has a triangle row to compare against.

## Rules for changes

- Run `npm test` after any change to `src/fe`, `src/geom` or `src/core`. No benchmark may regress.
- `npm run docs` regenerates the verification report and the component reference; commit the result.
- `node scripts/record-media.mjs` re-records the README images from the running build.
