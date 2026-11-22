# Plan

The ten phases of the build brief, with a checklist for each. `[x]` done and tested, `[~]` partly done (the gap is described), `[ ]` not done. PROGRESS.md has the details and the measurements; DECISIONS.md explains every departure from the brief.

The headless layers (engine, geometry, solver, benchmarks) were built and tested first, then the component library, then the interface, so the order of work differed from the numbering below (decision 28).

## 1 Foundation
- [x] Repository, TypeScript strict mode, Vite, ES modules
- [x] CI: type check, tests, build, browser tests, deploy to GitHub Pages on every push to main
- [x] App shell, light and dark themes, resizable / swappable / stackable layout
- [x] Versioned project file (`.nodal`, schema 1) with a migration hook
- [x] Autosave to IndexedDB

## 2 Canvas and data engine
- [x] Data trees, branch and item matching (longest, shortest, cross), tree operations; 51 unit tests
- [x] Incremental graph engine, type coercion, cycle detection, async components
- [x] Node editor: pan, zoom, minimap, snapping, search on double-click, component list, command palette
- [x] Wires colored by type; OK / warning / error / disabled states with messages
- [x] Sliders, toggles, value lists, panels, graph mapper, notes
- [x] Undo/redo, copy/paste across projects, multi-select, align, keyboard shortcuts
- [x] Groups and reusable clusters
- [x] Built-in help for every component

## 3 Core geometry
- [x] Points, vectors, planes, lines, polylines, transforms, lists, math
- [x] Three.js viewport: orbit, standard views, fit, display modes, section plane, labels, screenshots

## 4 Advanced geometry
- [x] NURBS curves and surfaces (native kernel), lofts, sweeps, revolves, offsets, intersections
- [x] Meshes, Delaunay, quad remesh (simple), Manifold booleans
- [x] Import: STL, OBJ, DXF, 3DM, CSV. Export: STL, OBJ, glTF, 3DM, DXF, CSV, PNG, SVG
- [ ] OpenCascade B-rep kernel: trimmed surfaces, solid fillets, **STEP and IGES** (decision 21)

## 5 Frame and truss FE
- [x] Truss, frame (Euler–Bernoulli / Timoshenko), releases, offsets, orientation, springs
- [x] Tension-only, compression-only and cable members
- [x] Materials, sections, CSV section tables, supports (rotated, prescribed), all listed loads, cases, combinations, envelopes
- [x] Sparse LDLᵀ solver in a worker; model checks; equilibrium check; statistics
- [x] Benchmarks 1–16; independent reference solver; randomized cross-check
- [ ] Two-node spring element (nodal spring supports exist)

## 6 Stability, dynamics, nonlinear
- [x] Second-order analysis, linear buckling, modal analysis (lumped and consistent mass)
- [x] Newton–Raphson and arc-length for truss and cable members
- [~] Large displacements of frames and shells: not implemented; they stay linear in the nonlinear analysis (decision 19)
- [x] Benchmarks 17–21

## 7 Shells
- [x] MITC4 + QM6 quadrilateral, DKT + CST triangle, drilling stiffness, warp correction
- [x] Surface meshing by size, area loads, contours, principal directions
- [x] Benchmarks 22–28 with convergence studies

## 8 Form-finding and optimization
- [x] Dynamic relaxation, force density
- [x] Evolutionary optimizer with local search, live convergence plot, reinstating designs
- [x] Section sizing

## 9 Examples, verification panel, documentation
- [x] 10 examples plus all 28 benchmarks as one-click models, each with stated results that the tests check
- [x] In-app verification panel with pass/fail table and convergence plots
- [x] README, user guide, theory manual, generated verification report and component reference, licenses

## 10 Polish
- [x] Performance measured against the targets (PROGRESS.md)
- [~] 50,000-DOF target: met for plane frames and shells, not for 3D frames (supernodal factorization is the next step)
- [x] First-run tour
- [~] Accessibility: labels, focus styles, keyboard menus and shortcuts; components on the canvas cannot yet be reached with Tab alone
- [~] Tablet: pointer events are used throughout, but it has not been tested on a tablet

## 11 Version 0.2.0: clearer results and easier editing (requested after the first release)
- [x] Clean result display: one stage of a structural chain drawn, front view for plane models, bold members, banded diagrams with values at peaks, truss forces by color, labels that do not overlap or leave the view
- [x] Typeset formulas (KaTeX): expressions, notes, benchmark comparison table, verification dialog and report
- [x] Adjustable text size, remembered; legible text when zoomed out
- [x] Right-click a wire to delete it
- [x] Templates: seven complete models and three building blocks, each complete model tested against a hand calculation
- [x] Easier editing: wire dropped on a component or on empty canvas, drag from the list, quick result controls in the 3D view, undo from anywhere, rename by double-click, readable zoom on open
- [~] Narrow screens: the side panels are slimmer below 1320 px, but there is no automatic collapse

## 12 Version 0.3.0: ribbon, icons and a realistic view (requested)
- [x] Ribbon with a tab per component family, plus Templates, Examples and Verification; search; hover help; can be hidden
- [x] An icon for every component and a thumbnail for every template, example and benchmark, all drawn for Nodal
- [x] Templates dragged from thumbnail cards
- [x] Realistic display: section solids, material colors, shadows; Lines display kept
- [x] Clear support symbols (fixed, pinned, roller, spring), better load and reaction arrows, moment arcs
- [x] Deflected shape as a dashed line
- [x] Fit all, Auto fit, F key; fit avoids the toolbar, notes and legend
- [x] Verification models opened as ordinary components, with a Verification Check component; all 28 tested
- [ ] Not done: icons have no text labels under them (hover shows the name); touch devices have no hover, so the search field is the fallback there

