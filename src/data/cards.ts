/**
 * Bulk data card definitions (MSC Nastran oriented).
 *
 * Field index 0 is field 2 of the first line; continuation lines contribute 8
 * data fields each (fields 2-9), so index 8 is field 2 of the first
 * continuation, index 16 field 2 of the second continuation, etc.
 *
 * Descriptions are short summaries written for this extension. Always check
 * the MSC Nastran Quick Reference Guide for the complete rules of each card.
 */
import { CardDef, FieldDef, FieldTuple, IdSpace, RepeatDef, VType } from './types';

const _: FieldTuple = ['', '', 'Unused (leave blank)'];

function f(t: FieldTuple): FieldDef {
  const [name, type, desc, ref] = t;
  const required = type.endsWith('!');
  return { name, type: type.replace('!', '') as VType, required, desc, ref };
}

type RepeatSpec = { from: number; fields: FieldTuple[]; start?: number; step?: number };

interface VariantSpec {
  when: { index: number; values: string[] };
  desc?: string;
  fields: FieldTuple[];
  repeat?: RepeatSpec;
}

interface Extra {
  repeat?: RepeatSpec;
  id?: IdSpace;
  listIds?: boolean;
  notes?: string;
  variants?: VariantSpec[];
}

const defs: CardDef[] = [];

function repeatOf(r?: RepeatSpec): RepeatDef | undefined {
  return r ? { from: r.from, fields: r.fields.map(f), start: r.start ?? 1, step: r.step ?? 1 } : undefined;
}

function card(name: string, group: string, desc: string, fields: FieldTuple[], extra: Extra = {}): void {
  defs.push({
    name,
    group,
    desc,
    fields: fields.map(f),
    repeat: repeatOf(extra.repeat),
    idSpace: extra.id,
    listIds: extra.listIds,
    notes: extra.notes,
    variants: extra.variants?.map((v) => ({ when: v.when, desc: v.desc, fields: v.fields.map(f), repeat: repeatOf(v.repeat) })),
  });
}

const EID: FieldTuple = ['EID', 'I!', 'Element identification number'];
const g = (n: string, desc = 'Grid point ID'): FieldTuple => [n, 'I', desc, 'grid'];
const gr = (n: string, desc = 'Grid point ID'): FieldTuple => [n, 'I!', desc, 'grid'];
const comp = (n: string, desc = 'Component number(s): any unique combination of 1-6 (0 or blank for scalar points)'): FieldTuple => [n, 'I', desc];
const r = (n: string, desc: string): FieldTuple => [n, 'R', desc];

// ===========================================================================
// Geometry
// ===========================================================================
const G = 'Geometry';

card('GRID', G, 'Grid point: location, coordinate systems and permanent single-point constraints', [
  ['ID', 'I!', 'Grid point identification number'],
  ['CP', 'I', 'Coordinate system in which the location X1-X3 is defined (0/blank = basic)', 'coord'],
  r('X1', 'Location coordinate 1 in system CP'),
  r('X2', 'Location coordinate 2 in system CP'),
  r('X3', 'Location coordinate 3 in system CP'),
  ['CD', 'I', 'Displacement (output) coordinate system; -1 = fluid grid', 'coord'],
  ['PS', 'I', 'Permanent single-point constraint components (1-6)'],
  ['SEID', 'I', 'Superelement ID'],
], { id: 'grid' });

card('GRDSET', G, 'Default values for fields 3, 7, 8 and 9 of all GRID entries', [
  _, ['CP', 'I', 'Default location coordinate system', 'coord'], _, _, _,
  ['CD', 'I', 'Default displacement coordinate system', 'coord'],
  ['PS', 'I', 'Default permanent SPC components'],
  ['SEID', 'I', 'Default superelement ID'],
]);

card('SPOINT', G, 'Scalar points (single degree of freedom points)', [], {
  repeat: { from: 0, fields: [['ID{n}', 'IS', 'Scalar point ID (or THRU)']] },
  id: 'grid',
  listIds: true,
});

card('EPOINT', G, 'Extra points for dynamic analysis', [], {
  repeat: { from: 0, fields: [['ID{n}', 'IS', 'Extra point ID (or THRU)']] },
  id: 'grid',
  listIds: true,
});

for (const [suffix, kind] of [['R', 'rectangular'], ['C', 'cylindrical'], ['S', 'spherical']]) {
  card(`CORD2${suffix}`, G, `${kind[0].toUpperCase() + kind.slice(1)} coordinate system defined by three points (A origin, B on Z axis, C in XZ plane)`, [
    ['CID', 'I!', 'Coordinate system identification number'],
    ['RID', 'I', 'Reference coordinate system in which A, B, C are defined (0 = basic)', 'coord'],
    r('A1', 'Origin (point A), component 1'),
    r('A2', 'Origin (point A), component 2'),
    r('A3', 'Origin (point A), component 3'),
    r('B1', 'Point B on the Z axis, component 1'),
    r('B2', 'Point B on the Z axis, component 2'),
    r('B3', 'Point B on the Z axis, component 3'),
    r('C1', 'Point C in the XZ plane, component 1'),
    r('C2', 'Point C in the XZ plane, component 2'),
    r('C3', 'Point C in the XZ plane, component 3'),
  ], { id: 'coord' });

  card(`CORD1${suffix}`, G, `${kind[0].toUpperCase() + kind.slice(1)} coordinate system(s) defined by three grid points (one or two systems per entry)`, [
    ['CIDA', 'I!', 'Coordinate system identification number'],
    gr('G1A', 'Grid at the origin'),
    gr('G2A', 'Grid on the Z axis'),
    gr('G3A', 'Grid in the XZ plane'),
    ['CIDB', 'I', 'Second coordinate system ID (optional)'],
    g('G1B', 'Grid at the origin (second system)'),
    g('G2B', 'Grid on the Z axis (second system)'),
    g('G3B', 'Grid in the XZ plane (second system)'),
  ], { id: 'coord' });
}

// ===========================================================================
// Mass / scalar elements
// ===========================================================================
const EM = 'Elements: Mass & Scalar';

card('CONM2', EM, 'Concentrated mass at a grid point (mass, offset, inertia)', [
  EID,
  gr('G'),
  ['CID', 'I', 'Coordinate system for offset and inertia (-1 = offset in basic, inertia in GRID CD)', 'coord'],
  r('M', 'Mass value'),
  r('X1', 'Offset from grid to center of gravity, component 1'),
  r('X2', 'Offset from grid to center of gravity, component 2'),
  r('X3', 'Offset from grid to center of gravity, component 3'),
  _,
  r('I11', 'Mass moment of inertia I11'),
  r('I21', 'Mass product of inertia I21 (= -Ixy convention, see QRG)'),
  r('I22', 'Mass moment of inertia I22'),
  r('I31', 'Mass product of inertia I31'),
  r('I32', 'Mass product of inertia I32'),
  r('I33', 'Mass moment of inertia I33'),
], { id: 'element' });

card('CONM1', EM, 'Concentrated mass: general 6x6 symmetric mass matrix at a grid point', [
  EID, gr('G'), ['CID', 'I', 'Coordinate system of the mass matrix', 'coord'],
  r('M11', 'Mass matrix term'), r('M21', 'Mass matrix term'), r('M22', 'Mass matrix term'),
  r('M31', 'Mass matrix term'), r('M32', 'Mass matrix term'),
  r('M33', 'Mass matrix term'), r('M41', 'Mass matrix term'), r('M42', 'Mass matrix term'),
  r('M43', 'Mass matrix term'), r('M44', 'Mass matrix term'), r('M51', 'Mass matrix term'),
  r('M52', 'Mass matrix term'), r('M53', 'Mass matrix term'),
  r('M54', 'Mass matrix term'), r('M55', 'Mass matrix term'), r('M61', 'Mass matrix term'),
  r('M62', 'Mass matrix term'), r('M63', 'Mass matrix term'), r('M64', 'Mass matrix term'),
  r('M65', 'Mass matrix term'), r('M66', 'Mass matrix term'),
], { id: 'element' });

const scalarConn: FieldTuple[] = [
  g('G1', 'Grid or scalar point 1'), comp('C1'),
  g('G2', 'Grid or scalar point 2 (blank = grounded)'), comp('C2'),
];

card('CMASS1', EM, 'Scalar mass connection, property from PMASS', [EID, ['PID', 'I', 'PMASS property ID (default EID)', 'massProp'], ...scalarConn], { id: 'element' });
card('CMASS2', EM, 'Scalar mass with value given on the entry', [EID, r('M', 'Mass value'), ...scalarConn], { id: 'element' });
card('CELAS1', EM, 'Scalar spring connection, property from PELAS', [EID, ['PID', 'I', 'PELAS property ID (default EID)', 'elasProp'], ...scalarConn], { id: 'element' });
card('CELAS2', EM, 'Scalar spring with stiffness given on the entry', [
  EID, r('K', 'Stiffness'), ...scalarConn, r('GE', 'Structural damping coefficient'), r('S', 'Stress coefficient'),
], { id: 'element' });
card('CDAMP1', EM, 'Scalar damper connection, property from PDAMP', [EID, ['PID', 'I', 'PDAMP property ID (default EID)', 'dampProp'], ...scalarConn], { id: 'element' });
card('CDAMP2', EM, 'Scalar damper with value given on the entry', [EID, r('B', 'Damping value'), ...scalarConn], { id: 'element' });
card('CVISC', EM, 'Viscous damper (extensional and rotational) between two grids', [
  EID, ['PID', 'I', 'PVISC property ID (default EID)', 'viscProp'], gr('G1'), gr('G2'),
], { id: 'element' });

// ===========================================================================
// Line elements
// ===========================================================================
const EL = 'Elements: Line';

card('CROD', EL, 'Tension-compression-torsion rod element', [
  EID, ['PID', 'I', 'PROD property ID (default EID)', 'rodProp'], gr('G1'), gr('G2'),
], { id: 'element' });

card('CONROD', EL, 'Rod element with properties on the entry', [
  EID, gr('G1'), gr('G2'), ['MID', 'I!', 'Material ID', 'mat'],
  r('A', 'Cross-sectional area'), r('J', 'Torsional constant'), r('C', 'Torsional stress coefficient'), r('NSM', 'Nonstructural mass per unit length'),
], { id: 'element' });

card('CTUBE', EL, 'Tube element', [
  EID, ['PID', 'I', 'PTUBE property ID (default EID)', 'tubeProp'], gr('G1'), gr('G2'),
], { id: 'element' });

