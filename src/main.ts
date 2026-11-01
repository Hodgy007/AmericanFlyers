import './style.css';
import { initMonitoring, setMonitoringContext, setMonitoringUser, startMonitoring } from './monitoring';

initMonitoring(); // first, so it catches errors while the app starts
import { bluetoothAvailable, type Trainer, type TrainerReading } from './ble/trainer';
import { initDevices } from './devicesUi';
import { RideQueue } from './rideQueue'; // rides saved on this device while offline // ☰ Menu trainer and heart rate entries, remembered devices
import { currentStage, elevationAt, gradeAt, headingAt, setStage } from './course';
import type { Stage } from './stages';
import { addRoute, allStages, deleteRoute, stageById } from './routes/library';
import { stepSpeed, DEFAULT_PARAMS } from './physics';
import { drawProfile } from './profile';
import { World, type CameraMode } from './world/world';
import { loadSettings, saveSettings, type Settings } from './settings';
import { formatTime, Hud, openDataBlocks } from './hud';
import { RideStats } from './stats';
import { Drivetrain, gearCadence, gearGradeOffset, VIRTUAL_GEARS, VIRTUAL_REF } from './drivetrain';
import { drawWorkout } from './workouts/graph';
import { RAMP_TEST_ID, zoneColor, type Workout } from './workouts/model';
import { WorkoutPlayer } from './workouts/player';
import { HR_ZONES, POWER_ZONES, zoneBars } from './zones';
import { account, onAccountChange, restoreSession } from './cloud/account';
import { forgetLocalCopies, onSyncError, pushSettings, recordFtp, saveActivity, stageGhost, stageLeaderboard, syncOnSignIn, type Activity, type LeaderboardRow } from './cloud/sync';
import { RideRecorder } from './cloud/recorder';
import { initAccountUi } from './cloud/accountBar';
import { lazy, loadOnClick, markFirstFrame, onLazyError, prefetchWhenIdle, use } from './lazy';
import { emailAuth, initHome } from './home';
import { initPrivacyUi, prefetchPrivacy } from './privacyUi';
// The hub: the screen before you ride (src/hub). Sections load on demand; this is the small part.
import { initHub } from './hub/hub';
import { askToLeave } from './hub/leave';
import { leaderboardEligible, leaderboardNote, type RideFlags } from './rideIntegrity';
import { Presence } from './cloud/presence';
import { initRidersUi } from './ridersUi';
import { Ghost, raceTime } from './ghost';
import { Sound } from './sound';
import { Peloton } from './peloton';
import { draftFrom, DRAFT_MAX_GAP, DRAFT_SWEET_SPOT, type Draft } from './draft';
// Wind, echelons, the mini-map and the climb preview (world/wind.ts, miniMap.ts, climbUi.ts, windUi.ts).
import { draftShift, wind } from './world/wind';
import { initWindUi } from './windUi';
import { MiniMap } from './miniMap';
import { initClimbUi } from './climbUi';
import { complete, nextSession, planById, sessions as planSessions, type Session } from './plans';
import { onboarded } from './onboardingState';
import { workoutById } from './workouts/library';
import type { OtherRider } from './world/others';
import { Steering } from './steering';
import { kitString, onLookChange, playerLook, setPlayerKit, setTourJersey } from './kit';
import { Garage, rewardText } from './garage/garage';
import { attachShare, shareRide } from './garage/shareButton';
import { levelTitle } from './garage/progression';
import { RideOns } from './cloud/rideOns';
import { initRideOnsUi } from './rideOnsUi';
// AI coach and AI rivals (src/ai/): tips, debriefs and rivals with personalities and memory.
// Loaded on demand (aiLazy and friends below), so only types are imported here.
import type { AiRide } from './ai/aiRide';
import type { AiHostBase } from './ai/create';
import type { RideSummaryInput } from './ai/summary';
// Racing and the Hell of the West tour (race.ts, raceUi.ts, tour.ts, tourUi.ts).
import { LiveRace, raceSetup, type PanelData, type ResultRow } from './race';
// Scheduled group rides and races, and the race commentator (schedule.ts, eventSession.ts, eventsUi.ts, commentary.ts, cloud/events.ts).
import type { RaceCommentary } from './commentary';
import { DropWatcher, EVENT_REF_WKG, eventOver, mergeEventResults, secondsSinceStart, type ActiveEvent, type RealResult } from './eventSession';
import { eventResults, serverNow, submitEventResult, syncServerClock, type EventRow } from './cloud/events';
import { countdownLabel, eventStageKey, joinState } from './schedule';
import { JERSEY_NAMES, TOUR_STAGE_IDS, getTour, loadTour, myJerseys, onTourChange, priorTotals, recordStage, refWkg, simulateStage, tourComplete, tourJersey, tourStageNumber } from './tour';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STALE_MS = 3000; // treat trainer as idle if no data for this long
const KM_PER_MI = 1.609344;

let settings = loadSettings();

// ---------------------------------------------------------------- state ----

let trainer: Trainer | null = null;
let demo = false;
let demoPower = 150;

const live = { power: 0, cadence: 0, heartRate: 0, trainerHr: 0, lastReadingAt: 0, lastHrAt: 0 };
const ride = { distance: 0, startDistance: 0, speed: 0, movingTime: 0, climbed: 0, lastElev: 0, work: 0, finished: false, finishTime: 0, planCounted: false, proM: 0, racePlace: 0, raceSize: 0 };
const drivetrain = new Drivetrain(); // keeps the legs in step with the wheels
const powerSamples: { t: number; p: number }[] = [];
const zoneRefs = () => settings;
let stats = new RideStats(zoneRefs); // whole ride
let player: WorkoutPlayer | null = null;
let workoutStats = new RideStats(zoneRefs); // just the current workout
let recorder = new RideRecorder(); // second-by-second samples for the saved ride
const sound = new Sound(settings.sound);
const beeps = { step: undefined as unknown, left: Infinity };
const peloton = new Peloton(); // computer-ridden pro teams
let race: LiveRace | null = null; // the race being ridden, if any
onLazyError((msg) => toast(msg, 5000));
// Racing screens (the 3-2-1, live panel and result tables) and the commentator are only
// needed once a race starts, so they load then (and in a spare moment after the first frame).
const raceUiModule = lazy(() => import('./raceUi').then((m) => ({ m, ui: m.initRaceUi() })));
const raceUi = {
  /** The 3-2-1 text, or null to hide it. Nothing to hide until the screens have loaded. */
  countdown(text: string | null) { const r = raceUiModule.peek(); if (r) r.ui.countdown(text); else if (text) raceUiModule.prefetch(); },
  panel(d: PanelData | null, imperial: boolean) { const r = raceUiModule.peek(); if (r) r.ui.panel(d, imperial); else if (d) raceUiModule.prefetch(); },
};
// The race commentator: voice lines for race events, quieter ride sounds while it speaks.
const commentary = lazy(() => import('./commentary').then((m) => {
  const clipPlayer = new m.ClipPlayer();
  clipPlayer.onDuck = (on) => sound.duck(on);
  const commentator = new m.Commentator(clipPlayer, () => performance.now() / 1000);
  return { m, clipPlayer, commentator };
}));
let raceCommentary: RaceCommentary | null = null;
let clipsPreloaded = false;
/** The scheduled event you have joined (a race or a group ride), if any. */
let eventState: { ev: ActiveEvent; drop: DropWatcher; demoUsed: boolean } | null = null;
let draft: Draft | null = null; // the rider just ahead, if any
let lastCrossShift = 0; // crosswind echelon: metres right of a rider's line the shelter sits
let draftSaving = 0; // fraction of air drag saved, eased
let roadRiders: OtherRider[] = []; // live riders and pro teams on the road now (for ride-ons)
const rideWorkout = { started: null as string | null, completed: null as string | null };
// The AI coach and rival for this ride (src/ai/aiRide.ts). Not in the entry chunk: `ai` stays null
// until the controller has loaded (a rider who opted in, a rival chosen, the Rivals dialog or the
// AI switches opened), and every hook below is `ai?.…`, so until then they do nothing.
let ai: AiRide | null = null;
const aiLazy = lazy(() => import('./ai/create').then((m) => (ai = m.createAi(aiHost()))));
const aiApiLazy = lazy(() => import('./cloud/aiApi')); // the small API client: consent, rival records
const rivalsUi = lazy(() => import('./ai/rivalsUi').then((m) => m.initRivalsUi(rivalsDeps())));
const aiConsentUi = lazy(() => import('./ai/consentUi')); // the sign-in prompt and switches in Settings
/** Loads the AI in the background for a rider who has opted in (called when a ride starts). */
function ensureAi() {
  if (settings.aiCoach || settings.aiRivals) aiLazy.prefetch();
}

// ------------------------------------------------------------- devices ----

function onReading(r: TrainerReading) {
  const now = performance.now();
  if (r.power !== undefined) live.power = Math.max(0, r.power);
  if (r.cadence !== undefined) live.cadence = r.cadence;
  if (r.heartRate) { live.trainerHr = r.heartRate; live.lastHrAt = now; }
  live.lastReadingAt = now;
}

// Connecting, remembering and reconnecting the trainer and heart-rate strap live in devicesUi.ts
// (and ble/remembered.ts). main.ts only hears about changes and keeps the ride state in step.
const devices = initDevices({
  toast: (m, ms) => toast(m, ms),
  setStatus: (text, state) => setStatus(text, state),
  onReading,
  onHeartRate: (bpm) => { live.heartRate = bpm; live.lastHrAt = performance.now(); },
  trainerChanged: (t) => {
    trainer = t;
    lastSentGrade = NaN; // a (re)connected trainer is sent the grade (or ERG watts) again at the next tick
    lastSentWatts = NaN;
    if (t && demo) setDemo(false);
    if (!t) { live.power = 0; live.cadence = 0; } // the ride carries on; power falls to zero until it is back
  },
  hrChanged: (h) => { if (!h) live.heartRate = 0; },
});

/** Wind into your face (head, m/s; negative is a tail wind) and across the road (cross, towards your right) at a distance on this stage. */
function roadWind(distance: number) {
  return wind.at(headingAt(distance));
}

// Control the trainer once a second: ERG (hold the workout's target watts)
// during a workout, otherwise the road grade scaled by the difficulty setting.
// With virtual shifting on, the chosen gear adds to (or takes off) the grade.
let lastSentGrade = NaN;
let lastSentWatts = NaN;
let lastSentWind = 1;
let lastSentHeadwind = 0;
function controlTrainer() {
  if (!trainer?.canControl) return;
  const watts = player && !player.done ? player.targetWatts() : null;
  if (watts !== null) {
    if (Math.abs(watts - lastSentWatts) < 1) return;
    lastSentWatts = watts;
    lastSentGrade = NaN; // resend the grade when ERG ends
    trainer.setTargetPower(watts).catch(() => { lastSentWatts = NaN; });
    return;
  }
  const road = gradeAt(ride.distance) * 100 * (settings.difficulty / 100);
  const gear = settings.virtualShifting ? gearGradeOffset(vGear) : 0;
  const target = Math.round(Math.max(-10, Math.min(20, road + gear)) * 10) / 10;
  // In someone's draft the trainer's wind resistance drops too, so it feels easier;
  // aero kit from the garage (frame, wheels, helmet, suit) trims it a little as well.
  const dragFactor = Math.round((1 - draftSaving) * garage.effects().cdaFactor * 50) / 50;
  // The road's wind goes to the trainer's simulation too (headwind positive), in half-metre steps.
  const headwind = Math.round(roadWind(ride.distance).head * 2) / 2;
  if (Math.abs(target - lastSentGrade) < 0.1 && dragFactor === lastSentWind && headwind === lastSentHeadwind) return;
  lastSentGrade = target;
  lastSentWind = dragFactor;
  lastSentHeadwind = headwind;
  lastSentWatts = NaN;
  trainer.setGrade(target, dragFactor, headwind).catch(() => { lastSentGrade = NaN; });
}
setInterval(controlTrainer, 1000);

// ------------------------------------------------------ virtual shifting ----

let vGear = VIRTUAL_REF;

function shift(by: number) {
  if (!settings.virtualShifting) return;
  const next = Math.max(0, Math.min(VIRTUAL_GEARS.length - 1, vGear + by));
  if (next === vGear) return;
  vGear = next;
  drivetrain.virtualGear = vGear;
  sound.shift(by > 0);
  updateGearPanel();
  controlTrainer(); // feel it straight away
}

function updateGearPanel() {
  const on = settings.virtualShifting;
  $('gear-panel').hidden = !on;
  drivetrain.virtualGear = on ? vGear : null;
  if (!on) return;
  $('gear-num').textContent = String(vGear + 1);
  const pct = vGear / (VIRTUAL_GEARS.length - 1);
  $('gear-bar').style.setProperty('--gear', String(pct));
  $('gear-ratio').textContent = `${VIRTUAL_GEARS[vGear].toFixed(2)} : 1`;
}

// ----------------------------------------------------------------- demo ----

function setDemo(on: boolean) {
  demo = on;
  $('demo-panel').hidden = !on;
  $('btn-demo').classList.toggle('active', on);
  $('btn-demo').textContent = on ? '🎮 Stop demo' : '🎮 Demo ride';
  if (on) setStatus('Demo ride · power from the slider', 'on');
  else if (!trainer) setStatus('No trainer connected', 'off');
}

// Demo rides: click or tap the profile strip at the bottom to jump along the
// route. Not in races or scheduled events (that would be cheating) or workouts (the strip shows the
// workout then). The jump doesn't count as distance or climbing, and moves the
// start too, so the ride never earns a full-stage time on the leaderboard.

