import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPOSITORY_RUNTIME_READINESS_SCHEMA =
  "agentic-repository-runtime-readiness/v1";

const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 12_000,
  maxFileBytes: 256_000,
  maxTotalBytes: 8_000_000,
});

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".cts", ".html", ".js", ".json", ".jsx", ".md", ".mdx",
  ".mjs", ".mts", ".sh", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

const MANAGER_LOCKS = Object.freeze({
  bun: ["bun.lock", "bun.lockb"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
});

const MANAGER_INSTALL_PATTERNS = Object.freeze({
  bun: /\bbun install --frozen-lockfile\b/,
  npm: /\bnpm ci\b/,
  pnpm: /\bpnpm install --frozen-lockfile\b|\bpnpm install --frozen-lockfile=true\b/,
  yarn: /\byarn install --frozen-lockfile\b|\byarn install --immutable\b/,
});

function runGit(repositoryPath, args) {
  const result = spawnSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    maxBuffer: 12_000_000,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function canonicalRepositoryRoot(repositoryPath) {
  const input = fs.realpathSync(repositoryPath);
  const root = fs.realpathSync(
    runGit(input, ["rev-parse", "--show-toplevel"]).trim(),
  );
  if (input !== root) {
    throw new Error("repository path must equal the canonical Git worktree root");
  }
  return root;
}

function readTrackedText(repositoryPath, limits) {
  const names = runGit(repositoryPath, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort((left, right) => {
      const priority = (relativePath) => {
        if (
          relativePath === "package.json"
          || Object.values(MANAGER_LOCKS).flat().includes(relativePath)
          || /^\.env\.(?:example|sample|template)$/.test(relativePath)
          || relativePath === ".node-version"
          || relativePath === ".nvmrc"
        ) return 0;
        if (/^\.github\/workflows\/.+\.ya?ml$/.test(relativePath)) return 1;
        if (
          /(^|\/)(?:playwright|vitest|jest|next|vite|wrangler)\.config\./i.test(relativePath)
          || /(^|\/)(?:health|ready|readiness)(?:\/|\.|-)/i.test(relativePath)
        ) return 2;
        if (/(^|\/)(?:e2e|tests?|__tests__)(\/|$)/i.test(relativePath)) return 3;
        if (/^(?:README|scripts\/)/i.test(relativePath)) return 4;
        return 5;
      };
      return priority(left) - priority(right) || left.localeCompare(right);
    });
  const records = new Map();
  const omissions = [];
  let totalBytes = 0;

  for (const relativePath of names) {
    if (records.size >= limits.maxFiles) {
      omissions.push({ reason: "file-cap", path: relativePath });
      break;
    }
    const absolutePath = path.resolve(repositoryPath, relativePath);
    const relativeFromRoot = path.relative(repositoryPath, absolutePath);
    if (
      relativeFromRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeFromRoot)
    ) {
      omissions.push({ reason: "path-escape", path: relativePath });
      continue;
    }
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      omissions.push({ reason: "symlink", path: relativePath });
      continue;
    }
    if (!stat.isFile()) continue;
    const baseName = path.basename(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const textLike =
      TEXT_EXTENSIONS.has(extension)
      || baseName.startsWith(".env.")
      || baseName === ".nvmrc"
      || baseName === ".node-version";
    if (!textLike) continue;
    if (stat.size > limits.maxFileBytes) {
      omissions.push({ reason: "file-byte-cap", path: relativePath });
      continue;
    }
    if (totalBytes + stat.size > limits.maxTotalBytes) {
      omissions.push({ reason: "total-byte-cap", path: relativePath });
      break;
    }
    records.set(relativePath, fs.readFileSync(absolutePath, "utf8"));
    totalBytes += stat.size;
  }

  return {
    records,
    trackedFiles: names.length,
    scannedTextFiles: records.size,
    scannedBytes: totalBytes,
    omissions,
    complete: omissions.length === 0,
  };
}

function parsePackageJson(records) {
  const source = records.get("package.json");
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function detectPackageManager(packageJson, trackedPaths) {
  const declared = String(packageJson?.packageManager || "")
    .split("@")[0]
    .trim();
  const lockManagers = Object.entries(MANAGER_LOCKS)
    .filter(([, lockNames]) => lockNames.some((name) => trackedPaths.has(name)))
    .map(([manager]) => manager);
  const manager = declared || (lockManagers.length === 1 ? lockManagers[0] : null);
  return {
    declared: declared || null,
    lockManagers,
    manager,
    coherent:
      Boolean(manager)
      && lockManagers.length === 1
      && lockManagers[0] === manager,
  };
}

function joinedSources(records, predicate = () => true) {
  return [...records]
    .filter(([relativePath]) => predicate(relativePath))
    .map(([, source]) => source)
    .join("\n");
}

function managerReferences(source) {
  const references = new Set();
  if (/\bbun(?:\s|$)/m.test(source)) references.add("bun");
  if (/\bnpm (?:ci|install|run|start|test)\b/m.test(source)) references.add("npm");
  if (/\bpnpm(?:\s|$)/m.test(source)) references.add("pnpm");
  if (/\byarn(?:\s|$)/m.test(source)) references.add("yarn");
  return [...references].sort();
}

function hasAnyPath(paths, patterns) {
  return [...paths].some((relativePath) =>
    patterns.some((pattern) => pattern.test(relativePath)),
  );
}

function evidenceRecord(ready, detail) {
  return Object.freeze({ ready: Boolean(ready), detail });
}

function addFinding(findings, condition, reason, parentFinding, recommendation) {
  if (condition) return;
  findings.push({ reason, finding: parentFinding, recommendation });
}

export function auditRepositoryRuntimeReadiness({
  repositoryPath,
  expectedRevision,
  layer = "source",
  limits = DEFAULT_LIMITS,
}) {
  const root = canonicalRepositoryRoot(repositoryPath);
  const revision = runGit(root, ["rev-parse", "HEAD"]).trim();
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const scan = readTrackedText(root, { ...DEFAULT_LIMITS, ...limits });
  const packageJson = parsePackageJson(scan.records);
  const paths = new Set(scan.records.keys());
  const packageIdentity = detectPackageManager(packageJson, paths);
  const scripts = packageJson?.scripts || {};
  const scriptsSource = Object.values(scripts).join("\n");
  const workflowRecords = [...scan.records].filter(
    ([relativePath]) => /^\.github\/workflows\/.+\.ya?ml$/.test(relativePath),
  );
  const workflowSource = workflowRecords.map(([, source]) => source).join("\n");
  const testSource = joinedSources(
    scan.records,
    (relativePath) =>
      /(^|\/)(?:e2e|tests?|__tests__)(\/|$)/i.test(relativePath)
      || /playwright\.(?:config|test)/i.test(relativePath),
  );
  const commandSource = `${scriptsSource}\n${workflowSource}`;
  const managerRefs = managerReferences(commandSource);
  const foreignManagers = managerRefs.filter(
    (manager) => packageIdentity.manager && manager !== packageIdentity.manager,
  );
  const managerInstallPattern =
    packageIdentity.manager
      ? MANAGER_INSTALL_PATTERNS[packageIdentity.manager]
      : null;
  const pullRequestWorkflowSources = workflowRecords
    .map(([, source]) => source)
    .filter((source) => /(?:^|\n)\s*pull_request\s*:/m.test(source));
  const generatedOrRemoteScript = Object.entries(scripts).some(
    ([name, command]) =>
      /(?:preinstall|postinstall|generate|remote|download|refresh|enrich|index)/i.test(name)
      && /(?:remote|download|fetch|update|enrich|index|http)/i.test(command),
  );
  const generatedInputManifest = hasAnyPath(paths, [
    /(^|\/)generated-inputs\.(?:json|lock|ya?ml)$/,
    /(^|\/)remote-content\.lock$/,
    /(^|\/)input-manifest\.(?:json|ya?ml)$/,
  ]);
  const runtimeVersion =
    packageJson?.engines?.node
    || scan.records.get(".node-version")?.trim()
    || scan.records.get(".nvmrc")?.trim()
    || null;
  const environmentContract = hasAnyPath(paths, [
    /(^|\/)\.env\.(?:example|sample|template)$/,
    /(^|\/)(?:environment|configuration)-contract\.(?:md|json|ya?ml)$/,
  ]);
  const healthContract = hasAnyPath(paths, [
    /(^|\/)(?:health|ready|readiness)(?:\/|\.|-)/i,
    /(^|\/)api\/(?:health|ready|readiness)\//i,
  ]) || Boolean(scripts.health || scripts.readiness);
  const browserConfigured =
    Boolean(scripts.e2e || scripts["test:e2e"] || scripts["test:browser"])
    && /playwright|browser|e2e/i.test(
      `${scripts.e2e || ""} ${scripts["test:e2e"] || ""} ${scripts["test:browser"] || ""}`,
    );
  const browserInWorkflow =
    browserConfigured && /(?:playwright|e2e|test:browser)/i.test(workflowSource);
  const mobileProof =
    /(?:devices\s*\[|viewport\s*:|isMobile\s*:\s*true|mobile)/i.test(testSource);
  const offlineProof =
    [...scan.records].some(
      ([relativePath, source]) =>
        /(^|\/)(?:e2e|tests?|__tests__)(\/|$)/i.test(relativePath)
        && /offline|service.?worker|degraded.?network/i.test(source),
    );
  const performanceBudget =
    /lighthouse|bundle.?budget|performance.?budget|size.?limit/i.test(
      `${commandSource}\n${testSource}`,
    )
    || hasAnyPath(paths, [/(^|\/)performance-budget\.(?:json|ya?ml)$/]);
  const buildScript = Boolean(scripts.build);
  const productionStart =
    Boolean(scripts.start) && !/\b(?:dev|watch)\b/i.test(scripts.start);
  const protectedBuild =
    pullRequestWorkflowSources.some(
      (source) => /(?:npm run|pnpm|yarn|bun run?) build\b/i.test(source),
    );
  const candidateBrowserSmoke =
    browserInWorkflow
    && pullRequestWorkflowSources.some(
      (source) => /(?:playwright|e2e|test:browser)/i.test(source),
    );
  const dynamicToolResolution = /\bnpx\s+/m.test(commandSource);

  const evidence = {
    exactRevision: evidenceRecord(
      !expectedRevision || revision === expectedRevision,
      { actual: revision, expected: expectedRevision || revision },
    ),
    cleanWorktree: evidenceRecord(status.length === 0, {
      changedPathCount: status.split("\n").filter(Boolean).length,
    }),
    packageManagerCoherence: evidenceRecord(
      packageIdentity.coherent && foreignManagers.length === 0,
      { ...packageIdentity, referencedManagers: managerRefs, foreignManagers },
    ),
    runtimeVersionPinned: evidenceRecord(Boolean(runtimeVersion), {
      node: runtimeVersion,
    }),
    environmentContract: evidenceRecord(environmentContract, {
      secretValuesRead: false,
    }),
    immutableInstall: evidenceRecord(
      Boolean(managerInstallPattern?.test(workflowSource)),
      { manager: packageIdentity.manager },
    ),
    generatedInputClosure: evidenceRecord(
      !generatedOrRemoteScript || generatedInputManifest,
      { generatedOrRemoteScript, generatedInputManifest },
    ),
    buildScript: evidenceRecord(buildScript, { command: scripts.build || null }),
    productionStart: evidenceRecord(productionStart, {
      command: scripts.start || null,
    }),
    healthContract: evidenceRecord(healthContract, {}),
    protectedBuild: evidenceRecord(protectedBuild, {}),
    candidateBrowserSmoke: evidenceRecord(candidateBrowserSmoke, {}),
    mobileBrowserProof: evidenceRecord(mobileProof, {}),
    offlineProof: evidenceRecord(offlineProof, {}),
    costBudget: evidenceRecord(performanceBudget, {}),
    dynamicToolResolutionAbsent: evidenceRecord(!dynamicToolResolution, {}),
  };

  const findings = [];
  addFinding(findings, evidence.exactRevision.ready, "source-revision-mismatch",
    "runtime-readiness-unproven", "Audit the exact requested revision.");
  addFinding(findings, scan.complete, "bounded-scan-incomplete",
    "runtime-readiness-unproven", "Reduce or explicitly partition the audit scope.");
  addFinding(findings, evidence.cleanWorktree.ready, "source-worktree-dirty",
    "runtime-readiness-unproven", "Use a clean immutable source revision.");
  addFinding(findings, evidence.packageManagerCoherence.ready, "package-manager-drift",
    "dependency-closure-drift", "Use one declared manager and one lock graph in scripts and CI.");
  addFinding(findings, evidence.runtimeVersionPinned.ready, "runtime-version-unpinned",
    "runtime-readiness-unproven", "Pin the supported runtime in repository-owned metadata.");
  addFinding(findings, evidence.environmentContract.ready, "configuration-contract-missing",
    "runtime-readiness-unproven", "Add a value-free classified environment contract.");
  addFinding(findings, evidence.immutableInstall.ready, "immutable-install-missing",
    "dependency-closure-drift", "Run the declared manager's immutable install in protected checks.");
  addFinding(findings, evidence.generatedInputClosure.ready, "mutable-generation-input",
    "dependency-closure-drift", "Content-address networked generated inputs and their fallback.");
  addFinding(findings, evidence.buildScript.ready, "build-command-missing",
    "unproven-property", "Provide one repository-owned production build command.");
  addFinding(findings, evidence.productionStart.ready, "production-start-missing",
    "unproven-property", "Start the built artifact without rebuilding it.");
  addFinding(findings, evidence.healthContract.ready, "health-contract-missing",
    "unproven-property", "Add cheap process and deeper dependency readiness probes.");
  addFinding(findings, evidence.protectedBuild.ready, "protected-build-missing",
    "unsurfaced-result", "Run the production build in protected candidate checks.");
  addFinding(findings, evidence.candidateBrowserSmoke.ready,
    "candidate-browser-smoke-missing", "unsurfaced-result",
    "Run deterministic critical-path browser smoke for every candidate.");
  addFinding(findings, evidence.mobileBrowserProof.ready,
    "mobile-browser-proof-missing", "unproven-property",
    "Add one narrow touch-capable mobile browser profile.");
  addFinding(findings, evidence.offlineProof.ready, "offline-proof-missing",
    "unproven-property", "Test offline or degraded-network behavior and recovery.");
  addFinding(findings, evidence.costBudget.ready, "cost-budget-missing",
    "unrecorded-consumption", "Set repository-owned performance and cost budgets.");
  addFinding(findings, evidence.dynamicToolResolutionAbsent.ready,
    "dynamic-tool-resolution", "dependency-closure-drift",
    "Invoke lockfile-owned tools through the declared package manager.");

  const sourceObligations = [
    evidence.exactRevision,
    evidence.cleanWorktree,
    evidence.packageManagerCoherence,
    evidence.runtimeVersionPinned,
    evidence.environmentContract,
    evidence.immutableInstall,
    evidence.generatedInputClosure,
    evidence.dynamicToolResolutionAbsent,
  ];
  const sourceReady =
    scan.complete
    && sourceObligations.every((record) => record.ready)
    && findings.every(
      (finding) => finding.finding !== "runtime-readiness-unproven",
    );
  const layers = {
    source: { status: sourceReady ? "ready" : "blocked" },
    local: { status: "unverified" },
    browser: { status: "unverified" },
    integration: { status: "unverified" },
    deployed: { status: "unverified" },
  };

  return {
    schema: REPOSITORY_RUNTIME_READINESS_SCHEMA,
    subject: {
      repositoryPath: root,
      revision,
      expectedRevision: expectedRevision || revision,
    },
    policy: {
      requestedLayer: layer,
      supportedReadyLayers: ["source"],
      limits: { ...DEFAULT_LIMITS, ...limits },
    },
    scan: {
      trackedFiles: scan.trackedFiles,
      scannedTextFiles: scan.scannedTextFiles,
      scannedBytes: scan.scannedBytes,
      complete: scan.complete,
      omissions: scan.omissions,
    },
    evidence,
    findings,
    layers,
    ready: layer === "source" && sourceReady,
    cost: { modelCalls: 0, providerCalls: 0, paidCalls: 0, tokens: 0 },
    boundaries: {
      mutation: false,
      network: false,
      integration: false,
      release: false,
      deployment: false,
    },
  };
}

function parseArguments(argv) {
  const options = { layer: "source", json: false };
  for (const argument of argv) {
    if (argument === "--json") options.json = true;
    else if (argument.startsWith("--repository=")) {
      options.repositoryPath = argument.slice("--repository=".length);
    } else if (argument.startsWith("--expected-revision=")) {
      options.expectedRevision = argument.slice("--expected-revision=".length);
    } else if (argument.startsWith("--layer=")) {
      options.layer = argument.slice("--layer=".length);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.repositoryPath) throw new Error("--repository is required");
  if (options.expectedRevision && !/^[0-9a-f]{40}$/.test(options.expectedRevision)) {
    throw new Error("--expected-revision must be a 40-character lowercase Git SHA");
  }
  if (!["source", "local", "browser", "integration", "deployed"].includes(options.layer)) {
    throw new Error("--layer is invalid");
  }
  return options;
}

const invokedPath =
  process.argv[1] && fs.existsSync(process.argv[1])
    ? fs.realpathSync(process.argv[1])
    : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = auditRepositoryRuntimeReadiness(options);
    process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
    process.exitCode = result.ready ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
