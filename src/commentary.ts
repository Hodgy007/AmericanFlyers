// The race commentator. Short voice lines (public/audio/commentary/<key>-<n>.mp3,
// generated once with Higgsfield and committed) that react to what happens in a
// race: the start, attacks, the break, gaps, sprints, summits, the last
// kilometre and the finish, plus lines about you. No real people or teams are named.
//
//  - `Commentator` decides *whether* a line may play now: one at a time, a pause
//    between lines, a cooldown per kind of line, a cap per minute, and a small
//    queue for important lines. It knows nothing about audio or the DOM (its
//    player is injected), so it is unit-tested with a fake clock.
//  - `RaceCommentary` turns a race's events and a per-frame snapshot into `say()` calls.
//  - `ClipPlayer` plays the files with an <audio> element and ducks the ride sounds.

export type ClipKey =
  | 'start' | 'lobby' | 'attack' | 'break' | 'caught' | 'gap_growing' | 'gap_closing' | 'sprint_mid' | 'kom'
  | 'halfway' | 'one_km' | 'sprint_launch' | 'you_attack' | 'you_lead' | 'you_dropped' | 'you_back'
  | 'you_yellow' | 'you_win' | 'you_podium' | 'finish';

/** What each clip says (also the captions, and the record of what was generated). */
export const CLIPS: Record<ClipKey, string[]> = {
  start: ['And they\'re off! The race is underway!', 'The flag drops, and the race is on!', 'Here we go, everybody. Let\'s race!'],
  lobby: ['Riders, you\'re on the start line. Not long to go now!', 'The field is rolling up to the line. Get ready!'],
  attack: ['An attack! Someone\'s going off the front!', 'There\'s a move! They\'re trying to get away!', 'Big acceleration up the road!'],
  break: ['We have a breakaway! They\'re pulling away from the bunch.', 'The break is formed! A small group has gone clear.'],
  caught: ['And the break is caught! It\'s all back together.', 'The bunch swallows up the breakaway. Back to square one.'],
  gap_growing: ['The gap is growing. The break is getting away.', 'The leaders are stretching it out. That gap keeps growing!'],
  gap_closing: ['The gap is coming down. The chase is on!', 'The chasers are digging in. The gap is closing fast!'],
  sprint_mid: ['Here comes the intermediate sprint! Who wants the points?', 'The sprint line is coming up. Go, go, go!'],
  kom: ['Over the top of the climb! The mountain points go on the board.', 'The summit! What a huge effort to reach the top.'],
  halfway: ['Halfway through the race. It\'s all to play for!'],
  one_km: ['One kilometre to go! Here comes the finish!', 'One kilometre to go, and the pace is rising!'],
  sprint_launch: ['The sprint is launched! Flat out for the line!', 'They\'re sprinting for the finish! Full gas!'],
  you_attack: ['You attack! Look at you go!', 'You\'re launching an attack! Can anyone follow?'],
  you_lead: ['You\'re leading the race! Keep it going!', 'You\'re at the front now. Stay strong!'],
  you_dropped: ['You\'ve been dropped. Dig deep and fight your way back!', 'The bunch is pulling away. Don\'t give up!'],
  you_back: ['You\'re back in the bunch! Great fighting spirit!'],
  you_yellow: ['You\'re in the yellow jersey! Defend it!', 'The yellow jersey is yours. Wear it with pride!'],
  you_win: ['You win! You\'ve won the race! What a ride!', 'First across the line, and it\'s you! Brilliant!'],
  you_podium: ['On the podium! Fantastic ride!'],
  finish: ['The race is decided, and you\'ve crossed the line. Well ridden!', 'Across the line! That was a hard-fought race.'],
};

export const clipUrl = (key: ClipKey, variant: number) => `/audio/commentary/${key}-${variant + 1}.mp3`;

/** 3 = must be heard (queued if busy), 2 = important, 1 = nice to have (dropped if busy). */
export type Priority = 1 | 2 | 3;

/** Seconds before the same kind of line may play again. */
const COOLDOWN: Partial<Record<ClipKey, number>> = {
  attack: 45, break: 600, caught: 120, gap_growing: 70, gap_closing: 70, sprint_mid: 20, kom: 20, lobby: 120,
  you_attack: 150, you_lead: 150, you_dropped: 150, you_back: 150, you_yellow: 300,
};
const DEFAULT_COOLDOWN = 60;
const PAUSE = 3; // seconds of quiet after a line
const MAX_PER_MINUTE = 5;
const QUEUE_LIFE = 8; // seconds a waiting line stays worth saying

