/**
 * Icons for every component, and thumbnails for templates, examples and
 * benchmarks. All of them are drawn here, as line drawings on a 24 x 24 grid
 * (thumbnails: 48 x 32), in one small notation so that 250 icons stay short
 * and consistent. Each icon is a list of shapes separated by "|":
 *
 *   p <path>            line in the text color        a <path>   line in the accent color
 *   F <path>            accent outline, lightly filled f <path>   solid accent fill
 *   l x1 y1 x2 y2       line                           L ...      accent line
 *   c x y r             circle                         o x y r    accent circle
 *   C x y r             accent dot (filled)            d x y      small dot in the text color
 *   r x y w h [rx]      rectangle                      R ...      accent rectangle
 *   t x y size text     text                           T ...      accent text
 *
 * The accent color is the color of the component's category, set by the
 * element that shows the icon (CSS variable --ic).
 */

const I: Record<string, string> = {
  // ---- Params
  'param.slider': 'l 3 12 21 12|C 9 12 3.2',
  'param.toggle': 'r 3 7 18 10 5|C 16 12 3',
  'param.valuelist': 'r 4 4 16 16 2|l 8 9 16 9|L 8 12 16 12|l 8 15 13 15',
  'param.panel': 'r 3 4 18 16 2|L 3 8.5 21 8.5|l 6.5 12.5 14 12.5|l 6.5 16 17 16',
  'param.graph': 'r 3 3 18 18 2|a M5.5 18C11 18 10 6 18.5 6',
  'param.color': 'c 12 12 8.5|C 8.5 9.5 1.8|C 15.5 9.5 1.8|C 12 15.5 1.8',
  'param.note': 'p M5 4h14v11l-5 5H5z|a M19 15h-5v5',
  'param.file': 'p M6 3h8l4 4v14H6zM14 3v4h4|a M12 10v7M9 14l3 3 3-3',
  'param.number': 't 12 16.2 11 1.5',
  'param.integer': 't 12 16.2 11 123',
  'param.boolean': 't 12 16 9.5 T/F',
  'param.text': 't 12 16.5 13 Aa',
  'param.point': 'C 12 12 3|l 12 3 12 7|l 12 17 12 21|l 3 12 7 12|l 17 12 21 12',
  'param.vector': 'a M5 19L18.5 5.5M12 5.5h6.5V12|d 5 19',
  'param.plane': 'p M3 17l6-8h12l-6 8z|a M12 13V4',
  'param.curve': 'a M3 17C8 3 14 21 21 7',
  'param.surface': 'F M4 8c5-3 9 3 16 0v8c-7 3-11-3-16 0z',
  'param.mesh': 'p M4 18L12 5l8 13z|a M8 11.5h8l-4 6.5z',
  'param.brep': 'p M4 8v8l8 4 8-4V8|F M4 8l8-4 8 4-8 4z|p M12 12v8',
  'param.geometry': 'c 8 9 4.5|R 11 11 9.5 9.5 1',

  // ---- Math
  'math.add': 't 12 18.5 20 +', 'math.sub': 't 12 18.5 20 −', 'math.mul': 't 12 18.5 20 ×', 'math.div': 't 12 18.5 20 ÷',
  'math.neg': 't 12 16.5 13 −x', 'math.abs': 't 12 16.5 13 ∣x∣', 'math.sqrt': 't 12 16.5 13 √x',
  'math.sin': 't 12 16 10.5 sin', 'math.cos': 't 12 16 10.5 cos', 'math.tan': 't 12 16 10.5 tan',
  'math.asin': 't 12 15.5 8 asin', 'math.acos': 't 12 15.5 8 acos', 'math.atan': 't 12 15.5 8 atan', 'math.atan2': 't 12 15.5 7 atan2',
  'math.deg': 't 12 16 9.5 deg', 'math.rad': 't 12 16 9.5 rad', 'math.exp': 't 12 17 13 eˣ', 'math.ln': 't 12 16.5 12 ln', 'math.log10': 't 12 16 10 log',
  'math.pow': 't 12 17 13 xʸ', 'math.mod': 't 12 17.5 15 %', 'math.pi': 't 12 17.5 17 π',
  'math.min': 't 12 16 9.5 min', 'math.max': 't 12 16 9.5 max', 'math.sum': 't 12 18 17 Σ', 'math.avg': 't 12 16 9.5 avg',
  'math.bounds': 'p M7 5H4v14h3M17 5h3v14h-3|C 9.5 12 1.6|C 14.5 12 1.6',
  'math.expr': 't 12 16 10 f(x)',
  'math.domain': 'a M4 12h16|p M4 7v10M20 7v10',
  'math.dedomain': 'l 4 12 20 12|C 4 12 2.4|C 20 12 2.4',
  'math.remap': 'l 3 7 13 7|l 9 17 21 17|a M6 9l6 6M12 9l6 6',
  'math.range': 'l 3 12 21 12|C 4 12 1.8|C 9.3 12 1.8|C 14.6 12 1.8|C 20 12 1.8',
  'math.series': 'a M4 19h4v-4h4v-4h4V7h4',
  'math.random': 'r 4 4 16 16 3|C 8.5 8.5 1.4|C 15.5 15.5 1.4|C 12 12 1.4|C 15.5 8.5 1.4|C 8.5 15.5 1.4',
  'math.round': 't 12 16.5 11 ≈1', 'math.clamp': 'p M7 5H5v14h2M17 5h2v14h-2|L 9 12 15 12',
  'math.gt': 't 12 18 18 >', 'math.lt': 't 12 18 18 <', 'math.gte': 't 12 18 18 ≥', 'math.lte': 't 12 18 18 ≤', 'math.eq': 't 12 18 18 =', 'math.similar': 't 12 18 18 ≈',
  'math.and': 't 12 17.5 16 ∧', 'math.or': 't 12 17.5 16 ∨', 'math.xor': 'c 12 12 7.5|l 12 4.5 12 19.5|l 4.5 12 19.5 12', 'math.not': 't 12 17.5 16 ¬', 'math.pick': 't 12 16.5 12 ?:',

  // ---- Lists
  'list.item': 'l 5 7 19 7|L 5 12 19 12|l 5 17 19 17|C 5 12 1.6',
  'list.length': 'l 4 7 13 7|l 4 12 13 12|l 4 17 13 17|T 18 16 11 n',
  'list.reverse': 'a M8 20V4M5 7l3-3 3 3|p M16 4v16M13 17l3 3 3-3',
  'list.shift': 'l 5 8 14 8|l 5 13 14 13|l 5 18 14 18|a M19 5v13M16.5 15.5L19 18l2.5-2.5',
  'list.sort': 'l 4 6 9 6|l 4 12 13 12|l 4 18 17 18|a M20.5 5v8M18.5 11l2 2.5 2-2.5',
  'list.cullpattern': 'C 6 7 1.7|c 6 12 1.7|C 6 17 1.7|l 10 7 19 7|l 10 17 19 17',
  'list.cullindex': 'l 5 6 19 6|l 5 18 19 18|a M9 9.5l6 5M15 9.5l-6 5',
  'list.dispatch': 'p M3 12h6M9 12c5 0 4 6 12 6|a M9 12c5 0 4-6 12-6',
  'list.weave': 'a M3 6c8 0 7 6 12 6|p M3 18c8 0 7-6 12-6M15 12h6',
  'list.sublist': 'l 5 5 19 5|l 5 19 19 19|R 4 8.5 16 7 1.5|L 7 12 17 12',
  'list.duplicate': 'r 4 8 11 11 2|a M9 8V5h11v11h-5',
  'list.merge': 'p M3 5c8 0 6 7 12 7M3 19c8 0 6-7 12-7|a M3 12h18',
  'list.partition': 'l 5 5 14 5|l 5 9 14 9|l 5 15 14 15|l 5 19 14 19|a M17 4h2v6h-2M17 14h2v6h-2',
  'list.first': 'L 5 6 19 6|l 5 12 19 12|L 5 18 19 18',

  // ---- Trees
  'tree.flatten': 'C 5 6 1.7|C 5 12 1.7|C 5 18 1.7|a M8 6c5 0 4 6 7 6M8 18c5 0 4-6 7-6M8 12h7|d 19 12',
  'tree.graft': 'd 5 12|a M8 12c5 0 4-6 7-6M8 12c5 0 4 6 7 6M8 12h7|C 18.5 6 1.7|C 18.5 12 1.7|C 18.5 18 1.7',
  'tree.simplify': 't 12 16 10 {n}',
  'tree.reverse': 'p M12 21v-7M12 14L6 8M12 14l6-6|a M8 4h8M13.5 2l2.5 2-2.5 2',
  'tree.trim': 'p M12 21v-8M12 13L7 8M12 13l5-5|a M3 10.5h18',
  'tree.flip': 'r 4 4 16 16 1|l 4 12 20 12|l 12 4 12 20|a M7 17L17 7M12.5 7H17v4.5',
  'tree.branch': 'p M12 21v-7M12 14L6 8M12 14V6|a M12 14l6-6|C 18.5 7.5 1.9',
  'tree.pathmap': 't 12 15.5 7.5 {a;b}',
  'tree.stats': 'p M9 21v-7M9 14L4 8M9 14l5-6|T 18.5 19 10 #',

  // ---- Vector, planes, grids
  'vec.point': 'C 13 11 2.8|p M13 8V3M15.6 12.2L21 15M10.6 12.8L5 17',
  'vec.depoint': 'C 7 12 2.8|a M11 12h9M10.5 10l7-5M10.5 14l7 5',
  'vec.vector': 'a M5 19L18.5 5.5M12 5.5h6.5V12',
  'vec.devector': 'a M5 18L17 6M11 6h6v6|p M5 18h12M17 18v-3',
  'vec.unitx': 'p M7 16V4M7 16l7-6|a M7 16h13M17 13l3 3-3 3|T 13.5 8 7 X',
  'vec.unity': 'p M7 16V4M7 16h13|a M7 16l8-7M10.5 9H15v4.5|T 19 9 7 Y',
  'vec.unitz': 'p M7 16h13M7 16l7-6|a M7 16V3M4 6l3-3 3 3|T 14 7 7 Z',
  'vec.2pt': 'c 5 18.5 1.8|c 19 5.5 1.8|a M6.8 16.8L17 7M12.5 6.5h5v5',
  'vec.amp': 'a M4 16h14M15 13l3 3-3 3|p M4 8h16M4 6v4M20 6v4',
  'vec.unitize': 'a M5 18L14 9M9.5 8.5H14V13|T 18.5 19.5 9 1',
  'vec.length': 'a M5 19L19 5|p M3.2 17.2l3.6 3.6M17.2 3.2l3.6 3.6',
  'vec.reverse': 'a M4 9h14M15 6l3 3-3 3|p M20 15H6M9 12l-3 3 3 3',
  'vec.cross': 'p M5 19V8M5 19h12|a M5 19l9-8M10 10.5l4 .5-.5 4',
  'vec.dot': 'p M5 19l14-3M5 19l8-12|C 17 8 2',
  'vec.angle': 'p M4 19h16M4 19L16 6|a M12.5 19a8.5 8.5 0 0 0-2.8-6.3',
  'vec.distance': 'C 4.5 12 2|C 19.5 12 2|p M8 12h8M8 9.5v5M16 9.5v5',
  'vec.lerp': 'c 4.5 12 1.8|c 19.5 12 1.8|l 6.5 12 17.5 12|C 12 12 2.5',
  'plane.xy': 'F M3 17l6-8h12l-6 8z|T 12 15 6 XY',
  'plane.xz': 'F M5 20V8l13-4v12z|T 11.5 14.5 6 XZ',
  'plane.yz': 'F M19 20V8L6 4v12z|T 12.5 14.5 6 YZ',
  'plane.normal': 'p M3 18l6-7h12l-6 7z|a M12 14.5V4M9.5 6.5L12 4l2.5 2.5',
  'plane.3pt': 'p M3 17l6-8h12l-6 8z|C 7.5 15 1.6|C 11 11 1.6|C 17 13.5 1.6',
  'plane.decon': 'p M3 18l6-7h12l-6 7z|a M12 14.5V5M12 14.5l7 2.5M12 14.5l-7 3',
  'plane.eval': 'p M3 17l6-8h12l-6 8z|C 13 13 2.2',
  'grid.square': 'a M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
  'grid.hex': 'a M12 3l4 2.3v4.6L12 12.2 8 9.9V5.3zM8 9.9l-4 2.3v4.6l4 2.3 4-2.3M12 12.2v4.6l4 2.3 4-2.3v-4.6l-4-2.3',
  'grid.radial': 'o 12 12 8.5|o 12 12 4|l 12 3.5 12 20.5|l 3.5 12 20.5 12',

  // ---- Curve
  'crv.line': 'a M6 18L18 6|d 5.5 18.5|d 18.5 5.5',
  'crv.linesdl': 'd 5 19|a M5 19L18.5 5.5M12 5.5h6.5V12|p M8 20h7',
  'crv.polyline': 'a M3 17l5-9 5 6 4-9 4 6',
  'crv.arc': 'a M4 17a8 8 0 0 1 16 0|d 12 17',
  'crv.arc3': 'a M4 17a8.3 8.3 0 0 1 16 0|C 4 17 1.8|C 12 8.8 1.8|C 20 17 1.8',
  'crv.circle': 'o 12 12 8.5|d 12 12',
  'crv.rectangle': 'a M4 7h16v10H4z',
  'crv.polygon': 'a M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z',
  'crv.interp': 'a M3 16C6 6 9 6 12 12s6 6 9-5|C 3 16 1.6|C 12 12 1.6|C 21 7 1.6',
  'crv.nurbs': 'p M3 18L8 5h8l5 13|a M3 18C8 7 16 7 21 18|d 8 5|d 16 5',
  'crv.divide': 'p M3 16C8 4 16 4 21 16|C 3 16 1.7|C 7 9.6 1.7|C 12 7 1.7|C 17 9.6 1.7|C 21 16 1.7',
  'crv.dividelength': 'p M3 14C8 4 16 4 21 14|C 3 14 1.7|C 12 6.5 1.7|C 21 14 1.7|a M3 20h9M3 18v4M12 18v4',
  'crv.eval': 'p M3 17C8 3 15 5 21 14|C 10.5 7.6 2.2|a M10.5 7.6l8-.2',
  'crv.ends': 'p M4 17C9 3 15 21 20 7|C 4 17 2.3|C 20 7 2.3',
  'crv.closest': 'p M3 14C9 4 15 4 21 14|C 12 19 2|a M12 16.5V7',
  'crv.offset': 'p M3 14C8 4 16 4 21 14|a M3 20C8 10 16 10 21 20',
  'crv.fillet': 'p M5 3v8M13 19h8|a M5 11a8 8 0 0 0 8 8',
  'crv.join': 'p M3 17l8-9|a M13 8l8 9|C 12 7 2',
  'crv.explode': 'p M3 15l4-8M17 7l4 8|a M9.5 5h5',
  'crv.extend': 'p M3 16h9|a M12 16h8M17 13l3 3-3 3',
  'crv.shatter': 'p M3 16C8 4 16 4 21 16|a M6 7l3 4M18 7l-3 4',
  'crv.subcurve': 'p M3 16c1.5-4 3.5-6.6 6-8M15 8c2.5 1.4 4.5 4 6 8|a M9 8c2-1.2 4-1.2 6 0',
  'crv.ccx': 'p M3 18C9 16 15 8 21 6M3 6c6 2 12 10 18 12|C 12 12 2.3',
  'crv.length': 'a M3 14C8 4 16 4 21 14|p M3 19h18M3 17v4M21 17v4',
  'crv.curvature': 'p M3 7c6 13 12 13 18 0|o 12 10.5 5.5',
  'crv.flip': 'a M20 16C15 6 9 6 4 16M4 10.5V16h5.5',
  'crv.topolyline': 'p M3 16C8 2 16 2 21 16|a M3 16l4.5-8h9l4.5 8',
  'crv.cps': 'a M3 17C8 6 16 6 21 17|p M3 17L8 6h8l5 11|C 8 6 1.7|C 16 6 1.7',

  // ---- Surface and solids
  'srf.plane': 'F M3 17l6-9h12l-6 9z',
  'srf.4pt': 'F M4 17L8 6l12 2-3 11z|C 4 17 1.7|C 8 6 1.7|C 20 8 1.7|C 17 19 1.7',
  'srf.loft': 'a M4 7q8-5 16 0M4 12q8-5 16 0M4 17q8-5 16 0|p M4 7v10M20 7v10',
  'srf.sweep': 'p M5 17C9 8 14 16 19 7|o 5 17 2.6|o 19 7 2.6',
  'srf.extrude': 'F M4 20l4-4h12l-4 4z|a M12 15V4M9 7l3-3 3 3',
  'srf.revolve': 'l 12 3 12 21|a M12 6c6 2 6 10 0 12|p M7.5 4.5a6 2.2 0 0 0 9 0',
  'srf.frompoints': 'F M4 16l6-8h10l-6 8z|d 4 16|d 10 8|d 20 8|d 14 16|d 12 12',
  'srf.divide': 'p M3 17l6-9h12l-6 9z|C 8.5 14.5 1.4|C 13 14.5 1.4|C 11 11 1.4|C 15.5 11 1.4',
  'srf.eval': 'p M3 16c4-5 8-6 12-8l6 3c-4 2-8 3-12 8z|C 12 12.5 2|a M12 12.5V4',
  'srf.iso': 'p M3 17l6-9h12l-6 9z|a M8 17l6-9',
  'srf.offset': 'p M3 19l6-7h12l-6 7z|a M3 13l6-7h12l-6 7z',
  'solid.box': 'a M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  'solid.sphere': 'o 12 12 8.5|p M3.5 12c0 3.5 17 3.5 17 0',
  'solid.cylinder': 'a M5 7c0-3.5 14-3.5 14 0v10c0 3.5-14 3.5-14 0zM5 7c0 3.5 14 3.5 14 0',
  'solid.extrude': 'p M5 21v-8l3-2h11v8l-3 2zM5 13h11v8M16 13l3-2|a M11.5 9V2M9 4.5L11.5 2 14 4.5',
  'solid.cap': 'p M5 9v8c0 3.5 14 3.5 14 0V9|F M5 9c0-3.5 14-3.5 14 0s-14 3.5-14 0z',
  'solid.decon': 'p M4 14v4l8 4v-4zM20 14v4l-8 4|a M4 9l8-4 8 4-8 4z',
  'solid.props': 'p M4 8l8-4 8 4v8l-8 4-8-4z|T 12 15.5 8 m³',
  'solid.union': 'F M12 6.8A6 6 0 1 0 12 17.2 6 6 0 1 0 12 6.8z',
  'solid.difference': 'F M12 6.8A6 6 0 1 0 12 17.2 6 6 0 0 1 12 6.8z|c 15 12 6',
  'solid.intersection': 'c 9 12 6|c 15 12 6|f M12 6.8a6 6 0 0 1 0 10.4 6 6 0 0 1 0-10.4z',

  // ---- Mesh
  'mesh.union': 'F M4 4h11v5h5v11H9v-5H4z',
  'mesh.difference': 'F M4 4h11v5H9v6H4z|r 9 9 11 11',
  'mesh.intersection': 'r 4 4 11 11|r 9 9 11 11|f M9 9h6v6H9z',
  'mesh.surface': 'p M3 17l6-9h12l-6 9z|a M6 12.5h12M9 17l6-9',
  'mesh.surfacesize': 'p M3 15l6-9h12l-6 9z|a M6 10.5h12M9 15l6-9|p M3 20h6M3 18v4M9 18v4',
  'mesh.construct': 'F M4 18L12 5l8 13z|C 4 18 1.8|C 12 5 1.8|C 20 18 1.8',
  'mesh.grid': 'a M5 6h14v12H5zM5 12h14M12 6v12|d 5 6|d 12 6|d 19 6|d 5 12|d 12 12|d 19 12|d 5 18|d 12 18|d 19 18',
  'mesh.delaunay': 'a M4 16l5-10 4 7zM9 6l10 2-6 5M13 13l7 5-16-2M19 8l1 10',
  'mesh.triangulate': 'p M4 4h16v16H4z|a M4 20L20 4',
  'mesh.quadremesh': 'a M4 4h16v16H4zM4 12h16M12 4v16',
  'mesh.join': 'p M3 17l5-10 4 8|a M21 17l-5-10-5 10z',
  'mesh.explode': 'p M3 11l4-7 4 7zM8 21l4-7 4 7z|a M13 11l4-7 4 7z',
  'mesh.decon': 'p M4 18L12 5l8 13z|o 4 18 2|o 12 5 2|o 20 18 2',
  'mesh.naked': 'a M4 5h16v14H4z|l 4 12 20 12|l 12 5 12 19',
  'mesh.edges': 'a M4 18L12 5l8 13zM8 11.5h8l-4 6.5z',

  // ---- Transform
  'xform.move': 'r 3 12 8 8 1|a M10 11l8-7M13 4h5v5',
  'xform.rotate': 'r 8 9 8 8 1|a M4 10a9 9 0 0 1 15-4.5M19 2v3.6h-3.6',
  'xform.scale': 'r 4 12 8 8 1|a M9 4h11v11M20 4l-7 7',
  'xform.scalenu': 'r 4 13 7 7 1|a M4 9V5h16v15h-5',
  'xform.mirror': 'p M9 6v12H4z|a M15 6v12h5z|l 12 3 12 21',
  'xform.orient': 'p M4 20v-7M4 20h7|a M13 11V4M13 11h7|p M7.5 16.5l3-3',
  'xform.apply': 'p M7 4H4v16h3M17 4h3v16h-3|T 12 16 10 T',
  'xform.project': 'p M3 21l5-5h13l-5 5z|C 12 5 2|a M12 8v8M9.8 13.5L12 16l2.2-2.5',
  'xform.arraylinear': 'r 2.5 9 5 6 1|r 9.5 9 5 6 1|R 16.5 9 5 6 1',
  'xform.arraypolar': 'C 12 4.5 1.9|C 19 9.5 1.9|C 16.5 18 1.9|C 7.5 18 1.9|C 5 9.5 1.9|d 12 12',
  'xform.arraycurve': 'p M3 18C8 6 16 6 21 18|R 1.5 15 4 4 1|R 10 6.5 4 4 1|R 18.5 15 4 4 1',
  'xform.morph': 'p M3 19c5-5 13-5 18 0|R 9 6 6 6 1|a M9 12l-1.5 3M15 12l1.5 3',

  // ---- Display
  'disp.preview': 'p M2.5 12c3-5 6-7 9.5-7s6.5 2 9.5 7c-3 5-6 7-9.5 7s-6.5-2-9.5-7z|C 12 12 3',
  'disp.tag': 'p M3 12l8-8h9v9l-8 8z|C 16 8 1.7',
  'disp.dim': 'p M4 6v12M20 6v12|a M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3',
  'disp.gradient': 'r 3 8 18 8 2|f M3.8 8.8h5.4v6.4H3.8z|F M9.2 8.8h5.4v6.4H9.2z',
  'disp.rgb': 'c 12 8.5 5|c 8.5 14.5 5|o 15.5 14.5 5',
  'disp.bbox': 'p M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4|o 12 12 4',

  // ---- Structure
  'fe.material': 'r 4 4 16 16 2|a M4 10l6-6M4 16L16 4M8 20L20 8M14 20l6-6',
  'fe.material.custom': 'r 4 4 16 16 2|T 12 16.5 12 E',
  'fe.sec.rect': 'F M7 4h10v16H7z',
  'fe.sec.rhs': 'F M6 4h12v16H6zM9.5 7.5h5v9h-5z',
  'fe.sec.circle': 'F M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z',
  'fe.sec.tube': 'F M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  'fe.sec.i': 'F M5 4h14v3h-5.5v10H19v3H5v-3h5.5V7H5z',
  'fe.sec.channel': 'F M6 4h12v3H9.5v10H18v3H6z',
  'fe.sec.angle': 'F M6 4h3.5v12.5H18V20H6z',
  'fe.sec.generic': 'F M6 6c4-3 9-2 12 2 1 5-2 9-7 10-4-1-7-6-5-12z',
  'fe.sec.table': 'r 3 4 18 16 2|l 3 9.5 21 9.5|l 3 15 21 15|L 10 4 10 20',
  'fe.sec.props': 'p M3 5h9v2.5H9V17h3v2.5H3V17h3V7.5H3z|T 17.5 15 8 Iy',
  'fe.beam': 'F M3 9.5h18v5H3z|d 3 12|d 21 12',
  'fe.truss': 'a M3 18h18L12 6zM7.5 12h9',
  'fe.cable': 'd 3 6|d 21 6|a M3 6c4 13 14 13 18 0',
  'fe.release': 'F M3 10.2h12v3.6H3z|o 18.5 12 2.6',
  'fe.offset': 'C 4.5 17 2.2|p M4.5 17v-6H8|F M8 9h13v4H8z',
  'fe.shell': 'F M3 14c5-7 13-7 18 0v3.5c-5-7-13-7-18 0z',
  'fe.support': 'a M12 5l6 10H6z|p M4 17.5h16M6 21l2.5-3.5M11 21l2.5-3.5M16 21l2.5-3.5',
  'fe.support.disp': 'a M9 7l5 8H4z|p M3 17.5h12|a M19.5 5v13M17 15.5l2.5 2.5 2.5-2.5',
  'fe.support.spring': 'd 12 3|a M12 4v2l-4 2 8 3-8 3 8 3-4 1.5|p M5 21h14',
  'fe.load.point': 'a M12 3v14M7.5 12.5L12 17l4.5-4.5|p M4 20.5h16',
  'fe.load.line': 'a M4 5h16M5 5v9M12 5v9M19 5v9M3.5 12L5 14l1.5-2M10.5 12l1.5 2 1.5-2M17.5 12l1.5 2 1.5-2|p M3 18.5h18',
  'fe.load.gravity': 'p M7 9h10l2 11H5z|a M10 9a2 2 0 1 1 4 0|T 12 18 8 g',
  'fe.load.temp': 'p M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z|C 12 17 2|L 12 9 12 16',
  'fe.load.area': 'p M3 20l5-5h13l-5 5z|a M8 4v8M13 4v8M18 4v8M6.5 10L8 12l1.5-2M11.5 10l1.5 2 1.5-2M16.5 10l1.5 2 1.5-2',
  'fe.load.mesh': 'p M4 20l8-7 8 7z|a M12 3v7M9.5 7.5L12 10l2.5-2.5',
  'fe.load.combo': 't 12 10.5 8 1.2D|T 12 19.5 8 +1.6L',
  'fe.assemble': 'r 3 3 8 8 1.5|r 13 3 8 8 1.5|r 3 13 8 8 1.5|f M13 13h8v8h-8z',
  'fe.static': 'l 3 9 21 9|a M3 9c5 8 13 8 18 0|p M1.5 12.5L3 9l1.5 3.5zM19.5 12.5L21 9l1.5 3.5z',
  'fe.second': 'p M6 21h12|l 12 21 12 6|a M12 21C12 15 15 10 16 6|a M16 1.5v3.5M14.5 3.5L16 5l1.5-1.5',
  'fe.buckling': 'p M8 21h8M12 1.5v2.5|l 12 4 12 21|a M12 4c6 6 6 11 0 17',
  'fe.modal': 'l 3 12 21 12|a M3 12c3-9 6-9 9 0s6 9 9 0',
  'fe.nonlinear': 'p M4 4v16h16|a M4 20c3-10 8-13 15-13',
  'fe.sizing': 'p M3 13h5M5.5 13v6M3 19h5|a M11 6h9M15.5 6v13M11 19h9',
  'fe.view': 'r 3 4 18 13 2|p M9 21h6M12 17v4|a M6 13c2-6 4-6 6 0s4 4 6-3',
  'fe.res.disp': 'c 7 8 2.2|C 16 16 2.6|a M9 10l4.5 4M11 14.5h3v-3',
  'fe.res.at': 'p M3 8c5 9 13 9 18 0|o 12 14.5 3|a M12 9.5v2M12 17.5v2M7 14.5h2M15 14.5h2',
  'fe.res.react': 'p M7 9l4 6H3zM2 17.5h10|a M17.5 20V7M14.5 10l3-3 3 3',
  'fe.res.forces': 'l 3 9 21 9|F M3 9c5 10 13 10 18 0z',
  'fe.res.envelope': 'l 3 12 21 12|a M3 12c5 8 13 8 18 0M3 12c5-7 13-7 18 0',
  'fe.res.axial': 'F M8 10.2h8v3.6H8z|a M8 12H2M4.5 9.5L2 12l2.5 2.5M16 12h6M19.5 9.5L22 12l-2.5 2.5',
  'fe.res.util': 'p M4 17a8 8 0 0 1 16 0|a M12 17l4.5-6|C 12 17 1.8',
  'fe.res.shell': 'p M3 7c6-3 12-3 18 0v10c-6 3-12 3-18 0z|a M6.5 12c3.5-2.5 7.5-2.5 11 0|C 12 13.5 1.5',
  'fe.res.deformed': 'l 3 8 21 8|a M3 8c5 11 13 11 18 0',
  'fe.res.modes': 'a M3 8c4-6 8 6 9 0s5-6 9 0|p M3 16c6 6 12 6 18 0',
  'fe.res.table': 'r 3 4 18 16 2|L 3 9.5 21 9.5|l 9 9.5 9 20|l 15 9.5 15 20|l 3 15 21 15',
  'fe.benchmark': 'p M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z|a M8 12l3 3 5-6',
  'fe.benchmark.check': 'r 4 3 16 18 2|l 8 8 16 8|l 8 12 13 12|a M12 16.5l2 2 3.5-4',

  // ---- Form-finding, optimization, script
  'ff.fdm': 'a M3 6c6 5 12 5 18 0M3 18c6-5 12-5 18 0|p M8 8.7v6.6M12 9.7v4.6M16 8.7v6.6',
  'ff.dr': 'd 3 5|d 21 5|a M3 5c2 14 16 14 18 0|C 7.4 13.4 1.6|C 12 15.5 1.6|C 16.6 13.4 1.6',
  'opt.evolve': 'c 12 12 8.5|o 12 12 4.8|C 12 12 1.7',
  'script.js': 'p M8 6l-5 6 5 6M16 6l5 6-5 6|a M13.5 4l-3 16',
  'cluster': 'r 3 3 18 18 3|R 6.5 6.5 5 5 1|R 12.5 12.5 5 5 1|a M11.5 9h3.5v3.5',
  'cluster.in': 'r 8 4 13 16 2|a M2 12h10M9 9l3 3-3 3',
  'cluster.out': 'r 3 4 13 16 2|a M12 12h10M19 9l3 3-3 3',
};