const orient: FieldTuple[] = [
  ['X1/G0', 'IR', 'Orientation: X1 of vector v (real) or grid G0 (integer) defining v from GA'],
  r('X2', 'Orientation vector v, component 2 (blank if G0 is used)'),
  r('X3', 'Orientation vector v, component 3 (blank if G0 is used)'),
];
const offsets: FieldTuple[] = [
  r('W1A', 'Offset vector at end A, component 1'), r('W2A', 'Offset vector at end A, component 2'), r('W3A', 'Offset vector at end A, component 3'),
  r('W1B', 'Offset vector at end B, component 1'), r('W2B', 'Offset vector at end B, component 2'), r('W3B', 'Offset vector at end B, component 3'),
];

card('CBAR', EL, 'Simple beam (bar) element', [
  EID, ['PID', 'I', 'PBAR/PBARL property ID (default EID)', 'barProp'], gr('GA', 'Grid at end A'), gr('GB', 'Grid at end B'),
  ...orient,
  ['OFFT', 'S', 'Offset vector interpretation, e.g. GGG (default), BGG, GGO, BOO ...'],
  ['PA', 'I', 'Pin flags at end A (released DOFs, 1-6)'],
  ['PB', 'I', 'Pin flags at end B (released DOFs, 1-6)'],
  ...offsets,
], { id: 'element' });

card('CBEAM', EL, 'Beam element (with warping and tapered properties)', [
  EID, ['PID', 'I', 'PBEAM/PBEAML/PBCOMP property ID (default EID)', 'beamProp'], gr('GA', 'Grid at end A'), gr('GB', 'Grid at end B'),
  ...orient,
  ['OFFT/BIT', 'RS', 'Offset vector interpretation (character) or built-in twist (real)'],
  ['PA', 'I', 'Pin flags at end A'],
  ['PB', 'I', 'Pin flags at end B'],
  ...offsets,
  g('SA', 'Scalar/grid point for warping DOF at end A'),
  g('SB', 'Scalar/grid point for warping DOF at end B'),
], { id: 'element' });

card('CBUSH', EL, 'Generalized spring-damper (bush) element', [
  EID, ['PID', 'I', 'PBUSH property ID (default EID)', 'bushProp'], gr('GA', 'Grid at end A'), g('GB', 'Grid at end B (blank = grounded)'),
  ['GO/X1', 'IR', 'Orientation: grid GO (integer) or X1 of vector (real)'],
  r('X2', 'Orientation vector, component 2'), r('X3', 'Orientation vector, component 3'),
  ['CID', 'I', 'Element coordinate system (overrides GO/X; 0 = basic)', 'coord'],
  r('S', 'Location of spring-damper along GA-GB (0.0-1.0, default 0.5)'),
  ['OCID', 'I', 'Coordinate system of the S1-S3 offset (-1 = use S)', 'coord'],
  r('S1', 'Offset component 1 in OCID'), r('S2', 'Offset component 2 in OCID'), r('S3', 'Offset component 3 in OCID'),
], { id: 'element' });

card('CBUSH1D', EL, 'Rod-type spring-damper element', [
  EID, ['PID', 'I', 'PBUSH1D property ID (default EID)', 'bush1dProp'], gr('GA'), g('GB'), ['CID', 'I', 'Element coordinate system', 'coord'],
], { id: 'element' });

card('CGAP', EL, 'Gap / contact element', [
  EID, ['PID', 'I', 'PGAP property ID (default EID)', 'gapProp'], gr('GA'), gr('GB'),
  ...orient,
  ['CID', 'I', 'Element coordinate system (overrides orientation vector)', 'coord'],
], { id: 'element' });

card('CFAST', EL, 'Shell-to-shell fastener element', [
  EID, ['PID', 'I', 'PFAST property ID (default EID)', 'fastProp'],
  ['TYPE', 'S!', 'Connection type: PROP or ELEM'],
  ['IDA', 'I!', 'Property or element ID of patch A'],
  ['IDB', 'I!', 'Property or element ID of patch B'],
  g('GS', 'Grid defining the fastener location'),
  g('GA', 'Grid on patch A'), g('GB', 'Grid on patch B'),
  r('XS', 'Location X (if GS blank)'), r('YS', 'Location Y'), r('ZS', 'Location Z'),
], { id: 'element' });

card('PLOTEL', EL, 'Plot-only line element (no stiffness)', [EID, gr('G1'), gr('G2')], { id: 'element' });

// ===========================================================================
// Shell elements
// ===========================================================================
const ES = 'Elements: Shell';
const shellPid: FieldTuple = ['PID', 'I', 'PSHELL/PCOMP/PCOMPG property ID (default EID)', 'shellProp'];
const theta: FieldTuple = ['THETA/MCID', 'IR', 'Material orientation: angle in degrees (real) or coordinate system ID (integer)'];
const zoffs: FieldTuple = r('ZOFFS', 'Offset of the element reference plane from the plane of the grids');
const tflag: FieldTuple = ['TFLAG', 'I', '0 = Ti are actual thicknesses, 1 = Ti are multipliers of T on PSHELL'];
const ti = (n: number): FieldTuple => r(`T${n}`, `Membrane thickness at grid G${n}`);

for (const name of ['CQUAD4', 'CQUADR']) {
  card(name, ES, name === 'CQUAD4' ? 'Isoparametric 4-node quadrilateral plate/shell element' : '4-node quadrilateral shell with drilling DOF', [
    EID, shellPid, gr('G1'), gr('G2'), gr('G3'), gr('G4'), theta, zoffs,
    _, tflag, ti(1), ti(2), ti(3), ti(4),
  ], { id: 'element' });
}
for (const name of ['CTRIA3', 'CTRIAR']) {
  card(name, ES, name === 'CTRIA3' ? 'Isoparametric 3-node triangular plate/shell element' : '3-node triangular shell with drilling DOF', [
    EID, shellPid, gr('G1'), gr('G2'), gr('G3'), theta, zoffs, _,
    _, tflag, ti(1), ti(2), ti(3),
  ], { id: 'element' });
}
card('CQUAD8', ES, '8-node curved quadrilateral shell element', [
  EID, shellPid, gr('G1'), gr('G2'), gr('G3'), gr('G4'), g('G5', 'Mid-side grid'), g('G6', 'Mid-side grid'),
  g('G7', 'Mid-side grid'), g('G8', 'Mid-side grid'), ti(1), ti(2), ti(3), ti(4), theta, zoffs,
  tflag,
], { id: 'element' });
card('CTRIA6', ES, '6-node curved triangular shell element', [
  EID, shellPid, gr('G1'), gr('G2'), gr('G3'), g('G4', 'Mid-side grid'), g('G5', 'Mid-side grid'), g('G6', 'Mid-side grid'),
  theta, zoffs, ti(1), ti(2), ti(3), tflag,
], { id: 'element' });
card('CSHEAR', ES, '4-node shear panel element', [
  EID, ['PID', 'I', 'PSHEAR property ID (default EID)', 'shearProp'], gr('G1'), gr('G2'), gr('G3'), gr('G4'),
], { id: 'element' });

// ===========================================================================
// Solid elements
// ===========================================================================
const EV = 'Elements: Solid';
const solidPid: FieldTuple = ['PID', 'I!', 'PSOLID/PCOMPS property ID', 'solidProp'];
function solid(name: string, desc: string, corner: number, total: number) {
  const fs: FieldTuple[] = [EID, solidPid];
  for (let i = 1; i <= total; i++) {
    fs.push(i <= corner ? gr(`G${i}`, 'Corner grid') : g(`G${i}`, 'Mid-side grid (optional)'));
  }
  card(name, EV, desc, fs, { id: 'element' });
}
solid('CHEXA', '6-sided solid element (8-20 grids)', 8, 20);
solid('CPENTA', '5-sided wedge solid element (6-15 grids)', 6, 15);
solid('CTETRA', '4-sided tetrahedral solid element (4-10 grids)', 4, 10);
solid('CPYRAM', '5-sided pyramid solid element (5-13 grids)', 5, 13);

// ===========================================================================
// Rigid elements
// ===========================================================================
const ER = 'Elements: Rigid';

card('RBE2', ER, 'Rigid body: dependent grids GMi follow independent grid GN', [
  EID, gr('GN', 'Independent grid'), ['CM', 'I!', 'Dependent components (1-6)'],
], {
  id: 'element',
  repeat: { from: 3, fields: [['GM{n}', 'A', 'Dependent grid (an optional thermal expansion ALPHA may follow the last grid)', 'grid']] },
});

card('RBE3', ER, 'Interpolation element: reference grid motion = weighted average of independent grids', [
  EID, _, gr('REFGRID', 'Reference (dependent) grid'), ['REFC', 'I!', 'Reference grid components'],
], {
  id: 'element',
  repeat: { from: 4, fields: [['WT/C/G', 'A', 'Weight factor (real), component numbers (int) and grids; optional UM, ALPHA, TREF blocks follow']] },
});

card('RBAR', ER, 'Rigid bar between two grids', [
  EID, gr('GA'), gr('GB'),
  ['CNA', 'I', 'Independent components at GA'], ['CNB', 'I', 'Independent components at GB'],
  ['CMA', 'I', 'Dependent components at GA'], ['CMB', 'I', 'Dependent components at GB'],
  r('ALPHA', 'Thermal expansion coefficient'),
  r('TREF', 'Reference temperature'),
], { id: 'element' });

card('RBE1', ER, 'Rigid body connected to an arbitrary number of grids (independent/dependent sets)', [EID], {
  id: 'element',
  repeat: { from: 1, fields: [['GNi/CNi/UM/GMi', 'A', 'Independent grid/component pairs, then UM followed by dependent grid/component pairs']] },
});

// ===========================================================================
// Properties
// ===========================================================================
const P = 'Properties';
const PID: FieldTuple = ['PID', 'I!', 'Property identification number'];
const mat = (n: string, desc = 'Material ID'): FieldTuple => [n, 'I', desc, 'mat'];

card('PSHELL', P, 'Shell element property (membrane, bending, transverse shear, coupling)', [
  PID,
  mat('MID1', 'Membrane material ID'),
  r('T', 'Default membrane thickness'),
  mat('MID2', 'Bending material ID (-1 = plane strain)'),
  r('12I/T**3', 'Bending moment of inertia ratio 12I/T^3 (default 1.0)'),
  mat('MID3', 'Transverse shear material ID'),
  r('TS/T', 'Transverse shear thickness ratio (default 0.833333)'),
  r('NSM', 'Nonstructural mass per unit area'),
  r('Z1', 'Fiber distance for stress output (default -T/2)'),
  r('Z2', 'Fiber distance for stress output (default +T/2)'),
  mat('MID4', 'Membrane-bending coupling material ID'),
], { id: 'property' });