/** The stretch of road the profile strip shows: the whole stage, or a 5 km window on endless ones. */
function profileSpan(): [number, number] {
  const finish = currentStage().finish;
  if (finish !== null) return [0, finish + 200];
  const from = Math.max(0, ride.distance - 500);
  return [from, from + 5000];
}

function canJump() {
  return demo && !player && !race && !eventState;
}

function profileDistanceAt(clientX: number) {
  const r = profileCanvas.getBoundingClientRect();
  const [from, to] = profileSpan();
  const d = from + ((to - from) * (clientX - r.left)) / Math.max(1, r.width);
  const finish = currentStage().finish;
  return Math.max(0, finish === null ? d : Math.min(d, finish - 25));
}

function jumpTo(d: number) {
  if (ride.finished) { const speed = ride.speed; resetRide(); ride.speed = speed; } // finished: start a fresh demo ride from there
  ride.startDistance += d - ride.distance;
  ride.distance = d;
  ride.lastElev = elevationAt(d);
  world.jumped();
  const imperial = settings.units === 'imperial';
  toast(`Jumped to ${(d / 1000 / (imperial ? KM_PER_MI : 1)).toFixed(1)} ${imperial ? 'mi' : 'km'}`, 1500);
}

function setDemoPower(p: number) {
  demoPower = Math.max(0, Math.min(600, p));
  $<HTMLInputElement>('demo-power').value = String(demoPower);
  $('demo-power-value').textContent = `${demoPower} W`;
}

// ------------------------------------------------------------ main loop ----

function markerConfig() {
  const imperial = settings.units === 'imperial';
  const every = imperial ? KM_PER_MI * 1000 : 1000;
  const finish = currentStage().finish;
  return {
    every,
    label: (n: number) => {
      if (finish === null) return imperial ? `${n} mi` : `${n} km`;
      // On a stage with a finish line, count down instead.
      const left = Math.round((finish - n * every) / every);
      if (left <= 0) return null;
      return `${left} ${imperial ? 'mi' : 'km'} to go`;
    },
  };
}

// `?stage=alpe-dhuez` picks the stage; the stage picker updates it.
setStage(stageById(new URLSearchParams(location.search).get('stage')));
const world = new World($<HTMLCanvasElement>('scene'), markerConfig());
world.setAtmosphere(settings.timeOfDay, settings.weather);
// Wind, and the mini-map and climb preview.
let windStage: Stage | null = null;
const windUi = initWindUi($('wind-chip'), $('wind-arrow'), $('wind-text'));
const miniMap = new MiniMap($('minimap'), $<HTMLCanvasElement>('minimap-canvas'));
const climbUi = initClimbUi({ card: $('climb-card'), title: $('cc-title'), sub: $('cc-sub'), canvas: $<HTMLCanvasElement>('cc-profile') });
const steering = new Steering(); // where you ride across the road
// Your kit (src/kit.ts): the world's rider follows it, including any tour jersey laid over it.
onLookChange((look) => world.setPlayerLook(look));
setPlayerKit(settings.kit);
// The garage (src/garage): what you ride and wear, your level and credits. Its loadout is saved with the settings.
const garage = new Garage({
  saved: () => settings.loadout,
  save: (l) => {
    settings = { ...settings, loadout: l };
    saveSettings(settings);
    pushSettings(settings);
  },
  toast: (m, ms) => toast(m, ms),
});
const profileCanvas = $<HTMLCanvasElement>('profile');
// `?start=12` begins the ride 12 km in, handy for jumping to the hills.
const startKm = Number(new URLSearchParams(location.search).get('start'));
if (startKm > 0) {
  ride.distance = ride.startDistance = startKm * 1000;
  ride.lastElev = elevationAt(ride.distance);
}

// `?timescale=8` runs the clock 8× faster (up to 20×), for testing whole races in a minute.
const TIME_SCALE = Math.min(20, Math.max(1, Number(new URLSearchParams(location.search).get('timescale')) || 1));
// Trust and safety: demo-slider rides and ?timescale rides never get a leaderboard time (src/rideIntegrity.ts).
const rideFlags: RideFlags = { usedDemo: false, timeScale: TIME_SCALE };
let lastFrame = performance.now();
let lastHud = 0;

const lateralOf = (id: string) => world.lateralOf(id);

// `?wind=8,90` forces the wind: speed in m/s, then the degrees it blows towards, turning right from the way the stage starts (90 = from the left). For testing.
const urlWind = (() => {
  const raw = new URLSearchParams(location.search).get('wind');
  if (!raw) return undefined;
  const [ms, angle] = raw.split(',').map(Number);
  return Number.isFinite(ms) ? { ms, angle: Number.isFinite(angle) ? angle : 90 } : undefined;
})();

// ---- The hub (src/hub): while it is open nothing rides; the world just circles your rider, behind the blur. ----
let lastHubDraw = 0;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const phoneWidth = matchMedia('(max-width: 760px)');
function hubFrame(now: number) {
  lastFrame = now; // so the first ride frame after the hub doesn't see a long gap
  const every = reducedMotion.matches || phoneWidth.matches ? 1000 : 33; // slow and cheap where it can't be seen well
  if (now - lastHubDraw < every) return;
  const dt = Math.min(1, (now - lastHubDraw) / 1000);
  lastHubDraw = now;
  world.update({ distance: ride.distance, speedMs: 0, crankAngle: drivetrain.crankAngle, rock: 0 }, dt);
}

function frame(now: number) {
  if (hub.isOpen()) {
    hubFrame(now);
    noteFirstFrame(); // the hub is usually the first screen: sign-in and prefetching hang off its first frame too
    requestAnimationFrame(frame);
    return;
  }
  // rAF timestamps can precede the load-time clock reading, so clamp at 0.
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)) * TIME_SCALE;
  lastFrame = now;

  if (demo) {
    // In a workout the demo rider follows the target, with a little wobble.
    const target = player && !player.done && !player.paused ? player.targetWatts() : null;
    if (target !== null) setDemoPower(Math.round(target + Math.sin(now / 900) * 4));
    live.power = demoPower;
    if (demoPower > 0) rideFlags.usedDemo = true;
    live.cadence = demoPower <= 0 ? 0
      : settings.virtualShifting && ride.speed > 2 ? Math.round(Math.min(140, gearCadence(ride.speed, vGear)))
      : Math.round(78 + demoPower / 25 + Math.sin(now / 1700) * 3);
    live.lastReadingAt = now;
  } else if (now - live.lastReadingAt > STALE_MS) {
    live.power = 0;
    live.cadence = 0;
  }

  // The wind: follows the stage and the weather being shown.
  if (windStage !== currentStage()) {
    windStage = currentStage();
    wind.setStage(urlWind ? { id: windStage.id, wind: urlWind } : windStage, headingAt(0));
  }
  wind.enabled = settings.wind;
  wind.setWeather(world.weather);
  wind.update(dt);
  const crossShift = draftShift(roadWind(ride.distance).cross); // the sheltered spot sits this far to the right of a rider's line
  lastCrossShift = crossShift;

  // Other riders on the road, and the draft from the one just ahead.
  const liveRiders: OtherRider[] = settings.rideTogether ? presence.riders() : [];
  if (race) race.update(dt, ride.distance, ride.speed); // the field races with you
  if (settings.proTeams || race || eventState) {
    peloton.update(dt);
    liveRiders.push(...peloton.riders());
  }
  // ---- AI coach and rival (src/ai/): tips as you ride, and a rival on the road ----
  if (ai) {
    const ahead = liveRiders.reduce((m, r) => (r.distance > ride.distance && r.distance - ride.distance < m ? r.distance - ride.distance : m), Infinity);
    const target = player && !player.done && !player.paused ? player.targetWatts() : null;
    const rival = ai.frame({
      dt, movingTime: ride.movingTime, distance: ride.distance, watts: live.power, cadence: live.cadence, hr: currentHr(),
      gradePct: gradeAt(ride.distance) * 100, finish: currentStage().finish, finishS: ride.finishTime, finished: ride.finished,
      targetW: target, workoutS: player ? player.elapsed : null, gapAheadM: Number.isFinite(ahead) ? ahead : null,
      drafting: !!draft && draft.saving > 0.01, riding: !ride.finished && !race?.holding && !eventHolding(),
    });
    if (rival) liveRiders.push(rival);
  }
  // ---- end of AI ----
  roadRiders = liveRiders;
  steering.update(dt, { autoSteer: settings.autoSteer, distance: ride.distance, riders: liveRiders, lateralOf: lateralOf, shift: crossShift });
  world.setLane(steering.target);
  draft = draftFrom(ride.distance, liveRiders, 60, { lane: world.currentLane, lateralOf, shift: crossShift });
  draftSaving += ((draft?.saving ?? 0) - draftSaving) * (1 - Math.exp(-dt / 0.6));

  const grade = gradeAt(ride.distance);
  // ---- Garage equipment (src/garage): frame, wheels, tyres, helmet and suit change mass, drag area and rolling resistance. ----
  const equipment = garage.effects();
  ride.speed = stepSpeed(ride.speed, live.power, grade, dt, {
    ...DEFAULT_PARAMS,
    massKg: settings.riderKg + settings.bikeKg + equipment.massKg,
    cda: DEFAULT_PARAMS.cda * equipment.cdaFactor * (1 - draftSaving),
    crr: DEFAULT_PARAMS.crr + equipment.crrDelta,
  }, roadWind(ride.distance).head); // air speed = road speed + headwind
  // ---- end of garage equipment ----
  // Distance ridden within 30 m of a pro team (a weekly challenge).
  if (!ride.finished && ride.speed > 0.3 && liveRiders.some((r) => r.team && Math.abs(r.distance - ride.distance) < 30)) ride.proM += ride.speed * dt;
  if (race?.holding || eventHolding()) ride.speed = 0; // waiting on the line for the start
  if (eventState && demo) eventState.demoUsed = true; // demo riding keeps you off the event results
  ride.distance += ride.speed * dt;
  if (ride.speed > 0.3 && !ride.finished) {
    ride.movingTime += dt;
    ride.work += live.power * dt;
  }
  const finish = currentStage().finish;
  if (finish !== null && !ride.finished && ride.distance >= finish) showFinish();
  const elev = elevationAt(ride.distance);
  if (elev > ride.lastElev && !ride.finished) ride.climbed += elev - ride.lastElev;
  ride.lastElev = elev;
  drivetrain.update(dt, ride.speed, live.cadence, live.power);

  powerSamples.push({ t: now, p: live.power });
  while (powerSamples.length && now - powerSamples[0].t > 3000) powerSamples.shift();

  const moving = ride.speed > 0.3 || live.power > 0;
  stats.add(dt, live.power, live.cadence, currentHr(), moving);
  recorder.tick(dt, moving, {
    power: live.power, cadence: live.cadence, hr: currentHr(), speedMs: ride.speed,
    distance: ride.distance - ride.startDistance,
    elevation: (currentStage().baseAltitude ?? 0) + elev,
  });
  if (player) {
    const pedalling = live.power > 0 || live.cadence > 0;
    if (!player.done) {
      player.tick(dt, pedalling, live.power);
      if (pedalling && !player.paused) workoutStats.add(dt, live.power, live.cadence, currentHr(), true);
    }
    if (player.done) finishWorkout(); // reached the end, or skipped past the last step
    else if (!player.paused) intervalBeeps();
  }
  sound.setRain(world.rainLevel);
  sound.update(dt, { speedMs: ride.speed, pedalling: live.power > 0 || live.cadence > 0, crowd: crowdNear(ride.distance), cassetteRevs: drivetrain.crankRate * drivetrain.ratio });

  const others = liveRiders;
  const g = race ? null : ghostRider(); // no ghost in a race
  if (g) others.push(g);
  world.setOthers(others);
  world.update({ distance: ride.distance, speedMs: ride.speed, crankAngle: drivetrain.crankAngle, rock: drivetrain.rock }, dt);
  noteFirstFrame();
  if (settings.miniMap && !ride.finished) {
    miniMap.update(now, { distance: ride.distance, riders: others, lines: race ? race.course.lines.filter((l) => l.kind !== 'finish').map((l) => ({ kind: l.kind, d: l.d })) : [] });
  }

  if (now - lastHud > 200) {
    lastHud = now;
    if (currentStage().finish === null && ride.movingTime >= 30 * 60 && !ride.planCounted) {
      ride.planCounted = true; // no finish line: 30 minutes counts as done
      planDone({ stage: currentStage().id });
    }
    updateHud(grade);
    miniMap.setVisible(settings.miniMap && !ride.finished);
    windUi.update(ride.distance, settings.units === 'imperial');
    climbUi.update(ride.distance, settings.miniMap, !ride.finished && $('finish').hidden, settings.units === 'imperial'); // not over the finish card or ride summary
    placeBelowHud();
    raceUi.countdown(race?.countText ?? null);
    const panelData = race && race.phase === 'racing' && !ride.finished ? race.panel(ride.distance) : null;
    raceUi.panel(panelData, settings.units === 'imperial');
    updateCommentary(panelData);
    updateEvent();
    if (player) {
      drawWorkout(profileCanvas, player.steps, { elapsed: player.elapsed, trace: player.trace });
    } else {
      drawProfile(profileCanvas, ride.distance, profileSpan());
    }
    profileCanvas.classList.toggle('jumpable', canJump());
  }
  requestAnimationFrame(frame);
}

