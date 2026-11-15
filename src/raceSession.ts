// The race or scheduled event you are riding, and the steps between "none" and "one": lining up a race (single, tour stage or
// event), joining an event, leaving either, finishing a race (the result, the tour standings, the buttons the card offers) and,
// once a frame, the lobby strip and the commentator's cues. `createRaceSession()` owns that state (`race`, `event` and the
// commentator for the race) and reaches everything else (the pro teams, the tour's saved progress, the toasts, the beeps, the
// lazy race, tour, events and commentary screens, presence, the lobby strip) through `RaceSessionDeps`, so it can be driven in a
// unit test (tests/unit/raceSession.test.ts). No DOM and no three.js, and only types from commentary.ts (that chunk loads on demand).
// What stays in main.ts: choosing the stage and resetting the ride before a race or event starts, the lazy loading itself, the
// event finish card's table, and what showFinish() does with the finish (the card, the AI debrief, the share button).
// The rules about events (the clock, who is dropped, the strip's wording) are in eventSession.ts, the engines in race.ts and tour.ts.

import type { RaceCommentary, RaceSnapshot } from './commentary';
import type { EventRow } from './cloud/events';
import {
  DropWatcher, EVENT_REF_WKG, GROUP_RIDE_OVER_MESSAGE, activeEvent, dropMessage, eventHolding, eventOver, groupRideStatus, joinMessage, lobbyStatus,
  secondsSinceStart, type ActiveEvent,
} from './eventSession';
import type { Peloton } from './peloton';
import { LiveRace, ME, raceSetup, type PanelData, type ResultRow } from './race';
import { stageById } from './routes/library';
import type { Stage } from './stages';
import type { SummaryAction } from './summaryContent';
import { JERSEY_NAMES, TOUR_STAGE_IDS, myJerseys, priorTotals, tourComplete, tourStageNumber, type Jersey, type TourProgress } from './tour';

/** A scheduled event you have joined. `demoUsed` is set (by the surroundings) once you ride in demo mode, which keeps you off the results. */
export interface JoinedEvent { ev: ActiveEvent; drop: DropWatcher; demoUsed: boolean }

// ---------------------------------------------------------------- rules ----

/** Where the rider finished, from a race's results (best first): their row (a made-up one if they are missing), and their place (0 if missing). */
export function riderResult(rows: ResultRow[], raceTime: number): { me: ResultRow; place: number } {
  const me = rows.find((x) => x.you) ?? { id: ME, name: 'You', team: -1, time: raceTime, sprint: 0, kom: 0, you: true };
  return { me, place: rows.findIndex((x) => x.you) + 1 };
}

/** What the tour's next step is after tour stage number `tourN` (1 to 3): the next stage's id, or null when the tour is complete. */
export function nextTourStage(tourN: number, tour: TourProgress | null): string | null {
  const next: string | undefined = TOUR_STAGE_IDS[tourN];
  return next && tour && !tourComplete(tour) ? next : null;
}

/** The toast when a tour stage leaves you in a jersey. */
export const tourLeadMessage = (worn: Jersey[]) => `You lead the tour: ${worn.map((j) => JERSEY_NAMES[j].toLowerCase()).join(' and ')}!`;

/** The toast when a race lines up. */
export const raceStartMessage = (stageName: string, tourStage: number | null) =>
  `${tourStage ? `Stage ${tourStage} of the tour · ` : ''}${stageName.replace('Hell of the West · ', '')}: roll up to the line.`;

/** The commentator says its lobby line while the field waits between 5 and 30 seconds from the start. */
export const lobbyDue = (race: Pick<LiveRace, 'phase' | 'untilGo'>) => race.phase === 'countdown' && race.untilGo > 5 && race.untilGo <= 30;

/** The picture of the race the commentator gets each frame. */
export function raceSnapshot(race: Pick<LiveRace, 'course' | 'tourStage'>, panel: PanelData, rider: { distance: number; power: number; ftp: number }): RaceSnapshot {
  return {
    t: panel.raceTime,
    place: panel.place,
    total: panel.total,
    myDistance: rider.distance,
    leadDistance: panel.leadPos,
    finish: race.course.finish,
    power: rider.power,
    ftp: rider.ftp,
    groups: panel.groups,
    yellowIsYou: panel.jerseys.yellow === 'You',
    tour: race.tourStage !== null,
    summits: race.course.lines.filter((l) => l.kind === 'summit').map((l) => l.d),
    dt: 0.2,
  };
}

// ---------------------------------------------------------------- session ----

/** The race commentator for one race, as the session uses it (src/commentary.ts's `RaceCommentary`). */
export type RaceCommentaryLike = Pick<RaceCommentary, 'lobby' | 'event' | 'finished' | 'update'>;

/** The loaded commentary chunk, as the session uses it. */
export interface CommentaryKit {
  /** Clears the commentator's memory for a new race. */
  reset(): void;
  /** A new `RaceCommentary` on that commentator. */
  create(): RaceCommentaryLike;
  /** Starts fetching the voice clips. */
  preload(): void;
}

