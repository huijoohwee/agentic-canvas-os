# Agent instructions

Continuously comply with the pinned `agentic-os` sources at:

- `node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md`
- `node_modules/agentic-os/docs/adlc-guidelines.md`
- `node_modules/agentic-os/docs/START-WORKFLOW.md`
- `node_modules/agentic-os/docs/RELEASE-WORKFLOW.md`

Those files are the global prompt, governance, start, and release SSOT. Do not
copy or redefine them in this repository. Missing pinned assets fail closed;
install the lockfile with `npm ci --ignore-scripts` before work. ACOS may narrow them only through its
product, deployment, rollback, and authorization policy in `docs/PROJECT-RULES.md`,
`docs/VALIDATION-RUNBOOK.md`, `docs/RUNTIME-READINESS.md`, `.agentic-os.json`,
`.agentic-os/github-transition-policy.json`, and `.github/adlc-authority-policy.json`.
No local policy may create a competing lifecycle controller or infer authority.
