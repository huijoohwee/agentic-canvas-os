---
title: "AI Voice Studio Invocation Contract"
graphId: "md:ai-voice-studio"
doc_type: "Invocation And MCP Ownership Contract"
date: "2026-07-24"
lang: "en-US"
schema: "voice-studio-invocation-contract/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "canonical voice clone, speech-to-text, and text-to-speech invocation, safety, bounds, and owner separation"
runtime_scope: "provider-neutral AI voice profile creation, dictation, and disclosed audio rendering"
runtime_claim: "Agentic Canvas OS supplies a model-free validated contract; executable readiness belongs only to the matching Knowgrph local stdio MCP runtime and its exact proof"
runtime_owner: "$GITHUB_ROOT/knowgrph/mcp"
runtime_proof: "../scripts/voice-studio-contract.mjs; ../__tests__/voice-studio-contract.test.mjs"
invocation: "/voice.studio"
operations: ["clone", "dictate", "create"]
semantic_routes:
  clone: "/voice.studio #voice-clone @audio @voice-profile @approval-gate @cost-log @runtime-proof"
  dictate: "/voice.studio #speech-to-text @audio @text @approval-gate @cost-log @runtime-proof"
  create: "/voice.studio #text-to-speech @text @voice-profile @audio @approval-gate @cost-log @runtime-proof"
mcp_tool: "knowgrph.voice.studio"
external_pattern_source: "https://github.com/jamiepine/voicebox"
external_source_policy: "abstract workflow inspiration only; local source, vocabulary, schemas, prompts, fixtures, tests, assets, UI, and prose are independently authored"
external_dependency: "forbidden"
publish_policy: "Dev-only until matching Knowgrph runtime proof and explicit operator approval"
---

# AI Voice Studio

`/voice.studio` selects one bounded provider-neutral studio for `clone`, `dictate`, or `create`. The selected semantic route determines the operation and its typed bindings. There are no `/voice.clone`, `/voice.dictate`, or `/voice.create` compatibility commands.

The `/`, `#`, and `@` tokens are host discovery and handoff metadata. MCP clients call the single exact `knowgrph.voice.studio` wire tool with a strict operation discriminator. A dictionary match never executes audio processing, grants recording rights, supplies consent, approves spend, or authorizes persistence.

## Exact Routes

| Operation | Exact host route | Required input | Typed output |
|---|---|---|---|
| `clone` | `/voice.studio #voice-clone @audio @voice-profile @approval-gate @cost-log @runtime-proof` | One immutable source-audio artifact reference, speaker authorization, consent receipt, intended-use policy, profile intent, bounds, and idempotency key. | One revision-fenced voice-profile manifest or a typed pre-execution block; source and derived provenance remain distinct. |
| `dictate` | `/voice.studio #speech-to-text @audio @text @approval-gate @cost-log @runtime-proof` | One immutable source-audio artifact reference, recording-rights receipt, transcription options, bounds, and idempotency key. | One text artifact with language, bounded segments, source digest, confidence posture, and cost evidence, or a typed block. |
| `create` | `/voice.studio #text-to-speech @text @voice-profile @audio @approval-gate @cost-log @runtime-proof` | One bounded text artifact, one authorized exact voice-profile revision, disclosure policy, output options, bounds, and idempotency key. | One disclosed audio artifact with exact text and profile provenance, duration, media metadata, and cost evidence, or a typed block. |

Exactly one semantic route is accepted per request. A missing semantic, multiple semantics, an unsupported operation, or bindings that do not match the selected route fail before adapter selection, media read, provider request, spend, or persistence.

## Owner Separation

