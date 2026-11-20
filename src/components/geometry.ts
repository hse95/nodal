/**
 * Component library, part 2: curves, surfaces, solids, meshes, transforms and display.
 */
import { P, formatValue } from '../core/graph';
import { DataTree } from '../core/tree';
import { C, num, int, pt, vec, pln } from './basic';
import { V3, v, add, sub, mul, unit, len, dist, isV3, Plane, isPlane, WORLD_XY, Z, O, X, Xform, xTranslate, xRotate, xScale, xMirror, xOrient, xMul, xPoint, xVector, xPlane, planePoint, planeCoords, lerp, cross, dot } from '../geom/vec';
import * as cv from '../geom/curve';
import * as sf from '../geom/surface';
import * as ms from '../geom/mesh';

const crv = (n: string, d: string, o: any = {}) => P(n, 'curve', d, { nick: 'C', ...o });
const srf = (n: string, d: string, o: any = {}) => P(n, 'surface', d, { nick: 'S', ...o });
const msh = (n: string, d: string, o: any = {}) => P(n, 'mesh', d, { nick: 'M', ...o });
const geo = (n: string, d: string, o: any = {}) => P(n, 'geometry', d, { nick: 'G', ...o });

/** Display wrapper: geometry with a colour, text tags and dimensions are drawn by the viewport. */
export interface Styled { k: 'styled'; g: any; color: string }
export interface Tag { k: 'tag'; p: V3; text: string; size: number; color?: string }

/** Apply an affine transform to any geometry value. */
export function xformGeom(g: any, m: Xform): any {
  if (isV3(g)) return xPoint(m, g);
  if (isPlane(g)) return xPlane(m, g);
  if (cv.isCurve(g)) return cv.xformCurve(g, m);
  if (sf.isSurface(g)) return sf.xformSurface(g, m);
  if (ms.isMesh(g)) return ms.xformMesh(g, m);
  if (g && g.k === 'styled') return { ...g, g: xformGeom(g.g, m) };
  if (g && g.k === 'tag') return { ...g, p: xPoint(m, g.p) };
  if (Array.isArray(g)) return g.map(x => xformGeom(x, m));
  throw new Error(`Cannot transform ${formatValue(g)}`);
}
export function toMesh(g: any, density = 12): ms.Mesh {
  if (ms.isMesh(g)) return g;
  if (sf.isSurface(g)) return sf.surfaceToMesh(g, density, density);
  throw new Error(`Expected a mesh or surface, got ${formatValue(g)}`);
}

// ======================================================================= Curves
C('crv.line', 'Line', 'Ln', 'Curve', 'A straight line between two points.', [pt('A', 'Start point', null), pt('B', 'End point', null)], [crv('Line', 'The line', { nick: 'L' })], ([a, b]) => { if (dist(a, b) < 1e-12) throw new Error('The two points coincide'); return [cv.line(a, b)]; }, { example: 'Two points -> Line -> Beam' });
C('crv.linesdl', 'Line SDL', 'SDL', 'Curve', 'A line from a start point, a direction and a length.', [pt('Start', 'Start point', O, { nick: 'S' }), vec('Direction', 'Direction', Z, { nick: 'D' }), num('Length', 'Length', 1, { nick: 'L' })], [crv('Line', 'The line', { nick: 'L' })], ([s, d, l]) => [cv.line(s, add(s, mul(unit(d), l)))], { example: 'Column: base point, Unit Z, storey height' });
C('crv.polyline', 'Polyline', 'PLine', 'Curve', 'Straight segments through a list of points.', [P('Vertices', 'point', 'Points in order', { list: true, nick: 'V' }), P('Closed', 'boolean', 'Join the last point back to the first', { d: false, nick: 'C' })], [crv('Polyline', 'The polyline', { nick: 'Pl' })], ([p, c]) => { if (p.length < 2) throw new Error('A polyline needs at least two points'); return [cv.polyline(p, c)]; });
C('crv.arc', 'Arc', 'Arc', 'Curve', 'A circular arc in a plane, from a start angle to an end angle (radians).', [pln('Plane', 'Plane of the arc (centre at its origin)', { nick: 'P' }), num('Radius', 'Radius', 1, { nick: 'R' }), P('Angle', 'domain', 'Start and end angle in radians', { d: { k: 'domain', a: 0, b: Math.PI }, nick: 'A' })], [crv('Arc', 'The arc', { nick: 'A' }), num('Length', 'Arc length', undefined, { nick: 'L' })],
  ([p, r, a]) => { const c: cv.Arc = { k: 'arc', plane: p, r, a0: Math.min(a.a, a.b), a1: Math.max(a.a, a.b) }; return [c, cv.curveLength(c)]; });
