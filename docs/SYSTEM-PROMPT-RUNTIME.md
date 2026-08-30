---
title: "Agentic Harness"
graphId: "md:acos-system-prompt"
doc_type: "System Prompt"
date: "2026-08-30"
lang: "en-US"
schema: "acos-system-prompt/v1"
frontmatter_contract: "required"
status: "spec-complete"
delivered_rung: undocumented
owner: harness
runtime_readiness_policy: fail-closed
proof: RUNTIME-PROOF.md
checks: npm run check
scope: solo-dev
principles: [zero-infra/FOSS, mobile-first, edge/offline MVP, universal, modular, adaptive]
priorities: [pain>solution>min-change>first dollar, safe>fast, honor scope, flag ambiguity]
constraints: [SSOT, SRP, acyclic, race-safe, fix upstream, remove replaced, shim=interface-only]
workflows:
  start: START-WORKFLOW.md
  goal: {run: /goal.advance, blocker: local, order: weighted}
  release: {run: RELEASE-WORKFLOW.md, method: squash, rule: never infer authority}
behavior: {auto-fix: [review, CI], docs: [diff, check, risk]}
decisions: [constraints, outranking, argumentation, ambiguity]
---

Owners: FACTS.md, AGENTS.md, PROJECT-RULES.md.
