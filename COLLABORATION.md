# Multi-device delivery

This repository delegates Git lifecycle, protected integration, canonical
reconciliation, and eligible cleanup to the exact pinned `agentic-os` package.
The installed `node_modules/agentic-os/docs/START-WORKFLOW.md`,
`node_modules/agentic-os/docs/adlc-guidelines.md`, and
`node_modules/agentic-os/docs/RELEASE-WORKFLOW.md` are the lifecycle SSOT. This
file adds only ACOS product validation and deployment boundaries.

## Install and verify the pinned harness

```bash
npm ci --ignore-scripts
npm run doctor
```

The repository has no local lifecycle installer or GitHub-configuration
controller. GitHub authority remains selected by `.github/adlc-authority-policy.json`,
`.agentic-os/github-transition-policy.json`, and their retained workflows.

## Author and publish a scoped change

```bash
npm run lane -- canvas-presence
# author and commit only in the worktree printed by agentic-os
npm run land
```

Treat every command result as bounded evidence, not inferred authority. Do not
replace the installed start workflow with raw worktree creation, branch adoption,
lease repair, or direct protected-branch publication.

## Observe or reconcile canonical state

```bash
npm run status
npm run sync:canonical
```

`status` is read-only. `sync:canonical` is the sole exposed reconciliation
command and remains subject to the pinned ADLC contract. Neither command is
described here as an implicit fetch, fast-forward, integration, or cleanup
receipt; use its actual typed result.

## ACOS product gates

Before product handoff, run the focused checks for the changed surface and then:

```bash
npm run runtime-readiness-contract:check
npm run collaboration:gate
npm run web:build
```

`npm run smoke` is available only as a caller-supplied URL check. This repository
contains no preview, production-deploy, or rollback workflow, and passing a local
smoke check does not claim deployment. Production and Cloudflare effects require
their separately authorized external owner and exact product release evidence.

The retained `security.yml` and `dependency-security.yml` workflows provide
repository security checks. They grant no lifecycle, release, or deployment
authority.