C('crv.arc3', 'Arc 3Pt', 'Arc3', 'Curve', 'The arc from A through B to C.', [pt('A', 'Start point', null), pt('B', 'Point on the arc', null), pt('C', 'End point', null)], [crv('Arc', 'The arc', { nick: 'A' }), num('Radius', 'Radius', undefined, { nick: 'R' })], ([a, b, c]) => { const r = cv.arc3(a, b, c); return [r, r.r]; }, { example: 'Arch through springing points and crown' });
C('crv.circle', 'Circle', 'Cir', 'Curve', 'A circle in a plane.', [pln('Plane', 'Plane of the circle (centre at its origin)', { nick: 'P' }), num('Radius', 'Radius', 1, { nick: 'R' })], [crv('Circle', 'The circle', { nick: 'C' })], ([p, r]) => { if (r <= 0) throw new Error('Radius must be positive'); return [cv.circle(p, r)]; });
C('crv.rectangle', 'Rectangle', 'Rec', 'Curve', 'A rectangle centred on a plane.', [pln('Plane', 'Plane (centre at its origin)', { nick: 'P' }), num('X Size', 'Width along the plane X axis', 2, { nick: 'X' }), num('Y Size', 'Height along the plane Y axis', 1, { nick: 'Y' })], [crv('Rectangle', 'Closed polyline', { nick: 'R' }), num('Length', 'Perimeter', undefined, { nick: 'L' })], ([p, a, b]) => [cv.rectangle(p, a, b), 2 * (a + b)]);
C('crv.polygon', 'Polygon', 'Poly', 'Curve', 'A regular polygon.', [pln('Plane', 'Plane (centre at its origin)', { nick: 'P' }), num('Radius', 'Distance from the centre to the corners', 1, { nick: 'R' }), int('Segments', 'Number of sides', 6, { nick: 'S' })], [crv('Polygon', 'Closed polyline', { nick: 'P' })], ([p, r, n]) => [cv.polygon(p, r, Math.max(3, n))]);
C('crv.interp', 'Interpolate', 'IntCrv', 'Curve', 'A smooth NURBS curve that passes through the points.', [P('Vertices', 'point', 'Points to pass through', { list: true, nick: 'V' }), int('Degree', 'Curve degree (1 to 5)', 3, { nick: 'D' })], [crv('Curve', 'The curve'), num('Length', 'Curve length', undefined, { nick: 'L' })], ([p, d]) => { const c = cv.interpolateCurve(p, Math.min(5, Math.max(1, d))); return [c, cv.curveLength(c)]; }, { example: 'Interpolate through arch points' });
C('crv.nurbs', 'Nurbs Curve', 'Nurbs', 'Curve', 'A NURBS curve shaped by control points (the curve only touches the first and last).', [P('Vertices', 'point', 'Control points', { list: true, nick: 'V' }), int('Degree', 'Curve degree (1 to 5)', 3, { nick: 'D' }), P('Weights', 'number', 'Optional control-point weights', { list: true, opt: true, nick: 'W' })], [crv('Curve', 'The curve'), num('Length', 'Curve length', undefined, { nick: 'L' })],
  ([p, d, w]) => { if (p.length < 2) throw new Error('At least two control points are needed'); const c = cv.nurbsFromControlPoints(p, Math.min(5, Math.max(1, d)), w && w.length === p.length ? w : undefined); return [c, cv.curveLength(c)]; });
C('crv.divide', 'Divide Curve', 'Divide', 'Curve', 'Splits a curve into N equal-length pieces and returns the division points.', [crv('Curve', 'Curve to divide'), int('Count', 'Number of segments', 10, { nick: 'N' })], [P('Points', 'point', 'Division points', { list: true, nick: 'P' }), P('Tangents', 'vector', 'Tangent at each point', { list: true, nick: 'T' }), P('Parameters', 'number', 'Curve parameter (0 to 1) at each point', { list: true, nick: 't' })],
  ([c, n]) => { const ts = cv.divideByCount(c, Math.max(1, n)); return [ts.map(t => cv.curvePoint(c, t)), ts.map(t => cv.curveTangent(c, t)), ts]; }, { example: 'Divide a bottom chord into panel points' });
C('crv.dividelength', 'Divide Length', 'DivLen', 'Curve', 'Marks points along a curve at a fixed spacing.', [crv('Curve', 'Curve to divide'), num('Length', 'Spacing along the curve', 1, { nick: 'L' })], [P('Points', 'point', 'Division points', { list: true, nick: 'P' }), P('Parameters', 'number', 'Curve parameter at each point', { list: true, nick: 't' })], ([c, l]) => { const ts = cv.divideByLength(c, l); return [ts.map(t => cv.curvePoint(c, t)), ts]; });
C('crv.eval', 'Evaluate Curve', 'Eval', 'Curve', 'Point and tangent at a parameter between 0 (start) and 1 (end).', [crv('Curve', 'A curve'), num('Parameter', 'Position from 0 to 1', 0.5, { nick: 't' })], [pt('Point', 'Point on the curve', null, { nick: 'P' }), vec('Tangent', 'Unit tangent', undefined, { nick: 'T' })], ([c, t]) => [cv.curvePoint(c, t), cv.curveTangent(c, t)]);
C('crv.ends', 'End Points', 'End', 'Curve', 'Start and end points of a curve.', [crv('Curve', 'A curve')], [pt('Start', 'Start point', null, { nick: 'S' }), pt('End', 'End point', null, { nick: 'E' })], ([c]) => [cv.curveStart(c), cv.curveEnd(c)]);
C('crv.closest', 'Curve Closest Point', 'CrvCP', 'Curve', 'The point on a curve nearest to a given point.', [pt('Point', 'Point to project', null, { nick: 'P' }), crv('Curve', 'A curve')], [pt('Point', 'Closest point on the curve', null, { nick: 'P' }), num('Parameter', 'Curve parameter there', undefined, { nick: 't' }), num('Distance', 'Distance to the curve', undefined, { nick: 'D' })], ([p, c]) => { const r = cv.curveClosestPoint(c, p); return [r.point, r.t, r.dist]; });
C('crv.offset', 'Offset Curve', 'Offset', 'Curve', 'A parallel copy of a planar curve at a distance (positive is to the right of the curve direction, seen along the plane normal). Self-intersections are not trimmed.', [crv('Curve', 'Planar curve'), num('Distance', 'Offset distance', 1, { nick: 'D' }), pln('Plane', 'Plane of the offset', { nick: 'P' })], [crv('Curve', 'Offset curve')], ([c, d, p]) => [cv.offsetCurve(c, d, p)]);
C('crv.fillet', 'Fillet', 'Fillet', 'Curve', 'Rounds the corners of a polyline with arcs of a given radius.', [crv('Curve', 'Polyline'), num('Radius', 'Fillet radius', 0.5, { nick: 'R' })], [crv('Curve', 'Filleted curve')], ([c, r]) => { if (c.k !== 'polyline' && c.k !== 'line') throw new Error('Fillet works on polylines'); return [cv.filletPolyline(c, r)]; });
C('crv.join', 'Join Curves', 'Join', 'Curve', 'Joins curves whose ends meet into longer curves.', [P('Curves', 'curve', 'Curves to join', { list: true, nick: 'C' }), num('Tolerance', 'How close ends must be', 1e-6, { nick: 'T' })], [P('Curves', 'curve', 'Joined curves', { list: true, nick: 'C' })], ([c, t]) => [cv.joinCurves(c, t)]);
C('crv.explode', 'Explode', 'Explode', 'Curve', 'Breaks a polyline or joined curve into its segments.', [crv('Curve', 'Curve to explode')], [P('Segments', 'curve', 'The pieces', { list: true, nick: 'S' }), P('Vertices', 'point', 'End points of the pieces', { list: true, nick: 'V' })],
  ([c]) => { const segs = cv.explodeCurve(c); return [segs, [cv.curveStart(segs[0]), ...segs.map(cv.curveEnd)]]; }, { example: 'Explode a polyline into separate members' });
