import { fc as loadedFastCheck } from "./alignment-audit-fast-check.mjs";

import {
  ABSENT,
  ARTIFACT_ENTRY_KINDS,
  createArtifactIndex,
} from "../../scripts/alignment-audit/artifact-index.mjs";
import {
  createGuidelineModel,
  NORMATIVE_ELEMENT_CLASSES,
  NORMATIVE_ELEMENT_KINDS,
} from "../../scripts/alignment-audit/guideline-model.mjs";
import {
  elementIdFrom,
  entryIdFrom,
  normalizeContent,
} from "../../scripts/alignment-audit/normalize.mjs";

const unavailableArbitrary = {
  chain() {
    return this;
  },
  filter() {
    return this;
  },
  map() {
    return this;
  },
};
const unavailableFastCheck = new Proxy(
  {},
  { get: () => () => unavailableArbitrary },
);
const fc = loadedFastCheck ?? unavailableFastCheck;

export const READINESS_LADDER = Object.freeze([
  "undocumented",
  "spec-complete",
  "dev-proven",
  "runtime-ready",
  "production-verified",
]);

const safeCharacter = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789");
const safeToken = fc
  .stringOf(safeCharacter, { minLength: 1, maxLength: 16 })
  .filter((value) => /[a-z]/u.test(value));
const hostileFragments = [
  "~",
  "~~~",
  "~~~~~~ at line start",
  "| field | value |",
  "---",
  "`code`",
  "``nested``",
  "\n\n",
  " leading",
  "trailing ",
  "\r\n",
  "café",
  "零",
  "(absent)",
  "(empty)",
  "(none)",
];

export const arbNormalizedText = fc
  .array(
    fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...hostileFragments) },
      { weight: 2, arbitrary: fc.string({ minLength: 0, maxLength: 24 }) },
    ),
    { minLength: 0, maxLength: 8 },
  )
  .map((parts) => parts.join("\n"));

export const arbReservedToken = fc.constantFrom("(absent)", "(empty)", "(none)");

const arbModelDocument = fc.oneof(
  safeToken.map((documentKey) => ({
    documentKey,
    frontmatterKeys: [],
    sectionAnchors: [],
    universalScope: false,
    elements: [],
  })),
  fc
    .array(safeToken, { minLength: 1, maxLength: 5 })
    .chain((sectionAnchors) =>
      fc.record({
        documentKey: safeToken,
        frontmatterKeys: fc.array(safeToken, { maxLength: 8 }),
        universalScope: fc.boolean(),
        elements: fc.array(
          fc.record({
            sectionAnchor: fc.constantFrom(...[...new Set(sectionAnchors)]),
            kind: fc.constantFrom(...NORMATIVE_ELEMENT_KINDS),
            class: fc.constantFrom(...NORMATIVE_ELEMENT_CLASSES),
            gateId: fc.option(safeToken, { nil: null }),
            text: arbNormalizedText,
          }),
          { maxLength: 14 },
        ),
      }).map((record) => {
        const ordinals = new Map();
        const elements = record.elements.map((element) => {
          const ordinal = ordinals.get(element.sectionAnchor) ?? 0;
          ordinals.set(element.sectionAnchor, ordinal + 1);
          return {
            ...element,
            documentKey: record.documentKey,
            elementId: elementIdFrom(element.sectionAnchor, element.text),
            ordinal,
          };
        });
        return { ...record, sectionAnchors, elements };
      }),
    ),
);

export const arbGuidelineModel = fc
  .uniqueArray(arbModelDocument, {
    minLength: 0,
    maxLength: 6,
    selector: (document) => document.documentKey,
  })
  .map((documentSeeds) => {
    const documents = new Map();
    const elements = [];
    const gates = [];
    for (const seed of documentSeeds) {
      documents.set(seed.documentKey, {
        documentKey: seed.documentKey,
        frontmatterKeys: seed.frontmatterKeys,
        sectionAnchors: seed.sectionAnchors,
        universalScope: seed.universalScope,
      });
      elements.push(...seed.elements);
      for (const gateId of [
        ...new Set(seed.elements.map((element) => element.gateId).filter(Boolean)),
      ]) {
        gates.push({
          gateId,
          documentKey: seed.documentKey,
          sectionAnchor:
            seed.elements.find((element) => element.gateId === gateId)?.sectionAnchor ?? "",
          order: gates.length,
          entryCondition: `entry for ${gateId}`,
          exitCondition: `exit for ${gateId}`,
          requiredEvidenceType: `evidence for ${gateId}`,
        });
      }
    }
    return createGuidelineModel(documents, elements, gates);
  });

