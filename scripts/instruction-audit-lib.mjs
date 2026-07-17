const WORD_PATTERN = /[A-Za-z0-9][A-Za-z0-9_.:/@#-]*/g;
const INVOCATION_PATTERN = /(^|\s)([/#@][A-Za-z][A-Za-z0-9_.:-]*)/g;
const DIRECTIVE_PATTERN = /\b(?:always|avoid|do not|forbid|keep|must|never|prefer|preserve|read|reject|require|route|run|stop|treat|use|validate)\b/i;

export const INSTRUCTION_AUDIT_SCHEMA = "agentic-instruction-audit/v1";

export const DEFAULT_INSTRUCTION_POLICIES = Object.freeze({
  "docs/AGENTS.md": Object.freeze({
    role: "always-on-project-guidance",
    maxBodyWords: 900,
    maxInstructionUnits: 42,
    maxInvocationMentions: 16,
    maxBodyCodeFences: 0,
    requiredIntent: Object.freeze([
      "FACTS.md",
      "START-WORKFLOW.md",
      "RELEASE-WORKFLOW.md",
      "SKILLS.md",
      "VALIDATION-RUNBOOK.md",
      "source or shared owner",
      "Prod",
      "Cloudflare",
    ]),
    delegatedDetailPatterns: Object.freeze([
      Object.freeze({ owner: "START-WORKFLOW.md", pattern: /device:(?:start|resume|heartbeat)|writer-lease|fencing sha/i }),
      Object.freeze({ owner: "MEMORY-LOG.md", pattern: /@mem-[0-9]|YYYYMMDDTHHmmssZ/i }),
      Object.freeze({ owner: "TODO.md", pattern: /11-cell|directive exceeds 50 words/i }),
      Object.freeze({ owner: "runtime identity contracts", pattern: /two isolated runtime peers|Cross-device Identity Gate/i }),
    ]),
  }),
  "docs/SKILLS.md": Object.freeze({
    role: "metadata-first-skill-catalog",
    maxBodyWords: 1_800,
    maxInstructionUnits: 48,
    maxInvocationMentions: 36,
    maxBodyCodeFences: 0,
    requiredIntent: Object.freeze([
      "metadata-first",
      "selected",
      "DICTIONARY-COMMAND.md",
      "HARNESS-CONTRACTS.md",
      "RUNTIME-PROOF.md",
      "instruction.audit",
      "external",
    ]),
    delegatedDetailPatterns: Object.freeze([
      Object.freeze({ owner: "SOUL.md", pattern: /^## Soul Contract$/m }),
      Object.freeze({ owner: "MEMORY.md", pattern: /^## Persistent Memory Contract$/m }),
      Object.freeze({ owner: "HARNESS-CONTRACTS.md", pattern: /^## (?:Mixture Of Agents|Stateful Orchestration|Tool Gateway|Tool Search) Contract$/m }),
      Object.freeze({ owner: "Knowgrph UI owners", pattern: /^## FloatingPanel Chat/m }),
    ]),
  }),
});

export function auditInstructionDocuments({
  documents,
  baselineDocuments = null,
  policies = DEFAULT_INSTRUCTION_POLICIES,
} = {}) {
  if (!documents || typeof documents !== "object") {
    throw new TypeError("documents must be a path-to-text object");
  }

  const fileReports = {};
  const violations = [];
  const allUnits = [];

  for (const [file, policy] of Object.entries(policies)) {
    const text = documents[file];
    if (typeof text !== "string") {
      violations.push(violation(file, "missing-surface", `Required instruction surface ${file} is missing.`));
      continue;
    }

    const body = readMarkdownBody(text);
    const units = extractInstructionUnits(body).map((value) => ({ file, value }));
    const metrics = measureText(text, body, units);
    const delegatedDetails = policy.delegatedDetailPatterns
      .filter(({ pattern }) => pattern.test(body))
      .map(({ owner, pattern }) => ({ owner, pattern: pattern.source }));
    const missingIntent = policy.requiredIntent.filter((intent) => !text.includes(intent));

    if (metrics.bodyWords > policy.maxBodyWords) {
      violations.push(violation(file, "body-word-budget", `${metrics.bodyWords} body words exceeds ${policy.maxBodyWords}.`));
    }
    if (metrics.instructionUnits > policy.maxInstructionUnits) {
      violations.push(violation(file, "instruction-unit-budget", `${metrics.instructionUnits} instruction units exceeds ${policy.maxInstructionUnits}.`));
    }
    if (metrics.invocationMentions > policy.maxInvocationMentions) {
      violations.push(violation(file, "invocation-detail-budget", `${metrics.invocationMentions} invocation mentions exceeds ${policy.maxInvocationMentions}.`));
    }
    if (metrics.bodyCodeFences > policy.maxBodyCodeFences) {
      violations.push(violation(file, "embedded-procedure", `${metrics.bodyCodeFences} body code fences exceeds ${policy.maxBodyCodeFences}.`));
    }
    for (const intent of missingIntent) {
      violations.push(violation(file, "missing-intent", `Required intent marker is missing: ${intent}`));
    }
    for (const detail of delegatedDetails) {
      violations.push(violation(file, "canonical-owner-leakage", `Detail owned by ${detail.owner} is repeated here.`));
    }

    fileReports[file] = {
      role: policy.role,
      metrics,
      limits: {
        bodyWords: policy.maxBodyWords,
        instructionUnits: policy.maxInstructionUnits,
        invocationMentions: policy.maxInvocationMentions,
        bodyCodeFences: policy.maxBodyCodeFences,
      },
      intent: {
        required: [...policy.requiredIntent],
        missing: missingIntent,
      },
      delegatedDetails,
    };
    allUnits.push(...units);
  }

  const duplicates = findExactDuplicates(allUnits);
  for (const duplicate of duplicates) {
    violations.push(violation(
      duplicate.files.join(", "),
      "duplicate-instruction",
      `Instruction is repeated ${duplicate.count} times: ${duplicate.sample}`,
    ));
  }

  const totals = Object.values(fileReports).reduce((result, report) => ({
    characters: result.characters + report.metrics.characters,
    estimatedTokens: result.estimatedTokens + report.metrics.estimatedTokens,
    bodyWords: result.bodyWords + report.metrics.bodyWords,
    instructionUnits: result.instructionUnits + report.metrics.instructionUnits,
  }), { characters: 0, estimatedTokens: 0, bodyWords: 0, instructionUnits: 0 });

  return {
    schema: INSTRUCTION_AUDIT_SCHEMA,
    status: violations.length === 0 ? "passed" : "failed",
    files: fileReports,
    summary: {
      auditedFiles: Object.keys(fileReports).length,
      ...totals,
      duplicateInstructions: duplicates.length,
      violations: violations.length,
    },
    duplicates,
    violations,
    baseline: baselineDocuments ? compareBaseline(documents, baselineDocuments, policies) : null,
    costLog: {
      model: "not-run",
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_hits: 0,
      estimated_cost_usd: 0,
    },
    deployBoundary: {
      prodMirrorAttempted: false,
      cloudflareAttempted: false,
    },
  };
}

export function readMarkdownBody(text) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  return end < 0 ? text : text.slice(end + 5);
}

function measureText(text, body, units) {
  const words = body.match(WORD_PATTERN) ?? [];
  const invocationMentions = [...body.matchAll(INVOCATION_PATTERN)].length;
  const fenceMarkers = body.match(/^```/gm)?.length ?? 0;
  return {
    characters: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
    lines: text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
    bodyWords: words.length,
    instructionUnits: units.length,
    invocationMentions,
    bodyCodeFences: Math.ceil(fenceMarkers / 2),
  };
}

function extractInstructionUnits(body) {
  const units = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || /^\|[-: |]+\|$/.test(line)) continue;
    const candidates = line.startsWith("|")
      ? line.split("|").map((cell) => cell.trim()).filter(Boolean)
      : line.replace(/^[-*+]\s+|^[0-9]+\.\s+/, "").split(/(?<=[.!?])\s+/);
    for (const candidate of candidates) {
      const normalized = normalizeInstruction(candidate);
      if (normalized.split(" ").length >= 5 && DIRECTIVE_PATTERN.test(candidate)) units.push(normalized);
    }
  }
  return units;
}

function normalizeInstruction(value) {
  return value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, "link")
    .replace(/[^a-z0-9@#/:._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findExactDuplicates(units) {
  const grouped = new Map();
  for (const unit of units) {
    const matches = grouped.get(unit.value) ?? [];
    matches.push(unit.file);
    grouped.set(unit.value, matches);
  }
  return [...grouped.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([sample, files]) => ({
      sample,
      count: files.length,
      files: [...new Set(files)].sort(),
    }))
    .sort((left, right) => left.sample.localeCompare(right.sample));
}

function compareBaseline(documents, baselineDocuments, policies) {
  const files = {};
  let currentCharacters = 0;
  let baselineCharacters = 0;
  for (const file of Object.keys(policies)) {
    const current = documents[file];
    const baseline = baselineDocuments[file];
    if (typeof current !== "string" || typeof baseline !== "string") continue;
    currentCharacters += current.length;
    baselineCharacters += baseline.length;
    files[file] = {
      currentCharacters: current.length,
      baselineCharacters: baseline.length,
      reducedCharacters: baseline.length - current.length,
      reductionPercent: percentageReduction(current.length, baseline.length),
    };
  }
  return {
    files,
    currentCharacters,
    baselineCharacters,
    reducedCharacters: baselineCharacters - currentCharacters,
    reductionPercent: percentageReduction(currentCharacters, baselineCharacters),
  };
}

function percentageReduction(current, baseline) {
  if (baseline === 0) return 0;
  return Number((((baseline - current) / baseline) * 100).toFixed(1));
}

function violation(file, code, message) {
  return { file, code, message };
}