C('crv.extend', 'Extend Curve', 'Ext', 'Curve', 'Lengthens a curve in a straight line at its start and/or end.', [crv('Curve', 'A curve'), num('Start', 'Extra length at the start', 0, { nick: 'L0' }), num('End', 'Extra length at the end', 1, { nick: 'L1' })], [crv('Curve', 'Extended curve')], ([c, a, b]) => [cv.extendCurve(c, a, b)]);
C('crv.shatter', 'Shatter', 'Shatter', 'Curve', 'Splits a curve at the given parameters (0 to 1).', [crv('Curve', 'A curve'), P('Parameters', 'number', 'Where to split', { list: true, nick: 't' })], [P('Segments', 'curve', 'The pieces', { list: true, nick: 'S' })], ([c, t]) => [cv.shatter(c, t)]);
C('crv.subcurve', 'Sub Curve', 'SubCrv', 'Curve', 'The part of a curve between two parameters.', [crv('Curve', 'A curve'), P('Domain', 'domain', 'Start and end parameter (0 to 1)', { d: { k: 'domain', a: 0, b: 0.5 }, nick: 'D' })], [crv('Curve', 'The piece')], ([c, d]) => [cv.subCurve(c, Math.min(d.a, d.b), Math.max(d.a, d.b))]);
C('crv.ccx', 'Curve | Curve', 'CCX', 'Curve', 'Intersection points of two curves.', [crv('A', 'First curve', { nick: 'A' }), crv('B', 'Second curve', { nick: 'B' }), num('Tolerance', 'Largest gap that still counts as touching', 1e-6, { nick: 'T' })], [P('Points', 'point', 'Intersection points', { list: true, nick: 'P' }), P('tA', 'number', 'Parameters on A', { list: true }), P('tB', 'number', 'Parameters on B', { list: true })],
  ([a, b, t]) => { const h = cv.curveCurveIntersect(a, b, t); return [h.map(x => x.point), h.map(x => x.t1), h.map(x => x.t2)]; });
C('crv.length', 'Curve Length', 'Len', 'Curve', 'Length of a curve.', [crv('Curve', 'A curve')], [num('Length', 'The length', undefined, { nick: 'L' })], ([c]) => [cv.curveLength(c)], { noPreview: true });
C('crv.curvature', 'Curvature', 'Curv', 'Curve', 'Curvature (1/radius) of a curve at a parameter, with the centre of the touching circle.', [crv('Curve', 'A curve'), num('Parameter', 'Position from 0 to 1', 0.5, { nick: 't' })], [num('Curvature', '1 / radius', undefined, { nick: 'K' }), pt('Centre', 'Centre of curvature', null, { nick: 'C' })], ([c, t]) => { const r = cv.curveCurvature(c, t); return [r.k, r.centre]; });
C('crv.flip', 'Flip Curve', 'Flip', 'Curve', 'Reverses the direction of a curve.', [crv('Curve', 'A curve')], [crv('Curve', 'Reversed curve')], ([c]) => [cv.reverseCurve(c)]);
C('crv.topolyline', 'Curve To Polyline', 'ToPoly', 'Curve', 'Approximates a curve with N straight segments of equal length along the curve.', [crv('Curve', 'A curve'), int('Segments', 'Number of segments', 16, { nick: 'N' })], [crv('Polyline', 'The polyline', { nick: 'P' }), P('Vertices', 'point', 'Its vertices', { list: true, nick: 'V' })],
  ([c, n]) => { const closed = cv.curveClosed(c), pts = cv.divideByCount(c, Math.max(1, n)).map(t => cv.curvePoint(c, t)); return [cv.polyline(pts, closed), pts]; }, { example: 'Curved arch -> straight beam elements' });
C('crv.cps', 'Control Points', 'CP', 'Curve', 'Control points (or vertices) of a curve.', [crv('Curve', 'A curve')], [P('Points', 'point', 'Control points', { list: true, nick: 'P' })], ([c]) => [c.k === 'nurbs' ? c.cps : c.k === 'polyline' ? c.pts : cv.curveToPoints(c)]);

