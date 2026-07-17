---
title: "Instruction Task-Quality Evaluation"
graphId: "md:instruction-task-quality-evaluation"
doc_type: "Runtime Contract"
date: "2026-07-18"
lang: "en-US"
schema: "agentic-instruction-task-quality/v1"
frontmatter_contract: "required"
status: "runtime-ready"
authority: "behavioral rubric evaluation of final answers produced under Agentic Canvas OS instructions"
runtime_scope: "recorded or live candidate final answers for the repository-owned scenario suite"
runtime_claim: "model-agnostic final-answer scoring with typed failures and explicit provenance"
runtime_proof: "RUNTIME-PROOF.md"
publish_policy: "Dev-only; no Prod mirror or Cloudflare authority"
invocation:
  action: "/instruction.quality-evaluate"
  semantics: ["#instruction-quality", "#vcc", "#runtime-ready"]
  bindings: ["@instruction-eval-suite", "@runtime-proof", "@operator"]
---

# Instruction Task-Quality Evaluation

## Decision

Structural context reduction is not behavioral proof. Evaluate representative final answers against a small repository-owned scenario suite, keep candidate provenance explicit, and require reviewer judgment before claiming that an instruction revision improved task quality.

The evaluator never invokes a model and never reads private reasoning. A caller may supply recorded or live final answers from any model or host through the same candidate schema.

## Evaluation Cases

| Case | Observable behavior |
|---|---|
| Canonical owner routing | Reproduce from evidence, repair the shared source owner, and name focused proof without downstream workarounds. |
| Workflow and deployment boundary | Respect `START-WORKFLOW.md`, one claimed writer, exact revision proof, unrelated work, and explicit deployment approval. |
| Progressive skill disclosure | Keep always-on guidance durable, load selected specialist detail on demand, and preserve required intent. |
| Honest quality proof | Treat structural reduction as bounded evidence, evaluate final outputs, and retain human review without provider overclaims. |

Each case declares required concept alternatives, literal forbidden claims, and a maximum final-answer word count. Literal screening is deterministic and explainable; it is not a semantic judge and can be gamed by keyword stuffing. Human review remains required for promotion decisions.

## Candidate Contract

A candidate document uses `agentic-instruction-task-quality-candidate/v1` and provides:

- a stable candidate id and exact instruction revision;
- `recorded` or `live` provenance, plus a model label when known;
- exactly one final-answer string for every registered case;
- optional usage metadata supplied by the producing runtime.

Missing cases, unknown cases, malformed provenance, and schema drift return `status: invalid`. The evaluator does not infer or fabricate model usage.

## Result Contract

The `agentic-instruction-task-quality/v1` report contains per-case required-criterion results, forbidden-claim triggers, word counts, scores, validation errors, and aggregate pass counts. A case passes only when every required criterion is visible, no forbidden phrase is present, and the word budget holds. The suite passes only when every case passes.

`execution.modelInvokedByEvaluator` and `execution.privateReasoningInspected` are always false. Prod mirror and Cloudflare attempt fields are also false.

## Runtime

Validate the suite and scorer:

`npm run instruction-quality:check`

Evaluate an external candidate file:

`npm run instruction-quality:evaluate -- --candidate=<path> --json`

The repository gate validates the suite and discrimination fixtures. It does not ship a synthetic model result as quality evidence.

## VCCs

| VCC | Observable proof |
|---|---|
| Suite is complete | Four unique bounded cases validate under the exact suite schema. |
| Good behavior passes | A recorded fixture covering all required concepts passes all cases. |
| Missing intent fails | Removing canonical-owner routing fails that criterion and the suite. |
| Unsafe advice fails | An unapproved deployment recommendation triggers a typed forbidden finding. |
| Repetition fails | A response beyond its word budget fails concision. |
| Case drift fails closed | Missing and unknown response ids return `invalid`. |
| Claims stay honest | The report states no evaluator model call, no private-reasoning inspection, and no deployment. |

## Promotion Boundary

The evaluation harness is runtime-ready in Dev. A named model or instruction revision has no quality status until its own complete candidate packet passes the suite and receives human review. Passing the lexical rubric is screening evidence, not proof of general model quality, production behavior, or provider-side instruction loading.