/** The commentator's switch and tick (src/commentary.ts's `Commentator`), once it has loaded. */
export interface CommentatorLike { enabled: boolean; tick(): void }

/** What a race hands the finish card. */
export interface RaceFinish {
  rows: ResultRow[];
  me: ResultRow;
  /** The rider's place, 1 for the winner. */
  place: number;
  /** The tour's progress after this stage, or null when this was not a tour stage. */
  tour: TourProgress | null;
  /** The card's buttons: always "Keep riding" first, then the next stage, the standings or "Race again". */
  actions: SummaryAction[];
}

/** Everything the session reads or calls. Each is a read of another subsystem or a side effect on one. */
export interface RaceSessionDeps {
  /** The pro teams (src/peloton.ts). */
  peloton: Pick<Peloton, 'startRace' | 'endRace' | 'startGroupRide' | 'endGroupRide'>;
  /** The tour's saved progress (src/tour.ts's `getTour` and `recordStage`). */
  tour: { get(): TourProgress | null; record(stageId: string, rows: ResultRow[]): unknown };
  /** The field's watts per kilo for a race of your own (the rider's FTP and weight). */
  refWkg(): number;
  /** A random number from 0 up to 1, for a race's seed. */
  random(): number;
  /** The server's clock, in milliseconds. */
  serverNow(): number;
  /** A steady clock, in seconds. */
  nowS(): number;
  /** The rider's place on the road and effort now. */
  rider(): { distance: number; power: number; ftp: number };
  toast(text: string, ms?: number): void;
  /** A toast `delayMs` from now. */
  toastLater(text: string, delayMs: number, ms: number): void;
  /** The 3-2-1 beep (`true` for the long one as the race starts). */
  beep(last: boolean): void;
  /** Starts loading the race screens if they are not here yet. */
  prefetchRaceUi(): void;
  /** Hides the live panel, and the 3-2-1 text. */
  hidePanel(): void;
  hideCountdown(): void;
  /** Runs `run` once the commentary chunk has loaded (now, if it already has). */
  useCommentary(run: (kit: CommentaryKit) => void): void;
  /** The commentator if the chunk has loaded, else null. */
  commentator(): CommentatorLike | null;
  /** Whether commentary is wanted: switched on in the settings and the sound is on. */
  commentaryWanted(): boolean;
  /** Silences a clip that is playing. */
  stopClips(): void;
  /** The lobby strip above the road (shown while an event is joined). */
  eventBar: { show(title: string, status: string): void; hide(): void };
  /** Tells presence the stage key has changed (joining or leaving an event). */
  restagePresence(): void;
  /** The other riders in the event's room. */
  otherRiders(): number;
  /** Metres behind the back of the group ride's pace group (negative if ahead), or null when there is no group. */
  groupGap(): number | null;
  /** Starts a new ride (which leaves the event). */
  resetRide(): void;
  /** Lines up a race on a stage: main.ts picks the stage first, then calls `start()`. Used by the finish card's buttons. */
  beginRace(stage: Stage, tourStage: number | null): void;
  /** Opens the tour's standings. */
  openTour(): void;
}

export interface RaceSession {
  /** The race being ridden, if any (a single race, a tour stage or an event race). */
  readonly race: LiveRace | null;
  /** The event you have joined, if any. */
  readonly event: JoinedEvent | null;
  /** True while a group ride holds you on the line until its start. */
  eventHolding(): boolean;
  /** Starts a race on `stage`, the stage already chosen and the ride reset (`tourStage` is 1 to 3 in the tour, else null). */
  start(stage: Stage, tourStage: number | null): void;
  /** Joins an event on its stage (already chosen and the ride reset), starts its field and shows the lobby. */
  join(row: EventRow, stage: Stage): void;
  /** Ends a race and leaves an event. */
  leave(): void;
  /** The rider has crossed the line: lets the field finish, records a tour stage and works out the card's buttons. */
  finish(r: LiveRace): RaceFinish;
  /** The commentator's line for finishing in `place`. */
  announceFinish(place: number): void;
  /** The race is over (the rider finished): the teams ride the road again, and the event, if any, ends. */
  endRace(distance: number): void;
  /** About five times a second: the lobby strip and the group ride's "dropped" notes. */
  updateEvent(): void;
  /** Once a frame: feeds the commentator this frame's race picture (the live panel's numbers, or null before the start). */
  updateCommentary(panel: PanelData | null): void;
}

