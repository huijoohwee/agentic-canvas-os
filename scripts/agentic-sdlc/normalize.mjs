export function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function stringArray(value) {
  return array(value).map(text).filter(Boolean);
}

export function uniqueSortedStrings(value) {
  return [...new Set(stringArray(value))].sort(compareText);
}

export function array(value) {
  return Array.isArray(value) ? value : [];
}

export function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

export function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function sameStableValue(left, right) {
  return stableJson(left) === stableJson(right);
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function populatedResult(value) {
  if (typeof value === "string") {
    const normalized = text(value).toLocaleLowerCase("en-US");
    if (!normalized) return false;
    return ![
      "result exists",
      "results exist",
      "evidence exists",
      "passed elsewhere",
      "see output",
      "success asserted",
    ].includes(normalized);
  }
  const result = object(value);
  const summary = text(result.summary);
  const summaryWithoutZeroFailures = summary.replace(
    /\b(?:0|zero|no)\s+(?:checks?\s+)?(?:fail(?:ed|ure|ures|ing)?|errors?)\b/giu,
    "",
  ).replace(
    /\b(?:failures?|errors?)\s*:\s*(?:0|zero|none)\b/giu,
    "",
  );
  const reportsFailure =
    /\b(?:fail(?:ed|ure|ures|ing)?|errors?|not[- ]passed)\b/iu
      .test(summaryWithoutZeroFailures);
  const reportsSuccess =
    /\b(?:pass(?:ed|ing)?|success(?:ful)?)\b/iu.test(summary);
  const contradictorySummary = result.exitCode === 0
    ? reportsFailure
    : reportsSuccess && !reportsFailure;
  const countsPresent = result.counts !== undefined;
  const counts = object(result.counts);
  const countFields = ["total", "passed", "failed", "errored", "skipped"];
  const countsValid = !countsPresent || (
    countFields.every((field) =>
      Number.isInteger(counts[field]) && counts[field] >= 0)
    && counts.total === (
      counts.passed + counts.failed + counts.errored + counts.skipped
    )
  );
  const measurementsPresent = result.measurements !== undefined;
  const measurements = array(result.measurements);
  const measurementsValid = !measurementsPresent || (
    measurements.length > 0
    && measurements.every(validMeasurement)
  );
  const measurementOutcomes = measurements.map(measurementSatisfied);
  const structuredOutcome = countsPresent || measurementsPresent;
  const successfulOutcome = (
    (!countsPresent || (
      counts.passed > 0
      && counts.failed === 0
      && counts.errored === 0
    ))
    && measurementOutcomes.every(Boolean)
  );
  const failedOutcome = (
    (countsPresent && counts.failed + counts.errored > 0)
    || measurementOutcomes.some((satisfied) => !satisfied)
  );
  return result.ran === true
    && Number.isInteger(result.exitCode)
    && text(result.status) === (
      result.exitCode === 0 ? "passed" : "failed"
    )
    && summary.length > 0
    && !contradictorySummary
    && structuredOutcome
    && countsValid
    && measurementsValid
    && (result.exitCode === 0 ? successfulOutcome : failedOutcome);
}

function validMeasurement(measurementInput) {
  const measurement = object(measurementInput);
  const comparator = text(measurement.comparator);
  const observedType = typeof measurement.observed;
  const expectedType = typeof measurement.expected;
  const scalarTypes = ["boolean", "number", "string"];
  return Boolean(text(measurement.name))
    && Boolean(text(measurement.unit))
    && ["eq", "ne", "lt", "lte", "gt", "gte"].includes(comparator)
    && scalarTypes.includes(observedType)
    && scalarTypes.includes(expectedType)
    && (
      ["eq", "ne"].includes(comparator)
        ? observedType === expectedType
        : observedType === "number"
          && expectedType === "number"
          && Number.isFinite(measurement.observed)
          && Number.isFinite(measurement.expected)
    );
}

function measurementSatisfied(measurementInput) {
  const measurement = object(measurementInput);
  if (!validMeasurement(measurement)) return false;
  const comparator = text(measurement.comparator);
  if (comparator === "eq") return Object.is(
    measurement.observed,
    measurement.expected,
  );
  if (comparator === "ne") return !Object.is(
    measurement.observed,
    measurement.expected,
  );
  if (comparator === "lt") return measurement.observed < measurement.expected;
  if (comparator === "lte") return measurement.observed <= measurement.expected;
  if (comparator === "gt") return measurement.observed > measurement.expected;
  return measurement.observed >= measurement.expected;
}

export function pathWithinScope(pathInput, scopeInput) {
  const path = normalizePath(pathInput);
  const scope = normalizePath(scopeInput);
  if (!path || !scope) return false;
  if (scope.endsWith("/**")) {
    const prefix = scope.slice(0, -3).replace(/\/+$/u, "");
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (scope.endsWith("/")) return path.startsWith(scope);
  return path === scope;
}

export function normalizePath(value) {
  const candidate = text(value).replaceAll("\\", "/");
  if (
    !candidate
    || candidate.startsWith("/")
    || /^[A-Za-z]:\//u.test(candidate)
  ) {
    return "";
  }
  const segments = [];
  for (const segment of candidate.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return "";
    segments.push(segment);
  }
  return segments.join("/");
}

export function sumByFields(items, fields) {
  return Object.fromEntries(fields.map((field) => [
    field,
    items.reduce((total, item) => total + (
      finiteNonNegative(item?.[field]) ? Number(item[field]) : 0
    ), 0),
  ]));
}