// ======================================================================= Surfaces and solids
C('srf.plane', 'Plane Surface', 'PlSrf', 'Surface', 'A rectangular surface in a plane, starting at the plane origin.', [pln('Plane', 'Base plane', { nick: 'P' }), num('X Size', 'Size along the plane X axis', 4, { nick: 'X' }), num('Y Size', 'Size along the plane Y axis', 3, { nick: 'Y' })], [srf('Surface', 'The surface')], ([p, a, b]) => [sf.planeSurface(p, a, b)], { example: 'Plane Surface -> Shell for a floor slab' });
C('srf.4pt', '4Point Surface', 'Srf4', 'Surface', 'A surface through four corner points given in order around the edge. If the corners are not in one plane the result is a hyperbolic paraboloid (hypar).', [pt('A', 'First corner', null), pt('B', 'Second corner', null), pt('C', 'Third corner', null), pt('D', 'Fourth corner', null)], [srf('Surface', 'The surface')], ([a, b, c, d]) => [sf.fourPointSurface(a, b, c, d)], { example: 'Raise two opposite corners to make a hypar roof' });
C('srf.loft', 'Loft', 'Loft', 'Surface', 'A surface through a series of section curves (interpolated).', [P('Curves', 'curve', 'Section curves in order', { list: true, nick: 'C' }), int('Samples', 'Sample points per section', 16, { nick: 'N' })], [srf('Surface', 'The loft')], ([c, n]) => [sf.loft(c, Math.max(2, n))], { example: 'Loft between two arches for a barrel vault' });
C('srf.sweep', 'Sweep', 'Sweep', 'Surface', 'Moves a profile curve along a rail curve without twisting.', [crv('Rail', 'Path curve', { nick: 'R' }), crv('Profile', 'Section curve, drawn at the start of the rail', { nick: 'S' })], [srf('Surface', 'The sweep')], ([r, s]) => [sf.sweep(r, s)]);
C('srf.extrude', 'Extrude', 'Extr', 'Surface', 'Extrudes a curve along a vector into a surface.', [crv('Curve', 'Profile curve'), vec('Direction', 'Extrusion vector', Z, { nick: 'D' })], [srf('Surface', 'The extrusion')], ([c, d]) => [sf.extrudeCurve(c, d)], { example: 'Extrude a line upward to make a wall' });
C('srf.revolve', 'Revolve', 'Rev', 'Surface', 'Revolves a profile curve about an axis.', [crv('Profile', 'Curve to revolve'), pt('Origin', 'Point on the axis', O, { nick: 'O' }), vec('Axis', 'Axis direction', Z, { nick: 'A' }), num('Angle', 'Sweep angle in radians', 2 * Math.PI, { nick: 'An' })], [srf('Surface', 'Surface of revolution')], ([c, o, a, an]) => [sf.revolve(c, o, a, an)], { example: 'Revolve an arc to make a dome' });
C('srf.frompoints', 'Surface From Points', 'SrfGrid', 'Surface', 'A smooth surface through a rectangular grid of points (row by row).', [P('Points', 'point', 'Grid points, row after row', { list: true, nick: 'P' }), int('U Count', 'Points per row', 4, { nick: 'U' })], [srf('Surface', 'The surface')],
  ([p, u]) => { const n = Math.max(2, u), rows: V3[][] = []; for (let i = 0; i + n <= p.length; i += n) rows.push(p.slice(i, i + n)); return [sf.surfaceFromGrid(rows)]; });
C('srf.divide', 'Divide Surface', 'SDivide', 'Surface', 'A grid of points on a surface. Each row (constant V) is a branch.', [srf('Surface', 'A surface'), int('U Count', 'Segments along U', 10, { nick: 'U' }), int('V Count', 'Segments along V', 10, { nick: 'V' })], [P('Points', 'point', 'Grid points', { tree: true, nick: 'P' }), P('Normals', 'vector', 'Surface normals', { tree: true, nick: 'N' })], null,
  { solveTrees: ([s, nu, nv]) => { const pts = new DataTree<V3>(), nrm = new DataTree<V3>(); const U = Math.max(1, Number(nu.first() ?? 10)), V = Math.max(1, Number(nv.first() ?? 10)); s.allItems().forEach((surf: any, k) => { for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) { pts.add([k, j], [sf.srfPoint(surf, i / U, j / V)]); nrm.add([k, j], [sf.srfNormal(surf, i / U, j / V)]); } }); return [s.dataCount === 1 ? pts.simplify() : pts, s.dataCount === 1 ? nrm.simplify() : nrm]; } });
C('srf.eval', 'Evaluate Surface', 'EvalS', 'Surface', 'Point and normal at parameters (U, V), each between 0 and 1.', [srf('Surface', 'A surface'), num('U', 'First parameter', 0.5), num('V', 'Second parameter', 0.5)], [pt('Point', 'Point on the surface', null, { nick: 'P' }), vec('Normal', 'Unit normal', undefined, { nick: 'N' })], ([s, a, b]) => [sf.srfPoint(s, a, b), sf.srfNormal(s, a, b)]);
C('srf.iso', 'Iso Curve', 'Iso', 'Surface', 'The curve on a surface at a constant U and at a constant V.', [srf('Surface', 'A surface'), num('U', 'U parameter (0 to 1)', 0.5), num('V', 'V parameter (0 to 1)', 0.5)], [crv('At U', 'Curve at constant U', { nick: 'U' }), crv('At V', 'Curve at constant V', { nick: 'V' })], ([s, a, b]) => [sf.isoCurve(s, 'u', a), sf.isoCurve(s, 'v', b)]);
C('srf.offset', 'Offset Surface', 'OffS', 'Surface', 'A copy of a surface moved along its normals (approximate).', [srf('Surface', 'A surface'), num('Distance', 'Offset distance', 0.1, { nick: 'D' })], [srf('Surface', 'Offset surface')], ([s, d]) => [sf.offsetSurface(s, d)]);
C('solid.box', 'Box', 'Box', 'Surface', 'A box solid with one corner at the plane origin.', [pln('Plane', 'Base plane', { nick: 'P' }), num('X', 'Size along X', 1), num('Y', 'Size along Y', 1), num('Z', 'Size along Z', 1)], [P('Box', 'brep', 'The solid', { nick: 'B' })], ([p, a, b, c]) => [ms.meshBox(p, a, b, c)]);
C('solid.sphere', 'Sphere', 'Sph', 'Surface', 'A sphere solid.', [pt('Centre', 'Centre point', O, { nick: 'C' }), num('Radius', 'Radius', 1, { nick: 'R' })], [P('Sphere', 'brep', 'The solid', { nick: 'S' })], ([o, r]) => [ms.meshSphere(o, r)]);
C('solid.cylinder', 'Cylinder', 'Cyl', 'Surface', 'A cylinder solid standing on a plane.', [pln('Plane', 'Base plane', { nick: 'P' }), num('Radius', 'Radius', 0.5, { nick: 'R' }), num('Height', 'Height', 2, { nick: 'H' })], [P('Cylinder', 'brep', 'The solid', { nick: 'C' })], ([p, r, h]) => [ms.meshCylinder(p, r, h)]);
C('solid.extrude', 'Extrude Solid', 'ExtrS', 'Surface', 'Extrudes a closed planar curve into a capped solid.', [crv('Curve', 'Closed profile'), vec('Direction', 'Extrusion vector', Z, { nick: 'D' })], [P('Solid', 'brep', 'The solid', { nick: 'S' })], ([c, d]) => [ms.extrudeSolid(c, d)]);
C('solid.cap', 'Cap Holes', 'Cap', 'Surface', 'Closes the open edges of a mesh or surface with flat caps.', [P('Body', 'brep', 'Open surface or mesh', { nick: 'B' })], [P('Solid', 'brep', 'Capped body', { nick: 'S' })], ([b]) => [ms.capMesh(toMesh(b, 24))]);
C('solid.decon', 'Deconstruct Brep', 'DeBrep', 'Surface', 'Faces, edges and vertices of a body.', [P('Body', 'brep', 'A solid or surface', { nick: 'B' })], [P('Faces', 'mesh', 'Faces', { list: true, nick: 'F' }), P('Edges', 'curve', 'Edges', { list: true, nick: 'E' }), P('Vertices', 'point', 'Corner points', { list: true, nick: 'V' })],
  ([b]) => { const m = ms.weld(toMesh(b), 1e-9); return [ms.explodeMesh(m), ms.meshEdges(m).map(([i, j]) => cv.line(ms.mv(m, i), ms.mv(m, j))), ms.meshVertices(m)]; });
