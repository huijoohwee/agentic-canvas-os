// Responsibility: Persist one durable phase journal and one exact writer-registry CAS.
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digestValue } from "./cloud-collaboration-primitives.mjs";
import { mutateWriterLeaseRegistry, writerLeaseDigest } from "./writer-lease-registry-cas.mjs";

export function createReconciliationStore({ gitCommonDir, leaseStore, branch, operationId }) {
  const root = path.join(gitCommonDir, "agentic-canvas-os", "active-publish-task-authority-successor-reconciliation");
  const statePath = path.join(root, `${operationId}.json`);
  const lockPath = `${statePath}.lock`;
  function read() { try { return JSON.parse(readFileSync(statePath, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }
  function write(value) { mkdirSync(root, { recursive: true }); const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, statePath); return value; }
  function withLock(action) { mkdirSync(root, { recursive: true }); let descriptor; try { descriptor = openSync(lockPath, "wx", 0o600); } catch (error) { if (error?.code === "EEXIST") throw new Error("Reconciliation operation is already in progress."); throw error; } try { return action(); } finally { closeSync(descriptor); unlinkSync(lockPath); } }
  function project({ expectedLeaseDigest, expectedClaimId, binding, receipt }) {
    return mutateWriterLeaseRegistry({ leaseStore, branch, expectedLeaseDigest, expectedClaimId, action: ({ registry, lease }) => {
      if (lease.activePublishTaskAuthoritySuccessor) {
        if (lease.activePublishTaskAuthoritySuccessor.receiptDigest !== receipt.receiptDigest || lease.taskAuthority?.bindingDigest !== binding.bindingDigest) throw new Error("A different successor binding is already projected.");
        return { registry, lease, changed: false };
      }
      const target = { ...lease, taskAuthority: binding, activePublishTaskAuthoritySuccessor: receipt };
      return { registry: { ...registry, leases: { ...registry.leases, [branch]: target } }, lease: target, changed: true };
    }});
  }
  return Object.freeze({ statePath, read, write, withLock, project, leaseDigest: writerLeaseDigest });
}

export function journalOperationId({ branch, pullRequestNumber }) { return digestValue({ branch, pullRequestNumber }); }
