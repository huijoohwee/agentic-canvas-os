// Canvas transport adapter. The host supplies the admitted agentic-os/design export and policy pin.
const registrations = new WeakMap();
export const DESIGN_TOOL_NAME = 'agentic-canvas-os.design_check';

export function createDesignContractTool({ engine, expectedPolicyDigest } = {}) {
  if (typeof engine?.checkDesignContract !== 'function' || !engine.DESIGN_INPUT_SCHEMA
    || !/^[a-f0-9]{64}$/.test(expectedPolicyDigest ?? ''))
    throw new TypeError('design-check-upstream-unadmitted: supply the admitted engine and reviewed policy pin');
  const execute = async input => {
    const result = await engine.checkDesignContract(input);
    if (result.policyDigest !== expectedPolicyDigest) return {
      ...result, ok: false, authority: false, runtimeVerified: false,
      findings: [...result.findings, { type: 'stale-evidence', reference: 'policy',
        message: "Policy pin differs from this host's reviewed policy." }],
    };
    return result;
  };
  return Object.freeze({ name: DESIGN_TOOL_NAME,
    description: 'Check supplied design owners, source bytes and joined revisions. Does not run checks or prove visual acceptance.',
    inputSchema: engine.DESIGN_INPUT_SCHEMA,
    annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }),
    execute });
}

/** Register one tool on a caller-owned WebMCP context; never clear another owner's tools. */
export function registerDesignContractTool(modelContext, options) {
  if (typeof modelContext?.registerTool !== 'function')
    throw new TypeError('design-check-webmcp-unavailable');
  if (registrations.has(modelContext)) throw new Error('design-check-already-registered');
  const tool = createDesignContractTool(options);
  const controller = new AbortController();
  modelContext.registerTool(tool, { signal: controller.signal });
  let active = true;
  const dispose = () => {
    if (!active) return;
    controller.abort();
    active = false;
    registrations.delete(modelContext);
  };
  registrations.set(modelContext, dispose);
  return dispose;
}