| Owner | Owns | Does not own |
|---|---|---|
| Agentic Canvas OS | Canonical command, semantic routes, binding meanings, request/result requirements, safety policy, bounds, clean-room boundary, and promotion gate. | Audio capture, media bytes, profiles, provider calls, credentials, durable jobs, UI state, or deployment. |
| Knowgrph local stdio MCP | The exact `knowgrph.voice.studio` schema, validation, idempotency, bounded adapter dispatch, cancellation, sanitized result, and deterministic Dev proof. | Consent inference, recording rights, provider entitlement, caller credentials, or authority from dictionary tokens. |
| Existing media and workspace owners | Immutable audio/text artifacts, hashes, metadata, retention state, read-back, Rich Media, Card, and Timeline projection. | A copied voice store, alternate file namespace, or implicit public URL. |
| Approved voice adapter | Capability-specific clone, transcription, or synthesis work and returned provider evidence. | Host invocation parsing, approval policy, durable authority, or fabricated cost and provenance. |
| Operator or authorized speaker | Explicit recording rights, speaker consent, permitted uses, revocation, disclosure, and paid-call approval where required. | Silent approval through profile selection, prior unrelated consent, or a dictionary binding. |

Provider choice and credentials remain server-managed. The MCP request carries opaque source identities and receipts, never raw credentials, browser sessions, filesystem paths, base64 audio, provider job secrets, or caller-selected executable code.

## Discriminated MCP Contract

Every request uses `knowgrph-voice-studio-request/v1` and includes:

```yaml
request:
  operation: "clone | dictate | create"
  requestId: "bounded caller identity"
  idempotencyKey: "bounded retry identity"
  approvalReceiptId: "exact scoped receipt"
  limits: {maxDurationMs: 0, maxBytes: 0, maxTextCharacters: 0, timeoutMs: 0}
```

The operation-specific object is exact and rejects unknown fields:

| Operation | Required object | Forbidden substitution |
|---|---|---|
| `clone` | `sourceAudio {artifactId, sha256, mediaType, bytes, durationMs}`, `speakerAuthorization {consentReceiptId, rightsReceiptId, permittedUses, disclosureRequired, retentionPolicy}`, and `profileIntent {profileId, displayName}`. | Text-only source, mutable URL, inferred speaker identity, public-figure preset, missing rights, or caller provider credentials. |
| `dictate` | `sourceAudio {artifactId, sha256, mediaType, bytes, durationMs}`, `recordingAuthorization {rightsReceiptId, participantNotice}`, and `transcription {language, timestamps, diarization}`. | Microphone permission inference, unbounded live stream, hidden recording, unsupported codec guess, or generated transcript supplied as evidence. |
| `create` | `sourceText {artifactId, sha256, characters}`, `voiceProfile {profileId, profileRevision}`, `disclosure {label, intendedAudience}`, and `output {mediaType, sampleRateHz, channels}`. | Mutable profile alias, revoked profile, undisclosed clone use, caller filesystem output, or text beyond the admitted digest. |

Every response uses `knowgrph-voice-studio-result/v1` with `ok`, `operation`, `requestId`, `idempotencyKey`, `state`, `artifacts`, `provenance`, `rights`, `usage`, `cost`, `proof`, and exactly one of `result` or `error`. States are `validated`, `awaiting_approval`, `running`, `completed`, `blocked`, `canceled`, or `failed`. Errors contain a stable code, safe message, retry eligibility, and no raw provider payload or sensitive biometric material.

An exact idempotency retry returns the recorded terminal result. Reusing a key with changed operation, source digest, profile revision, authorization, text digest, output options, or bounds is a conflict. Cancellation prevents new adapter work; an already-started external effect may settle only through its existing receipt and cannot revive a canceled request.

## Consent, Rights, And Disclosure

Consent and `@approval-gate` are separate requirements. Consent authorizes a named speaker and permitted use; the approval gate authorizes the scoped cost, egress, or mutation. Neither can substitute for the other.

- `clone` requires an exact unexpired speaker-consent receipt, recording-rights receipt, declared permitted uses, retention policy, and required disclosure before source audio is read.
- `dictate` requires lawful recording rights and participant notice evidence appropriate to the source; the runtime never treats microphone access as recording consent.
- `create` requires the exact active profile revision, intended use within its allowlist, and a visible synthetic-voice disclosure when the profile policy requires it.
- Public-figure, celebrity, deceptive impersonation, fraud, harassment, authentication bypass, and consent-obscuring defaults are rejected.
- Revocation immediately blocks new `create` work and new profile selection. The runtime records deletion or retention actions for derived profiles and artifacts without claiming deletion from an external owner it cannot verify.
- Consent receipts, voice embeddings, speaker identifiers, and raw audio are sensitive. Results expose opaque references and minimal proof, not reusable biometric payloads.

