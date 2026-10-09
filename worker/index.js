import { createCloudflareWorker } from "agentic-os/agents/cloudflare-worker";
import { createCommerceWorkerExtension } from "agentic-commerce-os/admission/worker-extension";
import { createSourceEvidenceExtension } from './source-evidence-extension.js';
export { createWorkerFetch } from "agentic-os/agents/cloudflare-worker";
export { CanvasRoom } from "agentic-os/agents/canvas-room";
export { AgentState } from "agentic-commerce-os/admission/agent-state";
function createCanvasWorkerExtension(input) {
  const commerce = createCommerceWorkerExtension(input);
  const sourceEvidence = createSourceEvidenceExtension(input);
  return Object.freeze({
    async handle(request, ctx) { return await sourceEvidence.handle(request, ctx) ?? commerce.handle(request, ctx); },
    async beforeReadiness() { await Promise.all([commerce.beforeReadiness(), sourceEvidence.beforeReadiness()]); },
  });
}
const worker = createCloudflareWorker({ createExtension: createCanvasWorkerExtension });
export const handleCloudflareRequest = worker.fetch;
export default worker;
// Retain the existing same-Worker authenticated release-proof entrypoint.
export const CommerceAdmissionProbe = Object.freeze({ fetch: worker.fetch });