/** 0..1: crowds line the hairpins of the climbs and the last few hundred metres. */
function crowdNear(d: number) {
  const stage = currentStage();
  let c = 0;
  for (const sign of stage.signs) {
    const k = 1 - Math.abs(d - sign.d - 10) / 110;
    if (k > c) c = k;
  }
  c *= 0.75;
  if (stage.finish !== null) {
    const toGo = stage.finish - d;
    if (toGo < 700 && toGo > -150) c = Math.max(c, toGo > 0 ? 1 - toGo / 700 : 1 + toGo / 150);
  }
  return Math.max(0, c);
}

/** Beeps at 3, 2, 1 seconds before a workout step ends, and a long one as it changes. */
function intervalBeeps() {
  if (!player) return;
  const left = player.stepRemaining();
  if (beeps.step !== player.step) {
    if (beeps.step !== undefined) sound.beep(true);
    beeps.step = player.step;
  } else if ((player.step?.duration ?? 0) >= 20) {
    for (const n of [3, 2, 1]) if (beeps.left > n && left <= n) sound.beep();
  }
  beeps.left = left;
}

function currentHr() {
  return performance.now() - live.lastHrAt < STALE_MS ? live.heartRate || live.trainerHr : 0;
}

const hud = new Hud($('hud'));
hud.setFields(settings.dataFields);

// ------------------------------------------------------- menu & layout ----

const menu = $('menu');
const menuBtn = $('btn-menu');
function setMenu(open: boolean) {
  menu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.classList.toggle('active', open);
}
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) setMenu(false); });
$('btn-menu-hub').addEventListener('click', () => { void goToHub(); }); // ☰ Menu → 🏠 Hub
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !(e.target as HTMLElement).closest('.menu-wrap')) setMenu(false); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });

/** Numbers across the top (middle), or in a column down the left or right. */
function applyHudPosition(pos: Settings['hudPosition']) {
  document.body.classList.toggle('hud-left', pos === 'left');
  document.body.classList.toggle('hud-right', pos === 'right');
  document.querySelectorAll<HTMLButtonElement>('[data-hud-pos]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.hudPos === pos)));
  requestAnimationFrame(() => placeWorkoutPanel());
}
applyHudPosition(settings.hudPosition);
document.querySelectorAll<HTMLButtonElement>('[data-hud-pos]').forEach((b) => b.addEventListener('click', () => {
  const pos = b.dataset.hudPos as Settings['hudPosition'];
  settings = { ...settings, hudPosition: pos };
  saveSettings(settings);
  pushSettings(settings);
  applyHudPosition(pos);
}));

function updateHud(grade: number) {
  const power3s = powerSamples.reduce((a, s) => a + s.p, 0) / Math.max(1, powerSamples.length);
  const finish = currentStage().finish;
  $('stage-name').textContent = stageProgress();
  hud.update({
    settings,
    power3s,
    power1s: live.power,
    cadence: live.cadence,
    speedMs: ride.speed,
    hr: currentHr(),
    distance: ride.distance - ride.startDistance,
    toGo: finish === null ? null : finish - ride.distance,
    movingTime: ride.movingTime,
    grade,
    climbed: ride.climbed,
    elevation: (currentStage().baseAltitude ?? 0) + elevationAt(ride.distance),
    stats,
    workout: player && !player.done
      ? { target: player.targetWatts(), stepLeft: player.stepRemaining(), workoutLeft: player.duration - player.elapsed, label: player.step?.label ?? '' }
      : null,
  });
  updateWorkoutPanel();
  updateDraftPanel();
}

/**
 * The slipstream gauge: how far you are behind the rider ahead, and how much
 * the draft is saving you. Shown when someone is within 60 m ahead.
 */
function updateDraftPanel() {
  const panel = $('draft-panel');
  if (!draft || ride.finished) { panel.hidden = true; return; }
  panel.hidden = false;
  const imperial = settings.units === 'imperial';
  const gapText = imperial ? `${Math.round(draft.gap * 3.28084)} ft` : `${draft.gap < 10 ? draft.gap.toFixed(1) : Math.round(draft.gap)} m`;
  const v = ride.speed;
  const airSpeed = Math.max(0, v + roadWind(ride.distance).head);
  const watts = 0.5 * 1.225 * DEFAULT_PARAMS.cda * garage.effects().cdaFactor * airSpeed * airSpeed * v * draftSaving / 0.976;
  // Behind them but off their line: the gauge says which way to move.
  const offLine = draft.gap <= DRAFT_MAX_GAP && draft.overlap < 0.5;
  const move = draft.offset < 0 ? '◀' : '▶';
  const inDraft = draftSaving > 0.03 && !offLine;
  panel.classList.toggle('on', inDraft);
  panel.classList.toggle('sweet', draft.gap <= DRAFT_SWEET_SPOT);
  const who = draft.team ?? draft.name;
  const group = draft.riders > 1 ? ` · ${draft.riders} riders` : '';
  $('draft-title').textContent = inDraft ? `In ${who}’s draft${group}` : `${who} ahead${group}`;
  $('draft-gap').textContent = gapText;
  $('draft-hint').textContent = offLine
    ? `Move ${move} ${Math.abs(lastCrossShift) >= 0.3 ? 'to the sheltered side of their wheel (crosswind)' : 'into their wheel'}${draft.gap > DRAFT_SWEET_SPOT * 2 ? ' and close up' : ''}`
    : inDraft
    ? `−${Math.round(draftSaving * 100)}% drag${watts >= 5 ? ` · saving ~${Math.round(watts)} W` : ''}${draft.overlap < 0.9 ? ` · line up on their wheel ${move}` : draft.gap > DRAFT_SWEET_SPOT ? ` · closer than ${imperial ? '7 ft' : `${DRAFT_SWEET_SPOT} m`} for the most` : ''}`
    : `Close to ${imperial ? '40 ft' : `${DRAFT_MAX_GAP} m`} to get in the draft`;
  // The bar fills as you close in: empty at 60 m, full at the sweet spot.
  const fill = Math.max(0, Math.min(1, (60 - draft.gap) / (60 - DRAFT_SWEET_SPOT)));
  $('draft-bar').style.setProperty('--fill', String(fill));
  $('draft-bar').style.setProperty('--zone', String(1 - (DRAFT_MAX_GAP - DRAFT_SWEET_SPOT) / (60 - DRAFT_SWEET_SPOT)));
}

// ------------------------------------------------------------- workouts ----

/** Keeps the workout panel just below the data blocks, however many rows they take. */
function placeWorkoutPanel() {
  if (window.innerWidth <= 560) return; // docked at the bottom on phones (CSS)
  // With the numbers in a side column, the panel sits on the other side, just under the top bar.
  const side = settings.hudPosition !== 'center';
  const above = side ? document.querySelector('.topbar')! : document.querySelector('.hud-wrap')!;
  $('workout-panel').style.top = `${Math.round(above.getBoundingClientRect().bottom + 10)}px`;
}
window.addEventListener('resize', placeWorkoutPanel);

/** Tells the CSS where the free space under the data blocks starts (the climb card, and the mini-map on phones). */
function placeBelowHud() {
  const side = settings.hudPosition !== 'center' && window.innerWidth > 560;
  const above = side ? document.querySelector('.topbar')! : document.querySelector('.hud-wrap')!;
  document.documentElement.style.setProperty('--below-hud', `${Math.round(above.getBoundingClientRect().bottom + 8)}px`);
}

/** Keeps the data blocks just below the top bar, however many rows its buttons take. */
const topbar = document.querySelector<HTMLElement>('.topbar')!;
new ResizeObserver(() => {
  (document.querySelector('.hud-wrap') as HTMLElement).style.top = `${Math.round(topbar.getBoundingClientRect().bottom + 2)}px`;
  placeWorkoutPanel();
}).observe(topbar);

function startWorkout(w: Workout) {
  player = new WorkoutPlayer(w, settings.ftp);
  ai?.workoutStarted();
  beeps.step = undefined;
  workoutStats = new RideStats(zoneRefs);
  rideWorkout.started = w.name;
  lastSentWatts = NaN;
  $('workout-panel').hidden = false;
  placeWorkoutPanel();
  $('wp-name').textContent = w.name;
  $('finish').hidden = true;
  const erg = trainer?.canControl;
  $('wp-mode').textContent = erg
    ? 'ERG mode: your trainer holds the target power.'
    : trainer ? 'This trainer can’t take power targets; ride to the numbers.'
    : demo ? 'Demo ride: power follows the target.' : 'Connect your trainer for ERG mode, or start a demo ride.';
  toast(`Workout: ${w.name}. The clock runs while you pedal.`, 4500);
}

function stopWorkout() {
  player = null;
  beeps.step = undefined;
  $('workout-panel').hidden = true;
  lastSentGrade = NaN; // back to road resistance
}

function updateWorkoutPanel() {
  if (!player) return;
  const step = player.step;
  const target = player.targetWatts();
  $('wp-step').textContent = player.paused ? 'Paused' : step?.label ?? '';
  $('wp-target').textContent = target === null ? 'Free' : String(target);
  $('wp-target').parentElement!.style.setProperty('--accent', target === null ? '' : zoneColor(target / settings.ftp));
  $('wp-left').textContent = formatTime(player.stepRemaining());
  const next = player.next;
  $('wp-next').textContent = next
    ? `Next: ${formatTime(next.duration)} ${next.free ? 'free ride' : `@ ${player.stepWatts(next)} W`} · ${formatTime(player.duration - player.elapsed)} left`
    : `Last step · ${formatTime(player.duration - player.elapsed)} left`;
  $('wp-intensity').textContent = `${Math.round(player.intensity * 100)}%`;
  $('wp-pause').textContent = player.paused ? '▶' : '⏸';
}

function finishWorkout() {
  if (!player) return;
  const w = player.workout;
  const items: [string, string][] = [
    ['Time', formatTime(workoutStats.seconds)],
    ['Avg power', `${Math.round(workoutStats.avgPower)} W`],
    ['Norm. power', `${Math.round(workoutStats.np)} W`],
    ['TSS', String(Math.round(workoutStats.tss(settings.ftp)))],
    ['Energy', `${Math.round(workoutStats.work / 1000)} kJ`],
    ['Avg HR', workoutStats.avgHr ? `${Math.round(workoutStats.avgHr)} bpm` : '--'],
  ];
  const actions: SummaryAction[] = [{ label: 'Done', onClick: () => {} }];
  if (w.id === RAMP_TEST_ID && workoutStats.best60 > 0) {
    // Ramp test: FTP ≈ 75 % of the best one-minute power.
    const ftp = Math.round(workoutStats.best60 * 0.75);
    items.unshift(['Est. FTP', `${ftp} W`], ['Best minute', `${Math.round(workoutStats.best60)} W`]);
    actions.unshift({
      label: `Set my FTP to ${ftp} W`,
      primary: true,
      onClick: () => { setFtp(ftp, 'ramp_test'); toast(`FTP set to ${ftp} W`); },
    });
  }
  rideWorkout.completed = w.name;
  planDone({ workout: w.id });
  const zones = zoneSummary(workoutStats);
  const coach = aiDebrief(aiDebriefInput(workoutStats, w.name, 'workout', null)); // the AI coach's debrief card
  stopWorkout();
  showSummary('💪', `${w.name}: complete!`, items, actions, [...(coach ? [coach.node] : []), ...zones]);
  const rideId = recorder.id;
  saveRide().then((saved) => coach?.rideSaved(saved ? rideId : null));
}

interface SummaryAction { label: string; primary?: boolean; onClick: () => void }

function showSummary(flag: string, title: string, items: [string, string][], actions: SummaryAction[], extra: Node[] = []) {
  $('finish').querySelector('.finish-card')!.classList.toggle('wide', extra.length > 0);
  $('finish-extra').replaceChildren(...extra);
  $('finish-note').textContent = '';
  $('finish').querySelector('.finish-flag')!.textContent = flag;
  $('finish-title').textContent = title;
  const statsEl = $('finish-stats');
  statsEl.replaceChildren(...items.map(([k, v]) => {
    const d = document.createElement('div');
    d.innerHTML = '<span></span><strong></strong>';
    d.querySelector('span')!.textContent = k;
    d.querySelector('strong')!.textContent = v;
    return d;
  }));
  $('finish-actions').replaceChildren(...actions.map((a) => {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (a.primary) b.className = 'primary';
    b.addEventListener('click', () => { $('finish').hidden = true; a.onClick(); });
    return b;
  }), backToHubButton());
  $('finish').hidden = false;
}

/** The summary card's "Back to the hub" (the ride is over, so no questions asked). */
function backToHubButton() {
  const b = document.createElement('button');
  b.textContent = '🏠 Back to the hub';
  b.addEventListener('click', () => { $('finish').hidden = true; void goToHub({ ask: false }); });
  return b;
}

/** Heart-rate and power zone breakdowns for a ride summary. */
function zoneSummary(st: RideStats) {
  return [
    zoneBars('Heart-rate zones', HR_ZONES, st.hrZones, { ref: settings.maxHr, unit: 'bpm' }),
    zoneBars('Power zones', POWER_ZONES, st.powerZones, { ref: settings.ftp, unit: 'W' }),
  ];
}

function setFtp(ftp: number, source: 'manual' | 'ramp_test') {
  if (ftp === settings.ftp && source === 'manual') return;
  settings = { ...settings, ftp };
  saveSettings(settings);
  pushSettings(settings);
  recordFtp(ftp, source).catch((e) => toast(`Couldn’t save your FTP history: ${(e as Error).message}`));
}

// ------------------------------------------------------- saving rides ----

const MIN_RIDE_S = 60; // shorter rides aren't saved
const OLD_PENDING_KEY = 'americanflyers.pendingRide'; // a ride kept for sign-in by the guest flow this app used to have (see savePendingRide)

function buildActivity(): Activity {
  const st = currentStage();
  const round = (v: number) => (v > 0 ? Math.round(v) : null);
  const zones = (z: number[]) => (z.some((v) => v > 0) ? z.map((v) => Math.round(v)) : null);
  const best = Object.fromEntries(Object.entries(stats.best).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]));
  return {
    id: recorder.id,
    started_at: (recorder.startedAt ?? new Date()).toISOString(),
    title: rideWorkout.started ? `${rideWorkout.started} · ${st.name}` : st.name,
    stage_id: st.id,
    stage_name: st.name,
    finished: ride.finished,
    workout_name: rideWorkout.completed,
    duration_s: Math.round(stats.seconds),
    distance_m: Math.round(ride.distance - ride.startDistance),
    climbed_m: Math.round(ride.climbed),
    avg_power: round(stats.avgPower),
    np: round(stats.np),
    max_power: round(stats.maxPower),
    avg_hr: round(stats.avgHr),
    max_hr: round(stats.maxHr),
    avg_cadence: round(stats.avgCadence),
    kj: round(stats.work / 1000),
    tss: stats.seconds ? Math.round(stats.tss(settings.ftp) * 10) / 10 : null,
    ftp: settings.ftp,
    best_power: Object.keys(best).length ? best : null,
    hr_zones: zones(stats.hrZones),
    power_zones: zones(stats.powerZones),
    max_hr_setting: settings.maxHr,
    finish_s: ride.finished && ride.finishTime > 0 && leaderboardEligible(rideFlags) ? Math.round(ride.finishTime) : null,
    demo: !leaderboardEligible(rideFlags), // the database also ignores these rides for leaderboards
    race_place: ride.racePlace > 0 ? ride.racePlace : null, // weekly challenges: race wins and podiums
    race_size: ride.raceSize > 0 ? ride.raceSize : null,
    pro_m: ride.proM > 0 ? Math.round(ride.proM) : null, // metres ridden with a pro team
    samples: recorder.samples,
  };
}

