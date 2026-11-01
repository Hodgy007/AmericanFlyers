import './style.css';
import { initMonitoring, setMonitoringContext, setMonitoringUser } from './monitoring';

initMonitoring(); // first, so it catches errors while the app starts
import { bluetoothAvailable, connectTrainer, type Trainer, type TrainerReading } from './ble/trainer';
import { connectHeartRate, type HeartRateMonitor } from './ble/heartRate';
import { currentStage, elevationAt, gradeAt, headingAt, setStage } from './course';
import type { Stage } from './stages';
import { addRoute, allStages, deleteRoute, stageById } from './routes/library';
import { parseGpx } from './routes/gpx';
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
import { initWorkoutUi } from './workouts/ui';
import { HR_ZONES, POWER_ZONES, zoneBars } from './zones';
import { account, onAccountChange, restoreSession } from './cloud/account';
import { forgetLocalCopies, onSyncError, pushSettings, recordFtp, saveActivity, stageGhost, stageLeaderboard, syncOnSignIn, type Activity, type LeaderboardRow } from './cloud/sync';
import { RideRecorder } from './cloud/recorder';
import { initAccountUi } from './cloud/ui';
import { initHome } from './home';
import { Presence } from './cloud/presence';
import { initRidersUi } from './ridersUi';
import { Ghost, raceTime } from './ghost';
import { initLeaderboardUi } from './leaderboardUi';
import { Sound } from './sound';
import { Peloton } from './peloton';
import { draftFrom, DRAFT_MAX_GAP, DRAFT_SWEET_SPOT, type Draft } from './draft';
// Wind, echelons, the mini-map and the climb preview (world/wind.ts, miniMap.ts, climbUi.ts, windUi.ts).
import { draftShift, wind } from './world/wind';
import { initWindUi } from './windUi';
import { MiniMap } from './miniMap';
import { initClimbUi } from './climbUi';
import { complete, nextSession, planById, type Session } from './plans';
import { initPlansUi } from './plansUi';
import { initOnboarding, onboarded } from './onboarding';
import { workoutById } from './workouts/library';
import type { OtherRider } from './world/others';
import { Steering } from './steering';
import { initAtmosphereUi } from './atmosphereUi';
import { kitString, onLookChange, playerLook, setPlayerKit, setTourJersey } from './kit';
import { initKitUi } from './kitUi';
import { Garage, rewardText } from './garage/garage';
import { initGarageUi } from './garage/garageUi';
import { attachShare, shareDataFromRide, shareRideFromActivity, runShare } from './garage/shareUi';
import { levelTitle } from './garage/progression';
import { RideOns } from './cloud/rideOns';
import { initRideOnsUi } from './rideOnsUi';
// Racing and the Hell of the West tour (race.ts, raceUi.ts, tour.ts, tourUi.ts).
import { LiveRace, raceSetup, type ResultRow } from './race';
import { initRaceUi, resultsNode } from './raceUi';
import { initTourUi } from './tourUi';
import { JERSEY_NAMES, TOUR_STAGE_IDS, getTour, loadTour, myJerseys, onTourChange, priorTotals, recordStage, refWkg, simulateStage, tourComplete, tourJersey, tourStageNumber } from './tour';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STALE_MS = 3000; // treat trainer as idle if no data for this long
const KM_PER_MI = 1.609344;

let settings = loadSettings();

// ---------------------------------------------------------------- state ----

let trainer: Trainer | null = null;
let hrm: HeartRateMonitor | null = null;
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
const raceUi = initRaceUi();
let draft: Draft | null = null; // the rider just ahead, if any
let lastCrossShift = 0; // crosswind echelon: metres right of a rider's line the shelter sits
let draftSaving = 0; // fraction of air drag saved, eased
let roadRiders: OtherRider[] = []; // live riders and pro teams on the road now (for ride-ons)
const rideWorkout = { started: null as string | null, completed: null as string | null };

// ------------------------------------------------------------- devices ----