/** Thumbnails (48 x 32) for templates, examples and benchmark types. */
const THUMBS: Record<string, string> = {
  'beam-simple': 'a M6 17h36|p M6 17l-3 5.5h6zM42 17l-3 5.5h6zM2 24.5h8M38 24.5h8|L 8 8 40 8|p M10 8v7M17.5 8v7M25 8v7M32.5 8v7M39 8v7',
  'beam-cantilever': 'p M7 5v22M7 9l-3 3M7 14l-3 3M7 19l-3 3M7 24l-3 3|a M7 16h34|p M41 4v9M39 10.5l2 2.5 2-2.5',
  'beam-continuous': 'a M4 16h40|p M4 16l-2.5 5h5zM17.3 16l-2.5 5h5zM30.6 16l-2.5 5h5zM44 16l-2.5 5h5z|L 6 8 42 8|p M10 8v6M24 8v6M38 8v6',
  'truss-plane': 'a M4 24h40M9 10h30M4 24l5-14 5 14 5-14 5 14 5-14 5 14 5-14 5 14|p M4 24l-2.5 4.5h5zM44 24l-2.5 4.5h5z',
  'frame-portal': 'a M10 27V9h28v18|p M6 27h8M34 27h8|p M2 9h6M6 7l2 2-2 2|L 12 4.5 36 4.5|p M16 4.5v3M24 4.5v3M32 4.5v3',
  'column-buckling': 'p M18 28h12M24 1v4M22.5 3.5L24 5l1.5-1.5|l 24 28 24 6|a M24 28c-8-8-8-14 0-22',
  'plate': 'F M6 24l10-12h26l-10 12z|p M19 4v7M26 4v7M33 4v7M17.5 9l1.5 2 1.5-2M24.5 9l1.5 2 1.5-2M31.5 9l1.5 2 1.5-2',
  'block-section': 'F M7 5h13v3.5h-4.5v15H20V27H7v-3.5h4.5v-15H7z|r 28 8 14 14 2|a M28 14l6-6M28 20l12-12M34 22l8-8',
  'block-loads': 'a M8 7h32M10 7v11M20 7v11M30 7v11M38 7v11M8.5 16l1.5 2 1.5-2M18.5 16l1.5 2 1.5-2M28.5 16l1.5 2 1.5-2M36.5 16l1.5 2 1.5-2|p M6 24h36',
  'block-results': 'l 6 11 42 11|F M6 11c9 16 27 16 36 0z|p M6 11l-2.5 4h5zM42 11l-2.5 4h5z',
  'quick-truss': 'a M8 25h32L24 6z|p M8 25l-2.5 4.5h5zM40 25l-2.5 4.5h5zM24 0v5M22.5 3.5L24 5l1.5-1.5',
  'truss-bridge': 'a M3 23h42M8 10h32M3 23l5-13 5.3 13 5.3-13 5.4 13 5.3-13 5.4 13 5.3-13 5 13',
  'portal-building': 'a M5 27V15l8-6 8 6v12M21 15l12-5v12M13 9l12-5 8 6M5 15l12-5|p M25 4v0',
  'space-truss': 'a M3 22h30l12-7M3 22l12-7h30M9 10h24l6 5M9 10L3 22M9 10l6 5M21 10l-6 12M21 10l12 12M33 10l-12 12M33 10l6 5',
  'gridshell': 'a M4 27c6-20 34-20 40 0M13 27c3-12 19-12 22 0M4 27h40|p M24 12v15M10 17.5h28',
  'cable-net': 'a M4 7c12 10 28 10 40 0M4 25c12-10 28-10 40 0|p M12 11.8v8.4M20 14v4M28 14v4M36 11.8v8.4|p M4 7v18M44 7v18',
  'hypar-shell': 'F M4 24L20 5l24 7-16 16z|p M12 14.5l20 12.5M36 9.5L20 26',
  'tower': 'a M17 29l4-26h6l4 26|p M18.2 21h11.6M19.5 13h9M18.2 21l10.3-8M29.8 21L19.5 13M20.5 6.5h7',
  'sizing': 'F M4 9h8v2H9.2v10H12v2H4v-2h2.8V11H4z|F M17 6h10v2.5h-3.5v15H27V26H17v-2.5h3.5v-15H17z|F M32 3h13v3h-4.8v20H45v3H32v-3h4.8V6H32z',
  'evolve-beam': 'p M6 5v22h38|a M8 8c6 13 18 16 34 16|C 30 21.5 2',
  // benchmark types (by builder)
  'b:beam': 'a M6 16h36|p M6 16l-3 5h6zM42 16l-3 5h6z|p M24 5v8M22 10.5l2 2.5 2-2.5',
  'b:triangleTruss': 'a M8 24h32L24 7z|p M8 24l-2.5 4.5h5zM40 24l-2.5 4.5h5z',
  'b:tenBarTruss': 'a M6 8h32M6 24h32M22 8v16M38 8v16M6 8l16 16 16-16M6 24L22 8l16 16|p M6 4v24',
  'b:portal': 'a M10 27V9h28v18|p M6 27h8M34 27h8M2 9h6M6 7l2 2-2 2',
  'b:spaceFrame': 'a M8 27V12l12-6v15M20 6l18 4v15M8 12l18 4 12-6M26 16v12',
  'b:curvedBeam': 'p M6 5v24M6 10l-3 3M6 18l-3 3M6 26l-3 3|a M6 27a21 21 0 0 0 21-21|p M33 6h-5M30 4.5L28 6l2 1.5',
  'b:rigidOffset': 'p M6 5v22|a M6 12h8v8h28|C 14 20 1.8',
  'b:column': 'p M18 28h12M24 1v4M22.5 3.5L24 5l1.5-1.5|l 24 28 24 6|a M24 28c-8-8-8-14 0-22',
  'b:vibration': 'l 4 16 44 16|a M4 16c7-16 13-16 20 0s13 16 20 0',
  'b:cable': 'd 5 7|d 43 7|a M5 7c8 22 30 22 38 0',
  'b:scordelisLo': 'F M6 22c10-16 26-16 36 0l-6 6c-8-12-16-12-24 0z',
  'b:pinchedCylinder': 'a M10 8c0-4 28-4 28 0v16c0 4-28 4-28 0zM10 8c0 4 28 4 28 0|p M24 1v6M24 31v-4',
  'b:hemisphere': 'F M6 24a18 18 0 0 1 36 0c0 4-36 4-36 0z',
  'b:squarePlate': 'F M6 24l10-12h26l-10 12z|p M26 4v10M24 11.5l2 2.5 2-2.5',
  'b:plateStrip': 'p M6 6v20|F M6 12h34l4 4H10z|p M42 3v8',
  'b:patchTest': 'a M8 6h32v20H8zM8 6l14 8 18-8M22 14l-4 12M22 14l18 12M8 26l10 0',
};

