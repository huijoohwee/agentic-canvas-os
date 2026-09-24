#!/usr/bin/env node
// Reuse the pinned OS CLI grammar and checker; no local dictionary or policy implementation.
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function designCommandArguments(argv) {
  if (argv.length === 1 && /^--input=.{1,1024}$/.test(argv[0])) return ['design-check', argv[0]];
  // Forward exact /, #, @ semantics to the upstream parser; no aliases or inference.
  if (argv.length === 3 && argv[0] === '/design.check' && argv[1] === '#read-only'
    && /^@input:.{1,1024}$/.test(argv[2])) return argv;
  throw new TypeError('usage: design-contract.mjs --input=record.json OR /design.check #read-only @input:record.json');
}

export function runDesignContract(argv) {
  let args, cli;
  try {
    args = designCommandArguments(argv);
    // Export presence is a capability gate, never an invitation to fetch or upgrade a dependency.
    import.meta.resolve('agentic-os/design');
    cli = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.resolve('agentic-os/design')));
  } catch (error) {
    const code = error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ? 'design-check-upstream-unadmitted' : 'design-check-invalid-input';
    console.error(JSON.stringify({ ok: false, code, authority: false, runtimeVerified: false }));
    return 1;
  }
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000, maxBuffer: 300000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(JSON.stringify({ ok: false, code: 'design-check-execution-failed' }));
  return result.status === 0 ? 0 : 1;
}
if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url))
  process.exitCode = runDesignContract(process.argv.slice(2));