function onReading(r: TrainerReading) {
  const now = performance.now();
  if (r.power !== undefined) live.power = Math.max(0, r.power);
  if (r.cadence !== undefined) live.cadence = r.cadence;
  if (r.heartRate) { live.trainerHr = r.heartRate; live.lastHrAt = now; }
  live.lastReadingAt = now;
}

async function toggleTrainer() {
  if (trainer) {
    trainer.disconnect();
    return;
  }
  try {
    setStatus('Searching…', 'pending');
    trainer = await connectTrainer({
      onReading,
      onDisconnect: () => {
        trainer = null;
        setStatus('Trainer disconnected', 'off');
        $('btn-trainer').textContent = 'Connect trainer';
        toast('Trainer disconnected');
      },
    });
    if (demo) setDemo(false);
    lastSentGrade = NaN;
    $('btn-trainer').textContent = 'Disconnect';
    lastSentWatts = NaN;
    setStatus(
      `${trainer.name} · ${trainer.canControl ? 'resistance follows the road' : 'power only (no resistance control)'}`,
      'on',
    );
    toast(`Connected to ${trainer.name}`);
  } catch (err) {
    trainer = null;
    setStatus('No trainer connected', 'off');
    if ((err as DOMException)?.name !== 'NotFoundError') toast(`Couldn't connect: ${(err as Error).message}`);
  }
}

async function toggleHeartRate() {
  if (hrm) {
    hrm.disconnect();
    return;
  }
  try {
    hrm = await connectHeartRate(
      (bpm) => { live.heartRate = bpm; live.lastHrAt = performance.now(); },
      () => { hrm = null; live.heartRate = 0; $('btn-hr').textContent = '❤️ Heart rate strap'; toast('Heart rate strap disconnected'); },
    );
    $('btn-hr').textContent = '❤️ Heart rate ✓';
    toast(`Connected to ${hrm.name}`);
  } catch (err) {
    hrm = null;
    if ((err as DOMException)?.name !== 'NotFoundError') toast(`Couldn't connect: ${(err as Error).message}`);
  }
}

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
  // In someone's draft the trainer's wind resistance drops too, so it feels easier.
  const dragFactor = Math.round((1 - draftSaving) * 20) / 20;
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