card('PCOMP', P, 'Layered composite shell property (plies listed bottom to top)', [
  PID,
  r('Z0', 'Distance from reference plane to bottom surface (default -half thickness)'),
  r('NSM', 'Nonstructural mass per unit area'),
  r('SB', 'Allowable interlaminar shear stress (required if FT is given)'),
  ['FT', 'S', 'Failure theory: HILL, HOFF, TSAI, STRN, ...'],
  r('TREF', 'Reference temperature'),
  r('GE', 'Damping coefficient'),
  ['LAM', 'S', 'Laminate option: blank, SYM, MEM, BEND, SMEAR, SMCORE'],
], {
  id: 'property',
  repeat: {
    from: 8,
    fields: [
      mat('MID{n}', 'Material ID of ply {n} (blank = same as previous ply)'),
      r('T{n}', 'Thickness of ply {n} (blank = same as previous ply)'),
      r('THETA{n}', 'Orientation angle of ply {n} (degrees)'),
      ['SOUT{n}', 'S', 'Stress/strain output for ply {n}: YES or NO'],
    ],
  },
});

card('PCOMPG', P, 'Layered composite shell property with global ply IDs', [
  PID,
  r('Z0', 'Distance from reference plane to bottom surface'),
  r('NSM', 'Nonstructural mass per unit area'),
  r('SB', 'Allowable interlaminar shear stress'),
  ['FT', 'S', 'Failure theory: HILL, HOFF, TSAI, STRN, ...'],
  r('TREF', 'Reference temperature'),
  r('GE', 'Damping coefficient'),
  ['LAM', 'S', 'Laminate option: blank, MEM, BEND, SMEAR, SMCORE'],
], {
  id: 'property',
  repeat: {
    from: 8,
    fields: [
      ['GPLYID{n}', 'I', 'Global ply ID of ply {n}'],
      mat('MID{n}', 'Material ID of ply {n}'),
      r('T{n}', 'Thickness of ply {n}'),
      r('THETA{n}', 'Orientation angle of ply {n} (degrees)'),
      ['SOUT{n}', 'S', 'Stress/strain output: YES or NO'],
      _, _, _,
    ],
  },
});

card('PSOLID', P, 'Solid element property', [
  PID, ['MID', 'I!', 'Material ID', 'mat'],
  ['CORDM', 'I', 'Material coordinate system (-1 = element system, 0 = basic)', 'coord'],
  ['IN', 'IS', 'Integration network: 0/BUBBLE, 1/GAUSS, 2/TWO, 3/THREE'],
  ['STRESS', 'IS', 'Stress output location: 0/GRID or 1/GAUSS'],
  ['ISOP', 'IS', 'Integration scheme: 0/REDUCED, 1/FULL'],
  ['FCTN', 'S', 'Element type: SMECH (default), PFLUID, FFLUID'],
], { id: 'property' });

card('PROD', P, 'Rod property', [
  PID, ['MID', 'I!', 'Material ID', 'mat'], r('A', 'Area'), r('J', 'Torsional constant'), r('C', 'Torsional stress coefficient'), r('NSM', 'Nonstructural mass per unit length'),
], { id: 'property' });

card('PTUBE', P, 'Tube property', [
  PID, ['MID', 'I!', 'Material ID', 'mat'], r('OD', 'Outside diameter at end A'), r('T', 'Wall thickness (blank = solid rod)'), r('NSM', 'Nonstructural mass per unit length'), r('OD2', 'Outside diameter at end B'),
], { id: 'property' });

card('PBAR', P, 'Simple beam (bar) property', [
  PID, ['MID', 'I!', 'Material ID', 'mat'],
  r('A', 'Area'), r('I1', 'Area moment of inertia I1 (bending in plane 1)'), r('I2', 'Area moment of inertia I2 (bending in plane 2)'), r('J', 'Torsional constant'), r('NSM', 'Nonstructural mass per unit length'), _,
  r('C1', 'Stress recovery point C, y'), r('C2', 'Stress recovery point C, z'), r('D1', 'Stress recovery point D, y'), r('D2', 'Stress recovery point D, z'),
  r('E1', 'Stress recovery point E, y'), r('E2', 'Stress recovery point E, z'), r('F1', 'Stress recovery point F, y'), r('F2', 'Stress recovery point F, z'),
  r('K1', 'Shear area factor plane 1'), r('K2', 'Shear area factor plane 2'), r('I12', 'Product of inertia'),
], { id: 'property' });

card('PBARL', P, 'Bar property from cross-section dimensions (ROD, TUBE, I, CHAN, T, BOX, BAR, ...)', [
  PID, ['MID', 'I!', 'Material ID', 'mat'],
  ['GROUP', 'S', 'Cross-section group (default MSCBML0)'],
  ['TYPE', 'S!', 'Cross-section type: ROD, TUBE, I, CHAN, T, BOX, BAR, CROSS, H, T1, I1, CHAN1, Z, CHAN2, T2, BOX1, HEXA, HAT, HAT1, DBOX, L'],
  _, _, _, _,
], {
  id: 'property',
  repeat: { from: 8, fields: [r('DIM{n}', 'Cross-section dimension {n} (the value after the last dimension is NSM)')] },
});

card('PBEAM', P, 'Beam property (end A, optional intermediate stations, end B)', [
  PID, ['MID', 'I!', 'Material ID', 'mat'],
  r('A(A)', 'Area at end A'), r('I1(A)', 'I1 at end A'), r('I2(A)', 'I2 at end A'), r('I12(A)', 'I12 at end A'), r('J(A)', 'Torsional constant at end A'), r('NSM(A)', 'Nonstructural mass at end A'),
  r('C1(A)', 'Stress point C, y'), r('C2(A)', 'Stress point C, z'), r('D1(A)', 'Stress point D, y'), r('D2(A)', 'Stress point D, z'),
  r('E1(A)', 'Stress point E, y'), r('E2(A)', 'Stress point E, z'), r('F1(A)', 'Stress point F, y'), r('F2(A)', 'Stress point F, z'),
], {
  id: 'property',
  repeat: {
    from: 16,
    fields: [
      ['SO', 'S', 'Stress output at this station: YES, YESA, NO'], r('X/XB', 'Station location as fraction of length (1.0 = end B)'),
      r('A', 'Area'), r('I1', 'I1'), r('I2', 'I2'), r('I12', 'I12'), r('J', 'Torsional constant'), r('NSM', 'Nonstructural mass'),
      r('C1', 'Stress point C, y'), r('C2', 'Stress point C, z'), r('D1', 'Stress point D, y'), r('D2', 'Stress point D, z'),
      r('E1', 'Stress point E, y'), r('E2', 'Stress point E, z'), r('F1', 'Stress point F, y'), r('F2', 'Stress point F, z'),
    ],
  },
  notes: 'After the station blocks come two optional lines: K1 K2 S1 S2 NSI(A) NSI(B) CW(A) CW(B) and M1(A) M2(A) M1(B) M2(B) N1(A) N2(A) N1(B) N2(B). Field names shown for those lines follow the station pattern.',
});

card('PBEAML', P, 'Beam property from cross-section dimensions, optionally tapered', [
  PID, ['MID', 'I!', 'Material ID', 'mat'], ['GROUP', 'S', 'Cross-section group (default MSCBML0)'], ['TYPE', 'S!', 'Cross-section type (ROD, TUBE, I, CHAN, T, BOX, BAR, ...)'], _, _, _, _,
], {
  id: 'property',
  repeat: { from: 8, fields: [['DIM/NSM/SO/X', 'A', 'Dimensions DIM1..n and NSM at end A, then optional SO, X/XB, dims, NSM for further stations']] },
});

card('PSHEAR', P, 'Shear panel property', [
  PID, ['MID', 'I!', 'Material ID', 'mat'], r('T', 'Thickness'), r('NSM', 'Nonstructural mass per unit area'), r('F1', 'Effectiveness factor for extensional stiffness along edges 1-2 and 3-4'), r('F2', 'Effectiveness factor along edges 2-3 and 1-4'),
], { id: 'property' });

card('PELAS', P, 'Scalar spring property (one or two properties per entry)', [
  PID, r('K1', 'Stiffness'), r('GE1', 'Damping coefficient'), r('S1', 'Stress coefficient'),
  ['PID2', 'I', 'Second property ID'], r('K2', 'Stiffness'), r('GE2', 'Damping coefficient'), r('S2', 'Stress coefficient'),
], { id: 'property' });

card('PDAMP', P, 'Scalar damper property (up to four per entry)', [
  PID, r('B1', 'Damping value'), ['PID2', 'I', 'Property ID'], r('B2', 'Damping value'), ['PID3', 'I', 'Property ID'], r('B3', 'Damping value'), ['PID4', 'I', 'Property ID'], r('B4', 'Damping value'),
], { id: 'property' });

card('PMASS', P, 'Scalar mass property (up to four per entry)', [
  PID, r('M1', 'Mass value'), ['PID2', 'I', 'Property ID'], r('M2', 'Mass value'), ['PID3', 'I', 'Property ID'], r('M3', 'Mass value'), ['PID4', 'I', 'Property ID'], r('M4', 'Mass value'),
], { id: 'property' });

card('PVISC', P, 'Viscous damper property', [
  PID, r('CE1', 'Extensional damping'), r('CR1', 'Rotational damping'), ['PID2', 'I', 'Second property ID'], r('CE2', 'Extensional damping'), r('CR2', 'Rotational damping'),
], { id: 'property' });

card('PBUSH', P, 'Bush property: flagged lines K (stiffness), B (damping), GE (structural damping), RCV (stress/strain recovery)', [
  PID, ['FLAG', 'S', 'Line flag: K, B, GE, RCV or M'],
  r('V1', 'K1 / B1 / GE1 / SA (depends on the flag)'), r('V2', 'K2 / B2 / GE2 / ST'), r('V3', 'K3 / B3 / GE3 / EA'),
  r('V4', 'K4 / B4 / GE4 / ET'), r('V5', 'K5 / B5 / GE5'), r('V6', 'K6 / B6 / GE6'),
], {
  id: 'property',
  repeat: {
    from: 8,
    fields: [_, ['FLAG', 'S', 'Line flag: K, B, GE, RCV or M'], ['V1', 'R', 'Value 1 for this flag'], ['V2', 'R', 'Value 2'], ['V3', 'R', 'Value 3'], ['V4', 'R', 'Value 4'], ['V5', 'R', 'Value 5'], ['V6', 'R', 'Value 6']],
  },
});

card('PBUSH1D', P, 'CBUSH1D property', [
  PID, r('K', 'Stiffness'), r('C', 'Viscous damping'), r('M', 'Mass'), _, r('SA', 'Stress recovery coefficient'), r('SE', 'Strain recovery coefficient'),
], { id: 'property' });

