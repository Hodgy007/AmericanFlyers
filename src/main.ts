import './style.css';
import { bluetoothAvailable, connectTrainer, type Trainer, type TrainerReading } from './ble/trainer';
import { connectHeartRate, type HeartRateMonitor } from './ble/heartRate';
import { currentStage, elevationAt, gradeAt, setStage } from './course';
import type { Stage } from './stages';
import { addRoute, allStages, deleteRoute, stageById } from './routes/library';
import { parseGpx } from './routes/gpx';
import { stepSpeed, DEFAULT_PARAMS } from './physics';
import { drawProfile } from './profile';
import { World, type CameraMode } from './world/world';
import { loadSettings, saveSettings, type Settings } from './settings';
import { formatTime, Hud, openDataBlocks } from './hud';
import { RideStats } from './stats';
import { drawWorkout } from './workouts/graph';
import { RAMP_TEST_ID, zoneColor, type Workout } from './workouts/model';
import { WorkoutPlayer } from './workouts/player';
import { initWorkoutUi } from './workouts/ui';

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
const ride = { distance: 0, startDistance: 0, speed: 0, movingTime: 0, climbed: 0, lastElev: 0, crankAngle: 0, work: 0, finished: false };
const powerSamples: { t: number; p: number }[] = [];
let stats = new RideStats(); // whole ride
let player: WorkoutPlayer | null = null;
let workoutStats = new RideStats(); // just the current workout

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
      () => { hrm = null; live.heartRate = 0; $('btn-hr').textContent = 'Heart rate'; toast('Heart rate strap disconnected'); },
    );
    $('btn-hr').textContent = 'HR ✓';
    toast(`Connected to ${hrm.name}`);
  } catch (err) {
    hrm = null;
    if ((err as DOMException)?.name !== 'NotFoundError') toast(`Couldn't connect: ${(err as Error).message}`);
  }
}

// Control the trainer once a second: ERG (hold the workout's target watts)
// during a workout, otherwise the road grade scaled by the difficulty setting.
let lastSentGrade = NaN;
let lastSentWatts = NaN;
setInterval(() => {
  if (!trainer?.canControl) return;
  const watts = player && !player.done ? player.targetWatts() : null;
  if (watts !== null) {
    if (Math.abs(watts - lastSentWatts) < 1) return;
    lastSentWatts = watts;
    lastSentGrade = NaN; // resend the grade when ERG ends
    trainer.setTargetPower(watts).catch(() => { lastSentWatts = NaN; });
    return;
  }
  const target = Math.round(gradeAt(ride.distance) * 100 * (settings.difficulty / 100) * 10) / 10;
  if (Math.abs(target - lastSentGrade) < 0.1) return;
  lastSentGrade = target;
  lastSentWatts = NaN;
  trainer.setGrade(target).catch(() => { lastSentGrade = NaN; });
}, 1000);

// ----------------------------------------------------------------- demo ----

