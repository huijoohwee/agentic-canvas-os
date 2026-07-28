import {
  array,
  normalizePath,
  text,
  uniqueSortedStrings,
} from "./normalize.mjs";

export function inspectTaskGraph(tasksInput) {
  const tasks = array(tasksInput);
  const ids = new Set(tasks.map((task) => text(task?.id)).filter(Boolean));
  const dependencies = new Map(tasks.map((task) => [
    text(task?.id),
    uniqueSortedStrings(task?.dependencies),
  ]));
  const unknownDependencies = [];
  for (const [taskId, values] of dependencies) {
    for (const dependency of values) {
      if (!ids.has(dependency)) {
        unknownDependencies.push(Object.freeze({ taskId, dependency }));
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const cycleNodes = new Set();
  function visit(taskId, stack = []) {
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId);
      for (const member of stack.slice(start)) cycleNodes.add(member);
      cycleNodes.add(taskId);
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of dependencies.get(taskId) ?? []) {
      if (ids.has(dependency)) visit(dependency, [...stack, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const taskId of [...ids].sort()) visit(taskId);

  const writeConflicts = [];
  const waves = new Map();
  for (const task of tasks) {
    const wave = text(task?.wave);
    if (!wave) continue;
    if (!waves.has(wave)) waves.set(wave, []);
    waves.get(wave).push(task);
  }
  for (const [wave, members] of waves) {
    for (let leftIndex = 0; leftIndex < members.length; leftIndex += 1) {
      const left = members[leftIndex];
      const leftWrites = new Set(
        uniqueSortedStrings(left?.declaredWriteSet)
          .map(normalizePath)
          .filter(Boolean),
      );
      for (let rightIndex = leftIndex + 1; rightIndex < members.length; rightIndex += 1) {
        const right = members[rightIndex];
        const overlaps = uniqueSortedStrings(right?.declaredWriteSet)
          .map(normalizePath)
          .filter((artifact) => artifact && leftWrites.has(artifact));
        if (overlaps.length > 0) {
          writeConflicts.push(Object.freeze({
            wave,
            leftTaskId: text(left?.id),
            rightTaskId: text(right?.id),
            artifacts: Object.freeze(overlaps),
          }));
        }
      }
    }
  }

  return Object.freeze({
    acyclic: cycleNodes.size === 0,
    cycleNodes: Object.freeze([...cycleNodes].sort()),
    unknownDependencies: Object.freeze(unknownDependencies.sort((left, right) =>
      left.taskId.localeCompare(right.taskId, "en")
      || left.dependency.localeCompare(right.dependency, "en"))),
    writeConflicts: Object.freeze(writeConflicts.sort((left, right) =>
      left.wave.localeCompare(right.wave, "en")
      || left.leftTaskId.localeCompare(right.leftTaskId, "en")
      || left.rightTaskId.localeCompare(right.rightTaskId, "en"))),
  });
}
