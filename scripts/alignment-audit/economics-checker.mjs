import { makeFinding } from "./finding.mjs";
import { DEFAULT_VENDOR_TOKENS } from "./neutrality-checker.mjs";

export const DEFAULT_ECONOMICS_STATEMENTS = Object.freeze([
  "return-on-investment",
  "12-month-total-cost-of-ownership",
  "token-budget",
  "time-to-value",
]);

const DELIVERY_DIMENSIONS = Object.freeze(["browser-reach", "mobile-reach", "offline-behavior"]);

export function checkEconomics(docs = [], statements = DEFAULT_ECONOMICS_STATEMENTS) {
  const findings = [];
  for (const doc of docs) {
    const content = documentContentWithFrontmatter(doc);
    const subject = documentSubject(doc);
    if (isFeatureBearing(doc, content)) {
      for (const statement of statements) {
        if (hasStatement(content, statement)) continue;
        findings.push(createFinding("missing-economics-metric", {
          guidelineAnchor: `economics:${statement}`,
          artifactReference: subject,
          evidenceExcerpt: `Missing economics statement: ${statement}`,
          statement: `Document the ${statement} statement for this feature.`,
        }));
      }
    }

    if (isUserFacing(doc, content)) {
      for (const dimension of DELIVERY_DIMENSIONS) {
        if (hasDeliveryStatement(content, dimension)) continue;
        findings.push(createFinding("missing-delivery-statement", {
          guidelineAnchor: `delivery:${dimension}`,
          artifactReference: subject,
          evidenceExcerpt: `Missing delivery statement: ${dimension}`,
          statement: `Document the ${dimension} delivery behavior for this capability.`,
        }));
      }
    }

    const blended = blendedTcoStatement(content);
    if (blended) {
      findings.push(createFinding("blended-deployment-tco", {
        artifactReference: subject,
        evidenceExcerpt: blended,
        statement: "Separate managed and self-managed 12-month TCO figures.",
      }));
    }

    const proprietaryDependencies = collectProprietaryDependencies(content);
    if (proprietaryDependencies.length > 0 &&
        !hasFossComparison(content, proprietaryDependencies)) {
      findings.push(createFinding("missing-foss-comparison", {
        artifactReference: subject,
        evidenceExcerpt: proprietaryExcerpt(content, proprietaryDependencies),
        statement: "Compare the proprietary dependency with at least one FOSS alternative.",
      }));
    }

    if (isAiPipeline(doc, content) &&
        (!hasMaximumIterationBound(content) || !hasCircuitBreaker(content))) {
      findings.push(createFinding("unbounded-loop", {
        artifactReference: subject,
        evidenceExcerpt: pipelineExcerpt(content),
        statement: "Specify both a maximum-iteration bound and a circuit-breaker condition.",
      }));
    }

    const paidRead = nonzeroReadCostStatement(content);
    if (paidRead) {
      findings.push(createFinding("paid-read-path", {
        artifactReference: subject,
        evidenceExcerpt: paidRead,
        statement: "Provide a zero-token discovery/read path or document a compliant zero-cost alternative.",
      }));
    }
  }
  return findings.sort(compareFindingIdentity);
}

function hasStatement(content, statement) {
  const canonicalKey = new RegExp(
    `\\b${String(statement).split("-").map(escapeRegExp).join("[ _-]+")}\\b`,
    "iu",
  );
  const aliases = {
    "return-on-investment": [/\breturn on investment\b/iu, /\bROI\b/u],
    "12-month-total-cost-of-ownership": [
      /\b12[- ]month (?:total cost of ownership|TCO)\b/iu,
      /\b(?:total cost of ownership|TCO).{0,20}\b12 months?\b/iu,
    ],
    "token-budget": [/\btoken budget\b/iu, /\bmaximum tokens?\b/iu],
    "time-to-value": [/\btime[- ]to[- ]value\b/iu, /\bTTV\b/u],
  };
  const patterns = aliases[statement] ?? [
    new RegExp(`\\b${escapeRegExp(String(statement).replaceAll("-", " "))}\\b`, "iu"),
  ];
  return semanticSegments(content).some((segment) =>
    [canonicalKey, ...patterns].some((pattern) => {
      const match = pattern.exec(segment);
      return match !== null &&
        hasSubstantiveMetricValue(segment.slice(match.index + match[0].length));
    }));
}

function hasSubstantiveMetricValue(trailingText) {
  const value = trailingText
    .replace(/^[\s*`_|:=>-]+/u, "")
    .replace(/^(?:is|equals?|of)\b[\s:=>-]*/iu, "")
    .replace(/[\s*`_|]+$/u, "")
    .trim();
  if (value.length === 0) return false;
  return !/^(?:TBD|TBC|TODO|unknown|pending|n\/?a|null|not determined|to be (?:decided|defined|determined))(?:\b|$)/iu
    .test(value);
}

