import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const WRITER_LEASE_SCHEMA = "agentic-writer-lease/v2";
export const WRITER_LEASE_REGISTRY_SCHEMA = "agentic-writer-lease-registry/v2";
export const DEFAULT_WRITER_LEASE_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_PULL_REQUEST_ACTION = "/change";
export const DEVICE_BRANCH_PATTERN =
  /^agent\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/;
const LOCK_STALE_MS = 30 * 1000;

export function parseDeviceBranch(branch) {
  const match = String(branch || "").match(DEVICE_BRANCH_PATTERN);
  return match ? { branch, device: match[1], scope: match[2] } : null;
}

export function assertUniquePullRequestScopes(pulls) {
  const owners = new Map();
  for (const pull of Array.isArray(pulls) ? pulls : []) {
    const identity = parseDeviceBranch(pull.headRefName);
    if (!identity) continue;
    const existing = owners.get(identity.scope);
    if (existing && existing.headRefName !== pull.headRefName) {
      throw new Error(
        `Semantic scope ${identity.scope} has multiple active pull requests: #${existing.number}:${existing.headRefName}, #${pull.number}:${pull.headRefName}`,
      );
    }
    owners.set(identity.scope, pull);
  }
  return owners;
}

export function assertNoCompetingScopePullRequests(pulls, activeBranch) {
  const active = parseDeviceBranch(activeBranch);
  if (!active) throw new Error(`Expected an agent/<device>/<semantic-scope> branch; received ${activeBranch}`);
  const owners = assertUniquePullRequestScopes(pulls);
  const owner = owners.get(active.scope);
  if (owner && owner.headRefName !== activeBranch) {
    throw new Error(
      `Semantic scope ${active.scope} is already owned by #${owner.number}:${owner.headRefName}; wait for an exact-SHA handoff.`,
    );
  }
  return owner || null;
}

