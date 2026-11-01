// The AI coach and AI rivals for one ride, in one place. main.ts calls
// `frame()` every frame and a few hooks (a new ride, a ride that ended, a
// summary card being built); everything else lives here and in the modules
// beside it. The ride never waits on the AI: each request runs in the
// background and falls back to the canned text (canned.ts) on any failure.

import { askAi, saveConsent, saveDebrief, type AiConsent } from '../cloud/aiApi';
import type { OtherRider } from '../world/others';
import { cannedPlan, cannedRivalLines, cannedRivalPost, cannedTip } from './canned';
import { PlanRunner } from './coachPlan';
import { debriefCard, initCoachBubble, type CoachBubble } from './coachUi';
import { MomentDetector, type MomentHit } from './moments';
import { RivalBot } from './rivalBot';
import { LineLimiter, RivalTriggerEngine } from './rivalTriggers';
import { rivalById } from './rivals';
import { sanitizeDebrief, sanitizePlan, sanitizeRivalLines, sanitizeRivalPost, sanitizeTip } from './sanitize';
import { speak } from './speech';
import { RideStory } from './story';
import { pickFresh } from './text';
import { buildDebrief, type RideSummaryInput } from './summary';
import type { DebriefPayload, PlanPayload, RivalLines, RivalPostPayload, RivalTrigger, StageBrief } from './types';

export interface AiSettings { aiCoach: boolean; aiRivals: boolean; coachVoice: boolean; ftp: number; riderKg: number; bikeKg: number }

export interface AiHost {
  settings(): AiSettings;
  signedIn(): boolean;
  toast(msg: string, ms?: number): void;
  stageBrief(): StageBrief;
  stageName(): string;
  rideMode(): 'ride' | 'race' | 'workout';
  workoutBrief(): PlanPayload['workout'];
  gradeAt(d: number): number;
  headwindAt(d: number): number;
  /** Rides on the demo slider or a sped-up clock don't count in the head-to-head record. */
  countsForRecord(): boolean;
  loadSession(id: string, kind: 'workout' | 'stage'): void;
  patchSettings(p: Partial<Pick<AiSettings, 'aiCoach' | 'aiRivals'>>): void;
  openSettings(): void;
  openSignIn(reason: string): void;
}

/** What main.ts tells us every frame. */
export interface AiFrame {
  dt: number;
  movingTime: number;
  distance: number;
  watts: number;
  cadence: number;
  hr: number;
  gradePct: number;
  finish: number | null;
  /** Your moving time at the line once you have finished a stage, else 0. */
  finishS: number;
  finished: boolean;
  targetW: number | null;
  workoutS: number | null;
  gapAheadM: number | null;
  drafting: boolean;
  /** False when the ride is over or paused. */
  riding: boolean;
}

const SPEECH_S = 6;
/** Rides shorter than this (three minutes) get no debrief. */
export const DEBRIEF_MIN_S = 180;

export class AiRide {
  private readonly bubble: CoachBubble;
  private clock = 0;
  // coach
  private moments = new MomentDetector();
  private plan: PlanRunner | null = null;
  private planAsked = false;
  private tipBusy = false;
  private onTargetS = 0;
  private targetS = 0;
  // rival
  private rivalId: string | null = null;
  private bot: RivalBot | null = null;
  private engine = new RivalTriggerEngine();
  private limiter = new LineLimiter();
  private story = new RideStory();
  private lines: RivalLines | null = null;
  private recent: string[] = [];
  private said: { text: string; until: number } | null = null;
  private posted = false;
  private lastFrame: AiFrame | null = null;
  /** Called when a rival's record may have changed (a ride was added). */
  onRecordChanged: () => void = () => {};

  constructor(private readonly host: AiHost) {
    this.bubble = initCoachBubble();
  }

  private coachOn() { return this.host.settings().aiCoach && this.host.signedIn(); }
  private rivalAiOn() { return this.host.settings().aiRivals && this.host.signedIn(); }

  // ----------------------------------------------------------- consent ----

  // (After sign-in the settings follow the database's consent: main.ts does that without loading this file.)

  /** The rider changed the switches in Settings: save them (or put them back if that fails). */
  async applyConsent(next: AiConsent, previous: AiConsent) {
    if (next.coach === previous.coach && next.rivals === previous.rivals) return;
    if (!this.host.signedIn()) {
      this.host.patchSettings({ aiCoach: false, aiRivals: false });
      if (next.coach || next.rivals) this.host.toast('Sign in to turn on the AI coach or rivals.');
      return;
    }
    const saved = await saveConsent(next);
    if (!saved) {
      this.host.patchSettings({ aiCoach: previous.coach, aiRivals: previous.rivals });
      this.host.toast('Couldn’t save your AI choice. Check your connection and try again.', 5000);
      return;
    }
    this.host.patchSettings({ aiCoach: saved.coach, aiRivals: saved.rivals });
  }

  // -------------------------------------------------------------- ride ----

