import {
  SAFE_TOKEN,
  hasExactKeys,
  isCanonicalOrder,
  isPlainObject,
  isUniqueStringArray,
  sha256,
  stableStringify,
} from "./agentic-graph-mcp-contract-utils.js";

const PARSER_REGISTRY_SCHEMA = "agentic-graph-knowledge-graph-parser-registry/v2";
const DECLARATIVE_GRAMMAR_SCHEMA = "agentic-graph-declarative-grammar/v1";
const ADAPTER_FIDELITIES = Object.freeze({
  "brace-code": "structural-parser",
  "declarative-grammar": "ast",
  inventory: "inventory-only",
  "json-config": "ast",
  markdown: "structural-parser",
  pdf: "native-converted-structure",
  python: "ast",
  sql: "structural-parser",
  "structural-config": "structural-parser",
  typescript: "ast",
});
const GRAMMAR_TOKEN_KINDS = new Set([
  "identifier",
  "newline",
  "number",
  "string",
  "whitespace",
]);
const SAFE_EXTENSION = /^\.[a-z0-9][a-z0-9.+_-]{0,31}$/u;
const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_BASENAME_FAMILY = /^\.[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/u;

function validGrammarTerm(value) {
  const allowed = ["token", "rule", "capture", "min", "max"];
  if (!hasExactKeys(value, allowed, [])) return false;
  const hasToken = Object.hasOwn(value, "token");
  const hasRule = Object.hasOwn(value, "rule");
  if (hasToken === hasRule) return false;
  if (!SAFE_TOKEN.test(hasToken ? value.token : value.rule)) return false;
  if (Object.hasOwn(value, "capture") && !SAFE_TOKEN.test(value.capture)) return false;
  const min = value.min ?? 1;
  const max = value.max ?? 1;
  return Number.isInteger(min)
    && Number.isInteger(max)
    && min >= 0
    && max >= 1
    && min <= max
    && max <= 256;
}

function validDeclarativeGrammar(value) {
  if (!hasExactKeys(value, ["schema", "start", "tokens", "rules"])) return false;
  if (value.schema !== DECLARATIVE_GRAMMAR_SCHEMA
    || !SAFE_TOKEN.test(value.start)
    || !Array.isArray(value.tokens)
    || value.tokens.length < 1
    || value.tokens.length > 64
    || !Array.isArray(value.rules)
    || value.rules.length < 1
    || value.rules.length > 128) return false;
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 128 * 1024) return false;
  } catch {
    return false;
  }
  const tokensValid = value.tokens.every((token) => {
    if (!isPlainObject(token) || !SAFE_TOKEN.test(token.id)) return false;
    const literal = Object.hasOwn(token, "literal");
    const kind = Object.hasOwn(token, "kind");
    if (literal === kind) return false;
    if (literal) {
      return hasExactKeys(token, ["id", "literal"])
        && typeof token.literal === "string"
        && token.literal.length >= 1
        && token.literal.length <= 64
        && !/[\u0000-\u001f\u007f]/u.test(token.literal);
    }
    return hasExactKeys(token, ["id", "kind", "skip"], ["id", "kind"])
      && GRAMMAR_TOKEN_KINDS.has(token.kind)
      && (!Object.hasOwn(token, "skip") || typeof token.skip === "boolean");
  });
  const rulesValid = value.rules.every((rule) => (
    hasExactKeys(rule, ["id", "alternatives"])
    && SAFE_TOKEN.test(rule.id)
    && Array.isArray(rule.alternatives)
    && rule.alternatives.length >= 1
    && rule.alternatives.length <= 32
    && rule.alternatives.every((alternative) => (
      hasExactKeys(alternative, ["sequence"])
      && Array.isArray(alternative.sequence)
      && alternative.sequence.length >= 1
      && alternative.sequence.length <= 64
      && alternative.sequence.every(validGrammarTerm)
    ))
  ));
  return tokensValid
    && rulesValid
    && new Set(value.tokens.map(({ id }) => id)).size === value.tokens.length
    && new Set(value.rules.map(({ id }) => id)).size === value.rules.length;
}