function setDemo(on: boolean) {
  demo = on;
  $('demo-panel').hidden = !on;
  $('btn-demo').classList.toggle('active', on);
  $('btn-demo').textContent = on ? 'Stop demo' : 'Demo ride';
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
const profileCanvas = $<HTMLCanvasElement>('profile');
// `?start=12` begins the ride 12 km in, handy for jumping to the hills.
const startKm = Number(new URLSearchParams(location.search).get('start'));
if (startKm > 0) {
  ride.distance = ride.startDistance = startKm * 1000;
  ride.lastElev = elevationAt(ride.distance);
}

let lastFrame = performance.now();
let lastHud = 0;

function frame(now: number) {
  // rAF timestamps can precede the load-time clock reading, so clamp at 0.
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  if (demo) {
    // In a workout the demo rider follows the target, with a little wobble.
    const target = player && !player.done && !player.paused ? player.targetWatts() : null;
    if (target !== null) setDemoPower(Math.round(target + Math.sin(now / 900) * 4));
    live.power = demoPower;
    live.cadence = demoPower > 0 ? Math.round(78 + demoPower / 25 + Math.sin(now / 1700) * 3) : 0;
    live.lastReadingAt = now;
  } else if (now - live.lastReadingAt > STALE_MS) {
    live.power = 0;
    live.cadence = 0;
  }

  const grade = gradeAt(ride.distance);
  ride.speed = stepSpeed(ride.speed, live.power, grade, dt, {
    ...DEFAULT_PARAMS,
    massKg: settings.riderKg + settings.bikeKg,
  });
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
  ride.crankAngle -= (live.cadence / 60) * 2 * Math.PI * dt;

  powerSamples.push({ t: now, p: live.power });
  while (powerSamples.length && now - powerSamples[0].t > 3000) powerSamples.shift();

  const moving = ride.speed > 0.3 || live.power > 0;
  stats.add(dt, live.power, live.cadence, currentHr(), moving);
  if (player) {
    const pedalling = live.power > 0 || live.cadence > 0;
    if (!player.done) {
      player.tick(dt, pedalling, live.power);
      if (pedalling && !player.paused) workoutStats.add(dt, live.power, live.cadence, currentHr(), true);
    }
    if (player.done) finishWorkout(); // reached the end, or skipped past the last step
  }

  world.update({ distance: ride.distance, speedMs: ride.speed, crankAngle: ride.crankAngle }, dt);

  if (now - lastHud > 200) {
    lastHud = now;
    updateHud(grade);
    if (player) {
      drawWorkout(profileCanvas, player.steps, { elapsed: player.elapsed, trace: player.trace });
    } else {
      const stageFinish = currentStage().finish;
      drawProfile(profileCanvas, ride.distance, stageFinish === null ? undefined : [0, stageFinish + 200]);
    }
  }
  requestAnimationFrame(frame);
}

function currentHr() {
  return performance.now() - live.lastHrAt < STALE_MS ? live.heartRate || live.trainerHr : 0;
}

const hud = new Hud($('hud'));
hud.setFields(settings.dataFields);

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
}

// ------------------------------------------------------------- workouts ----

/** Keeps the workout panel just below the data blocks, however many rows they take. */
function placeWorkoutPanel() {
  if (window.innerWidth <= 560) return; // docked at the bottom on phones (CSS)
  $('workout-panel').style.top = `${Math.round(document.querySelector('.hud-wrap')!.getBoundingClientRect().bottom + 10)}px`;
}
window.addEventListener('resize', placeWorkoutPanel);

function startWorkout(w: Workout) {
  player = new WorkoutPlayer(w, settings.ftp);
  workoutStats = new RideStats();
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
      onClick: () => { settings = { ...settings, ftp }; saveSettings(settings); toast(`FTP set to ${ftp} W`); },
    });
  }
  stopWorkout();
  showSummary('💪', `${w.name}: complete!`, items, actions);
}

interface SummaryAction { label: string; primary?: boolean; onClick: () => void }

