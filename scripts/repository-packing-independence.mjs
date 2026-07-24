const EXTERNAL_PROJECT = ["repo", "mix"].join("");

function decodeUnicodeEscapes(text) {
  return text
    .replace(/\\x([0-9a-f]{2})/giu, (match, fixed) => (
      String.fromCodePoint(Number.parseInt(fixed, 16))
    ))
    .replace(
      /\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/giu,
      (match, braced, fixed) => {
        const codePoint = Number.parseInt(braced ?? fixed, 16);
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      },
    );
}

function jsonContainsExternal(value, referencePattern, upstreamPattern) {
  if (typeof value === "string") {
    return referencePattern.test(value) || upstreamPattern.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => jsonContainsExternal(entry, referencePattern, upstreamPattern));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) => (
      referencePattern.test(key)
      || upstreamPattern.test(key)
      || jsonContainsExternal(entry, referencePattern, upstreamPattern)
    ));
  }
  return false;
}

export function validateRepositoryPackingIndependence({
  packageText = "",
  lockText = "",
  sourceEntries = [],
}) {
  const failures = [];
  const externalReference = new RegExp(
    `(?:^|[\\s/:@?#])(?:@[^/\\s]+/)?${EXTERNAL_PROJECT}(?:[-_.@/\\s?#]|$)`,
    "i",
  );
  const dependencyPattern = new RegExp(
    `"(?:@[^"]+/)?${EXTERNAL_PROJECT}(?:[-_.][^"]*)?"\\s*:|npm:(?:@[^/"]+/)?${EXTERNAL_PROJECT}(?:[-_.][^@"\\s]*)?|node_modules/(?:@[^/"]+/)?${EXTERNAL_PROJECT}(?:[-_.][^/"]*)?|registry\\.npmjs\\.org/(?:@[^/"]+/)?${EXTERNAL_PROJECT}(?:[-_.][^/"]*)?|github:yamadashy/${EXTERNAL_PROJECT}|(?:git\\+https://|git\\+ssh://git@|https?://)github\\.com/yamadashy/${EXTERNAL_PROJECT}(?:\\.git)?`,
    "i",
  );
  const upstreamLiteral = new RegExp(
    `https?://(?:www\\.)?${EXTERNAL_PROJECT}\\.|https?://(?:github\\.com|raw\\.githubusercontent\\.com|codeload\\.github\\.com)/yamadashy/${EXTERNAL_PROJECT}(?:[/?#"'\\x60.]|$)`,
    "i",
  );
  for (const [name, text] of [["package.json", packageText], ["package-lock.json", lockText]]) {
    let parsedContainsExternal = false;
    try {
      parsedContainsExternal = jsonContainsExternal(
        JSON.parse(text),
        externalReference,
        upstreamLiteral,
      );
    } catch {
      // The repository's general package validation owns malformed JSON.
    }
    if (dependencyPattern.test(text) || upstreamLiteral.test(text) || parsedContainsExternal) {
      failures.push(`${name}: forbidden repository packing dependency or locator`);
    }
  }

  const forbiddenRuntime = new RegExp(`\\b${EXTERNAL_PROJECT}[\\w.-]*\\b`, "i");
  for (const [name, source] of sourceEntries) {
    const decodedName = decodeUnicodeEscapes(name);
    const text = decodeUnicodeEscapes(source);
    if (
      forbiddenRuntime.test(decodedName)
      || upstreamLiteral.test(decodedName)
      || forbiddenRuntime.test(text)
      || upstreamLiteral.test(text)
    ) {
      failures.push(`${name}: forbidden external repository packing runtime reference`);
    }
  }
  return failures;
}
