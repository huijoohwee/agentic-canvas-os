import { aggregateCosts, withDeadline } from "./running-agent-contract.js";
import {
  AGENT_ORCHESTRATION_DEFAULTS,
  ORCHESTRATION_MODES,
  AgentOrchestrationBlock,
  assertIdentifier,
  assertPositiveInteger,
  normalizeAgentOutcome,
  normalizeAuthorization,
  normalizeResolvedAgent,
  normalizeRunRequest,
  normalizeWorkflow,
} from "./agent-orchestration-contract.js";

export function createAgentOrchestrationRuntime({
  resolveAgent,
  runAgent,
  authorize,
  ...limitOverrides
} = {}) {
  const limits = { ...AGENT_ORCHESTRATION_DEFAULTS, ...limitOverrides };
  for (const [field, value] of Object.entries(limits)) assertPositiveInteger(value, field);
  for (const [field, value] of Object.entries({ resolveAgent, runAgent, authorize })) {
    if (value !== undefined && typeof value !== "function") throw new TypeError(`${field} must be a function when provided.`);
  }
  const configured = Boolean(resolveAgent && runAgent && authorize);
  const workflows = new Map();
  const conversations = new Map();
  const activeRuns = new Set();
  const activeConversations = new Set();
  const reservedConversations = new Set();
  const recentRuns = new Map();
  let completedRuns = 0;
  let blockedRuns = 0;
  let delegatedRuns = 0;
  let handedOffRuns = 0;
  let agentCalls = 0;

  function workflowKey(workflowId, revision) {
    return `${workflowId}\u0000${revision}`;
  }

  function register(value) {
    const workflow = normalizeWorkflow(value, limits);
    const key = workflowKey(workflow.workflowId, workflow.revision);
    const existing = workflows.get(key);
    if (existing) {
      if (JSON.stringify(publicWorkflow(existing)) !== JSON.stringify(publicWorkflow(workflow))) {
        throw new AgentOrchestrationBlock("workflow_revision_conflict", "Workflow revision already has different content.");
      }
      return publicWorkflow(existing);
    }
    if (workflows.size >= limits.maxWorkflows) {
      throw new AgentOrchestrationBlock("workflow_capacity", `Workflow capacity is ${limits.maxWorkflows}.`);
    }
    workflows.set(key, workflow);
    return publicWorkflow(workflow);
  }

  function publicWorkflow(workflow) {
    return Object.freeze({
      workflowId: workflow.workflowId,
      revision: workflow.revision,
      manager: workflow.manager,
      specialists: workflow.specialists,
      branches: workflow.branches,
    });
  }

  function blocked(safe, reasonCode, message, costLogs = [], attemptedCalls = 0) {
    blockedRuns += 1;
    return Object.freeze({
      status: "blocked",
      stage: "orchestrate",
      runId: safe.runId,
      conversationId: safe.conversationId,
      reasonCode,
      message,
      cost: aggregateCosts(costLogs, attemptedCalls),
    });
  }

  function rememberRun(runId) {
    recentRuns.delete(runId);
    recentRuns.set(runId, true);
    while (recentRuns.size > limits.maxConversations * 4) recentRuns.delete(recentRuns.keys().next().value);
  }

  function touchConversation(conversationId, record) {
    conversations.delete(conversationId);
    conversations.set(conversationId, record);
  }

  function reserveConversation(conversationId, prior) {
    if (prior) return true;
    if (conversations.size + reservedConversations.size >= limits.maxConversations) return false;
    reservedConversations.add(conversationId);
    return true;
  }

  async function boundedCall(operation, signal) {
    const controller = new AbortController();
    return withDeadline(() => operation(controller.signal), signal, limits.timeoutMs, controller);
  }

  async function resolve(reference, workflow, signal) {
    let raw;
    try {
      raw = await boundedCall((callSignal) => resolveAgent({
        agent: reference,
        workflow: Object.freeze({ workflowId: workflow.workflowId, revision: workflow.revision }),
        signal: callSignal,
      }), signal);
    } catch (error) {
      if (error instanceof AgentOrchestrationBlock) throw error;
      throw new AgentOrchestrationBlock("agent_resolution_failed", "Agent resolution failed.");
    }
    try {
      return normalizeResolvedAgent(raw, reference);
    } catch (error) {
      if (error instanceof AgentOrchestrationBlock) throw error;
      throw new AgentOrchestrationBlock("agent_resolution_invalid", "Agent resolution returned invalid evidence.");
    }
  }

  async function callAgent({ reference, role, input, safe, workflow, branch, signal, costLogs }) {
    agentCalls += 1;
    let raw;
    try {
      raw = await boundedCall((callSignal) => runAgent({
        runId: safe.runId,
        conversationId: safe.conversationId,
        workflow: Object.freeze({ workflowId: workflow.workflowId, revision: workflow.revision }),
        branch: Object.freeze({ branchId: branch.branchId, mode: branch.mode }),
        agent: reference,
        role,
        input,
        signal: callSignal,
      }), signal);
    } catch (error) {
      if (error instanceof AgentOrchestrationBlock) throw error;
      throw new AgentOrchestrationBlock("agent_run_failed", "An orchestration agent run failed.");
    }
    let outcome;
    try {
      outcome = normalizeAgentOutcome(raw, limits.maxOutputChars);
    } catch (error) {
      if (error instanceof AgentOrchestrationBlock) throw error;
      throw new AgentOrchestrationBlock("agent_outcome_invalid", "An orchestration agent returned an invalid outcome.");
    }
    costLogs.push(outcome.costLog);
    return outcome.output;
  }

  async function run(value = {}) {
    const safe = normalizeRunRequest(value, limits.maxInputChars);
    const costLogs = [];
    let attemptedCalls = 0;
    if (!configured) return blocked(safe, "runtime_unconfigured", "Resolver, runner, and authorizer are required.");
    const workflow = workflows.get(workflowKey(safe.workflowId, safe.workflowRevision));
    if (!workflow) return blocked(safe, "workflow_missing", "The exact workflow revision is not registered.");
    const branch = workflow.branches.find((candidate) => candidate.branchId === safe.branchId);
    if (!branch) return blocked(safe, "branch_missing", "The requested workflow branch is not registered.");
    if (activeRuns.has(safe.runId) || recentRuns.has(safe.runId)) {
      return blocked(safe, activeRuns.has(safe.runId) ? "run_active" : "run_reused", "The run identity is unavailable.");
    }
    if (activeConversations.has(safe.conversationId)) {
      return blocked(safe, "conversation_active", "The conversation already has an active orchestration run.");
    }
    const prior = conversations.get(safe.conversationId);
    const expectedSource = prior?.ownerAgentId || workflow.manager.agentId;
    if (prior && (prior.workflowId !== workflow.workflowId || prior.revision !== workflow.revision)) {
      return blocked(safe, "conversation_workflow_mismatch", "Conversation ownership belongs to another workflow revision.");
    }
    if (branch.sourceAgentId !== expectedSource) {
      return blocked(safe, "conversation_owner_mismatch", "The branch source does not own the conversation.");
    }
    if (!reserveConversation(safe.conversationId, prior)) {
      return blocked(safe, "conversation_capacity", "No inactive conversation slot is available.");
    }

    activeRuns.add(safe.runId);
    activeConversations.add(safe.conversationId);
    rememberRun(safe.runId);
    try {
      let approval;
      try {
        approval = normalizeAuthorization(await boundedCall((callSignal) => authorize(Object.freeze({
          action: branch.mode === "delegate" ? "agent.delegate" : "conversation.handoff",
          runId: safe.runId,
          conversationId: safe.conversationId,
          workflowId: workflow.workflowId,
          workflowRevision: workflow.revision,
          branch,
          input: safe.input,
          signal: callSignal,
        })), safe.signal));
      } catch (error) {
        if (error instanceof AgentOrchestrationBlock) throw error;
        throw new AgentOrchestrationBlock("authorization_failed", "Application authorization failed.");
      }
      const source = workflow.participants.get(branch.sourceAgentId);
      const target = workflow.participants.get(branch.targetAgentId);
      await Promise.all([
        resolve(source, workflow, safe.signal),
        resolve(target, workflow, safe.signal),
      ]);

      let output;
      if (branch.mode === "delegate") {
        attemptedCalls += 1;
        const specialistOutput = await callAgent({
          reference: target,
          role: "behind-manager",
          input: Object.freeze({
            kind: "specialist-task",
            userInput: safe.input,
            responsibility: target.responsibility,
            returnToAgentId: source.agentId,
          }),
          safe,
          workflow,
          branch,
          signal: safe.signal,
          costLogs,
        });
        attemptedCalls += 1;
        output = await callAgent({
          reference: source,
          role: "user-facing-manager",
          input: Object.freeze({
            kind: "manager-synthesis",
            userInput: safe.input,
            specialist: Object.freeze({
              agentId: target.agentId,
              responsibility: target.responsibility,
              output: specialistOutput,
            }),
          }),
          safe,
          workflow,
          branch,
          signal: safe.signal,
          costLogs,
        });
        delegatedRuns += 1;
      } else {
        attemptedCalls += 1;
        output = await callAgent({
          reference: target,
          role: "user-facing-owner",
          input: Object.freeze({
            kind: "conversation-handoff",
            userInput: safe.input,
            fromAgentId: source.agentId,
            responsibility: target.responsibility || "workflow-manager",
          }),
          safe,
          workflow,
          branch,
          signal: safe.signal,
          costLogs,
        });
        handedOffRuns += 1;
      }
      const owner = workflow.participants.get(branch.conversationOwnerAgentId);
      touchConversation(safe.conversationId, {
        workflowId: workflow.workflowId,
        revision: workflow.revision,
        ownerAgentId: owner.agentId,
      });
      completedRuns += 1;
      return Object.freeze({
        status: "completed",
        stage: "orchestrate",
        runId: safe.runId,
        conversationId: safe.conversationId,
        workflow: Object.freeze({ workflowId: workflow.workflowId, revision: workflow.revision }),
        branch: Object.freeze({
          branchId: branch.branchId,
          mode: branch.mode,
          sourceAgentId: branch.sourceAgentId,
          targetAgentId: branch.targetAgentId,
        }),
        conversationOwner: Object.freeze({ agentId: owner.agentId, revision: owner.revision }),
        finalAnswerOwner: Object.freeze({ agentId: owner.agentId, revision: owner.revision }),
        output,
        approval,
        cost: aggregateCosts(costLogs, attemptedCalls),
        evidence: Object.freeze({
          agentCalls: attemptedCalls,
          specialistStayedBehindManager: branch.mode === "delegate",
          conversationTransferred: branch.mode === "handoff",
          intermediateSpecialistOutputReturned: false,
          providerExecutionStatus: "adapter-attested",
        }),
      });
    } catch (error) {
      const safeError = error instanceof AgentOrchestrationBlock
        ? error
        : new AgentOrchestrationBlock("orchestration_failed", "Agent orchestration failed.");
      return blocked(safe, safeError.reasonCode, safeError.message, costLogs, attemptedCalls);
    } finally {
      activeRuns.delete(safe.runId);
      activeConversations.delete(safe.conversationId);
      reservedConversations.delete(safe.conversationId);
    }
  }

  return Object.freeze({
    register,
    run,
    owner(conversationId) {
      const record = conversations.get(assertIdentifier(conversationId, "conversationId"));
      if (!record) return null;
      const workflow = workflows.get(workflowKey(record.workflowId, record.revision));
      const agent = workflow?.participants.get(record.ownerAgentId);
      return agent ? Object.freeze({ agentId: agent.agentId, revision: agent.revision }) : null;
    },
    clearConversation(conversationId) {
      const safeConversationId = assertIdentifier(conversationId, "conversationId");
      if (activeConversations.has(safeConversationId)) throw new TypeError("An active conversation cannot be cleared.");
      return conversations.delete(safeConversationId);
    },
    stats: () => Object.freeze({
      configured,
      agentResolverConfigured: Boolean(resolveAgent),
      agentRunnerConfigured: Boolean(runAgent),
      authorizerConfigured: Boolean(authorize),
      workflows: workflows.size,
      conversations: conversations.size,
      activeRuns: activeRuns.size,
      completedRuns,
      blockedRuns,
      delegatedRuns,
      handedOffRuns,
      agentCalls,
      modes: ORCHESTRATION_MODES,
      ...limits,
    }),
  });
}