C('solid.props', 'Area And Volume', 'AV', 'Surface', 'Surface area and enclosed volume of a body.', [P('Body', 'brep', 'A solid, surface or mesh', { nick: 'B' })], [num('Area', 'Surface area', undefined, { nick: 'A' }), num('Volume', 'Enclosed volume (closed bodies only)', undefined, { nick: 'V' })], ([b]) => { const m = toMesh(b, 24); return [ms.meshArea(m), Math.abs(ms.meshVolume(m))]; }, { noPreview: true });

// Mesh booleans through Manifold (WebAssembly, loaded on first use).
let manifoldPromise: Promise<any> | null = null;
async function manifold(): Promise<any> {
  manifoldPromise ??= (async () => {
    const mod = await import('manifold-3d');
    const inBrowser = typeof window !== 'undefined' || typeof (globalThis as any).importScripts === 'function';
    const opts: any = {};
    if (inBrowser) { const url = (await import('manifold-3d/manifold.wasm?url')).default; opts.locateFile = () => url; }
    const wasm = await (mod.default as any)(opts);
    wasm.setup();
    return wasm;
  })();
  return manifoldPromise;
}
export async function meshBoolean(a: ms.Mesh, b: ms.Mesh, op: 'union' | 'difference' | 'intersection'): Promise<ms.Mesh> {
  const wasm = await manifold();
  const toM = (m: ms.Mesh) => {
    const t = ms.triangulate(ms.weld(m, 1e-9));
    const mesh = new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(t.v), triVerts: Uint32Array.from(t.f.flat()) });
    mesh.merge();
    try { return new wasm.Manifold(mesh); } catch { throw new Error('A boolean needs closed solids (watertight meshes). Use Cap Holes first, or check for gaps.'); }
  };
  const ma = toM(a), mb = toM(b);
  const r = op === 'union' ? ma.add(mb) : op === 'difference' ? ma.subtract(mb) : ma.intersect(mb);
  const out = r.getMesh(), f: number[][] = [];
  for (let i = 0; i < out.triVerts.length; i += 3) f.push([out.triVerts[i], out.triVerts[i + 1], out.triVerts[i + 2]]);
  const vs: number[] = [];
  for (let i = 0; i < out.vertProperties.length; i += out.numProp) vs.push(out.vertProperties[i], out.vertProperties[i + 1], out.vertProperties[i + 2]);
  ma.delete(); mb.delete(); r.delete();
  return { k: 'mesh', v: vs, f, solid: true };
}
for (const [id, name, op, desc] of [['union', 'Solid Union', 'union', 'Merges two solids into one.'], ['difference', 'Solid Difference', 'difference', 'Cuts solid B out of solid A.'], ['intersection', 'Solid Intersection', 'intersection', 'Keeps only the volume shared by both solids.']] as [string, string, 'union' | 'difference' | 'intersection', string][]) {
  C(`solid.${id}`, name, name.split(' ')[1].slice(0, 5), 'Surface', `${desc} Works on closed bodies; the result is a triangulated solid.`, [P('A', 'brep', 'First solid'), P('B', 'brep', 'Second solid')], [P('Result', 'brep', 'Resulting solid', { nick: 'R' })], async ([a, b]) => [await meshBoolean(toMesh(a, 24), toMesh(b, 24), op)], { example: 'Box minus Cylinder' });
  C(`mesh.${id}`, name.replace('Solid', 'Mesh'), 'M' + name.split(' ')[1].slice(0, 4), 'Mesh', `${desc} Works on closed meshes.`, [msh('A', 'First mesh', { nick: 'A' }), msh('B', 'Second mesh', { nick: 'B' })], [msh('Result', 'Resulting mesh', { nick: 'R' })], async ([a, b]) => [await meshBoolean(a, b, op)]);
}