export const arbElementSeed = fc
  .record({
    anchor: safeToken,
    kind: fc.constantFrom(...NORMATIVE_ELEMENT_KINDS),
    roleHint: fc.constantFrom("artifact-bearing", "advisory"),
    token: safeToken,
  })
  .map((seed) => {
    const text = seededElementText(seed);
    return {
      anchor: seed.anchor,
      kind: seed.kind,
      roleHint: seed.roleHint,
      gateId: seed.kind === "phase-gate-condition" ? `gate-${seed.anchor}` : null,
      text,
    };
  });

export const arbGuidelineDocument = fc
  .uniqueArray(arbElementSeed, {
    maxLength: 40,
    selector: (seed) => `${seed.anchor}\0${seed.kind}\0${seed.text}`,
  })
  .chain((seeds) =>
    safeToken.map((documentKey) => renderGuidelineDocument(documentKey, seeds)),
  );

const scalarValue = fc.oneof(
  { weight: 2, arbitrary: fc.constant(ABSENT) },
  { weight: 2, arbitrary: fc.constant("") },
  { weight: 6, arbitrary: arbNormalizedText },
);
const arbRoute = fc.record({
  surface: fc.constantFrom("slash", "hash", "at", "mcp"),
  token: safeToken.map((token) => `route-${token}`),
});

export const arbArtifactIndex = fc
  .uniqueArray(
    fc.record({
      entryId: safeToken,
      documentKey: safeToken,
      entryKind: fc.constantFrom(...ARTIFACT_ENTRY_KINDS),
      capabilityId: scalarValue,
      declaredStatus: scalarValue,
      declaredRuntimeScope: scalarValue,
      declaredOwner: scalarValue,
      declaredProofReference: scalarValue,
      commandText: scalarValue,
      contractRole: fc.oneof(
        fc.constant(ABSENT),
        fc.constantFrom("document", "federation", "catalog"),
      ),
      invocationRoutes: fc.array(arbRoute, { maxLength: 8 }),
      toolIdentities: fc.array(arbNormalizedText, { maxLength: 6 }),
      documentedStageOrder: fc.array(safeToken, { maxLength: 6 }),
      federatedToolIdentities: fc.array(arbNormalizedText, { maxLength: 4 }),
      cataloguedToolIdentities: fc.array(arbNormalizedText, { maxLength: 4 }),
      excerpt: arbNormalizedText,
    }),
    { maxLength: 30, selector: (entry) => entry.entryId },
  )
  .map((entries) => createArtifactIndex(entries));

export const arbEntrySeed = fc
  .record({
    entryKind: fc.constantFrom(
      "contract-schema",
      "validation-command",
      "readiness-status",
    ),
    capabilityId: safeToken,
    declaredRuntimeScope: safeToken,
    declaredOwner: safeToken,
    declaredProofReference: safeToken.map(
      (token) => `end=${token}; check=local-${token}; constraint=workspace`,
    ),
    status: fc.oneof(
      fc.constantFrom(...READINESS_LADDER),
      safeToken
        .map((token) => `off-ladder-${token}`)
        .filter((value) => !READINESS_LADDER.includes(value)),
    ),
    commandText: fc.constantFrom(
      "node --test",
      'node -e "console.log(\'proof\')"',
      "npm test | tee proof.txt",
      "node --test --test-name-pattern='audit'",
    ),
    schema: safeToken.map((token) => `${token}/v1`),
  })
  .map((seed) => ({
    ...seed,
    declaredValue:
      seed.entryKind === "readiness-status"
        ? seed.status
        : seed.entryKind === "validation-command"
          ? seed.commandText
          : seed.schema,
  }));

export const arbRuntimeDocument = fc
  .uniqueArray(arbEntrySeed, {
    maxLength: 20,
    selector: (seed) =>
      `${seed.entryKind}\0${seed.capabilityId}\0${seed.declaredValue}`,
  })
  .chain((seeds) => safeToken.map((documentKey) => renderRuntimeDocument(documentKey, seeds)));

