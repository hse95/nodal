# Changelog

## 0.3.0 (2026-11-21)

A ribbon with icons, a more realistic 3D view, and verification models built from ordinary components. No change to the solver; all 28 benchmarks give the same values as before.

**Ribbon**

- The component list on the left is replaced by a ribbon across the top, with a tab for each family of components and tabs for Templates, Examples and Verification.
- Every component has its own icon (255 of them, drawn for Nodal), shown in the ribbon, on the component itself and in the search results. Hovering over an icon shows the name and a one-line description.
- Click an icon to add the component, or drag it onto the canvas. The search field looks through all tabs.
- The ribbon can be hidden with the arrow at its right end or from the View menu; the choice is remembered.
- Templates and examples are cards with a thumbnail. A template can be clicked or dragged, and its thumbnail follows the pointer.

**3D view**

- New default display, *Realistic*: members are solids with their real cross-sections, colored by material, lit from above with soft shadows. *Lines* gives the previous look.
- Supports are solid symbols that show what they do: a fixed support is a block with ground hatching against the member end, a pin is a pyramid on a plate, a roller is a pyramid on two rollers, a spring is a zigzag. Symbols grow with the member so a deep beam cannot hide them.
- Loads have solid arrowheads; distributed loads have a light band and end on the surface of the member; applied moments and reaction moments are arcs with arrowheads and values.
- With results on, members stay in their undeformed position and the deflected shape is a dashed blue line on top.
- Force diagrams are drawn over the members, so they are readable without the see-through display.
- *Fit all* button, **F** key and double-click fit everything into the clear part of the view (not under the toolbar, notes or legend). *Auto* keeps the model fitted as it changes. The view also fits again when the pane changes shape.
- The legend is smaller and sits in the bottom corner.

**Verification**

- Every benchmark can be opened *as components*: the same model written out with ordinary components (points, lines or mesh, material, section, elements, supports, loads, assembly, analysis) and a new *Verification Check* component that compares the result with the reference values. All 28 rebuilt models are solved in the tests and pass the same checks.

**Tests**

- 247 unit tests (new: all benchmarks rebuilt from components; every component has an icon and every template, example and benchmark has a thumbnail) and 20 browser tests (new: ribbon, verification as components, fit and display styles).

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
