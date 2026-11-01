// A rival on the road: a computer-ridden bot that tries to stay close to you.
// It rides at about your recent pace (a rolling average of your power, scaled
// by the rival's own strength, 97 to 103%) with a little rubber-banding so the
// ride stays close, and each rival has a riding style that makes it attack:
//   sprinter     goes flat out for the last 300 m;
//   climber      attacks when the road passes 6%;
//   wheelsucker  sits just behind your wheel and attacks when you ease;
//   diesel       one steady power, never responds to a surge.
// It uses the same power-to-speed physics as you (physics.ts). No DOM, no Three.js.

import { DEFAULT_PARAMS, stepSpeed } from '../physics';
import type { OtherRider } from '../world/others';
import type { RivalProfile } from './rivals';

export interface BotContext {
  playerDistance: number;
  playerWatts: number;
  /** True once you have started moving: the rival waits on the line until then. */
  playerMoving: boolean;
  /** Metres to the finish line from the start of the road, or null. */
  finish: number | null;
  gradeAt(d: number): number;
  headwindAt(d: number): number;
  ftp: number;
  /** Rider plus bike, kg. The rival weighs the same as you, so equal watts means equal speed. */
  massKg: number;
}

export interface BotEvents { attackStarted: boolean }

export const ATTACK_COOLDOWN_S = 150;
const SPRINT_M = 300;
const CLIMB_ATTACK_GRADE = 0.06;

export class RivalBot {
  distance: number;
  speed = 0;
  power = 0;
  attacking = false;
  /** Seconds the bot has been riding. */
  time = 0;
  /** Bot clock at the moment it crossed the finish line, if it has. */
  crossedAt: number | null = null;
  started = false;
  private avgPlayer: number;
  private shortPlayer: number;
  private attackLeft = 0;
  private cooldown = 30; // no attack in the first half minute
  private sprintOn = false;

  constructor(readonly profile: RivalProfile, startDistance: number, ftp: number) {
    this.distance = startDistance + 4; // a few metres up the road
    this.avgPlayer = this.shortPlayer = 0.7 * ftp;
  }

  update(dt: number, c: BotContext): BotEvents {
    const ev: BotEvents = { attackStarted: false };
    if (!this.started) {
      if (!c.playerMoving) return ev;
      this.started = true;
    }
    this.time += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Your recent pace: a slow average (about two minutes, five for the diesel) and a quick one (about ten seconds).
    const slow = this.profile.style === 'diesel' ? 300 : 120;
    if (c.playerWatts > 0) {
      this.avgPlayer += (c.playerWatts - this.avgPlayer) * (1 - Math.exp(-dt / slow));
      this.shortPlayer += (c.playerWatts - this.shortPlayer) * (1 - Math.exp(-dt / 10));
    } else {
      this.shortPlayer += (0 - this.shortPlayer) * (1 - Math.exp(-dt / 10));
    }
    const base = Math.min(1.05 * c.ftp, Math.max(0.45 * c.ftp, this.avgPlayer)) * this.profile.pace;

    const gap = this.distance - c.playerDistance; // + = rival ahead
    const grade = c.gradeAt(this.distance);
    const style = this.profile.style;

    // Rubber band: ease off when well ahead, push when behind.
    const band = style === 'diesel' ? 0.03 : 0.1;
    let target = base * (1 - band * Math.max(-1, Math.min(1, gap / 150)));

    if (style === 'wheelsucker') {
      // Hold about six metres behind your wheel; the further they are from that, the harder the correction.
      const err = gap + 6;
      target = base * (1 - 0.3 * Math.max(-1, Math.min(1, err / 40)));
    }

    // Attacks.
    const remaining = c.finish === null ? null : c.finish - this.distance;
    if (style === 'sprinter') {
      if (remaining !== null && remaining <= SPRINT_M && !this.sprintOn) { this.sprintOn = true; this.startAttack(99, ev); }
    } else if (!this.attacking && this.cooldown <= 0 && this.attackWanted(style, grade, base, c)) {
      this.startAttack(style === 'climber' ? 40 : 22, ev);
    }
    if (this.attacking) {
      this.attackLeft -= dt;
      const boost = style === 'sprinter' ? 1.55 * c.ftp : Math.min(style === 'climber' ? 1.25 * c.ftp : 1.35 * c.ftp, base * 1.35);
      target = Math.max(target, boost);
      if (this.attackLeft <= 0) { this.attacking = false; this.cooldown = ATTACK_COOLDOWN_S; }
    }

    // Soft-pedal steep descents, like the pro teams.
    this.power = target * (grade < -0.04 ? 0.35 : 1);
    // Sheltering behind you within about eight metres saves the rival some drag.
    const draft = gap < 0 && gap > -8 ? 0.75 : 1;
    this.speed = stepSpeed(this.speed, this.power, grade, dt, { massKg: c.massKg, cda: DEFAULT_PARAMS.cda * draft, crr: DEFAULT_PARAMS.crr }, c.headwindAt(this.distance));
    this.distance += this.speed * dt;
    if (c.finish !== null && this.crossedAt === null && this.distance >= c.finish) this.crossedAt = this.time;
    return ev;
  }

  private startAttack(seconds: number, ev: BotEvents) {
    this.attacking = true;
    this.attackLeft = seconds;
    ev.attackStarted = true;
  }

  private attackWanted(style: string, grade: number, base: number, c: BotContext): boolean {
    if (style === 'climber') return grade >= CLIMB_ATTACK_GRADE;
    if (style === 'wheelsucker') {
      // You eased: your last ten seconds are well under your two-minute average, and you are close.
      return this.avgPlayer > 0.4 * c.ftp && this.shortPlayer < 0.65 * this.avgPlayer && Math.abs(this.distance - c.playerDistance) < 25 && base > 0;
    }
    return false;
  }

  /** The rival as another rider on the road. */
  asRider(speech: string | null): OtherRider {
    const p = this.profile;
    return {
      id: 'ai-rival',
      name: p.name,
      tag: `${p.emoji} ${p.short}`,
      distance: this.distance,
      speedMs: this.speed,
      power: Math.round(this.power),
      cadence: this.speed > 0.3 ? 90 : 0,
      jersey: p.jersey,
      accent: p.accent,
      frame: p.frame,
      lane: 2.4,
      speech: speech ?? undefined,
    };
  }

  /**
   * How it ended. `playerFinishS` is your moving time at the line when you finished a stage with a finish line.
   * Otherwise (an endless road, or a ride ended early) whoever is further up the road wins.
   */
  result(c: { playerDistance: number; finish: number | null; playerFinishS: number | null }): { won: boolean; gapS: number } {
    if (c.finish !== null && c.playerFinishS !== null) {
      if (this.crossedAt !== null) return { won: this.crossedAt > c.playerFinishS, gapS: Math.abs(this.crossedAt - c.playerFinishS) };
      const left = Math.max(0, c.finish - this.distance);
      return { won: true, gapS: left / Math.max(this.speed, 3) };
    }
    const gap = c.playerDistance - this.distance;
    return { won: gap >= 0, gapS: Math.abs(gap) / Math.max(this.speed, 3) };
  }
}
