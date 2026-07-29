const NEGATIVE_RESULT = [
  /\b(?:fail(?:ed|ing|ure)?|false|error|errored|exception|pending|tbd|todo|placeholder|unknown)\b/u,
  /\b(?:unverified|incomplete|blocked|unset|not[ -]?run|not\s+yet)\b/u,
  /\b(?:skipped?|not\s+(?:executed|performed)|inconclusive)\b/u,
  /\bno\s+results?(?:\s+recorded)?\b/u,
  /\b(?:no|0|zero)\s+tests?\s+(?:run|executed|found|collected|discovered)\b/u,
  /\b(?:timed?\s*out|cancelled|canceled|aborted?)\b/u,
  /\b(?:n\/a|none|null|not\s+applicable|to\s+be\s+(?:determined|done))\b/u,
  /^(?:na|<[^>]+>|\{\{[^}]+\}\})$/u,
  /\b(?:did\s+not|does\s+not|not)\s+(?:pass|passed|passing|succeed|succeeded|successful)\b/u,
  /\b(?:no|0)\s+(?:tests?|checks?|assertions?)\s+(?:pass|passed|passing)\b/u,
  /\bexit(?:[\s_-]*(?:code|status))?\s*(?:[:=]\s*)?-?0*[1-9]\d*\b/u,
  /\bhttp\s+[45]\d{2}\b/u,
];

export function recordedResultOf(value) {
  const result = value && typeof value === "object"
    ? value.recordedResult ?? value.recorded_result ?? value.result
    : value;
  return String(result ?? "").normalize("NFKC").trim();
}

export function isSuccessfulRecordedResult(value) {
  const result = recordedResultOf(value)
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ");
  if (result.length === 0 || !/[\p{Letter}\p{Number}]/u.test(result)) return false;
  if (NEGATIVE_RESULT.some((pattern) => pattern.test(result))) return false;
  return true;
}
