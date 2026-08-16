---
title: "Recovery Artifact Retirement"
graphId: "md:recovery-artifact-retirement"
doc_type: "Recovery Artifact Retirement Contract"
date: "2026-08-13"
lang: "en-US"
schema: "agentic-recovery-artifact-retirement-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "repository-owned archive-only disposition for completed recovery packages"
runtime_scope: "one exact recovery directory per digest-bound plan"
runtime_claim: "read-only planning, exact authorization, durable intent, atomic archival, and crash replay"
runtime_proof: "focused local contract, controller, repository adapter, and CLI tests"
publish_policy: "no deploy authority"
---

# Recovery Artifact Retirement

This lifecycle supersedes a completed recoverable-cleanup directory without
deleting its evidence. It admits either a joined complete cleanup receipt or an
incomplete journal stopped exactly at `reservation_released`. The latter requires
the plan's exact drift acknowledgement digest.

`plan` twice captures a bounded, symlink-free byte manifest; validates raw intent
and receipt JSON, bundle bytes and head, and current `origin/main`; and proves the
recovered head is either an ancestor of main or one empty coordination commit
whose parent is an ancestor. Planning writes nothing.

`run` requires the printed byte-exact authorization. It persists prepared intent
under the journal owner's Git common directory before its only external effect:
a same-filesystem atomic rename to
`<archive-root>/<subject-key>-<manifest-digest>`. It never unlinks or recursively
removes recovery content. After interruption, exactly one of source and the exact
archive must exist; any both-present, both-absent, or manifest-drift state fails.
The subject lock records its owner. A replay atomically preserves a dead owner's
lock as stale evidence before acquiring a fresh token; a live or unsafe lock fails closed.
Lock recovery is owner-led, and filesystem safety assumes cooperative workspace
ownership: lstat plus immediate recapture rejects observed path races, while a
hostile concurrent filesystem replacement is outside this lifecycle's proof.

```sh
npm run recovery:artifact:retirement -- plan \
  --repository="[Agentic Canvas OS canonical root]" \
  --source="[one recovery directory]" \
  --archive-root="[existing same-filesystem archive root]" \
  --subject-repository="[repository named by cleanup evidence]" \
  --session="[operator session]" \
  --operator-decision-digest="[sha256]" --json
```

Run repeats those inputs plus `--plan-digest` and `--authorize`. Observe repeats
the four paths and optionally the plan digest. Removing an empty recovery parent
is separate nonrecursive maintenance after every subject receipt is complete.

The command grants no purge, branch, ref, provider, integration, release, object
pruning, global worktree prune, or deployment authority.
