const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function provePatchEquivalentDivergence({ localHead, originHead, gitText, gitPatchId }) {
  const mergeBase = requireSha(gitText(["merge-base", localHead, originHead]).trim(), "Divergence merge base");
  const localOnly = readLines(gitText(["rev-list", "--reverse", `${originHead}..${localHead}`]));
  const remoteOnly = readLines(gitText(["rev-list", "--reverse", `${localHead}..${originHead}`]));
  if (!localOnly.length || !remoteOnly.length) {
    throw new Error("Equivalence recovery requires genuine two-sided divergence.");
  }
  const cherry = readLines(gitText(["cherry", originHead, localHead]));
  if (cherry.length !== localOnly.length) {
    throw new Error("Git cherry proof did not account for every local-only commit.");
  }
  const cherryByCommit = new Map(cherry.map(line => {
    const match = /^([+-]) ([0-9a-f]{40})$/.exec(line);
    if (!match) throw new Error(`Malformed git cherry proof: ${line}`);
    return [match[2], match[1]];
  }));
  const remoteProof = remoteOnly.map(commit => {
    const parents = readWords(gitText(["rev-list", "--parents", "-n", "1", commit]));
    const patchId = parents.length === 2 ? readPatchId(gitPatchId(commit)) : null;
    return Object.freeze({ commit, patchId });
  });
  const remotePatchIds = new Map(remoteProof.flatMap(entry =>
    entry.patchId ? [[entry.commit, entry.patchId]] : []));
  const localProof = localOnly.map(commit => {
    const parents = readWords(gitText(["rev-list", "--parents", "-n", "1", commit]));
    if (parents.length !== 2) {
      throw new Error(`Local-only commit ${commit} is not a single-parent commit.`);
    }
    if (cherryByCommit.get(commit) !== "-") {
      throw new Error(`Local-only commit ${commit} is not patch-equivalent to protected origin/main.`);
    }
    const patchId = requirePatchId(gitPatchId(commit), commit);
    const matchingOriginCommits = [...remotePatchIds].flatMap(([candidate, candidatePatchId]) =>
      candidatePatchId === patchId ? [candidate] : []);
    if (!matchingOriginCommits.length) {
      throw new Error(`Stable patch-id ${patchId} for local-only commit ${commit} has no remote-divergence match.`);
    }
    return Object.freeze({ commit, patchId, cherry: "-", matchingOriginCommits });
  });
  return Object.freeze({
    method: "git-cherry+stable-patch-id",
    mergeBase,
    localOnly: localProof,
    remoteOnly: remoteProof,
  });
}

function readLines(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function readWords(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function requirePatchId(value, commit) {
  const patchId = readPatchId(value);
  if (!patchId) throw new Error(`Commit ${commit} has no stable non-empty patch-id.`);
  return patchId;
}

function readPatchId(value) {
  const patchId = String(value || "").trim().split(/\s+/, 1)[0];
  return SHA_PATTERN.test(patchId) ? patchId : null;
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be an exact 40-character Git object id.`);
  }
  return value;
}