card('PGAP', P, 'Gap element property', [
  PID, r('U0', 'Initial gap opening'), r('F0', 'Preload'), r('KA', 'Axial stiffness when closed'), r('KB', 'Axial stiffness when open'),
  r('KT', 'Transverse stiffness when closed'), r('MU1', 'Static friction coefficient'), r('MU2', 'Kinetic friction coefficient'),
  r('TMAX', 'Maximum allowable penetration'), r('MAR', 'Max adjustment ratio'), r('TRMIN', 'Fraction of TMAX for lower bound'),
], { id: 'property' });

card('PFAST', P, 'CFAST fastener property', [
  PID, r('D', 'Fastener diameter'), ['MCID', 'I', 'Stiffness coordinate system', 'coord'], ['MFLAG', 'I', '0 = MCID relative, 1 = absolute'],
  r('KT1', 'Translational stiffness 1'), r('KT2', 'Translational stiffness 2'), r('KT3', 'Translational stiffness 3'), r('KR1', 'Rotational stiffness 1'),
  r('KR2', 'Rotational stiffness 2'), r('KR3', 'Rotational stiffness 3'), r('MASS', 'Lumped mass'), r('GE', 'Structural damping'),
], { id: 'property' });

// ===========================================================================
// Materials
// ===========================================================================
const M = 'Materials';
const MID: FieldTuple = ['MID', 'I!', 'Material identification number'];

card('MAT1', M, 'Isotropic material (give two of E, G, NU)', [
  MID, r('E', "Young's modulus"), r('G', 'Shear modulus'), r('NU', "Poisson's ratio"), r('RHO', 'Mass density'),
  r('A', 'Thermal expansion coefficient'), r('TREF', 'Reference temperature'), r('GE', 'Structural damping coefficient'),
  r('ST', 'Tension stress limit (for margins)'), r('SC', 'Compression stress limit'), r('SS', 'Shear stress limit'),
  ['MCSID', 'I', 'Material coordinate system for stress output (CQUAD/CTRIA)', 'coord'],
], { id: 'material' });

card('MAT2', M, 'Anisotropic material for shells (2D)', [
  MID, r('G11', 'Material property matrix term'), r('G12', 'Material property matrix term'), r('G13', 'Material property matrix term'),
  r('G22', 'Material property matrix term'), r('G23', 'Material property matrix term'), r('G33', 'Material property matrix term'), r('RHO', 'Mass density'),
  r('A1', 'Thermal expansion coefficient'), r('A2', 'Thermal expansion coefficient'), r('A3', 'Thermal expansion coefficient'), r('TREF', 'Reference temperature'),
  r('GE', 'Structural damping'), r('ST', 'Tension stress limit'), r('SC', 'Compression stress limit'), r('SS', 'Shear stress limit'),
  ['MCSID', 'I', 'Material coordinate system for stress output', 'coord'],
], { id: 'material' });

card('MAT8', M, 'Orthotropic material for shells (2D), e.g. composite plies', [
  MID, r('E1', 'Modulus in longitudinal (1) direction'), r('E2', 'Modulus in lateral (2) direction'), r('NU12', "Poisson's ratio (e2/e1 for uniaxial load in 1)"),
  r('G12', 'In-plane shear modulus'), r('G1Z', 'Transverse shear modulus 1-Z'), r('G2Z', 'Transverse shear modulus 2-Z'), r('RHO', 'Mass density'),
  r('A1', 'Thermal expansion coefficient, 1 direction'), r('A2', 'Thermal expansion coefficient, 2 direction'), r('TREF', 'Reference temperature'),
  r('Xt', 'Allowable stress/strain, tension, 1 direction'), r('Xc', 'Allowable, compression, 1 direction'),
  r('Yt', 'Allowable, tension, 2 direction'), r('Yc', 'Allowable, compression, 2 direction'), r('S', 'Allowable in-plane shear'),
  r('GE', 'Structural damping'), r('F12', 'Tsai-Wu interaction term'), r('STRN', '1.0 = Xt..S are strain allowables'),
], { id: 'material' });

card('MAT9', M, 'Anisotropic material for solids (3D)', [
  MID, r('G11', 'Matrix term'), r('G12', 'Matrix term'), r('G13', 'Matrix term'), r('G14', 'Matrix term'), r('G15', 'Matrix term'), r('G16', 'Matrix term'), r('G22', 'Matrix term'),
  r('G23', 'Matrix term'), r('G24', 'Matrix term'), r('G25', 'Matrix term'), r('G26', 'Matrix term'), r('G33', 'Matrix term'), r('G34', 'Matrix term'), r('G35', 'Matrix term'), r('G36', 'Matrix term'),
  r('G44', 'Matrix term'), r('G45', 'Matrix term'), r('G46', 'Matrix term'), r('G55', 'Matrix term'), r('G56', 'Matrix term'), r('G66', 'Matrix term'), r('RHO', 'Mass density'), r('A1', 'Thermal expansion'),
  r('A2', 'Thermal expansion'), r('A3', 'Thermal expansion'), r('A4', 'Thermal expansion'), r('A5', 'Thermal expansion'), r('A6', 'Thermal expansion'), r('TREF', 'Reference temperature'), r('GE', 'Structural damping'),
], { id: 'material' });

card('MAT10', M, 'Fluid material (acoustics)', [
  MID, r('BULK', 'Bulk modulus'), r('RHO', 'Mass density'), r('C', 'Speed of sound'), r('GE', 'Fluid damping'), r('ALPHA', 'Normalized admittance coefficient'),
], { id: 'material' });

card('MAT4', M, 'Isotropic thermal material', [
  MID, r('K', 'Thermal conductivity'), r('CP', 'Heat capacity per unit mass'), r('RHO', 'Density'), r('H', 'Free convection coefficient'), r('MU', 'Dynamic viscosity'), r('HGEN', 'Heat generation multiplier'), r('REFENTH', 'Reference enthalpy'),
  r('TCH', 'Lower phase change temperature'), r('TDELTA', 'Phase change temperature range'), r('QLAT', 'Latent heat'),
]);

const tm = (n: string, desc: string): FieldTuple => [n, 'I', desc, 'tablem'];
card('MATT1', M, 'Temperature-dependent MAT1 properties (TABLEMi IDs)', [
  ['MID', 'I!', 'MAT1 material ID', 'mat'], tm('T(E)', 'Table for E'), tm('T(G)', 'Table for G'), tm('T(NU)', 'Table for NU'), tm('T(RHO)', 'Table for RHO'), tm('T(A)', 'Table for A'), _, tm('T(GE)', 'Table for GE'),
  tm('T(ST)', 'Table for ST'), tm('T(SC)', 'Table for SC'), tm('T(SS)', 'Table for SS'),
]);

card('MATS1', M, 'Stress-dependent (nonlinear) material properties', [
  ['MID', 'I!', 'MAT1 material ID', 'mat'], ['TID', 'I', 'TABLES1 stress-strain table ID', 'table'],
  ['TYPE', 'S', 'Nonlinearity type: NLELAST or PLASTIC'], r('H', 'Work hardening slope (PLASTIC only)'),
  ['YF', 'I', 'Yield function: 1 von Mises, 2 Tresca, 3 Mohr-Coulomb, 4 Drucker-Prager'], ['HR', 'I', 'Hardening rule: 1 isotropic, 2 kinematic, 3 combined'],
  r('LIMIT1', 'Initial yield point'), r('LIMIT2', 'Internal friction angle (Mohr-Coulomb / Drucker-Prager)'),
]);

// ===========================================================================
// Tables
// ===========================================================================
const T = 'Tables';
const xy: FieldTuple[] = [['x{n}', 'RS', 'Abscissa (x) value (or ENDT / SKIP)'], ['y{n}', 'RS', 'Ordinate (y) value']];

card('TABLED1', T, 'Dynamic load tabular function y(x), linear or log interpolation', [
  ['TID', 'I!', 'Table identification number'], ['XAXIS', 'S', 'LINEAR or LOG'], ['YAXIS', 'S', 'LINEAR or LOG'], ['EXTRAP', 'I', 'Extrapolation: 0 = linear (default), 1 = no extrapolation'], _, _, _, _,
], { id: undefined, repeat: { from: 8, fields: xy } });
card('TABLED2', T, 'Dynamic load table y(x - X1)', [['TID', 'I!', 'Table ID'], r('X1', 'Shift'), ['EXTRAP', 'I', 'Extrapolation: 0 = linear (default), 1 = no extrapolation'], _, _, _, _, _], { repeat: { from: 8, fields: xy } });
card('TABLEM1', T, 'Material property table y(x), linear or log interpolation', [
  ['TID', 'I!', 'Table identification number'], ['XAXIS', 'S', 'LINEAR or LOG'], ['YAXIS', 'S', 'LINEAR or LOG'], _, _, _, _, _,
], { repeat: { from: 8, fields: xy } });
card('TABLEM2', T, 'Material property table y(x - X1) scaled', [['TID', 'I!', 'Table ID'], r('X1', 'Shift'), ['EXTRAP', 'I', 'Extrapolation: 0 = linear (default), 1 = no extrapolation'], _, _, _, _, _], { repeat: { from: 8, fields: xy } });
card('TABLES1', T, 'Stress-strain (or force-displacement) table for nonlinear materials', [
  ['TID', 'I!', 'Table ID'], ['TYPE', 'I', '1 = stress vs total strain, 2 = stress vs plastic strain'], _, _, _, _, _, _,
], { repeat: { from: 8, fields: xy } });
card('TABDMP1', T, 'Modal damping table g(f)', [
  ['TID', 'I!', 'Table ID'], ['TYPE', 'S', 'Damping type: G (default), CRIT, Q'], _, _, _, _, _, _,
], { repeat: { from: 8, fields: [['f{n}', 'RS', 'Frequency (or ENDT)'], ['g{n}', 'R', 'Damping value']] } });
card('TABRND1', T, 'Power spectral density table', [
  ['TID', 'I!', 'Table ID'], ['XAXIS', 'S', 'LINEAR or LOG'], ['YAXIS', 'S', 'LINEAR or LOG'], _, _, _, _, _,
], { repeat: { from: 8, fields: [['f{n}', 'RS', 'Frequency (or ENDT)'], ['g{n}', 'R', 'PSD value']] } });

// ===========================================================================
// Constraints
// ===========================================================================
const C = 'Constraints';
const SID: FieldTuple = ['SID', 'I!', 'Set identification number'];