export const arbDocumentSet = fc
  .uniqueArray(arbRuntimeDocument, {
    maxLength: 8,
    selector: (item) => item.document.documentKey,
  })
  .chain((items) =>
    fc
      .tuple(safeToken, safeToken)
      .filter(([left, right]) => left !== right)
      .map(([left, right]) => ({
        documents: items.map((item, index) => ({
          ...item.document,
          locator: `/${left}/nested-${index}/original-${index}.md`,
        })),
        relocatedDocuments: items.map((item, index) => ({
          ...item.document,
          locator: `/${right}/depth/changed-${index}/renamed-${index}.md`,
        })),
        firstContainer: left,
        secondContainer: right,
      })),
  );

function seededElementText(seed) {
  if (seed.kind === "anti-pattern-guard") {
    return seed.roleHint === "artifact-bearing"
      ? `Prohibited: omit the evidence record ${seed.token}\nCorrected: record the evidence value ${seed.token}`
      // Keep the shrink token opaque so values such as "id" cannot change the generated role.
      : `Prohibited: rigid framing sample${seed.token}\nCorrected: prefer adaptable framing sample${seed.token}`;
  }
  if (seed.kind === "required-template-field") {
    return seed.roleHint === "artifact-bearing"
      ? `Evidence field: required recorded value ${seed.token}`
      : `Framing field: prefer concise language ${seed.token}`;
  }
  return seed.roleHint === "artifact-bearing"
    ? `MUST record a named check value ${seed.token}.`
    : `Prefer adaptable framing ${seed.token}.`;
}

function renderGuidelineDocument(documentKey, seeds) {
  const byAnchor = new Map();
  for (const seed of seeds) {
    if (!byAnchor.has(seed.anchor)) byAnchor.set(seed.anchor, []);
    byAnchor.get(seed.anchor).push(seed);
  }
  const lines = [
    "---",
    `title: Guideline ${documentKey}`,
    "doc_type: guideline",
    "universal_scope: true",
    "---",
    "",
  ];
  for (const [anchor, anchoredSeeds] of byAnchor) {
    lines.push(`## Section ${anchor} {#${anchor}}`, "");
    for (const seed of anchoredSeeds) {
      if (seed.kind === "directive") {
        lines.push("### Directives", `- ${seed.text}`, "");
      } else if (seed.kind === "phase-gate-condition") {
        lines.push(`### Gate: ${seed.gateId}`, `1. ${seed.text}`, "");
      } else if (seed.kind === "checklist-item") {
        lines.push("### Checklist", `- [ ] ${seed.text}`, "");
      } else if (seed.kind === "required-template-field") {
        lines.push("### Template", `- ${seed.text}`, "");
      } else {
        const [prohibited, corrected] = seed.text.split("\n");
        lines.push("### Anti-patterns", `- ${prohibited}`, `- ${corrected}`, "");
      }
    }
  }
  return {
    document: { documentKey, text: `${lines.join("\n")}\n`, inputRole: "guideline" },
    seeds,
    requiredKeys: ["title", "doc_type", "universal_scope"],
  };
}

function renderRuntimeDocument(documentKey, seeds) {
  const lines = [
    "---",
    `title: Runtime ${documentKey}`,
    "doc_type: runtime-contract",
    "---",
    "",
    "## Declarations",
    "",
    "| capability_id | status | validation_command | contract_schema | runtime_scope | owner | proof_reference |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const seed of seeds) {
    const status = seed.entryKind === "readiness-status" ? seed.status : "";
    const command = seed.entryKind === "validation-command" ? seed.commandText : "";
    const schema = seed.entryKind === "contract-schema" ? seed.schema : "";
    lines.push(
      `| ${seed.capabilityId} | ${escapeTable(status)} | ${escapeTable(command)} | ${escapeTable(schema)} | ${seed.declaredRuntimeScope} | ${seed.declaredOwner} | ${seed.declaredProofReference} |`,
    );
  }
  return {
    document: { documentKey, text: `${lines.join("\n")}\n`, inputRole: "runtime" },
    seeds,
  };
}

export function escapeTable(value) {
  return String(value).replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}

export function expectedGuidelineElements(generated) {
  return generated.seeds.map((seed) => ({
    kind: seed.kind,
    sectionAnchor: seed.anchor,
    text: normalizeContent(seed.text),
    class: seed.roleHint,
    elementId: elementIdFrom(seed.anchor, seed.text),
  }));
}

export function arbitraryEntryId(seed, documentKey, position) {
  return entryIdFrom(documentKey, seed.entryKind, [
    seed.entryKind,
    position,
    seed.declaredValue,
  ]);
}