function showSummary(flag: string, title: string, items: [string, string][], actions: SummaryAction[]) {
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

function resetRide() {
  Object.assign(ride, { distance: 0, startDistance: 0, speed: 0, movingTime: 0, climbed: 0, lastElev: 0, crankAngle: 0, work: 0, finished: false });
  powerSamples.length = 0;
  stats = new RideStats();
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
  const url = new URL(location.href);
  url.searchParams.set('stage', stage.id);
  url.searchParams.delete('start');
  history.replaceState(null, '', url);
  world.restage(markerConfig());
  resetRide();
  $('stage-name').textContent = stage.name;
  toast(`${stage.name}: ${stage.tagline}`, 5000);
}

function openStages() {
  const dialog = $<HTMLDialogElement>('stages');
  const list = $('stage-list');
  list.replaceChildren();
  const imperial = settings.units === 'imperial';
  const stages = allStages();
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

function showFinish() {
  ride.finished = true;
  const imperial = settings.units === 'imperial';
  const finish = currentStage().finish!;
  const avgPower = ride.movingTime > 0 ? Math.round(ride.work / ride.movingTime) : 0;
  const avgKmh = ride.movingTime > 0 ? ((finish - ride.startDistance) / ride.movingTime) * 3.6 : 0;
  showSummary('🏁', `${currentStage().name}: finished!`, [
    ['Time', formatTime(ride.movingTime)],
    ['Avg power', `${avgPower} W`],
    ['Avg speed', `${(imperial ? avgKmh / KM_PER_MI : avgKmh).toFixed(1)} ${imperial ? 'mph' : 'km/h'}`],
    ['Climbed', `${Math.round(imperial ? ride.climbed * 3.28084 : ride.climbed)} ${imperial ? 'ft' : 'm'}`],
  ], [
    { label: 'Keep riding', onClick: () => {} },
    { label: 'Ride it again', primary: true, onClick: resetRide },
  ]);
}

/** "8.4 km to go · next: Virage 14 in 230 m" for stages with a finish. */
function stageProgress() {
  const stage = currentStage();
  if (stage.finish === null) return stage.name;
  if (ride.finished) return `${stage.name} · finished`;
  const imperial = settings.units === 'imperial';
  const left = (stage.finish - ride.distance) / 1000;
  const parts = [stage.name, `${(imperial ? left / KM_PER_MI : left).toFixed(1)} ${imperial ? 'mi' : 'km'} to go`];
  const next = stage.signs.find((s) => s.d > ride.distance);
  if (next?.style === 'hairpin') parts.push(`next: ${stage.hairpinWord ?? 'Hairpin'} ${next.label} in ${Math.round(next.d - ride.distance)} m`);
  return parts.join(' · ');
}

function openSettings() {
  const dialog = $<HTMLDialogElement>('settings');
  const form = dialog.querySelector('form')!;
  for (const [k, v] of Object.entries(settings)) {
    const input = form.elements.namedItem(k) as HTMLInputElement | null;
    if (input) input.value = String(v);
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
  settings = {
    ...settings,
    riderKg: num('riderKg', settings.riderKg),
    bikeKg: num('bikeKg', settings.bikeKg),
    ftp: num('ftp', settings.ftp),
    units: data.get('units') === 'imperial' ? 'imperial' : 'metric',
    difficulty: Math.max(0, Math.min(100, Number(data.get('difficulty')))),
  };
  saveSettings(settings);
  world.setMarkers(markerConfig());
  lastSentGrade = NaN;
});
$('settings').querySelector<HTMLInputElement>('[name=difficulty]')!.addEventListener('input', (e) => {
  $('difficulty-out').textContent = `${(e.target as HTMLInputElement).value}%`;
});

$('btn-trainer').addEventListener('click', toggleTrainer);
$('btn-hr').addEventListener('click', toggleHeartRate);
$('btn-demo').addEventListener('click', () => setDemo(!demo));
$('btn-reset').addEventListener('click', resetRide);
$('btn-settings').addEventListener('click', openSettings);
$('btn-camera').addEventListener('click', cycleCamera);
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
  if (!demo) return;
  if (e.key === 'ArrowUp') { setDemoPower(demoPower + 10); e.preventDefault(); }
  if (e.key === 'ArrowDown') { setDemoPower(demoPower - 10); e.preventDefault(); }
});

if (!bluetoothAvailable()) {
  for (const id of ['btn-trainer', 'btn-hr']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = true;
    b.title = 'Web Bluetooth is not available in this browser';
  }
  setStatus('Bluetooth unavailable in this browser. Use Chrome or Edge (or Bluefy on iPhone/iPad)', 'off');
  toast('This browser can’t use Bluetooth. Open in Chrome or Edge to connect your trainer. Demo ride works anywhere.', 7000);
} else {
  setStatus('No trainer connected', 'off');
}

requestAnimationFrame(frame);