// ======================================================================= Meshes
C('mesh.surface', 'Mesh Surface', 'MSrf', 'Mesh', 'A quad mesh on a surface with U x V faces.', [srf('Surface', 'A surface'), int('U Count', 'Faces along U', 8, { nick: 'U' }), int('V Count', 'Faces along V', 8, { nick: 'V' })], [msh('Mesh', 'The mesh')], ([s, a, b]) => [ms.weld(sf.surfaceToMesh(s, Math.max(1, a), Math.max(1, b)), 1e-9)], { example: 'Mesh Surface -> Shell elements' });
C('mesh.surfacesize', 'Mesh Surface By Size', 'MSize', 'Mesh', 'A quad mesh on a surface with faces no longer than a target edge length.', [srf('Surface', 'A surface'), num('Size', 'Target edge length', 0.5, { nick: 'S' })], [msh('Mesh', 'The mesh')], ([s, h]) => { const [lu, lv] = sf.srfSize(s); return [ms.weld(sf.surfaceToMesh(s, Math.max(1, Math.ceil(lu / h)), Math.max(1, Math.ceil(lv / h))), 1e-9)]; });
C('mesh.construct', 'Construct Mesh', 'ConMesh', 'Mesh', 'A mesh from vertices and faces. Each face is text with 3 or 4 vertex indices, such as "0;1;2;3".', [P('Vertices', 'point', 'Mesh vertices', { list: true, nick: 'V' }), P('Faces', 'text', 'Faces as index lists', { list: true, nick: 'F' })], [msh('Mesh', 'The mesh')],
  ([p, f]) => [ms.meshFromPointsFaces(p, f.map((s: string) => { const idx = String(s).split(/[;,\s]+/).filter(x => x.length).map(Number); if (idx.length < 3 || idx.some(i => !(i >= 0 && i < p.length))) throw new Error(`Face "${s}" is not valid`); return idx; }))]);
C('mesh.grid', 'Mesh From Points', 'MGrid', 'Mesh', 'A quad mesh from a rectangular grid of points (row by row).', [P('Points', 'point', 'Grid points, row after row', { list: true, nick: 'P' }), int('U Count', 'Points per row', 4, { nick: 'U' })], [msh('Mesh', 'The mesh')], ([p, u]) => [ms.meshFromGrid(p, Math.max(2, u))]);
C('mesh.delaunay', 'Delaunay Mesh', 'Del', 'Mesh', 'A triangle mesh connecting scattered points, triangulated in a plane.', [P('Points', 'point', 'Points to connect', { list: true, nick: 'P' }), pln('Plane', 'Projection plane', { nick: 'Pl' })], [msh('Mesh', 'The mesh')], ([p, pl]) => [ms.meshFromPointsFaces(p, ms.delaunay(p, pl))]);
C('mesh.triangulate', 'Triangulate', 'Tri', 'Mesh', 'Splits every quad into two triangles.', [msh('Mesh', 'A mesh')], [msh('Mesh', 'Triangle mesh')], ([m]) => [ms.triangulate(m)]);
C('mesh.quadremesh', 'Quad Remesh', 'QRemesh', 'Mesh', 'Turns any mesh into all quads by splitting faces, and refines until edges are shorter than the target (a simple scheme, not a field-aligned remesher).', [msh('Mesh', 'A mesh'), num('Size', 'Target edge length (0 = one split only)', 0, { nick: 'S' })], [msh('Mesh', 'Quad mesh')], ([m, s]) => [ms.quadRemesh(m, s)]);
C('mesh.join', 'Mesh Join', 'MJoin', 'Mesh', 'Combines meshes into one and merges coincident vertices.', [P('Meshes', 'mesh', 'Meshes to join', { list: true, nick: 'M' }), num('Tolerance', 'Merge distance for vertices', 1e-6, { nick: 'T' })], [msh('Mesh', 'Joined mesh')], ([m, t]) => [ms.weld(ms.joinMeshes(m), t)]);
C('mesh.explode', 'Mesh Explode', 'MExpl', 'Mesh', 'Separates a mesh into one mesh per face.', [msh('Mesh', 'A mesh')], [P('Faces', 'mesh', 'Single-face meshes', { list: true, nick: 'F' })], ([m]) => [ms.explodeMesh(m)]);
C('mesh.decon', 'Deconstruct Mesh', 'DeMesh', 'Mesh', 'Vertices, faces, face centres and face normals of a mesh.', [msh('Mesh', 'A mesh')], [P('Vertices', 'point', 'Vertices', { list: true, nick: 'V' }), P('Faces', 'text', 'Faces as index lists', { list: true, nick: 'F' }), P('Centres', 'point', 'Face centres', { list: true, nick: 'C' }), P('Normals', 'vector', 'Face normals', { list: true, nick: 'N' })],
  ([m]) => [ms.meshVertices(m), m.f.map((f: number[]) => f.join(';')), m.f.map((f: number[]) => ms.faceCentre(m, f)), m.f.map((f: number[]) => ms.faceNormal(m, f))]);
C('mesh.naked', 'Naked Edges', 'Naked', 'Mesh', 'Edges that belong to only one face (the open boundary of a mesh).', [msh('Mesh', 'A mesh')], [P('Edges', 'curve', 'Boundary edges', { list: true, nick: 'E' })], ([m]) => [ms.nakedEdges(ms.weld(m, 1e-9))], { example: 'Naked edges -> edge beams or supports' });
C('mesh.edges', 'Mesh Edges', 'MEdges', 'Mesh', 'All edges of a mesh as lines (each edge once).', [msh('Mesh', 'A mesh')], [P('Edges', 'curve', 'Edge lines', { list: true, nick: 'E' })], ([m]) => { const w = ms.weld(m, 1e-9); return [ms.meshEdges(w).map(([i, j]) => cv.line(ms.mv(w, i), ms.mv(w, j)))]; }, { example: 'Mesh edges -> gridshell members' });

// ======================================================================= Transforms
const xf = (id: string, name: string, nick: string, desc: string, ins: any[], make: (args: any[]) => Xform, example?: string) =>
  C(`xform.${id}`, name, nick, 'Transform', desc, [geo('Geometry', 'Geometry to transform'), ...ins], [geo('Geometry', 'Transformed geometry'), P('Transform', 'transform', 'The transformation matrix', { nick: 'X' })], (a) => { const m = make(a.slice(1)); return [xformGeom(a[0], m), m]; }, { example });