export interface LinePlayer {
  /** Starts a clip. */
  play(url: string): void;
  /** Is a clip sounding right now? */
  playing(): boolean;
}

export class Commentator {
  enabled = true;
  private lastEnd = -Infinity; // when the last line finished (clock seconds)
  private wasPlaying = false;
  private lastSaid = new Map<ClipKey, number>();
  private lastVariant = new Map<ClipKey, number>();
  private history: number[] = []; // start times of recent lines
  private queued: { key: ClipKey; priority: Priority; at: number } | null = null;

  constructor(
    private readonly player: LinePlayer,
    /** Seconds on any steady clock. */
    private readonly now: () => number,
    private readonly rand: () => number = Math.random,
  ) {}

  /**
   * Asks to say a line. Returns true if it started at once; false if it was
   * dropped or queued (priority 3, and priority 2 when nothing better waits).
   */
  say(key: ClipKey, priority: Priority = 1): boolean {
    if (!this.enabled) return false;
    const t = this.now();
    this.syncPlaying(t);
    const cool = COOLDOWN[key] ?? DEFAULT_COOLDOWN;
    const last = this.lastSaid.get(key);
    if (last !== undefined && t - last < cool && priority < 3) return false;
    if (last !== undefined && t - last < Math.min(cool, 15)) return false; // not even a must-hear line twice in a row
    if (this.canStart(t, priority)) return this.start(key, t);
    if (priority >= 2 && (!this.queued || this.queued.priority <= priority)) this.queued = { key, priority, at: t };
    return false;
  }

  /** Call every frame or so: lets a waiting line go once the current one is done. */
  tick() {
    const t = this.now();
    this.syncPlaying(t);
    const q = this.queued;
    if (!q) return;
    if (t - q.at > QUEUE_LIFE) { this.queued = null; return; }
    if (this.canStart(t, q.priority)) {
      this.queued = null;
      this.start(q.key, t);
    }
  }

  /** Forgets everything between races. */
  reset() {
    this.lastSaid.clear();
    this.history = [];
    this.queued = null;
    this.lastEnd = -Infinity;
  }

  private syncPlaying(t: number) {
    const p = this.player.playing();
    if (this.wasPlaying && !p) this.lastEnd = t;
    this.wasPlaying = p;
  }

  private canStart(t: number, priority: Priority) {
    if (this.player.playing()) return false;
    if (t - this.lastEnd < PAUSE) return false;
    this.history = this.history.filter((x) => t - x < 60);
    return this.history.length < MAX_PER_MINUTE || priority === 3;
  }

  private start(key: ClipKey, t: number) {
    const n = CLIPS[key].length;
    let v = Math.floor(this.rand() * n) % n;
    const prev = this.lastVariant.get(key);
    if (n > 1 && v === prev) v = (v + 1) % n; // never the same line twice in a row
    this.lastVariant.set(key, v);
    this.lastSaid.set(key, t);
    this.history.push(t);
    this.wasPlaying = true;
    this.player.play(clipUrl(key, v));
    return true;
  }
}

// ------------------------------------------------------------- the race ----

export interface RaceSnapshot {
  t: number; // race time, seconds
  place: number;
  total: number;
  myDistance: number;
  leadDistance: number; // front-most rider, you included
  finish: number;
  power: number;
  ftp: number;
  groups: { label: string; size: number; gapSec: number; you: boolean }[];
  yellowIsYou: boolean;
  tour: boolean;
  /** Summit lines on this course (metres). */
  summits: number[];
  dt: number;
}

/** Turns race events and snapshots into commentary. One per race. */
export class RaceCommentary {
  private started = false;
  private seen = { halfway: false, oneKm: false, yellow: false, lobby: false };
  private summits = new Set<number>();
  private wasFirst = false;
  private hardFor = 0;
  private droppedSince: number | null = null;
  private lastGap: { gap: number; at: number } | null = null;

  constructor(private readonly c: Commentator) {}

  /** The riders are on the line and the countdown is under 30 s. */
  lobby() {
    if (this.seen.lobby) return;
    this.seen.lobby = true;
    this.c.say('lobby', 2);
  }

  /** From the race engine's own events (`LiveRace.onEvent`). */
  event(text: string, kind: string) {
    if (kind === 'attack') this.c.say('attack', 2);
    else if (kind === 'break') this.c.say('break', 2);
    else if (kind === 'caught') this.c.say('caught', 2);
    else if (kind === 'sprint') this.c.say(/for the line/i.test(text) ? 'sprint_launch' : 'sprint_mid', /for the line/i.test(text) ? 3 : 2);
  }

