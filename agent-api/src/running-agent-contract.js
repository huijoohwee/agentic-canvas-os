// Native runtime owner; this path remains only for existing callers.
export {
  ADAPTER_EVENT_TYPES,
  CONTINUATION_STRATEGIES,
  RUNNING_AGENT_DEFAULTS,
  RunningAgentBlock,
  aggregateCosts,
  assertIdentifier,
  assertPositiveInteger,
  continuationMatches,
  createEventChannel,
  defaultResumeToken,
  normalizeAdapterResponse,
  normalizeBoundedJson,
  normalizeContinuation,
  normalizeCostLog,
  withDeadline
} from 'agentic-os/agents/running-contract';
