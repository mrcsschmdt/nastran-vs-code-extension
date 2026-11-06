/**
 * Executive control, case control and PARAM knowledge.
 */
import { CaseCommandDef, Describer, IncludeNote, ParamDef } from './types';

// ---------------------------------------------------------------------------
// Solution sequences

export const SOLUTIONS: Record<string, { name: string; desc: string }> = {
  '101': { name: 'SESTATIC', desc: 'Linear statics' },
  '103': { name: 'SEMODES', desc: 'Normal modes (real eigenvalues)' },
  '105': { name: 'SEBUCKL', desc: 'Linear buckling' },
  '106': { name: 'NLSTATIC', desc: 'Nonlinear statics' },
  '107': { name: 'SEDCEIG', desc: 'Direct complex eigenvalues' },
  '108': { name: 'SEDFREQ', desc: 'Direct frequency response' },
  '109': { name: 'SEDTRAN', desc: 'Direct transient response' },
  '110': { name: 'SEMCEIG', desc: 'Modal complex eigenvalues' },
  '111': { name: 'SEMFREQ', desc: 'Modal frequency response' },
  '112': { name: 'SEMTRAN', desc: 'Modal transient response' },
  '114': { name: 'CYCSTATX', desc: 'Cyclic statics' },
  '115': { name: 'CYCMODE', desc: 'Cyclic normal modes' },
  '116': { name: 'CYCBUCKL', desc: 'Cyclic buckling' },
  '118': { name: 'CYCFREQ', desc: 'Cyclic direct frequency response' },
  '129': { name: 'NLTRAN', desc: 'Nonlinear transient response' },
  '144': { name: 'AESTAT', desc: 'Static aeroelastic response (trim)' },
  '145': { name: 'SEFLUTTR', desc: 'Flutter / aeroservoelastic' },
  '146': { name: 'SEAERO', desc: 'Dynamic aeroelastic response (gust)' },
  '153': { name: 'NLSCSH', desc: 'Steady state nonlinear heat transfer' },
  '159': { name: 'NLTCSH', desc: 'Transient heat transfer' },
  '200': { name: 'DESOPT', desc: 'Design optimization and sensitivity' },
  '400': { name: 'NONLIN', desc: 'Implicit nonlinear (statics and dynamics, multiple steps)' },
  '600': { name: 'SOL 600', desc: 'Nonlinear via MSC Marc' },
  '700': { name: 'SOL 700', desc: 'Explicit nonlinear (Dytran / LS-DYNA based)' },
};

// ---------------------------------------------------------------------------
// Executive control / file management statements

const BUILTIN_EXEC: Record<string, string> = {
  NASTRAN: 'Specifies system cell values (e.g. NASTRAN BUFFSIZE=..., SYSTEM(n)=...). Must precede the executive control section.',
  ASSIGN: 'File management: assigns physical files to logical names (e.g. ASSIGN OUTPUT2=\'model.op2\', UNIT=12).',
  INIT: 'File management: creates a DBset.',
  RESTART: 'File management: requests a restart from a previous run database.',
  DBLOCATE: 'File management: obtains data blocks from a previous database.',
  ID: 'Optional identifier for the run (ID name1, name2).',
  APP: 'Approach (legacy).',
  SOL: 'Selects the solution sequence, e.g. SOL 101 (linear static) or SOL SESTATIC.',
  TIME: 'Maximum CPU time in minutes (TIME t).',
  DIAG: 'Requests diagnostic output, e.g. DIAG 8,56.',
  CEND: 'End of the executive control section; case control follows.',
  ECHOON: 'Re-activates the echo of executive control statements.',
  ECHOOFF: 'Suppresses the echo of executive control statements.',
  GEOMCHECK: 'Specifies tolerances for element geometry tests, e.g. GEOMCHECK NONE or GEOMCHECK SUMMARY.',
  DOMAINSOLVER: 'Selects a domain decomposition solution method (ACMS, FREQ, MODES ...).',
  COMPILE: 'Requests compilation of a DMAP subDMAP.',
  ALTER: 'Inserts or deletes DMAP statements.',
  ENDALTER: 'End of an ALTER package.',
  MALTER: 'Module ALTER using a string match.',
  LINK: 'Links a main subDMAP.',
  INCLUDE: "Inserts the contents of another file: INCLUDE 'path/to/file.bdf'.",
  MEMORY: 'Memory to allocate (some versions accept it here).',
};

