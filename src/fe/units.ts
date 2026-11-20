/**
 * Unit systems. All structural quantities are stored in SI base units
 * (N, m, Pa, kg, K); these factors convert a displayed value to SI
 * (value_SI = value_display * f). Geometry on the canvas is unitless: one
 * model unit is one metre in SI projects and one foot in US projects.
 */
export type UnitKey = 'len' | 'dim' | 'force' | 'moment' | 'lineLoad' | 'pressure' | 'stress' | 'density' | 'area' | 'inertia' | 'temp' | 'alpha' | 'mass' | 'spring' | 'rotSpring' | 'tempGrad' | 'freq' | 'angle' | 'none' | 'forcePerLen' | 'momentPerLen';
export interface Unit { label: string; f: number }
export type UnitSystem = Record<UnitKey, Unit> & { name: 'SI' | 'US' };

const SI: UnitSystem = {
  name: 'SI',
  len: { label: 'm', f: 1 }, dim: { label: 'mm', f: 1e-3 }, force: { label: 'kN', f: 1e3 }, moment: { label: 'kN·m', f: 1e3 },
  lineLoad: { label: 'kN/m', f: 1e3 }, pressure: { label: 'kPa', f: 1e3 }, stress: { label: 'MPa', f: 1e6 }, density: { label: 'kg/m³', f: 1 },
  area: { label: 'cm²', f: 1e-4 }, inertia: { label: 'cm⁴', f: 1e-8 }, temp: { label: '°C', f: 1 }, alpha: { label: '1/°C', f: 1 }, mass: { label: 'kg', f: 1 },
  spring: { label: 'kN/m', f: 1e3 }, rotSpring: { label: 'kN·m/rad', f: 1e3 }, tempGrad: { label: '°C/m', f: 1 }, freq: { label: 'Hz', f: 1 }, angle: { label: '°', f: Math.PI / 180 }, none: { label: '', f: 1 },
  forcePerLen: { label: 'kN/m', f: 1e3 }, momentPerLen: { label: 'kN·m/m', f: 1e3 },
};
const US: UnitSystem = {
  name: 'US',
  len: { label: 'ft', f: 0.3048 }, dim: { label: 'in', f: 0.0254 }, force: { label: 'kip', f: 4448.2216152605 }, moment: { label: 'kip·ft', f: 1355.8179483314 },
  lineLoad: { label: 'kip/ft', f: 14593.902937206 }, pressure: { label: 'psf', f: 47.880258980336 }, stress: { label: 'ksi', f: 6894757.2931783 }, density: { label: 'lb/ft³', f: 16.018463373960 },
  area: { label: 'in²', f: 6.4516e-4 }, inertia: { label: 'in⁴', f: 4.162314256e-7 }, temp: { label: '°F', f: 5 / 9 }, alpha: { label: '1/°F', f: 9 / 5 }, mass: { label: 'lb', f: 0.45359237 },
  spring: { label: 'kip/in', f: 175126.83524647 }, rotSpring: { label: 'kip·ft/rad', f: 1355.8179483314 }, tempGrad: { label: '°F/ft', f: (5 / 9) / 0.3048 }, freq: { label: 'Hz', f: 1 }, angle: { label: '°', f: Math.PI / 180 }, none: { label: '', f: 1 },
  forcePerLen: { label: 'kip/ft', f: 14593.902937206 }, momentPerLen: { label: 'kip·ft/ft', f: 4448.2216152605 },
};
export const unitSystem = (name: 'SI' | 'US'): UnitSystem => (name === 'US' ? US : SI);
