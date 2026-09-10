---
title: "Workspace Kanban Owner"
graphId: "md:agentic-os-kanban"
doc_type: "Owner Route"
date: "2026-09-10"
lang: "en-US"
schema: "workspace-planning-owner-route/v1"
frontmatter_contract: "required"
status: "active"
owner: "huijoohwee.github.io"
target_revision: "db02db8c9959a2c9bdb5c390a000c9f09cf56633"
migration_manifest_sha256: "653ab164ba373a65e3112be0bf945704e70ec3568275284f7f047001e4f450dc"
source_docs:
  - "https://github.com/huijoohwee/huijoohwee.github.io/blob/main/docs/kanban.md"
---

# Workspace Kanban Owner

The live source moved to [kanban.md](https://github.com/huijoohwee/huijoohwee.github.io/blob/main/docs/kanban.md) in `huijoohwee.github.io`.
Edit that owner through its protected task lane. This compatibility route has no task rows,
planning schema, projection or mutation command. Do not recreate `todo/` in Canvas.

The central [migration manifest](https://github.com/huijoohwee/huijoohwee.github.io/blob/main/todo/migration-agentic-canvas-os.json)
records source revision `6b5160b3baf8deada4562bc501193ff76851bc55` and byte identities for all 30 imported records.
Their content is preserved unchanged at the new owner and remains available in Canvas Git history.
Run `npm run planning:check` in the explicitly selected central owner; Canvas validates only this route.
Task rows, progress and handoffs are owned by the central Kanban board. Planning records do not grant
claims, leases, deployment authority or permission to discard unfinished work.
