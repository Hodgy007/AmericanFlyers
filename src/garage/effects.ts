// What a piece of kit does, in plain numbers, worked out from the same physics
// the ride uses: watts saved at 40 km/h on the flat, and seconds gained or lost
// up Alpe d'Huez at your threshold-ish power.

import { DEFAULT_PARAMS, stepSpeed, type RiderParams } from '../physics';
import { stageById, type Stage } from '../stages';
import { equipmentEffects, NO_EFFECTS, type EquipmentEffects, type Loadout, type StoreItem } from './catalogue';

const G = 9.81;
const AIR_DENSITY = 1.225;
const DRIVETRAIN_EFFICIENCY = 0.976;

/** Who the numbers are for. */
export interface RiderContext {
  riderKg: number;
  bikeKg: number;
  ftp: number;
}

/** The physics parameters for a rider on this equipment (drafting not included). */
export function paramsFor(ctx: Pick<RiderContext, 'riderKg' | 'bikeKg'>, eq: EquipmentEffects): RiderParams {
  return {
    massKg: ctx.riderKg + ctx.bikeKg + eq.massKg,
    cda: DEFAULT_PARAMS.cda * eq.cdaFactor,
    crr: DEFAULT_PARAMS.crr + eq.crrDelta,
  };
}

/** Steady power (watts at the pedals) to hold `speedMs` on a grade, in still air. Matches what stepSpeed settles to. */
export function powerToHold(speedMs: number, grade: number, p: RiderParams): number {
  const theta = Math.atan(grade);
  const resist = p.massKg * G * Math.sin(theta) + p.crr * p.massKg * G * Math.cos(theta) + 0.5 * AIR_DENSITY * p.cda * speedMs * speedMs;
  return (resist * speedMs) / DRIVETRAIN_EFFICIENCY;
}

/** Seconds to ride a stage from the start to its finish at a steady power (the ride's own momentum maths). */
export function stageSeconds(stage: Stage, powerW: number, p: RiderParams): number {
  const end = stage.finish ?? 10000;
  const grade = (d: number) => (stage.elevationAt(d + 2) - stage.elevationAt(d - 2)) / 4;
  let d = 0;
  let v = 0;
  let t = 0;
  while (d < end && t < 4 * 3600) {
    v = stepSpeed(v, powerW, grade(d), 1, p);
    d += v;
    t += 1;
  }
  return t;
}

export interface EffectNumbers {
  /** Watts saved holding 40 km/h on the flat (negative: costs watts). */
  wattsAt40: number;
  /** Seconds gained up Alpe d'Huez (negative: slower). */
  alpeSeconds: number;
}

const cache = new Map<string, EffectNumbers>();

/** Flat and climbing numbers for a set of equipment effects against a plain bike. */
export function effectNumbers(eq: EquipmentEffects, ctx: RiderContext): EffectNumbers {
  const key = `${ctx.riderKg}|${ctx.bikeKg}|${Math.round(ctx.ftp)}|${eq.massKg}|${eq.cdaFactor}|${eq.crrDelta}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const base = paramsFor(ctx, NO_EFFECTS);
  const mine = paramsFor(ctx, eq);
  const v40 = 40 / 3.6;
  const power = Math.min(450, Math.max(120, ctx.ftp * 0.85));
  const alpe = stageById('alpe-dhuez');
  const out = {
    wattsAt40: powerToHold(v40, 0, base) - powerToHold(v40, 0, mine),
    alpeSeconds: stageSeconds(alpe, power, base) - stageSeconds(alpe, power, mine),
  };
  cache.set(key, out);
  return out;
}

/** Plain-words lines for what one item does (empty for a purely cosmetic one). */
export function describeItem(item: Pick<StoreItem, 'effects'>, ctx: RiderContext): string[] {
  const e = item.effects;
  if (!e || (!e.cda && !e.mass && !e.crr)) return [];
  const n = effectNumbers({ massKg: e.mass ?? 0, cdaFactor: 1 + (e.cda ?? 0), crrDelta: e.crr ?? 0 }, ctx);
  return describeNumbers(n);
}

export function describeNumbers(n: EffectNumbers): string[] {
  const lines: string[] = [];
  const w = Math.round(n.wattsAt40);
  if (w >= 1) lines.push(`Saves ≈ ${w} W at 40 km/h`);
  else if (w <= -1) lines.push(`Costs ≈ ${-w} W at 40 km/h`);
  const s = Math.round(n.alpeSeconds);
  if (s >= 2) lines.push(`≈ ${s} s faster up Alpe d’Huez`);
  else if (s <= -2) lines.push(`≈ ${-s} s slower up Alpe d’Huez`);
  return lines;
}

/** The whole loadout's effect against a plain bike. */
export function loadoutNumbers(l: Loadout, ctx: RiderContext): EffectNumbers {
  return effectNumbers(equipmentEffects(l), ctx);
}