const intersects = (left, right) => [...left].some((entry) => right.has(entry));
const unionInto = (target, values) => {
  const before = target.size;
  for (const value of values) target.add(value);
  return target.size !== before;
};

function validCanonicalGeneratedGrammar(grammar) {
  if (!validDeclarativeGrammar(grammar)
    || !isCanonicalOrder(grammar.tokens, ({ id }) => id)
    || !isCanonicalOrder(grammar.rules, ({ id }) => id)
    || grammar.rules.some(({ alternatives }) => (
      !isCanonicalOrder(alternatives, stableStringify)
      || alternatives.some(({ sequence }) => sequence.some((term) => (
        !Object.hasOwn(term, "min") || !Object.hasOwn(term, "max")
      )))
    ))) return false;

  const tokenById = new Map(grammar.tokens.map((token) => [token.id, token]));
  const ruleById = new Map(grammar.rules.map((rule) => [rule.id, rule]));
  if (!ruleById.has(grammar.start)) return false;
  const literalOwners = new Set();
  const kindOwners = new Set();
  for (const token of grammar.tokens) {
    const owners = Object.hasOwn(token, "literal") ? literalOwners : kindOwners;
    const identity = Object.hasOwn(token, "literal") ? token.literal : token.kind;
    if (owners.has(identity)) return false;
    owners.add(identity);
  }
  for (const rule of grammar.rules) {
    for (const { sequence } of rule.alternatives) {
      for (const term of sequence) {
        if (term.token) {
          const token = tokenById.get(term.token);
          if (!token || token.skip) return false;
        } else if (!ruleById.has(term.rule)) return false;
      }
    }
  }

  const reachable = new Set([grammar.start]);
  const pending = [grammar.start];
  while (pending.length) {
    for (const { sequence } of ruleById.get(pending.pop()).alternatives) {
      for (const term of sequence) {
        if (term.rule && !reachable.has(term.rule)) {
          reachable.add(term.rule);
          pending.push(term.rule);
        }
      }
    }
  }
  if (reachable.size !== grammar.rules.length) return false;

  const nullable = new Map(grammar.rules.map(({ id }) => [id, false]));
  const derivable = new Map(grammar.rules.map(({ id }) => [id, false]));
  for (let pass = 0; pass < grammar.rules.length; pass += 1) {
    let changed = false;
    for (const rule of grammar.rules) {
      for (const { sequence } of rule.alternatives) {
        const isNullable = sequence.every((term) => (
          term.min === 0 || (term.rule ? nullable.get(term.rule) : false)
        ));
        const isDerivable = sequence.every((term) => (
          term.min === 0 || Boolean(term.token) || derivable.get(term.rule)
        ));
        if (isNullable && !nullable.get(rule.id)) {
          nullable.set(rule.id, true);
          changed = true;
        }
        if (isDerivable && !derivable.get(rule.id)) {
          derivable.set(rule.id, true);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  if ([...nullable.values()].some(Boolean) || [...derivable.values()].some((value) => !value)) {
    return false;
  }

  const leftCorners = new Map(grammar.rules.map(({ id }) => [id, new Set()]));
  for (const rule of grammar.rules) {
    for (const { sequence } of rule.alternatives) {
      for (const term of sequence) {
        if (term.rule) leftCorners.get(rule.id).add(term.rule);
        if (!(term.min === 0 || (term.rule && nullable.get(term.rule)))) break;
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (ruleId) => {
    if (visiting.has(ruleId)) return false;
    if (visited.has(ruleId)) return true;
    visiting.add(ruleId);
    for (const child of leftCorners.get(ruleId)) if (!visit(child)) return false;
    visiting.delete(ruleId);
    visited.add(ruleId);
    return true;
  };
  if (grammar.rules.some(({ id }) => !visit(id))) return false;

  const first = new Map(grammar.rules.map(({ id }) => [id, new Set()]));
  const firstOfTerm = (term) => (
    term.token ? new Set([term.token]) : first.get(term.rule)
  );
  const firstOfSequence = (sequence) => {
    const values = new Set();
    for (const term of sequence) {
      unionInto(values, firstOfTerm(term));
      if (!(term.min === 0 || (term.rule && nullable.get(term.rule)))) break;
    }
    return values;
  };
  for (let pass = 0; pass < grammar.rules.length * 2; pass += 1) {
    let changed = false;
    for (const rule of grammar.rules) {
      for (const { sequence } of rule.alternatives) {
        changed = unionInto(first.get(rule.id), firstOfSequence(sequence)) || changed;
      }
    }
    if (!changed) break;
  }
  for (const rule of grammar.rules) {
    const alternativeFirst = rule.alternatives.map(({ sequence }) => firstOfSequence(sequence));
    for (let left = 0; left < alternativeFirst.length; left += 1) {
      for (let right = left + 1; right < alternativeFirst.length; right += 1) {
        if (intersects(alternativeFirst[left], alternativeFirst[right])) return false;
      }
    }
    for (const { sequence } of rule.alternatives) {
      for (let index = 0; index < sequence.length; index += 1) {
        const term = sequence[index];
        if ((term.min === 0 || term.max > 1 || (term.rule && nullable.get(term.rule)))
          && intersects(firstOfTerm(term), firstOfSequence(sequence.slice(index + 1)))) {
          return false;
        }
      }
    }
  }
  return true;
}

function validParserDescriptor(value, { generated }) {
  const allowed = [
    "id", "kind", "adapter", "fidelity", "extensions",
    "basenames", "basenameFamilies", "priority", "grammar",
  ];
  const required = generated
    ? allowed.filter((key) => key !== "grammar")
    : ["id", "kind", "adapter", "fidelity"];
  if (!hasExactKeys(value, allowed, required)
    || !SAFE_TOKEN.test(value.id)
    || !SAFE_TOKEN.test(value.kind)
    || ADAPTER_FIDELITIES[value.adapter] !== value.fidelity) return false;
  const matcherKeys = ["extensions", "basenames", "basenameFamilies"];
  const matcherPatterns = [SAFE_EXTENSION, SAFE_BASENAME, SAFE_BASENAME_FAMILY];
  if (!matcherKeys.every((key, index) => (
    value[key] === undefined || isUniqueStringArray(value[key], matcherPatterns[index], 64)
  ))) return false;
  if (!matcherKeys.some((key) => Array.isArray(value[key]) && value[key].length > 0)) return false;
  if (value.priority !== undefined && (
    !Number.isInteger(value.priority) || value.priority < -1_000 || value.priority > 1_000
  )) return false;
  const hasGrammar = Object.hasOwn(value, "grammar");
  return value.adapter === "declarative-grammar"
    ? hasGrammar && validDeclarativeGrammar(value.grammar)
    : !hasGrammar;
}

export function validParserDescriptors(value, options) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128
    || !value.every((descriptor) => validParserDescriptor(descriptor, options))) return false;
  return new Set(value.map(({ id }) => id)).size === value.length
    && new Set(value.map(({ kind }) => kind)).size === value.length;
}

export function validParserRegistry(value, expectedDigest) {
  if (!hasExactKeys(value, ["schema", "digest", "descriptors"])
    || value.schema !== PARSER_REGISTRY_SCHEMA
    || value.digest !== expectedDigest
    || !validParserDescriptors(value.descriptors, { generated: true })
    || !isCanonicalOrder(value.descriptors, ({ id }) => id)) return false;
  const matcherOwners = ["extensions", "basenames", "basenameFamilies"].map(() => new Map());
  for (const descriptor of value.descriptors) {
    if (![descriptor.extensions, descriptor.basenames, descriptor.basenameFamilies]
      .every((matchers) => isCanonicalOrder(matchers))) return false;
    if (descriptor.adapter === "declarative-grammar"
      && !validCanonicalGeneratedGrammar(descriptor.grammar)) return false;
    for (const [index, matchers] of [
      descriptor.extensions,
      descriptor.basenames,
      descriptor.basenameFamilies,
    ].entries()) {
      for (const matcher of matchers) {
        const owner = matcherOwners[index].get(matcher.toLowerCase());
        if (owner?.priority === descriptor.priority) return false;
        if (!owner || owner.priority < descriptor.priority) {
          matcherOwners[index].set(matcher.toLowerCase(), descriptor);
        }
      }
    }
  }
  return value.digest === sha256(stableStringify(value.descriptors));
}