/**
 * Common DMAP statements and modules (used in COMPILE/ALTER packages and
 * DMAP alter files). Short summaries; see the DMAP Programmer's Guide.
 */
export const DMAP_STATEMENTS: Record<string, string> = {
  TYPE: 'DMAP: declares parameters or data blocks, e.g. TYPE PARM,,I,Y,NAME=0 (Y = may be set with a bulk data PARAM entry; N = not).',
  IF: 'DMAP: conditional execution. IF (expr) THEN $ ... ELSE IF (expr) THEN $ ... ELSE $ ... ENDIF $, or a one-line IF (expr) statement $.',
  ELSE: 'DMAP: alternative branch of an IF block.',
  ENDIF: 'DMAP: end of an IF block.',
  DO: 'DMAP: loop. DO WHILE (expr) $ ... ENDDO $',
  WHILE: 'DMAP: DO WHILE loop condition.',
  ENDDO: 'DMAP: end of a DO loop.',
  CALL: 'DMAP: executes a subDMAP, e.g. CALL name inputs/outputs/parameters $',
  SUBDMAP: 'DMAP: starts a subDMAP definition.',
  RETURN: 'DMAP: returns from a subDMAP.',
  EXIT: 'DMAP: terminates the job (optionally after the current subDMAP).',
  END: 'DMAP: end of a subDMAP or DMAP sequence.',
  FILE: 'DMAP: declares data block properties (e.g. SAVE, APPEND, OVRWRT).',
  MESSAGE: "DMAP: writes text and parameter values to the .f06, e.g. MESSAGE //'text'/NAME $",
  PARAML: 'DMAP: reads parameter values from a data block (e.g. DTI/case control records) into DMAP parameters.',
  PARAMR: 'DMAP: performs operations on real (and complex) parameters.',
  PARAMD: 'DMAP: performs operations on double precision parameters.',
  PUTSYS: 'DMAP: sets a system cell value.',
  GETSYS: 'DMAP: reads a system cell value.',
  EQUIVX: 'DMAP: makes an output data block equivalent to (a copy reference of) an input data block.',
  EQUIV: 'DMAP: makes data blocks equivalent.',
  COPY: 'DMAP: copies a data block.',
  DELETE: 'DMAP: deletes data blocks from the database.',
  DBSTATUS: 'DMAP: checks whether data blocks exist / are purged.',
  MODTRL: 'DMAP: modifies the trailer (size, form, type) of a data block.',
  ADD: 'DMAP: matrix addition, X = a*A + b*B.',
  ADD5: 'DMAP: adds up to five matrices with scale factors.',
  MPYAD: 'DMAP: matrix multiply and add, X = [A]T*[B] + [C] with transpose and sign options.',
  SMPYAD: 'DMAP: series matrix multiply and add (product of up to five matrices plus a sixth).',
  TRNSP: 'DMAP: matrix transpose.',
  DIAGONAL: 'DMAP: extracts the diagonal of a matrix (optionally raised to a power) or converts to a vector.',
  MATGEN: 'DMAP: generates special matrices (identity, partitioning vectors, diagonal, ...).',
  MATMOD: 'DMAP: matrix modification utility with many options (e.g. partitioning vectors from grid lists).',
  MATPRN: 'DMAP: prints a matrix to the .f06 file.',
  MATGPR: 'DMAP: prints a matrix with grid/component labels.',
  MATPCH: 'DMAP: punches a matrix in DMI format to the .pch file.',
  MTRXIN: 'DMAP: converts DMIG/DMI/TF bulk data input to matrix data blocks.',
  DMIIN: 'DMAP: converts DMI and DTI bulk data entries to data blocks.',
  PARTN: 'DMAP: partitions a matrix into up to four submatrices using row/column partitioning vectors.',
  MERGE: 'DMAP: merges up to four submatrices into one matrix using partitioning vectors.',
  UPARTN: 'DMAP: partitions a matrix using degree-of-freedom set names from USET (e.g. G into A and O).',
  UMERGE: 'DMAP: merges matrices using USET degree-of-freedom set names.',
  UMERGE1: 'DMAP: merges a matrix using USET set names (single input version).',
  VEC: 'DMAP: creates a partitioning vector from USET set names.',
  APPEND: 'DMAP: appends columns of one matrix to another.',
  SOLVE: 'DMAP: solves [A]{X} = {B}.',
  DECOMP: 'DMAP: matrix decomposition (LDLT).',
  DCMP: 'DMAP: sparse matrix decomposition.',
  FBS: 'DMAP: forward-backward substitution using a decomposed matrix.',
  READ: 'DMAP: real eigenvalue extraction.',
  LAMX: 'DMAP: creates or edits the eigenvalue table (LAMA) / eigenvalue matrix.',
  NORM: 'DMAP: normalizes the columns of a matrix.',
  SDR1: 'DMAP: data recovery (recovers dependent DOF displacements and forces).',
  SDR2: 'DMAP: data recovery for element output.',
  OFP: 'DMAP: output file processor: prints tables to the .f06 file.',
  OUTPUT2: 'DMAP: writes data blocks to an OUTPUT2 (binary op2) file.',
  OUTPUT4: 'DMAP: writes matrices to an OUTPUT4 (op4) file.',
  INPUTT2: 'DMAP: reads data blocks from an OUTPUT2 file.',
  INPUTT4: 'DMAP: reads matrices from an OUTPUT4 file.',
};

