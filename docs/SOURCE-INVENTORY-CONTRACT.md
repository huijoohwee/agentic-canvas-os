---
title: "Canonical Source Inventory Contract"
graphId: "md:canonical-source-inventory-contract"
doc_type: "Source Contract"
date: "2026-08-03"
lang: "en-US"
schema: "canonical-source-inventory/v1"
frontmatter_contract: "required"
status: "spec-complete"
authority: "provider-neutral canonical source inventory resolution"
runtime_scope: "revision-bound inventory resolution across local, browser, cloud, and cache readers"
runtime_claim: "contract only; no source mutation, collaboration claim, integration, release, or deployment authority"
runtime_readiness_policy: "fail-closed"
runtime_proof: "RUNTIME-PROOF.md"
---

# Canonical Source Inventory Contract

## Purpose

Define one portable root rule for readers that project a source-controlled set
of documents, assets, records, or configuration. The contract is universal,
neutral, and implementation-agnostic: it names no provider, runtime, device,
filesystem, browser, database, cache, or programming language as authoritative.

## Authority

One **Source Authority** publishes an immutable revision and its complete
**Inventory Manifest**. The manifest contains normalized item identities,
per-item content digests, and one digest over the sorted complete inventory.
Only the Source Authority owns inventory membership, fallback order, and empty
inventory semantics.

Readers are projections. A network client, bundled artifact, local checkout,
cache, mirror, or browser-local adapter may retrieve bytes but cannot redefine
membership, silently choose a fallback, or treat an incomplete result as a
successful inventory.

## Resolution Rule

The source-owned resolver receives a requested revision and returns exactly one
of these outcomes:

| Outcome | Requirement |
|---|---|
| `verified` | Complete normalized item set and all digests match the manifest at the requested revision. |
| `unavailable` | No complete verified inventory can be obtained; include a typed reason without inventing membership. |
| `stale` | A previously verified inventory remains visible while a different or incomplete revision is pending verification. |

An empty result is `verified` only when the verified manifest declares zero
items. A transport failure, filtered response, timeout, cache miss, or local
reader restriction is never evidence that the inventory is empty.

## Projection and Recovery

- Select fallback only in the Source Authority's resolver policy, in a stable
  declared order; readers consume the selected result without local policy
  branches
- Replace visible inventory atomically only after complete manifest validation
- Preserve the last verified inventory when a new resolution is unavailable or
  partial; first load exposes `unavailable`, never a partial tree
- Invalidate cached or derived inventory only when its bound revision or digest
  changes; timestamps, paths, process state, and device state are projections
- A repair changes the source-owned resolver, manifest producer, or shared
  adapter contract; reader-specific aliases, masks, and duplicate inventories
  are forbidden

## Concurrent Collaboration

Any claim, handoff, integration receipt, or runtime assertion that consumes an
inventory records its source revision and inventory digest. A reader on another
device may use a different transport, but it must derive the same verified
manifest. Mismatched revision, digest, normalized set, or item digest is stale
and fails closed.

This contract grants no collaboration, mutation, integration, release, or
deployment authority. It only makes inventory provenance and completeness
independently verifiable.

## Verification

Every supported reader must prove the same manifest projection for:

- complete successful resolution;
- unavailable transport or reader;
- partial or filtered response;
- stale cached inventory;
- source revision change during resolution; and
- concurrent readers using distinct transports.

The checks assert normalized paths, item digests, inventory digest, and result
state. A UI tree, source count, or successful request alone is insufficient
proof of inventory completeness.
