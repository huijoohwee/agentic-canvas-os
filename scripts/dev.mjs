import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveObservabilityWorkspace, observabilityDevPlan, runObservabilityDev } from '../web/observability-workspace.mjs';

try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const workspace = resolveObservabilityWorkspace(root);
  const plan = observabilityDevPlan(workspace, process.argv.slice(2));
  console.log(`Starting native Graph observability: ${plan.url}`);
  console.log(`Local preview source: ${workspace.sourceRevision}; dirty=${workspace.sourceDirty}. This is not protected release proof.`);
  console.log(`Graph checkout: ${path.resolve(workspace.graphRoot)}`);
  process.exitCode = await runObservabilityDev(plan);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