/** Built-in executive / DMAP statement descriptions (never modified). */
export const BUILTIN_EXEC_STATEMENTS: Readonly<Record<string, string>> = { ...BUILTIN_EXEC, ...DMAP_STATEMENTS };
/** Active executive / DMAP statement descriptions (built-in plus private definitions). */
export const EXEC_STATEMENTS: Record<string, string> = { ...BUILTIN_EXEC_STATEMENTS };

// ---------------------------------------------------------------------------
// Case control

const SORT: Describer[] = [
  { name: 'SORT1', desc: 'Output sorted by load / frequency / time step (one table per step)' },
  { name: 'SORT2', desc: 'Output sorted by grid / element (history of each point)' },
  { name: 'PRINT', desc: 'Write output to the .f06 file (default)' },
  { name: 'NOPRINT', desc: 'Compute but do not print' },
  { name: 'PUNCH', desc: 'Write output to the .pch punch file' },
  { name: 'PLOT', desc: 'Compute for post-processing (OP2/H5/XDB) but do not print' },
  { name: 'REAL', desc: 'Complex output in real/imaginary form (default)' },
  { name: 'IMAG', desc: 'Complex output in real/imaginary form' },
  { name: 'PHASE', desc: 'Complex output in magnitude/phase form' },
  { name: 'PSDF', desc: 'Random analysis: power spectral density functions' },
  { name: 'ATOC', desc: 'Random analysis: autocorrelation functions' },
  { name: 'CRMS', desc: 'Random analysis: cumulative root mean square' },
  { name: 'RMS', desc: 'Random analysis: root mean square' },
  { name: 'RALL', desc: 'Random analysis: PSDF, ATOC and CRMS' },
  { name: 'RPRINT', desc: 'Random analysis: print' },
  { name: 'NORPRINT', desc: 'Random analysis: do not print' },
  { name: 'CID', desc: 'Output in the coordinate system specified by the CID field of GRID' },
];

const STRESS_DESC: Describer[] = [
  ...SORT,
  { name: 'VONMISES', desc: 'von Mises equivalent stress (default)' },
  { name: 'MAXS', desc: 'Maximum shear stress instead of von Mises' },
  { name: 'SHEAR', desc: 'Maximum shear (same as MAXS)' },
  { name: 'CENTER', desc: 'Shell output at the element center only (default)' },
  { name: 'CORNER', desc: 'Shell output at the center and corner grids (bilinear extrapolation)' },
  { name: 'BILIN', desc: 'Same as CORNER' },
  { name: 'SGAGE', desc: 'Corner output using strain gage approach' },
  { name: 'CUBIC', desc: 'Corner output using cubic bending correction' },
  { name: 'STRCUR', desc: 'Strain/curvature output at the reference plane (STRAIN only)' },
  { name: 'FIBER', desc: 'Strain at fiber locations Z1, Z2 (STRAIN only)' },
  { name: 'NOCOMP', desc: 'Suppress composite ply output' },
];

const ENERGY_DESC: Describer[] = [
  ...SORT,
  { name: 'AVERAGE', desc: 'Average energy (frequency response)' },
  { name: 'AMPLITUDE', desc: 'Amplitude of energy (frequency response)' },
  { name: 'PEAK', desc: 'Peak energy (frequency response)' },
  { name: 'THRESH', desc: 'THRESH=e: only print elements with energy fraction > e' },
];

