#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SEVERITY,
  FINDING_TYPES,
} from "./alignment-audit/finding.mjs";
import { frontmatterValue, scanFrontmatter } from "./alignment-audit/frontmatter.mjs";
import { parseGuidelineSet } from "./alignment-audit/guideline-parser.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_MANIFEST = "docs/schemas/agentic-sdlc-guideline-baseline.v1.json";

export function parseArguments(argumentsList = []) {
  let manifestPath = DEFAULT_MANIFEST;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = String(argumentsList[index]);
    if (argument === "--manifest") {
      manifestPath = requiredValue(argumentsList[index + 1], "--manifest");
      index += 1;
    } else if (argument.startsWith("--manifest=")) {
      manifestPath = requiredValue(argument.slice("--manifest=".length), "--manifest");
    } else {
      throw new Error(`unsupported argument: ${argument}`);
    }
  }
  return Object.freeze({ manifestPath });
}

export async function verifyGuidelineBaseline(options = {}) {
  const currentDirectory = path.resolve(options.currentDirectory ?? process.cwd());
  const environment = options.environment ?? process.env;
  const readText = options.readText ?? ((locator) => readFile(locator, "utf8"));
  const readRevisionText = options.readRevisionText ?? gitRevisionText;
  const resolveRevision = options.resolveRevision ?? gitRevision;
  const manifestPath = path.resolve(
    currentDirectory,
    options.manifestPath ?? DEFAULT_MANIFEST,
  );
  const manifest = JSON.parse(await readText(manifestPath));
  validateManifest(manifest);

  const repositoryLocator = resolveLocator(
    manifest.repository.locator,
    environment,
  );
  const observedRevision = await resolveRevision(repositoryLocator);
  assertEqual(
    observedRevision,
    manifest.repository.revision,
    "guideline repository revision",
  );

  const documents = await Promise.all(
    manifest.documents.map(async (entry) => {
      const locator = resolveLocator(entry.locator, environment);
      const text = await readRevisionText({
        locator,
        repositoryLocator,
        revision: observedRevision,
      });
      assertEqual(sha256(text), entry.sha256, `${entry.role} guideline digest`);
      const scanned = scanFrontmatter(text, manifest.requiredFrontmatterKeys);
      if (scanned.readState !== "ok" || scanned.missingKeys.length > 0) {
        throw new Error(
          `${entry.role} guideline frontmatter is not baseline-conformant`,
        );
      }
      assertEqual(
        frontmatterValue(scanned.frontmatter, "version"),
        entry.version,
        `${entry.role} guideline version`,
      );
      return Object.freeze({ ...entry, locator, text });
    }),
  );

  const parsed = parseGuidelineSet(
    documents.map((document) => ({
      documentKey: document.role,
      inputRole: "guideline",
      text: document.text,
    })),
    manifest.requiredFrontmatterKeys,
  );
  if (parsed.findings.length > 0) {
    throw new Error(
      `guideline parsing produced ${parsed.findings.length} source finding(s)`,
    );
  }

  const model = parsed.value;
  const roleSummaries = documents.map((document) =>
    verifyDocumentModel(document, model, manifest.requiredSectionAnchors),
  );
  const sourceFindingRegistry = extractSourceFindingRegistry(documents);
  verifyFindingRegistry(sourceFindingRegistry);
  const executionFindingRegistry = extractSourceFindingRegistry(
    documents.filter((document) => document.role === "execution"),
  );
  const executionRuleBindings = verifyExecutionRuleBindings(
    manifest.executionFindingRuleBindings,
    executionFindingRegistry,
    model,
  );
  const executionRuleCatalog = verifyExecutionRuleCatalog(
    manifest.executionRuleCatalog,
    model,
    manifest.executionFindingRuleBindings,
  );
  const guidelineLoadProfiles = verifyGuidelineLoadProfiles(
    manifest.guidelineLoadProfiles,
    model,
  );

  const summary = Object.freeze({
    schema: "agentic-sdlc-guideline-source-proof/v1",
    repository: manifest.repository.identity,
    revision: observedRevision,
    documents: roleSummaries,
    totals: Object.freeze({
      rules: roleSummaries.reduce((total, item) => total + item.rules, 0),
      artifactBearing: roleSummaries.reduce(
        (total, item) => total + item.artifactBearing,
        0,
      ),
      advisory: roleSummaries.reduce((total, item) => total + item.advisory, 0),
      gates: model.gates.length,
      findingTypes: sourceFindingRegistry.size,
      executionRuleBindings,
      executionRuleCatalog,
      guidelineLoadProfiles,
    }),
    deployBoundary: Object.freeze({ lane: "authoring", state: "closed" }),
  });
  return summary;
}

