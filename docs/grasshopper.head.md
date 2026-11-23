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
