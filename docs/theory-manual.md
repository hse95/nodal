# Nodal theory manual

This manual states what the solver computes, with the formulas, the sign conventions and the known limitations. The source files named in each section carry the same information as comments next to the code. Where an approximation is made, it is stated here.

Internal units are SI throughout: N, m, kg, s, K (stresses in Pa, moments in N·m). Unit conversion happens only at component inputs and outputs (`src/fe/units.ts`).

Contents: [1 Coordinates and degrees of freedom](#1-coordinates-and-degrees-of-freedom) · [2 Line elements](#2-line-elements) · [3 Shell elements](#3-shell-elements) · [4 Loads](#4-loads) · [5 Assembly, supports and solution](#5-assembly-supports-and-solution) · [6 Second-order and buckling](#6-second-order-analysis-and-buckling) · [7 Modal analysis](#7-modal-analysis) · [8 Nonlinear analysis](#8-geometrically-nonlinear-analysis) · [9 Results](#9-results-and-sign-conventions) · [10 Form-finding](#10-form-finding) · [11 Optimization](#11-optimization) · [12 Geometry kernel](#12-geometry-kernel) · [13 Known limitations](#13-known-limitations) · [References](#references)

## 1 Coordinates and degrees of freedom

Global axes are right-handed with $Z$ up. Every node has six degrees of freedom $[u_x, u_y, u_z, \theta_x, \theta_y, \theta_z]$; rotations are right-handed rotation vectors and are assumed small in all analyses except the co-rotational bar of Section 8.

**Local axes of a line element** (`memberAxes` in `src/fe/model.ts`):

- local $x$ runs from the start node to the end node;
- local $z$ is the reference direction (global $Z$ by default, or the user's "Up" vector) made perpendicular to $x$;
- local $y = z \times x$;
- if the member is parallel to the reference direction (a vertical column), $y$ is global $Y$ and $z = x \times y$;
- finally $y$ and $z$ are rotated about $x$ by the orientation angle.

With this convention a horizontal beam has its local $z$ pointing up, and $I_y$ (bending about local $y$, deflection along $z$) is the strong-axis second moment of area for gravity loading.

**Local axes of a shell element** (`shellGeometry` in `src/fe/shell.ts`): $e_3$ is the normal of the mean plane (cross product of the diagonals for a quadrilateral); $e_1$ is global $X$ projected onto the element plane (global $Y$ when $X$ is within about 18° of the normal); $e_2 = e_3 \times e_1$. Local stress components therefore have a consistent direction over a surface.

## 2 Line elements

Source: `src/fe/beam.ts`. Local degrees of freedom are ordered $[u, v, w, \theta_x, \theta_y, \theta_z]$ at the start node and then at the end node. Note that $\theta_y = -\,\mathrm{d}w/\mathrm{d}x$ and $\theta_z = +\,\mathrm{d}v/\mathrm{d}x$.

### 2.1 Stiffness

The frame element uses the exact stiffness matrix of a prismatic Timoshenko beam with St. Venant torsion (Przemieniecki 1968, section 5.6). With the shear parameters

$$\Phi_y = \frac{12 E I_z}{G A_{sy} L^2}, \qquad \Phi_z = \frac{12 E I_y}{G A_{sz} L^2},$$

the bending block in the $x$–$y$ plane, for $[v_1, \theta_{z1}, v_2, \theta_{z2}]$, is

$$\mathbf{k}_{xy} = \frac{E I_z}{(1+\Phi_y) L^3}
\begin{bmatrix}
12 & 6L & -12 & 6L \\
 & (4+\Phi_y)L^2 & -6L & (2-\Phi_y)L^2 \\
 & & 12 & -6L \\
\text{sym.} & & & (4+\Phi_y)L^2
\end{bmatrix}.$$

The $x$–$z$ block for $[w_1, \theta_{y1}, w_2, \theta_{y2}]$ has the same entries with $I_y$, $\Phi_z$, and opposite signs on the terms that couple translation and rotation. Axial and torsional stiffness are $EA/L$ and $GJ/L$. Setting $\Phi = 0$ gives the Euler–Bernoulli element; the user chooses per member ("Shear" input of the Beam component).

Truss, cable, tension-only and compression-only members keep only the axial term.

Because the stiffness is exact for a prismatic member with nodal loads, nodal displacements are exact to round-off regardless of the number of elements (benchmarks B01 to B09).

### 2.2 Coordinate transformation, offsets and releases

With $\mathbf{R}$ the $3\times3$ matrix whose rows are the local axes, local end displacements are obtained from global nodal displacements by $\mathbf{d}_\ell = \mathbf{T}_g \mathbf{d}$, where $\mathbf{T}_g$ contains $\mathbf{R}$ on its four diagonal blocks.

**Rigid offsets.** If a member end is displaced from its node by a rigid arm $\mathbf{o}$ (global components), the end displacement is $\mathbf{u}_{end} = \mathbf{u} + \boldsymbol\theta \times \mathbf{o}$ and $\boldsymbol\theta_{end} = \boldsymbol\theta$. This adds the block $\mathbf{R}\,\mathbf{S}(\mathbf{o})$ to $\mathbf{T}_g$, with

$$\mathbf{S}(\mathbf{o}) = \begin{bmatrix} 0 & o_z & -o_y \\ -o_z & 0 & o_x \\ o_y & -o_x & 0 \end{bmatrix}.$$

The element length and axes are those of the offset member.

**End releases.** Released local degrees of freedom $c$ carry no force. They are eliminated by static condensation, written as a transformation so that every element matrix is reduced consistently:

$$\mathbf{d}_c = -\mathbf{k}_{cc}^{-1}\mathbf{k}_{cr}\,\mathbf{d}_r + \mathbf{k}_{cc}^{-1}\mathbf{f}_c, \qquad \mathbf{T}_c = \begin{bmatrix}\mathbf{I} \\ -\mathbf{k}_{cc}^{-1}\mathbf{k}_{cr}\end{bmatrix},$$

$$\mathbf{k}^\* = \mathbf{T}_c^{\mathsf T}\mathbf{k}\,\mathbf{T}_c, \quad \mathbf{f}^\* = \mathbf{T}_c^{\mathsf T}\mathbf{f}, \quad \mathbf{k}_g^\* = \mathbf{T}_c^{\mathsf T}\mathbf{k}_g\mathbf{T}_c, \quad \mathbf{m}^\* = \mathbf{T}_c^{\mathsf T}\mathbf{m}\,\mathbf{T}_c .$$

The reduction is exact for stiffness and loads. For the geometric stiffness and the mass it is a Guyan reduction, which is an approximation. If $\mathbf{k}_{cc}$ is singular (for example the same release at both ends) the member is reported as unstable.

The element matrix in global degrees of freedom is $\mathbf{K}_e = \mathbf{B}^{\mathsf T}\mathbf{k}\,\mathbf{B}$ with $\mathbf{B} = \mathbf{T}_c\mathbf{T}_g$.

### 2.3 Geometric stiffness

For an axial force $N$ (tension positive) the consistent geometric stiffness on cubic Hermite shape functions is used (McGuire, Gallagher & Ziemian 2000, chapter 9). In the $x$–$y$ plane:

$$\mathbf{k}_{g,xy} = \frac{N}{30L}
\begin{bmatrix}
36 & 3L & -36 & 3L \\
 & 4L^2 & -3L & -L^2 \\
 & & 36 & -3L \\
\text{sym.} & & & 4L^2
\end{bmatrix},$$

with the corresponding sign changes in the $x$–$z$ plane, and the twist term $N (I_y + I_z)/(A L)\,[1, -1; -1, 1]$. Truss members use the string stiffness $N/L$ in both transverse directions.

*Approximation.* Shear deformation is not included in $\mathbf{k}_g$, so with Timoshenko members it is slightly inconsistent with $\mathbf{k}$; the effect vanishes with mesh refinement. Coupling terms from bending moments and torque (lateral–torsional buckling) are not included: Nodal finds flexural and uniform-torsion buckling of members and frames, not lateral–torsional buckling.

### 2.4 Mass

Consistent mass uses the Hermite cubics for bending ($\rho A L/420$ times the usual $[156, 22L, 54, -13L; \dots]$ matrix), linear functions for axial and torsional motion ($\rho A L/6\,[2,1;1,2]$ and $\rho (I_y+I_z) L/6\,[2,1;1,2]$). Rotary inertia of the cross-section in bending is neglected. Lumped mass places $\rho A L/2$ on the translations of each node and $\rho (I_y+I_z)L/2$ on the twist.

### 2.5 Cross-section properties

Source: `src/fe/model.ts`. $A$, $I_y$, $I_z$ are exact for the idealized shapes (sharp corners, no fillets). Torsion constants: solid rectangle by the series approximation $J = a c^3\left[\tfrac13 - 0.21\tfrac{c}{a}\left(1 - \tfrac{c^4}{12a^4}\right)\right]$ ($a \ge c$); closed hollow sections by Bredt's formula $J = 4A_m^2 t/p_m$; open sections by $\sum b t^3/3$. Shear areas are the usual estimates ($5A/6$ for solid rectangles, $0.9A$ for solid circles, $A/2$ for tubes, web area for I and channel sections). Channel and angle sections ignore the shear-center offset, and the angle ignores the rotation of its principal axes; both are stated in the component help.

## 3 Shell elements

Source: `src/fe/shell.ts`. Shells are flat elements: a membrane part and a plate-bending part are formed in the element plane and superposed, then rotated into global axes. Six degrees of freedom per node are kept, with the rotation about the normal (the drilling rotation) given stiffness as described below.

### 3.1 Membrane

**Quadrilateral.** Bilinear displacements enriched by four incompatible modes,

$$u = \sum_i N_i u_i + (1-\xi^2)\,a_1 + (1-\eta^2)\,a_2, \qquad v = \sum_i N_i v_i + (1-\xi^2)\,a_3 + (1-\eta^2)\,a_4,$$

(Wilson et al. 1973). The gradients of the incompatible modes are evaluated with the Jacobian at the element center and scaled by $\det\mathbf{J}_0/\det\mathbf{J}$, the modification of Taylor, Beresford & Wilson (1976) that makes the element pass the patch test for any shape (often called QM6). The internal parameters $a_i$ are condensed element by element. Benchmark B28 confirms the patch test to round-off.

**Triangle.** Constant-strain triangle (CST). It passes the patch test but is stiff in in-plane bending, so triangles converge more slowly than quadrilaterals (compare the two rows of benchmark B22).

**Drilling rotation.** The rotation about the normal is tied to the in-plane rotation of the displacement field by the penalty functional of Hughes & Brezzi (1989),

$$\Pi_\theta = \tfrac12\,\alpha\,G\,t \int_A \left[\theta_z - \tfrac12\left(\frac{\partial v}{\partial x} - \frac{\partial u}{\partial y}\right)\right]^2 \mathrm{d}A, \qquad \alpha = 10^{-2},$$

integrated with the full rule. The small factor removes the singularity of the drilling freedom and lets a beam transfer torque into a shell without noticeably stiffening the membrane. Results are insensitive to $\alpha$ over several orders of magnitude; the value is a constant in the source (`ALPHA_DRILL`).

### 3.2 Plate bending

The rotations of the normal are $\beta_x = \theta_y$ and $\beta_y = -\theta_x$, so that $u = z\beta_x$ and $v = z\beta_y$. Curvatures and moments:

$$\boldsymbol\kappa = \begin{bmatrix}\beta_{x,x} \\ \beta_{y,y} \\ \beta_{x,y}+\beta_{y,x}\end{bmatrix}, \qquad \mathbf{M} = \frac{E t^3}{12(1-\nu^2)}\begin{bmatrix}1 & \nu & 0\\ \nu & 1 & 0 \\ 0 & 0 & \tfrac{1-\nu}{2}\end{bmatrix}\boldsymbol\kappa .$$

**Quadrilateral: MITC4** (Dvorkin & Bathe 1984; Bathe & Dvorkin 1985). Reissner–Mindlin kinematics with bilinear $w$, $\beta_x$, $\beta_y$. To avoid shear locking the covariant transverse shear strains are not computed from the displacement interpolation but interpolated from their values at the four edge mid-points:

$$\gamma_{\xi z} = \tfrac12(1-\eta)\,\gamma_{\xi z}^{A} + \tfrac12(1+\eta)\,\gamma_{\xi z}^{C}, \qquad \gamma_{\eta z} = \tfrac12(1-\xi)\,\gamma_{\eta z}^{D} + \tfrac12(1+\xi)\,\gamma_{\eta z}^{B},$$

where, for an edge from node $a$ to node $b$, $\gamma^{ab} = \tfrac12(w_b - w_a) + \tfrac14(x_b-x_a)(\beta_{x,a}+\beta_{x,b}) + \tfrac14(y_b-y_a)(\beta_{y,a}+\beta_{y,b})$. They are transformed to Cartesian components with the inverse Jacobian. Shear stiffness is $\kappa G t$ with $\kappa = 5/6$. Integration is $2\times2$ Gauss.

**Triangle: DKT** (Batoz, Bathe & Ho 1980). A thin-plate (Kirchhoff) element. The rotations vary quadratically; their mid-side values follow from two constraints on each side of length $l$ with tangent $s$ and normal $n$:

$$\beta_s^{mid} = -\frac{3}{2l}(w_b - w_a) - \frac14\left(\beta_{s,a}+\beta_{s,b}\right), \qquad \beta_n^{mid} = \frac12\left(\beta_{n,a}+\beta_{n,b}\right).$$

The first says that $w$ is cubic along the side and the shear strain vanishes at its mid-point; the second that the normal slope varies linearly. The code builds the element directly from these constraints rather than from the tabulated closed form. Integration uses the three mid-side points. DKT has no transverse shear deformation, so shear forces are reported as zero for triangles.

### 3.3 Warped quadrilaterals

The four nodes of a quadrilateral on a doubly curved surface are not coplanar. The element is formed on its mean plane, and each projected corner is connected to the true node by a rigid link of length $z_i$ along the normal (MacNeal 1978):

$$u' = u - z_i\,\theta_y, \qquad v' = v + z_i\,\theta_x .$$

This keeps rigid-body motions strain-free and is what allows the flat element to pass the pinched hemisphere (B24).

### 3.4 Shell mass and geometric stiffness

Lumped mass puts the tributary mass $\rho t A_i$ on the translations and a small rotary inertia $\rho t^3 A_i/12$ on the rotations. The consistent option uses the (bi)linear shape functions for the translations. The geometric stiffness is that of a membrane with resultants $N_x, N_y, N_{xy}$ acting on the gradients of the three translations,

$$\mathbf{K}_g = \int_A \mathbf{G}^{\mathsf T}\begin{bmatrix}N_x & N_{xy}\\ N_{xy} & N_y\end{bmatrix}\mathbf{G}\;\mathrm{d}A ,$$

using the membrane forces at the element center.

### 3.5 What to expect

Measured against the standard benchmarks (see the verification report for the tables and convergence plots): Scordelis–Lo roof 0.2 % from the reference with 16 × 16 quadrilaterals; pinched cylinder 1.1 % with 32 × 32; pinched hemisphere 0.07 % with 16 × 16; thin square plates within 0.1 % with 16 × 16. Triangles need roughly twice the mesh density for membrane-dominated problems.

## 4 Loads

Source: `buildLoads` in `src/fe/system.ts`.

- **Nodal forces and moments**, in global axes.
- **Member loads** varying linearly from $\mathbf{w}_1$ to $\mathbf{w}_2$: global, local, or global per unit *projected* length (the intensity is multiplied by $\sin\varphi$, $\varphi$ being the angle between the member and the load direction). Equivalent nodal loads are $\int \mathbf{N}^{\mathsf T}\mathbf{w}\,\mathrm{d}x$ with the element's own (Timoshenko) shape functions, integrated by four-point Gauss quadrature, which is exact. On truss members transverse loads are simply shared between the two nodes.
- **Self-weight**: $\rho A g$ per unit length on line elements and $\rho t g$ per unit area on shells, times the user's direction vector (default $(0,0,-1)$). $g = 9.80665\ \mathrm{m/s^2}$.
- **Temperature** on line elements. A uniform change $\Delta T$ gives equivalent end forces $\mp EA\alpha\Delta T$. Gradients $g_z = \partial T/\partial z$ and $g_y$ give end moments $\mp E I_y \alpha g_z$ and $\pm E I_z \alpha g_y$ (the warmer face lengthens). Shell temperature loads are not implemented.
- **Pressure on shells**: along the element normal, or along a given direction per unit surface area, or per unit projected area. It is lumped to the nodes with the integral of each shape function (tributary areas), without consistent nodal moments.
- **Mesh loads**: a pressure on a separate load mesh is converted to point loads at the mesh vertices (tributary areas), each applied to the nearest structural node.
- **Prescribed support displacements** enter the right-hand side as $-\mathbf{K}_{fc}\mathbf{u}_c$.
- **Cable pretension** $P_0$ and an unstressed-length factor $\lambda_0$ (unstressed length / drawn length) enter linear analyses as an initial force $P_0 + EA(1/\lambda_0 - 1)$.

Load cases are solved separately and combined linearly with the factors of each combination. With tension- or compression-only members superposition is not valid, and every case and combination is solved on its own (Section 5.3).

## 5 Assembly, supports and solution

Source: `src/fe/system.ts`, `src/fe/sparse.ts`.

### 5.1 Supports

Any of the six degrees of freedom of a node can be fixed, optionally in rotated axes. For a support with axes $\mathbf{Q}$ (rows are its axes) the node's degrees of freedom are carried in those axes, $\mathbf{u} = \mathbf{Q}^{\mathsf T}\mathbf{u}_s$; the rotation is folded into each connected element's $\mathbf{B}$ matrix. Springs add to the diagonal.

Degrees of freedom that receive no stiffness from any element (for example the rotations of a node where only truss bars meet, or the out-of-plane translation of a planar truss) are switched off automatically and counted in the solver statistics. If a load acts on such a degree of freedom the analysis stops with a message, because the load cannot be carried.

### 5.2 Linear solver

The stiffness matrix is stored as the upper triangle in compressed-column form. Nodes are reordered to reduce fill, using a minimum-degree ordering on the node graph (quotient-graph form with element absorption and exact external degrees); a reverse Cuthill–McKee ordering is also computed and used if it predicts less fill. The factorization is $\mathbf{K} = \mathbf{L}\mathbf{D}\mathbf{L}^{\mathsf T}$ without pivoting, in the up-looking form of Davis (2005), with the elimination tree giving the pattern of each row. All load cases reuse one factorization.

$\mathbf{L}\mathbf{D}\mathbf{L}^{\mathsf T}$ is used instead of Cholesky so that indefinite matrices can be factorized and the number of negative pivots is available (Sylvester's law of inertia); the second-order and nonlinear analyses use it as a stability check.

**Singularity.** A pivot smaller than $10^{-12}$ times the original diagonal entry is treated as zero. The factorization then continues with a stiff artificial pivot so that all such pivots are found in one pass, and the analysis stops with a message naming the node and direction of each unrestrained motion.

**Other checks before solving** (`checkModel` in `src/fe/analysis.ts`): no elements, no supports, zero-length elements, degenerate shells, non-positive material or section properties, duplicate elements (warning), and separate parts of the model without any support.

**Equilibrium check.** After each solution the residual $\mathbf{r} = \sum_e \mathbf{B}_e^{\mathsf T}\mathbf{q}_e - \mathbf{P}$ is formed from the element end forces. Its values at supported degrees of freedom are the reactions. The sum of reactions is compared with the sum of applied loads, and the error is reported with every result, as an absolute force and relative to the total load.

### 5.3 Tension-only, compression-only and cable members

These are solved by an active-set iteration: solve; compute the axial force each such member would carry; switch off (stiffness factor $10^{-9}$) the members whose force has the wrong sign and switch on those that would now be loaded correctly; repeat until the set does not change (at most 60 iterations). Slack members carry no pretension.

## 6 Second-order analysis and buckling

Source: `solveSecondOrder`, `solveBuckling`, `subspaceIteration` in `src/fe/analysis.ts`.

**Second-order analysis.** For each load set,

$$\left[\mathbf{K} + \mathbf{K}_g(\mathbf{N}^{(i)})\right]\mathbf{u}^{(i+1)} = \mathbf{P},$$

starting from the linear solution, with $\mathbf{N}^{(i)}$ the member axial forces and shell membrane forces of the previous iterate, until $\lVert\mathbf{u}^{(i+1)}-\mathbf{u}^{(i)}\rVert \le 10^{-8}\lVert\mathbf{u}^{(i+1)}\rVert$. Because $\mathbf{K}_g$ is the consistent matrix it represents both the sway effect (P-Δ) and the member-curvature effect (P-δ); the latter needs a few elements per member (benchmark B20 uses 8 and matches the exact beam-column solution to $3\times10^{-5}$ %). Member end forces include $\mathbf{k}_g\mathbf{d}$. If the tangent matrix is not positive definite the load set is at or above the elastic critical load and the analysis says so.

*Limitation.* The loads keep their direction (no follower forces), and the geometry is not updated; this is a second-order theory for small rotations, not a large-displacement analysis.

**Linear buckling.** A linear static solution for the reference load set gives $\mathbf{N}_{ref}$; then

$$\left[\mathbf{K} + \lambda\,\mathbf{K}_g(\mathbf{N}_{ref})\right]\boldsymbol\phi = \mathbf{0}.$$

The smallest positive $\lambda$ are found by subspace iteration (Bathe 1996, section 11.6) on $\mathbf{K}^{-1}(-\mathbf{K}_g)$, with a block of $\min(2p, p+8)$ vectors, Gram–Schmidt orthonormalization and an exact solution of the projected problem (Cholesky reduction and Jacobi rotations), until the first $p$ eigenvalues change by less than $10^{-10}$ relative.

## 7 Modal analysis

$\mathbf{K}\boldsymbol\phi = \omega^2\mathbf{M}\boldsymbol\phi$ is solved by the same subspace iteration. Frequencies are reported in Hz ($f = \omega/2\pi$) with the periods. Mode shapes are scaled to a largest translation of one. The mass comes from the density of the elements only; there is no component yet for converting loads to mass or adding lumped masses.

## 8 Geometrically nonlinear analysis

Source: `solveNonlinear` in `src/fe/analysis.ts`.

**Kinematics.** Truss, cable and tension-/compression-only members are exact co-rotational bars. With current length $l$, natural length $l_n = \lambda_0 L_0/(1 + P_0/EA)$ and unit vector $\mathbf{e}$ along the current chord,

$$N = EA\,\frac{l - l_n}{l_n}, \qquad \mathbf{f}_{int} = N\begin{bmatrix}-\mathbf{e}\\ \mathbf{e}\end{bmatrix}, \qquad \mathbf{K}_t = \frac{EA}{l_n}\,\mathbf{e}\mathbf{e}^{\mathsf T} + \frac{N}{l}\left(\mathbf{I}-\mathbf{e}\mathbf{e}^{\mathsf T}\right)$$

(as $\pm$ blocks on the two nodes). Cables and tension-only members have $N = 0$ and no material stiffness when $l < l_n$.

**Frame and shell elements are kept geometrically linear in this analysis.** A model that mixes them with cables is solved with a linear frame and nonlinear cables. For sway and member-buckling effects in frames use the second-order analysis. This is the main limitation of the nonlinear solver and is returned as a note with every nonlinear result.

**Newton–Raphson with load steps.** At each step the residual $\lambda\mathbf{P} - \mathbf{f}_{int}(\mathbf{u})$ is driven below $10^{-8}\lVert\mathbf{P}\rVert$. Slack cables make the tangent singular, so the iteration is safeguarded: if the tangent is not positive definite it is regularized as $\mathbf{K}_t + \mu\,\bar k\,\mathbf{I}$ ($\bar k$ the mean diagonal, $\mu$ increased tenfold until the factorization succeeds and reduced again after full steps), and a step is accepted only if a backtracking line search finds a decrease of the total potential energy $\Pi = U(\mathbf{u}) - \lambda\mathbf{P}^{\mathsf T}\mathbf{u}$. For cable nets, whose energy is convex, this behaves as a globally convergent minimization. Benchmark B21 starts from a straight, slack chord and converges to the elastic catenary.

**Arc-length method.** Optional cylindrical arc-length control (Crisfield 1981): the load factor is an extra unknown, constrained by $\lVert\Delta\mathbf{u}\rVert = \Delta l$; of the two roots of the constraint equation the one closest to the previous direction is taken; the step is halved on failure. It follows limit points (snap-through) of bar structures and returns the load–displacement path.

## 9 Results and sign conventions

Source: `src/fe/beam.ts` (`sectionForces`), `src/fe/post.ts`.

**Member forces** at a distance $x$ from the start follow from equilibrium of the piece $[0, x]$, using the end forces $\mathbf{q}$ and the distributed load. They are therefore exact along the member for a linear analysis, including between nodes. Reported components:

| Symbol | Meaning | Positive when |
|---|---|---|
| $N$ | axial force | tension |
| $V_y$, $V_z$ | shear forces | the force on the $+x$ face of the cut points along $+y$ / $+z$ |
| $T$ | torque | the moment vector on the $+x$ face points along $+x$ |
| $M_y$ | bending moment about local $y$ | the $-z$ fiber is in tension (sagging for a beam with $z$ up) |
| $M_z$ | bending moment about local $z$ | the $-y$ fiber is in tension |

With these conventions $\mathrm{d}M_y/\mathrm{d}x = -V_z$ and $\mathrm{d}M_z/\mathrm{d}x = -V_y$. Moment diagrams are drawn on the tension side.

**Deflected shape.** Between nodes the displayed member axis is the shape-function interpolation of the end displacements plus, for members without bending releases, the fixed-end particular solution for a linearly varying load (Euler–Bernoulli), $w_p = \dfrac{L^4\xi^2(1-\xi)^2}{120EI}\left[(3-\xi)q_1 + (2+\xi)q_2\right]$. For Timoshenko members and members with releases the displayed curve between nodes is an approximation; nodal values are not affected.

**Shell results** are evaluated at the element center in local axes: membrane forces $N_x, N_y, N_{xy}$ (per unit width, tension positive), moments $M_x, M_y, M_{xy}$ ($M_x > 0$ puts the top, $+z$, surface in tension), shears $Q_x, Q_y$ (quadrilaterals only). Surface stresses are $\sigma = N/t \pm 6M/t^2$; principal values and von Mises stress follow from them. Contours average the center values of the elements meeting at each node. Averaging smooths real jumps (at folds, thickness changes and supports) and does not extrapolate to the element corners, so peak values at edges are underestimated on coarse meshes.

**Utilization** of a line element is the largest value, over stations along the member, of

$$\frac{1}{f_y}\left(\frac{|N|}{A} + \frac{|M_y|}{W_y} + \frac{|M_z|}{W_z}\right).$$

It is an elastic stress ratio. It ignores member buckling, lateral–torsional buckling, shear, torsion, net sections and every code factor. **It is not a design-code check**, and the app labels it "simplified" wherever it appears. Section sizing (`src/fe/sizing.ts`) uses the same ratio.

## 10 Form-finding

Source: `src/geom/formfind.ts`.

**Force density method** (Schek 1974). With the branch–node matrix split into free and fixed parts $\mathbf{C} = [\mathbf{C}_f\ \mathbf{C}_x]$ and $\mathbf{Q} = \mathrm{diag}(q_j)$, $q_j = T_j/l_j$:

$$\left(\mathbf{C}_f^{\mathsf T}\mathbf{Q}\mathbf{C}_f\right)\mathbf{x}_f = \mathbf{p}_x - \mathbf{C}_f^{\mathsf T}\mathbf{Q}\mathbf{C}_x\,\mathbf{x}_x,$$

and likewise for $y$ and $z$. One sparse factorization serves the three coordinates.

**Dynamic relaxation with kinetic damping** (Barnes 1999). Each node has a fictitious mass $m_i = 0.55\sum_j \left(EA_j/l_{0j} + |T_j|/l_j\right)$ over the lines meeting at it, which keeps the explicit integration with unit time step stable. Velocities are updated from the residual forces; when the total kinetic energy falls, the nodes are moved back half a step and all velocities are reset to zero. Iteration stops when the largest residual is below the tolerance times the largest force. Lines are linear springs with rest length $l_0$ (a factor of the drawn length, or a target length), optionally tension-only; free nodes may also be tied to their starting positions by a spring.

## 11 Optimization

**Evolutionary optimizer** (`src/core/optimize.ts`): real-coded genetic algorithm with binary tournament selection, blend crossover (BLX with a 25 % overshoot), Gaussian mutation (standard deviation 10 % of each range), elitism, and an optional Hooke–Jeeves pattern search from the best individual. Evaluated designs are cached. It is a heuristic: it does not guarantee a global optimum, and results depend on the seed.

**Section sizing** (`src/fe/sizing.ts`): members are grouped by element ID; each pass gives every group the lightest candidate whose utilization (Section 9) is at most the target under the current forces, re-analyses, and repeats until no group changes. In statically indeterminate structures the result can depend on the starting point and need not be the global minimum weight.

## 12 Geometry kernel

Source: `src/geom`. Curves are lines, polylines, circular arcs, rational B-splines (NURBS) and chains of these. Surfaces are untrimmed NURBS patches. NURBS evaluation, knot insertion and global interpolation follow Piegl & Tiller (1997). Exact: arcs and circles as rational quadratics, extrusions, surfaces of revolution, iso-curves, sub-curves. Approximate (built by interpolating sampled points, or by sampling): loft, sweep, surface from points, surface offset, curve offset of free-form curves, curve–curve intersection, closest point, surface morph. Solids are closed meshes; booleans use the Manifold library.

## 13 Known limitations

- No B-rep kernel: no trimmed surfaces, no solid fillets or shelling, no STEP or IGES. Solids are meshes.
- Frames and shells are geometrically linear in the nonlinear analysis (Section 8).
- No material nonlinearity anywhere.
- No lateral–torsional or warping-torsion effects in line elements (uniform torsion only); no shear-center offset for channels and angles.
- Triangular shells use a constant-strain membrane; prefer quadrilaterals.
- Shell loads are lumped to nodes; shell temperature loads and line loads on shell edges are not implemented.
- Shell stresses are center values averaged at nodes.
- Modal analysis uses element mass only; no response-spectrum or time-history analysis.
- Second-order analysis treats tension-/compression-only members as ordinary bars.
- The utilization is a simplified stress ratio, not a code check. Nodal contains no design-code checks.
- Performance: the sparse factorization is a scalar (non-supernodal) implementation in TypeScript. Measured times are in `PROGRESS.md`; three-dimensional frames with a large bandwidth are the slowest case.

## References

- Barnes, M. R. (1999). Form finding and analysis of tension structures by dynamic relaxation. *International Journal of Space Structures* 14(2), 89–104.
- Bathe, K. J. (1996). *Finite Element Procedures*. Prentice Hall.
- Bathe, K. J. & Dvorkin, E. N. (1985). A four-node plate bending element based on Mindlin/Reissner plate theory and a mixed interpolation. *International Journal for Numerical Methods in Engineering* 21, 367–383.
- Batoz, J. L., Bathe, K. J. & Ho, L. W. (1980). A study of three-node triangular plate bending elements. *International Journal for Numerical Methods in Engineering* 15, 1771–1812.
- Belytschko, T., Stolarski, H., Liu, W. K., Carpenter, N. & Ong, J. S. J. (1985). Stress projection for membrane and shear locking in shell finite elements. *Computer Methods in Applied Mechanics and Engineering* 51, 221–258.
- Crisfield, M. A. (1981). A fast incremental/iterative solution procedure that handles "snap-through". *Computers & Structures* 13, 55–62.
- Davis, T. A. (2005). Algorithm 849: a concise sparse Cholesky factorization package. *ACM Transactions on Mathematical Software* 31(4), 587–591.
- Dvorkin, E. N. & Bathe, K. J. (1984). A continuum mechanics based four-node shell element for general nonlinear analysis. *Engineering Computations* 1, 77–88.
- Friedman, Z. & Kosmatka, J. B. (1993). An improved two-node Timoshenko beam finite element. *Computers & Structures* 47, 473–481.
- Hooke, R. & Jeeves, T. A. (1961). "Direct search" solution of numerical and statistical problems. *Journal of the ACM* 8, 212–229.
- Hughes, T. J. R. & Brezzi, F. (1989). On drilling degrees of freedom. *Computer Methods in Applied Mechanics and Engineering* 72, 105–121.
- Irvine, H. M. (1981). *Cable Structures*. MIT Press.
- Krysl, P. & Chen, J.-S. (2022). Benchmarking computational shell models. *Archives of Computational Methods in Engineering*.
- MacNeal, R. H. (1978). A simple quadrilateral shell element. *Computers & Structures* 8, 175–183.
- MacNeal, R. H. & Harder, R. L. (1985). A proposed standard set of problems to test finite element accuracy. *Finite Elements in Analysis and Design* 1, 3–20.
- McGuire, W., Gallagher, R. H. & Ziemian, R. D. (2000). *Matrix Structural Analysis*, 2nd ed. Wiley.
- Piegl, L. & Tiller, W. (1997). *The NURBS Book*, 2nd ed. Springer.
- Przemieniecki, J. S. (1968). *Theory of Matrix Structural Analysis*. McGraw-Hill.
- Schek, H.-J. (1974). The force density method for form finding and computation of general networks. *Computer Methods in Applied Mechanics and Engineering* 3, 115–134.
- Taylor, R. L., Beresford, P. J. & Wilson, E. L. (1976). A non-conforming element for stress analysis. *International Journal for Numerical Methods in Engineering* 10, 1211–1219.
- Timoshenko, S. P. & Gere, J. M. (1961). *Theory of Elastic Stability*, 2nd ed. McGraw-Hill.
- Timoshenko, S. P. & Woinowsky-Krieger, S. (1959). *Theory of Plates and Shells*, 2nd ed. McGraw-Hill.
- Wilson, E. L., Taylor, R. L., Doherty, W. P. & Ghaboussi, J. (1973). Incompatible displacement models. In *Numerical and Computer Methods in Structural Mechanics*, Academic Press, 43–57.