card('SPC', C, 'Single-point constraint with enforced value (up to two grids per entry)', [
  SID, gr('G1'), comp('C1'), r('D1', 'Enforced displacement value'), g('G2'), comp('C2'), r('D2', 'Enforced displacement value'),
]);
card('SPC1', C, 'Single-point constraint of components C on a list of grids', [
  SID, ['C', 'I!', 'Constrained components (any combination of 1-6)'],
], { repeat: { from: 2, fields: [['G{n}', 'IS', 'Grid ID (or THRU)', 'grid']] } });
card('SPCADD', C, 'Union of SPC sets', [SID], { repeat: { from: 1, fields: [['S{n}', 'I', 'SPC set ID', 'spcSet']] } });
card('SPCD', C, 'Enforced displacement (referenced as a load set, constraint must also be on SPC/SPC1)', [
  SID, gr('G1'), comp('C1'), r('D1', 'Enforced displacement'), g('G2'), comp('C2'), r('D2', 'Enforced displacement'),
]);
card('MPC', C, 'Multipoint constraint: sum(A_i * u_i) = 0, first term is dependent', [
  SID, gr('G1', 'Grid of the dependent term'), comp('C1'), r('A1', 'Coefficient'), g('G2'), comp('C2'), r('A2', 'Coefficient'), _,
], {
  repeat: {
    from: 8, start: 3, step: 2,
    fields: [_, g('G{n}'), comp('C{n}'), r('A{n}', 'Coefficient'), g('G{m}'), comp('C{m}'), r('A{m}', 'Coefficient'), _],
  },
});
card('MPCADD', C, 'Union of MPC sets', [SID], { repeat: { from: 1, fields: [['S{n}', 'I', 'MPC set ID', 'mpcSet']] } });
card('SUPORT', C, 'Reference DOFs for free-body (inertia relief / rigid body) analysis', [], {
  repeat: { from: 0, fields: [g('ID{n}'), comp('C{n}')] },
});
card('SUPORT1', C, 'Reference DOFs selected by the SUPORT1 case control command', [SID], {
  repeat: { from: 1, fields: [g('ID{n}'), comp('C{n}')] },
});
// Paired form: up to four grid/component pairs on a single line (no continuation).
const DOF_SET_NOTES: Record<string, string> = {
  ASET: 'Members of the a-set are retained in static condensation / dynamic reduction. When ASET/ASET1 entries are present, all other DOFs that are not otherwise constrained go to the o-set. A DOF may not also be on an entry that defines another mutually exclusive set (SPC, OMIT, MPC dependent, ...).',
  BSET: 'b-set DOFs are a-set DOFs held fixed during component mode synthesis / generalized dynamic reduction.',
  CSET: 'c-set DOFs are a-set DOFs left free during component mode synthesis / generalized dynamic reduction.',
  QSET: 'q-set DOFs are generalized coordinates; normally scalar points (SPOINT) with component 0 or blank.',
  OMIT: 'o-set DOFs are removed by static condensation (Guyan reduction). Not to be used together with ASET on the same DOF.',
};
for (const [name, desc] of [['ASET', 'analysis set (a-set)'], ['BSET', 'fixed boundary set for component modes'], ['CSET', 'free boundary set for component modes'], ['QSET', 'generalized coordinates (q-set)'], ['OMIT', 'omitted set (o-set)']]) {
  card(name, C, `Degrees of freedom in the ${desc}, as grid/component pairs`, [
    gr('ID1', 'Grid or scalar point ID'), comp('C1'),
    g('ID2', 'Grid or scalar point ID'), comp('C2'),
    g('ID3', 'Grid or scalar point ID'), comp('C3'),
    g('ID4', 'Grid or scalar point ID'), comp('C4'),
  ], { notes: DOF_SET_NOTES[name] });
}
for (const [name, desc] of [['ASET1','analysis set (a-set)'], ['BSET1', 'fixed boundary set for component modes'], ['CSET1', 'free boundary set for component modes'], ['QSET1', 'generalized coordinates (q-set)'], ['OMIT1', 'omitted set (o-set)']]) {
  card(name, C, `Degrees of freedom in the ${desc}`, [['C', 'I!', 'Component numbers']], {
    repeat: { from: 1, fields: [['G{n}', 'IS', 'Grid ID (or THRU)', 'grid']] },
  });
}

// ===========================================================================
// Static loads
// ===========================================================================
const L = 'Loads';
const cidL: FieldTuple = ['CID', 'I', 'Coordinate system of the direction vector', 'coord'];

card('FORCE', L, 'Static force at a grid: F * (N1, N2, N3)', [
  SID, gr('G'), cidL, r('F', 'Scale factor'), r('N1', 'Direction vector component 1'), r('N2', 'Direction vector component 2'), r('N3', 'Direction vector component 3'),
]);
card('MOMENT', L, 'Static moment at a grid: M * (N1, N2, N3)', [
  SID, gr('G'), cidL, r('M', 'Scale factor'), r('N1', 'Direction vector component 1'), r('N2', 'Direction vector component 2'), r('N3', 'Direction vector component 3'),
]);
card('FORCE1', L, 'Force at a grid, direction from G1 to G2', [SID, gr('G'), r('F', 'Magnitude'), gr('G1'), gr('G2')]);
card('MOMENT1', L, 'Moment at a grid, direction from G1 to G2', [SID, gr('G'), r('M', 'Magnitude'), gr('G1'), gr('G2')]);
card('FORCE2', L, 'Force at a grid, direction = (G2-G1) x (G4-G3)', [SID, gr('G'), r('F', 'Magnitude'), gr('G1'), gr('G2'), g('G3'), g('G4')]);
card('MOMENT2', L, 'Moment at a grid, direction = (G2-G1) x (G4-G3)', [SID, gr('G'), r('M', 'Magnitude'), gr('G1'), gr('G2'), g('G3'), g('G4')]);
card('PLOAD', L, 'Uniform pressure on a triangle or quadrilateral defined by grids', [SID, r('P', 'Pressure'), gr('G1'), gr('G2'), gr('G3'), g('G4')]);
card('PLOAD1', L, 'Concentrated or distributed load on CBAR/CBEAM/CBEND', [
  SID, ['EID', 'I!', 'Element ID', 'elem'],
  ['TYPE', 'S!', 'Load type: FX, FY, FZ, FXE, FYE, FZE, MX, MY, MZ, MXE, MYE, MZE'],
  ['SCALE', 'S!', 'Scale for X: LE, FR, LEPR, FRPR'],
  r('X1', 'Start location'), r('P1', 'Load at X1'), r('X2', 'End location (blank = concentrated)'), r('P2', 'Load at X2'),
]);
card('PLOAD2', L, 'Uniform normal pressure on 2D elements (CQUAD4, CTRIA3, CSHEAR ...)', [SID, r('P', 'Pressure')], {
  repeat: { from: 2, fields: [['EID{n}', 'IS', 'Element ID (or THRU)', 'elem']] },
});
card('PLOAD4', L, 'Pressure on a face of a shell or solid element', [
  SID, ['EID', 'I!', 'Element ID', 'elem'],
  r('P1', 'Pressure at corner 1 (default for P2-P4)'), r('P2', 'Pressure at corner 2'), r('P3', 'Pressure at corner 3'), r('P4', 'Pressure at corner 4'),
  ['G1/THRU', 'IS', 'Solid: grid on the loaded face; shell: THRU for a range of elements', 'grid'],
  ['G3/G4/EID2', 'I', 'Solid: diagonal grid (CHEXA/CPENTA quad face) or opposite grid (CTETRA); shell: last element of THRU range'],
  cidL, r('N1', 'Load direction (blank = normal)'), r('N2', 'Load direction'), r('N3', 'Load direction'),
  ['SORL', 'S', 'SURF (default) or LINE'], ['LDIR', 'S', 'Load direction for LINE: NORM, X, Y, Z, TANG'],
]);
card('GRAV', L, 'Gravity / acceleration load', [
  SID, ['CID', 'I', 'Coordinate system of the vector', 'coord'], r('A', 'Acceleration scale factor'),
  r('N1', 'Acceleration vector component 1'), r('N2', 'Acceleration vector component 2'), r('N3', 'Acceleration vector component 3'),
  ['MB', 'I', '-1 = main bulk data only, 0 = all (default)'],
]);
card('RFORCE', L, 'Centrifugal (rotational) load', [
  SID, g('G', 'Grid on the axis of rotation (0 = basic origin)'), ['CID', 'I', 'Coordinate system of the rotation vector', 'coord'],
  r('A', 'Rotational speed scale (rev per unit time)'), r('R1', 'Rotation vector component 1'), r('R2', 'Rotation vector component 2'), r('R3', 'Rotation vector component 3'),
  ['METHOD', 'I', '1 = consistent (default), 2 = lumped'],
  r('RACC', 'Rotational acceleration scale'), ['MB', 'I', 'Mass/body option'], ['IDRF', 'I', 'RFORCE1 ID'],
]);
card('LOAD', L, 'Static load combination: S * sum(Si * Li)', [SID, r('S', 'Overall scale factor')], {
  repeat: { from: 2, fields: [r('S{n}', 'Scale factor for load set L{n}'), ['L{n}', 'I', 'Load set ID', 'loadSet']] },
});
card('SLOAD', L, 'Static load on scalar points', [SID], {
  repeat: { from: 1, fields: [['S{n}', 'I', 'Scalar or grid point ID', 'grid'], r('F{n}', 'Load value')] },
});
card('TEMP', L, 'Grid point temperatures', [SID, gr('G1'), r('T1', 'Temperature'), g('G2'), r('T2', 'Temperature'), g('G3'), r('T3', 'Temperature')]);
card('TEMPD', L, 'Default temperature for a temperature set', [], {
  repeat: { from: 0, fields: [['SID{n}', 'I', 'Temperature set ID'], r('T{n}', 'Default temperature')] },
});

// ===========================================================================
// Dynamics
// ===========================================================================
const D = 'Dynamics';