function verifyDocumentModel(document, model, requiredAnchorsByRole) {
  const meta = model.documents.get(document.role);
  if (!meta) throw new Error(`missing parsed document role ${document.role}`);
  for (const anchor of requiredAnchorsByRole[document.role] ?? []) {
    if (!meta.sectionAnchors.includes(anchor)) {
      throw new Error(`${document.role} guideline is missing section anchor ${anchor}`);
    }
  }

  const elements = model.elements.filter(
    (element) => element.documentKey === document.role,
  );
  if (elements.length === 0) {
    throw new Error(`${document.role} guideline produced no rules`);
  }
  const seenRuleIds = new Set();
  const bySection = new Map();
  for (const element of elements) {
    if (!element.text || !["artifact-bearing", "advisory"].includes(element.class)) {
      throw new Error(`${document.role} guideline has an incomplete rule record`);
    }
    const sectionRules = bySection.get(element.sectionAnchor) ?? [];
    sectionRules.push(element);
    bySection.set(element.sectionAnchor, sectionRules);
  }
  for (const [sectionAnchor, rules] of bySection) {
    rules
      .sort((left, right) => left.ordinal - right.ordinal)
      .forEach((rule, index) => {
        const expected = `${sectionAnchor}#${index + 1}`;
        assertEqual(rule.ruleId, expected, `${document.role} Rule ID`);
        if (seenRuleIds.has(rule.ruleId)) {
          throw new Error(`${document.role} guideline has duplicate Rule ID ${rule.ruleId}`);
        }
        seenRuleIds.add(rule.ruleId);
      });
  }
  return Object.freeze({
    role: document.role,
    version: document.version,
    sha256: document.sha256,
    rules: elements.length,
    artifactBearing: elements.filter(
      (element) => element.class === "artifact-bearing",
    ).length,
    advisory: elements.filter((element) => element.class === "advisory").length,
    sections: meta.sectionAnchors.length,
  });
}

export function extractSourceFindingRegistry(documents) {
  const registry = new Map();
  const headings = Object.freeze({
    authoring: "Conformance Findings",
    execution: "Execution Conformance Findings",
  });
  for (const document of documents) {
    const section = markdownSection(document.text, headings[document.role]);
    const rowPattern =
      /^\|\s*[^|]+\s*\|\s*`([^`]+)`\s*\|\s*`(blocker|major|minor)`\s*\|\s*$/gmu;
    for (const match of section.matchAll(rowPattern)) {
      const [, findingType, severity] = match;
      if (registry.has(findingType)) {
        throw new Error(`finding type is redefined: ${findingType}`);
      }
      registry.set(findingType, severity);
    }
  }
  return registry;
}

function verifyFindingRegistry(sourceRegistry) {
  const sourceTypes = [...sourceRegistry.keys()].sort(compareText);
  const runtimeTypes = [...FINDING_TYPES].sort(compareText);
  if (JSON.stringify(sourceTypes) !== JSON.stringify(runtimeTypes)) {
    throw new Error(
      `finding registry drift: source=${sourceTypes.join(",")} runtime=${runtimeTypes.join(",")}`,
    );
  }
  for (const [findingType, severity] of sourceRegistry) {
    assertEqual(
      DEFAULT_SEVERITY[findingType],
      severity,
      `${findingType} default severity`,
    );
  }
}

export function verifyExecutionRuleBindings(bindings, registry, model) {
  const bindingTypes = Object.keys(bindings ?? {}).sort(compareText);
  const executionTypes = [...registry.keys()].sort(compareText);
  if (JSON.stringify(bindingTypes) !== JSON.stringify(executionTypes)) {
    throw new Error(
      `execution rule binding drift: source=${executionTypes.join(",")} bindings=${bindingTypes.join(",")}`,
    );
  }
  const sourceRules = new Map(
    model.elements
      .filter((element) => element.documentKey === "execution")
      .map((element) => [element.ruleId, element]),
  );
  for (const findingType of executionTypes) {
    const binding = bindings[findingType];
    const sourceRule = sourceRules.get(binding?.ruleId);
    if (!sourceRule) {
      throw new Error(
        `${findingType} binding does not resolve to an execution Rule ID`,
      );
    }
    assertEqual(
      sourceRule.class,
      "artifact-bearing",
      `${findingType} bound rule class`,
    );
    assertEqual(
      String(binding?.ruleText ?? "").trim(),
      String(sourceRule.text).trim(),
      `${findingType} bound rule text`,
    );
  }
  return executionTypes.length;
}

export function verifyExecutionRuleCatalog(catalog, model, bindings = {}) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("execution rule catalog must be an object");
  }
  const sourceRules = new Map(
    model.elements
      .filter((element) => element.documentKey === "execution")
      .map((element) => [element.ruleId, element]),
  );
  for (const [ruleId, ruleText] of Object.entries(catalog)) {
    const sourceRule = sourceRules.get(ruleId);
    if (!sourceRule) {
      throw new Error(`execution rule catalog does not resolve ${ruleId}`);
    }
    assertEqual(
      sourceRule.class,
      "artifact-bearing",
      `${ruleId} catalog rule class`,
    );
    assertEqual(
      String(ruleText).trim(),
      String(sourceRule.text).trim(),
      `${ruleId} catalog rule text`,
    );
  }
  for (const [findingType, binding] of Object.entries(bindings)) {
    assertEqual(
      catalog[binding?.ruleId],
      binding?.ruleText,
      `${findingType} binding catalog entry`,
    );
  }
  return Object.keys(catalog).length;
}

export function verifyGuidelineLoadProfiles(profiles, model) {
  const expectedStages = {
    authoring: ["phase-4"],
    execution: [
      "run-start",
      "task-derivation",
      "dispatch",
      "implementation",
      "verification",
      "recovery",
      "escalation",
    ],
  };
  let count = 0;
  for (const [role, stages] of Object.entries(expectedStages)) {
    const observedStages = Object.keys(profiles?.[role] ?? {}).sort(compareText);
    if (JSON.stringify(observedStages) !== JSON.stringify([...stages].sort(compareText))) {
      throw new Error(`${role} guideline load stages do not match the pinned source contract`);
    }
    const sourceAnchors = new Set(model.documents.get(role)?.sectionAnchors ?? []);
    for (const stage of stages) {
      const anchors = profiles[role][stage];
      if (
        !Array.isArray(anchors)
        || anchors.length === 0
        || new Set(anchors).size !== anchors.length
        || anchors.some((anchor) => !sourceAnchors.has(anchor))
      ) {
        throw new Error(`${role} guideline load profile ${stage} has an unresolved section`);
      }
      count += 1;
    }
  }
  return count;
}

function markdownSection(text, heading) {
  const lines = String(text).replace(/\r\n?/gu, "\n").split("\n");
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) throw new Error(`missing guideline section: ${heading}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##(?!#)\s+/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