xf('move', 'Move', 'Move', 'Moves geometry along a vector.', [vec('Motion', 'Translation vector', v(0, 0, 1), { nick: 'T' })], ([t]) => xTranslate(t), 'Move a truss chord up by the truss depth');
xf('rotate', 'Rotate', 'Rot', 'Rotates geometry about an axis.', [num('Angle', 'Angle in radians', Math.PI / 2, { nick: 'A' }), pt('Origin', 'Point on the axis', O, { nick: 'O' }), vec('Axis', 'Axis direction', Z, { nick: 'X' })], ([a, o, ax]) => xRotate(o, ax, a));
xf('scale', 'Scale', 'Scale', 'Scales geometry uniformly about a point.', [pt('Centre', 'Fixed point', O, { nick: 'C' }), num('Factor', 'Scale factor', 2, { nick: 'F' })], ([c, f]) => xScale(c, f));
xf('scalenu', 'Scale NU', 'ScaleNU', 'Scales geometry by different factors along X, Y and Z.', [pt('Centre', 'Fixed point', O, { nick: 'C' }), num('X', 'Factor along X', 1), num('Y', 'Factor along Y', 1), num('Z', 'Factor along Z', 2)], ([c, a, b, d]) => xScale(c, a, b, d));
xf('mirror', 'Mirror', 'Mirror', 'Reflects geometry through a plane.', [P('Plane', 'plane', 'Mirror plane', { d: { k: 'plane', o: O, x: v(0, 1, 0), y: Z, z: X }, nick: 'P' })], ([p]) => xMirror(p), 'Mirror half a frame about its centre plane');
xf('orient', 'Orient', 'Orient', 'Moves geometry from one plane to another.', [pln('Source', 'Plane to move from', { nick: 'A' }), pln('Target', 'Plane to move to', { nick: 'B' })], ([a, b]) => xOrient(a, b));
C('xform.apply', 'Transform', 'XForm', 'Transform', 'Applies a transformation matrix to geometry.', [geo('Geometry', 'Geometry to transform'), P('Transform', 'transform', 'Transformation matrix', { nick: 'X' })], [geo('Geometry', 'Transformed geometry')], ([g, m]) => [xformGeom(g, m)]);
C('xform.project', 'Project To Plane', 'Proj', 'Transform', 'Flattens geometry onto a plane.', [geo('Geometry', 'Geometry to project'), pln('Plane', 'Target plane', { nick: 'P' })], [geo('Geometry', 'Projected geometry')],
  ([g, p]: [any, Plane]) => { const n = p.z, d = dot(p.o, n); const m: Xform = [1 - n.x * n.x, -n.x * n.y, -n.x * n.z, d * n.x, -n.x * n.y, 1 - n.y * n.y, -n.y * n.z, d * n.y, -n.x * n.z, -n.y * n.z, 1 - n.z * n.z, d * n.z, 0, 0, 0, 1]; return [xformGeom(g, m)]; });
C('xform.arraylinear', 'Linear Array', 'ArrLin', 'Transform', 'Copies geometry N times along a vector.', [geo('Geometry', 'Geometry to copy'), vec('Direction', 'Step between copies', v(1, 0, 0), { nick: 'D' }), int('Count', 'Number of copies (including the original)', 5, { nick: 'N' })], [geo('Geometry', 'The copies', { list: true })], ([g, d, n]) => [Array.from({ length: Math.max(1, n) }, (_, i) => xformGeom(g, xTranslate(mul(d, i))))], { example: 'Array one frame along a building' });
C('xform.arraypolar', 'Polar Array', 'ArrPol', 'Transform', 'Copies geometry N times around an axis.', [geo('Geometry', 'Geometry to copy'), pln('Plane', 'Rotation plane (axis is its normal)', { nick: 'P' }), int('Count', 'Number of copies', 8, { nick: 'N' }), num('Angle', 'Total sweep in radians', 2 * Math.PI, { nick: 'A' })], [geo('Geometry', 'The copies', { list: true })],
  ([g, p, n, a]) => { const full = Math.abs(Math.abs(a) - 2 * Math.PI) < 1e-9, k = Math.max(1, n); return [Array.from({ length: k }, (_, i) => xformGeom(g, xRotate(p.o, p.z, a * i / (full ? k : Math.max(1, k - 1)))))]; }, { example: 'Ribs of a dome' });
C('xform.arraycurve', 'Curve Array', 'ArrCrv', 'Transform', 'Copies geometry along a curve, turning it to follow the curve.', [geo('Geometry', 'Geometry to copy (modelled at the curve start)'), crv('Curve', 'Path'), int('Count', 'Number of copies', 8, { nick: 'N' })], [geo('Geometry', 'The copies', { list: true })],
  ([g, c, n]) => { const closed = cv.curveClosed(c), k = Math.max(2, n), L = cv.curveLength(c), ts = cv.paramsAtLengths(c, Array.from({ length: k }, (_, i) => L * i / (closed ? k : k - 1))); const fr = (t: number): Plane => { const tan = cv.curveTangent(c, t); let x = cross(Z, tan); if (len(x) < 1e-9) x = X; x = unit(x); return { k: 'plane', o: cv.curvePoint(c, t), x, y: cross(tan, x), z: tan }; }; const base = fr(0); return [ts.map(t => xformGeom(g, xOrient(base, fr(t))))]; });