card('EIGRL', D, 'Real eigenvalue extraction using the Lanczos method', [
  SID, r('V1', 'Lower frequency bound (cycles/time; eigenvalue for buckling)'), r('V2', 'Upper frequency bound'), ['ND', 'I', 'Number of roots desired'],
  ['MSGLVL', 'I', 'Diagnostic level 0-4'], ['MAXSET', 'I', 'Number of vectors in block/set'], r('SHFSCL', 'Estimate of the first flexible mode frequency'),
  ['NORM', 'S', 'Normalization: MASS (default), MAX'],
]);
card('EIGR', D, 'Real eigenvalue extraction (methods other than Lanczos)', [
  SID, ['METHOD', 'S', 'Method: AHOU, MHOU, INV, SINV, GIV, MGIV, LAN'], r('F1', 'Lower frequency'), r('F2', 'Upper frequency'),
  ['NE', 'I', 'Estimated number of roots'], ['ND', 'I', 'Desired number of roots'], _, ['', 'A', 'Method dependent (see QRG)'],
  ['NORM', 'S', 'Normalization: MASS, MAX, POINT'], g('G', 'Grid for POINT normalization'), comp('C', 'Component for POINT normalization'),
]);
card('EIGB', D, 'Buckling eigenvalue extraction (inverse power)', [
  SID, ['METHOD', 'S', 'INV or SINV'], r('L1', 'Lower eigenvalue bound'), r('L2', 'Upper eigenvalue bound'), ['NEP', 'I', 'Estimated roots'], ['NDP', 'I', 'Desired positive roots'], ['NDN', 'I', 'Desired negative roots'], _,
  ['NORM', 'S', 'MAX or POINT'], g('G'), comp('C'),
]);
card('EIGC', D, 'Complex eigenvalue extraction', [
  SID, ['METHOD', 'S', 'HESS, CLAN, IRAM'], ['NORM', 'S', 'MAX or POINT'], g('G'), comp('C'), r('E', 'Convergence criterion'), ['ND0', 'I', 'Number of desired roots (HESS)'], _,
], { repeat: { from: 8, fields: [['CLAN/IRAM data', 'A', 'Method specific data, see QRG']] } });
card('FREQ', D, 'Frequencies for frequency response', [SID], { repeat: { from: 1, fields: [r('F{n}', 'Frequency')] } });
card('FREQ1', D, 'Frequencies: F1 + i*DF, i = 0..NDF', [SID, r('F1', 'First frequency'), r('DF', 'Frequency increment'), ['NDF', 'I', 'Number of increments (default 1)']]);
card('FREQ2', D, 'Logarithmically spaced frequencies', [SID, r('F1', 'First frequency'), r('F2', 'Last frequency'), ['NF', 'I', 'Number of logarithmic intervals']]);
card('FREQ3', D, 'Frequencies between modes', [SID, r('F1', 'Lower bound'), r('F2', 'Upper bound'), ['TYPE', 'S', 'LINEAR or LOG'], ['NEF', 'I', 'Number of excitation frequencies'], r('CLUSTER', 'Spacing parameter')]);
card('FREQ4', D, 'Frequencies spread around each mode', [SID, r('F1', 'Lower bound'), r('F2', 'Upper bound'), r('FSPD', 'Frequency spread (+/- fraction)'), ['NFM', 'I', 'Number of frequencies per spread']]);
card('FREQ5', D, 'Frequencies as fractions of natural frequencies', [SID, r('F1', 'Lower bound'), r('F2', 'Upper bound')], {
  repeat: { from: 3, fields: [r('FR{n}', 'Fraction of natural frequency')] },
});
card('TSTEP', D, 'Time step intervals for transient response', [SID, ['N1', 'I', 'Number of time steps'], r('DT1', 'Time increment'), ['NO1', 'I', 'Output every NO1 step'], _, _, _, _], {
  repeat: { from: 8, start: 2, fields: [_, ['N{n}', 'I', 'Number of time steps'], r('DT{n}', 'Time increment'), ['NO{n}', 'I', 'Output skip factor'], _, _, _, _] },
});
card('DAREA', D, 'Dynamic load scale factor at a DOF (referenced by RLOADi/TLOADi EXCITEID)', [
  SID, gr('P1', 'Grid or scalar point'), comp('C1'), r('A1', 'Scale factor'), g('P2', 'Grid or scalar point'), comp('C2'), r('A2', 'Scale factor'),
]);
card('DELAY', D, 'Time delay for dynamic loads', [SID, gr('P1'), comp('C1'), r('T1', 'Delay'), g('P2'), comp('C2'), r('T2', 'Delay')]);
card('DPHASE', D, 'Phase lead for frequency dependent loads', [SID, gr('P1'), comp('C1'), r('TH1', 'Phase lead (degrees)'), g('P2'), comp('C2'), r('TH2', 'Phase lead (degrees)')]);
card('DLOAD', D, 'Dynamic load combination: S * sum(Si * Li)', [SID, r('S', 'Overall scale factor')], {
  repeat: { from: 2, fields: [r('S{n}', 'Scale factor'), ['L{n}', 'I', 'RLOADi/TLOADi/ACSRCE set ID', 'dynLoad']] },
});
const exciteid: FieldTuple = ['EXCITEID', 'I!', 'DAREA, SPCD or static load set ID defining the spatial distribution', 'excite'];
card('RLOAD1', D, 'Frequency dependent load: {P(f)} = {A} [C(f) + iD(f)] e^{i(theta - 2 pi f tau)}', [
  SID, exciteid, ['DELAY', 'IR', 'DELAY set ID (int) or delay value (real)'], ['DPHASE', 'IR', 'DPHASE set ID (int) or phase lead in degrees (real)'],
  ['TC', 'IR', 'TABLEDi ID (int) or constant (real) for C(f)', 'tabled'], ['TD', 'IR', 'TABLEDi ID (int) or constant (real) for D(f)', 'tabled'], ['TYPE', 'IS', 'Excitation: LOAD (0), DISP (1), VELO (2), ACCE (3)'],
]);
card('RLOAD2', D, 'Frequency dependent load: {P(f)} = {A} B(f) e^{i(phi(f) + theta - 2 pi f tau)}', [
  SID, exciteid, ['DELAY', 'IR', 'DELAY set ID or value'], ['DPHASE', 'IR', 'DPHASE set ID or value'],
  ['TB', 'IR', 'TABLEDi ID for amplitude B(f)', 'tabled'], ['TP', 'IR', 'TABLEDi ID for phase phi(f) in degrees', 'tabled'], ['TYPE', 'IS', 'Excitation: LOAD, DISP, VELO, ACCE'],
]);
card('TLOAD1', D, 'Time dependent load: {P(t)} = {A} F(t - tau)', [
  SID, exciteid, ['DELAY', 'IR', 'DELAY set ID or value'], ['TYPE', 'IS', 'Excitation: LOAD, DISP, VELO, ACCE'],
  ['TID', 'I!', 'TABLEDi ID for F(t)', 'tabled'], r('US0', 'Initial displacement factor (enforced motion)'), r('VS0', 'Initial velocity factor (enforced motion)'),
]);
card('TLOAD2', D, 'Time dependent load: {P(t)} = {A} t^B e^{Ct} cos(2 pi F t + P) between T1 and T2', [
  SID, exciteid, ['DELAY', 'IR', 'DELAY set ID or value'], ['TYPE', 'IS', 'Excitation: LOAD, DISP, VELO, ACCE'],
  r('T1', 'Start time'), r('T2', 'End time'), r('F', 'Frequency (cycles/time)'), r('P', 'Phase angle (degrees)'),
  r('C', 'Exponential coefficient'), r('B', 'Growth coefficient'), r('US0', 'Initial displacement factor'), r('VS0', 'Initial velocity factor'),
]);

// ===========================================================================
// Nonlinear
// ===========================================================================
const NL = 'Nonlinear';
card('NLPARM', NL, 'Parameters for nonlinear static solution (SOL 106, 400)', [
  ['ID', 'I!', 'Identification number'], ['NINC', 'I', 'Number of load increments (default 10)'], r('DT', 'Time increment (creep)'),
  ['KMETHOD', 'S', 'Stiffness update: AUTO (default), ITER, SEMI'], ['KSTEP', 'I', 'Iterations before stiffness update (ITER/SEMI)'], ['MAXITER', 'I', 'Maximum iterations per increment (default 25)'],
  ['CONV', 'S', 'Convergence flags: any of U, P, W (default PW)'], ['INTOUT', 'S', 'Intermediate output: YES, NO (default), ALL'],
  r('EPSU', 'Displacement error tolerance (default 0.01)'), r('EPSP', 'Load error tolerance (default 0.01)'), r('EPSW', 'Work error tolerance (default 0.01)'), ['MAXDIV', 'I', 'Divergence limit (default 3)'],
  ['MAXQN', 'I', 'Max quasi-Newton correction vectors'], ['MAXLS', 'I', 'Max line searches'], r('FSTRESS', 'Fraction of effective stress for subincrements (default 0.2)'), r('LSTOL', 'Line search tolerance (default 0.5)'),
  ['MAXBIS', 'I', 'Max bisections (default 5)'], _, _, _, r('MAXR', 'Max ratio for arc-length adjustment (default 20.)'), _, r('RTOLB', 'Max rotation increment in degrees before bisection (default 20.)'),
]);
card('NLPCI', NL, 'Arc-length (path continuation) parameters, same ID as NLPARM', [
  ['ID', 'I!', 'NLPARM ID'], ['TYPE', 'S', 'CRIS, RIKS, MRIKS'], r('MINALR', 'Min arc-length adjustment ratio'), r('MAXALR', 'Max arc-length adjustment ratio'), r('SCALE', 'Load scale in constraint'), _, ['DESITER', 'I', 'Desired iterations'], ['MXINC', 'I', 'Max increments'],
]);

// ===========================================================================
// Sets / parameters / misc
// ===========================================================================
const X = 'Miscellaneous';
card('PARAM', X, 'Parameter value used by the solution sequence', [
  ['N', 'S!', 'Parameter name'], ['V1', 'A', 'Value (type depends on the parameter)'], ['V2', 'A', 'Second value (complex parameters)'],
]);
card('MDLPRM', X, 'Model parameters', [], { repeat: { from: 0, fields: [['NAME{n}', 'S', 'Parameter name'], ['VAL{n}', 'A', 'Value']] } });
card('SET1', X, 'List of grid / element / aero box IDs', [SID], { repeat: { from: 1, fields: [['ID{n}', 'IS', 'ID (or THRU)']] } });
card('SET3', X, 'List of IDs of a given type', [SID, ['DES', 'S!', 'Set type: GRID, ELEM, POINT, PROP, RBEin, RBEex']], { repeat: { from: 2, fields: [['ID{n}', 'IS', 'ID (or THRU)']] } });
card('ENDDATA', X, 'End of the bulk data section', []);
card('DTI', X, 'Direct table input', [['NAME', 'S!', 'Table name']], { repeat: { from: 1, fields: [['V{n}', 'A', 'Value']] } });

