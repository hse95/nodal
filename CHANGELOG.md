# Changelog

## 0.1.0 (2026-11-19)

First release.

- Node canvas with data trees, 250+ components, groups, clusters, undo/redo, search and command palette.
- Native geometry kernel: lines, arcs, NURBS curves and surfaces, meshes; Manifold booleans; STL, OBJ, DXF, 3DM, CSV, glTF.
- Structural solver: frame, truss, cable and shell elements; linear static, second-order, buckling, modal and nonlinear cable analysis; sparse LDLᵀ in a worker.
- Results: deformed shapes, member diagrams, shell contours, reactions, utilization, tables, click-to-inspect, equilibrium check.
- Form-finding (dynamic relaxation, force density), evolutionary optimizer, section sizing.
- Verification suite of 28 benchmarks with an in-app panel; independent reference solver; example gallery.
- Documentation: user guide, theory manual, verification report, component reference.

Milestones in this release, in the order they were committed:

1. Core engine: data trees, graph evaluation, geometry kernel, FE solver, benchmarks 1–21.
2. Shell benchmarks 22–28, randomized cross-check against the reference solver, performance script.
3. Component library, units, section sizing, form-finding, optimizer.
4. App shell, canvas, 3D viewport, inspector, examples, verification panel, file formats, browser tests.
5. Browser feature tests, 3DM in the browser, adaptive arc-length, nonlinear tests, theory manual.
6. Documentation, README media, force envelopes.
