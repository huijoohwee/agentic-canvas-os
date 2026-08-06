export const PROTECTED_SQUASH_SUBJECT_MAX_CHARACTERS = 72;

export function requireProtectedSquashSubject(
  value,
  { label = "Protected squash subject" } = {},
) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (!value || !value.trim()) {
    throw new Error(`${label} must not be empty.`);
  }
  if (value !== value.trim()) {
    throw new Error(`${label} must not have leading or trailing whitespace.`);
  }
  if (/\r|\n/u.test(value)) {
    throw new Error(`${label} must be a single line.`);
  }
  const characterCount = [...value].length;
  if (characterCount > PROTECTED_SQUASH_SUBJECT_MAX_CHARACTERS) {
    throw new Error(
      `${label} exceeds ${PROTECTED_SQUASH_SUBJECT_MAX_CHARACTERS} characters (${characterCount}).`,
    );
  }
  return value;
}
