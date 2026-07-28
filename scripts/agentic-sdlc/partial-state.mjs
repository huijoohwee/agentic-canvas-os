import {
  array,
  object,
  sameStableValue,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

export function isJoinedPartialState(taskInput, terminalInput, transitionInput) {
  const task = object(taskInput);
  const terminal = object(terminalInput);
  const transition = object(transitionInput);
  const partialState = object(terminal.partialState);
  const attempts = array(task?.return?.attempts);
  const appliedEffectIds = uniqueSortedStrings(
    attempts.flatMap((attempt) => array(attempt?.appliedEffectIds)),
  );
  const replayedEffectIds = uniqueSortedStrings(
    attempts.flatMap((attempt) => array(attempt?.replayedEffectIds)),
  );
  const changedArtifacts = uniqueSortedStrings(
    task?.return?.changedArtifacts,
  );
  const artifactRevision = text(task?.return?.artifactRevision);

  return text(terminal?.state) === "failed"
    && Boolean(artifactRevision)
    && text(partialState.artifactRevision) === artifactRevision
    && Array.isArray(partialState.changedArtifacts)
    && Array.isArray(partialState.appliedEffectIds)
    && Array.isArray(partialState.replayedEffectIds)
    && (
      !text(transition?.artifactRevision)
      || text(transition.artifactRevision) === artifactRevision
    )
    && sameStableValue(
      uniqueSortedStrings(partialState.appliedEffectIds),
      appliedEffectIds,
    )
    && sameStableValue(
      uniqueSortedStrings(partialState.replayedEffectIds),
      replayedEffectIds,
    )
    && sameStableValue(
      uniqueSortedStrings(partialState.changedArtifacts),
      changedArtifacts,
    );
}