// ===========================================================================
// Optimization
// ===========================================================================
const O = 'Optimization';
card('DESVAR', O, 'Design variable', [
  ['ID', 'I!', 'Design variable ID'], ['LABEL', 'S!', 'User label'], r('XINIT', 'Initial value'), r('XLB', 'Lower bound (default -1.+20)'),
  r('XUB', 'Upper bound (default 1.+20)'), r('DELXV', 'Fractional move limit'), ['DDVAL', 'I', 'DDVAL ID for discrete values'],
]);
card('DVPREL1', O, 'Property as a linear function of design variables: P = C0 + sum(COEFi * DVIDi)', [
  ['ID', 'I!', 'Relation ID'], ['TYPE', 'S!', 'Property card name, e.g. PSHELL'], ['PID', 'I!', 'Property ID', 'prop'],
  ['PNAME/FID', 'IS', 'Property name (e.g. T) or field position'], r('PMIN', 'Minimum value'), r('PMAX', 'Maximum value'), r('C0', 'Constant term'), _,
], { repeat: { from: 8, fields: [['DVID{n}', 'I', 'DESVAR ID', 'desvar'], r('COEF{n}', 'Coefficient')] } });
card('DVPREL2', O, 'Property as a function (DEQATN) of design variables', [
  ['ID', 'I!', 'Relation ID'], ['TYPE', 'S!', 'Property card name'], ['PID', 'I!', 'Property ID', 'prop'],
  ['PNAME/FID', 'IS', 'Property name or field position'], r('PMIN', 'Minimum value'), r('PMAX', 'Maximum value'), ['EQID', 'I!', 'DEQATN ID'], _,
], { repeat: { from: 8, fields: [['DESVAR/DTABLE', 'A', '"DESVAR" followed by DVIDs, "DTABLE" followed by labels']] } });
card('DVMREL1', O, 'Material property as a linear function of design variables: MP = C0 + sum(COEFi * DVIDi)', [
  ['ID', 'I!', 'Relation ID'], ['TYPE', 'S!', 'Material card name, e.g. MAT1'], ['MID', 'I!', 'Material ID', 'mat'],
  ['MPNAME', 'S!', 'Material property name, e.g. E, G, NU, RHO'], r('MPMIN', 'Minimum value'), r('MPMAX', 'Maximum value'), r('C0', 'Constant term'), _,
], { repeat: { from: 8, fields: [['DVID{n}', 'I', 'DESVAR ID', 'desvar'], r('COEF{n}', 'Coefficient')] } });
card('DVMREL2', O, 'Material property as a function (DEQATN) of design variables', [
  ['ID', 'I!', 'Relation ID'], ['TYPE', 'S!', 'Material card name'], ['MID', 'I!', 'Material ID', 'mat'],
  ['MPNAME', 'S!', 'Material property name'], r('MPMIN', 'Minimum value'), r('MPMAX', 'Maximum value'), ['EQID', 'I!', 'DEQATN ID'], _,
], { repeat: { from: 8, fields: [['DESVAR/DTABLE', 'A', '"DESVAR" followed by DVIDs, "DTABLE" followed by labels']] } });
card('DVCREL1', O, 'Connectivity property (e.g. CONM2 mass, CBAR offset) as a linear function of design variables', [
  ['ID', 'I!', 'Relation ID'], ['TYPE', 'S!', 'Element card name, e.g. CONM2'], ['EID', 'I!', 'Element ID', 'elem'],
  ['CPNAME', 'S!', 'Connectivity property name, e.g. M, X1'], r('CPMIN', 'Minimum value'), r('CPMAX', 'Maximum value'), r('C0', 'Constant term'), _,
], { repeat: { from: 8, fields: [['DVID{n}', 'I', 'DESVAR ID', 'desvar'], r('COEF{n}', 'Coefficient')] } });
card('DLINK', O, 'Design variable as a linear function of other design variables: DDVID = C0 + CMULT * sum(Ci * IDVi)', [
  ['ID', 'I!', 'Relation ID'], ['DDVID', 'I!', 'Dependent DESVAR ID', 'desvar'], r('C0', 'Constant term (default 0.0)'), r('CMULT', 'Multiplier (default 1.0)'),
], { repeat: { from: 4, fields: [['IDV{n}', 'I', 'Independent DESVAR ID', 'desvar'], r('C{n}', 'Coefficient')] } });
card('DRESP1', O, 'Design response (single)', [
  ['ID', 'I!', 'Response ID'], ['LABEL', 'S!', 'User label'], ['RTYPE', 'S!', 'Response type: WEIGHT, VOLUME, DISP, STRESS, STRAIN, FORCE, EIGN, FREQ, LAMA, ...'],
  ['PTYPE', 'S', 'Property/element type, e.g. PSHELL, ELEM'], ['REGION', 'I', 'Region identifier'], ['ATTA', 'IS', 'Response attribute (component / item code)'],
  ['ATTB', 'IRS', 'Response attribute (frequency, time, ...)'], ['ATT1', 'IS', 'Property, element or grid ID'],
], { repeat: { from: 8, start: 2, fields: [['ATT{n}', 'IS', 'Additional property, element or grid ID']] } });
card('DRESP2', O, 'Design response from an equation (DEQATN)', [
  ['ID', 'I!', 'Response ID'], ['LABEL', 'S!', 'User label'], ['EQID/FUNC', 'IS', 'DEQATN ID or function (SUM, AVG, MAX, ...)'], ['REGION', 'I', 'Region identifier'],
  ['METHOD', 'IS', 'Method for MAX/MIN functions'], r('C1', 'Constant'), r('C2', 'Constant'), r('C3', 'Constant'),
], { repeat: { from: 8, fields: [['DESVAR/DRESP1/...', 'A', 'Keyword followed by IDs']] } });
card('DCONSTR', O, 'Design constraint: LALLOW <= response <= UALLOW', [
  ['DCID', 'I!', 'Constraint set ID'], ['RID', 'I!', 'DRESPi ID', 'dresp'], ['LALLOW/LID', 'IR', 'Lower bound (real) or TABLED1 ID (int)'],
  ['UALLOW/UID', 'IR', 'Upper bound (real) or TABLED1 ID (int)'], r('LOWFQ', 'Low end of frequency range'), r('HIGHFQ', 'High end of frequency range'),
]);
card('DCONADD', O, 'Union of design constraint sets', [['DCID', 'I!', 'Constraint set ID']], { repeat: { from: 1, fields: [['DC{n}', 'I', 'DCONSTR set ID', 'dconstr']] } });
card('DOPTPRM', O, 'Optimization parameters (name/value pairs)', [], { repeat: { from: 0, fields: [['PARAM{n}', 'S', 'Parameter name, e.g. DESMAX, DELP, P1, P2'], ['VAL{n}', 'IR', 'Value']] } });

// ===========================================================================
// Aeroelastic
// ===========================================================================
const AE = 'Aeroelastic';
card('AERO', AE, 'Aerodynamic physical data for dynamic aeroelasticity (flutter, gust)', [
  ['ACSID', 'I', 'Aerodynamic coordinate system', 'coord'], r('VELOCITY', 'Velocity for aerodynamic force data recovery'), r('REFC', 'Reference length for reduced frequency'),
  r('RHOREF', 'Reference density'), ['SYMXZ', 'I', 'XZ symmetry: +1 symmetric, 0 none, -1 antisymmetric'], ['SYMXY', 'I', 'XY symmetry (ground effect)'],
]);
card('AEROS', AE, 'Aerodynamic reference data for static aeroelasticity (SOL 144)', [
  ['ACSID', 'I', 'Aerodynamic coordinate system', 'coord'], ['RCSID', 'I', 'Reference system for rigid body motions', 'coord'], r('REFC', 'Reference chord'), r('REFB', 'Reference span'),
  r('REFS', 'Reference wing area'), ['SYMXZ', 'I', 'XZ symmetry'], ['SYMXY', 'I', 'XY symmetry'],
]);
card('CAERO1', AE, 'Doublet-lattice / vortex-lattice lifting surface panel', [
  ['EID', 'I!', 'Element ID (first box ID)'], ['PID', 'I!', 'PAERO1 ID', 'paero1'], ['CP', 'I', 'Coordinate system for points 1 and 4', 'coord'],
  ['NSPAN', 'I', 'Number of spanwise boxes'], ['NCHORD', 'I', 'Number of chordwise boxes'], ['LSPAN', 'I', 'AEFACT ID for spanwise divisions'],
  ['LCHORD', 'I', 'AEFACT ID for chordwise divisions'], ['IGID', 'I!', 'Interference group ID'],
  r('X1', 'Leading edge point 1, x'), r('Y1', 'Point 1, y'), r('Z1', 'Point 1, z'), r('X12', 'Chord at point 1'),
  r('X4', 'Leading edge point 4, x'), r('Y4', 'Point 4, y'), r('Z4', 'Point 4, z'), r('X43', 'Chord at point 4'),
], { id: 'element' });
card('PAERO1', AE, 'Aerodynamic property for CAERO1 (associated bodies)', [['PID', 'I!', 'Property ID']], {
  repeat: { from: 1, fields: [['B{n}', 'I', 'CAERO2 body ID']] },
});
card('SPLINE1', AE, 'Surface (infinite plate) spline for interpolation between structure and aero boxes', [
  ['EID', 'I!', 'Spline ID'], ['CAERO', 'I!', 'CAEROi element ID', 'caero'], ['BOX1', 'I!', 'First box ID'], ['BOX2', 'I!', 'Last box ID'],
  ['SETG', 'I!', 'SET1 ID of structural grids', 'set1'], r('DZ', 'Linear attachment flexibility'), ['METHOD', 'S', 'IPS (default), TPS, FPS'], ['USAGE', 'S', 'FORCE, DISP, BOTH (default)'],
  ['NELEM', 'I', 'FE points in x (FPS)'], ['MELEM', 'I', 'FE points in y (FPS)'],
]);
card('SPLINE4', AE, 'Surface spline using an AELIST of boxes', [
  ['EID', 'I!', 'Spline ID'], ['CAERO', 'I!', 'CAEROi element ID', 'caero'], ['AELIST', 'I!', 'AELIST of boxes'], _, ['SETG', 'I!', 'SET1 ID of structural grids', 'set1'], r('DZ', 'Attachment flexibility'), ['METHOD', 'S', 'IPS, TPS, FPS'], ['USAGE', 'S', 'FORCE, DISP, BOTH'],
  ['NELEM', 'I', 'FE points in x'], ['MELEM', 'I', 'FE points in y'],
]);
card('AELIST', AE, 'List of aerodynamic boxes', [SID], { repeat: { from: 1, fields: [['E{n}', 'IS', 'Box ID (or THRU)']] } });
card('AESTAT', AE, 'Rigid body aerodynamic trim variable', [['ID', 'I!', 'Identification number'], ['LABEL', 'S!', 'Variable name: ANGLEA, SIDES, ROLL, PITCH, YAW, URDD1-URDD6']]);
card('AESURF', AE, 'Aerodynamic control surface', [
  ['ID', 'I!', 'Identification number'], ['LABEL', 'S!', 'Control surface name'], ['CID1', 'I!', 'Hinge line coordinate system', 'coord'], ['ALID1', 'I!', 'AELIST of boxes'],
  ['CID2', 'I', 'Second hinge coordinate system', 'coord'], ['ALID2', 'I', 'Second AELIST'], r('EFF', 'Control surface effectiveness'), ['LDW', 'S', 'LDW (default) or NOLDW'],
  r('CREFC', 'Reference chord'), r('CREFS', 'Reference area'), r('PLLIM', 'Lower deflection limit (rad)'), r('PULIM', 'Upper deflection limit (rad)'),
  r('HMLLIM', 'Lower hinge moment limit'), r('HMULIM', 'Upper hinge moment limit'), ['TQLLIM', 'I', 'TABLEDi for lower deflection limit vs q'], ['TQULIM', 'I', 'TABLEDi for upper deflection limit vs q'],
]);
card('TRIM', AE, 'Trim condition for static aeroelastic analysis', [
  ['ID', 'I!', 'Trim set ID'], r('MACH', 'Mach number'), r('Q', 'Dynamic pressure'), ['LABEL1', 'S', 'Trim variable label (AESTAT/AESURF)'], r('UX1', 'Value of LABEL1'),
  ['LABEL2', 'S', 'Trim variable label'], r('UX2', 'Value of LABEL2'), r('AEQR', 'Aero extra point scale (1.0 = rigid+flexible, 0.0 = rigid)'),
], { repeat: { from: 8, start: 3, fields: [['LABEL{n}', 'S', 'Trim variable label'], r('UX{n}', 'Value')] } });
card('FLFACT', AE, 'Densities, Mach numbers or velocities / reduced frequencies for flutter', [SID], {
  repeat: { from: 1, fields: [['F{n}', 'RS', 'Value (or THRU form: F1 THRU FNF NF FMID)']] },
});
card('FLUTTER', AE, 'Flutter analysis data', [
  SID, ['METHOD', 'S!', 'K, KE, PK, PKNL, PKS, PKNLS'], ['DENS', 'I!', 'FLFACT ID for density ratios', 'flfact'], ['MACH', 'I!', 'FLFACT ID for Mach numbers', 'flfact'],
  ['RFREQ/VEL', 'I!', 'FLFACT ID for reduced frequencies (K) or velocities (PK)', 'flfact'], ['IMETH', 'S', 'Interpolation: L (linear) or S (surface)'],
  ['NVALUE/OMAX', 'IR', 'Number of eigenvalues for output / max frequency (PKS)'], r('EPS', 'Convergence tolerance (PK)'),
]);
card('MKAERO1', AE, 'Mach numbers and reduced frequencies for aerodynamic matrix generation (all combinations)', [
  r('M1', 'Mach number'), r('M2', 'Mach number'), r('M3', 'Mach number'), r('M4', 'Mach number'), r('M5', 'Mach number'), r('M6', 'Mach number'), r('M7', 'Mach number'), r('M8', 'Mach number'),
  r('K1', 'Reduced frequency'), r('K2', 'Reduced frequency'), r('K3', 'Reduced frequency'), r('K4', 'Reduced frequency'), r('K5', 'Reduced frequency'), r('K6', 'Reduced frequency'), r('K7', 'Reduced frequency'), r('K8', 'Reduced frequency'),
]);
card('MKAERO2', AE, 'Mach number / reduced frequency pairs for aerodynamic matrix generation', [], {
  repeat: { from: 0, fields: [r('M{n}', 'Mach number'), r('K{n}', 'Reduced frequency')] },
});

