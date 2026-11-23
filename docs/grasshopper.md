# Coming from Grasshopper

Nodal works the way Grasshopper does: components on a canvas, wires between them, and data in lists and trees with the same matching rules. Most components have the same names. This page lists the habits that carry over, the names that differ, and what is different. The same page is in the app under **Help → Coming from Grasshopper**.

Nodal was written from scratch. It contains no code, icons or text from Grasshopper, Rhino or any add-on, and it is not affiliated with them.

## Habits that carry over

| In Grasshopper | In Nodal |
|---|---|
| Double-click the canvas and type a name | The same. A name you know from Grasshopper usually finds the Nodal component, even where the name differs. |
| Type a number, `0<5<10`, `"text` or `// note` in the search | The same shortcuts: a slider with that value, a slider with that range, a panel with the text, a note. |
| Drag from an output to an input | The same. Hold Shift to add a wire to an input that already has one. Right-click a wire to delete it. |
| Ctrl+G groups; clusters | Ctrl+G groups. Right-click a selection to make a cluster, which is saved under Tools in the ribbon. |
| Flatten, graft, simplify, reverse on a parameter | Right-click an input and choose the same options. Data matching (longest, shortest, cross reference) is in the component menu. |
| Panel, Param Viewer | Panel shows data and typed text. Tree Statistics lists paths and counts. |
| Preview on or off; enable or disable | P toggles the preview of the selection; the right-click menu has Enable and Disable. |
| Animate a slider | Right-click a slider and choose *Animate this slider*. Options → Record video saves the 3D view as a WebM file while it plays. |
| Bake | There is no Rhino document. Use File → Export (3DM, OBJ, STL, DXF, glTF) to take geometry elsewhere, and Geometry From File to bring it in. |
| Units come from the Rhino document | Units are a project setting (SI or US). Ports say which unit they expect; structural quantities are converted for you. |
| Structural analysis needs an add-on | It is built in: the Structure tab has materials, sections, elements, supports, loads, analyses, results and code checks. |
| Rendering needs a render plug-in | The Render button path-traces a still picture of the 3D view. Options → Export glTF takes the model to Blender or Unreal Engine. |

## Data trees

Paths are written `{0;1}` and items `{0;1}[2]`, as in Grasshopper. The tree components are Flatten Tree, Graft Tree, Simplify Tree, Trim Tree, Flip Matrix, Path Mapper, Tree Branch, Tree Item, Tree Statistics, Entwine, Clean Tree, Split Tree and Relative Item.

- **Split Tree** takes a mask such as `{0;*}`, `{?;(2 to 4)}` or `{*}[(0,2,...)]`: a number, `?` for any one index, `*` for any number of indices, `!n` for "not n", `(a,b,c)` for a set, `(a to b)` for a range and `(a,b,...)` for a sequence.
- **Relative Item** takes an offset such as `{0}[+1]` (the next item in the same branch) or `{+1}[0]` (the same position in the next branch).
- **Path Mapper** rewrites paths with masks such as `{A;B}` → `{B;A}`.

## What is different

- Nodal runs in the browser and has its own geometry kernel: curves, NURBS surfaces and meshes. It has no trimmed surfaces and no B-rep solid modeling; solids are meshes.
- There is no Rhino viewport to pick geometry from. Geometry is made by components or read from a file (3DM, OBJ, STL, DXF).
- Scripts are JavaScript and run in a sandbox.
- Check results before relying on them. The Verification tab shows what the solver has been tested against, and saves a report as a PDF.

## Names that differ

Typing either name in the search finds the component. Names of add-on components are listed where Nodal has a component for the same job. Nodal is not affiliated with those products and shares no code with them.

