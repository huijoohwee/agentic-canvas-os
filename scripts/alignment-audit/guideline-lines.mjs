const MODAL =
  /\b(?:must|must not|shall|shall not|required|require(?:s|d)?|never|do not|ensure|prohibit(?:s|ed)?)\b/iu;

export function continuationParagraph(lines, startIndex, initial) {
  const parts = [String(initial).trim()].filter(Boolean);
  let endPosition = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].text;
    if (
      line.trim() === "" ||
      /^#{2,6}\s/u.test(line) ||
      /^\s*[-*+]\s/u.test(line) ||
      /^\s*(?:gate|entry condition|exit condition|required evidence(?: type)?)\s*:/iu
        .test(line) ||
      isIndependentNormativeLine(line)
    ) break;
    parts.push(line.trim());
    endPosition = index;
  }
  return { value: parts.join(" ").trim(), endPosition };
}

export function consumeContinuation(lines, used, startIndex, initial) {
  const paragraph = continuationParagraph(lines, startIndex, initial);
  markConsumed(used, startIndex, paragraph.endPosition);
  return paragraph.value;
}

export function markConsumed(used, start, end) {
  for (let index = start; index <= end; index += 1) used.add(index);
}

export function splitDirectiveCandidate(item) {
  if (item.kind !== "directive") return [item];
  const sentences = String(item.text).split(/(?<=[.!?])\s+(?=\p{Letter})/u);
  const groups = [];
  let current = [];
  for (const sentence of sentences) {
    if (MODAL.test(sentence) && current.some((value) => MODAL.test(value))) {
      groups.push(current.join(" "));
      current = [];
    }
    current.push(sentence);
  }
  if (current.length > 0) groups.push(current.join(" "));
  return groups.map((text, index) => ({
    ...item,
    position: item.position + index / 1_000,
    text,
  }));
}

function isIndependentNormativeLine(line) {
  if (/^\s/u.test(line)) return false;
  return MODAL.test(line) ||
    /^(?:\d+[.)]\s+|(?:directive|required field|anti-pattern|prohibited)\s*:)/iu
      .test(line);
}
