# Nodal user guide

Nodal is a parametric modeling canvas with a structural finite element solver built in. It runs entirely in your browser: there is nothing to install, no account, and nothing is uploaded.

> Nodal is provided as is. Check every result independently before using it for any real design. The "utilization" it reports is a simplified stress ratio, not a design-code check.

Contents: [Getting started](#1-getting-started) · [The canvas](#2-the-canvas) · [Data trees](#3-data-trees) · [The structural workflow](#4-the-structural-workflow) · [Results](#5-results) · [Optimization](#6-optimization) · [Form-finding](#7-form-finding) · [Files and formats](#8-files-and-formats) · [Units](#9-units) · [Verification](#10-verification) · [Troubleshooting](#11-troubleshooting)

## 1 Getting started

The window has four parts: the **component list** on the left, the **canvas** where you build the graph, the **3D view**, and the **inspector** on the right. The top bar holds the menus, the solve status and the layout buttons.

The quickest start is a **template**: open the **Templates** tab on the left and click *Simply supported beam*. A complete model appears on the canvas, with sliders for the span and the load, and the 3D view shows the beam, its bending moment diagram and its deflection. Drag a slider to see everything update. Templates are described in section 2.

**Help → Take the tour** builds a small truss in five steps. To do the same by hand:

1. Double-click the canvas, type `slider`, press Enter. Do it twice: one slider for the span, one for the height.
2. Add three `Construct Point` components. Leave the first at the origin; wire the span slider into the X of the second; wire the span (through a `Division` by 2) into the X of the third and the height slider into its Z.
3. Add three `Line` components and connect the points in pairs.
4. Add a `Tube Section` and a `Truss`. Wire the three lines into the truss's **C** (curve) input and the section into **S**.
5. Add three `Support` components: on the first point with conditions `ux uy uz`, on the second with `uy uz`, and on the apex with `uy` (a flat truss must be held against moving out of its plane).
6. Add a `Point Load` on the apex. Its default force is (0, 0, −10) kN.
7. Add `Assemble Model` and wire in the elements, supports and load. Add `Linear Static` and then `Result View`.

The 3D view now shows the truss, its supports, the load and the deformed shape. Select the Result View and choose **Axial force N** under *Member diagram* in the inspector. Drag the height slider and everything updates.

The same model is in **Examples → Quick start: a simple truss**.

## 2 The canvas

### Adding and connecting

- **Add a component**: double-click the canvas and type (fuzzy search), click an entry in the component list or drag it onto the canvas, or press Ctrl/Cmd+K.
- **Connect**: drag from an output dot (right side) to an input dot (left side). A new wire replaces the old one on that input; hold **Shift** while dropping to add a second wire. Several wires into one input are merged in the order they were connected.
- **Connect without aiming**: let go of the wire anywhere on a component and it goes to the first free port that accepts that kind of data. Let go on **empty canvas** and a search opens that lists only the components that can take the wire; pick one and it is added and connected.
- **Disconnect**: right-click a wire and choose *Delete wire*, or click the wire and press Delete. The same menu has *Show its data in a panel*, which is a quick way to see what a wire carries.
- Wires are colored by data type. A thicker wire carries a list; a dashed thick wire carries a tree with several branches.

### Templates

A template is a group of connected components that is added to the project you have open (an example, by contrast, opens as a new project). The **Templates** tab of the left-hand list has two kinds:

- **Complete models**: simply supported beam, cantilever, continuous beam, plane truss, portal frame, column buckling and a rectangular plate. Each has sliders for its main dimensions and loads, and panels with the key results. They are checked against hand calculations by the automated tests.
- **Building blocks**: a material with a section, a set of load cases with a combination, and a results readout. These are meant to be wired into your own graph; the frame around each says where.

Click a template to add it below what is already on the canvas, or drag it to where you want it. You can also right-click empty canvas and choose one under *Insert template here*, or type its name in the double-click search. The new components arrive selected and inside a group, so they can be moved together. Undo removes the whole template.

### Text size

**A−** and **A+** in the top bar (or **View → Text size**) make all text smaller or larger in five steps. The setting is remembered. It changes the menus, lists, inspector and 3D labels, and the size of the components on the canvas.

When the canvas is zoomed out, component titles, port names and slider values are drawn larger than the zoom alone would make them, so a graph stays readable for longer.

### Moving around

- Mouse wheel zooms; right-drag, middle-drag or Space+drag pans; **F** zooms to fit; the minimap in the corner jumps to any part of the graph.
- Drag on empty canvas to box-select. Shift-click adds to the selection.
- Components snap to a 10-pixel grid; hold Alt while dragging to move freely. Arrow keys nudge the selection.

### Editing

- Ctrl/Cmd+Z and Y undo and redo. Ctrl/Cmd+C, X, V copy, cut and paste; the clipboard also works between projects and browser tabs. Ctrl/Cmd+D duplicates.
- **Right-click** a component for preview on/off, enable/disable, rename, group, cluster, the list-matching rule, and alignment of several selected components. Double-click a component's title to rename it.
- **Groups** (Ctrl/Cmd+G) draw a labeled frame around components. Double-click the label to rename it; right-click the label to remove the group.
- **Notes** are free text on the canvas (`Note` in Params). Text between dollar signs is typeset as a formula: `Midspan moment $\frac{wL^2}{8}$`. Double-click such a note to edit it.
- **Clusters** pack a selection into one component with its own inputs and outputs (right-click → *Make cluster*). Wires crossing the selection boundary become the cluster's ports. A new cluster is also saved to *My clusters* in the component list, so it can be inserted into other projects. In the inspector a cluster can be renamed, saved again, or unpacked.

### States

| Appearance | Meaning |
|---|---|
| normal | solved |
| amber border, **!** | warning: it produced data, or is waiting for an input; hover the **!** to read why |
| red border, **!** | error: nothing was produced; the message says what to change |
| faded | disabled |
| italic gray name | preview off |
| pulsing blue border | being solved now |

### Input widgets

`Number Slider` (set the range in the inspector), `Boolean Toggle`, `Value List`, `Panel` (shows whatever is wired into it, or outputs the lines you type), `Graph Mapper`, `Color`.

The `Expression` component evaluates a formula typed as on a calculator, such as `5*w*L^4/(384*E*I)`. Every name in it becomes an input. The formula is shown typeset on the component and in the inspector, so a misplaced bracket is easy to spot.

### The inspector

Select one component to see its description, messages, settings, every input and output with type and unit, and an example. For inputs that are not wired you can type a constant here: numbers, text, `x, y, z` for points and vectors, and several values separated by semicolons for list inputs. The four small buttons next to each input (**F G S R**) flatten, graft, simplify or reverse the data arriving at that input.

## 3 Data trees

Every wire carries a **data tree**: a set of lists (branches), each with a path such as `{0;2}`. A single value is a tree with one branch holding one item. Trees keep related data together: dividing five curves gives five branches of points, one per curve.

### How a component runs

1. **Branches are paired by position.** If one input has five branches and another has one, the single branch is used with each of the five. The output keeps the paths of the input with the most branches.
2. **Items are matched inside each pair of branches** by the component's matching rule (right-click → Matching):
   - **Longest list** (default): the shorter list repeats its last item.
   - **Shortest list**: stops at the end of the shorter list.
   - **Cross reference**: every combination, with the first input varying slowest.
3. An input marked **list** receives the whole branch at once, and one marked **tree** receives everything.
4. A component that makes a list from single items (for example Divide Curve) puts each result in its own sub-branch `{path;i}`.

### Tree components

| Component | Effect |
|---|---|
| Flatten Tree | everything into one list `{0}` |
| Graft Tree | every item into its own branch |
| Simplify Tree | removes the part of the paths that all branches share |
| Reverse Tree Items | reverses each branch |
| Trim Tree | drops the last path index, merging siblings |
| Flip Matrix | swaps rows and columns: item *j* of branch *i* becomes item *i* of branch *j* |
| Tree Branch | one branch by its path |
| Path Mapper | rewrites paths, e.g. `{A;B}` → `{B;A}` or `{A;B}` → `{A}` |
| Merge | joins several streams; equal paths are concatenated |
| Tree Statistics | paths, lengths, branch count |

Two patterns cover most needs: **graft** one input to pair each of its items with all items of another input, and **flatten** before a component that should see everything as one list. `Assemble Model` flattens its inputs itself, so elements, supports and loads can arrive in any tree structure.

## 4 The structural workflow

Geometry → elements → supports and loads → model → analysis → results.

### Materials and sections

- `Material` offers typical steel, concrete, timber and aluminum values; `Custom Material` takes E, ν, G, density, strength and thermal expansion.
- Sections: rectangular, hollow rectangular, circular, tube, I, channel, angle and `Generic Section` (A, Iy, Iz, J). `Section Table` reads your own CSV table (`name, A, Iy, Iz, J`), which is how to bring in standard steel shapes.
- **Orientation**: local *x* runs along the member; local *z* is "up" (global Z made perpendicular to the member); for vertical members local *y* is global Y. `Iy` is the strong-axis value for a beam under gravity. Rotate a section with the *Angle* input of `Beam`, or give an *Up* vector. Turn on **Local axes** in the Result View to check.

### Elements

| Component | Element |
|---|---|
| Beam | frame element, six degrees of freedom per node. *Shear* off = Euler–Bernoulli, on = Timoshenko. *Size* splits members into shorter elements. Curves become straight chords. |
| Truss | axial-only bar. Mode 1 = tension-only, 2 = compression-only. |
| Cable | tension-only, with pretension and a slack factor; several segments let it sag in a nonlinear analysis. |
| End Releases | hinges at member ends: `pin` or `ry rz` releases both bending moments. |
| Rigid Offsets | connects member ends to their nodes through rigid arms (eccentric connections). |
| Shell | surface or mesh → shell elements. Quadrilaterals are more accurate than triangles. |

Every element has an **ID** (text). Loads use IDs to choose which members they act on, and section sizing groups members by ID.

### Supports

`Support` takes a point and conditions as text: `fixed`, `pinned`, or a list such as `ux uz ry`. A plane input rotates the support axes. `Support Displacement` imposes a settlement; `Spring Support` adds elastic springs.

Supports and point loads attach to the node **at their position**. If nothing is there (within the merge tolerance of `Assemble Model`), you get a warning naming the coordinates.

### Loads

| Component | Notes |
|---|---|
| Point Load | force and moment on a node |
| Line Load | on line elements; optional end value for a linear variation; global, local, or per unit projected length |
| Self Weight | from density and section; the vector is in multiples of *g* |
| Temperature Load | uniform change and gradients on line elements |
| Area Load | pressure on shells: normal, along a direction, or on plan (projected) |
| Mesh Load | pressure on a separate mesh, passed to the nearest nodes |
| Load Combination | named, factored sum of load cases |

Each load has a **Case** name. Loads with the same name are solved together; combinations refer to the names.

### Model checks

`Assemble Model` and the analyses tell you, in plain language, about: supports or loads that touch no node; zero-length elements; degenerate shells; missing or non-positive section and material values; duplicate elements; parts of the model with no support; mechanisms (with the node and the direction that is free to move); and loads applied in a direction that no element stiffens.

### Analyses

| Component | What it does |
|---|---|
| Linear Static | all load cases with one factorization; combinations by superposition |
| Second-Order Analysis | P-Δ and P-δ through the geometric stiffness, iterated to convergence |
| Buckling Analysis | load factors and shapes of elastic buckling for one load set |
| Modal Analysis | natural frequencies and mode shapes (consistent or lumped mass) |
| Nonlinear Analysis | large displacements of cables and trusses; load steps or arc-length |

Analyses run in a background worker, so the interface stays responsive. The status in the top bar shows what is being solved, with a **Cancel** link.

For second-order and buckling analyses, split each member into several elements (for example `Size` = one quarter of the member length).

## 5 Results

### What is drawn

A structure passes through several components: curves, elements, the assembled model, the analysis result and the Result View. Only the **last** of these that is on the canvas is drawn, so the model is never drawn underneath its own result. A component that is hidden for this reason says so in the inspector, and its *Preview in 3D* box is empty; tick the box to draw it as well, or just select that one component to see it highlighted. Switching off the preview of a Result View hides the whole chain.

A model that lies in the vertical X–Z plane (a beam, a plane truss or frame) opens in the **Front** view, where loads and diagrams are seen square-on. Everything else opens in the 3D view. The buttons at the top of the 3D view switch between them.

After **Fit** (and when a project is opened) the view keeps the whole model in sight as sliders change it. As soon as you turn, pan or zoom the view yourself it stays where you put it; press **Fit** to let it follow again.

### Reading the picture

- **Members** are bold lines. With a force diagram on, the bold line is the undeformed member and the deflected shape is a thin line; without a diagram the deflected shape is bold and the undeformed member is a faint line.
- **Force diagrams** are filled bands: blue where the value is positive, red where it is negative, split at the zero crossings. Values are written at member ends and at peaks, and the largest value has a frame. Where two values would overlap, the larger one is kept.
- **Axial force in truss and cable members** is shown by the member itself: blue for tension, red for compression, heavier for a larger force, with the value at mid-length.
- **Loads** are orange, **reactions** purple, **supports** green. A triangle is a support that holds the node vertically; a second line under it means the node can slide (a roller); a cross in the triangle means rotation is held too. A node held only sideways has a short bar along the held direction. Equal loads on many nodes or members are labelled once.
- **Section shapes** are see-through in a result view, so that they do not hide diagrams.

### Quick controls

The second row of buttons in the 3D view changes the Result View directly: load case or mode, member diagram, shell contour, and what to show (deformed shape, loads, reactions, values, sections, animation). If a result is on screen but there is no Result View yet, that row offers to add one.

### Components and tables

- **Result View** draws a result in 3D. In its inspector: load case or mode, deformed shape with scale (−1 = automatic) and animation, undeformed overlay, member diagrams (N, Vy, Vz, T, My, Mz) drawn on the member with end and extreme values, shell contours (displacements, membrane forces, moments, principal and von Mises stresses at the top, middle or bottom surface), principal directions, reactions, loads, supports, utilization colors, section shapes and local axes.
- **Click** a node, member or shell in the 3D view to read all its values in the inspector.
- **Result tables** (inspector of any analysis or Result View): nodal displacements, reactions, member forces, shell results; click a column to sort, type to filter, **CSV** to export.
- Every result reports an **equilibrium check** (sum of reactions against sum of applied loads) and the solver statistics.
- Result components feed numbers back into the graph: `Nodal Displacements`, `Displacement At Point`, `Reactions`, `Member Forces`, `Axial Forces`, `Utilization`, `Shell Results`, `Modes`, `Deformed Geometry`, `Result Table`.

**Sign conventions**: N is positive in tension. My is positive for sagging (tension on the −z side); moment diagrams are drawn on the tension side. Shell moments are positive when the top (+z) surface is in tension. Details are in the theory manual.

## 6 Optimization

### Evolutionary Optimizer

1. Build a graph that ends in one number to minimize, the **fitness**. Combine a goal and constraints with an `Expression`, for example `m + 2000 * max(0, d - lim)` for weight plus a penalty when the deflection exceeds a limit.
2. Add `Evolutionary Optimizer` and wire the fitness into it.
3. Select it. In the inspector tick the sliders it may change, set population and generations, and press **Run optimization**.

The convergence plot updates live. When it finishes, the sliders hold the best design, and the *Best designs* table lets you reinstate any of the top designs with **Use**. Ctrl/Cmd+Z returns to the design you had before. The method is a genetic algorithm with an optional local search; it is a heuristic and does not guarantee the global optimum.

### Section Sizing

Give `Section Sizing` a model and a list of candidate sections. Members are grouped by element ID; each group gets the lightest candidate that keeps the simplified stress utilization at or below the target, and the analysis repeats until the choice settles. It reports the mass, the largest utilization and a log. It is based on stress only and does not check member buckling.

## 7 Form-finding

- **Force Density**: lines, anchors and a force density per line (force/length). One linear solve gives the equilibrium shape. Good for cable nets: start from a mesh on the boundary shape, use its edges as lines and its boundary points as anchors.
- **Dynamic Relaxation**: lines act as elastic springs with a rest length (a factor of the drawn length, or target lengths), under loads on the nodes. Use a rest factor below 1 to pretension a net, or above 1 with an upward load to "hang" a gridshell upside down.

Both output the relaxed lines, the node positions and the line forces. Feed the lines into `Beam`, `Truss` or `Cable` to analyze the found shape (see the gridshell example).

## 8 Files and formats

- **Projects** are `.nodal` files (JSON with a schema version). *File → Save* downloads one; *File → Open* reads one. The current project is also autosaved in the browser (IndexedDB) and reopened next time.
- **Import geometry** (File menu, or the `Geometry From File` component): STL, OBJ, DXF (lines, polylines, circles, arcs, 3D faces, points), 3DM (meshes, curves, points; bodies through their saved render meshes), CSV (rows of `x, y, z` become points).
- **Export** the geometry shown in the 3D view as STL, OBJ, glTF, 3DM or DXF; the data of the selected component as CSV; the 3D view as PNG or SVG; the canvas as PNG or SVG.
- **STEP and IGES** are not available in this version (they need a B-rep kernel).

## 9 Units

Choose **SI** (kN, m, MPa; section sizes and displacements in mm) or **US customary** (kip, ft, ksi; section sizes and displacements in inches) in the top bar. Geometry on the canvas is unitless: one unit is one meter in SI projects and one foot in US projects. Every numeric port that carries a physical quantity shows its unit in the tooltip and in the inspector.

Switching the unit system changes how the numbers in the graph are read; it does not convert them.

## 10 Verification

Each check in the Verification panel shows its reference formula typeset next to the computed and reference values. Opening a benchmark as an example gives the same comparison as a table in a panel.

**Verification** in the top bar runs all 28 benchmarks in your browser and lists computed value, reference value, error and tolerance for each check, with convergence plots for the mesh studies. **Open as example** loads a benchmark model into the canvas. The same suite runs in the automated tests; the full table is in `docs/verification-report.md`.

## 11 Troubleshooting

| Message or symptom | What to do |
|---|---|
| "Input … has no data" | connect the input, or type a value for it in the inspector |
| "A support at (…) does not touch any node" | the point is not on an element end; fix the geometry or raise the tolerance of Assemble Model |
| "The structure is not stable …" | the message names a node and direction. Typical causes: a flat truss not held out of plane; too many releases at a joint; truss bars that do not form triangles; missing supports |
| "… no element provides stiffness in that direction" | a load acts where nothing can carry it, such as a moment on a truss node |
| "… separate parts … has no support" | members that should meet do not share a node: check end points or raise the tolerance |
| Results look wrong by a factor of 1000 | check the units of the port in the inspector |
| The 3D view is empty | press **Fit**; check that Preview is on for the components you want to see |
| A long analysis blocks nothing but takes time | click **Cancel** in the top bar; reduce the mesh density |

See also the [component reference](component-reference.md), the [theory manual](theory-manual.md) and the [verification report](verification-report.md).
