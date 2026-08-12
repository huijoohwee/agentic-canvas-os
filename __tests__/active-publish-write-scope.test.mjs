import assert from "node:assert/strict";
import test from "node:test";

import { assertActivePublishPathsAdmitted } from
  "../scripts/active-publish-write-scope.mjs";

function admission(paths = ["canvas/src/features/game-flight-sim"]) {
  return {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "flight-sim-functionality",
    declaredWriteSet: [
      ...paths.map(path => `path:${path}`),
      "semantic:flight-sim-functionality",
    ].sort(),
  };
}

test("active publish accepts exact files contained by an admitted directory", () => {
  const result = assertActivePublishPathsAdmitted({
    admission: admission([
      "canvas/src/__tests__/flightSimFloatingPanelControls.test.ts",
      "canvas/src/features/game-flight-sim",
    ]),
    paths: [
      "canvas/src/features/game-flight-sim/flightSimMcpRuntime.ts",
      "canvas/src/features/game-flight-sim/FlightSimHud.tsx",
      "canvas/src/__tests__/flightSimFloatingPanelControls.test.ts",
    ],
  });
  assert.deepEqual(result.paths, [
    "canvas/src/__tests__/flightSimFloatingPanelControls.test.ts",
    "canvas/src/features/game-flight-sim/FlightSimHud.tsx",
    "canvas/src/features/game-flight-sim/flightSimMcpRuntime.ts",
  ]);
});

test("active publish rejects paths outside admission and prefix lookalikes", () => {
  for (const changed of [
    "docs/runtime-readiness-contract.md",
    "canvas/src/features/game-flight-simulator/runtime.ts",
  ]) {
    assert.throws(
      () => assertActivePublishPathsAdmitted({ admission: admission(), paths: [changed] }),
      /paths changed from the admitted write-set evidence/u,
    );
  }
});

test("active publish requires exact admitted semantic evidence", () => {
  const source = admission();
  source.declaredWriteSet = source.declaredWriteSet.filter(item => !item.startsWith("semantic:"));
  assert.throws(
    () => assertActivePublishPathsAdmitted({
      admission: source,
      paths: ["canvas/src/features/game-flight-sim/FlightSimHud.tsx"],
    }),
    /semantic scope changed/u,
  );
});
