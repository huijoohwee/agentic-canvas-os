---
title: "Commerce Admission Operator Instruction 2026-09-03"
graphId: "md:commerce-admission-operator-instruction-2026-09-03"
doc_type: "Operator Instruction"
date: "2026-09-03"
lang: "en-US"
schema: "commerce-admission-operator-instruction/v1"
frontmatter_contract: "required"
status: "approved"
supersedes_in_part: "NATIVE-SKILL-HARNESS-OPERATOR-INSTRUCTION-2026-08-17.md"
---

# Commerce Admission Operator Instruction

Instruction reference:
`operator://agentic-graph/commerce-adapter-admission/2026-09-03`

## Decision

This instruction authorizes one bounded `agentic-canvas-os` runtime increment:
the private `commerce.acos-admission-provider/v3` service-binding boundary may
validate and durably register an exact fenced agentic-graph commerce adapter.
The existing `AGENT_STATE` Durable Object remains the only persistence and
serialization owner. The native Agent Definition registry and tool allowlist
remain projections; they gain no independent admission authority.

For this increment only, this instruction supersedes the 2026-08-17 native
skill harness prohibition on:

- the exact `wrangler.jsonc` changes needed to route `/internal/*` and configure
  this instruction reference in the existing root and Dev environments
- attaching an operator-instruction resolver that resolves only the exact
  reference above
- reporting Adapter Registration configured when its Durable Object store,
  Invocation Register reader, tool allowlist projection, and exact resolver are
  all present

## Required fence

Registration remains closed unless all of the following hold:

- the request arrives through the private `acos-admission.internal` hostname
- the complete request body is no larger than 65,536 bytes
- `commerce-acos-admission-auth/v1` HMAC-SHA256 authenticates the exact method,
  URL, body digest, and all twelve permit header values before JSON or permit
  parsing; the distinct `ACOS_ADMISSION_AUTH_SECRET` is never emitted
- all twelve `agentic-graph-authoring-mutation-permit/v2` headers parse exactly
- the permit is live and targets semantic scope `operator-registry` and write
  target `registry`
- the request digest recomputes from the full five-field registration intent
- the four `admissionInputs` values are byte-canonically equivalent to their
  wire values
- native registration preflight accepts the definition, allowlist, Invocation
  Register entry, and this exact operator instruction reference
- each tool allowlist `entry_id` has one canonical durable owner; conflicting
  content is rejected without advancing the fence or writing an outcome
- one Durable Object transaction records the registration, current fence, and
  replay outcome before any success response is emitted
- every public consumer admission compares its projected revision with the
  Durable Object snapshot; unchanged revisions avoid replay, while a changed
  revision serializes one complete reset and projection before dispatch
- one exact six-field `acos-cloudflare-deployment-identity/v1` is present; the
  private readiness envelope reports `productionReady: true`
- the public release-proof route accepts only the dedicated bounded bearer and
  reaches readyz through the Worker's owned loopback Service Binding
- at most 64 live replay outcomes are retained; expired outcomes compact into
  chained digest evidence before replacement, while each registered agent
  retains only its current revision owner and current allowlist owner

Only a durable terminal outcome may echo the twelve permit headers. Projection
failure remains retriable and cannot manufacture a successful receipt.

## Boundaries

This instruction grants no authority to:

- configure a model, provider, Skill Proposer, or Skill Registry Promotion Gate
- resolve any other operator instruction reference
- mutate agentic-commerce-os or agentic-graph ownership state from this Worker
- deploy, promote, merge, clean up, or release any repository or Cloudflare
  environment outside the separately authenticated protected release controller
- invent a staging environment, binding, or rate-limit namespace without
  separate owner evidence
- treat Dev or local proof as Production authorization

Repository integration and cleanup still require their own exact authenticated
receipts under the pinned ADLC workflows. Production mutation and recovery are
separately governed by `PROTECTED-ACOS-PRODUCTION-RELEASE.md`.