let lastSavedSeconds = 0;

/**
 * Saves the current ride to the rider's account (the same ride is updated
 * on later saves). Updates the note on the summary card if it's showing.
 */
async function saveRide(opts: { quiet?: boolean } = {}): Promise<boolean> {
  const note = $('finish-note');
  const showNote = !opts.quiet && !$('finish').hidden;
  if (stats.seconds < MIN_RIDE_S) return false;
  if (!account()) return false; // an account is required to ride, so this is only a ride that outlived its session
  if (showNote) note.textContent = 'Saving to your rides…';
  try {
    await saveActivity(buildActivity());
    lastSavedSeconds = stats.seconds;
    accountUi.invalidate();
    hubNotify('ride');
    if (showNote) note.textContent = '✓ Saved to your rides';
    // Credits and levels come from the server's count of your saved rides.
    garage.afterRide().then((r) => {
      if (!r || opts.quiet) return;
      const text = rewardText(r);
      if (text && showNote) note.append(Object.assign(document.createElement('div'), { className: 'finish-reward', textContent: `🪙 ${text}` }));
      if (r.levelAfter > r.levelBefore) toast(`⭐ Level ${r.levelAfter}!`, 5000);
    }).catch(() => { /* credits are a bonus */ });
    return true;
  } catch (e) {
    // No connection (or the server didn't answer): keep it on this device and upload it later (src/rideQueue.ts).
    const me = account()?.id;
    const activity = buildActivity();
    const alreadyQueued = rideQueue.list().some((r) => r.activity.id === activity.id);
    const kept = me ? rideQueue.add(me, activity) : 'failed';
    if (kept !== 'failed') {
      lastSavedSeconds = stats.seconds; // queued: the 5-minute autosave needn't retry it (a later save replaces the copy)
      const msg = kept === 'trimmed'
        ? '📶 Couldn’t reach the server. Saved on this device (the summary; the second-by-second detail didn’t fit). It uploads when you’re back online.'
        : '📶 Couldn’t reach the server. Saved on this device: it uploads as soon as you’re back online.';
      if (showNote) note.textContent = msg;
      else if (!opts.quiet || !alreadyQueued) toast(msg, 6000); // quiet saves (back to the hub, autosave) say so once per ride
      hubNotify('ride');
    } else if (showNote) note.textContent = `Couldn’t save this ride: ${(e as Error).message}`;
    else if (!opts.quiet) toast(`Couldn’t save your ride: ${(e as Error).message}`);
    return false;
  }
}

// --------------------------------------------------- rides saved offline ----
// Rides that couldn't be saved wait on this device (src/rideQueue.ts) and upload when
// the connection comes back, when the rider signs in, when the tab is shown again, and
// every two minutes while any are waiting.
const rideQueue = new RideQueue(
  (() => { try { return localStorage; } catch { return null; } })(),
  saveActivity,
  () => navigator.onLine !== false,
);

async function uploadQueuedRides() {
  const me = account()?.id;
  if (!me || !rideQueue.count(me)) return;
  const r = await rideQueue.flush(me);
  if (r.uploaded.length) {
    accountUi.invalidate();
    hubNotify('ride');
    garage.refresh(); // credits and levels for the uploaded rides
    toast(r.uploaded.length === 1 ? `✓ Uploaded your ride “${r.uploaded[0].title}” (saved while offline).` : `✓ Uploaded ${r.uploaded.length} rides saved while offline.`, 5000);
  }
  for (const a of r.givenUp) toast(`Couldn’t upload “${a.title}” (${new Date(a.started_at).toLocaleDateString()}) after several tries, so it was removed from this device.`, 8000);
}
window.addEventListener('online', () => { void uploadQueuedRides(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void uploadQueuedRides(); });
setInterval(() => { if (navigator.onLine !== false) void uploadQueuedRides(); }, 2 * 60 * 1000);

/** The numbers the AI coach is told after a ride (the controller turns them into the payload, src/ai/summary.ts). `st` is the stats to describe: the whole ride, or just the workout. */
function aiDebriefInput(st: RideStats, title: string, mode: RideSummaryInput['mode'], race: { place: number; of: number } | null): RideSummaryInput {
  const plan = settings.plan ? planById(settings.plan.id) : undefined;
  const c = ai?.workoutCompliance();
  return {
    title, mode, durationS: st.seconds, distanceM: ride.distance - ride.startDistance, climbedM: ride.climbed,
    avgW: st.avgPower, npW: st.np, powerZoneS: st.powerZones, hrZoneS: st.hrZones, avgHr: st.avgHr, maxHr: st.maxHr, avgCadence: st.avgCadence,
    tss: st.seconds ? st.tss(settings.ftp) : 0,
    workout: mode === 'workout' && c ? { name: title, onTargetS: c.onTargetS, totalS: c.totalS } : null,
    race,
    plan: plan && settings.plan ? { name: plan.name, done: settings.plan.done.length, total: planSessions(plan).length } : null,
  };
}

// Save long rides every few minutes, so a closed tab doesn't lose them.
setInterval(() => {
  if (account() && stats.seconds >= MIN_RIDE_S && stats.seconds - lastSavedSeconds > 60) saveRide({ quiet: true });
}, 5 * 60 * 1000);

/**
 * One-time migration. Riders used to be able to finish a ride as a guest and keep it in
 * localStorage while they signed in; nothing writes that key any more, but a ride left
 * there by an older visit is still saved once at sign-in, then deleted, so it isn't lost.
 */
async function savePendingRide() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(OLD_PENDING_KEY); } catch { /* storage blocked */ }
  if (!raw) return;
  try {
    await saveActivity(JSON.parse(raw) as Activity);
    localStorage.removeItem(OLD_PENDING_KEY);
    accountUi.invalidate();
    toast('Your ride was saved to your profile.');
  } catch (e) {
    toast(`Couldn’t save your earlier ride: ${(e as Error).message}`);
  }
}

// The workout library and creator (and the .zwo/.erg/.mrc import) load when the dialog is first opened.
const workoutUi = lazy(() => import('./workouts/ui').then((m) => m.initWorkoutUi({ ftp: () => settings.ftp, ride: startWorkout, toast })));

// ------------------------------------------------------------------- UI ----

function setStatus(text: string, state: 'on' | 'off' | 'pending') {
  $('trainer-status').textContent = text;
  $('trainer-dot').dataset.state = state;
}