  /** A fresh ride begins (reset, new stage, race). The chosen rival stays and lines up again. */
  newRide() {
    this.moments.reset();
    this.plan = null;
    this.planAsked = false;
    this.onTargetS = this.targetS = 0;
    this.bubble.hide();
    this.bot = null;
    this.engine = new RivalTriggerEngine();
    this.limiter = new LineLimiter();
    this.story = new RideStory();
    this.said = null;
    this.posted = false;
  }

  /** A workout was started mid-ride: the coach plans it from the workout's steps. */
  workoutStarted() {
    this.plan = null;
    this.planAsked = false;
    this.onTargetS = this.targetS = 0;
  }

  /** Called every frame. Returns the rival as a rider on the road, if one is riding with you. */
  frame(f: AiFrame): OtherRider | null {
    this.lastFrame = f;
    this.clock += f.dt;
    if (f.riding && this.coachOn()) this.coachFrame(f);
    return this.rivalFrame(f);
  }

  // ------------------------------------------------------------- coach ----

  private coachFrame(f: AiFrame) {
    if (!this.planAsked && f.movingTime > 5) {
      this.planAsked = true;
      void this.requestPlan();
    }
    const tip = this.plan?.due(f.distance, f.workoutS);
    if (tip) this.showTip(tip.text);
    if (f.targetW !== null && f.watts > 0) {
      this.targetS += f.dt;
      if (Math.abs(f.watts - f.targetW) <= 0.1 * f.targetW) this.onTargetS += f.dt;
    }
    const hit = this.moments.update({
      dt: f.dt, riding: f.riding, gradePct: f.gradePct, cadence: f.cadence, watts: f.watts, targetW: f.targetW, hr: f.hr, gapAheadM: f.gapAheadM, drafting: f.drafting,
    });
    if (hit) void this.requestTip(hit, f);
  }

  private showTip(text: string) {
    this.bubble.show(text, this.host.settings().coachVoice);
  }

  private async requestPlan() {
    const workout = this.host.rideMode() === 'workout' ? this.host.workoutBrief() : null;
    const payload: PlanPayload = { stage: this.host.stageBrief(), mode: this.host.rideMode(), workout };
    const r = await askAi('coach_plan', payload);
    const tips = r.ok ? sanitizePlan(r.data, workout ? null : payload.stage.lengthM) : null;
    this.plan = new PlanRunner((tips ?? cannedPlan(payload)).tips);
  }

  private async requestTip(hit: MomentHit, f: AiFrame) {
    if (this.tipBusy) return;
    this.tipBusy = true;
    try {
      const r = await askAi('coach_tip', {
        moment: hit.moment, stageName: this.host.stageName(), gradePct: Math.round(f.gradePct * 10) / 10, watts: Math.round(f.watts),
        targetW: f.targetW === null ? null : Math.round(f.targetW), cadence: Math.round(f.cadence), hr: Math.round(f.hr),
        hrDriftPct: hit.hrDriftPct, gapM: f.gapAheadM === null ? null : Math.round(f.gapAheadM * 10) / 10, seconds: hit.seconds,
      });
      const tip = r.ok ? sanitizeTip(r.data) : null;
      this.showTip(tip?.text ?? cannedTip(hit.moment));
    } finally {
      this.tipBusy = false;
    }
  }

  /** Time on target in the current workout, for the debrief. */
  workoutCompliance() {
    return { onTargetS: this.onTargetS, totalS: this.targetS };
  }

  /** `debrief()` from the raw numbers of a ride (main.ts doesn't import summary.ts, so this file stays out of the entry chunk). */
  debriefRide(input: RideSummaryInput) {
    return this.debrief(buildDebrief(input));
  }

  /**
   * The coach's card for a ride summary. It shows at once ("looking over your
   * ride") and fills in when the debrief arrives; `rideSaved(id)` tells it the
   * ride is in the account, so the debrief can be kept with it.
   */
  debrief(payload: DebriefPayload): { node: Node; rideSaved(activityId: string | null): void } | null {
    if (payload.durationS < DEBRIEF_MIN_S) return null;
    const signedIn = this.host.signedIn();
    const on = this.coachOn();
    const card = debriefCard({
      invite: on ? null : signedIn
        ? { text: 'Want Coach Marty’s take on every ride?', button: 'Turn on the AI coach', onClick: () => { document.getElementById('finish')!.hidden = true; this.host.openSettings(); } }
        : { text: 'Sign in and turn on the AI coach for a debrief after each ride.', button: 'Sign in', onClick: () => this.host.openSignIn('Sign in to get a debrief from the AI coach.') },
      load: (id, kind) => { document.getElementById('finish')!.hidden = true; this.host.loadSession(id, kind); },
    });
    let saved!: (id: string | null) => void;
    const savedP = new Promise<string | null>((res) => { saved = res; });
    if (on) {
      void (async () => {
        const r = await askAi('coach_debrief', payload);
        const d = r.ok ? sanitizeDebrief(r.data) : null;
        if (d) {
          card.fill(d, r.ok ? r.source : 'canned');
          const id = await savedP;
          if (id && r.ok && r.source === 'claude') void saveDebrief(id, d);
        } else {
          card.fallback(payload);
        }
      })();
    }
    return { node: card.node, rideSaved: saved };
  }