export function createWriterLeaseStore({ gitCommonDir, now = () => new Date() }) {
  const root = path.resolve(gitCommonDir, "agentic-canvas-os");
  const statePath = path.join(root, "writer-leases.json");
  const lockPath = path.join(root, "writer-leases.lock");

  function readRegistry() {
    if (!existsSync(statePath)) {
      return { schema: WRITER_LEASE_REGISTRY_SCHEMA, revision: 0, leases: {} };
    }
    const value = JSON.parse(readFileSync(statePath, "utf8"));
    if (value.schema !== WRITER_LEASE_REGISTRY_SCHEMA || !value.leases || typeof value.leases !== "object") {
      throw new Error(`Unsupported writer lease registry schema at ${statePath}`);
    }
    return value;
  }

  function read(branch) {
    const registry = readRegistry();
    if (!branch) return registry;
    return registry.leases[branch] || null;
  }

  function claim({
    sessionId,
    device,
    scope,
    branch,
    worktreePath,
    baseSha,
    previousEpoch = 0,
    ttlMs = DEFAULT_WRITER_LEASE_TTL_MS,
  }) {
    requireIdentity({ sessionId, device, scope, branch, worktreePath, baseSha });
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      const instant = now();
      const normalizedWorktreePath = path.resolve(worktreePath);
      for (const candidate of Object.values(registry.leases)) {
        if (!isActive(candidate, instant) || candidate.branch === branch) continue;
        if (path.resolve(candidate.worktreePath) === normalizedWorktreePath) {
          throw new Error(
            `Worktree ${normalizedWorktreePath} is leased to another session for ${candidate.scope} until ${candidate.expiresAt}.`,
          );
        }
      }
      if (isActive(current, instant) && current.sessionId !== sessionId) {
        throw new Error(
          `Branch ${branch} is leased to another session in ${current.worktreePath} until ${current.expiresAt}.`,
        );
      }
      if (isActive(current, instant) && current.sessionId === sessionId) {
        if (path.resolve(current.worktreePath) !== normalizedWorktreePath) {
          throw new Error(`Session ${sessionId} already owns ${branch} in ${current.worktreePath}.`);
        }
        return current;
      }
      const timestamp = instant.toISOString();
      const maximumEpoch = Object.values(registry.leases)
        .reduce((highest, lease) => Math.max(highest, Number(lease?.epoch || 0)), 0);
      const lease = {
        schema: WRITER_LEASE_SCHEMA,
        status: "active",
        epoch: Math.max(maximumEpoch, Number(previousEpoch || 0)) + 1,
        sessionId,
        device,
        scope,
        branch,
        worktreePath: normalizedWorktreePath,
        baseSha,
        fenceSha: null,
        pullRequestUrl: null,
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: new Date(instant.getTime() + normalizeTtl(ttlMs)).toISOString(),
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function verify({ sessionId, branch, allowExpired = false }) {
    if (!branch) throw new Error("Writer lease verification requires a branch.");
    const lease = read(branch);
    if (!lease || lease.status !== "active") throw new Error(`No active writer lease owns ${branch}.`);
    if (sessionId && lease.sessionId !== sessionId) {
      throw new Error("Writer lease belongs to another session.");
    }
    if (branch && lease.branch !== branch) {
      throw new Error(`Writer lease owns ${lease.branch}, not ${branch}.`);
    }
    if (!allowExpired && !isActive(lease, now())) {
      throw new Error(`Writer lease expired at ${lease.expiresAt}; renew or hand off before mutation.`);
    }
    return lease;
  }

  function heartbeat({ sessionId, branch, ttlMs = DEFAULT_WRITER_LEASE_TTL_MS }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = verify({ sessionId, branch, allowExpired: true });
      const instant = now();
      const lease = {
        ...current,
        heartbeatAt: instant.toISOString(),
        expiresAt: new Date(instant.getTime() + normalizeTtl(ttlMs)).toISOString(),
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function annotate({ sessionId, branch, values }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = verify({ sessionId, branch });
      const lease = { ...current, ...values, schema: WRITER_LEASE_SCHEMA };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function complete({ branch, pullRequestUrl, mergeCommitSha, mainSha }) {
    requireSha(mergeCommitSha, "mergeCommitSha");
    requireSha(mainSha, "mainSha");
    return withLock(() => {
      const registry = readRegistry();
      const current = registry.leases[branch] || null;
      if (!current || !["active", "delivery"].includes(current.status)) {
        throw new Error(`No completable writer lease owns ${branch}.`);
      }
      if (current.pullRequestUrl && current.pullRequestUrl !== pullRequestUrl) {
        throw new Error(`Writer lease pull request ${current.pullRequestUrl} does not match ${pullRequestUrl}.`);
      }
      const timestamp = now().toISOString();
      const lease = {
        ...current,
        status: "completed",
        pullRequestUrl,
        completion: { mergeCommitSha, mainSha },
        heartbeatAt: timestamp,
        expiresAt: timestamp,
      };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function release({ sessionId, branch, status = "released" }) {
    return withLock(() => {
      const registry = readRegistry();
      const current = verify({ sessionId, branch, allowExpired: true });
      const timestamp = now().toISOString();
      const lease = { ...current, status, heartbeatAt: timestamp, expiresAt: timestamp };
      writeRegistry({
        ...registry,
        revision: Number(registry.revision || 0) + 1,
        leases: { ...registry.leases, [branch]: lease },
      });
      return lease;
    });
  }

  function writeRegistry(value) {
    mkdirSync(root, { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, statePath);
  }

  function withLock(action) {
    mkdirSync(root, { recursive: true });
    const descriptor = acquireLock(lockPath);
    try {
      return action();
    } finally {
      closeSync(descriptor);
      if (existsSync(lockPath)) unlinkSync(lockPath);
    }
  }

  return { annotate, claim, complete, heartbeat, read, readRegistry, release, statePath, verify };
}

export function renderWriterLeasePullRequestBody(lease) {
  const payload = JSON.stringify({
    schema: lease.schema,
    status: lease.status,
    epoch: lease.epoch,
    sessionId: lease.sessionId,
    device: lease.device,
    scope: lease.scope,
    branch: lease.branch,
    baseSha: lease.baseSha,
    fenceSha: lease.fenceSha,
    heartbeatAt: lease.heartbeatAt,
    expiresAt: lease.expiresAt,
    ...(lease.completion || {}),
  });
  return [
    "---",
    `action: ${DEFAULT_PULL_REQUEST_ACTION}`,
    `scope: "#${lease.scope}"`,
    `actor: "@${lease.device}"`,
    `base_sha: "${lease.baseSha}"`,
    "---",
    "",
    "Device branch claimed for protected, scope-aware delivery.",
    "",
    `<!-- ${WRITER_LEASE_SCHEMA} ${payload} -->`,
  ].join("\n");
}

function requireSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(String(value || ""))) {
    throw new Error(`${label} must be an exact lowercase 40-character Git commit SHA.`);
  }
}

export function parseWriterLeasePullRequestBody(body) {
  const escapedSchema = WRITER_LEASE_SCHEMA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body || "").match(new RegExp(`<!--\\s*${escapedSchema}\\s+(\\{.*\\})\\s*-->`));
  if (!match) return null;
  const value = JSON.parse(match[1]);
  if (
    value.schema !== WRITER_LEASE_SCHEMA ||
    !Number.isInteger(value.epoch) ||
    value.epoch < 1 ||
    !parseDeviceBranch(value.branch) ||
    !/^[0-9a-f]{40}$/.test(String(value.baseSha || "")) ||
    !/^[0-9a-f]{40}$/.test(String(value.fenceSha || "")) ||
    !Number.isFinite(Date.parse(value.expiresAt))
  ) return null;
  return value;
}

function acquireLock(lockPath) {
  try {
    return openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs <= LOCK_STALE_MS) throw new Error("Another writer-lease operation is in progress.");
    const stalePath = `${lockPath}.stale.${process.pid}.${Date.now()}`;
    renameSync(lockPath, stalePath);
    const descriptor = openSync(lockPath, "wx", 0o600);
    unlinkSync(stalePath);
    return descriptor;
  }
}

function isActive(lease, instant) {
  return lease?.status === "active" && Date.parse(lease.expiresAt) > instant.getTime();
}

function normalizeTtl(ttlMs) {
  const value = Number(ttlMs);
  if (!Number.isFinite(value) || value < 60_000 || value > 24 * 60 * 60 * 1000) {
    throw new Error("Writer lease TTL must be between 60 seconds and 24 hours.");
  }
  return Math.floor(value);
}

function requireIdentity(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!String(value || "").trim()) throw new Error(`Writer lease requires ${key}.`);
  }
  const identity = parseDeviceBranch(values.branch);
  if (!identity) throw new Error(`Writer lease branch does not satisfy the device branch contract: ${values.branch}`);
  if (identity.device !== values.device || identity.scope !== values.scope) {
    throw new Error("Writer lease device and scope must match its branch identity.");
  }
}
