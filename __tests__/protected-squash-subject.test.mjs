import assert from "node:assert/strict";
import test from "node:test";

import {
  PROTECTED_SQUASH_SUBJECT_MAX_CHARACTERS,
  requireProtectedSquashSubject,
} from "../scripts/protected-squash-subject.mjs";

test("protected squash subjects preserve valid exact text", () => {
  const subject = "fix: bind an exact protected squash subject";
  assert.equal(requireProtectedSquashSubject(subject), subject);
});

test("protected squash subjects count Unicode code points", () => {
  const subject = "😀".repeat(PROTECTED_SQUASH_SUBJECT_MAX_CHARACTERS);
  assert.equal(requireProtectedSquashSubject(subject), subject);
  assert.throws(
    () => requireProtectedSquashSubject(`${subject}😀`),
    /exceeds 72 characters \(73\)/u,
  );
});

test("protected squash subjects reject empty, padded, and multiline values", () => {
  assert.throws(() => requireProtectedSquashSubject(""), /must not be empty/u);
  assert.throws(
    () => requireProtectedSquashSubject(" fix: padded"),
    /leading or trailing whitespace/u,
  );
  assert.throws(
    () => requireProtectedSquashSubject("fix: first\nsecond"),
    /must be a single line/u,
  );
});
