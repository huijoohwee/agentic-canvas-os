---
title: "Workspace Todo Owner"
graphId: "md:agentic-canvas-os-todo-contract"
doc_type: "Owner Route"
date: "2026-09-12"
lang: "en-US"
schema: "workspace-planning-owner-route/v1"
frontmatter_contract: "required"
status: "active"
owner: "huijoohwee/.workspace"
target_revision: "b1a07fe65734c8b48f80718e1900ffa7bf6c2cd2"
migration_manifest_sha256: "653ab164ba373a65e3112be0bf945704e70ec3568275284f7f047001e4f450dc"
source_docs:
  - "https://github.com/huijoohwee/.workspace/blob/main/.todo/docs/TODO.md"
---

# Workspace Todo Owner

The live source moved to [TODO.md](https://github.com/huijoohwee/.workspace/blob/main/.todo/docs/TODO.md) in private `huijoohwee/.workspace/.todo`.
Edit that owner through its protected task lane. This compatibility route has no task rows,
planning schema, projection or mutation command. Do not recreate `todo/` in Canvas.

The central [migration manifest](https://github.com/huijoohwee/.workspace/blob/main/.todo/todo/migration-agentic-canvas-os.json)
records source revision `6b5160b3baf8deada4562bc501193ff76851bc55` and byte identities for all 30 imported records.
Their content is preserved unchanged at the new owner and remains available in Canvas Git history.
Run `npm --prefix .todo test` in the selected private workspace; Canvas validates these routes and
consumer references without reading private task content. The website owns reusable validators.
Immutable Context records are the planning source; generate the Kanban board through that owner. Planning records do not grant
claims, leases, deployment authority or permission to discard unfinished work.