function frame(now: number) {
  // rAF timestamps can precede the load-time clock reading, so clamp at 0.
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)) * TIME_SCALE;
  lastFrame = now;

  if (demo) {
    // In a workout the demo rider follows the target, with a little wobble.
    const target = player && !player.done && !player.paused ? player.targetWatts() : null;
    if (target !== null) setDemoPower(Math.round(target + Math.sin(now / 900) * 4));
    live.power = demoPower;
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
  if (settings.proTeams || race) {
    peloton.update(dt);
    liveRiders.push(...peloton.riders());
  }
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
  if (race?.holding) ride.speed = 0; // waiting on the line for the start
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
  sound.update(dt, { speedMs: ride.speed, pedalling: live.power > 0 || live.cadence > 0, crowd: crowdNear(ride.distance) });

  const others = liveRiders;
  const g = race ? null : ghostRider(); // no ghost in a race
  if (g) others.push(g);
  world.setOthers(others);
  world.update({ distance: ride.distance, speedMs: ride.speed, crankAngle: drivetrain.crankAngle, rock: drivetrain.rock }, dt);
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
    climbUi.update(ride.distance, settings.miniMap, !ride.finished, settings.units === 'imperial');
    placeBelowHud();
    raceUi.countdown(race?.countText ?? null);
    raceUi.panel(race && race.phase === 'racing' && !ride.finished ? race.panel(ride.distance) : null, settings.units === 'imperial');
    if (player) {
      drawWorkout(profileCanvas, player.steps, { elapsed: player.elapsed, trace: player.trace });
    } else {
      const stageFinish = currentStage().finish;
      drawProfile(profileCanvas, ride.distance, stageFinish === null ? undefined : [0, stageFinish + 200]);
    }
  }
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
  stopWorkout();
  showSummary('💪', `${w.name}: complete!`, items, actions, zones);
  saveRide();
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
  }));
  $('finish').hidden = false;
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
const PENDING_KEY = 'americanflyers.pendingRide';

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
    finish_s: ride.finished && ride.finishTime > 0 ? Math.round(ride.finishTime) : null,
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
async function saveRide(opts: { quiet?: boolean } = {}) {
  const note = $('finish-note');
  const showNote = !opts.quiet && !$('finish').hidden;
  if (stats.seconds < MIN_RIDE_S) return;
  if (!account()) {
    if (showNote) {
      note.replaceChildren('Sign in to save this ride to your profile. ');
      const b = document.createElement('button');
      b.className = 'link';
      b.textContent = 'Sign in';
      b.addEventListener('click', () => {
        // Keep the ride so it's saved when the rider comes back from signing in.
        try { localStorage.setItem(PENDING_KEY, JSON.stringify(buildActivity())); } catch { /* too big: lost */ }
        accountUi.openSignIn('Sign in to save this ride, and all your future ones.');
      });
      note.append(b);
    }
    return;
  }
  if (showNote) note.textContent = 'Saving to your rides…';
  try {
    await saveActivity(buildActivity());
    lastSavedSeconds = stats.seconds;
    accountUi.invalidate();
    if (showNote) note.textContent = '✓ Saved to your rides';
    // Credits and levels come from the server's count of your saved rides.
    garage.afterRide().then((r) => {
      if (!r || opts.quiet) return;
      const text = rewardText(r);
      if (text && showNote) note.append(Object.assign(document.createElement('div'), { className: 'finish-reward', textContent: `🪙 ${text}` }));
      if (r.levelAfter > r.levelBefore) toast(`⭐ Level ${r.levelAfter}!`, 5000);
    }).catch(() => { /* credits are a bonus */ });
  } catch (e) {
    if (showNote) note.textContent = `Couldn’t save this ride: ${(e as Error).message}`;
    else if (!opts.quiet) toast(`Couldn’t save your ride: ${(e as Error).message}`);
  }
}

// Save long rides every few minutes, so a closed tab doesn't lose them.
setInterval(() => {
  if (account() && stats.seconds >= MIN_RIDE_S && stats.seconds - lastSavedSeconds > 60) saveRide({ quiet: true });
}, 5 * 60 * 1000);

async function savePendingRide() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PENDING_KEY); } catch { /* storage blocked */ }
  if (!raw) return;
  try {
    await saveActivity(JSON.parse(raw) as Activity);
    localStorage.removeItem(PENDING_KEY);
    accountUi.invalidate();
    toast('Your ride was saved to your profile.');
  } catch (e) {
    toast(`Couldn’t save your earlier ride: ${(e as Error).message}`);
  }
}

const workoutUi = initWorkoutUi({ ftp: () => settings.ftp, ride: startWorkout, toast });

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
  ], zoneSummary(stats));
  saveRide();
}

function resetRide() {
  if (stats.seconds >= MIN_RIDE_S && stats.seconds > lastSavedSeconds) saveRide({ quiet: true });
  recorder = new RideRecorder();
  lastSavedSeconds = 0;
  rideWorkout.started = player ? player.workout.name : null;
  rideWorkout.completed = null;
  Object.assign(ride, { distance: 0, startDistance: 0, speed: 0, movingTime: 0, climbed: 0, lastElev: 0, work: 0, finished: false, finishTime: 0, planCounted: false, proM: 0, racePlace: 0, raceSize: 0 });
  if (race) { race = null; peloton.endRace(); raceUi.panel(null, false); raceUi.countdown(null); } // starting afresh ends a race
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
  tourCard.addEventListener('click', () => { dialog.close(); tourUi.open(); });
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
  race.onBeep = (last) => sound.beep(last);
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
    else actions.push({ label: 'Tour standings', primary: true, onClick: () => tourUi.open() });
  } else {
    actions.push({ label: 'Race again', primary: true, onClick: () => beginRace(stage, tourN) });
  }
  return { rows, me, place, tour: tour && tourN ? tour : null, actions };
}