export function createRaceSession(deps: RaceSessionDeps): RaceSession {
  let race: LiveRace | null = null;
  let event: JoinedEvent | null = null;
  let commentary: RaceCommentaryLike | null = null;
  let clipsPreloaded = false;

  /** Wires a new race to the beeps and the commentator (single races, tour stages and events). */
  function attach(r: LiveRace) {
    r.onBeep = (last) => deps.beep(last);
    deps.prefetchRaceUi();
    commentary = null;
    // The commentator is normally loaded already (prefetched after the first frame); if not, it joins in a moment.
    deps.useCommentary((kit) => {
      if (race !== r) return; // the race ended or changed while it loaded
      kit.reset();
      commentary = kit.create();
      r.onEvent = (text, kind) => commentary?.event(text, kind);
      if (!clipsPreloaded && deps.commentaryWanted()) { clipsPreloaded = true; kit.preload(); }
    });
  }

  /** Leaves the event (you finish, reset, or pick another stage): the road goes back to normal. */
  function endEvent() {
    if (!event) return;
    event = null;
    deps.peloton.endGroupRide(deps.rider().distance);
    deps.eventBar.hide();
    deps.restagePresence();
  }

  /** About five times a second: the lobby strip, the group ride's "you've been dropped" notes. */
  function updateEvent() {
    if (!event) return;
    const { ev, drop } = event;
    const t = secondsSinceStart(ev, deps.serverNow());
    if (t < 0) { deps.eventBar.show(ev.title, lobbyStatus(t, deps.otherRiders())); return; }
    if (ev.kind === 'race') { deps.eventBar.hide(); return; }
    // Group ride.
    if (eventOver(ev, deps.serverNow())) {
      deps.toast(GROUP_RIDE_OVER_MESSAGE, 6000);
      deps.resetRide();
      return;
    }
    const gap = deps.groupGap(); // metres behind the back of the group
    if (gap === null) return;
    const note = drop.update(gap, deps.nowS());
    if (note) { const m = dropMessage(note); deps.toast(m.text, m.ms); }
    deps.eventBar.show(ev.title, groupRideStatus(gap, drop.isDropped, t));
  }

  return {
    get race() { return race; },
    get event() { return event; },
    eventHolding: () => !!event && eventHolding(event.ev, deps.serverNow()),

    start(stage, tourStage) {
      const tour = tourStage ? deps.tour.get() : null;
      const seed = tour ? tour.seed : Math.floor(deps.random() * 1e9);
      const { roster, course } = raceSetup(stage, seed);
      const field = deps.peloton.startRace(course, roster, deps.refWkg(), seed);
      race = new LiveRace(stage, field, priorTotals(tour, stage.id), tourStage);
      attach(race);
      deps.toast(raceStartMessage(stage.name, tourStage), 4000);
    },

    join(row, stage) {
      const ev = activeEvent(row, new Date(row.starts_at).getTime());
      event = { ev, drop: new DropWatcher(), demoUsed: false };
      const clock = () => secondsSinceStart(ev, deps.serverNow());
      if (ev.kind === 'race') {
        const { roster, course } = raceSetup(stage, ev.seed);
        // A scheduled event runs in shared conditions: the same field on every client, whatever the rider's weather.
        const field = deps.peloton.startRace(course, roster, EVENT_REF_WKG, ev.seed, 'event');
        race = new LiveRace(stage, field, new Map(), null);
        race.useEventClock(clock);
        attach(race);
      } else {
        deps.peloton.startGroupRide(ev.paceWkg ?? 2.6, ev.seed, clock);
      }
      deps.restagePresence(); // only riders in this event see each other
      deps.toast(joinMessage(ev.title, clock()), 5000);
      updateEvent();
    },

    leave() {
      if (race) { race = null; deps.peloton.endRace(); deps.hidePanel(); deps.hideCountdown(); }
      commentary = null;
      deps.stopClips();
      endEvent();
    },

    finish(r) {
      const rows: ResultRow[] = r.results();
      const { me, place } = riderResult(rows, r.time);
      const stage = r.stage;
      let tour = deps.tour.get();
      const tourN = tourStageNumber(stage.id);
      const actions: SummaryAction[] = [{ label: 'Keep riding', onClick: () => {} }];
      if (tour && tourN) {
        deps.tour.record(stage.id, rows);
        tour = deps.tour.get();
        const worn = myJerseys(tour);
        if (worn.length) deps.toastLater(tourLeadMessage(worn), 1200, 6000);
        const next = nextTourStage(tourN, tour);
        if (next) actions.push({ label: `Next: stage ${tourN + 1}`, primary: true, onClick: () => deps.beginRace(stageById(next), tourN + 1) });
        else actions.push({ label: 'Tour standings', primary: true, onClick: deps.openTour });
      } else {
        actions.push({ label: 'Race again', primary: true, onClick: () => deps.beginRace(stage, tourN) });
      }
      return { rows, me, place, tour: tour && tourN ? tour : null, actions };
    },

    announceFinish(place) { commentary?.finished(place); },

    endRace(distance) {
      race = null; // the race is over: the teams go back to riding the road
      deps.peloton.endRace(distance);
      deps.hidePanel();
      endEvent(); // the lobby and presence go back to the normal road
    },

    updateEvent,

    updateCommentary(panel) {
      const commentator = deps.commentator();
      if (!commentator) return;
      commentator.enabled = deps.commentaryWanted();
      if (!race || !commentary) return;
      if (lobbyDue(race)) commentary.lobby();
      if (!panel) { commentator.tick(); return; }
      commentary.update(raceSnapshot(race, panel, deps.rider()));
    },
  };
}