let toastTimer = 0;
function toast(msg: string, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

const CAMERA_LABELS: Record<CameraMode, string> = { chase: 'Chase view', side: 'Side view', rider: 'Rider’s view' };

function cycleCamera() {
  const mode = world.cycleCamera();
  $('btn-camera').textContent = `🎥 ${CAMERA_LABELS[mode]}`;
}

/** The Reset button: show a summary of a ride worth keeping, then start afresh. */
function endRide() {
  if (stats.seconds < MIN_RIDE_S) return resetRide();
  const imperial = settings.units === 'imperial';
  const km = (ride.distance - ride.startDistance) / 1000;
  const coach = aiDebrief(aiDebriefInput(stats, currentStage().name, player ? 'workout' : 'ride', null)); // the AI coach's debrief card
  showSummary('🚴', 'Ride summary', [
    ['Time', formatTime(stats.seconds)],
    ['Distance', imperial ? `${(km / KM_PER_MI).toFixed(2)} mi` : `${km.toFixed(2)} km`],
    ['Avg power', `${Math.round(stats.avgPower)} W`],
    ['Norm. power', `${Math.round(stats.np)} W`],
    ['Avg HR', stats.avgHr ? `${Math.round(stats.avgHr)} bpm` : '--'],
    ['Climbed', `${Math.round(imperial ? ride.climbed * 3.28084 : ride.climbed)} ${imperial ? 'ft' : 'm'}`],
  ], [
    { label: 'Keep riding', onClick: () => {} },
    { label: 'Start a new ride', primary: true, onClick: resetRide },
  ], [...(coach ? [coach.node] : []), ...zoneSummary(stats)]);
  const rideId = recorder.id;
  if (ride.movingTime >= 180) ai?.rideEnded({ distance: ride.distance, finish: null, finishS: null, movingTime: ride.movingTime, lengthKm: null }, (n) => $('finish-extra').prepend(n));
  saveRide().then((saved) => coach?.rideSaved(saved ? rideId : null));
}

function resetRide() {
  ai?.newRide();
  ensureAi();
  if (stats.seconds >= MIN_RIDE_S && stats.seconds > lastSavedSeconds) saveRide({ quiet: true });
  recorder = new RideRecorder();
  rideFlags.usedDemo = false;
  lastSavedSeconds = 0;
  rideWorkout.started = player ? player.workout.name : null;
  rideWorkout.completed = null;
  Object.assign(ride, { distance: 0, startDistance: 0, speed: 0, movingTime: 0, climbed: 0, lastElev: 0, work: 0, finished: false, finishTime: 0, planCounted: false, proM: 0, racePlace: 0, raceSize: 0 });
  if (race) { race = null; peloton.endRace(); raceUi.panel(null, false); raceUi.countdown(null); } // starting afresh ends a race
  raceCommentary = null;
  commentary.peek()?.clipPlayer.stop();
  endEvent(); // ...and leaves a scheduled event
  drivetrain.reset();
  powerSamples.length = 0;
  stats = new RideStats(zoneRefs);
  lastSentGrade = NaN;
  $('finish').hidden = true;
  world.jumped();
}

// --------------------------------------------------------------- stages ----

/** Total climbing in metres over a stage (or its first 20 km if endless). */
function stageClimbing(stage: Stage) {
  let total = 0;
  let last = stage.elevationAt(0);
  for (let d = 10; d <= (stage.finish ?? 20000); d += 10) {
    const e = stage.elevationAt(d);
    if (e > last) total += e - last;
    last = e;
  }
  return total;
}

function chooseStage(stage: Stage) {
  setStage(stage);
  setMonitoringContext({ stage: stage.id });
  const url = new URL(location.href);
  url.searchParams.set('stage', stage.id);
  url.searchParams.delete('start');
  history.replaceState(null, '', url);
  world.restage(markerConfig());
  updateTourJersey();
  resetRide();
  presence.restage();
  peloton.reset(0);
  ghost = null;
  loadMyGhost();
  $('stage-name').textContent = stage.name;
  toast(`${stage.name}: ${stage.tagline}`, 5000);
  hubNotify('stage');
}

/** Tells the hub (if it is open) that the app moved under it: a new stage, a saved ride, a plan change. */
function hubNotify(kind: 'stage' | 'ride' | 'plan') {
  document.dispatchEvent(new CustomEvent('af:hub-refresh', { detail: kind }));
}

function openStages() {
  const dialog = $<HTMLDialogElement>('stages');
  const list = $('stage-list');
  list.replaceChildren();
  const imperial = settings.units === 'imperial';
  const stages = allStages();
  // The Hell of the West tour, at the top of the list.
  const tourCard = document.createElement('button');
  tourCard.className = 'stage-card tour-card';
  tourCard.innerHTML = '<strong>🏆 Hell of the West tour</strong><span class="stage-tagline">Race the three stages of American Flyers in order against the pro teams: Morgul-Bismark, the Tour of the Moon, then Echo Lake. Yellow, green and polka-dot jerseys.</span>';
  tourCard.addEventListener('click', () => { dialog.close(); openTour(); });
  list.append(tourCard);
  for (const stage of stages) {
    if (stage.uploaded && !list.querySelector('.stage-section')) {
      const h = document.createElement('h3');
      h.className = 'stage-section';
      h.textContent = 'Your routes';
      list.append(h);
    }
    const card = document.createElement('button');
    card.className = 'stage-card' + (stage === currentStage() ? ' current' : '');
    const km = stage.finish === null ? null : stage.finish / 1000;
    const dist = km === null ? 'Endless' : imperial ? `${(km / KM_PER_MI).toFixed(1)} mi` : `${km.toFixed(1)} km`;
    const climb = Math.round(stageClimbing(stage) * (imperial ? 3.28084 : 1));
    card.innerHTML = `
      <canvas class="stage-profile"></canvas>
      <strong></strong>
      <span class="stage-meta">${dist} · ${climb.toLocaleString()} ${imperial ? 'ft' : 'm'} climbing${stage.finish === null ? ' per 20 km' : ''}</span>
      <span class="stage-tagline"></span>`;
    card.querySelector('strong')!.textContent = stage.name;
    card.querySelector('.stage-tagline')!.textContent = stage.tagline;
    card.addEventListener('click', () => {
      dialog.close();
      if (stage !== currentStage()) chooseStage(stage);
    });
    if (stage.finish !== null) {
      // A race against the pro teams, from the start line.
      const raceBtn = document.createElement('span');
      raceBtn.className = 'stage-race';
      raceBtn.setAttribute('role', 'button');
      raceBtn.title = 'Race the pro teams over this stage';
      raceBtn.textContent = '🏁 Race this stage';
      raceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dialog.close();
        beginRace(stage, tourStageNumber(stage.id));
      });
      card.append(raceBtn);
    }
    if (stage.uploaded) {
      const del = document.createElement('span');
      del.className = 'stage-delete';
      del.title = 'Delete this route';
      del.setAttribute('role', 'button');
      del.textContent = '🗑';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete the route "${stage.name}"?`)) return;
        deleteRoute(stage.id);
        if (stage === currentStage()) chooseStage(stageById(null));
        dialog.close();
        openStages();
      });
      card.append(del);
    }
    list.append(card);
  }
  if (!dialog.open) dialog.showModal();
  // Draw each card's profile now that it has a size.
  stages.forEach((stage, i) => {
    drawProfile(list.querySelectorAll('canvas')[i] as HTMLCanvasElement, null, [0, stage.finish ?? 20000], stage.elevationAt);
  });
}

// ----------------------------------------------------------------- racing ----

/** Lines the pro teams up against you on a stage: a 3-2-1 countdown, then a race to the finish. */
function beginRace(stage: Stage, tourStage: number | null = null) {
  if (stage.finish === null) return;
  if (stage !== currentStage()) chooseStage(stage);
  else resetRide();
  const tour = tourStage ? getTour() : null;
  const seed = tour ? tour.seed : Math.floor(Math.random() * 1e9);
  const { roster, course } = raceSetup(stage, seed);
  const field = peloton.startRace(course, roster, refWkg(settings.ftp, settings.riderKg), seed);
  race = new LiveRace(stage, field, priorTotals(tour, stage.id), tourStage);
  attachRace(race);
  const stageNo = tourStage ? `Stage ${tourStage} of the tour · ` : '';
  toast(`${stageNo}${stage.name.replace('Hell of the West · ', '')}: roll up to the line.`, 4000);
}

/** The rider has crossed the line: lets the field finish, saves a tour stage, and builds the buttons. */
function finishRace(r: LiveRace) {
  const rows: ResultRow[] = r.results();
  const me = rows.find((x) => x.you) ?? { id: 'me', name: 'You', team: -1, time: r.time, sprint: 0, kom: 0, you: true };
  const place = rows.findIndex((x) => x.you) + 1;
  const stage = r.stage;
  let tour = getTour();
  const tourN = tourStageNumber(stage.id);
  const actions: SummaryAction[] = [{ label: 'Keep riding', onClick: () => {} }];
  if (tour && tourN) {
    recordStage(stage.id, rows);
    tour = getTour();
    const worn = myJerseys(tour);
    if (worn.length) window.setTimeout(() => toast(`You lead the tour: ${worn.map((j) => JERSEY_NAMES[j].toLowerCase()).join(' and ')}!`, 6000), 1200);
    const next = TOUR_STAGE_IDS[tourN];
    if (next && tour && !tourComplete(tour)) actions.push({ label: `Next: stage ${tourN + 1}`, primary: true, onClick: () => beginRace(stageById(next), tourN + 1) });
    else actions.push({ label: 'Tour standings', primary: true, onClick: openTour });
  } else {
    actions.push({ label: 'Race again', primary: true, onClick: () => beginRace(stage, tourN) });
  }
  return { rows, me, place, tour: tour && tourN ? tour : null, actions };
}

const tourUi = lazy(() => import('./tourUi').then((m) => m.initTourUi({
  race: (n) => beginRace(stageById(TOUR_STAGE_IDS[n - 1]), n),
  simulate: (n) => {
    const tour = getTour();
    if (!tour) return;
    const id = TOUR_STAGE_IDS[n - 1];
    const rows = simulateStage(tour, id, settings);
    recordStage(id, rows);
    const you = rows.findIndex((x) => x.you) + 1;
    toast(`Stage ${n} simulated: you finished ${ordinal(you)} of ${rows.length}.`, 5000);
  },
  imperial: () => settings.units === 'imperial',
})));
function openTour() { use(tourUi, (u) => u.open(), $('btn-tour')); }
$('btn-tour').addEventListener('click', openTour);
// Progress is saved with the settings, so it follows the account.
loadTour(settings.tour);
onTourChange((p) => {
  settings = { ...settings, tour: p };
  saveSettings(settings);
  pushSettings(settings);
  updateTourJersey();
});

/** On a tour stage, lead a classification and you wear its jersey (yellow, green or polka dots) over your kit. */
function updateTourJersey() {
  setTourJersey((TOUR_STAGE_IDS as readonly string[]).includes(currentStage().id) ? tourJersey() : null);
}
updateTourJersey();

// ------------------------------------------------- scheduled events ----
// Group rides and races at set times (schedule.ts; the server keeps the schedule and the
// clock). Joining puts you on the start line of the event's stage, in a presence room of
// its own, with a 3-2-1 that starts at the same moment for everyone.

const eventsUi = lazy(() => import('./eventsUi').then((m) => {
  const bar = m.initEventBar(() => {
    const was = eventState?.ev;
    resetRide();
    if (was) toast(`You left ${was.title}.`);
  });
  m.initEventsUi({
    join: (row) => { joinEvent(row); },
    stageName: (id) => stageById(id).name,
    openSignIn: (why) => accountUi.openSignIn(why),
    currentEventId: () => eventState?.ev.id ?? null,
  });
  return { m, bar };
}));
loadOnClick($('btn-events'), eventsUi); // the dialog wires its own button once loaded
// The lobby strip: only ever shown while an event is joined, which the events dialog does, so it has loaded by then.
const eventBar = {
  show: (title: string, status: string) => eventsUi.peek()?.bar.show(title, status),
  hide: () => eventsUi.peek()?.bar.hide(),
};

function eventHolding() {
  return !!eventState && eventState.ev.kind === 'group_ride' && secondsSinceStart(eventState.ev, serverNow()) < 0;
}

/** Wires a new race to the beeps and the commentator (single races, tour stages and events). */
function attachRace(r: LiveRace) {
  r.onBeep = (last) => sound.beep(last);
  raceUiModule.prefetch();
  raceCommentary = null;
  // The commentator is normally loaded already (prefetched after the first frame); if not, it joins in a moment.
  use(commentary, ({ m, commentator }) => {
    if (race !== r) return; // the race ended or changed while it loaded
    commentator.reset();
    raceCommentary = new m.RaceCommentary(commentator);
    r.onEvent = (text, kind) => raceCommentary?.event(text, kind);
    if (!clipsPreloaded && settings.commentary && sound.enabled) { clipsPreloaded = true; m.ClipPlayer.preload(); }
  });
}

async function joinEvent(row: EventRow) {
  if (!account()) return; // (only reachable from the hub and the Events dialog, which need an account)
  await syncServerClock();
  const startsAtMs = new Date(row.starts_at).getTime();
  if (joinState(row.kind, startsAtMs, serverNow()) !== 'open') { toast('That event isn’t open to join right now.'); return; }
  const stage = stageById(row.stage_id);
  if (stage.id !== row.stage_id || (row.kind === 'race' && stage.finish === null)) { toast('Sorry, that event’s stage isn’t available.'); return; }
  if (stage !== currentStage()) chooseStage(stage);
  else resetRide();
  const ev: ActiveEvent = {
    id: row.id, kind: row.kind, stageId: row.stage_id, title: row.title, startsAtMs, seed: row.seed, paceWkg: row.pace_wkg, durationMin: row.duration_min,
  };
  eventState = { ev, drop: new DropWatcher(), demoUsed: false };
  const clock = () => secondsSinceStart(ev, serverNow());
  if (ev.kind === 'race') {
    const { roster, course } = raceSetup(stage, ev.seed);
    const field = peloton.startRace(course, roster, EVENT_REF_WKG, ev.seed);
    race = new LiveRace(stage, field, new Map(), null);
    race.useEventClock(clock);
    attachRace(race);
  } else {
    peloton.startGroupRide(ev.paceWkg ?? 2.6, ev.seed, clock);
  }
  presence.restage(); // only riders in this event see each other
  toast(clock() < 0 ? `You’re on the line for ${ev.title}. The start is synchronised for everyone.` : `${ev.title} is under way. Go!`, 5000);
  updateEvent();
}

/** Leaves the event (you finish, reset, or pick another stage): the road goes back to normal. */
function endEvent() {
  if (!eventState) return;
  eventState = null;
  peloton.endGroupRide(ride.distance);
  eventBar.hide();
  presence.restage();
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** About five times a second: the lobby countdown, the group ride's "you've been dropped" notes. */
function updateEvent() {
  if (!eventState) return;
  const { ev } = eventState;
  const t = secondsSinceStart(ev, serverNow());
  const others = presence.count;
  if (t < 0) {
    const where = others > 0 ? ` · ${others} other rider${others === 1 ? '' : 's'} on the line` : '';
    eventBar.show(ev.title, `${t > -3600 ? `Starts in ${mmss(-t)}` : countdownLabel(-t * 1000)}${where}`);
    return;
  }
  if (ev.kind === 'race') { eventBar.hide(); return; }
  // Group ride.
  if (eventOver(ev, serverNow())) {
    toast('The group ride is over. Thanks for riding!', 6000);
    resetRide();
    return;
  }
  const g = peloton.groupRide;
  if (!g) return;
  const gap = peloton.back(g) - ride.distance; // metres behind the back of the group
  const note = eventState.drop.update(gap, performance.now() / 1000);
  if (note === 'dropped') toast('You’ve been dropped. The group keeps its pace and won’t wait: dig in to get back on, or ride your own ride.', 6000);
  if (note === 'back') toast('Back with the group. Nice work!', 3500);
  const status = eventState.drop.isDropped
    ? `${Math.round(gap)} m off the back`
    : gap > 8 ? `${Math.round(gap)} m behind the group` : gap < -8 ? `${Math.round(-gap)} m ahead of the group` : 'with the group';
  eventBar.show(ev.title, `${status} · ${mmss(t)} in`);
}

/** The race commentator: feeds it this frame's race picture. Called with the live panel's numbers. */
function updateCommentary(panel: ReturnType<LiveRace['panel']> | null) {
  const c = commentary.peek();
  if (!c) return;
  const { commentator } = c;
  commentator.enabled = settings.commentary && sound.enabled;
  if (!race || !raceCommentary) return;
  if (race.phase === 'countdown' && race.untilGo > 5 && race.untilGo <= 30) raceCommentary.lobby();
  if (!panel) { commentator.tick(); return; }
  raceCommentary.update({
    t: panel.raceTime,
    place: panel.place,
    total: panel.total,
    myDistance: ride.distance,
    leadDistance: panel.leadPos,
    finish: race.course.finish,
    power: live.power,
    ftp: settings.ftp,
    groups: panel.groups,
    yellowIsYou: panel.jerseys.yellow === 'You',
    tour: race.tourStage !== null,
    summits: race.course.lines.filter((l) => l.kind === 'summit').map((l) => l.d),
    dt: 0.2,
  });
}

/**
 * The finish card's event table: your time, the real riders who have finished and the computer
 * field, merged by time. Sends your result (unless this was a demo ride or a sped-up clock) and
 * keeps looking for new results while the card is open.
 */
function eventFinishPanel(ev: ActiveEvent, rows: ResultRow[], myTime: number, avgPower: number, demoUsed: boolean): Node {
  const box = document.createElement('div');
  const bots = rows.map((r) => ({ name: r.name, time: r.time, team: r.team, you: r.you }));
  const draw = (real: RealResult[]) => { const m = eventsUi.peek()?.m; if (m) box.replaceChildren(m.eventResultsNode(mergeEventResults(bots, real, myTime), real.filter((r) => !r.is_me).length + 1)); };
  draw([]);
  const eligible = !demoUsed && TIME_SCALE === 1 && avgPower > 0;
  const note = document.createElement('p');
  note.className = 'muted small';
  if (!eligible) note.textContent = 'Demo rides and sped-up clocks don’t count towards the event results.';
  const refresh = async () => {
    try {
      const real = await eventResults(ev.id);
      draw(real.map((r) => ({ name: r.name, finish_s: r.finish_s, is_me: r.is_me })));
      if (!eligible) box.append(note);
    } catch { /* results are a bonus */ }
  };
  (async () => {
    if (eligible) {
      try { await submitEventResult(ev.id, myTime, avgPower); } catch (e) { note.textContent = `Couldn’t send your result: ${(e as Error).message}`; box.append(note); }
    }
    await refresh();
    // Other riders are still finishing: look again every 15 s while the card is open (up to 10 minutes).
    let n = 0;
    const timer = window.setInterval(() => {
      if ($('finish').hidden || ++n > 40) { window.clearInterval(timer); return; }
      refresh();
    }, 15000);
  })();
  return box;
}

function showFinish() {
  ride.finished = true;
  sound.fanfare();
  // Only rides of the whole stage (from the start line) count for the leaderboard.
  ride.finishTime = ride.startDistance === 0 ? ride.movingTime : 0;
  planDone({ stage: currentStage().id });
  const racing = race && race.phase !== 'countdown' ? race : null;
  const vsGhost = ghost && ride.finishTime && !racing ? ride.finishTime - ghost.finishS : null;
  const imperial = settings.units === 'imperial';
  const finish = currentStage().finish!;
  const avgPower = ride.movingTime > 0 ? Math.round(ride.work / ride.movingTime) : 0;
  const avgKmh = ride.movingTime > 0 ? ((finish - ride.startDistance) / ride.movingTime) * 3.6 : 0;
  const items: [string, string][] = [
    ['Time', formatTime(ride.movingTime)],
    ['Avg power', `${avgPower} W`],
    ['Avg speed', `${(imperial ? avgKmh / KM_PER_MI : avgKmh).toFixed(1)} ${imperial ? 'mph' : 'km/h'}`],
    ['Climbed', `${Math.round(imperial ? ride.climbed * 3.28084 : ride.climbed)} ${imperial ? 'ft' : 'm'}`],
    ['Avg HR', stats.avgHr ? `${Math.round(stats.avgHr)} bpm` : '--'],
    ['Norm. power', `${Math.round(stats.np)} W`],
  ];
  let actions: SummaryAction[] = [
    { label: 'Keep riding', onClick: () => {} },
    { label: 'Ride it again', primary: true, onClick: resetRide },
  ];
  let extra: Node[] = zoneSummary(stats);
  let title = `${currentStage().name}: finished!`;
  let shareHeadline: string | undefined;
  const shareBadges: string[] = [];
  let aiRace: { place: number; of: number } | null = null;
  if (racing) {
    racing.update(0.001, ride.distance, ride.speed); // make sure the line is recorded for this frame
    const r = finishRace(racing);
    ride.racePlace = r.place;
    ride.raceSize = r.rows.length;
    aiRace = { place: r.place, of: r.rows.length };
    shareHeadline = `${ordinal(r.place)} of ${r.rows.length}`;
    if (r.tour) shareBadges.push(...myJerseys(r.tour).map((j) => `👕 ${JERSEY_NAMES[j]}`));
    items.splice(0, 1, ['Place', `${ordinal(r.place)} of ${r.rows.length}`], ['Race time', raceTime(r.me.time)]);
    items.splice(2, 0, ['Points', `${r.me.sprint} sprint · ${r.me.kom} mountain`]);
    items.length = Math.min(items.length, 6);
    title = `${currentStage().name}: ${ordinal(r.place)}`;
    const results = raceUiModule.peek()?.m.resultsNode(r.rows, r.tour); // loaded when the race began
    if (results) extra = [results, ...extra];
    actions = r.actions;
    raceCommentary?.finished(r.place);
    if (eventState?.ev.kind === 'race') extra = [eventFinishPanel(eventState.ev, r.rows, r.me.time, avgPower, eventState.demoUsed), ...extra];
    race = null; // the race is over: the teams go back to riding the road
    peloton.endRace(ride.distance);
    raceUi.panel(null, false);
    endEvent(); // the lobby and presence go back to the normal road
  }
  const coach = aiDebrief(aiDebriefInput(stats, currentStage().name, aiRace ? 'race' : 'ride', aiRace)); // the AI coach's debrief card
  if (coach) extra = [coach.node, ...extra];
  showSummary('🏁', title, items, actions, extra);
  $('finish').querySelector('.finish-card')!.classList.toggle('race', !!racing);
  const rideId = recorder.id;
  const rideLen = currentStage().finish;
  ai?.rideEnded({ distance: ride.distance, finish: rideLen, finishS: ride.finishTime || null, movingTime: ride.movingTime, lengthKm: rideLen ? Math.round(rideLen / 100) / 10 : null }, (n) => $('finish-extra').prepend(n));
  const offBoard = leaderboardNote(rideFlags);
  if (offBoard) $('finish-extra').prepend(Object.assign(document.createElement('p'), { className: 'finish-ghost off-board', textContent: `ℹ️ ${offBoard}` }));
  // 📤 Share: a picture of the ride (route, numbers, place, your colours).
  const finishStage = currentStage();
  const finishFrom = ride.startDistance;
  const finishTo = ride.distance;
  attachShare($('finish-actions'), () => ({
    stage: finishStage, fromM: finishFrom, toM: finishTo, title: finishStage.name.replace('Hell of the West · ', ''),
    subtitle: `${racing ? 'Race · ' : ''}${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    timeS: ride.movingTime, avgPower, climbedM: ride.climbed, distanceM: finishTo - finishFrom,
    headline: shareHeadline ?? (vsGhost !== null && vsGhost < 0 && ghost?.isMe ? 'New personal best' : undefined),
    badges: shareBadges, imperial, kit: settings.kit,
    rider: garage.wallet ? `Level ${garage.wallet.level} · ${levelTitle(garage.wallet.level)}` : undefined,
  }), toast);
  if (vsGhost !== null && ghost) {
    const who = ghost.isMe ? 'your best' : `${ghost.name}’s ghost`;
    $('finish-title').textContent = vsGhost < 0 && ghost.isMe
      ? `${currentStage().name}: new personal best!`
      : $('finish-title').textContent;
    $('finish-extra').prepend(Object.assign(document.createElement('p'), {
      className: 'finish-ghost',
      textContent: vsGhost < 0 ? `🏆 ${raceTime(-vsGhost)} faster than ${who}` : `${raceTime(vsGhost)} behind ${who}`,
    }));
  }
  saveRide().then((saved) => { coach?.rideSaved(saved ? rideId : null); showRank(); });
}

