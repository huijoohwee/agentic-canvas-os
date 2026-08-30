---
title: "GitHub Conditional Pull Body Port"
graphId: "md:github-conditional-pull-body"
doc_type: "Contract"
version: "1.0.0"
date: "2026-08-30"
schema: "agentic-github-conditional-pull-body/v1"
frontmatter_contract: "required"
status: "focused-tested"
lang: "en-US"
owner: "Provider adapter function"
local_rung: "spec-complete"
delivered_rung: "undocumented"
lane: "authoring"
runtime_readiness_policy: "fail-closed"
---
# GitHub Conditional Pull Body Port

## Scope

This provider-specific port binds one pull-request body read and update to a
strong entity tag that GitHub currently issues on `HEAD`. It is transport for
an existing controller dependency pair; it does not define lifecycle policy,
authorization, plan identity, journal identity, or a second recovery command.

GitHub documents conditional requests for safe reads and does not publish
conditional `PATCH` support for the pull-request update endpoint. Accordingly,
this port records an observed deployed capability, not a portable API promise.
Missing or changed strong-read capability fails closed before projection.
Silent unsafe-`PATCH` precondition non-enforcement is an irreducible provider
risk, so this port makes no atomic compare-and-swap guarantee. The universal
controller remains provider-neutral and never infers support from this module.

## Closed operation

1. `HEAD` the exact pull-request REST resource with one media type and pinned
   API version, and require one provider-issued syntactically strong ETag.
2. `GET` the same resource with that exact strong value in `If-Match`.
3. Require HTTP success, exact opaque-token agreement with the GET ETag, valid
   JSON, and the controller's complete identity and prior-body checks.
4. Re-read `HEAD` immediately before `PATCH` and require the same strong value.
5. Send the unchanged provider-issued strong value in `PATCH If-Match`.
6. Repeat the strong `HEAD` plus conditional `GET` join for exact readback.

Any missing, weak, repeated, malformed, stale, or mismatched validator; failed
precondition; identity drift; body drift; transport error; or readback drift
stops the operation. Response-loss replay remains owned by the existing durable
controller journal and adopts only an already-observed exact target body.

## Prohibitions

- Never remove `W/` from a weak GET validator or present it as strong.
- Never use `If-Unmodified-Since`, timestamps, GraphQL, or an unconditional
  update as fallback.
- Never add a compatibility command, plan conversion, authorization alias, or
  provider field to the universal controller contract.
- Never claim GitHub has documented atomic unsafe-method compare-and-swap.

The constraints follow the strong-comparison semantics in
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1), the
[GitHub REST conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), and the documented
[pull-request update endpoint](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request).

## Verification

```sh
node --test __tests__/github-conditional-pull-body.test.mjs
```

The focused proof covers strong-HEAD/weak-GET joining, malformed and stale
validator rejection, conditional GET failure, exact PATCH transport, complete
dependency-pair composition, and absence of weak normalization or fallback.
