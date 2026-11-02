import { currentStage } from '../course';

/**
 * 0..1: how thickly crowds line the road at course distance `d`: the hairpins of
 * the climbs and the last few hundred metres. One place for the numbers: the
 * sound's crowd roar (main.ts) and the spectators drawn beside the road
 * (crowds.ts) both read it.
 */
export function crowdNear(d: number): number {
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