function hasDeliveryStatement(content, dimension) {
  const aliases = {
    "browser-reach": /\bbrowser[ _-]+(?:reach|support|delivery|access)\b/iu,
    "mobile-reach": /\bmobile[ _-]+(?:reach|support|delivery|access)\b/iu,
    "offline-behavior": /\boffline[ _-]+(?:behavior|behaviour|support|mode|capability)\b/iu,
  };
  return semanticSegments(content).some((segment) => {
    const match = aliases[dimension].exec(segment);
    return match !== null &&
      hasSubstantiveMetricValue(segment.slice(match.index + match[0].length));
  });
}

function blendedTcoStatement(content) {
  return content.split("\n").find((line) => {
    const both = /\bmanaged\b/iu.test(line) && /\bself[- ]managed\b/iu.test(line);
    if (!both || !/\b(?:TCO|total cost of ownership)\b/iu.test(line)) return false;
    const monetaryValues = line.match(/(?:[$€£]\s*)?\d+(?:\.\d+)?/gu) ?? [];
    const withoutDuration = monetaryValues.filter((value) => !/^12$/u.test(value.replace(/\D/gu, "")));
    return withoutDuration.length <= 1 || /\bcombined|blended|single figure\b/iu.test(line);
  })?.trim() ?? "";
}

function collectProprietaryDependencies(content) {
  const dependencies = [];
  for (const segment of semanticSegments(content)) {
    const explicitNames = explicitProprietaryNames(segment);
    if (explicitNames.length === 0 &&
        /\bproprietary (?:dependency|service|library|platform|API|tool)\b/iu.test(segment)) {
      dependencies.push({ name: "proprietary dependency", generic: true, segment });
    }
    for (const name of explicitNames) {
      dependencies.push({ name, generic: false, segment });
    }
    for (const token of DEFAULT_VENDOR_TOKENS) {
      if (namesDependency(segment, token)) {
        dependencies.push({ name: token, generic: false, segment });
      }
    }
    for (const name of uncataloguedServiceBrands(segment)) {
      dependencies.push({ name, generic: false, segment });
    }
  }
  return [...new Map(dependencies.map((dependency) => [
    `${dependency.generic}:${dependency.name.toLocaleLowerCase("en")}`,
    dependency,
  ])).values()];
}

function namesDependency(line, token) {
  const vendor = escapeRegExp(token);
  const kind = "(?:dependency|service|library|platform|API|tool)";
  return new RegExp(
    `(?:${vendor}.{0,32}\\b${kind}\\b|\\b${kind}\\b.{0,32}${vendor})`,
    "iu",
  ).test(line);
}

function uncataloguedServiceBrands(line) {
  const matches = [];
  const wordsBeforeKinds =
    /\b([\p{Letter}][\p{Letter}\p{Number}.+-]{1,64})\s+(dependency|Dependency|service|Service|library|Library|platform|Platform|API|api|tool|Tool)\b/gu;
  for (const match of line.matchAll(wordsBeforeKinds)) {
    const [, name, kind] = match;
    if (!["dependency", "service", "library", "platform", "api", "tool"]
      .includes(kind.toLocaleLowerCase("en"))) continue;
    if (!/^\p{Uppercase_Letter}\p{Lowercase_Letter}+\p{Uppercase_Letter}\p{Lowercase_Letter}/u
      .test(name)) continue;
    matches.push(name);
  }
  return matches;
}

function explicitProprietaryNames(segment) {
  const kind = "(?:dependency|service|library|platform|API|tool)";
  const name = "((?!(?:is|as|required|selected|used|called|named)\\b)[\\p{Letter}][\\p{Letter}\\p{Number}.+-]{1,64})";
  return [
    new RegExp(`\\b${name}\\s+${kind}\\s+(?:is\\s+)?proprietary\\b`, "iu"),
    new RegExp(`\\b${kind}\\s+${name}\\s+(?:is\\s+)?proprietary\\b`, "iu"),
    new RegExp(`\\b${name}\\s+is\\s+(?:an?\\s+)?proprietary\\s+${kind}\\b`, "iu"),
    new RegExp(`\\bproprietary\\s+${kind}\\s+(?:(?:called|named)\\s+)?${name}\\b`, "iu"),
  ].flatMap((pattern) => pattern.exec(segment)?.[1] ?? []);
}

function hasFossComparison(content, dependencies) {
  const comparisons = semanticSegments(content).filter((segment) =>
    /\b(?:FOSS|free[- ]and[- ]open[- ]source|open[- ]source)\b/iu.test(segment) &&
    /\b(?:compar(?:e[ds]?|ison)|alternative|versus|vs\.?)\b/iu.test(segment));
  return dependencies.every((dependency) => comparisons.some((segment) =>
    dependency.generic
      ? /\bproprietary (?:dependency|service|library|platform|API|tool)\b/iu.test(segment)
      : containsToken(segment, dependency.name)));
}

