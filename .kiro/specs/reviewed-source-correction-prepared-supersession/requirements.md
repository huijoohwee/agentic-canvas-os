# Requirements

## Goal

Allow a reviewed-lane source-correction operation whose protected-main evidence
changed after a zero-effect `prepared` journal to consume a newly authorized
current plan without deleting or editing controller state by hand.

## Requirements

1. Supersession MUST require a different freshly built plan and its byte-exact
   authorization.
2. Supersession MUST be limited to `prepared` or existing `complete` journals;
   all intervening phases remain immutable.
3. Before superseding `prepared`, the controller MUST reconcile the old plan's
   first effect and prove no response-ahead successor exists.
4. An observed response-ahead successor MUST retain the old journal and require
   its original authorization.
5. Invalid authorization or evidence MUST produce no journal or remote mutation.