/** After a whole-stage ride is saved: where it puts you on the leaderboard. */
async function showRank() {
  if (!account() || !ride.finishTime || !leaderboardEligible(rideFlags)) return;
  try {
    const rows = await stageLeaderboard(currentStage().id);
    const me = rows.find((r) => r.is_me);
    if (!me) return;
    const total = rows.length;
    toast(me.rank === 1 ? `🥇 You’re the fastest ever on ${currentStage().name}!` : `🏆 You’re ${ordinal(me.rank)} on the ${currentStage().name} leaderboard${total > 25 ? '' : ` of ${total}`}.`, 7000);
    if (settings.ghost && (!ghost || ghost.isMe)) loadMyGhost(); // race your new best next time
  } catch { /* leaderboard is a bonus */ }
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "8.4 km to go · next: Virage 14 in 230 m" for stages with a finish. */
function stageProgress() {
  const stage = currentStage();
  if (stage.finish === null) return stage.name;
  if (ride.finished) return `${stage.name} · finished`;
  const imperial = settings.units === 'imperial';
  const left = (stage.finish - ride.distance) / 1000;
  const parts = [stage.name, `${(imperial ? left / KM_PER_MI : left).toFixed(1)} ${imperial ? 'mi' : 'km'} to go`];
  if (stage.lapLength) parts.splice(1, 0, `lap ${Math.min(Math.floor(ride.distance / stage.lapLength) + 1, Math.round(stage.finish / stage.lapLength))}/${Math.round(stage.finish / stage.lapLength)}`);
  const next = stage.signs.find((s) => s.d > ride.distance);
  if (next?.style === 'hairpin') parts.push(`next: ${stage.hairpinWord ?? 'Hairpin'} ${next.label} in ${Math.round(next.d - ride.distance)} m`);
  const g = ghostRider();
  if (g && ride.movingTime > 1) {
    const gap = ride.distance - g.distance;
    const who = ghost!.isMe ? 'your best' : ghost!.name;
    parts.push(Math.abs(gap) < 3 ? `level with ${who}` : `${Math.round(Math.abs(gap))} m ${gap > 0 ? 'ahead of' : 'behind'} ${who}`);
  }
  return parts.join(' · ');
}

async function openSettings() {
  const dialog = $<HTMLDialogElement>('settings');
  const form = dialog.querySelector('form')!;
  for (const [k, v] of Object.entries(settings)) {
    const input = form.elements.namedItem(k) as HTMLInputElement | null;
    if (input?.type === 'checkbox') input.checked = v === true;
    else if (input) input.value = String(v);
  }
  $('difficulty-out').textContent = `${settings.difficulty}%`;
  // The AI switches stay off until the small consent module is here (signed-out riders can't opt in);
  // if it can't load (a toast says so) the rest of Settings still opens.
  for (const n of ['aiCoach', 'aiRivals']) (form.elements.namedItem(n) as HTMLInputElement).disabled = true;
  await use(aiConsentUi, (ui) => ui.syncAiSettingsForm(form, !!account(), () => accountUi.openSignIn('Sign in to turn on the AI coach and rivals.')), $('btn-settings'));
  if (!dialog.open) dialog.showModal();
}

$<HTMLDialogElement>('settings').addEventListener('close', () => {
  const dialog = $<HTMLDialogElement>('settings');
  if (dialog.returnValue !== 'save') return;
  const data = new FormData(dialog.querySelector('form')!);
  const num = (k: keyof Settings, fallback: number) => {
    const v = Number(data.get(k));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  const oldFtp = settings.ftp;
  const prevAi = { coach: settings.aiCoach, rivals: settings.aiRivals };
  settings = {
    ...settings,
    riderKg: num('riderKg', settings.riderKg),
    bikeKg: num('bikeKg', settings.bikeKg),
    ftp: Math.round(num('ftp', settings.ftp)),
    maxHr: Math.round(num('maxHr', settings.maxHr)),
    units: data.get('units') === 'imperial' ? 'imperial' : 'metric',
    difficulty: Math.max(0, Math.min(100, Number(data.get('difficulty')))),
    rideTogether: data.get('rideTogether') === 'on',
    proTeams: data.get('proTeams') === 'on',
    autoSteer: data.get('autoSteer') === 'on',
    ghost: data.get('ghost') === 'on',
    virtualShifting: data.get('virtualShifting') === 'on',
    wind: data.get('wind') === 'on',
    miniMap: data.get('miniMap') === 'on',
    commentary: data.get('commentary') === 'on',
    aiCoach: data.get('aiCoach') === 'on',
    aiRivals: data.get('aiRivals') === 'on',
    coachVoice: data.get('coachVoice') === 'on',
  };
  saveSettings(settings);
  pushSettings(settings);
  const nextAi = { coach: settings.aiCoach, rivals: settings.aiRivals };
  if (nextAi.coach !== prevAi.coach || nextAi.rivals !== prevAi.rivals) void use(aiLazy, (a) => a.applyConsent(nextAi, prevAi)); // the database holds the real opt-in
  if (settings.ftp !== oldFtp) recordFtp(settings.ftp, 'manual').catch((e) => toast(`Couldn’t save your FTP history: ${(e as Error).message}`));
  world.setMarkers(markerConfig());
  lastSentGrade = NaN;
  updateGearPanel();
  updateMapMenu();
  if (!settings.rideTogether) presence.leave();
  if (!settings.ghost) ghost = null;
  else if (!ghost) loadMyGhost();
  presence.restage();
});
$('settings').querySelector<HTMLInputElement>('[name=difficulty]')!.addEventListener('input', (e) => {
  $('difficulty-out').textContent = `${(e.target as HTMLInputElement).value}%`;
});

/** The ☰ Menu entry for the mini-map and climb preview mirrors the Settings switch. */
function updateMapMenu() {
  $('btn-minimap').textContent = settings.miniMap ? '🗺 Mini-map on' : '🗺 Mini-map off';
  miniMap.setVisible(settings.miniMap && !ride.finished);
  if (!settings.miniMap) climbUi.update(0, false, false, false);
}
$('btn-minimap').addEventListener('click', () => {
  settings = { ...settings, miniMap: !settings.miniMap };
  saveSettings(settings);
  pushSettings(settings);
  updateMapMenu();
});
updateMapMenu();

// (the trainer and heart rate buttons are wired in devicesUi.ts)
$('btn-demo').addEventListener('click', () => setDemo(!demo));
profileCanvas.addEventListener('click', (e) => { if (canJump()) jumpTo(profileDistanceAt(e.clientX)); });
profileCanvas.addEventListener('pointermove', (e) => {
  if (!canJump()) { profileCanvas.title = ''; return; }
  const imperial = settings.units === 'imperial';
  profileCanvas.title = `Jump to ${(profileDistanceAt(e.clientX) / 1000 / (imperial ? KM_PER_MI : 1)).toFixed(1)} ${imperial ? 'mi' : 'km'}`;
});
$('btn-reset').addEventListener('click', endRide);
$('btn-settings').addEventListener('click', openSettings);
$('btn-camera').addEventListener('click', cycleCamera);
function setSound(on: boolean) {
  sound.setEnabled(on);
  $('btn-sound').textContent = on ? '🔊 Sound on' : '🔇 Sound off';
  if (on !== settings.sound) {
    settings = { ...settings, sound: on };
    saveSettings(settings);
    pushSettings(settings);
  }
}
setSound(settings.sound);
$('btn-sound').addEventListener('click', () => setSound(!settings.sound));
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen isn’t available in this browser.'));
}
$('btn-fullscreen').addEventListener('click', toggleFullscreen);
if (!document.documentElement.requestFullscreen) $('btn-fullscreen').hidden = true; // e.g. iPhone Safari
$('gear-down').addEventListener('click', () => shift(-1));
$('gear-up').addEventListener('click', () => shift(1));
updateGearPanel();
$('btn-stage').addEventListener('click', openStages);
$<HTMLInputElement>('route-upload').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  let last: Stage | null = null;
  for (const file of Array.from(input.files ?? [])) {
    try {
      const { parseGpx } = await import('./routes/gpx');
      const { stage, saved } = addRoute(parseGpx(file.name, await file.text()));
      if (!saved) toast('Route too large to save in this browser; it’s rideable until you reload.', 6000);
      last = stage;
    } catch (err) {
      toast(`${file.name}: ${(err as Error).message}`, 6000);
    }
  }
  input.value = '';
  $<HTMLDialogElement>('stages').close();
  if (last) chooseStage(last);
  else openStages();
});
$('btn-workouts').addEventListener('click', () => use(workoutUi, (u) => u.openLibrary(), $('btn-workouts')));
$('btn-data').addEventListener('click', () =>
  openDataBlocks($<HTMLDialogElement>('data-blocks'), settings.dataFields, (ids) => {
    settings = { ...settings, dataFields: ids };
    saveSettings(settings);
    pushSettings(settings);
    hud.setFields(ids);
    placeWorkoutPanel();
  }),
);
$('wp-stop').addEventListener('click', () => { if (player && confirm('End this workout?')) stopWorkout(); });
$('wp-pause').addEventListener('click', () => { if (player) { player.paused = !player.paused; updateWorkoutPanel(); } });
$('wp-skip').addEventListener('click', () => player?.skip());
$('wp-down').addEventListener('click', () => { player?.nudge(-0.05); updateWorkoutPanel(); });
$('wp-up').addEventListener('click', () => { player?.nudge(0.05); updateWorkoutPanel(); });
$('stage-name').textContent = currentStage().name;
$<HTMLInputElement>('demo-power').addEventListener('input', (e) => setDemoPower(Number((e.target as HTMLInputElement).value)));
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('dialog')) return;
  if (hub.isOpen()) return; // the hub has its own keys (Tab, arrows on the section tabs, Enter, Escape)
  if (e.key === 'c' || e.key === 'C') cycleCamera();
  if (e.key === 'm' || e.key === 'M') setSound(!settings.sound);
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'ArrowLeft') { steering.press(-1); e.preventDefault(); }
  if (e.key === 'ArrowRight') { steering.press(1); e.preventDefault(); }
  if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) rideOnsUi.thumbsUpAhead();
  if (e.key === '=' || e.key === '+' || e.key === ']') shift(1);
  if (e.key === '-' || e.key === '_' || e.key === '[') shift(-1);
  if (!demo) return;
  if (e.key === 'ArrowUp') { setDemoPower(demoPower + 10); e.preventDefault(); }
  if (e.key === 'ArrowDown') { setDemoPower(demoPower - 10); e.preventDefault(); }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft') steering.release(-1);
  if (e.key === 'ArrowRight') steering.release(1);
});
window.addEventListener('blur', () => steering.release());
// On-screen steering buttons (shown on touch screens): press to step, hold to keep going.
for (const [id, dir] of [['steer-left', -1], ['steer-right', 1]] as const) {
  const btn = $(id);
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); steering.press(dir); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => steering.release(dir));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ☰ Menu → Time & weather.
const atmosphereUi = lazy(() => import('./atmosphereUi').then((m) => m.initAtmosphereUi({
  current: () => ({ timeOfDay: settings.timeOfDay, weather: settings.weather }),
  choose: (patch) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    pushSettings(settings);
    world.setAtmosphere(settings.timeOfDay, settings.weather);
  },
})));
$('btn-weather').addEventListener('click', () => use(atmosphereUi, (u) => u.open(), $('btn-weather')));

