// Readiness reports sample the configured runtime seams on every call.
import { ADAPTER_REGISTRATION_OWNER } from "./adapter-registration.js";

export function createAgentApiReadiness({
  secret, endpoint, modelProviderEnvironment, modelProviders,
  agentDefinitions, agentOrchestration, agentRuntimeComposition, agentSwarm,
  agentToolkit, programmaticToolCalling, progressiveAgents, functionCalling,
  functionCallingManager, functionGateway, guardrailsHumanReview, openAiFunctionAdapter,
  runningAgents, sandboxAgents, toolSearch, skillProposer,
  skillRegistryGate, adapterRegistration, cacheContext, reasoningContinuity,
  autonomousRuntimeEnvironment, openAiAgentConfig, openAiAgentAdapter, agentToolkitAuthorize,
  openAiFunctionConfig,
}) {
  return () => {
    const agentDefinitionStats = agentDefinitions.stats();
    const agentOrchestrationStats = agentOrchestration.stats();
    const agentRuntimeCompositionStats = agentRuntimeComposition.stats();
    const agentSwarmStats = agentSwarm.stats();
    const agentToolkitStats = agentToolkit.stats();
    const programmaticStats = programmaticToolCalling.stats();
    const progressiveAgentStats = progressiveAgents.stats();
    const functionCallingStats = functionCalling.stats();
    const functionCallingManagerStats = functionCallingManager.stats();
    const functionGatewayStats = functionGateway.stats();
    const guardrailsHumanReviewStats = guardrailsHumanReview.stats();
    const openAiFunctionStats = openAiFunctionAdapter?.stats();
    const runningAgentStats = agentRuntimeCompositionStats.configured
      ? agentRuntimeCompositionStats.runningAgents
      : runningAgents.stats();
    const sandboxAgentStats = sandboxAgents.stats();
    const toolSearchStats = toolSearch.stats();
    const skillProposerStats = skillProposer.stats();
    const skillRegistryGateStats = skillRegistryGate.stats();
    const adapterRegistrationStats = adapterRegistration.stats();
    const modelProviderStats = modelProviders.stats();
    return {
      configured: Boolean(
        secret
        && endpoint
        && modelProviderEnvironment.ready
        && modelProviderEnvironment.apiKeyPresent
        && modelProviderStats.providers > 0
        && modelProviderStats.processDefaultConfigured
      ),
      auth: { configured: Boolean(secret) },
      controlPlane: { configured: Boolean(endpoint), endpoint },
      modelProviders: {
        configured: modelProviderEnvironment.ready
          && modelProviderEnvironment.apiKeyPresent
          && modelProviderStats.providers > 0
          && modelProviderStats.processDefaultConfigured,
        contractReady: true,
        selectionPrecedence: ["agent", "run-default", "process-default", "provider-default"],
        providerPolicy: "application-registered-revision-bound",
        transportPolicy: "feature-delivery-connection-matched",
        executionOwner: "running-agents-adapter",
        providerExecutionStatus: "unverified",
        environment: {
          configured: modelProviderEnvironment.ready,
          providerId: modelProviderEnvironment.providerId,
          providerRevision: modelProviderEnvironment.providerRevision,
          adapterId: modelProviderEnvironment.adapterId,
          endpoint: modelProviderEnvironment.endpoint,
          modelId: modelProviderEnvironment.modelId,
          apiKeyEnv: modelProviderEnvironment.apiKeyEnv,
          apiKeyPresent: modelProviderEnvironment.apiKeyPresent,
          transportId: modelProviderEnvironment.transportId,
          delivery: modelProviderEnvironment.delivery,
          connection: modelProviderEnvironment.connection,
          features: modelProviderEnvironment.features,
          issues: modelProviderEnvironment.issues,
        },
        ...modelProviderStats,
      },
      agentDefinitions: {
        configured: agentDefinitionStats.agents > 0,
        contractReady: true,
        definitionOwner: "application-agent-registry",
        requiredCore: ["source", "model", "instructions"],
        sourcePolicy: "application-verified-uri-and-sha256",
        optionalBehavior: ["tools", "guardrails", "mcp-servers", "handoffs", "structured-output"],
        capabilityPolicy: "reference-only-with-application-authorization",
        executionOwner: "running-agents-adapter",
        providerExecutionStatus: "unverified",
        statusCounts: agentDefinitionStats.statusCounts,
        snapshotDigestAlgorithm: agentDefinitionStats.snapshotDigestAlgorithm,
        ...agentDefinitionStats,
      },
      guardrailsHumanReview: {
        configured: guardrailsHumanReviewStats.guardrailEvaluatorConfigured
          && guardrailsHumanReviewStats.reviewerAuthenticatorConfigured,
        contractReady: true,
        automaticValidationOwner: "application-guardrail-evaluator",
        toolBoundaryOwner: "function-tool-gateway",
        humanReviewOwner: "application-review-gate",
        interruptionOwner: "running-agents-same-turn-state",
        reviewStatePolicy: "atomic-single-consume-bounded-expiry",
        reviewerEvidencePolicy: "purpose-scoped-signed-token",
        providerExecutionStatus: "unverified",
        ...guardrailsHumanReviewStats,
      },
      agentOrchestration: {
        configured: agentOrchestrationStats.configured,
        contractReady: true,
        topologyOwner: "application-orchestration-registry",
        definitionOwner: "agent-definitions",
        executionOwner: "running-agents-adapter",
        conversationOwnership: "branch-explicit",
        finalAnswerOwnership: "branch-explicit",
        providerExecutionStatus: "unverified",
        ...agentOrchestrationStats,
      },
      agentRuntimeComposition: {
        configured: agentRuntimeCompositionStats.configured,
        contractReady: true,
        sourceOwner: "agent-definitions",
        selectionOwner: "models-and-providers",
        lifecycleOwner: "running-agents",
        orchestrationInterfaces: ["resolve-agent", "run-agent"],
        outputValidationOwner: "agent-definitions",
        providerExecutionStatus: "unverified",
        ...agentRuntimeCompositionStats,
      },
      autonomousRuntime: {
        configured: autonomousRuntimeEnvironment.ready && agentRuntimeCompositionStats.configured,
        enabled: autonomousRuntimeEnvironment.enabled,
        contractReady: true,
        route: autonomousRuntimeEnvironment.route,
        auth: autonomousRuntimeEnvironment.auth,
        spendApproved: autonomousRuntimeEnvironment.spendApproved,
        sourceVerification: autonomousRuntimeEnvironment.sourceVerification,
        sourceDigestPresent: autonomousRuntimeEnvironment.sourceDigestPresent,
        sourceDigestMatches: autonomousRuntimeEnvironment.sourceDigestMatches,
        controlPlaneConfigured: autonomousRuntimeEnvironment.controlPlaneConfigured,
        agentId: autonomousRuntimeEnvironment.agentId,
        agentRevision: autonomousRuntimeEnvironment.agentRevision,
        adapterId: autonomousRuntimeEnvironment.adapterId,
        maxProviderCalls: autonomousRuntimeEnvironment.maxProviderCalls,
        maxOutputTokens: openAiAgentConfig.maxOutputTokens,
        providerExecutionStatus: "unverified",
        issues: autonomousRuntimeEnvironment.issues,
        adapter: openAiAgentAdapter?.stats() || Object.freeze({ configured: false }),
      },
      agentSwarm: {
        configured: agentSwarmStats.configured,
        contractReady: true,
        coordinationOwner: "agent-swarm-durable-ledger",
        taskModel: "runtime-generated-objectives-and-dependencies",
        workerModel: "stateless-ephemeral-claims",
        definitionResolutionOwner: "application-injected-agent-resolver",
        executionOwner: "application-injected-worker-adapter",
        synthesisOwner: "base-agent",
        receiptVerificationOwner: "application-injected-durable-receipt-verifier",
        mutationPolicy: "read-only-or-idempotent-with-verified-stable-key-receipt",
        runOwnership: "authenticated-session-principal",
        runDeadlinePolicy: "fixed-from-admission-with-full-lease-window",
        sessionLifetimePolicy: "must-cover-fixed-run-deadline",
        publicOutputPolicy: "base-agent-synthesis-only",
        externalRuntimeDependency: false,
        providerExecutionStatus: "unverified",
        ...agentSwarmStats,
      },
      agentToolkit: {
        configured: agentToolkitStats.configured,
        contractReady: true,
        revisionAuthorizerConfigured: typeof agentToolkitAuthorize === "function",
        observationOwner: "agent-toolkit-metadata-ledger",
        executionOwner: "existing-runtime-or-injected-adapter",
        evaluationOwner: "application-injected-revision-bound-evaluator",
        evidencePolicy: "metadata-only-no-prompts-outputs-payloads-or-private-reasoning",
        costPolicy: "one-owner-aggregate-no-nested-double-counting",
        comparisonPolicy: "same-cohort-deterministic-thresholds",
        learningPolicy: "review-pending-proposal-only-never-auto-apply",
        runOwnership: "authenticated-session-principal",
        externalRuntimeDependency: false,
        measuredImprovementStatus: "unverified",
        providerExecutionStatus: "unverified",
        productionReady: Boolean(
          agentToolkitStats.configured
          && typeof agentToolkitAuthorize === "function"
          && agentToolkitStats.evaluatorConfigured
          && agentToolkitStats.admission?.configured
          && agentToolkitStats.observability?.configured
          && agentToolkitStats.stateStore?.persistence === "durable-object"
        ),
        ...agentToolkitStats,
      },
      progressiveAgents: {
        configured: progressiveAgentStats.configured,
        contractReady: true,
        progressionPolicy: "single-agent-then-tools-then-specialists",
        definitionOwner: "agent-definitions",
        toolExecutionOwner: "function-calling-through-application-adapter",
        specialistOwner: "agent-orchestration",
        lifecycleOwner: "agent-runtime-composition",
        externalSdkDependency: false,
        providerExecutionStatus: "unverified",
        ...progressiveAgentStats,
      },
      cacheContext: {
        configured: true,
        stablePrefixOrder: "static-first-dynamic-last",
        invalidation: "revision-or-bounded-eviction",
        providerCacheStatus: "unverified",
        ...cacheContext.stats(),
      },
      reasoningContinuity: {
        configured: true,
        invariantPolicy: "goals-assumptions-priorities",
        stableMode: "all_turns-with-previous-response",
        driftMode: "current_turn",
        providerEffectiveContext: "unverified",
        ...reasoningContinuity.stats(),
      },
      functionCalling: {
        configured: functionCallingStats.adapterConfigured && functionCallingStats.toolGatewayConfigured
          && functionGatewayStats.configured && functionCallingManagerStats.configured,
        contractReady: true,
        executionOwner: "application-tool-gateway",
        schemaMode: "explicit-strict",
        selectionModes: ["auto", "required", "none", "forced", "allowed"],
        parallelPolicy: "capability-and-request-bounded",
        continuation: "previous-response-with-reasoning-items",
        reviewContinuation: "manager-owned-durable-same-run",
        reviewStateExposure: "resume-token-only",
        reviewedExecutionPolicy: "durable-receipt-before-side-effect",
        idempotencyPolicy: "stable-key-with-upstream-echo-for-mutations",
        callIdentity: "function-call-output-preserves-call-id",
        providerExecutionStatus: "unverified",
        adapter: {
          configured: openAiFunctionConfig.ready,
          provider: openAiFunctionConfig.provider,
          protocol: openAiFunctionConfig.protocol,
          endpoint: openAiFunctionConfig.endpoint,
          model: openAiFunctionConfig.model,
          apiKeyEnv: openAiFunctionConfig.apiKeyEnv,
          apiKeyPresent: openAiFunctionConfig.apiKeyPresent,
          pricingReady: openAiFunctionConfig.pricingReady,
          reasoningEffort: openAiFunctionConfig.reasoningEffort,
          maxOutputTokens: openAiFunctionConfig.maxOutputTokens,
          ...(openAiFunctionStats || {}),
        },
        gateway: functionGatewayStats,
        manager: functionCallingManagerStats,
        ...functionCallingStats,
      },
      programmaticToolCalling: {
        configured: programmaticStats.adapterConfigured && programmaticStats.toolGatewayConfigured,
        contractReady: true,
        executionOwner: "downstream-hosted-sandbox",
        programRouting: "bounded-read-only-stages",
        directRouting: "writes-approvals-semantic-judgment",
        continuationModes: ["stored", "stateless-replay"],
        callerContract: "function-call-output-preserves-caller",
        localJavaScriptExecution: "forbidden",
        providerContextIsolation: "unverified",
        ...programmaticStats,
      },
      runningAgents: {
        configured: runningAgentStats.adapterConfigured,
        contractReady: true,
        loopOwner: "application-turn-controller",
        streamingOwner: "same-loop-event-channel",
        pauseSemantics: "resume-same-turn",
        recoveryPolicy: "atomic-claim-resume-commit",
        continuationPolicy: "one-strategy-per-conversation",
        providerExecutionStatus: "unverified",
        ...runningAgentStats,
      },
      sandboxAgents: {
        configured: sandboxAgentStats.configured,
        contractReady: true,
        controlPlaneOwner: "agentic-canvas-os",
        executionOwner: "injected-container-provider",
        operationPolicy: "application-authorized-and-capability-bounded",
        stateSurfaces: ["active-session", "resume-checkpoint", "workspace-snapshot"],
        secretPolicy: "host-bindings-only",
        containerExecutionStatus: sandboxAgentStats.containerExecutionStatus,
        independentContainmentProof: sandboxAgentStats.independentContainmentProof,
        ...sandboxAgentStats,
      },
      toolSearch: {
        configured: toolSearchStats.clientSearchConfigured,
        contractReady: true,
        catalogScope: "active-session-grants",
        initialExposure: "direct-definitions-and-deferred-metadata",
        loadedDefinitionPlacement: "append-only-search-output",
        programSearchPolicy: "top-level-before-hosted-program",
        providerContextReduction: "unverified",
        ...toolSearchStats,
      },
      skillProposer: {
        configured: skillProposerStats.draftStoreConfigured && skillProposerStats.modelAdapterConfigured,
        contractReady: true,
        proposalOwner: "acos-skill-proposer",
        registryWriteCapability: false,
        iterationBound: skillProposerStats.iterationBound,
        circuitBreakerConsecutiveNoCandidate: skillProposerStats.circuitBreakerConsecutiveNoCandidate,
        p95GapToDraftMs: skillProposerStats.p95GapToDraftMs,
        providerExecutionStatus: "unverified",
        ...skillProposerStats,
      },
      skillRegistryGate: {
        configured: skillRegistryGateStats.draftStoreConfigured
          && skillRegistryGateStats.operatorInstructionResolverConfigured,
        contractReady: true,
        boundaryState: "closed",
        promotionOwner: "acos-skill-registry-gate",
        artifactType: "agent-definition",
        modelCallCapability: false,
        providerExecutionStatus: "unverified",
        ...skillRegistryGateStats,
      },
      adapterRegistration: {
        configured: adapterRegistrationStats.registryConfigured
          && adapterRegistrationStats.operatorInstructionResolverConfigured,
        contractReady: true,
        registrationOwner: ADAPTER_REGISTRATION_OWNER,
        sharedEntrypointAdapterNames: 0,
        requestScopedState: false,
        providerExecutionStatus: "unverified",
        ...adapterRegistrationStats,
      },
      upstreamDependencyAdmission: {
        configured: Boolean(secret),
        contractReady: true,
        route: "/api/upstream-dependency-admission/evaluate",
        auth: "session-bearer",
        sourcePolicy: "protected-exact-revision-only",
        continuationPolicy: "exact-consumer-closure-with-disjoint-work",
        mutationPolicy: "pure-no-source-adoption-projection-release-or-deployment",
        providerExecutionStatus: "not-applicable-model-free",
      },
    };
  };
}