  /** The player has crossed the line. */
  finished(place: number) {
    this.c.say(place === 1 ? 'you_win' : place <= 3 ? 'you_podium' : 'finish', 3);
  }

  /** Once a frame (or a few times a second) while racing. */
  update(s: RaceSnapshot) {
    this.c.tick();
    if (!this.started) {
      this.started = true;
      if (s.t < 20) this.c.say('start', 3); // not for someone joining late
    }
    const toGo = s.finish - Math.max(s.leadDistance, s.myDistance);

    if (!this.seen.oneKm && toGo < 1000 && toGo > 0 && s.finish > 3000) { this.seen.oneKm = true; this.c.say('one_km', 3); }
    if (!this.seen.halfway && s.finish > 8000 && s.leadDistance > s.finish / 2) { this.seen.halfway = true; this.c.say('halfway', 1); }
    for (const d of s.summits) {
      if (!this.summits.has(d) && s.leadDistance > d) { this.summits.add(d); this.c.say('kom', 2); }
    }

    // The yellow jersey: said once, when it becomes yours in a tour stage.
    if (s.tour && s.yellowIsYou && !this.seen.yellow && s.t > 1) { this.seen.yellow = true; this.c.say('you_yellow', 2); }

    // You lead the race.
    const first = s.place === 1 && s.total > 1;
    if (first && !this.wasFirst && s.t > 30 && toGo > 400) this.c.say('you_lead', 2);
    this.wasFirst = first;

    // You attack: well over your threshold for a while, not in the final sprint.
    if (s.ftp > 0 && s.power > 1.35 * s.ftp && toGo > 600) this.hardFor += s.dt; else this.hardFor = Math.max(0, this.hardFor - s.dt);
    if (this.hardFor >= 6) { this.hardFor = 0; this.c.say('you_attack', 2); }

    // Dropped: alone, with a bunch more than 20 s up the road. Back: with a group again.
    const me = s.groups.find((g) => g.you);
    const bunch = s.groups.find((g) => !g.you && g.size >= 10);
    const gapToBunch = me && bunch ? me.gapSec - bunch.gapSec : 0;
    const alone = !!me && me.size === 1;
    if (this.droppedSince === null) {
      if (alone && bunch && gapToBunch > 20 && s.t > 60) { this.droppedSince = s.t; this.c.say('you_dropped', 2); }
    } else if ((!alone || gapToBunch < 6) && s.t - this.droppedSince > 20) {
      this.c.say('you_back', 1);
      this.droppedSince = null;
    }

    // The break's lead over the bunch, when you are not in it.
    if (s.groups.length > 1 && s.groups[0].label === 'Break' && !s.groups[0].you) {
      const gap = s.groups[1].gapSec;
      if (!this.lastGap) this.lastGap = { gap, at: s.t };
      else if (s.t - this.lastGap.at > 25) {
        if (gap > this.lastGap.gap + 10) this.c.say('gap_growing', 1);
        else if (gap < this.lastGap.gap - 10) this.c.say('gap_closing', 1);
        this.lastGap = { gap, at: s.t };
      }
    }
  }
}

// ----------------------------------------------------------- the audio ----

/** Plays the clips with an <audio> element, quieting the ride sounds while one speaks. */
export class ClipPlayer implements LinePlayer {
  private el: HTMLAudioElement | null = null;
  private busy = false;
  volume = 0.9;
  /** Called with true as a line starts and false as it ends (to duck the other sounds). */
  onDuck: (on: boolean) => void = () => {};

  play(url: string) {
    this.stop();
    const el = new Audio(url);
    el.volume = this.volume;
    this.el = el;
    this.busy = true;
    const end = () => {
      if (this.el !== el) return;
      this.busy = false;
      this.el = null;
      this.onDuck(false);
    };
    el.addEventListener('ended', end);
    el.addEventListener('error', end);
    this.onDuck(true);
    el.play().catch(end); // blocked until the rider has clicked somewhere
  }

  playing() {
    return this.busy;
  }

  stop() {
    if (!this.el) return;
    this.el.pause();
    this.el = null;
    this.busy = false;
    this.onDuck(false);
  }

  /** Fetches the clips for a race ahead of time, so the first line is not late. */
  static preload() {
    for (const [key, lines] of Object.entries(CLIPS)) {
      lines.forEach((_, i) => { fetch(clipUrl(key as ClipKey, i)).catch(() => {}); });
    }
  }
}