C('xform.morph', 'Surface Morph', 'SrfMorph', 'Transform', 'Maps geometry from a reference box onto a surface: X and Y of the box follow the surface U and V, Z follows the surface normal. Curves are mapped through their sample points (a simple morph).', [geo('Geometry', 'Geometry inside the reference box'), srf('Surface', 'Target surface'), P('Box Size', 'vector', 'Size of the reference box (X, Y, Z) starting at the origin', { d: v(1, 1, 1), nick: 'B' })], [geo('Geometry', 'Morphed geometry')],
  ([g, s, b]) => {
    const map = (p: V3): V3 => add(sf.srfPoint(s, p.x / b.x, p.y / b.y), mul(sf.srfNormal(s, Math.min(1, Math.max(0, p.x / b.x)), Math.min(1, Math.max(0, p.y / b.y))), p.z));
    const morph = (x: any): any => {
      if (isV3(x)) return map(x);
      if (cv.isCurve(x)) { const pts = x.k === 'line' ? sf.sampleCurve(x, 8) : cv.curveToPoints(x, 2); return x.k === 'polyline' ? cv.polyline(x.pts.map(map), x.closed) : cv.interpolateCurve(pts.map(map)); }
      if (ms.isMesh(x)) return ms.meshFromPointsFaces(ms.meshVertices(x).map(map), x.f);
      if (sf.isSurface(x)) return morph(sf.surfaceToMesh(x, 12, 12));
      throw new Error(`Cannot morph ${formatValue(x)}`);
    };
    return [morph(g)];
  });

// ======================================================================= Display
C('disp.preview', 'Custom Preview', 'Preview', 'Display', 'Shows geometry in a chosen colour.', [geo('Geometry', 'Geometry to show'), P('Colour', 'color', 'Display colour', { d: '#e4572e', nick: 'C' })], [geo('Geometry', 'The coloured geometry')], ([g, c]) => [{ k: 'styled', g, color: c }], { example: 'Colour members by utilisation with Gradient' });
C('disp.tag', 'Text Tag', 'Tag', 'Display', 'A text label at a point in the 3D view.', [pt('Location', 'Where to place the label', null, { nick: 'L' }), P('Text', 'text', 'Label text', { d: 'Label', nick: 'T' }), num('Size', 'Text size in pixels', 13, { nick: 'S' })], [geo('Tag', 'The label', { nick: 'T' })], ([p, t, s]) => [{ k: 'tag', p, text: t, size: s }]);
C('disp.dim', 'Dimension', 'Dim', 'Display', 'A dimension line between two points, labelled with the distance.', [pt('A', 'First point', null), pt('B', 'Second point', null), vec('Offset', 'Offset of the dimension line from the points', v(0, 0, 0.5), { nick: 'O' }), int('Decimals', 'Decimal places', 2, { nick: 'D' })], [geo('Dimension', 'The dimension', { list: true, nick: 'D' }), num('Distance', 'Measured distance', undefined, { nick: 'L' })],
  ([a, b, o, d]) => { const a2 = add(a, o), b2 = add(b, o), L = dist(a, b); return [[cv.line(a, a2), cv.line(b, b2), cv.line(a2, b2), { k: 'tag', p: lerp(a2, b2, 0.5), text: L.toFixed(Math.max(0, d)), size: 12 }], L]; });
/** Colour ramp used for gradients and result legends (blue - cyan - green - yellow - red). */
export function rampColor(t: number): string {
  const stops = [[38, 70, 160], [42, 157, 205], [78, 185, 120], [233, 196, 70], [222, 82, 55]];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `#${c.map(q => q.toString(16).padStart(2, '0')).join('')}`;
}
C('disp.gradient', 'Gradient', 'Grad', 'Display', 'Turns a number into a colour on a blue-to-red scale.', [num('Value', 'Value to colour', 0.5, { nick: 't' }), P('Domain', 'domain', 'Values mapped to the two ends of the scale', { d: { k: 'domain', a: 0, b: 1 }, nick: 'D' })], [P('Colour', 'color', 'The colour', { nick: 'C' })], ([x, d]) => [rampColor(d.b === d.a ? 0 : (x - d.a) / (d.b - d.a))], { noPreview: true });
C('disp.rgb', 'Colour RGB', 'RGB', 'Display', 'A colour from red, green and blue values (0 to 255).', [int('R', 'Red', 228), int('G', 'Green', 87), int('B', 'Blue', 46)], [P('Colour', 'color', 'The colour', { nick: 'C' })], ([r, g, b]) => [`#${[r, g, b].map((q: number) => Math.min(255, Math.max(0, q)).toString(16).padStart(2, '0')).join('')}`], { noPreview: true });
C('disp.bbox', 'Bounding Box', 'BBox', 'Display', 'The smallest world-aligned box around geometry.', [geo('Geometry', 'Geometry to measure', { list: true })], [P('Box', 'brep', 'The box', { nick: 'B' }), pt('Min', 'Lowest corner', null), pt('Max', 'Highest corner', null), P('Size', 'vector', 'Box dimensions', { nick: 'S' })],
  ([g]) => { const pts = geometryPoints(g); if (!pts.length) throw new Error('No geometry to measure'); const lo = v(Infinity, Infinity, Infinity), hi = v(-Infinity, -Infinity, -Infinity); for (const p of pts) { lo.x = Math.min(lo.x, p.x); lo.y = Math.min(lo.y, p.y); lo.z = Math.min(lo.z, p.z); hi.x = Math.max(hi.x, p.x); hi.y = Math.max(hi.y, p.y); hi.z = Math.max(hi.z, p.z); } const s = sub(hi, lo); return [ms.meshBox({ ...WORLD_XY, o: lo }, s.x, s.y, s.z), lo, hi, s]; });
/** Representative points of any geometry (for bounding boxes and zoom-to-fit). */
export function geometryPoints(g: any): V3[] {
  if (g === null || g === undefined) return [];
  if (Array.isArray(g)) return g.flatMap(geometryPoints);
  if (isV3(g)) return [g];
  if (isPlane(g)) return [g.o];
  if (cv.isCurve(g)) return cv.curveToPoints(g);
  if (sf.isSurface(g)) return ms.meshVertices(sf.surfaceToMesh(g, 6, 6));
  if (ms.isMesh(g)) return ms.meshVertices(g);
  if (g.k === 'styled') return geometryPoints(g.g);
  if (g.k === 'tag') return [g.p];
  return [];
}
export { xVector, planeCoords, planePoint };