## Artifact And Provenance Contract

Raw recordings, normalized audio, derived voice profiles, transcripts, requested text, and rendered audio remain separate immutable artifact kinds. Each derived output records source artifact ids and SHA-256 digests, profile revision where applicable, transformation operation, adapter identity and capability revision, authorization receipt ids, disclosure state, measured usage, and retention status.

The runtime verifies read-back identity before returning `completed`. A preview URL, in-memory blob, provider job id, or UI card alone is not durable output. Transcripts preserve uncertainty rather than inventing words; rendered audio preserves the exact admitted text digest; voice profiles never claim speaker identity beyond the authorization record.

## Hard Bounds And Failure Policy

| Bound | Contract maximum |
|---|---:|
| Source audio per `clone` request | 300,000 ms and 100,000,000 bytes |
| Source audio per `dictate` request | 3,600,000 ms and 500,000,000 bytes |
| Text per `create` request | 20,000 characters |
| Created audio per request | 900,000 ms |
| Voice profiles created per request | 1 |
| Output artifacts per request | 1 |
| Adapter attempts | 1 initial attempt; no automatic paid retry |
| Stage timeout | 120,000 ms unless a lower owner limit applies |
| Idempotency retention | 24 hours or the lower host policy |

The effective limit is the lowest caller, profile, adapter, application, and deployment-policy bound. Capability, codec, authorization, consent, profile, disclosure, provider, credential, entitlement, budget, storage, or read-back gaps return a typed block before spend. Offline and unavailable adapters remain honest; they do not fabricate media, transcripts, profiles, usage, or zero cost.

## Deterministic Proof And Promotion

`npm run voice-studio-contract:check` is model-free and provider-free. It validates the canonical routes, dictionary and facts ownership, one MCP tool, consent and clean-room gates, planning row, and negative fixtures with `tokens: 0` and `costUsd: 0`.

The contract remains `spec-complete` until an exact integrated Knowgrph revision proves the discriminated MCP schema and local stdio registration, deterministic injected-adapter clone/dictate/create results, idempotent replay, cancellation, consent and approval separation, revocation, provenance and read-back, bounds, cost honesty, secret redaction, and fail-before-spend live-adapter gaps. Source tests alone do not prove microphone permission, provider cloning quality, live transcription accuracy, live synthesis fidelity, biometric deletion, Prod, or Cloudflare readiness.

## Clean-Room Boundary

The [jamiepine/voicebox](https://github.com/jamiepine/voicebox) repository informs only the abstract idea of a desktop-oriented workflow that captures speech and produces voice-related artifacts. No Voicebox code, prose, prompt, schema, API shape, tool name, test, fixture, asset, UI layout, style, package, dependency, model stack, provider configuration, generated artifact, or repository structure is copied, imported, invoked, vendored, or required.

Removing network access and the external repository changes neither this contract nor its deterministic validation. The automated guard detects dependency and runtime reference names; it is not a similarity detector. A separate provenance and similarity review must inspect authored code, prose, prompts, schemas, tests, fixtures, assets, defaults, API shapes, and UI before integration.

## VCCs

- Given `/voice.studio`, when exactly one supported semantic and its required bindings resolve, then the host returns metadata for `clone`, `dictate`, or `create` and never claims MCP execution.
- Given a valid MCP request, when consent, recording rights, permitted use, approval, bounds, capability, and artifact identity pass, then only `knowgrph.voice.studio` may dispatch the selected adapter.
- Given missing, expired, mismatched, or revoked authorization, when work is considered, then no audio read, adapter call, persistence, spend, or generated artifact begins.
- Given an exact idempotency replay, when a terminal result exists, then the same sanitized result returns without a second adapter call or cost.
- Given a completed operation, when output is returned, then raw and derived artifacts remain separate and exact source, profile, authorization, disclosure, usage, cost, and read-back evidence are present.
- Given the default repository, when `npm run voice-studio-contract:check` and `npm run docs:check` run, then validation is zero-model, provider-free, external-dependency-free, below line ceilings, and makes no Prod or Cloudflare mutation.
