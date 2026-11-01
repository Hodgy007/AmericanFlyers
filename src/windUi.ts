// The wind readout in the status bar: an arrow showing which way the wind is
// blowing relative to your heading, its speed, and "headwind", "tailwind" or
// "crosswind from the left" in words.

import { headingAt } from './course';
import { describeWind, wind } from './world/wind';

const KM_PER_MI = 1.609344;

export function initWindUi(chip: HTMLElement, arrow: HTMLElement, text: HTMLElement) {
  let shown = '';
  return {
    update(distance: number, imperial: boolean) {
      if (!wind.enabled) { chip.hidden = true; return; }
      const heading = headingAt(distance);
      const { head, cross } = wind.at(heading);
      const speed = wind.speed;
      const d = describeWind(speed, head, cross);
      const unit = imperial ? 'mph' : 'km/h';
      const v = Math.round((speed * 3.6) / (imperial ? KM_PER_MI : 1));
      // The arrow points the way the wind blows, with "up" being the way you ride.
      const deg = Math.round((Math.atan2(cross, -head) * 180) / Math.PI);
      const label = d.kind === 'calm' ? 'Calm' : `${d.text} · ${v} ${unit}`;
      const key = `${deg}|${label}`;
      chip.hidden = false;
      if (key === shown) return;
      shown = key;
      arrow.style.transform = `rotate(${deg}deg)`;
      arrow.style.opacity = d.kind === 'calm' ? '0.3' : '1';
      text.textContent = label;
      chip.dataset.kind = d.kind;
      chip.title = `${label}. The arrow shows where the wind is blowing to, with up the way you ride. Wind switches off in Settings.`;
    },
  };
}
