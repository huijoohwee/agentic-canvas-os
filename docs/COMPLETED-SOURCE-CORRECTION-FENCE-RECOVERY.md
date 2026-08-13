# Completed source-correction fence recovery

This controller repairs one narrow projection gap after a reviewed-lane source correction has already completed: the durable completion names the corrected remote source head, but a later task-authority migration left the local writer lease fenced at the older coordination commit.

It does not edit source, create a commit, push, merge, clean a worktree, or deploy. A plan binds the completed source-correction journal and receipt, clean local descendant, exact draft pull request, task-authority binding, stale local fence, and exact dormant successor claim. The run requires the source task's external capability and the literal authorization printed by `plan`.

```sh
node scripts/completed-source-correction-fence-recovery.mjs plan \
  --repository=/absolute/path/to/source-worktree \
  --source-session=<source-session> \
  --operator-session=<distinct-operator-session> \
  --pull-request=<number> \
  --json
```

```sh
node scripts/completed-source-correction-fence-recovery.mjs run \
  --repository=/absolute/path/to/source-worktree \
  --source-session=<source-session> \
  --operator-session=<distinct-operator-session> \
  --pull-request=<number> \
  --task-authority=/absolute/private/path/task-authority.json \
  --authorization='authorize completed-source-correction-fence-recovery <plan-digest>' \
  --json
```

The replay-safe journal advances through task-authority verification, exact dormant-cloud recovery, local lease CAS, PR marker projection, terminal verification, and completion. The completion embeds a current `agentic-admission-mutation-authority/v1` receipt. Normal `device:review` remains responsible for checking and pushing the already-authored descendant.