let bluetoothNote = () => {};
if (!bluetoothAvailable()) {
  for (const id of ['btn-trainer', 'btn-menu-trainer', 'btn-hr']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = true;
    b.title = 'Web Bluetooth is not available in this browser';
  }
  setStatus('Bluetooth unavailable in this browser. Use Chrome or Edge (or Bluefy on iPhone/iPad)', 'off');
  bluetoothNote = () => toast('This browser can’t use Bluetooth. Open in Chrome or Edge to connect your trainer. Demo ride works anywhere.', 7000);
} else {
  setStatus('No trainer connected', 'off');
  devices.start(); // reconnect remembered devices without the chooser where the browser allows it
}

// --------------------------------------------------------------- account ----

/** Weight and FTP given when creating an account by email. */
function saveRiderDetails(d: { riderKg: number; ftp: number | null }) {
  settings = { ...settings, riderKg: d.riderKg, ...(d.ftp ? { ftp: d.ftp } : {}) };
  saveSettings(settings); // uploaded to the new account as it signs in
  try { localStorage.setItem('americanflyers.onboarded', '1'); } catch { /* fine */ }
}

const accountUi = initAccountUi({
  onRiderDetails: saveRiderDetails,
  settings: () => settings,
  toast,
  // Signing out ends the ride (an account is required to ride): keep a ride worth keeping first.
  beforeSignOut: async () => { if (stats.seconds >= MIN_RIDE_S && stats.seconds > lastSavedSeconds) await saveRide({ quiet: true }); },
  // 📤 Share on a ride in your profile.
  shareRide: (a) => { import('./garage/shareUi').then((m) => shareRide(m.shareRideFromActivity(a, settings.units === 'imperial', settings.kit, garage.wallet ? `Level ${garage.wallet.level} · ${levelTitle(garage.wallet.level)}` : undefined), toast)); },
  context: () => ({
    stage: currentStage().name,
    workout: player?.workout.name ?? null,
    trainer: trainer?.name ?? (demo ? 'demo' : null),
    browser: navigator.userAgent,
    screen: `${window.innerWidth}×${window.innerHeight}`,
    version: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  }),
});
onSyncError((msg) => toast(msg, 6000));

// ---- AI coach and rivals (src/ai/): the host the controller is given when it loads ----
const stageLines = () => {
  const st = currentStage();
  if (race) return race.course.lines;
  return [...(st.race?.sprints ?? []).map((l) => ({ kind: 'sprint' as const, d: l.d, name: l.name })), ...(st.race?.summits ?? []).map((l) => ({ kind: 'summit' as const, d: l.d, name: l.name }))];
};
const patchAiSettings = (p: Partial<Pick<Settings, 'aiCoach' | 'aiRivals'>>) => { settings = { ...settings, ...p }; saveSettings(settings); pushSettings(settings); };
function aiHost(): AiHostBase {
  return {
    settings: () => settings,
    signedIn: () => !!account(),
    toast,
    stage: currentStage,
    stageLines,
    briefKey: () => `${currentStage().id}:${race ? 'r' : ''}`,
    stageName: () => currentStage().name,
    rideMode: () => (player ? 'workout' : race ? 'race' : 'ride'),
    workoutBrief: () => {
      if (!player) return null;
      return {
        name: player.workout.name, minutes: Math.round(player.duration / 60),
        steps: player.steps.slice(0, 40).map((st) => ({ atS: Math.round(st.at), durS: Math.round(st.duration), label: st.label, pctFtp: st.free ? null : Math.round(((st.start + st.end) / 2) * 100) / 100 })),
      };
    },
    gradeAt,
    headwindAt: (d) => roadWind(d).head,
    countsForRecord: () => leaderboardEligible(rideFlags),
    loadSession: (id, kind) => {
      if (kind === 'workout') { const w = workoutById(id); if (w) startWorkout(w); }
      else chooseStage(stageById(id));
    },
    patchSettings: patchAiSettings,
    openSettings,
    openSignIn: (reason) => accountUi.openSignIn(reason),
  };
}
function rivalsDeps() {
  return {
    signedIn: () => !!account(),
    rivalsOn: () => settings.aiRivals,
    active: () => ai?.rival ?? null,
    start: (id: string) => { void use(aiLazy, (a) => a.startRival(id)); },
    stop: () => ai?.stopRival(),
    openSettings,
    openSignIn: () => accountUi.openSignIn('Sign in to turn on AI rivals.'),
    records: () => aiApiLazy.get().then((m) => m.myRivals(), () => []),
    forget: (id?: string) => aiApiLazy.get().then((m) => m.forgetRival(id), () => false),
  };
}
// ☰ Menu → Rivals: the dialog loads on first open (it is prefetched when idle); the controller starts loading with it.
$('btn-rivals').addEventListener('click', () => {
  aiLazy.prefetch();
  void use(rivalsUi, (ui) => ui.open(), $('btn-rivals'));
});
/** After sign-in the database has the last word on the AI opt-in. Read it without loading the controller; that loads only if the rider has opted in. */
function syncAiConsent() {
  aiApiLazy.get().then((m) => m.loadConsent()).then((c) => {
    if (c) patchAiSettings({ aiCoach: c.coach, aiRivals: c.rivals });
    ensureAi();
  }).catch(() => {});
}
/**
 * The AI coach's card for a ride summary. With the controller loaded this is its card; otherwise (it is also the
 * "turn on the AI coach" invitation, so it matters even when the AI is off) a placeholder fills in once the module arrives.
 */
function aiDebrief(input: RideSummaryInput): { node: Node; rideSaved(activityId: string | null): void } | null {
  if (ai) return ai.debriefRide(input);
  if (input.durationS < 180) return null; // (the same minimum as DEBRIEF_MIN_S in ai/aiRide.ts)
  const slot = Object.assign(document.createElement('div'), { style: 'display: contents' });
  const card = aiLazy.get().then((a) => { const c = a.debriefRide(input); if (c) slot.append(c.node); return c; }, () => null);
  return { node: slot, rideSaved: (id) => { void card.then((c) => c?.rideSaved(id)); } };
}
// ---- end of AI ----

// ------------------------------------------------------ riding together ----

const presence = new Presence(
  () => settings.rideTogether && !document.body.classList.contains('at-home')
    ? { stageId: eventState ? eventStageKey(currentStage().id, eventState.ev.id) : currentStage().id, distance: ride.distance, speedMs: ride.speed, power: live.power, cadence: live.cadence, kit: kitString(playerLook()) }
    : null,
  () => true,
);

/** Starts a new ride at another rider's position on this stage. */
function rideWith(distance: number, name: string, speedMs = 0) {
  resetRide();
  ride.speed = speedMs; // joining a moving group: start rolling with them
  ride.distance = ride.startDistance = Math.max(0, distance - 6);
  ride.lastElev = elevationAt(ride.distance);
  world.jumped();
  toast(`Riding with ${name}. Pedal to stay on their wheel!`);
}

// ------------------------------------------------------ training plans ----

function setPlan(plan: Settings['plan']) {
  settings = { ...settings, plan };
  saveSettings(settings);
  pushSettings(settings);
  hubNotify('plan');
}

/** Ticks off the next matching session of the plan being followed. */
function planDone(what: { workout?: string; stage?: string }) {
  const plan = planById(settings.plan?.id);
  if (!plan || !settings.plan) return;
  const updated = complete(plan, settings.plan, what);
  if (!updated) return;
  setPlan(updated);
  const next = nextSession(plan, updated);
  window.setTimeout(() => toast(next ? `✓ ${plan.name}: session done! Next up: ${next.title}.` : `🏆 ${plan.name} plan complete!`, 6000), 1500);
}

function rideSession(session: Session) {
  if (session.workout) {
    const w = workoutById(session.workout);
    if (w) startWorkout(w);
  } else if (session.stage) {
    const stage = stageById(session.stage);
    if (stage !== currentStage()) chooseStage(stage);
    else resetRide();
    toast(stage.finish === null ? `${stage.name}: ride for 30 minutes.` : `${stage.name}: ride to the finish line.`, 5000);
  }
}

const plansUi = lazy(() => import('./plansUi').then((m) => m.initPlansUi({ progress: () => settings.plan, setProgress: setPlan, ride: rideSession, toast })));
const openPlans = (from?: Element | null) => use(plansUi, (u) => u.open(), from);
$('btn-plans').addEventListener('click', () => { $<HTMLDialogElement>('workouts').close(); openPlans($('btn-plans')); });
$('btn-menu-plans').addEventListener('click', () => openPlans($('btn-menu-plans')));

// ---------------------------------------------------------- first ride ----

const onboarding = lazy(() => import('./onboarding').then((m) => m.initOnboarding({
  settings: () => settings,
  save: (patch) => {
    const oldFtp = settings.ftp;
    settings = { ...settings, ...patch };
    saveSettings(settings);
    pushSettings(settings);
    if (settings.ftp !== oldFtp) recordFtp(settings.ftp, 'manual').catch(() => {});
    world.setMarkers(markerConfig());
  },
  connectTrainer: () => devices.connectTrainer(),
  connectHeartRate: () => devices.connectHeartRate(),
  bluetooth: bluetoothAvailable(),
  startDemo: () => { if (!demo) setDemo(true); },
  rampTest: () => { const w = workoutById(RAMP_TEST_ID); if (w) startWorkout(w); },
  rideStage: (id) => rideSession({ title: '', note: '', stage: id }),
  openPlans: () => { openPlans(); },
})));
const openOnboarding = (from?: Element | null) => use(onboarding, (u) => u.open(), from);
$('btn-setup-guide').addEventListener('click', () => { $<HTMLDialogElement>('settings').close(); openOnboarding($('btn-setup-guide')); });

