/**
 * Reference groups: which bulk data cards an ID field can point to.
 * The referenced card is identified by its first data field (field 2).
 */
import { CARDS } from './cards';

function byIdSpace(space: string): string[] {
  return [...CARDS.values()].filter((c) => c.idSpace === space).map((c) => c.name);
}

const STATIC_LOADS = [
  'LOAD', 'FORCE', 'FORCE1', 'FORCE2', 'MOMENT', 'MOMENT1', 'MOMENT2', 'PLOAD', 'PLOAD1', 'PLOAD2', 'PLOAD4',
  'GRAV', 'RFORCE', 'ACCEL', 'ACCEL1', 'SLOAD', 'SPCD', 'PLOADX1', 'TEMP',
];

const BUILTIN_GROUPS: Record<string, string[]> = {
  grid: ['GRID', 'SPOINT', 'EPOINT'],
  coord: ['CORD2R', 'CORD2C', 'CORD2S', 'CORD1R', 'CORD1C', 'CORD1S', 'CORD3G'],
  mat: ['MAT1', 'MAT2', 'MAT3', 'MAT8', 'MAT9', 'MAT10', 'MAT4', 'MAT5'],
  elem: byIdSpace('element'),
  prop: byIdSpace('property'),
  shellProp: ['PSHELL', 'PCOMP', 'PCOMPG'],
  solidProp: ['PSOLID', 'PCOMPS'],
  barProp: ['PBAR', 'PBARL'],
  beamProp: ['PBEAM', 'PBEAML', 'PBCOMP'],
  rodProp: ['PROD'],
  tubeProp: ['PTUBE'],
  bushProp: ['PBUSH'],
  bush1dProp: ['PBUSH1D'],
  elasProp: ['PELAS'],
  dampProp: ['PDAMP'],
  massProp: ['PMASS'],
  viscProp: ['PVISC'],
  gapProp: ['PGAP'],
  shearProp: ['PSHEAR'],
  fastProp: ['PFAST'],
  tablem: ['TABLEM1', 'TABLEM2', 'TABLEM3', 'TABLEM4'],
  tabled: ['TABLED1', 'TABLED2', 'TABLED3', 'TABLED4'],
  table: ['TABLES1', 'TABLEST', 'TABLEM1', 'TABLEM2', 'TABLEM3', 'TABLEM4', 'TABLED1', 'TABLED2', 'TABLED3', 'TABLED4'],
  set1: ['SET1'],
  paero1: ['PAERO1'],
  caero: ['CAERO1', 'CAERO2', 'CAERO3', 'CAERO4', 'CAERO5'],
  desvar: ['DESVAR'],
  dresp: ['DRESP1', 'DRESP2', 'DRESP3'],
  dconstr: ['DCONSTR', 'DCONADD'],
  flfact: ['FLFACT'],
  spcSet: ['SPC', 'SPC1', 'SPCADD'],
  mpcSet: ['MPC', 'MPCADD'],
  loadSet: STATIC_LOADS,
  excite: ['DAREA', 'SPCD', ...STATIC_LOADS],
  dynLoad: ['DLOAD', 'RLOAD1', 'RLOAD2', 'TLOAD1', 'TLOAD2', 'ACSRCE'],
  eigr: ['EIGRL', 'EIGR', 'EIGB'],
  eigc: ['EIGC'],
  freq: ['FREQ', 'FREQ1', 'FREQ2', 'FREQ3', 'FREQ4', 'FREQ5'],
  tstep: ['TSTEP', 'TSTEPNL'],
  nlparm: ['NLPARM'],
  tabdmp: ['TABDMP1'],
  temp: ['TEMP', 'TEMPD'],
  suport1: ['SUPORT1'],
  trim: ['TRIM'],
  flutter: ['FLUTTER'],
  bctset: ['BCTSET', 'BCTADD'],
  deform: ['DEFORM'],
  tabrnd: ['TABRND1'],
  randps: ['RANDPS'],
};

/** Active reference groups (built-in, plus additions from private definition files). */
export const REF_GROUPS: Record<string, string[]> = {};

/**
 * Rebuild REF_GROUPS from the built-in groups, the current CARDS (cards with an
 * idSpace join the elem/prop groups) and extra groups from definition files.
 */
export function rebuildRefGroups(extra: Record<string, string[]> = {}): void {
  for (const k of Object.keys(REF_GROUPS)) {
    delete REF_GROUPS[k];
  }
  for (const [k, v] of Object.entries(BUILTIN_GROUPS)) {
    REF_GROUPS[k] = [...v];
  }
  REF_GROUPS.elem = byIdSpace('element');
  REF_GROUPS.prop = byIdSpace('property');
  for (const [k, v] of Object.entries(extra)) {
    REF_GROUPS[k] = [...new Set([...(REF_GROUPS[k] ?? []), ...v.map((n) => n.toUpperCase())])];
  }
}

rebuildRefGroups();

/** Human readable label of a reference group, e.g. "PSHELL/PCOMP/PCOMPG". */
export function refLabel(group: string): string {
  const cards = REF_GROUPS[group] ?? [];
  if (group === 'elem') {
    return 'element';
  }
  if (group === 'prop') {
    return 'property';
  }
  return cards.slice(0, 6).join('/') + (cards.length > 6 ? '/...' : '');
}
