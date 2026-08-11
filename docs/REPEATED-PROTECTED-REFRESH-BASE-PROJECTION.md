---
title: "Repeated Protected-Refresh Base Projection"
graphId: "md:repeated-protected-refresh-base-projection"
doc_type: "Runtime Contract"
date: "2026-08-11"
lang: "en-US"
schema: "agentic-repeated-protected-refresh-base-projection/v1"
frontmatter_contract: "required"
status: "focused-tested"
runtime_scope: "Dev protected-integration refresh dispatch only"
runtime_claim: "projects a verified refresh chain; does not grant merge or Production authority"
runtime_owner: "../scripts/repeated-protected-refresh-base-projection.mjs; ../scripts/device-integrate-lib.mjs"
runtime_proof: "../__tests__/repeated-protected-refresh-base-projection.test.mjs"
publish_policy: "protected Dev integration only; Production remains separately authorized"
---
<!-- Responsibility: Define the canonical-base projection used only for a repeated protected-head refresh. -->

# Repeated protected-refresh base projection

A delivery-authorized cloud claim remains bound to its original reviewed head
and canonical base. When GitHub advances that head through an exact,
tree-equivalent protected-main refresh, the live pull request instead exposes
the verified refresh step's main parent as its current base.

`device:integrate` therefore keeps both cloud-authority verification and the
refresh workflow's `canonical_base_sha` pinned to the immutable claim base. It
separately projects the live pull-request base from the terminal
`mainParentSha` of the verified refresh receipt and uses that value only to
reject live provider drift before dispatch. A missing, malformed,
discontinuous, or terminally inconsistent receipt fails closed.

This projection cannot authorize authored head movement, change the immutable
delivery subject, amend the cloud claim, merge a pull request, or open the
Production/Cloudflare boundary.
