// The stages and worlds that have banner art: ids (a stage's id, or a world's id for its one card) whose picture is
// in public/images/stages/<id>.webp. GENERATED: do not edit; regenerate with `npm run stageart:sync` after adding
// pictures. Only ids in this set are fetched, so a missing picture is never a 404 (see hub/sections/route.ts).

export const STAGE_ART: ReadonlySet<string> = new Set<string>([
]);

/** Where a stage's (or world's) banner is served from. */
export const stageArtUrl = (id: string) => `/images/stages/${id}.webp`;
