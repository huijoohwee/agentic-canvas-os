import { makeFinding } from "./finding.mjs";

export const DEFAULT_VENDOR_TOKENS = Object.freeze([
  "AcmeCloud",
  "Anthropic",
  "Apple",
  "Amazon Web Services",
  "AWS",
  "Azure",
  "Cloudflare",
  "Datadog",
  "Firebase",
  "GitHub",
  "Google",
  "IBM",
  "Meta",
  "Microsoft",
  "MongoDB",
  "Netlify",
  "OpenAI",
  "Oracle",
  "Salesforce",
  "Snowflake",
  "Stripe",
  "Supabase",
  "Twilio",
  "Vercel",
]);

export function checkNeutrality(docs = [], universalScope = new Set()) {
  const findings = [];
  const vendorCouplingCountByRole = {};

  for (const doc of docs) {
    const subject = documentSubject(doc);
    const role = String(doc.inputRole ?? doc.role ?? "unspecified");
    vendorCouplingCountByRole[role] ??= 0;
    const content = documentContent(doc);
    const universal = isUniversalDocument(doc, subject, universalScope);

    if (universal) {
      const referenceFree = withoutReferenceImplementationBlocks(content);
      for (const token of vendorTokensFor(doc, content)) {
        if (!containsToken(referenceFree, token)) continue;
        findings.push(createFinding("vendor-coupling", {
          guidelineAnchor: `vendor:${token}`,
          artifactReference: subject,
          evidenceExcerpt: excerptContaining(referenceFree, token),
          statement: "Replace the vendor token with a functional capability name or label it as a reference implementation.",
        }));
        vendorCouplingCountByRole[role] += 1;
      }

      for (const section of markdownSections(content)) {
        if (dependsOnUnnamedSection(section)) {
          findings.push(createFinding("non-modular-section", {
            guidelineAnchor: section.anchor,
            artifactReference: subject,
            evidenceExcerpt: dependencyStatement(section.body),
            statement: "Name the depended-on section explicitly so this section remains liftable.",
          }));
        }
      }

      const contradiction = scopeContradiction(content);
      if (contradiction) {
        findings.push(createFinding("scope-contradiction", {
          guidelineAnchor: "scope",
          artifactReference: subject,
          evidenceExcerpt: contradiction,
          statement: "Remove the single-product or single-runtime constraint from the universal-scope declaration.",
        }));
      }
    }

    for (const statement of pathDerivedStatements(content)) {
      findings.push(createFinding("path-derived-claim", {
        guidelineAnchor: `path-claim:${statement}`,
        artifactReference: subject,
        evidenceExcerpt: statement,
        statement: "Derive the normative claim from parsed document content rather than a path or directory name.",
      }));
    }
  }

  return {
    findings: findings.sort(compareFindingIdentity),
    vendorCouplingCountByRole: Object.fromEntries(
      Object.entries(vendorCouplingCountByRole)
        .sort(([left], [right]) => left.localeCompare(right, "en")),
    ),
  };
}

function isUniversalDocument(doc, subject, universalScope) {
  if (universalScope instanceof Set && universalScope.has(subject)) return true;
  if (typeof universalScope?.has === "function" && universalScope.has(subject)) return true;
  if (doc.universalScope === true) return true;
  if (doc.universalScope === false) return false;
  const value = frontmatterValue(doc.frontmatter, "universal_scope", "universalScope");
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return /^(?:This (?:document|guideline)|These guidelines)\s+(?:has universal scope|(?:applies|apply) to any (?:product|domain|language|runtime)|(?:applies|apply) regardless of (?:product|domain|language|runtime))\b/imu
    .test(documentContent(doc));
}

