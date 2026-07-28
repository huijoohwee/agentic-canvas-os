import {
  array,
  sameStableValue,
  text,
} from "./normalize.mjs";

export function validateAttemptIdempotency(task, attempts, collector) {
  const taskId = text(task?.id);
  const returnKey = text(task?.return?.idempotencyKey);
  const appliedEffects = new Set();
  let valid = Boolean(returnKey);
  for (const attempt of attempts) {
    const applied = array(attempt?.appliedEffectIds).map(text);
    const replayed = array(attempt?.replayedEffectIds).map(text);
    const appliedSet = new Set(applied);
    const replayedSet = new Set(replayed);
    valid = valid
      && text(attempt?.idempotencyKey) === returnKey
      && Boolean(text(attempt?.approachId))
      && (
        attempt?.progress === true
        || Boolean(text(attempt?.diagnosis))
      )
      && applied.every(Boolean)
      && replayed.every(Boolean)
      && appliedSet.size === applied.length
      && replayedSet.size === replayed.length
      && applied.every((effectId) =>
        !appliedEffects.has(effectId) && !replayedSet.has(effectId))
      && replayed.every((effectId) => appliedEffects.has(effectId));
    for (const effectId of applied) appliedEffects.add(effectId);
  }
  const writeEffectIds = array(task?.capabilityEvents)
    .filter((event) =>
      text(event?.action) === "use"
      && text(event?.capabilityClass) === "local-write")
    .map((event) => text(event?.operationId));
  if (
    !valid
    || writeEffectIds.some((effectId) => !effectId)
    || new Set(writeEffectIds).size !== writeEffectIds.length
    || !sameStableValue(
      [...appliedEffects].sort((left, right) => left.localeCompare(right, "en")),
      [...writeEffectIds].sort((left, right) => left.localeCompare(right, "en")),
    )
  ) {
    collector.add("unrecorded-consumption", {
      taskId,
      ruleId: "per-task-budgets#5",
      artifactReference: "attempt-effect-ledger",
      evidenceExcerpt: "Retries require one stable key and exact apply-or-replay effect accounting.",
    });
  }
}
