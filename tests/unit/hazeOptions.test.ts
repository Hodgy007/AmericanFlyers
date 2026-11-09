import { describe, expect, it } from 'vitest';
import { STAGES, stageById } from '../../src/stages';

// The Tour of the Moon looked paler on High than on Low: the post chain blends haze in linear HDR and its sky
// environment lights shaded rock. Two stage options fix that for this stage only.
describe('haze options', () => {
  it('the Tour of the Moon blends haze as Low does and dims the sky environment', () => {
    const s = stageById('hotw-tour-of-the-moon').scenery;
    expect(s.directHaze).toBe(true);
    expect(s.skyLight).toBeGreaterThan(0);
    expect(s.skyLight).toBeLessThan(1);
  });

  it('no other stage sets them, so their High and Ultra look is unchanged', () => {
    for (const st of STAGES.filter((x) => x.id !== 'hotw-tour-of-the-moon')) {
      expect(st.scenery.directHaze, st.id).toBeUndefined();
      expect(st.scenery.skyLight, st.id).toBeUndefined();
    }
  });
});
