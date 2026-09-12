// Canvas owns compatibility routing only; central planning validates at its source owner.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function validatePlanningOwner(repository = ROOT, documents = new Map()) {
  const failures = [];
  for (const file of ['TODO.md', 'kanban.md']) {
    const text = readFileSync(path.join(repository, 'docs', file), 'utf8');
    const target = `https://github.com/huijoohwee/.workspace/blob/main/.todo/docs/${file}`;
    if (!text.includes(`schema: "workspace-planning-owner-route/v1"`)
      || !text.includes('owner: "huijoohwee/.workspace"') || !text.includes(target))
      failures.push(`${file}: central planning owner route is missing or stale`);
    if (/^\|/m.test(text) || /kanban-projection:begin|todo-index\/v\d|todo-context-record\/v\d/.test(text))
      failures.push(`${file}: a compatibility route cannot contain task rows or planning ownership`);
  }
  for (const file of ['todo', '.todo', 'scripts/planning-context-record-contract.mjs', 'scripts/kanban-projection.mjs']) {
    if (existsSync(path.join(repository, file))) failures.push(`${file}: competing local planning owner must remain absent`);
  }
  // Reuse docs:check's already-read map; never load a private ledger or start another scan.
  for (const [file, text] of documents) {
    const current = text.replace(/https:\/\/github\.com\/huijoohwee\/huijoohwee\.github\.io\/blob\/[a-f0-9]{40}\/[^\s)]+/g, '');
    if (/huijoohwee\.github\.io\/(?:blob\/(?:main|master)\/)?(?:docs\/(?:TODO|kanban)\.md|todo\/)/i.test(current))
      failures.push(`${file}: retired public planning source; consume the private workspace through TODO.md and kanban.md`);
  }
  return failures;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = validatePlanningOwner();
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('Planning routes resolve to huijoohwee/.workspace/.todo; Canvas has no writable ledger');
}
