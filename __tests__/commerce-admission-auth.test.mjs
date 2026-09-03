import assert from "node:assert/strict";
import test from "node:test";

import { isCommerceAdmissionAuthSecret } from "../agent-api/src/commerce-admission-contract.js";

test("the admission secret boundary matches the Commerce signer exactly", () => {
  assert.equal(isCommerceAdmissionAuthSecret("x".repeat(32)), true);
  assert.equal(isCommerceAdmissionAuthSecret("x".repeat(256)), true);
  for (const value of [
    "x".repeat(31),
    "x".repeat(257),
    `${"x".repeat(31)} `,
    "replace-this-secret-with-real-material-0001",
    "AGENTIC_OS_ADMISSION_AUTH_SECRET_REQUIRED_0001",
    "example-admission-secret-material-00001",
    "changeme-admission-secret-material-0001",
    "todo-admission-secret-material-00000001",
  ]) assert.equal(isCommerceAdmissionAuthSecret(value), false, value);
});
