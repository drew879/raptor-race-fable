// Types for course.mjs, so the game can read the layout it was signed off from.
export const SPEED: number;
export const LANE: number;
export const EGG: { startLead: number; closing: number; closingFar: number; bump: number; warnAt: number; lostAt: number };
export interface LevelSection {
  id: string;
  name: string;
  length: number;
  slope: number;
  turn: number | number[];
  drop?: boolean;
  edge?: number;
  start: number;
  end: number;
}
export interface LevelRow {
  s: number;
  kind: string;
  move: string;
  parts: { kind: string; lanes: number[] }[];
  branch: 'left' | 'right' | null;
  onlyFor: string | null;
}
export interface Level {
  sections: LevelSection[];
  rows: LevelRow[];
  amber: { s: number; lane: number; lift: number }[];
  finds: { s: number; lane: number; n: number; high?: boolean }[];
  hints: { s: number; text: string }[];
  checkpoints: number[];
  power: { s: number; lane: number; reach: number } | null;
  island: [number, number] | null;
  labelsFrom: number | null;
  retryFrom: number | null;
  end: number;
  chaseEnd: number;
  total: number;
}
export function build(): Level;
