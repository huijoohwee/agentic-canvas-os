# Design Document

## Overview

The revision-intent supersession controller is a narrow repair inside the existing
`task-authority-loss-incident-recovery` lane. Its read-only planner joins the live owner lease and
GitHub draft PR to the completed source-correction, fence-recovery, and task-binding reconciliation
receipts. It additionally proves that the local coordination child has exactly the remote head as its
only parent and reuses the remote tree.

The run path verifies the current task capability and uses the shared writer-registry mutex and CAS
adapter. The CAS keeps `leases` unchanged and replaces only
`reviewedLaneRevisionIntents[branch]`. The supersession receipt stores the complete immutable plan so
an identical authorized run can return the prior result without another mutation.

No cloud mutation, PR edit, Git command with write effects, source write, or cleanup primitive is
reachable from the controller.