function semanticSegments(content) {
  return content
    .split(/\n+|;\s*|\s+[—–]\s+|,\s+(?=(?:[Bb]ut|[Ww]hile|[Ww]hereas)\b)|(?<=[.!?])\s+(?=\p{Uppercase_Letter})/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function containsToken(content, token) {
  return new RegExp(
    `(^|[^\\p{Letter}\\p{Number}])${escapeRegExp(token)}(?=$|[^\\p{Letter}\\p{Number}])`,
    "iu",
  ).test(content);
}

function proprietaryExcerpt(content, dependencies) {
  const namedSegment = dependencies[0]?.segment?.trim();
  if (namedSegment) return namedSegment;
  return content.split("\n").find((line) =>
    /\bproprietary\b/iu.test(line) ||
    DEFAULT_VENDOR_TOKENS.some((token) =>
      containsToken(line, token)))?.trim() ??
    "Proprietary dependency declared without a FOSS comparison.";
}

function isAiPipeline(doc, content) {
  if (doc.aiPipeline === true) return true;
  if (doc.aiPipeline === false) return false;
  const declared = frontmatterValue(doc.frontmatter, "ai_pipeline", "aiPipeline");
  if (declared !== undefined) return String(declared).toLowerCase() === "true";
  return /\b(?:AI|LLM|agentic|model) pipeline\b/iu.test(content);
}

function hasMaximumIterationBound(content) {
  return /\b(?:max(?:imum)?[ _-]iterations?|iteration[ _-]bound)\s*(?::|=|is)?\s*\d+\b/iu.test(content);
}

function hasCircuitBreaker(content) {
  return /\bcircuit[ _-]breaker(?:[ _-]condition)?\s*(?::|=|is)\s*\S/iu.test(content);
}

function nonzeroReadCostStatement(content) {
  return content.split("\n").find((line) => {
    if (!/\b(?:discovery|read)(?:[ _-](?:path|view|cost))?\b/iu.test(line)) return false;
    const match = [
      /\b(?:token[ _-]cost|read[ _-]cost|costs?)\s*(?::|=|is|equals?)?\s*([$€£]?\s*\d+(?:\.\d+)?)/iu,
      /\buses?\s+(\d+(?:\.\d+)?)\s+tokens?\b/iu,
    ].map((pattern) => pattern.exec(line)).find(Boolean);
    if (!match) return false;
    const number = Number(match[1].replace(/[$€£\s]/gu, ""));
    return Number.isFinite(number) && number !== 0;
  })?.trim() ?? "";
}

function isFeatureBearing(doc, content) {
  if (doc.featureBearing === true) return true;
  if (doc.featureBearing === false) return false;
  const declared = frontmatterValue(doc.frontmatter, "feature_bearing", "featureBearing");
  if (declared !== undefined) return String(declared).toLowerCase() === "true";
  const type = String(frontmatterValue(doc.frontmatter, "doc_type") ?? "");
  if (frontmatterValue(doc.frontmatter, "capability_id", "capabilityId") !== undefined) {
    return true;
  }
  return /\b(?:feature|PRD|TAD|architecture|capability|runtime contract)\b/iu.test(type) ||
    /\bfeature[- ]bearing\b/iu.test(content);
}

function isUserFacing(doc, content) {
  if (doc.userFacing === true) return true;
  if (doc.userFacing === false) return false;
  const declared = frontmatterValue(doc.frontmatter, "user_facing", "userFacing");
  if (declared !== undefined) return String(declared).toLowerCase() === "true";
  return /\buser[- ]facing capability\b/iu.test(content);
}

function pipelineExcerpt(content) {
  return content.split("\n").find((line) => /\b(?:AI|LLM|agentic|model) pipeline\b/iu.test(line))
    ?.trim() ?? "AI pipeline lacks a complete execution bound.";
}

function frontmatterValue(frontmatter, ...keys) {
  for (const key of keys) {
    const value = frontmatter instanceof Map ? frontmatter.get(key) : frontmatter?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function documentContent(doc) {
  return String(doc.body ?? doc.content ?? doc.text ?? "");
}

function documentContentWithFrontmatter(doc) {
  const entries = doc.frontmatter instanceof Map
    ? [...doc.frontmatter.entries()]
    : Object.entries(doc.frontmatter ?? {});
  return [
    documentContent(doc),
    ...entries.flatMap(([key, value]) => [
      `${key}: ${String(value)}`,
      `${String(key).replaceAll("_", " ")}: ${String(value)}`,
    ]),
  ].join("\n");
}

function documentSubject(doc) {
  return String(doc.documentKey ?? doc.id ?? "document");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compareFindingIdentity(left, right) {
  return left.findingType.localeCompare(right.findingType, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en") ||
    left.evidenceExcerpt.localeCompare(right.evidenceExcerpt, "en");
}

function createFinding(findingType, fields) {
  return makeFinding({
    findingType,
    guidelineAnchor: fields.guidelineAnchor ?? "-",
    artifactReference: fields.artifactReference,
    evidenceExcerpt: fields.evidenceExcerpt,
    remediation: {
      class: "documentation-change",
      statement: fields.statement,
      state: "proposed",
      operatorInstructionRef: null,
    },
  });
}