const tourUi = initTourUi({
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
});
$('btn-tour').addEventListener('click', () => tourUi.open());
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
  if (racing) {
    racing.update(0.001, ride.distance, ride.speed); // make sure the line is recorded for this frame
    const r = finishRace(racing);
    ride.racePlace = r.place;
    ride.raceSize = r.rows.length;
    shareHeadline = `${ordinal(r.place)} of ${r.rows.length}`;
    if (r.tour) shareBadges.push(...myJerseys(r.tour).map((j) => `👕 ${JERSEY_NAMES[j]}`));
    items.splice(0, 1, ['Place', `${ordinal(r.place)} of ${r.rows.length}`], ['Race time', raceTime(r.me.time)]);
    items.splice(2, 0, ['Points', `${r.me.sprint} sprint · ${r.me.kom} mountain`]);
    items.length = Math.min(items.length, 6);
    title = `${currentStage().name}: ${ordinal(r.place)}`;
    extra = [resultsNode(r.rows, r.tour), ...extra];
    actions = r.actions;
    race = null; // the race is over: the teams go back to riding the road
    peloton.endRace(ride.distance);
    raceUi.panel(null, false);
  }
  showSummary('🏁', title, items, actions, extra);
  $('finish').querySelector('.finish-card')!.classList.toggle('race', !!racing);
  // 📤 Share: a picture of the ride (route, numbers, place, your colours).
  const finishStage = currentStage();
  const finishFrom = ride.startDistance;
  const finishTo = ride.distance;
  attachShare($('finish-actions'), () => shareDataFromRide({
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
  saveRide().then(() => showRank());
}

/** After a whole-stage ride is saved: where it puts you on the leaderboard. */
async function showRank() {
  if (!account() || !ride.finishTime) return;
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

function openSettings() {
  const dialog = $<HTMLDialogElement>('settings');
  const form = dialog.querySelector('form')!;
  for (const [k, v] of Object.entries(settings)) {
    const input = form.elements.namedItem(k) as HTMLInputElement | null;
    if (input?.type === 'checkbox') input.checked = v === true;
    else if (input) input.value = String(v);
  }
  $('difficulty-out').textContent = `${settings.difficulty}%`;
  dialog.showModal();
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
  };
  saveSettings(settings);
  pushSettings(settings);
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

$('btn-trainer').addEventListener('click', toggleTrainer);
$('btn-hr').addEventListener('click', toggleHeartRate);
$('btn-demo').addEventListener('click', () => setDemo(!demo));
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
$('btn-workouts').addEventListener('click', () => workoutUi.openLibrary());
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
const atmosphereUi = initAtmosphereUi({
  current: () => ({ timeOfDay: settings.timeOfDay, weather: settings.weather }),
  choose: (patch) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    pushSettings(settings);
    world.setAtmosphere(settings.timeOfDay, settings.weather);
  },
});
$('btn-weather').addEventListener('click', () => atmosphereUi.open());

let bluetoothNote = () => {};
if (!bluetoothAvailable()) {
  for (const id of ['btn-trainer', 'btn-hr']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = true;
    b.title = 'Web Bluetooth is not available in this browser';
  }
  setStatus('Bluetooth unavailable in this browser. Use Chrome or Edge (or Bluefy on iPhone/iPad)', 'off');
  bluetoothNote = () => toast('This browser can’t use Bluetooth. Open in Chrome or Edge to connect your trainer. Demo ride works anywhere.', 7000);
} else {
  setStatus('No trainer connected', 'off');
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
  // 📤 Share on a ride in your profile.
  shareRide: (a) => runShare(shareDataFromRide(shareRideFromActivity(a, settings.units === 'imperial', settings.kit, garage.wallet ? `Level ${garage.wallet.level} · ${levelTitle(garage.wallet.level)}` : undefined)), toast),
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

// ------------------------------------------------------ riding together ----

const presence = new Presence(
  () => settings.rideTogether && !document.body.classList.contains('at-home')
    ? { stageId: currentStage().id, distance: ride.distance, speedMs: ride.speed, power: live.power, cadence: live.cadence, kit: kitString(playerLook()) }
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

const plansUi = initPlansUi({ progress: () => settings.plan, setProgress: setPlan, ride: rideSession, toast });
$('btn-plans').addEventListener('click', () => { $<HTMLDialogElement>('workouts').close(); plansUi.open(); });
$('btn-menu-plans').addEventListener('click', () => plansUi.open());

// ---------------------------------------------------------- first ride ----

const onboarding = initOnboarding({
  settings: () => settings,
  save: (patch) => {
    const oldFtp = settings.ftp;
    settings = { ...settings, ...patch };
    saveSettings(settings);
    pushSettings(settings);
    if (settings.ftp !== oldFtp) recordFtp(settings.ftp, 'manual').catch(() => {});
    world.setMarkers(markerConfig());
  },
  connectTrainer: async () => { if (!trainer) await toggleTrainer(); return !!trainer; },
  connectHeartRate: async () => { if (!hrm) await toggleHeartRate(); return !!hrm; },
  bluetooth: bluetoothAvailable(),
  startDemo: () => { if (!demo) setDemo(true); },
  rampTest: () => { const w = workoutById(RAMP_TEST_ID); if (w) startWorkout(w); },
  rideStage: (id) => rideSession({ title: '', note: '', stage: id }),
  openPlans: () => plansUi.open(),
});
$('btn-setup-guide').addEventListener('click', () => { $<HTMLDialogElement>('settings').close(); onboarding.open(); });

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

initLeaderboardUi({
  stage: currentStage,
  race: raceGhost,
  clearGhost: () => { ghost = null; ghostSeq++; },
  ghostName: () => (ghost ? (ghost.isMe ? `your best (${raceTime(ghost.finishS)})` : `${ghost.name} (${raceTime(ghost.finishS)})`) : null),
  openSignIn: (why) => accountUi.openSignIn(why),
});

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
const kitUi = initKitUi({
  current: () => settings.kit,
  save: (kit) => {
    settings = { ...settings, kit };
    saveSettings(settings);
    pushSettings(settings);
    setPlayerKit(kit);
    toast(kit ? 'Kit saved. You’re riding in your colours.' : 'Back in the American Flyers stars and stripes.');
  },
});
$('btn-menu-kit').addEventListener('click', () => kitUi.open());
// 🚲 Garage & store (src/garage): bikes, wheels and clothes, bought with credits earned from riding.
const garageUi = initGarageUi({
  garage,
  ctx: () => ({ riderKg: settings.riderKg, bikeKg: settings.bikeKg, ftp: settings.ftp }),
  imperial: () => settings.units === 'imperial',
  night: () => world.nightAmount,
  openSignIn: (why) => accountUi.openSignIn(why),
  toast,
});
$('btn-menu-garage').addEventListener('click', () => garageUi.open());

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
      // A returning rider on a new device: they've done the setup before.
      try { localStorage.setItem('americanflyers.onboarded', '1'); } catch { /* fine */ }
      const ob = $<HTMLDialogElement>('onboarding');
      if (ob.open) ob.close();
    }
    await savePendingRide();
    garage.refresh(); // a ride saved just now may have earned credits
    accountUi.checkAdmin(); // the session is settled now
    loadMyGhost();
    toast(`Signed in as ${a.name}`);
  } catch (e) {
    toast(`Signed in, but couldn’t sync: ${(e as Error).message}`, 6000);
  }
});
// The Bluetooth note and the first-ride guide wait until the rider leaves the home page.
initHome({
  onRiderDetails: saveRiderDetails,
  defaults: () => settings,
  onEnterApp: () => {
    // A short wait lets a signed-in rider's settings arrive first (they skip it).
    if (!onboarded()) window.setTimeout(() => { if (!onboarded() && !document.querySelector('dialog[open]')) onboarding.open(); }, 1500);
    else bluetoothNote();
  },
});
restoreSession();

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
