---
title: "Active Publish Write Scope"
graphId: "md:active-publish-write-scope"
doc_type: "Lifecycle Capability"
date: "2026-08-12"
lang: "en-US"
schema: "agentic-lane-admission-lease/v1"
frontmatter_contract: "required"
status: "source-ready"
authority: "Immutable admitted write-set containment"
runtime_owner: "../scripts/active-publish-write-scope.mjs; ../scripts/device-integrate-lib.mjs"
runtime_proof: "../__tests__/active-publish-write-scope.test.mjs; ../__tests__/device-integrate.test.mjs"
---

# Active publish write-scope verification

Active publish successor recovery compares every path changed from the newly
observed protected base with the immutable admitted write-set. An admitted path
may name either one file or a directory subtree. A changed path is accepted only
when it equals an admitted path or is a descendant separated by `/`.

The verifier must not rebuild the admission manifest from individual Git diff
paths. Directory manifests intentionally normalize to a different digest than
their expanded file lists even when every changed file is owned. Exact manifest
and write-set digests remain immutable on the lease and cloud claim; the
successor check proves containment against that evidence.

Paths outside admission, prefix lookalikes, malformed paths, and semantic-scope
drift fail before successor mutation. Protected-main changes inherited by the
fresh base are excluded by the `currentBase..head` diff.