function vendorTokensFor(doc, content) {
  const declared = [
    ...arrayOf(doc.vendorTokens),
    ...parseList(frontmatterValue(doc.frontmatter, "vendor_tokens")),
  ].map(String);
  const labelled = [...content.matchAll(
    /\b(?:vendor|brand|product)[ _-]token\s*:\s*["'`]?([\p{Letter}\p{Number} ._-]+)["'`]?/giu,
  )].map((match) => match[1].trim());
  const source = declared.length > 0 || labelled.length > 0
    ? [...declared, ...labelled]
    : DEFAULT_VENDOR_TOKENS;
  return [...new Set([
    ...source,
    ...contextualVendorTokens(content),
  ].filter(Boolean))].sort((left, right) => left.localeCompare(right, "en"));
}

function contextualVendorTokens(content) {
  const token = String.raw`\p{Uppercase_Letter}[\p{Letter}\p{Number}._+-]*`;
  const name = String.raw`(${token}(?:\s+${token}){0,3})`;
  const patterns = [
    new RegExp(String.raw`\b(?:[Vv]endor|[Bb]rand|[Pp]roduct)\s*:\s*${name}\b`, "gu"),
    new RegExp(String.raw`\b(?:[Tt]he\s+)?(?:vendor|Vendor|brand|Brand|product|Product)\s+${name}\b`, "gu"),
    new RegExp(String.raw`(?:^|[.!?]\s+)(?:[Uu]se|[Uu]ses|[Uu]sing|[Rr]equire[sd]?|[Ss]elect(?:ed|s)?)\s+(?:the\s+)?${name}\s+(?:product|vendor|brand)\b`, "gu"),
    new RegExp(String.raw`\b${name}\s+is\s+(?:the\s+)?(?:required\s+)?(?:SaaS\s+)?(?:vendor|product|brand)\b`, "gu"),
  ];
  return patterns.flatMap((pattern) =>
    [...String(content).matchAll(pattern)].map((match) => match[1].trim()));
}

function withoutReferenceImplementationBlocks(content) {
  const lines = content.split("\n");
  const kept = [];
  let headingDepth = null;
  let directiveBlock = false;
  for (const line of lines) {
    if (/^:::\s*reference[- ]implementation\b/iu.test(line)) {
      directiveBlock = true;
      continue;
    }
    if (directiveBlock) {
      if (/^:::\s*$/u.test(line)) directiveBlock = false;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      const depth = heading[1].length;
      if (/reference[- ]implementation/iu.test(heading[2])) {
        headingDepth = depth;
        continue;
      }
      if (headingDepth !== null && depth <= headingDepth) headingDepth = null;
    }
    if (headingDepth === null) kept.push(line);
  }
  return kept.join("\n");
}

function markdownSections(content) {
  const result = [];
  const matches = [...content.matchAll(/^##\s+(.+)$/gmu)];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? content.length;
    result.push({
      anchor: slug(matches[index][1]),
      title: matches[index][1],
      body: content.slice(start, end),
    });
  }
  return result;
}

function dependsOnUnnamedSection(section) {
  const statement = dependencyStatement(section.body);
  if (!statement) return false;
  if (/`[^`]+`|["'][^"']+["']|\bsection\s+[A-Z0-9][\w -]+/u.test(statement)) return false;
  return /\b(?:previous|above|below|another|other|earlier|later)\s+section\b/iu.test(statement) ||
    /\bdepends on (?:the )?(?:previous|above|below|another|other)\b/iu.test(statement);
}

function dependencyStatement(body) {
  return sentences(body).find((sentence) =>
    /\b(?:depends on|see (?:the )?(?:previous|above|below)|previous section|section above|section below)\b/iu
      .test(sentence)) ?? "";
}

function pathDerivedStatements(content) {
  return sentences(content).filter((sentence) => {
    const pathSubject = /\b(?:file ?path|path segment|directory name|folder name|file name|directory layout)\b/iu
      .test(sentence);
    const derivation = /\b(?:derive[sd]?|determine[sd]?|infer(?:red|s)?|because of|based on)\b/iu
      .test(sentence);
    const normative = /\b(?:must|shall|required|normative|readiness|status|owner|claim)\b/iu
      .test(sentence);
    const negated = /\b(?:never|not)\s+(?:be\s+)?(?:derive|determine|infer)|\bforbid\b/iu
      .test(sentence) ||
      /\bno\b[^.!?\n]{0,80}\b(?:derive[sd]?|determine[sd]?|infer(?:red|s)?)\b/iu
        .test(sentence) ||
      /\b(?:exclude|ignore|independent of|rather than|instead of|must not use)\b.{0,80}\b(?:file ?path|path segment|directory name|folder name|file name|directory layout)\b/iu
        .test(sentence) ||
      /\b(?:file ?path|path segment|directory name|folder name|file name|directory layout)\b.{0,80}\b(?:excluded|ignored|not literals)\b/iu
        .test(sentence);
    const metarule = /\b(?:when|if)\s+(?:an? )?(?:audited )?document\b/iu.test(sentence) ||
      /^document states that a normative claim derives\b/iu.test(sentence) ||
      /\b(?:Finding(?:_Type)?|path-derived-claim)\b/iu.test(sentence);
    return pathSubject && derivation && normative && !negated && !metarule;
  });
}

function scopeContradiction(content) {
  return sentences(content).find((sentence) =>
    /\b(?:only applies to|limited to|specific to|must run (?:only )?(?:on|in)|supports only)\b/iu
      .test(sentence) &&
    /\b(?:runtime|product|repository|framework|vendor|platform)\b/iu.test(sentence)) ?? "";
}

function sentences(content) {
  return content
    .split(/\n|(?<=[.!?])\s+/u)
    .map((value) => value.replace(/^[-*]\s+/u, "").trim())
    .filter(Boolean);
}

function containsToken(content, token) {
  return new RegExp(`(^|[^\\p{Letter}\\p{Number}])${escapeRegExp(token)}(?=$|[^\\p{Letter}\\p{Number}])`, "iu")
    .test(content);
}

function excerptContaining(content, token) {
  return content.split("\n").find((line) => containsToken(line, token))?.trim() ?? token;
}

function documentContent(doc) {
  return String(doc.body ?? doc.content ?? doc.text ?? "");
}

function documentSubject(doc) {
  return String(doc.documentKey ?? doc.id ?? "document");
}

function frontmatterValue(frontmatter, ...keys) {
  for (const key of keys) {
    const value = frontmatter instanceof Map ? frontmatter.get(key) : frontmatter?.[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to comma-separated scalar parsing.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/gu, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function arrayOf(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function compareFindingIdentity(left, right) {
  return left.findingType.localeCompare(right.findingType, "en") ||
    left.guidelineAnchor.localeCompare(right.guidelineAnchor, "en") ||
    left.artifactReference.localeCompare(right.artifactReference, "en");
}

function createFinding(findingType, fields) {
  return makeFinding({
    findingType,
    guidelineAnchor: fields.guidelineAnchor ?? "-",
    artifactReference: fields.artifactReference ?? "-",
    evidenceExcerpt: fields.evidenceExcerpt,
    remediation: {
      class: "documentation-change",
      statement: fields.statement,
      state: "proposed",
      operatorInstructionRef: null,
    },
  });
}
