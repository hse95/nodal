/**
 * Core type definitions shared by the graph engine, the component library and the UI.
 */
import type { DataTree, Matching } from './tree';

/** Data types carried by wires. Wire colours are keyed on these. */
export type DType =
  | 'any' | 'number' | 'integer' | 'boolean' | 'text' | 'point' | 'vector' | 'plane' | 'domain'
  | 'curve' | 'surface' | 'mesh' | 'brep' | 'geometry' | 'color' | 'transform'
  | 'material' | 'section' | 'element' | 'support' | 'load' | 'model' | 'result';

/** How a component consumes an input / produces an output. */
export type Access = 'item' | 'list' | 'tree';

export interface PortSpec {
  name: string;          // full name shown in help and inspector
  nick: string;          // short label drawn on the node
  type: DType;
  access: Access;
  desc: string;
  /** Default used when nothing is wired and no constant is set. `undefined` = required. */
  default?: unknown;
  optional?: boolean;    // may be left empty without raising a warning
  /** Physical unit of a numeric port; the label shown depends on the project unit system. */
  unit?: string;
}

export interface SolveContext {
  node: NodeData;
  project: ProjectFile;
  units: 'SI' | 'US';
  /** Add a non-fatal message; the node is shown in the warning state. */
  warn(msg: string): void;
  /** True once a newer solve has started; long-running components should stop. */
  cancelled(): boolean;
  /** Evaluate a nested graph (used by clusters). */
  runSubgraph(graph: GraphDoc, inputs: Record<string, DataTree>): Promise<Record<string, DataTree>>;
}

export interface ComponentDef {
  id: string;            // stable identifier stored in project files, e.g. "math.add"
  name: string;
  nick: string;
  category: string;
  desc: string;
  /** A tiny usage example shown in the built-in help. */
  example?: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Ports that depend on node state (script, cluster, expression, merge...). */
  ports?(node: NodeData, project: ProjectFile): { inputs: PortSpec[]; outputs: PortSpec[] };
  /**
   * Per-iteration solve. `inputs[i]` is a single item or an array depending on
   * the port access; return one value per output (an array for list outputs).
   */
  solve?(inputs: any[], ctx: SolveContext): any[] | Promise<any[]>;
  /** Whole-tree solve for components that manipulate tree structure. */
  solveTrees?(inputs: DataTree[], ctx: SolveContext): DataTree[] | Promise<DataTree[]>;
  /** Special on-canvas widget. */
  widget?: 'slider' | 'toggle' | 'panel' | 'valuelist' | 'graph' | 'note' | 'text' | 'button' | 'optimizer' | 'colour';
  /** Initial node state. */
  state?: Record<string, unknown>;
  /** Hide this node's outputs from the 3D preview by default. */
  noPreview?: boolean;
  width?: number;
}

export interface PortMods { flatten?: boolean; graft?: boolean; simplify?: boolean; reverse?: boolean }

export interface NodeData {
  id: string;
  type: string;
  x: number;
  y: number;
  state: Record<string, any>;
  /** Constants for unwired inputs, keyed by port name. */
  consts: Record<string, any>;
  /** Per-input tree modifiers, keyed by port name. */
  mods?: Record<string, PortMods>;
  matching?: Matching;
  preview?: boolean;
  enabled?: boolean;
  label?: string;
  w?: number;
  h?: number;
}

export interface WireData { id: string; from: string; out: number; to: string; inp: number }
export interface GroupData { id: string; label: string; color: string; nodes: string[] }
export interface GraphDoc { nodes: NodeData[]; wires: WireData[]; groups: GroupData[] }

export interface ClusterDef { id: string; name: string; desc?: string; graph: GraphDoc }

/** Versioned project file (.nodal). Bump SCHEMA_VERSION and add a migration when the shape changes. */
export const SCHEMA_VERSION = 1;
export interface ProjectFile {
  format: 'nodal';
  schema: number;
  name: string;
  description?: string;
  units: 'SI' | 'US';
  graph: GraphDoc;
  clusters: Record<string, ClusterDef>;
  /** Free-form UI state (camera, canvas pan/zoom). */
  view?: Record<string, unknown>;
}

export type NodeState = 'ok' | 'warning' | 'error' | 'disabled' | 'pending' | 'idle';
export interface NodeStatus { state: NodeState; messages: string[]; ms: number }

export const TYPE_COLORS: Record<DType, string> = {
  any: '#8b93a1', number: '#4f8ef7', integer: '#3aa0c9', boolean: '#d9822b', text: '#9b7fd1',
  point: '#e0b03a', vector: '#c9a227', plane: '#b5893c', domain: '#5aa7a7',
  curve: '#3fae6b', surface: '#2f9e8f', mesh: '#58a65c', brep: '#2e8b7a', geometry: '#6aa84f',
  color: '#d1589b', transform: '#a06cd5',
  material: '#c26a4a', section: '#b8574f', element: '#d4504c', support: '#8f6bd6', load: '#e0703a',
  model: '#d43d51', result: '#e64980',
};
