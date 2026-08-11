---
title: "Admission manifest projection repair"
graphId: "md:admission-manifest-projection-repair"
doc_type: "Lifecycle Capability"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-admission-manifest-projection-repair-doc/v1"
frontmatter_contract: "required"
status: "runtime-ready"
runtime_owner: "../scripts/admission-manifest-projection-repair.mjs"
runtime_proof: "../__tests__/admission-manifest-projection-repair.test.mjs"
---

# Admission manifest projection repair

This controller repairs one historical representation error in an already reviewed lane. The admission manifest was hashed from the transport-shaped `declaredWriteSet` object instead of the source manifest `{ schema, semanticScope, paths }`. It is not a generic metadata editor.

The planner requires a clean protected `main`, an open non-draft same-repository pull request, exact local/remote/review heads, a clean registered worktree, a `review_ready` writer lease, and its single provider-projected `reviewed` cloud claim. Both the admission and cloud-authority manifest digests must equal the reproducible legacy digest. Arbitrary, missing, or partly repaired values fail closed.

Run the protected planner first:

```sh
node scripts/admission-manifest-projection-repair.mjs plan \
  --repository=/absolute/path/to/canonical-repository \
  --pull-request=380
```

The returned plan binds the old and canonical manifest digests, claim and operation receipt, pull-request head, writer lease, provider body, and registry projection. Execute only with the exact returned phrase:

```sh
node scripts/admission-manifest-projection-repair.mjs run \
  --repository=/absolute/path/to/canonical-repository \
  --pull-request=380 \
  --plan-file=/absolute/path/to/plan.json \
  --authorize='authorize admission-manifest-projection-repair <planDigest>'
```

The operation journals provider-marker projection before a local registry CAS and reconciles a lost provider response. Its receipt proves that only the pull-request writer marker and the local writer-lease projection changed. It never changes source bytes, Git refs, claim state, draft state, review head, or deployment state.
