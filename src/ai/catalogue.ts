/**
 * The part of the assistant's system prompt that describes the components. It is generated from the
 * component registry at run time, so it cannot drift from the components that really exist.
 */
import type { ComponentDef, PortSpec } from '../core/types';
import { registry, Registry } from '../core/graph';
import { unitSystem } from '../fe/units';
import template from './system-prompt.md?raw';

/** Components the assistant may not create: scripting (no code execution on its behalf) and cluster plumbing. */
export const BLOCKED_TYPES = new Set(['script.js', 'cluster', 'cluster.in', 'cluster.out']);
export const isBlocked = (type: string): boolean => BLOCKED_TYPES.has(type) || type.startsWith('cluster');

const port = (p: PortSpec, input: boolean): string => `${p.name}:${p.type}${p.access === 'list' ? '[]' : p.access === 'tree' ? '{}' : ''}${input && p.default === undefined && !p.optional ? '*' : ''}`;
export function catalogueLine(d: ComponentDef): string {
  return `\`${d.id}\` ${d.name} [${d.category}]: ${d.inputs.map(p => port(p, true)).join(', ') || '(none)'} -> ${d.outputs.map(p => port(p, false)).join(', ') || '(none)'}`;
}
export function buildCatalogue(reg: Registry = registry): string {
  return reg.all().filter(d => !isBlocked(d.id)).map(catalogueLine).join('\n');
}
/** The unit conventions, read from the unit tables the components themselves use. */
export function unitsText(units: 'SI' | 'US'): string {
  const u = unitSystem(units), l = (k: keyof typeof u) => (u[k] as { label: string }).label;
  return `This project uses ${units === 'SI' ? 'SI' : 'US customary'} units: lengths and coordinates in ${l('len')}, forces in ${l('force')}, moments in ${l('moment')}, distributed loads in ${l('lineLoad')}, pressures in ${l('pressure')}, stresses and moduli in ${l('stress')}, section dimensions and displacements in ${l('dim')}, density in ${l('density')}, mass in ${l('mass')}. Ports with a unit say so in their description. Z is up; gravity acts along -Z. Points are written "x, y, z".`;
}
export function buildSystemPrompt(units: 'SI' | 'US', reg: Registry = registry): string {
  return template.replace('{{UNITS}}', unitsText(units)).replace('{{CATALOGUE}}', buildCatalogue(reg));
}
