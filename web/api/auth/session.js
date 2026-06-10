// Vercel serverless route (PRIMARY host): POST /api/auth/session → mint a
// stateless session token. Thin adapter over the platform-neutral app core.

import { handleAuthSession } from "../_runtime.js";

export default function handler(req, res) {
  return handleAuthSession(req, res);
}
