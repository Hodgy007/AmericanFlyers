// The whole stages the coach may suggest after a ride (stages with a finish line, not the tour's linked stages):
// plain data, because the Vercel function imports this and src/stages.ts pulls in the 3D world. Kept in step with
// src/stages.ts by tests/unit/aiServerImports.test.ts, which prints the rows to paste when a stage is added or changed.

export const STAGE_SUGGESTIONS: readonly { id: string; name: string; about: string }[] = [
  { id: 'route66', name: 'Route 66 Flats', about: '25.0 km. 25 km of fast, flat highway past diners and gas stations. A time-trial.' },
  { id: 'alpe-dhuez', name: 'Alpe d\'Huez', about: '14.0 km. 14 km at 8% from Le Bourg-d\'Oisans, up all 21 hairpins. Real gradients.' },
  { id: 'stelvio', name: 'Stelvio Pass', about: '24.5 km. 24.5 km at 7.5% from Prato to 2758 m, through 48 numbered hairpins.' },
  { id: 'ventoux', name: 'Mont Ventoux', about: '21.4 km. 21.4 km at 7.5% from Bédoin: the forest at 9–10%, then the bare white moonscape to 1,910 m.' },
  { id: 'tourmalet', name: 'Col du Tourmalet', about: '19.0 km. 19 km at 7.4% from Luz-Saint-Sauveur, through Barèges and the hairpins to 2,115 m.' },
  { id: 'zoncolan', name: 'Monte Zoncolan', about: '10.1 km. 10.1 km at 11.9% from Ovaro, with ramps over 20%. The hardest climb in Italy.' },
  { id: 'mt-washington', name: 'Mount Washington Auto Road', about: '12.2 km. 7.6 miles at 12% from the Glen House to the summit of New England, with the last pitch at 22%. Cloud, wind and bare rock above the ' },
  { id: 'mt-blue-sky', name: 'Mount Blue Sky', about: '23.3 km. 14.5 miles from Echo Lake Lodge, where the Hell of the West stops, up the highest paved road in North America to 14,130 ft.' },
  { id: 'mt-diablo', name: 'Mount Diablo', about: '18.0 km. 11.2 miles from Danville through South Gate to the stone summit tower, over golden grass and oaks.' },
  { id: 'flagstaff', name: 'Flagstaff Mountain', about: '7.4 km. 4.6 miles at 8% up Boulder’s own climb: Flagstaff Road from Baseline, with the Flatirons beside the first switchbacks.' },
];
