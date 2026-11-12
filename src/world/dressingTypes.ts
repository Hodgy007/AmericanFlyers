// What a world asks the roadside to be dressed with, apart from landmarks: dry-stone field walls and strings of bunting. Data only (no three.js), so
// stages.ts can carry it in `Scenery.dressing`; the planners are fieldWalls.ts and bunting.ts, drawn per road chunk by roadExtras.ts.

/** Dry-stone walls round the fields beside the road: parallel to it, with cross walls between the fields, gates, and gaps where something else stands. */
export interface FieldWallSpec {
  /** Lap-metre ranges [from, to] of road that has fields on both sides. */
  spans: [number, number][];
  /** True where no wall may stand, by world position (x east, z south, the route's own frame): the lake, the beck, another stretch of road. `lateral` is how far from its own road the planner is laying this section. */
  blocked?(x: number, z: number, lateral: number): boolean;
}

/** Strings of bunting across a street, from one facade to the other. */
export interface BuntingSpec {
  /** Lap-metre ranges [from, to]: a string hangs at `from`, then every `spacing` metres up to `to`. */
  spans: [number, number][];
  spacing: number;
  /** Lateral distance of each facade from the road's centreline, m, and the height the string is tied at above the road. */
  half: number;
  height: number;
}

export interface Dressing {
  /** The world's lap metre that route distance `d` stands at (a route that starts partway round the lap is shifted), so a kit's hashed layout is the same on every route. */
  lap(d: number): number;
  /** The world's lap, m. */
  lapLength: number;
  fieldWalls?: FieldWallSpec;
  bunting?: BuntingSpec;
}