  // ------------------------------------------------------------ rivals ----

  get rival() {
    return this.rivalId;
  }

  startRival(id: string) {
    const profile = rivalById(id);
    if (!profile) return;
    this.rivalId = id;
    this.bot = null;
    this.engine = new RivalTriggerEngine();
    this.limiter = new LineLimiter();
    this.story = new RideStory();
    this.said = null;
    this.posted = false;
    this.lines = cannedRivalLines(id);
    this.host.toast(`${profile.name} will ride with you. Stay close!`, 4000);
    if (this.rivalAiOn()) {
      void askAi('rival_pre', { rival: id, stage: this.host.stageBrief(), mode: this.host.rideMode() === 'race' ? 'race' : 'ride' }).then((r) => {
        const out = r.ok ? sanitizeRivalLines(r.data, id) : null;
        if (out && this.rivalId === id) this.lines = out.lines;
      });
    }
  }

  stopRival() {
    this.rivalId = null;
    this.bot = null;
    this.said = null;
  }

  private rivalFrame(f: AiFrame): OtherRider | null {
    const profile = rivalById(this.rivalId);
    if (!profile) return null;
    const s = this.host.settings();
    if (!this.bot) this.bot = new RivalBot(profile, f.distance, s.ftp);
    const bot = this.bot;
    bot.update(f.dt, {
      playerDistance: f.distance, playerWatts: f.watts, playerMoving: f.movingTime > 0, finish: f.finish,
      gradeAt: this.host.gradeAt, headwindAt: this.host.headwindAt, ftp: s.ftp, massKg: s.riderKg + s.bikeKg,
    });
    const gap = bot.distance - f.distance;
    this.story.gap(gap);
    const finished = bot.crossedAt !== null && (!f.finished || bot.crossedAt < (f.finishS || Infinity)) ? 'rival' : f.finished ? 'player' : null;
    for (const t of this.engine.update({ gap, attacking: bot.attacking, remaining: f.finish === null ? null : f.finish - f.distance, started: bot.started, finished })) {
      this.story.trigger(t, f.gradePct);
      if (this.limiter.accept(t, this.clock)) this.say(t);
    }
    if (this.said && performance.now() > this.said.until) this.said = null;
    return bot.asRider(this.said?.text ?? null);
  }

  private say(t: RivalTrigger) {
    const profile = rivalById(this.rivalId);
    if (!profile) return;
    const pool = this.lines?.[t] ?? profile.canned[t];
    const line = pickFresh(pool, this.recent);
    if (!line) return;
    this.recent = [...this.recent, line].slice(-6);
    this.speak(profile.short, line);
  }

  private speak(who: string, line: string) {
    const profile = rivalById(this.rivalId);
    this.said = { text: line, until: performance.now() + SPEECH_S * 1000 }; // real time: the bubble stays up for 6 s whatever the ride clock does
    this.host.toast(`${profile?.emoji ?? ''} ${who}: “${line}”`, 4500);
    if (profile && this.host.settings().coachVoice) speak(line, profile.speech);
  }

  /**
   * The ride is over (the finish line, or the rider ended it): the rival says
   * goodbye and, for rides that count, remembers it. `attach` puts a note on the summary card.
   */
  async rideEnded(info: { distance: number; finish: number | null; finishS: number | null; movingTime: number; lengthKm: number | null }, attach: (n: Node) => void) {
    const profile = rivalById(this.rivalId);
    const bot = this.bot;
    if (!profile || !bot || !bot.started || this.posted || info.movingTime < 60) return;
    this.posted = true;
    const res = bot.result({ playerDistance: info.distance, finish: info.finish, playerFinishS: info.finishS });
    const payload: RivalPostPayload = {
      rival: profile.id, result: res.won ? 'won' : 'lost', gapS: Math.round(res.gapS * 10) / 10, stageName: this.host.stageName(),
      lengthKm: info.lengthKm, moments: this.story.moments(res.won, res.gapS), counts: this.host.countsForRecord(),
    };
    const note = document.createElement('p');
    note.className = 'finish-ghost rival-closing';
    const show = (line: string) => { note.textContent = `${profile.emoji} ${profile.short}: “${line}”`; };
    show(cannedRivalPost(payload).line);
    attach(note);
    if (!this.rivalAiOn()) return;
    const r = await askAi('rival_post', payload);
    const out = r.ok ? sanitizeRivalPost(r.data) : null;
    if (out) show(out.line);
    if (r.ok && payload.counts) this.onRecordChanged();
  }

  /** The last frame we saw, for the rivals dialog and tests. */
  get last() {
    return this.lastFrame;
  }
}
