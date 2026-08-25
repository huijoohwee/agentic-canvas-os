---
title: "Admitted Published-descendant Dirty Recovery"
graphId: "md:admitted-published-descendant-dirty-recovery"
doc_type: "Recovery Controller Contract"
date: "2026-08-26"
lang: "en-US"
schema: "agentic-admitted-published-descendant-dirty-recovery-doc/v1"
frontmatter_contract: "required"
status: "focused-tested"
runtime_owner: "../scripts/admitted-published-descendant-dirty-recovery.mjs"
runtime_proof: "../__tests__/admitted-published-descendant-dirty-recovery.test.mjs"
---

# Admitted published-descendant dirty recovery

This controller repairs one admitted lane whose exact fence claim expired, whose branch and draft
review were then published to a strict linear descendant, and whose registered worktree retains
nonempty in-scope dirt. It preserves every authored byte while joining the original dormant claim to
the published head.

Planning double-reads the protected controller, local lease, branch, remote, draft review, hidden
marker, complete cloud claim, task binding, and byte-level dirt evidence. Execution requires the
exact `authorize admitted-published-descendant-dirty-recovery <planDigest>` statement and the original
external task capability.

The closed effect set is: recover the same dormant cloud claim, project that claim to the already
published review head, compare-and-swap the local lease and continued task binding, and replace only
the hidden review marker. It does not edit source or index bytes, create commits or refs, push,
integrate, deploy, or clean up.

```sh
node scripts/admitted-published-descendant-dirty-recovery.mjs plan \
  --repository=/absolute/dirty-worktree --session=exact-source-session --json

node scripts/admitted-published-descendant-dirty-recovery.mjs run \
  --repository=/absolute/dirty-worktree --session=exact-source-session \
  --plan-file=/private/plan.json --task-authority=/private/task-authority.json \
  --authorize='authorize admitted-published-descendant-dirty-recovery <planDigest>' --json
```

Success restores scoped mutation authority only. Ordinary clean review, protected integration,
deployment, and recoverable cleanup remain independent lifecycle gates.
