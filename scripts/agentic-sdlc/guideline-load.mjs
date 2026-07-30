import { PINNED_GUIDELINE_LOAD_PROFILES } from "./guideline-baseline.mjs";
import {
  array,
  sameStableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

export function normalizeGuidelineLoadEvents(eventsInput) {
  return array(eventsInput).map((event) => ({
    id: text(event?.eventId),
    guideline: text(event?.guideline),
    stage: text(event?.stage),
    subjectId: event?.subjectId === null ? null : text(event?.subjectId),
    tokens: event?.tokens,
    loadedSectionAnchors: uniqueSortedStrings(event?.loadedSectionAnchors),
  }));
}

export function validateGuidelineLoadEvents(context) {
  const actual = array(context.run?.guidelineLoadEvents);
  const expected = expectedGuidelineLoadEvents(context);
  const actualKeys = actual.map(eventKey);
  const expectedKeys = expected.map(eventKey);
  let valid = actual.length === expected.length
    && new Set(actualKeys).size === actualKeys.length
    && sameStableValue(
      [...actualKeys].sort(),
      [...expectedKeys].sort(),
    );
  for (const event of actual) {
    const profile = PINNED_GUIDELINE_LOAD_PROFILES[event.guideline]?.[event.stage];
    valid = valid
      && event.id === eventKey(event)
      && Number.isInteger(event.tokens)
      && event.tokens > 0
      && Array.isArray(profile)
      && sameStableValue(
        event.loadedSectionAnchors,
        uniqueSortedStrings(profile),
      );
  }
  if (!valid) {
    context.collector.add("unrecorded-consumption", {
      ruleId: "execution-load-budget#2",
      artifactReference: "guideline-load-events",
      evidenceExcerpt:
        "Guideline load events must exactly cover Phase 4 and every exercised execution stage with pinned section anchors and measured token cost.",
    });
  }
  return valid;
}

function expectedGuidelineLoadEvents(context) {
  const events = [
    loadEvent("authoring", "phase-4", null),
    loadEvent("execution", "run-start", null),
    loadEvent("execution", "task-derivation", null),
  ];
  for (const task of context.tasks) {
    const taskId = text(task?.id);
    events.push(
      loadEvent("execution", "dispatch", taskId),
      loadEvent("execution", "implementation", taskId),
      loadEvent("execution", "verification", taskId),
    );
  }
  for (const recovery of array(context.run?.recoveryEvents)) {
    events.push(loadEvent("execution", "recovery", text(recovery?.id)));
  }
  for (const gate of array(context.run?.humanGateEvents)) {
    events.push(loadEvent("execution", "escalation", text(gate?.id)));
  }
  return events;
}

function loadEvent(guideline, stage, subjectId) {
  return { guideline, stage, subjectId };
}

function eventKey(event) {
  return `${text(event?.guideline)}:${text(event?.stage)}:${
    event?.subjectId === null ? "run" : text(event?.subjectId)
  }`;
}
