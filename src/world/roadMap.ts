import { RAGGED_ROW, ROAD_TEX_WIDTH, raggedEdge, type RoadPaintLayout } from './roadStyle';

// Paints the road's colour map from a style's layout (roadStyle.ts): the asphalt
// photo (or a flat grey until it loads) with a tint, repairs, the edge bands or
// ragged lane edges, then the painted lines and their wear.

/** Draws the colour map into `g`, a canvas `ROAD_TEX_WIDTH` × `layout.height` texels. */
export function drawRoadMap(g: CanvasRenderingContext2D, layout: RoadPaintLayout, asphalt?: CanvasImageSource) {
  const W = ROAD_TEX_WIDTH;
  const H = layout.height;
  if (asphalt) {
    // The photo tiled in 256 px squares (the heights are multiples of 256, so it tiles cleanly along the repeat too).
    for (let x = 0; x < W; x += 256) for (let y = 0; y < H; y += 256) g.drawImage(asphalt, x, y, 256, 256);
  } else {
    g.fillStyle = layout.fallback;
    g.fillRect(0, 0, W, H);
  }
  if (layout.tint) {
    g.fillStyle = layout.tint;
    g.fillRect(0, 0, W, H);
  }
  fill(g, layout.surface);
  if (layout.edge) {
    for (const b of layout.edge.bands) {
      g.fillStyle = b.color;
      g.fillRect(b.from, 0, b.to - b.from, H);
      g.fillRect(W - b.to, 0, b.to - b.from, H);
    }
  }
  if (layout.ragged) {
    g.fillStyle = layout.ragged.color;
    for (const side of [0, 1] as const) {
      raggedEdge(layout, side).forEach((w, r) => g.fillRect(side === 0 ? 0 : W - w, r * RAGGED_ROW, w, RAGGED_ROW));
    }
  }
  fill(g, layout.paint);
  fill(g, layout.wear);
}

function fill(g: CanvasRenderingContext2D, marks: RoadPaintLayout['paint']) {
  for (const m of marks) {
    g.fillStyle = m.color;
    g.fillRect(m.x, m.y, m.w, m.h);
  }
}
