/**
 * Other names people know a component by: mostly the names used in Grasshopper and in a few widely used
 * Grasshopper add-ons, where Nodal's name differs. They are used by the search (typing the familiar name
 * finds the Nodal component) and to generate the "Coming from Grasshopper" guide. Keys are Nodal names.
 */
export const ALIASES: Record<string, string[]> = {
  // Params
  'Color': ['Colour Swatch', 'Swatch'], 'Note': ['Scribble'], 'Geometry From File': ['Import 3DM', 'Import Geometry', 'File Path'],
  // Math
  'Expression': ['Evaluate', 'Formula'], 'And': ['Gate And'], 'Or': ['Gate Or'], 'Not': ['Gate Not'], 'Xor': ['Gate Xor'], 'Similar': ['Similarity'], 'Equals': ['Equality'], 'Pick': ['Stream Filter', 'If'],
  'Natural Logarithm': ['Ln'], 'Remap Numbers': ['ReMap'], 'Mass Addition': ['Sum', 'MA'],
  // Trees
  'Tree Statistics': ['Param Viewer', 'Parameter Viewer', 'TStat'], 'Tree Branch': ['Explode Tree', 'Branch'], 'Flip Matrix': ['Flip'],
  // Vector
  'Deconstruct Point': ['Deconstruct', 'pDecon'], 'Unitize': ['Unit Vector'], 'Point Between': ['Tween Points'], 'Square Grid': ['Square', 'SqGrid'], 'Hexagonal Grid': ['Hexagonal', 'HexGrid'], 'Radial Grid': ['Radial', 'RadGrid'],
  // Curve
  'Interpolate': ['IntCrv', 'Interpolate Curve'], 'Circle': ['Circle CNR', 'Cir'], 'Evaluate Curve': ['Point On Curve', 'Evaluate Length'], 'Divide Length': ['Divide Distance'], 'Curve | Curve': ['CCX', 'Curve Curve Intersection'], 'Curve Length': ['Length'],
  'Tween Curves': ['Tween Two Curves'], 'Curve To Polyline': ['Curve To Polyline'], 'Polyline': ['PolyLine', 'PLine'],
  // Surface
  'Sweep': ['Sweep1', 'Sweep 1 Rail'], 'Revolve': ['Revolution'], 'Area And Volume': ['Area', 'Volume'], 'Box': ['Center Box', 'Box 2Pt', 'Domain Box'], 'Plane Surface': ['PlaneSrf'],
  'Quad Panels': ['Quad Panels', 'Paneling Quads'], 'Triangular Panels': ['Triangle Panels', 'Triangle Panels A', 'Triangle Panels B'], 'Staggered Panels': ['Staggered Quad Panels', 'Brick Panels'], 'Diagrid': ['Diagrid Structure'], 'Space Truss': ['Space Truss Structure', 'Space Frame'],
  // Mesh
  'Subdivide Mesh': ['Catmull-Clark Subdivision', 'SubD', 'Mesh Subdivision'], 'Smooth Mesh': ['Laplacian Smoothing', 'Relax Mesh'], 'Weld Mesh': ['Weld', 'Join Meshes and Weld', 'Combine and Clean'], 'Mesh Join': ['Join Meshes'],
  // Transform
  'Rotate': ['Rotate Axis', 'Rotate 3D'], 'Project To Plane': ['Project'], 'Bend': ['Bend Deform'], 'Color RGB': ['Colour RGB'], 'Dimension': ['Aligned Dimension'], 'Text Tag': ['Text Tag 3D'],
  // Structure (names familiar from structural add-ons)
  'Beam': ['Line to Beam', 'Frame Element'], 'Truss': ['Line to Truss', 'Bar'], 'Shell': ['Mesh to Shell'], 'Linear Static': ['Analyze', 'Analysis', 'First Order Analysis'], 'Second-Order Analysis': ['Analyze ThII', 'P-Delta'], 'Buckling Analysis': ['Buckling Modes'], 'Modal Analysis': ['Eigen Modes', 'Natural Vibrations'],
  'Result View': ['Model View', 'Beam View', 'Shell View'], 'Member Forces': ['Beam Forces', 'Section Forces'], 'Reactions': ['Reaction Forces'], 'Section Sizing': ['Optimize Cross Section'], 'Point Load': ['Loads', 'Nodal Load'], 'Self Weight': ['Gravity'],
  'AISC Shape': ['W Shape', 'Wide Flange', 'Steel Section', 'Cross Section Selector'], 'ASCE 7 Combinations': ['Load Combinations', 'LRFD', 'ASD'], 'AISC 360 Check': ['Steel Check', 'Steel Design', 'Code Check'], 'ACI 318 Beam Check': ['Concrete Check', 'Concrete Design', 'Rebar'],
  'Truss Generator': ['Pratt Truss', 'Howe Truss', 'Warren Truss'], 'Frame Grid': ['Building Frame', 'Grid Structure'],
  // Tools
  'Dynamic Relaxation': ['Form Finding', 'Solver', 'Bouncy Solver', 'Particle Spring'], 'Force Density': ['Cable Net', 'FDM'], 'Evolutionary Optimizer': ['Galapagos', 'Evolutionary Solver', 'Genetic Algorithm'], 'Script': ['GhPython', 'C# Script', 'Python', 'JavaScript'],
  'Sun Position': ['Sun', 'Solar Position'], 'Sun Path': ['SunPath'], 'Shadow': ['Shadow Study', 'Sunlight Hours'],
};