function out(name: string, desc: string, describers: Describer[] = SORT): CaseCommandDef {
  return { name, desc, output: true, describers, syntax: `${name}(SORT1,PRINT) = ALL | NONE | n (case control SET)` };
}

function sel(name: string, desc: string, ref: string, syntax?: string): CaseCommandDef {
  return { name, desc, ref, syntax: syntax ?? `${name} = n` };
}

const caseDefs: CaseCommandDef[] = [
  { name: 'SUBCASE', desc: 'Starts a subcase (load case). Commands above the first SUBCASE apply to all subcases.', syntax: 'SUBCASE n' },
  { name: 'SUBCOM', desc: 'Combination subcase: linear combination of previous subcases (with SUBSEQ).', syntax: 'SUBCOM n' },
  { name: 'SUBSEQ', desc: 'Coefficients for a SUBCOM combination.', syntax: 'SUBSEQ = 1.0, -0.5, ...' },
  { name: 'SYMCOM', desc: 'Symmetry combination subcase.', syntax: 'SYMCOM n' },
  { name: 'SYMSEQ', desc: 'Coefficients for a SYMCOM combination.' },
  { name: 'REPCASE', desc: 'Repeats the previous subcase for additional output.' },
  { name: 'TITLE', desc: 'Title printed on each page of output.', syntax: 'TITLE = text' },
  { name: 'SUBTITLE', desc: 'Subtitle printed on each page of output.', syntax: 'SUBTITLE = text' },
  { name: 'LABEL', desc: 'Label printed on each page of output.', syntax: 'LABEL = text' },
  { name: 'ECHO', desc: 'Controls echo of the bulk data: NONE, SORT, UNSORT, BOTH, PUNCH.', syntax: 'ECHO = NONE' },
  { name: 'LINE', desc: 'Number of lines per printed page.', syntax: 'LINE = n' },
  { name: 'MAXLINES', desc: 'Maximum number of output lines.', syntax: 'MAXLINES = n' },
  { name: 'SET', desc: 'Defines a set of IDs or frequencies/times for output requests.', syntax: 'SET n = 1, 5 THRU 100, 200' },
  { name: 'ANALYSIS', desc: 'Analysis type of the subcase (SOL 200 / SOL 400): STATICS, MODES, BUCK, DFREQ, MFREQ, MTRAN, SAERO, FLUTTER, NLSTAT, ...', syntax: 'ANALYSIS = STATICS' },
  { name: 'PARAM', desc: 'Specifies a parameter value for the subcase.', syntax: 'PARAM, NAME, VALUE' },
  { name: 'OUTPUT', desc: 'Starts a plotting/XY-plot request packet: OUTPUT(PLOT), OUTPUT(XYPLOT), OUTPUT(POST).', syntax: 'OUTPUT(XYPLOT)' },
  { name: 'BEGIN', desc: 'BEGIN BULK ends the case control section and starts the bulk data.', syntax: 'BEGIN BULK' },
  { name: 'K2GG', desc: 'Selects a direct input stiffness matrix (DMIG) to add.', syntax: 'K2GG = name' },
  { name: 'M2GG', desc: 'Selects a direct input mass matrix (DMIG) to add.', syntax: 'M2GG = name' },
  { name: 'B2GG', desc: 'Selects a direct input damping matrix (DMIG) to add.', syntax: 'B2GG = name' },
  { name: 'K2PP', desc: 'Selects a direct input stiffness matrix (p-set).' },
  { name: 'M2PP', desc: 'Selects a direct input mass matrix (p-set).' },
  { name: 'B2PP', desc: 'Selects a direct input damping matrix (p-set).' },
  { name: 'STATSUB', desc: 'Selects the static subcase for buckling or differential stiffness (SOL 105).', syntax: 'STATSUB = n' },
  { name: 'AUXMODEL', desc: 'References an auxiliary model.' },
  { name: 'MODTRAK', desc: 'Mode tracking request (SOL 200).' },
  { name: 'RESVEC', desc: 'Controls residual vector augmentation: YES / NO / INRLOD ...' },
  { name: 'MODES', desc: 'Repeats a subcase for each mode for output (SOL 103).' },
  { name: 'MEFFMASS', desc: 'Modal effective mass output.', syntax: 'MEFFMASS(PRINT,SUMMARY,PARTFAC) = YES' },
  { name: 'GROUNDCHECK', desc: 'Rigid body motion (grounding) check of the stiffness matrix.', syntax: 'GROUNDCHECK = YES' },
  { name: 'WEIGHTCHECK', desc: 'Rigid body mass check.', syntax: 'WEIGHTCHECK = YES' },
  { name: 'SEALL', desc: 'Superelement generation and assembly.' },
  { name: 'SUPER', desc: 'Assigns a subcase to a superelement.' },
  { name: 'TEMPERATURE', desc: 'Selects temperature set: TEMP(LOAD), TEMP(INIT), TEMP(MATERIAL), TEMP(BOTH).', ref: 'temp', syntax: 'TEMPERATURE(LOAD) = n' },
  sel('LOAD', 'Selects the static load set (LOAD, FORCE, MOMENT, PLOAD4, GRAV, ...).', 'loadSet'),
  sel('SPC', 'Selects the single-point constraint set (SPC, SPC1, SPCADD).', 'spcSet'),
  sel('MPC', 'Selects the multipoint constraint set (MPC, MPCADD).', 'mpcSet'),
  sel('METHOD', 'Selects the real eigenvalue extraction method (EIGRL, EIGR, EIGB).', 'eigr', 'METHOD = n  (METHOD(FLUID) = n)'),
  sel('CMETHOD', 'Selects the complex eigenvalue method (EIGC).', 'eigc'),
  sel('DLOAD', 'Selects the dynamic load (DLOAD, RLOADi, TLOADi).', 'dynLoad'),
  sel('FREQUENCY', 'Selects the frequency set (FREQ, FREQi).', 'freq'),
  sel('TSTEP', 'Selects time step parameters (TSTEP).', 'tstep'),
  sel('TSTEPNL', 'Selects nonlinear transient time step parameters.', 'tstep'),
  sel('NLPARM', 'Selects nonlinear static parameters (NLPARM).', 'nlparm'),
  sel('SDAMPING', 'Selects modal damping table (TABDMP1).', 'tabdmp'),
  sel('SUPORT1', 'Selects SUPORT1 reference DOFs.', 'suport1'),
  sel('TRIM', 'Selects trim condition (TRIM) for SOL 144/146.', 'trim'),
  sel('FMETHOD', 'Selects flutter analysis parameters (FLUTTER).', 'flutter'),
  sel('DESOBJ', 'Selects the design objective (DRESP1/DRESP2).', 'dresp', 'DESOBJ(MIN) = n'),
  sel('DESSUB', 'Selects design constraints for the subcase (DCONSTR/DCONADD).', 'dconstr'),
  sel('DESGLB', 'Selects global design constraints (DCONSTR/DCONADD).', 'dconstr'),
  sel('BCONTACT', 'Selects contact definitions (BCTSET / BCTADD).', 'bctset'),
  sel('BCSET', 'Selects contact set (legacy).', 'bctset'),
  sel('DEFORM', 'Selects element deformation set.', 'deform'),
  sel('RANDOM', 'Selects random analysis PSD (RANDPS).', 'randps'),
  sel('GUST', 'Selects gust load.', 'dynLoad'),
  out('DISPLACEMENT', 'Output request: grid point displacements (VECTOR and PRESSURE are synonyms).'),
  out('VECTOR', 'Same as DISPLACEMENT.'),
  out('PRESSURE', 'Same as DISPLACEMENT (fluid pressure).'),
  out('VELOCITY', 'Output request: grid point velocities.'),
  out('ACCELERATION', 'Output request: grid point accelerations.'),
  out('SPCFORCES', 'Output request: single-point constraint forces (reactions).'),
  out('MPCFORCES', 'Output request: multipoint constraint forces.'),
  out('OLOAD', 'Output request: applied loads.'),
  out('STRESS', 'Output request: element stresses (ELSTRESS is a synonym).', STRESS_DESC),
  out('ELSTRESS', 'Same as STRESS.', STRESS_DESC),
  out('STRAIN', 'Output request: element strains.', STRESS_DESC),
  out('FORCE', 'Output request: element forces (ELFORCE is a synonym).', [...SORT, { name: 'CENTER', desc: 'Center output' }, { name: 'CORNER', desc: 'Corner output' }, { name: 'BILIN', desc: 'Corner output' }]),
  out('ELFORCE', 'Same as FORCE.'),
  out('GPFORCE', 'Output request: grid point force balance.'),
  out('GPSTRESS', 'Output request: grid point stresses (needs OUTPUT(POST) surfaces/volumes).'),
  out('GPSTRAIN', 'Output request: grid point strains.'),
  out('STRFIELD', 'Output request: grid point stress field for post-processing.'),
  out('ESE', 'Output request: element strain energy.', ENERGY_DESC),
  out('EKE', 'Output request: element kinetic energy.', ENERGY_DESC),
  out('EDE', 'Output request: element damping energy.', ENERGY_DESC),
  out('GPKE', 'Output request: grid point kinetic energy.'),
  out('SDISPLACEMENT', 'Output request: modal (solution set) displacements.'),
  out('SVECTOR', 'Output request: eigenvectors in the solution set.'),
  out('SVELOCITY', 'Output request: solution set velocities.'),
  out('SACCELERATION', 'Output request: solution set accelerations.'),
  out('NLSTRESS', 'Output request: nonlinear element stresses.'),
  out('NLLOAD', 'Output request: nonlinear loads (transient).'),
  out('THERMAL', 'Output request: grid point temperatures (heat transfer).'),
  out('FLUX', 'Output request: element heat flux.'),
  out('ELSUM', 'Output request: element summary (mass, volume, ...).'),
  out('MPRES', 'Output request: fluid pressure at wetted surfaces.'),
  out('AEROF', 'Output request: aerodynamic forces on boxes.'),
  out('APRESSURE', 'Output request: aerodynamic pressures.'),
  out('BOUTPUT', 'Output request: contact (slideline / BCTSET) output.'),
  out('BCRESULTS', 'Output request: contact results.'),
  out('MONITOR', 'Output request: monitor point results.'),
  out('CMSENERGY', 'Output request: component mode synthesis energy.'),
  out('ENTHALPY', 'Output request: enthalpy (heat transfer).'),
  { name: 'OMODES', desc: 'Selects a subset of the computed modes for output and data recovery (refers to a case control SET).', output: true, syntax: 'OMODES = ALL | n (case control SET)' },
  { name: 'PARTN', desc: 'Selects a case control SET of grid points used to build a partitioning vector (read by DMAP, e.g. with MATMOD).', output: true, syntax: 'PARTN = n' },
  {
    name: 'EXTSEOUT',
    desc: 'Writes the model as an external superelement (reduced stiffness, mass, damping and loads) in the selected format.',
    syntax: 'EXTSEOUT(DMIGPCH,EXTID=10)',
    describers: [
      { name: 'ASMBULK', desc: 'Write the boundary/assembly bulk data for the residual model' },
      { name: 'EXTBULK', desc: 'Write the bulk data of the external superelement' },
      { name: 'EXTID', desc: 'EXTID=n: superelement ID of the external superelement' },
      { name: 'DMIGPCH', desc: 'Write the reduced matrices as DMIG entries to the .pch file' },
      { name: 'DMIGOP2', desc: 'Write the reduced matrices as DMIG to an OUTPUT2 file' },
      { name: 'MATOP4', desc: 'Write the reduced matrices to an OUTPUT4 file' },
      { name: 'MATRIXDB', desc: 'Store the reduced matrices in the database' },
      { name: 'STIFFNESS', desc: 'Include the stiffness matrix' },
      { name: 'MASS', desc: 'Include the mass matrix' },
      { name: 'DAMPING', desc: 'Include the viscous damping matrix' },
      { name: 'K4DAMP', desc: 'Include the structural damping matrix' },
      { name: 'LOADS', desc: 'Include the loads' },
      { name: 'DMIGSFIX', desc: 'DMIGSFIX=name: suffix for the DMIG matrix names' },
      { name: 'DMIGDB', desc: 'Store DMIG in the database' },
      { name: 'UNIT', desc: 'UNIT=n: Fortran unit for the output file' },
    ],
  },
];

