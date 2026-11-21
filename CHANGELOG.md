# Changelog

## 0.2.0 (2026-11-21)

Clearer results, templates and easier editing. No change to the solver; all 28 benchmarks give the same values as in 0.1.0.

**3D view**

- Only the last stage of a structural chain is drawn (curves, elements, model, result, Result View), so a model is no longer drawn on top of its own results. Hidden components say why in the inspector, and ticking Preview draws them anyway.
- Plane models in the X–Z plane open in the Front view.
- Members are bold lines; force diagrams are filled bands split at zero crossings, with values at member ends and peaks only. Labels are placed outside the diagram, kept inside the view, and no longer overlap.
- Axial force in truss and cable members is shown by color and line weight.
- Equal loads are labelled once. Clearer support symbols (pin, roller, fixed, sideways restraint).
- Section shapes are see-through in result views.
- Quick result controls in the 3D view (load case, diagram, contour, what to show). The view toolbar is more compact.
- Zoom to fit follows the drawn points instead of a bounding sphere, and the view keeps following the model as sliders change it until the view is moved by hand.
- SVG export includes thick lines, diagram fills and the labels as placed.

**Canvas**

- Templates tab with seven complete models and three building blocks; also in the right-click menu and the search.
- Right-click a wire to delete it or to show its data in a panel.
- Drop a wire on a component to connect to its first fitting port; drop it on empty canvas to choose a component that fits.
- Components can be dragged from the list onto the canvas.
- Text size setting (A−, A+ and View menu), remembered between visits. Titles, port names and slider values stay legible when zoomed out.
- Formulas are typeset with KaTeX: on Expression components, in notes (between dollar signs), in the benchmark comparison panel and in the Verification dialog.
- Panels show table data as a table.
- Double-click a title to rename a component. Undo and redo work wherever the focus is.
- A new project opens at a readable zoom instead of fitting everything.

**Fixes**

- Undo did nothing after clicking in the component list.
- The view button stayed highlighted after turning a top, front or right view by hand.
- The "Sections" option of the Result View had no effect.

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
