// Host-injected, same-realm Graph WebMCP transport. No network or mutation capability.
// Supply getAgenticGraphWebMcpToolRegistry() and the admitted contracts' webName values.
const failure = (code, message) => ({ ok: false, code, message });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const copy = value => freeze(structuredClone(value));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function createSpatialWorkspaceClient({ registry, toolNames, signal } = {}) {
  const names = { inspect: toolNames?.inspect, preview: toolNames?.preview };
  const tools = Object.fromEntries(Object.entries(names).map(([key, name]) =>
    [key, typeof name === 'string' && typeof registry?.get === 'function' ? registry.get(name) : null]));
  let active = !signal?.aborted, busy = false, inspection = null, session = null;
  const dispose = () => { active = false; inspection = null; signal?.removeEventListener('abort', dispose); };
  signal?.addEventListener('abort', dispose, { once: true });
  const unavailable = () => {
    if (!active) return failure('cancelled', 'Canvas session closed. A preview already submitted may remain in Graph for operator review.');
    if (typeof registry?.execute !== 'function' || names.inspect === names.preview
      || Object.keys(names).some(key => !tools[key]?.inputSchema || typeof tools[key]?.execute !== 'function'
        || registry.get(names[key]) !== tools[key]))
      return failure('transport-unavailable', 'Bind this Canvas client to the active Graph browser registry and its admitted tool catalog.');
    return null;
  };
  const invoke = async (operation, input, accept) => {
    const blocked = unavailable();
    if (blocked) return blocked;
    if (busy) return failure('busy', 'Wait for the current browser request to finish.');
    busy = true;
    try {
      const result = await registry.execute(names[operation], input);
      const ended = unavailable();
      if (ended) return ended;
      return accept(result);
    } catch {
      inspection = null;
      return unavailable() || failure('transport-failed', 'Graph browser request failed. Inspect the active scene before retrying.');
    } finally { busy = false; }
  };
  return Object.freeze({
    inspect: () => invoke('inspect', {}, result => {
      inspection = null;
      const scene = result?.spatialWorkspace;
      if (scene?.ok === false) return copy(scene);
      const identity = scene?.identity;
      if (scene?.ok !== true || identity?.implementation !== 'agentic-graph.spatial-review/v1'
        || !digest(identity.token) || !digest(identity.sourceDigest) || !digest(identity.sceneDigest)
        || typeof identity.documentName !== 'string' || !identity.documentName
        || typeof identity.session !== 'string' || !identity.session)
        return failure('contract-unavailable', 'The bound Graph runtime does not expose revision-bound spatial review.');
      if (session && session !== identity.session) { dispose(); return failure('session-changed', 'Reconnect Canvas to the current Graph browser session.'); }
      session = identity.session;
      inspection = copy(scene);
      return inspection;
    }),
    preview: input => {
      if (!input || Object.keys(input).some(key => !['inspection', 'edits'].includes(key)))
        return Promise.resolve(failure('invalid-input', 'Supply an inspection and edits only. Approval and execution flags are not accepted.'));
      if (!inspection || input.inspection !== inspection)
        return Promise.resolve(failure('stale-inspection', 'Inspect through this Canvas session before requesting a preview.'));
      const observed = inspection;
      // Graph owns edit/schema validation, source fencing, the pending proposal and operator approval.
      return invoke('preview', { action: 'preview', expectedToken: observed.identity.token, edits: input.edits }, result => {
        inspection = null;
        if (result?.ok === false) return copy(result);
        if (result?.ok !== true || result.proposal?.sourceToken !== observed.identity.token
          || result.proposal?.documentName !== observed.identity.documentName || !digest(result.proposal?.digest))
          return failure('invalid-response', 'The preview does not match the inspected document. Inspect Graph before continuing.');
        return copy(result);
      });
    },
    dispose,
  });
}