| Name you may know | Nodal component | Ribbon tab |
|---|---|---|
| Aligned Dimension | **Dimension** | Display |
| Analysis | **Linear Static** | Structure |
| Analyze | **Linear Static** | Structure |
| Analyze ThII | **Second-Order Analysis** | Structure |
| Area | **Area And Volume** | Surface |
| ASD | **ASCE 7 Combinations** | Structure |
| Bar | **Truss** | Structure |
| Beam Forces | **Member Forces** | Structure |
| Beam View | **Result View** | Structure |
| Bend Deform | **Bend** | Transform |
| Bouncy Solver | **Dynamic Relaxation** | Tools |
| Box 2Pt | **Box** | Surface |
| Branch | **Tree Branch** | Trees |
| Brick Panels | **Staggered Panels** | Surface |
| Buckling Modes | **Buckling Analysis** | Structure |
| Building Frame | **Frame Grid** | Structure |
| C# Script | **Script** | Tools |
| Cable Net | **Force Density** | Tools |
| Catmull-Clark Subdivision | **Subdivide Mesh** | Mesh |
| CCX | **Curve \| Curve** | Curve |
| Center Box | **Box** | Surface |
| Cir | **Circle** | Curve |
| Circle CNR | **Circle** | Curve |
| Code Check | **AISC 360 Check** | Structure |
| Colour RGB | **Color RGB** | Display |
| Colour Swatch | **Color** | Params |
| Combine and Clean | **Weld Mesh** | Mesh |
| Concrete Check | **ACI 318 Beam Check** | Structure |
| Concrete Design | **ACI 318 Beam Check** | Structure |
| Cross Section Selector | **AISC Shape** | Structure |
| Curve Curve Intersection | **Curve \| Curve** | Curve |
| Deconstruct | **Deconstruct Point** | Vector |
| Diagrid Structure | **Diagrid** | Surface |
| Divide Distance | **Divide Length** | Curve |
| Domain Box | **Box** | Surface |
| Eigen Modes | **Modal Analysis** | Structure |
| Equality | **Equals** | Math |
| Evaluate | **Expression** | Math |
| Evaluate Length | **Evaluate Curve** | Curve |
| Evolutionary Solver | **Evolutionary Optimizer** | Tools |
| Explode Tree | **Tree Branch** | Trees |
| FDM | **Force Density** | Tools |
| File Path | **Geometry From File** | Params |
| First Order Analysis | **Linear Static** | Structure |
| Flip | **Flip Matrix** | Trees |
| Form Finding | **Dynamic Relaxation** | Tools |
| Formula | **Expression** | Math |
| Frame Element | **Beam** | Structure |
| Galapagos | **Evolutionary Optimizer** | Tools |
| Gate And | **And** | Math |
| Gate Not | **Not** | Math |
| Gate Or | **Or** | Math |
| Gate Xor | **Xor** | Math |
| Genetic Algorithm | **Evolutionary Optimizer** | Tools |
| GhPython | **Script** | Tools |
| Gravity | **Self Weight** | Structure |
| Grid Structure | **Frame Grid** | Structure |
| Hexagonal | **Hexagonal Grid** | Vector |
| HexGrid | **Hexagonal Grid** | Vector |
| Howe Truss | **Truss Generator** | Structure |
| If | **Pick** | Math |
| Import 3DM | **Geometry From File** | Params |
| Import Geometry | **Geometry From File** | Params |
| IntCrv | **Interpolate** | Curve |
| Interpolate Curve | **Interpolate** | Curve |
| JavaScript | **Script** | Tools |
| Join Meshes | **Mesh Join** | Mesh |
| Join Meshes and Weld | **Weld Mesh** | Mesh |
| Laplacian Smoothing | **Smooth Mesh** | Mesh |
| Length | **Curve Length** | Curve |
| Line to Beam | **Beam** | Structure |
| Line to Truss | **Truss** | Structure |
| Ln | **Natural Logarithm** | Math |
| Load Combinations | **ASCE 7 Combinations** | Structure |
| Loads | **Point Load** | Structure |
| LRFD | **ASCE 7 Combinations** | Structure |
| MA | **Mass Addition** | Math |
| Mesh Subdivision | **Subdivide Mesh** | Mesh |
| Mesh to Shell | **Shell** | Structure |
| Model View | **Result View** | Structure |
| Natural Vibrations | **Modal Analysis** | Structure |
| Nodal Load | **Point Load** | Structure |
| Optimize Cross Section | **Section Sizing** | Structure |
| P-Delta | **Second-Order Analysis** | Structure |
| Paneling Quads | **Quad Panels** | Surface |
| Param Viewer | **Tree Statistics** | Trees |
| Parameter Viewer | **Tree Statistics** | Trees |
| Particle Spring | **Dynamic Relaxation** | Tools |
| pDecon | **Deconstruct Point** | Vector |
| PlaneSrf | **Plane Surface** | Surface |
| PLine | **Polyline** | Curve |
| Point On Curve | **Evaluate Curve** | Curve |
| Pratt Truss | **Truss Generator** | Structure |
| Project | **Project To Plane** | Transform |
| Python | **Script** | Tools |
| RadGrid | **Radial Grid** | Vector |
| Radial | **Radial Grid** | Vector |
| Reaction Forces | **Reactions** | Structure |
| Rebar | **ACI 318 Beam Check** | Structure |
| Relax Mesh | **Smooth Mesh** | Mesh |
| ReMap | **Remap Numbers** | Math |
| Revolution | **Revolve** | Surface |
| Rotate 3D | **Rotate** | Transform |
| Rotate Axis | **Rotate** | Transform |
| Scribble | **Note** | Params |
| Section Forces | **Member Forces** | Structure |
| Shadow Study | **Shadow** | Tools |
| Shell View | **Result View** | Structure |
| Similarity | **Similar** | Math |
| Solar Position | **Sun Position** | Tools |
| Solver | **Dynamic Relaxation** | Tools |
| Space Frame | **Space Truss** | Surface |
| Space Truss Structure | **Space Truss** | Surface |
| SqGrid | **Square Grid** | Vector |
| Square | **Square Grid** | Vector |
| Staggered Quad Panels | **Staggered Panels** | Surface |
| Steel Check | **AISC 360 Check** | Structure |
| Steel Design | **AISC 360 Check** | Structure |
| Steel Section | **AISC Shape** | Structure |
| Stream Filter | **Pick** | Math |
| SubD | **Subdivide Mesh** | Mesh |
| Sum | **Mass Addition** | Math |
| Sun | **Sun Position** | Tools |
| Sunlight Hours | **Shadow** | Tools |
| SunPath | **Sun Path** | Tools |
| Swatch | **Color** | Params |
| Sweep 1 Rail | **Sweep** | Surface |
| Sweep1 | **Sweep** | Surface |
| Text Tag 3D | **Text Tag** | Display |
| Triangle Panels | **Triangular Panels** | Surface |
| Triangle Panels A | **Triangular Panels** | Surface |
| Triangle Panels B | **Triangular Panels** | Surface |
| TStat | **Tree Statistics** | Trees |
| Tween Points | **Point Between** | Vector |
| Tween Two Curves | **Tween Curves** | Curve |
| Unit Vector | **Unitize** | Vector |
| Volume | **Area And Volume** | Surface |
| W Shape | **AISC Shape** | Structure |
| Warren Truss | **Truss Generator** | Structure |
| Weld | **Weld Mesh** | Mesh |
| Wide Flange | **AISC Shape** | Structure |
