// What each graphics tier switches on for the ground and the roadside: terrain
// textures, the road's wet look, painted words, guardrails and crowds. Pure data
// (no WebGL): quality.ts carries it in TIER_SPECS as `scenery`, so the tier table
// stays the one place that says what costs what. Round 6.

export interface SceneryTier {
  /** Terrain texture slots drawn: 3 folds dry grass and dirt into grass, and sand into sandstone (grass / rock / snow, or sandstone / rock). */
  terrainLayers: 3 | 7;
  /** Side of the terrain textures in the GPU, px (the files are 1K; Low shrinks them as they decode). */
  terrainTexSize: 512 | 1024;
  /** Detail normal maps on the terrain (and the road's asphalt normal map). */
  detailNormals: boolean;
  /** The road's asphalt normal and roughness maps (fetched lazily). */
  roadDetail: boolean;
  /** Triplanar rock on cliffs; off, rock is projected along the dominant horizontal axis only. */
  triplanar: boolean;
  /** Anisotropic filtering cap for the ground and the road. */
  anisotropy: number;
  /** Share of the full crowd that is drawn: 0 off. Spectators are placed deterministically, so a lower share just thins them out. */
  crowd: number;
  /** Some spectators wave flags. */
  crowdFlags: boolean;
  /** Spectators cast shadows. */
  crowdShadows: boolean;
  /** Guardrails on hairpins and along steep drops. */
  barriers: boolean;
  /** Words and symbols painted on the road on the big climbs. */
  roadPaint: boolean;
  /** Ground cover beside the road (grass tufts, wildflowers, stones; groundCover.ts): the share of full density, 0 off. The module is only fetched when this is above 0. */
  groundCover: 0 | 0.5 | 1;
}

export const SCENERY: Record<'low' | 'medium' | 'high' | 'ultra', SceneryTier> = {
  low: { terrainLayers: 3, terrainTexSize: 512, detailNormals: false, roadDetail: false, triplanar: false, anisotropy: 2, crowd: 0.35, crowdFlags: false, crowdShadows: false, barriers: true, roadPaint: true, groundCover: 0 },
  medium: { terrainLayers: 7, terrainTexSize: 1024, detailNormals: false, roadDetail: true, triplanar: true, anisotropy: 4, crowd: 0.7, crowdFlags: true, crowdShadows: false, barriers: true, roadPaint: true, groundCover: 0 },
  high: { terrainLayers: 7, terrainTexSize: 1024, detailNormals: true, roadDetail: true, triplanar: true, anisotropy: 8, crowd: 1, crowdFlags: true, crowdShadows: true, barriers: true, roadPaint: true, groundCover: 0.5 },
  ultra: { terrainLayers: 7, terrainTexSize: 1024, detailNormals: true, roadDetail: true, triplanar: true, anisotropy: 16, crowd: 1, crowdFlags: true, crowdShadows: true, barriers: true, roadPaint: true, groundCover: 1 },
};

// The seven ground layers (terrain.ts gives each point a weight per layer; ground.ts draws them).
export const LAYER_COUNT = 7;
export const LAYER = { grass: 0, dry: 1, dirt: 2, rock: 3, snow: 4, sandstone: 5, sand: 6 } as const;
/** Which layers a stage can show (`snow`: its snow line is within reach of the road). */
export function layersFor(desert: boolean, snow: boolean, tierLayers: 3 | 7): number[] {
  if (tierLayers === 3) return desert ? [LAYER.sandstone, LAYER.rock] : snow ? [LAYER.grass, LAYER.rock, LAYER.snow] : [LAYER.grass, LAYER.rock];
  return desert ? [LAYER.dry, LAYER.dirt, LAYER.rock, LAYER.sandstone, LAYER.sand] : snow ? [LAYER.grass, LAYER.dry, LAYER.dirt, LAYER.rock, LAYER.snow] : [LAYER.grass, LAYER.dry, LAYER.dirt, LAYER.rock];
}

