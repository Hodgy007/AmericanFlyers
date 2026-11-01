// First-ride setup: three quick steps the first time someone rides. About
// you (weight, FTP, max heart rate), your trainer, then your first ride.

import { markDone } from './onboardingState';
import type { Settings } from './settings';

interface Options {
  settings: () => Settings;
  save: (patch: Partial<Settings>) => void;
  connectTrainer: () => Promise<boolean>;
  connectHeartRate: () => Promise<boolean>;
  bluetooth: boolean;
  startDemo: () => void;
  rampTest: () => void;
  rideStage: (id: string) => void;
  openPlans: () => void;
}

export function initOnboarding(o: Options) {
  const dialog = document.getElementById('onboarding') as HTMLDialogElement;
  const steps = [...dialog.querySelectorAll<HTMLElement>('.ob-step')];
  const dots = [...dialog.querySelectorAll<HTMLElement>('.ob-dots span')];
  const form = dialog.querySelector('form')!;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  let step = 0;

  function show(n: number) {
    step = n;
    steps.forEach((s, i) => (s.hidden = i !== n));
    dots.forEach((d, i) => d.classList.toggle('on', i <= n));
  }

  function fill() {
    const s = o.settings();
    field('ob-weight').value = String(s.riderKg);
    field('ob-ftp').value = String(s.ftp);
    field('ob-maxhr').value = String(s.maxHr);
    field('ob-age').value = '';
    field('ob-units').value = s.units;
  }

  function saveAboutYou() {
    const num = (name: string, lo: number, hi: number, fallback: number) => {
      const v = Number(field(name).value);
      return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
    };
    const s = o.settings();
    const units = field('ob-units').value === 'imperial' ? 'imperial' : 'metric';
    o.save({
      riderKg: num('ob-weight', 30, 200, s.riderKg),
      ftp: Math.round(num('ob-ftp', 50, 600, s.ftp)),
      maxHr: Math.round(num('ob-maxhr', 120, 230, s.maxHr)),
      units,
    });
  }

  // "I don't know my FTP": a sensible guess from weight (≈2.6 W/kg).
  document.getElementById('ob-ftp-guess')!.addEventListener('click', () => {
    const kg = Number(field('ob-weight').value) || o.settings().riderKg;
    field('ob-ftp').value = String(Math.round((kg * 2.6) / 5) * 5);
    document.getElementById('ob-ftp-note')!.textContent = 'A starting guess. The Ramp FTP Test (step 3) measures it properly.';
  });
  field('ob-age').addEventListener('input', () => {
    const age = Number(field('ob-age').value);
    if (age >= 10 && age <= 100) field('ob-maxhr').value = String(Math.round(208 - 0.7 * age));
  });

  const status = document.getElementById('ob-device-status')!;
  const trainerBtn = document.getElementById('ob-trainer') as HTMLButtonElement;
  const hrBtn = document.getElementById('ob-hr') as HTMLButtonElement;
  if (!o.bluetooth) {
    trainerBtn.disabled = hrBtn.disabled = true;
    status.textContent = 'This browser can’t use Bluetooth. Open American Flyers in Chrome or Edge on a computer or Android (or Bluefy on iPhone/iPad) to connect your trainer. You can still try a demo ride.';
  }
  trainerBtn.addEventListener('click', async () => {
    if (await o.connectTrainer()) {
      trainerBtn.textContent = '✓ Trainer connected';
      status.textContent = 'Great! Your trainer will follow the road, or hold the target power in workouts. It’s remembered on this browser, so next time it reconnects (or is one tap away in the ☰ Menu).';
    }
  });
  hrBtn.addEventListener('click', async () => {
    if (await o.connectHeartRate()) { hrBtn.textContent = '✓ Heart rate connected'; if (!trainerBtn.textContent!.startsWith('✓')) status.textContent = 'Heart rate strap connected and remembered on this browser.'; }
  });

  dialog.querySelectorAll<HTMLButtonElement>('[data-ob-next]').forEach((b) => b.addEventListener('click', () => {
    if (step === 0) saveAboutYou();
    show(step + 1);
  }));
  dialog.querySelectorAll<HTMLButtonElement>('[data-ob-back]').forEach((b) => b.addEventListener('click', () => show(step - 1)));

  const finish = (then: () => void) => () => {
    markDone();
    dialog.close();
    then();
  };
  document.getElementById('ob-ramp')!.addEventListener('click', finish(o.rampTest));
  document.getElementById('ob-hotw')!.addEventListener('click', finish(() => o.rideStage('hell-of-the-west')));
  document.getElementById('ob-free')!.addEventListener('click', finish(() => o.rideStage('heartland')));
  document.getElementById('ob-plan')!.addEventListener('click', finish(o.openPlans));
  document.getElementById('ob-demo')!.addEventListener('click', finish(o.startDemo));
  document.getElementById('ob-skip')!.addEventListener('click', finish(() => {}));
  dialog.addEventListener('cancel', markDone); // Escape: don't nag again

  return {
    open() {
      fill();
      show(0);
      if (!dialog.open) dialog.showModal();
    },
  };
}
