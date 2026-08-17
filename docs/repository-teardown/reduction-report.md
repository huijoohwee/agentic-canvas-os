# Repository teardown reduction report

Status: **in-progress**

| Surface | Baseline files | Baseline lines | Current files | Current lines |
|---|---:|---:|---:|---:|
| worker+src+agent-api/src | 78 | 19228 | 73 | 19228 |
| scripts/ | 361 | 110186 | 366 | 111719 |
| __tests__/ | 296 | 89206 | 304 | 89874 |
| docs/*.md | 100 | 17924 | 100 | 17930 |

```json
{
  "schema": "agentic-teardown-reduction-report/v1",
  "stagesCompleted": 0,
  "finalCommit": null,
  "status": "in-progress",
  "surfaces": [
    {
      "surface": "worker+src+agent-api/src",
      "baselineFiles": 78,
      "baselineLines": 19228,
      "currentFiles": 73,
      "currentLines": 19228,
      "percentFileReduction": 6.41,
      "percentLineReduction": 0
    },
    {
      "surface": "scripts/",
      "baselineFiles": 361,
      "baselineLines": 110186,
      "currentFiles": 366,
      "currentLines": 111719,
      "percentFileReduction": -1.39,
      "percentLineReduction": -1.39
    },
    {
      "surface": "__tests__/",
      "baselineFiles": 296,
      "baselineLines": 89206,
      "currentFiles": 304,
      "currentLines": 89874,
      "percentFileReduction": -2.7,
      "percentLineReduction": -0.75
    },
    {
      "surface": "docs/*.md",
      "baselineFiles": 100,
      "baselineLines": 17924,
      "currentFiles": 100,
      "currentLines": 17930,
      "percentFileReduction": 0,
      "percentLineReduction": -0.03
    }
  ],
  "counts": [
    {
      "metric": "packageJsonScripts",
      "baseline": 116,
      "current": 116
    },
    {
      "metric": "agentApiModules",
      "baseline": 59,
      "current": 59
    },
    {
      "metric": "worktrees",
      "baseline": null,
      "current": 21
    },
    {
      "metric": "localBranches",
      "baseline": 306,
      "current": 334
    },
    {
      "metric": "remoteBranches",
      "baseline": 86,
      "current": 97
    }
  ],
  "classificationTotals": {
    "redundant": 0,
    "constrained": 0,
    "dead": 0,
    "retained": 0,
    "total": 0
  },
  "constrainedWithoutReducedForm": 0,
  "archive": {
    "tagName": "",
    "bundlePath": "",
    "manifestPath": "",
    "manifestEntryCount": 0
  },
  "servedRoutes": [],
  "readinessDifferences": [],
  "warnings": [
    {
      "metric": "worker+src+agent-api/src.files",
      "measured": 73,
      "baseline": 78
    },
    {
      "metric": "scripts/.files",
      "measured": 366,
      "baseline": 361
    },
    {
      "metric": "scripts/.lines",
      "measured": 111719,
      "baseline": 110186
    },
    {
      "metric": "__tests__/.files",
      "measured": 304,
      "baseline": 296
    },
    {
      "metric": "__tests__/.lines",
      "measured": 89874,
      "baseline": 89206
    },
    {
      "metric": "docs/*.md.lines",
      "measured": 17930,
      "baseline": 17924
    },
    {
      "metric": "localBranches",
      "measured": 334,
      "baseline": 306
    },
    {
      "metric": "remoteBranches",
      "measured": 97,
      "baseline": 86
    }
  ],
  "unmetThresholds": [],
  "retentions": [],
  "revertedStages": []
}
```
