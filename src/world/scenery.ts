// What each graphics tier switches on for the ground and the roadside: terrain
// textures, the road's wet look, painted words, guardrails and crowds. Pure data
// (no WebGL): quality.ts carries it in TIER_SPECS as `scenery`, so the tier table
// stays the one place that says what costs what. Round 6.

export interface SceneryTier {
  /** Terrain texture slots drawn: 3 folds dry grass and dirt into grass, and sand into sandstone (grass / rock / snow or scree, or sandstone / rock); 8 is every layer a stage can need. */
  terrainLayers: 3 | 8;
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
}

export const SCENERY: Record<'low' | 'medium' | 'high' | 'ultra', SceneryTier> = {
  low: { terrainLayers: 3, terrainTexSize: 512, detailNormals: false, roadDetail: false, triplanar: false, anisotropy: 2, crowd: 0.35, crowdFlags: false, crowdShadows: false, barriers: true, roadPaint: true },
  medium: { terrainLayers: 8, terrainTexSize: 1024, detailNormals: false, roadDetail: true, triplanar: true, anisotropy: 4, crowd: 0.7, crowdFlags: true, crowdShadows: false, barriers: true, roadPaint: true },
  high: { terrainLayers: 8, terrainTexSize: 1024, detailNormals: true, roadDetail: true, triplanar: true, anisotropy: 8, crowd: 1, crowdFlags: true, crowdShadows: true, barriers: true, roadPaint: true },
  ultra: { terrainLayers: 8, terrainTexSize: 1024, detailNormals: true, roadDetail: true, triplanar: true, anisotropy: 16, crowd: 1, crowdFlags: true, crowdShadows: true, barriers: true, roadPaint: true },
};

// The eight ground layers (terrain.ts gives each point a weight per layer; ground.ts draws them).
export const LAYER_COUNT = 8;
export const LAYER = { grass: 0, dry: 1, dirt: 2, rock: 3, snow: 4, sandstone: 5, sand: 6, scree: 7 } as const;
/**
 * Which layers a stage can show (`snow` / `scree`: its snow line / scree line is within
 * reach of the road). Low has three slots: grass and rock plus the one top layer (scree
 * wins over snow there; no stage has both).
 */
export function layersFor(desert: boolean, snow: boolean, tierLayers: 3 | 8, scree = false): number[] {
  if (tierLayers === 3) return desert ? [LAYER.sandstone, LAYER.rock] : scree ? [LAYER.grass, LAYER.rock, LAYER.scree] : snow ? [LAYER.grass, LAYER.rock, LAYER.snow] : [LAYER.grass, LAYER.rock];
  if (desert) return [LAYER.dry, LAYER.dirt, LAYER.rock, LAYER.sandstone, LAYER.sand];
  const out: number[] = [LAYER.grass, LAYER.dry, LAYER.dirt, LAYER.rock];
  if (snow) out.push(LAYER.snow);
  if (scree) out.push(LAYER.scree);
  return out;
}