// ---------------------------------------------------- ghosts & leaderboards ----

let ghost: Ghost | null = null;
let ghostSeq = 0;

/** The ghost as a rider on the road, while racing a whole-stage ride. */
function ghostRider(): OtherRider | null {
  const finish = currentStage().finish;
  if (!ghost || finish === null || ride.startDistance !== 0) return null;
  const d = ghost.distanceAt(ride.movingTime);
  if (d > finish + 40) return null; // finished and rolled away
  return { id: 'ghost', name: ghost.label, distance: d, speedMs: ghost.speedAt(ride.movingTime), power: 200, cadence: 88, ghost: true };
}

async function setGhostFrom(activityId: string) {
  const mine = ++ghostSeq;
  const stageId = currentStage().id;
  const trace = await stageGhost(activityId);
  if (mine !== ghostSeq || stageId !== currentStage().id) return null;
  ghost = trace ? new Ghost(trace) : null;
  return ghost;
}

/** Loads the ghost of your fastest ride on this stage, if you have one. */
async function loadMyGhost() {
  if (!account() || !settings.ghost || currentStage().finish === null) return;
  try {
    const me = (await stageLeaderboard(currentStage().id)).find((r) => r.is_me);
    if (me && (!ghost || ghost.isMe)) await setGhostFrom(me.activity_id);
  } catch { /* no ghost this time */ }
}

async function raceGhost(row: LeaderboardRow) {
  try {
    const g = await setGhostFrom(row.activity_id);
    if (!g) return toast('That ride can’t be raced any more.');
    resetRide();
    toast(`Racing ${g.isMe ? 'your best' : `${g.name}’s`} ghost (${raceTime(g.finishS)}). Go!`, 5000);
  } catch (e) {
    toast(`Couldn’t load that ghost: ${(e as Error).message}`);
  }
}

const leaderboardUi = lazy(() => import('./leaderboardUi').then((m) => m.initLeaderboardUi({
  stage: currentStage,
  race: raceGhost,
  clearGhost: () => { ghost = null; ghostSeq++; },
  ghostName: () => (ghost ? (ghost.isMe ? `your best (${raceTime(ghost.finishS)})` : `${ghost.name} (${raceTime(ghost.finishS)})`) : null),
  openSignIn: (why) => accountUi.openSignIn(why),
})));
loadOnClick($('btn-leaderboard'), leaderboardUi); // the dialog wires its own button once loaded

peloton.reset(ride.distance);

// Ride-ons (4-second poll for the ones sent to you) and the kit dialog.
const rideOns = new RideOns(() => settings.rideTogether && !document.body.classList.contains('at-home'));
const rideOnsUi = initRideOnsUi({
  rideOns,
  riders: () => roadRiders,
  myDistance: () => ride.distance,
  showEmote: (id, emoji) => world.showEmote(id, emoji),
  toast,
});
const kitUi = lazy(() => import('./kitUi').then((m) => m.initKitUi({
  current: () => settings.kit,
  save: (kit) => {
    settings = { ...settings, kit };
    saveSettings(settings);
    pushSettings(settings);
    setPlayerKit(kit);
    toast(kit ? 'Kit saved. You’re riding in your colours.' : 'Back in the American Flyers stars and stripes.');
  },
})));
$('btn-menu-kit').addEventListener('click', () => use(kitUi, (u) => u.open(), $('btn-menu-kit')));
// 🚲 Garage & store (src/garage): bikes, wheels and clothes, bought with credits earned from riding.
const garageUi = lazy(() => import('./garage/garageUi').then((m) => m.initGarageUi({
  garage,
  ctx: () => ({ riderKg: settings.riderKg, bikeKg: settings.bikeKg, ftp: settings.ftp }),
  imperial: () => settings.units === 'imperial',
  night: () => world.nightAmount,
  openSignIn: (why) => accountUi.openSignIn(why),
  toast,
})));
$('btn-menu-garage').addEventListener('click', () => use(garageUi, (u) => u.open(), $('btn-menu-garage')));

initRidersUi({
  presence,
  sendRideOn: (id, name, emote) => rideOnsUi.send(id, name, emote),
  teams: () => settings.proTeams ? peloton.groups.map((g) => ({
    id: g.id, name: g.team.name, color: g.team.color, wkg: g.wkg, riders: g.riders.length,
    distance: g.distance, back: peloton.back(g) + 3.5, speedMs: g.speed,
  })) : [],
  riderKg: () => settings.riderKg,
  me: () => ({ distance: ride.distance, stageName: currentStage().name, imperial: settings.units === 'imperial', enabled: settings.rideTogether }),
  rideWith,
  openSignIn: (why) => accountUi.openSignIn(why),
  openSettings,
  toast,
});

onAccountChange(async (a) => {
  setMonitoringUser(a?.id ?? null);
  if (!a) {
    abandonRide(); // no account, no ride (the home page replaces the hub in src/home.ts)
    forgetLocalCopies();
    ghost = null;
    garage.refresh(); // signed out: back to the starter kit and no wallet
    return;
  }
  garage.refresh(); // level, credits and what you own (this also applies your loadout)
  try {
    const remote = await syncOnSignIn(settings);
    if (remote) {
      settings = { ...settings, ...remote };
      saveSettings(settings);
      setPlayerKit(settings.kit);
      garage.apply(); // the account's loadout
      loadTour(settings.tour);
      updateTourJersey();
      hud.setFields(settings.dataFields);
      world.setMarkers(markerConfig());
      placeWorkoutPanel();
      lastSentGrade = NaN;
      setSound(settings.sound);
      updateGearPanel();
      updateMapMenu();
      applyHudPosition(settings.hudPosition);
      world.setAtmosphere(settings.timeOfDay, settings.weather);
      hubNotify('plan'); // the account's plan, FTP and units reach the hub
      // A returning rider on a new device: they've done the setup before.
      try { localStorage.setItem('americanflyers.onboarded', '1'); } catch { /* fine */ }
      const ob = $<HTMLDialogElement>('onboarding');
      if (ob.open) ob.close();
    }
    await savePendingRide();
    await uploadQueuedRides(); // rides saved on this device while offline
    garage.refresh(); // a ride saved just now may have earned credits
    accountUi.checkAdmin(); // the session is settled now
    loadMyGhost();
    syncAiConsent(); // the AI coach and rivals follow what the account agreed to (the database has the last word)
    toast(`Signed in as ${a.name}`);
  } catch (e) {
    toast(`Signed in, but couldn’t sync: ${(e as Error).message}`, 6000);
  }
});
// The hub (src/hub): sign-in leads here, and so does opening the app as a signed-in rider. Ride starts from here.
// The Bluetooth note and the first-ride guide wait until the rider first leaves it for the ride.
initPrivacyUi(); // the Privacy dialog; any element with data-privacy opens it
let enteredApp = false;
function leaveHub() {
  hub.close();
  ensureAi();
  if (enteredApp) return;
  enteredApp = true;
  // A short wait lets a signed-in rider's settings arrive first (they skip it).
  if (!onboarded()) window.setTimeout(() => { if (!onboarded() && !document.querySelector('dialog[open]')) void use(onboarding, (o) => o.open()); }, 1500);
  else bluetoothNote();
}

/** Stops whatever is under way when the account goes (signed out, or a stale signed-in hint): the rider returns to the home page. */
function abandonRide() {
  if (demo) setDemo(false); // the demo ride is for signed-in riders too
  if (!player && !race && !eventState && stats.seconds === 0) return; // nothing to stop
  if (player) stopWorkout();
  resetRide(); // (the ride was saved before sign-out, see beforeSignOut; with no account this saves nothing)
}

/** Ride: what the hub chose, as a fresh ride (a workout goes on top of its stage). */
function startFromHub(c: { stageId: string; workoutId: string | null }) {
  leaveHub();
  const stage = stageById(c.stageId);
  if (player) stopWorkout();
  if (stage !== currentStage()) chooseStage(stage); // (this also starts the ride afresh)
  const w = c.workoutId ? workoutById(c.workoutId) : undefined;
  if (w) startWorkout(w);
}

/**
 * ☰ Menu → 🏠 Hub, the brand button, and the finish card's "Back to the hub". A ride under way
 * (a minute or more, or a race or group ride) asks first: keep riding, or save it and go.
 */
async function goToHub(opts: { ask?: boolean } = {}) {
  if (hub.isOpen()) return;
  const underWay = $('finish').hidden && (stats.seconds >= MIN_RIDE_S || !!race || !!eventState);
  if (opts.ask !== false && underWay) {
    const also = [race ? (eventState ? 'your race' : 'the race') : eventState ? 'the group ride' : '', player ? 'your workout' : ''].filter(Boolean).join(' and ');
    if (!(await askToLeave({ signedIn: !!account(), time: formatTime(stats.seconds), also }))) return;
  }
  if (player) stopWorkout();
  resetRide(); // quietly saves a ride worth keeping, and leaves a race or group ride
  hub.open();
}

const hub = initHub({
  settings: () => settings,
  garage,
  currentStageId: () => currentStage().id,
  onVisibility: (open) => {
    world.setOrbit(open);
    // The "Reconnect <trainer>" banner sits in the hub's Ride panel while it's open, and floats over the ride otherwise.
    const banner = document.getElementById('device-banner');
    if (banner) {
      banner.classList.toggle('in-hub', open);
      if (open) document.getElementById('hub-devices')?.append(banner);
      else document.body.append(banner);
    }
    if (open) {
      world.setOthers([]);
      sound.update(0.1, { speedMs: 0, pedalling: false, crowd: 0, cassetteRevs: 0 }); // quiet while you choose
    } else {
      lastFrame = performance.now();
    }
  },
  start: startFromHub,
  race: (stage) => { leaveHub(); beginRace(stage, tourStageNumber(stage.id)); },
  joinEvent: async (row) => {
    await joinEvent(row); // checks the account and the join window, and shows why if it can't
    if (eventState) leaveHub();
  },
  startPlan: (id) => {
    const plan = planById(id);
    if (!plan) return;
    setPlan({ id, started: new Date().toISOString().slice(0, 10), done: [] });
    toast(`${plan.name} plan started. First up: ${plan.weeks[0][0].title}.`);
  },
  openProfile: (tab, rideId) => { void use(accountUi.dialogs, (u) => u.openProfile(tab, rideId)); },
  openGarage: (tab) => { void use(garageUi, (g) => g.open(tab)); },
  dialogs: {
    workouts: () => { void use(workoutUi, (w) => w.openLibrary()); },
    newWorkout: () => { void use(workoutUi, (w) => w.newWorkout()); },
    plans: () => { void use(plansUi, (p) => p.open()); },
    tour: () => { void use(tourUi, (t) => t.open()); },
    events: () => $('btn-events').click(),
    settings: openSettings,
    stages: openStages,
    kit: () => { void use(kitUi, (k) => k.open()); },
    account: () => $('btn-account').click(),
  },
  night: () => world.nightAmount,
  toast,
});
const home = initHome({
  onRiderDetails: saveRiderDetails,
  defaults: () => settings,
  openHub: () => hub.open(),
  requestHub: () => { void goToHub(); },
  onShowHome: () => { hub.close(); abandonRide(); },
});

// Everything that can wait for the first frame (src/lazy.ts): signing in (which loads the
// Neon SDK), error reporting (the Sentry SDK), the hero videos, and fetching the dialogs a
// rider is likely to open next, one at a time in spare moments.
let firstFrameDrawn = false;
let afterFirstFrameDone = false;
/** Called every frame (ride or hub); the first one schedules afterFirstFrame just after it's on screen. */
function noteFirstFrame() {
  if (!firstFrameDrawn) { firstFrameDrawn = true; requestAnimationFrame(() => window.setTimeout(afterFirstFrame, 0)); }
}
function afterFirstFrame() {
  if (afterFirstFrameDone) return;
  afterFirstFrameDone = true;
  markFirstFrame();
  // If the signed-in hint was stale (no account), drop the hub's cached numbers and show the home page.
  restoreSession().then((a) => { hub.sessionSettled(a); home.sessionSettled(a); });
  startMonitoring();
  prefetchPrivacy();
  ensureAi(); // a rider who opted in gets the coach and rivals ready for the ride
  prefetchWhenIdle([
    // First visit: the guide, and the email form on the home page.
    ...(onboarded() ? [] : [onboarding, emailAuth]),
    workoutUi, accountUi.dialogs, garageUi, leaderboardUi, plansUi, eventsUi, tourUi, kitUi, atmosphereUi, raceUiModule, commentary, rivalsUi, aiConsentUi,
    ...(onboarded() ? [emailAuth] : []),
  ]);
}
// A tab opened in the background never gets an animation frame: don't leave sign-in waiting on one.
window.setTimeout(afterFirstFrame, 6000);

requestAnimationFrame(frame);

// Installable app: register the service worker (production builds only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// "Install app" button where the browser offers it (Chrome, Edge, Android).
let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e as Event & { prompt: () => Promise<void> };
  $('btn-install').hidden = false;
});
$('btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt().catch(() => {});
  installPrompt = null;
  $('btn-install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('btn-install').hidden = true; toast('American Flyers is installed. Open it from your home screen or apps.'); });
