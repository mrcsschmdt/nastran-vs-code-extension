/**
 * Types for the card / command knowledge base.
 */

/**
 * Value type codes:
 *  I  integer          R  real (must contain a decimal point)
 *  S  character        A  anything
 *  IR / IS / RS / IRS  any of the listed types
 * A trailing '!' marks a required field.
 */
export type VType = 'I' | 'R' | 'S' | 'IR' | 'IS' | 'RS' | 'IRS' | 'A' | '';

/** [name, type, description, reference group] */
export type FieldTuple = [string, string, string, string?];

export interface FieldDef {
  name: string;
  type: VType;
  required: boolean;
  desc: string;
  /** Name of a reference group (see refs.ts) the value points to. */
  ref?: string;
}

export interface RepeatDef {
  /** Data-field index where the repeating group starts. */
  from: number;
  fields: FieldDef[];
  /** Counter value for the first group (default 1). {n} = counter, {m} = counter + 1. */
  start: number;
  /** Counter increment per group (default 1). */
  step: number;
}

export type IdSpace = 'grid' | 'element' | 'property' | 'material' | 'coord';

export interface CardDef {
  name: string;
  group: string;
  desc: string;
  fields: FieldDef[];
  repeat?: RepeatDef;
  /** ID namespace of field 2, used for duplicate checks and reference lookup. */
  idSpace?: IdSpace;
  /** If true, every value of the card is an ID (SPOINT, EPOINT). */
  listIds?: boolean;
  notes?: string;
  /** Alternative layouts, see resolveDef(). */
  variants?: CardVariant[];
  /** Label of the definitions file this card came from (undefined = built in). */
  source?: string;
}

export interface Describer {
  name: string;
  desc: string;
}

export interface CaseCommandDef {
  name: string;
  desc: string;
  /** Example / syntax line. */
  syntax?: string;
  /** Reference group in the bulk data that the integer value refers to. */
  ref?: string;
  /** Output request: integer value refers to a case control SET. */
  output?: boolean;
  describers?: Describer[];
  source?: string;
}

export interface ParamDef {
  name: string;
  desc: string;
  values?: string;
  default?: string;
  source?: string;
}

/** Alternative layout chosen by the value of one field (e.g. DMIG header vs. column entry). */
export interface CardVariant {
  /** Use this layout when data field `index` (0 = field 2) has one of `values` (upper case). */
  when: { index: number; values: string[] };
  desc?: string;
  fields: FieldDef[];
  repeat?: RepeatDef;
}

/** Note shown when hovering an INCLUDE whose file name matches `pattern` (glob with * and ?). */
export interface IncludeNote {
  pattern: string;
  desc: string;
}
