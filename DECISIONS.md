# Decisions

Architecture and theory decisions, newest last. Each has a one-line reason. Changes from the defaults in the build brief are marked **(change from brief)**.

| # | Decision | Reason |
|---|---|---|
| 1 | UI framework: **Solid** | Fine-grained updates: moving one node or slider re-renders only what depends on it, and the runtime is about 7 kB. |
| 2 | Canvas nodes are DOM elements inside one CSS-transformed layer; wires are SVG paths | Pan and zoom change a single transform; text inputs, tooltips and accessibility come for free. Measured 60 fps while panning 500 components. |
| 3 | Node layout (port positions) is computed from a formula, not measured from the DOM | Wire end points are known without layout reads, which keeps wire updates cheap. |
| 4 | The engine decides what to recompute from a signature of each node's settings and its upstream result versions | The UI can call "run" after any change without tracking dirtiness itself, which removes a class of stale-result bugs. |
| 5 | Undo is snapshot based (up to 100 steps) | Simple and safe; a project is small JSON. |
| 6 | Data-tree conventions are Nodal's own and documented: simplify keeps one index; reverse acts inside branches; cross reference is row-major; list outputs from item inputs go to sub-branches | Stated rules that the tests pin down, rather than imitating another product. |
| 7 | `Assemble Model` flattens its inputs | Elements, supports and loads should all end up in one model whatever tree structure they arrive in; otherwise a three-wire truss silently becomes three models. |
| 8 | **(change from brief)** Solver written in **TypeScript with typed arrays, not Rust/WASM** | The Rust `wasm32` target could not be installed in the build environment (toolchain download blocked), so the two could not be benchmarked against each other. Measured TypeScript timings are in PROGRESS.md; a compiled or supernodal kernel is the first improvement to make. |
| 9 | Sparse **LDLᵀ** (not Cholesky), up-looking, with minimum-degree ordering on the node graph and RCM as a fallback | LDLᵀ factorises indefinite tangent matrices and gives the inertia, used as a stability check in second-order and nonlinear analysis. Ordering at node level is cheap and exact degrees are affordable there. |
| 10 | Eigenproblems by **subspace iteration** with a Jacobi solve of the projected problem | Robust for the lowest modes and handles the indefinite geometric stiffness in buckling; simpler to verify than Lanczos with reorthogonalisation. |
| 11 | Frame element: exact Timoshenko stiffness with Φ = 0 for Euler–Bernoulli; releases by condensation expressed as a transformation | One code path for both theories; the transformation reduces stiffness, loads, geometric stiffness and mass consistently. |
| 12 | Internal forces along members come from statics on the end forces and the member load | Exact between nodes for linear analysis without subdividing members. |
| 13 | Reporting convention: N tension positive; My positive for sagging (tension on −z); moment diagrams on the tension side | What engineers expect to read; the vector convention is documented in the theory manual. |
| 14 | DOFs without any stiffness are switched off automatically, but a load on such a DOF is an error | Truss nodes need no manual rotational restraints, and a load that cannot be carried is never dropped silently. |
| 15 | Shell quadrilateral: **MITC4 bending + QM6 incompatible-mode membrane + drilling penalty (α = 0.01)**, rigid-link warp correction | Passes the patch tests exactly and the three classic shell benchmarks within about 1 % at moderate meshes. |
| 16 | Shell triangle: **DKT bending + constant-strain membrane** | DKT is accurate in bending; the CST membrane is stiff, which is stated everywhere. A better membrane triangle is future work. |
| 17 | Hemisphere reference value **0.093** as given in the brief; MacNeal & Harder quote 0.0940 | The brief specifies 0.093; both values are within the 3 % tolerance of the computed 0.0931 to 0.0934. The benchmark file records both. |
| 18 | Scordelis–Lo reference **0.3024** | It is the value MacNeal & Harder and Belytschko et al. normalise by; the file also notes Scordelis & Lo's 0.3086 and Krysl & Chen's 0.3006. |
| 19 | **(change from brief)** Geometric nonlinearity covers truss and cable members only; frames and shells stay linear in that analysis | A correct 3D co-rotational beam with finite rotations is a large piece of work on its own. The limitation is returned with every nonlinear result and documented; second-order analysis covers frames. |
| 20 | Slack cables are handled by a regularised Newton step accepted on an energy decrease | Plain Newton fails on a singular tangent; this converges from a straight, slack chord (benchmark B21). |
| 21 | **(change from brief)** No OpenCascade in this version: curves and surfaces are a native NURBS kernel; solids are closed meshes with Manifold booleans | Keeps the first load under 1 MB and everything testable in Node. Cost: no trimmed surfaces, no solid fillets, **no STEP or IGES**. This is the largest gap against the brief. |
| 22 | **(change from brief)** WebGL2 only, no WebGPU path | Lines and meshes at this scale show no measurable benefit from WebGPU, and a second renderer would double the code to maintain. |
| 23 | Benchmarks are JSON files that name a parametric builder; expected values are formulas evaluated by the safe expression parser | One definition serves the tests, the in-app panel and the report, and closed-form values are derived, not typed in. |
| 24 | Benchmark examples in the gallery use a "Verification Model" component rather than hand-built graphs | All 28 open with one click and stay in step with the benchmark files. |
| 25 | Units: SI inside the solver; conversion only in the structural components; geometry is unitless (1 unit = 1 m or 1 ft) | One place to get conversions right; tested with a US-unit model against a hand calculation. |
| 26 | Solver and script code run in workers; cancelling terminates the worker | The UI never blocks, and a runaway script or analysis can always be stopped. |
| 27 | Browser tests use the installed Chrome (Playwright "chrome" channel) | No browser download in CI or in restricted environments. |
| 28 | Build order: engine, geometry, solver and benchmarks first; then components; then the interface | The headless layers can be tested exhaustively in Node before any UI exists. The phases in PLAN.md are all covered, in a different order from the brief. |
| 29 | Credit line exactly as given in the brief, in the About dialog and the README | Requested wording. |