// ===========================================================================
// Contact (MSC)
// ===========================================================================
const CT = 'Contact';
card('BSURF', CT, 'Contact surface defined by shell elements', [['ID', 'I!', 'Contact surface ID']], { repeat: { from: 1, fields: [['EID{n}', 'IS', 'Element ID (or THRU / BY)', 'elem']] } });
card('BCPROP', CT, 'Contact surface defined by property IDs', [['ID', 'I!', 'Contact surface ID']], { repeat: { from: 1, fields: [['IP{n}', 'I', 'Property ID', 'prop']] } });
card('BCTSET', CT, 'Contact set: pairs of source / target regions', [
  ['CSID', 'I!', 'Contact set ID'], ['SID1', 'I', 'Source region ID'], ['TID1', 'I', 'Target region ID'], r('FRIC1', 'Friction coefficient'),
  r('MIND1', 'Minimum search distance'), r('MAXD1', 'Maximum search distance'), _, _,
], { repeat: { from: 8, fields: [_, ['SIDi', 'I', 'Source region ID'], ['TIDi', 'I', 'Target region ID'], r('FRICi', 'Friction coefficient'), r('MINDi', 'Min search distance'), r('MAXDi', 'Max search distance'), _, _] } });

// ===========================================================================
// Direct matrix input and DOF sets
// ===========================================================================
const DM = 'Matrices & Sets';
const TIN: FieldTuple = ['TIN', 'I!', 'Type of input values: 1 real single, 2 real double, 3 complex single, 4 complex double'];
const TOUT: FieldTuple = ['TOUT', 'I', 'Type of matrix to be created: 0 = set by the machine precision (default), 1-4 as TIN'];

card('DMIG', DM, 'Direct matrix input at grid points (column entry; the header entry has "0" in field 3)', [
  ['NAME', 'S!', 'Matrix name (selected in case control, e.g. K2GG = NAME, or read by DMAP)'],
  gr('GJ', 'Grid or scalar point of the column'),
  comp('CJ', 'Component of the column (0 for scalar points)'),
  _,
], {
  repeat: {
    from: 4,
    fields: [
      g('G{n}', 'Grid or scalar point of the row'),
      comp('C{n}', 'Component of the row'),
      r('A{n}', 'Real part of the matrix term'),
      r('B{n}', 'Imaginary part of the matrix term (complex matrices only)'),
    ],
  },
  variants: [{
    when: { index: 1, values: ['0'] },
    desc: 'Direct matrix input at grid points: header entry defining the matrix form and precision',
    fields: [
      ['NAME', 'S!', 'Matrix name'],
      ['"0"', 'I!', 'Always 0: identifies the header entry'],
      ['IFO', 'I!', 'Matrix form: 1 square, 2 general rectangular, 6 symmetric, 9 rectangular with NCOL columns'],
      TIN, TOUT,
      ['POLAR', 'I', 'Complex input: 0 real/imaginary (default), 1 amplitude/phase'],
      _,
      ['NCOL', 'I', 'Number of columns (rectangular matrices, IFO = 9)'],
    ],
  }],
});

card('DMI', DM, 'Direct matrix input by row/column index (column entry; the header entry has "0" in field 3)', [
  ['NAME', 'S!', 'Matrix name'],
  ['J', 'I!', 'Column number'],
  ['I1', 'I!', 'Row number of the first value that follows'],
], {
  repeat: {
    from: 3,
    fields: [['A/I', 'IR', 'Matrix value A(i,j) for consecutive rows (real), or an integer giving the row of the next value (blank rows are zero)']],
  },
  variants: [{
    when: { index: 1, values: ['0'] },
    desc: 'Direct matrix input by row/column index: header entry',
    fields: [
      ['NAME', 'S!', 'Matrix name'],
      ['"0"', 'I!', 'Always 0: identifies the header entry'],
      ['FORM', 'I!', 'Matrix form: 1 square, 2 general rectangular, 3 diagonal, 4 lower triangular, 5 upper triangular, 6 symmetric, 8 identity'],
      TIN, TOUT, _,
      ['M', 'I!', 'Number of rows'],
      ['N', 'I!', 'Number of columns'],
    ],
  }],
});

card('USET', DM, 'Defines DOFs as members of a user or degree-of-freedom set (e.g. U1, U2) as grid/component pairs', [
  ['SNAME', 'S!', 'Set name, e.g. U1 to U6'],
], { repeat: { from: 1, fields: [g('ID{n}', 'Grid or scalar point ID'), comp('C{n}')] } });

card('USET1', DM, 'Defines DOFs as members of a user or degree-of-freedom set (e.g. U1, U2) for a list of grids', [
  ['SNAME', 'S!', 'Set name, e.g. U1 to U6'],
  ['C', 'I', 'Component numbers (0 or blank for scalar points)'],
], { repeat: { from: 2, fields: [['ID{n}', 'IS', 'Grid or scalar point ID (or THRU)', 'grid']] } });

// ===========================================================================

/** Built-in cards (never modified). */
export const BUILTIN_CARDS: ReadonlyMap<string, CardDef> = new Map(defs.map((d) => [d.name, d]));

/** Active cards: built-in plus cards from private definition files (see custom.ts). */
export const CARDS: Map<string, CardDef> = new Map(BUILTIN_CARDS);

/**
 * The layout that applies to a card with the given field values. Cards such as
 * DMIG have a different layout for their header entry.
 */
export function resolveDef(def: CardDef, values: readonly string[]): CardDef {
  for (const v of def.variants ?? []) {
    const val = (values[v.when.index] ?? '').trim().toUpperCase();
    if (v.when.values.includes(val)) {
      return { ...def, desc: v.desc ?? def.desc, fields: v.fields, repeat: v.repeat, variants: undefined };
    }
  }
  return def;
}

/** Definition (with the matching variant) for a parsed card, or undefined if unknown. */
export function defForCard(card: { name: string; fields: { text: string }[] }): CardDef | undefined {
  const def = CARDS.get(card.name);
  return def ? resolveDef(def, card.fields.map((f) => f.text)) : undefined;
}

/** Field definition at data-field index `i` (0 = field 2), with repeat labels expanded. */
export function fieldDef(def: CardDef, i: number): FieldDef | undefined {
  if (i < def.fields.length) {
    return def.fields[i];
  }
  const rep = def.repeat;
  if (!rep || i < rep.from) {
    return undefined;
  }
  const k = i - rep.from;
  const len = rep.fields.length;
  const group = Math.floor(k / len);
  const base = rep.fields[k % len];
  const n = rep.start + group * rep.step;
  const sub = (s: string) => s.replace(/\{n\}/g, String(n)).replace(/\{m\}/g, String(n + 1));
  return { ...base, name: sub(base.name), desc: sub(base.desc) };
}

/** Number of fixed (non-repeating) fields worth showing in a layout table. */
export function layoutLength(def: CardDef): number {
  if (!def.repeat) {
    return def.fields.length;
  }
  // show the fixed part and at least one full repeat group, rounded to full lines
  const min = Math.max(def.fields.length, def.repeat.from) + def.repeat.fields.length;
  return Math.max(8, Math.ceil(min / 8) * 8);
}
