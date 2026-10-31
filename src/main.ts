import './style.css';
import { bluetoothAvailable, connectTrainer, type Trainer, type TrainerReading } from './ble/trainer';
import { connectHeartRate, type HeartRateMonitor } from './ble/heartRate';
import { currentStage, elevationAt, gradeAt, setStage } from './course';
import { STAGES, stageById, type Stage } from './stages';
import { stepSpeed, DEFAULT_PARAMS } from './physics';
import { drawProfile, gradeColor } from './profile';
import { World, type CameraMode } from './world/world';
import { loadSettings, saveSettings, type Settings } from './settings';

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

// Push the road grade to the trainer, scaled by the difficulty setting.
let lastSentGrade = NaN;
setInterval(() => {
  if (!trainer?.canControl) return;
  const target = Math.round(gradeAt(ride.distance) * 100 * (settings.difficulty / 100) * 10) / 10;
  if (Math.abs(target - lastSentGrade) < 0.1) return;
  lastSentGrade = target;
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

  world.update({ distance: ride.distance, speedMs: ride.speed, crankAngle: ride.crankAngle }, dt);

  if (now - lastHud > 200) {
    lastHud = now;
    updateHud(grade);
    const stageFinish = currentStage().finish;
    drawProfile(profileCanvas, ride.distance, stageFinish === null ? undefined : [0, stageFinish + 200]);
  }
  requestAnimationFrame(frame);
}

function updateHud(grade: number) {
  const imperial = settings.units === 'imperial';
  const avgPower = powerSamples.reduce((a, s) => a + s.p, 0) / Math.max(1, powerSamples.length);
  const speedKmh = ride.speed * 3.6;
  const hr = performance.now() - live.lastHrAt < STALE_MS ? live.heartRate || live.trainerHr : 0;

  $('stage-name').textContent = stageProgress();
  $('m-power').textContent = String(Math.round(avgPower));
  const zone = powerZone(avgPower / settings.ftp);
  $('m-zone').textContent = zone.label;
  document.documentElement.style.setProperty('--zone', zone.color);
  $('m-cadence').textContent = String(Math.round(live.cadence));
  $('m-speed').textContent = (imperial ? speedKmh / KM_PER_MI : speedKmh).toFixed(1);
  $('m-hr').textContent = hr ? String(hr) : '--';
  $('m-distance').textContent = ((ride.distance / 1000) / (imperial ? KM_PER_MI : 1)).toFixed(2);
  $('m-time').textContent = formatTime(ride.movingTime);
  $('m-grade').textContent = (Math.abs(grade) < 0.0005 ? 0 : grade * 100).toFixed(1);
  $('m-grade').style.color = gradeColor(grade);
  $('m-climb').textContent = String(Math.round(imperial ? ride.climbed * 3.28084 : ride.climbed));
  $('u-speed').textContent = imperial ? 'mph' : 'km/h';
  $('u-distance').textContent = imperial ? 'mi' : 'km';
  $('u-climb').textContent = imperial ? 'ft' : 'm';
}

function powerZone(ratio: number) {
  if (ratio < 0.55) return { label: 'Z1 Recovery', color: '#9aa5b1' };
  if (ratio < 0.75) return { label: 'Z2 Endurance', color: '#3e8ed0' };
  if (ratio < 0.9) return { label: 'Z3 Tempo', color: '#48c774' };
  if (ratio < 1.05) return { label: 'Z4 Threshold', color: '#f2c14e' };
  if (ratio < 1.2) return { label: 'Z5 VO2 max', color: '#f08a4b' };
  return { label: 'Z6 Anaerobic', color: '#e5383b' };
}

function formatTime(sec: number) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

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
  for (const stage of STAGES) {
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
    list.append(card);
  }
  dialog.showModal();
  // Draw each card's profile now that it has a size.
  STAGES.forEach((stage, i) => {
    drawProfile(list.querySelectorAll('canvas')[i] as HTMLCanvasElement, null, [0, stage.finish ?? 20000], stage.elevationAt);
  });
}

function showFinish() {
  ride.finished = true;
  const imperial = settings.units === 'imperial';
  const finish = currentStage().finish!;
  const avgPower = ride.movingTime > 0 ? Math.round(ride.work / ride.movingTime) : 0;
  const avgKmh = ride.movingTime > 0 ? ((finish - ride.startDistance) / ride.movingTime) * 3.6 : 0;
  $('finish-title').textContent = `${currentStage().name}: finished!`;
  $('finish-stats').innerHTML = `
    <div><span>Time</span><strong>${formatTime(ride.movingTime)}</strong></div>
    <div><span>Avg power</span><strong>${avgPower} W</strong></div>
    <div><span>Avg speed</span><strong>${(imperial ? avgKmh / KM_PER_MI : avgKmh).toFixed(1)} ${imperial ? 'mph' : 'km/h'}</strong></div>
    <div><span>Climbed</span><strong>${Math.round(imperial ? ride.climbed * 3.28084 : ride.climbed)} ${imperial ? 'ft' : 'm'}</strong></div>`;
  $('finish').hidden = false;
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
$('finish-again').addEventListener('click', resetRide);
$('finish-close').addEventListener('click', () => { $('finish').hidden = true; });
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