export const BUILTIN_CASE_COMMANDS: ReadonlyMap<string, CaseCommandDef> = new Map(caseDefs.map((c) => [c.name, c]));
/** Active case control commands (built-in plus private definitions). */
export const CASE_COMMANDS: Map<string, CaseCommandDef> = new Map(BUILTIN_CASE_COMMANDS);

/**
 * Case control commands may be abbreviated to their first four characters.
 */
export function lookupCaseCommand(name: string): CaseCommandDef | undefined {
  const n = name.toUpperCase();
  const exact = CASE_COMMANDS.get(n);
  if (exact) {
    return exact;
  }
  if (n === 'TEMP') {
    return CASE_COMMANDS.get('TEMPERATURE');
  }
  if (n.length >= 4) {
    for (const def of CASE_COMMANDS.values()) {
      if (def.name.startsWith(n)) {
        return def;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// PARAMs

const paramDefs: ParamDef[] = [
  {
    name: 'POST',
    desc:
      'Post-processing results file.\n\n' +
      '- `-1`: OP2 (OUTPUT2) as Patran and Femap read it. Vector results in the global (displacement) coordinate systems; model geometry only with `PARAM,OGEOM,YES`. **Femap default.**\n' +
      '- `-2`: OP2 as I-DEAS / Simcenter 3D read it, with the model geometry tables. **The Simcenter (NX) translator writes this, also in decks it exports for MSC Nastran.** Vector results are in the basic system; add `PARAM,OUGCORD,GLOBAL` for the global systems (Femap and ATA Attune need that).\n' +
      '- `0`: XDB results database (MSC Nastran) for Patran.\n\n' +
      'Patran reads `-1` or `0`, Femap `-1` (or `-2` with its Results Destination set to Simcenter), Simcenter 3D `-2`. Check the Quick Reference Guide of your solver version for the other values.',
    values: '-2, -1, 0, 1',
    default: '1',
  },
  { name: 'OUGCORD', desc: 'Coordinate system of displacements and other vector results in the OP2 file. GLOBAL writes them in each grid\'s global (displacement, CD) system, as in the .f06 and .pch. Use it with `PARAM,POST,-2`, which otherwise writes the basic system (Femap and ATA Attune need GLOBAL).', values: 'GLOBAL' },
  { name: 'AUTOSPC', desc: 'Automatically constrain singular degrees of freedom.', values: 'YES / NO', default: 'YES (SOL 101-200)' },
  { name: 'GRDPNT', desc: 'Grid point weight generator: reference grid for the mass summary (0 = basic origin, -1 = off).', values: 'grid ID', default: '-1' },
  { name: 'WTMASS', desc: 'Multiplies the mass (e.g. 0.00259 to convert lbm to slinch).', values: 'real', default: '1.0' },
  { name: 'COUPMASS', desc: 'Coupled (consistent) mass instead of lumped mass for > 0.', values: '-1 / 1', default: '-1' },
  { name: 'K6ROT', desc: 'Stiffness for the normal rotation of shell elements (CQUAD4/CTRIA3).', values: 'real', default: '100.' },
  { name: 'MAXRATIO', desc: 'Threshold for the ratio of matrix diagonal to factor diagonal (singularity check).', values: 'real', default: '1.+7' },
  { name: 'BAILOUT', desc: 'Behaviour when a matrix factor ratio exceeds MAXRATIO: 0 = stop, -1 = continue.', values: '0 / -1', default: '0' },
  { name: 'PRGPST', desc: 'Print grid point singularity table.', values: 'YES / NO', default: 'YES' },
  { name: 'LGDISP', desc: 'Large displacement (geometric nonlinear) effects in SOL 106/129/400.', values: '-1 / 1 / 2', default: '-1' },
  { name: 'NOCOMPS', desc: 'Controls composite ply stress output versus equivalent homogeneous element stress output (see the QRG for the value meanings).', values: '-1, 0, 1' },
  { name: 'SRCOMPS', desc: 'Composite ply strength ratio output.', values: 'YES / NO', default: 'NO' },
  { name: 'SNORM', desc: 'Unique grid point normals for shells within the given angle (degrees).', values: 'real', default: '20.' },
  { name: 'OGEOM', desc: 'Write the model geometry tables to the OP2 file. Post-processors that read `PARAM,POST,-1` OP2 files without the model (e.g. without the .bdf) need it.', values: 'YES / NO', default: 'YES' },
  { name: 'PRTMAXIM', desc: 'Print the maximum displacement/SPC force/applied load summary.', values: 'YES / NO', default: 'NO' },
  { name: 'G', desc: 'Uniform structural damping coefficient (frequency response / transient with W3).', values: 'real', default: '0.0' },
  { name: 'W3', desc: 'Frequency (rad/time) used to convert structural damping G to viscous damping in transient.', values: 'real', default: '0.0' },
  { name: 'W4', desc: 'Frequency (rad/time) for element structural damping (GE) in transient.', values: 'real', default: '0.0' },
  { name: 'INREL', desc: 'Inertia relief: -1 with SUPORT, -2 automatic.', values: '-2, -1, 0', default: '0' },
  { name: 'EPZERO', desc: 'Threshold for zero pivots / epsilon check.', values: 'real' },
  { name: 'EPSILON', desc: 'Print the epsilon ratio of the static solution (residual check).', values: 'integer' },
  { name: 'LMODES', desc: 'Number of modes used in modal analysis.', values: 'integer', default: '0 (all)' },
  { name: 'LFREQ', desc: 'Lower frequency limit for modes used in modal analysis.', values: 'real' },
  { name: 'HFREQ', desc: 'Upper frequency limit for modes used in modal analysis.', values: 'real' },
  { name: 'KDAMP', desc: 'Modal damping as complex stiffness (-1) or viscous (1).', values: '-1 / 1', default: '1' },
  { name: 'DDRMM', desc: 'Matrix vs. mode displacement data recovery (-1 forces full recovery).', values: 'integer', default: '0' },
  { name: 'RESVEC', desc: 'Residual vector augmentation.', values: 'YES / NO' },
  { name: 'SPARSE', desc: 'Sparse matrix method control.', values: 'integer' },
  { name: 'OMID', desc: 'Output in material coordinate system for shells.', values: 'YES / NO', default: 'NO' },
  { name: 'NLTOL', desc: 'Nonlinear convergence tolerance level (0 very high ... 3 engineering).', values: '0-3', default: '2' },
  { name: 'PATVER', desc: 'Patran version for OP2 output.', values: 'real' },
  { name: 'AUNITS', desc: 'Acceleration units conversion for trim (1/g).', values: 'real' },
  { name: 'MECHFIX', desc: 'Automatic handling of rigid body modes (mechanisms) in eigen analysis.', values: 'YES / NO' },
  { name: 'BUCKLE', desc: 'Nonlinear buckling in SOL 106.', values: '-1 / 1 / 2' },
  { name: 'ALTRED', desc: 'Alternative reduction for superelements.', values: 'YES / NO' },
  { name: 'CHECKOUT', desc: 'Model checkout run (no solution).', values: 'YES / NO', default: 'NO' },
  { name: 'SOFTEXIT', desc: 'Exit after the model checkout.', values: 'YES / NO' },
  { name: 'EXTOUT', desc: 'External superelement output (DMIGPCH, DMIGOP2, MATOP4 ...).', values: 'character' },
  { name: 'MAXLINES', desc: 'Maximum number of output lines.', values: 'integer' },
  { name: 'UNITSYS', desc: 'Unit system definition for the run.', values: 'character' },
  { name: 'POSTEXT', desc: 'Write external superelement / reduced model data (e.g. boundary matrices) to the post-processing file.', values: 'YES / NO', default: 'NO' },
  { name: 'OMAXR', desc: 'Maximum number of modes written to OUTPUT2 files.', values: 'integer' },
  { name: 'OUNIT2', desc: 'Fortran unit number for OUTPUT2 output.', values: 'integer' },
  { name: 'OLDSEQ', desc: 'Selects the grid point resequencing method (-1 = no resequencing).', values: 'integer' },
];

export const BUILTIN_PARAMS: ReadonlyMap<string, ParamDef> = new Map(paramDefs.map((p) => [p.name, p]));
/** Active PARAMs (built-in plus private definitions). */
export const PARAMS: Map<string, ParamDef> = new Map(BUILTIN_PARAMS);

/** Notes for INCLUDEd files, from private definitions (see custom.ts). */
export const INCLUDE_NOTES: IncludeNote[] = [];

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

/** Notes whose pattern matches the file name (not the directory) of an INCLUDE path. */
export function includeNotesFor(includePath: string): IncludeNote[] {
  const base = includePath.replace(/\\/g, '/').split('/').pop() ?? includePath;
  return INCLUDE_NOTES.filter((n) => globToRegExp(n.pattern).test(base));
}
