// Most unit tests read the built-in stages' roads (elevationAt, scenery ...) straight off `stageById()` / `STAGES`, which in the
// app arrive on demand (loadStage, src/stages.ts). Load them all before any test file runs.
import { STAGES, loadStage } from '../../src/stages';

await Promise.all(STAGES.map(loadStage));
