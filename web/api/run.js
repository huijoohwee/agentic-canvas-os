// Vercel serverless route (PRIMARY host): POST /api/run → verify the session
// token, validate the request, and forward knowgrph.video_remix.run to the
// knowgrph control plane over MCP. Thin adapter over the platform-neutral core.

import { handleRun } from "./_runtime.js";

export default function handler(req, res) {
  return handleRun(req, res);
}