function esc(text: string): string { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** Turn the icon notation into SVG markup (the content of an <svg> element). */
export function iconMarkup(spec: string): string {
  const out: string[] = [];
  for (const part of spec.split('|')) {
    const s = part.trim(), k = s[0], rest = s.slice(2), n = rest.split(' ');
    switch (k) {
      case 'p': out.push(`<path d="${rest}"/>`); break;
      case 'a': out.push(`<path class="ia" d="${rest}"/>`); break;
      case 'F': out.push(`<path class="ia if" d="${rest}"/>`); break;
      case 'f': out.push(`<path class="is" d="${rest}"/>`); break;
      case 'l': case 'L': out.push(`<path${k === 'L' ? ' class="ia"' : ''} d="M${n[0]} ${n[1]}L${n[2]} ${n[3]}"/>`); break;
      case 'c': case 'o': out.push(`<circle${k === 'o' ? ' class="ia"' : ''} cx="${n[0]}" cy="${n[1]}" r="${n[2]}"/>`); break;
      case 'C': out.push(`<circle class="is" cx="${n[0]}" cy="${n[1]}" r="${n[2]}"/>`); break;
      case 'd': out.push(`<circle class="id" cx="${n[0]}" cy="${n[1]}" r="1.6"/>`); break;
      case 'r': case 'R': out.push(`<rect${k === 'R' ? ' class="ia"' : ''} x="${n[0]}" y="${n[1]}" width="${n[2]}" height="${n[3]}" rx="${n[4] ?? 0}"/>`); break;
      case 't': case 'T': out.push(`<text class="${k === 'T' ? 'it ita' : 'it'}" x="${n[0]}" y="${n[1]}" font-size="${n[2]}">${esc(n.slice(3).join(' '))}</text>`); break;
      default: throw new Error(`Unknown icon shape "${k}" in "${spec}"`);
    }
  }
  return out.join('');
}

const cache = new Map<string, string>();
export const hasIcon = (id: string): boolean => id in I;
export const hasThumb = (id: string): boolean => id in THUMBS;
export const iconIds = (): string[] => Object.keys(I);
export const thumbIds = (): string[] => Object.keys(THUMBS);
/** SVG content for a component icon. A component without a drawing (a saved cluster, say) gets its initials. */
export function iconFor(id: string, fallback = ''): string {
  const key = id + '|' + fallback;
  let m = cache.get(key);
  if (m === undefined) { m = iconMarkup(I[id] ?? I[id.startsWith('cluster') ? 'cluster' : ''] ?? `t 12 16 ${fallback.length > 2 ? 8 : 11} ${fallback.slice(0, 3) || '?'}`); cache.set(key, m); }
  return m;
}
/** SVG content for a thumbnail; benchmarks pass "b:" + the name of their model builder. */
export function thumbFor(id: string): string {
  let m = cache.get('thumb|' + id);
  if (m === undefined) { m = iconMarkup(THUMBS[id] ?? THUMBS['b:beam']); cache.set('thumb|' + id, m); }
  return m;
}