function validateManifest(manifest) {
  if (
    manifest?.schema !== "agentic-sdlc-guideline-baseline/v1" ||
    !manifest.repository ||
    !Array.isArray(manifest.documents) ||
    manifest.documents.length !== 2 ||
    !Array.isArray(manifest.requiredFrontmatterKeys) ||
    !manifest.executionFindingRuleBindings ||
    typeof manifest.executionFindingRuleBindings !== "object" ||
    !manifest.executionRuleCatalog ||
    typeof manifest.executionRuleCatalog !== "object" ||
    !manifest.guidelineLoadProfiles ||
    typeof manifest.guidelineLoadProfiles !== "object"
  ) {
    throw new Error("invalid Agentic SDLC guideline baseline manifest");
  }
  const roles = manifest.documents.map((entry) => entry.role).sort(compareText);
  if (JSON.stringify(roles) !== JSON.stringify(["authoring", "execution"])) {
    throw new Error("guideline baseline must contain authoring and execution roles");
  }
}

function resolveLocator(value, environment) {
  const expanded = String(value).replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu,
    (_match, name) => {
      const replacement = environment[name];
      if (typeof replacement !== "string" || replacement.trim().length === 0) {
        throw new Error(`missing required environment variable ${name}`);
      }
      return replacement;
    },
  );
  return path.resolve(expanded);
}

async function gitRevision(repositoryLocator) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryLocator, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  );
  return stdout.trim();
}

async function gitRevisionText({ locator, repositoryLocator, revision }) {
  const relativeLocator = path.relative(repositoryLocator, locator);
  if (
    !relativeLocator
    || path.isAbsolute(relativeLocator)
    || relativeLocator === ".."
    || relativeLocator.startsWith(`..${path.sep}`)
  ) {
    throw new Error("guideline document locator must resolve inside its repository");
  }
  const gitPath = relativeLocator.split(path.sep).join("/");
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryLocator, "show", `${revision}:${gitPath}`],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  return stdout;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requiredValue(value, flag) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${flag} requires a value`);
  return text;
}

function assertEqual(observed, expected, label) {
  if (observed !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, observed ${observed}`);
  }
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

export async function main(argumentsList = process.argv.slice(2), dependencies = {}) {
  const argumentsResult = parseArguments(argumentsList);
  const summary = await verifyGuidelineBaseline({
    ...dependencies,
    manifestPath: argumentsResult.manifestPath,
  });
  const writeOutput =
    dependencies.writeOutput ?? ((value) => process.stdout.write(`${value}\n`));
  writeOutput(JSON.stringify(summary));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `[agentic-sdlc-source] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
