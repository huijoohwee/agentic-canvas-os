import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { advanceJournal, buildPlan, createJournal,
  GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH,
  GENERIC_SELF_HOSTED_RECOVERY_PATHS,
  normalizeCanonicalSquashRecoveryDeliveryProfile,
  normalizeJournal, normalizeReceipt, operationKey, startJournal }
  from "../scripts/canonical-squash-attribution-recovery-terminalization-contract.mjs";
import { createCanonicalSquashAttributionRecoveryTerminalizationController }
  from "../scripts/canonical-squash-attribution-recovery-terminalization-controller.mjs";
import {
  assertCanonicalSquashRecoveryCompletionTopology,
  assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection,
  assertCanonicalSquashRecoveryControllerProjection,
  assertCanonicalSquashRecoveryLegacyContinuationTopology,
  assertCanonicalSquashRecoveryMalformedProviderMessage,
  assertCanonicalSquashRecoveryPreRetirementProjection,
  assertCanonicalSquashRecoveryTerminalMainTopology,
  assertExactCanonicalSquashRecoveryCompletedTaskAuthority, assertExactCanonicalSquashRecoveryCompletingReplay,
  assertExactCanonicalSquashRecoveryTerminalLeaseIdentity, classifyCanonicalSquashRecoveryCompletingProjection,
  classifySelfHostedSuccessfulJobInventory,
  canonicalSquashRecoveryImmutableLeaseProjection,
  createCanonicalSquashAttributionRecoveryTerminalizationRepositoryAdapter,
  selectNewestExactIntegrationRun,
} from "../scripts/canonical-squash-attribution-recovery-terminalization-repository-adapter.mjs";
import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import { createTaskAuthorityBinding, createTaskAuthorityCapability }
  from "../scripts/task-bound-lane-authority-contract.mjs";

const liveEvidence = Object.freeze({"schema":"agentic-canonical-squash-attribution-recovery-terminalization-evidence/v1","observedAt":"2026-08-30T13:00:00.000Z","controller":{"repository":"huijoohwee/agentic-canvas-os","revision":"a2fd604b8471659ccbbf1bdc5a7ac0757872141c","tree":"7362a11e7cb8cf2d5488257a1c71afdbd5650c3b","targetRepository":"huijoohwee/knowgrph"},"subject":{"repository":"huijoohwee/knowgrph","worktreePath":"/Users/katrina/Documents/GitHub/.worktrees/knowgrph/runtime-readiness-docs-pin-4bb7790f","branch":"agent/katrinas-macbook-pro.local/runtime-readiness-docs-pin-4bb7790f","sessionId":"runtime-readiness-docs-pin-4bb7790f-20260830","scope":"runtime-readiness-docs-pin-4bb7790f","leaseDigest":"2985d87acb6390a8046db82d4c6557a95f141e8aec882d5248f7e304e331cfae","leaseIdentity":{"schema":"agentic-writer-lease/v2","epoch":522,"sessionId":"runtime-readiness-docs-pin-4bb7790f-20260830","device":"katrinas-macbook-pro.local","scope":"runtime-readiness-docs-pin-4bb7790f","branch":"agent/katrinas-macbook-pro.local/runtime-readiness-docs-pin-4bb7790f","worktreePath":"/Users/katrina/Documents/GitHub/.worktrees/knowgrph/runtime-readiness-docs-pin-4bb7790f","baseSha":"3257a94c29272c8dce8bb5d58842b0012df4d554","fenceSha":"92dcb36cfa6309aea673863438528341f8bb1ed5","pullRequestUrl":"https://github.com/huijoohwee/knowgrph/pull/893","autoDelivery":true,"runtimeRequired":true,"ownedDirtRecovery":null,"pullRequestProjectionRepair":null,"reviewHeadSha":null,"deliveryHeadSha":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","parkHeadSha":null,"parkBranchHeadSha":null,"parkSourceEpoch":null,"parkSourceFenceSha":null,"parkStashRef":null,"parkStashSha":null,"parkStashMessage":null,"parkStashStatus":null,"acquiredAt":"2026-08-30T10:21:14.192Z","admission":{"schema":"agentic-lane-admission-lease/v1","status":"admitted","semanticScope":"runtime-readiness-docs-pin-4bb7790f","declaredWriteSet":["path:docs/runtime-readiness-contract.md","semantic:runtime-readiness-docs-pin-4bb7790f"],"writeSetDigest":"0b24820f59add89d723aca4008037803f17753924337e2a9c1bebb1d8861a5c9","manifestDigest":"74c3d3c4f961a867bb7dceba611bffa62e66427797c820643e058f22e2ddedbe","planReceiptDigest":"e8fb74c081d94327792d0a77275336bda905865bd96e8bb2ffa4cc7366277759","admissionReceiptDigest":"f1727b99d7577b2cb32891222b3631b21397475de2a00a25ff48e60be1466c15","existingLaneStateDigest":"020818429f57aef16741b555e93513374760a48da9e801a1975c914aa89ef5b7","admittedReportDigest":"0988806902fb01213df40322a9a0537081b2b7ab8967d7a802134e34fcd13578","preservationReceiptDigest":"aeb085d1bb34473176ce1232282653d558a5046b3183431d80967af9c4b040ab"},"cloudAuthority":{"schema":"agentic-lane-cloud-authority/v1","provider":"github","ledgerRepository":"huijoohwee/agentic-canvas-os","targetRepository":"huijoohwee/knowgrph","claimId":"8a27e270a308bf391bfc7f5f5035a6bfb4b45c81f5177383f339534e11a0fd82","claimDigest":"33309320c066172fb6516a9b916b99cda5422a3f34aef412812a0b76b98a7c96","ledgerRevision":"b4aa5181d0cc063c330f1093e4139c927cdd426b","ledgerDigest":"215b5fcd0ac91074071af7356e0bfaaf4250caf4b8dcd2135deba1a66edb9d4e","claimLedgerRevision":"215b5fcd0ac91074071af7356e0bfaaf4250caf4b8dcd2135deba1a66edb9d4e","entrySchema":"agentic-cloud-collaboration-entry/v2","claimIdentitySchema":"agentic-cloud-collaboration-entry/v2","operationReceiptDigest":"fb24049beda83c87b02ba9a80427d496bad497ba45f3b7c82cfd7226fb1e774c","mutationAuthorityEligible":true,"canonicalBaseSha":"3257a94c29272c8dce8bb5d58842b0012df4d554","laneRevision":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","cloudDeclaredWriteScope":["path:docs/runtime-readiness-contract.md","semantic:runtime-readiness-docs-pin-4bb7790f"],"writeSetDigest":"0b24820f59add89d723aca4008037803f17753924337e2a9c1bebb1d8861a5c9","deviceId":"katrinas-macbook-pro.local","sessionId":"runtime-readiness-docs-pin-4bb7790f-20260830","reviewRequestId":"github-pull-request:PR_kwDOOYnpZs8AAAABBfw4PA","leaseEpoch":1,"transitionCounter":5,"state":"delivery_authorized","expiresAt":"2026-08-30T11:18:59.000Z","integrationReceiptDigest":"fb24049beda83c87b02ba9a80427d496bad497ba45f3b7c82cfd7226fb1e774c","integration":{"candidateRevision":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","reviewRequestId":"github-pull-request:PR_kwDOOYnpZs8AAAABBfw4PA","focusedEvidenceDigest":"296b98aaf6d66d11c82f990c67a45755dbc93a92e69692e9b69bbd1936f30ece","dependencyClosureDigest":"34cd7f37d2966da47cc09413fb4a9b56b3e887dd1fcb3e35369f1c7011a7888a","namedChecksDigest":"8f5e07351fda014a23b8dcb86b094d5830c8bd1937a9201dc68f34ac69194e95","handoffEvidenceDigest":"7afed943ea11ca70e222b0decbfc73208cdfb23e3ab2db545b4cb2da88f310fe","operatorDecisionDigest":"b1369c0bf06608db928bb56e5760944e9599a82f7e2d3b7504e10d7ce31bb048","integrationIntentDigest":"0c8a8fe325e7174b12048c8fcc5ef4d4e1e81c17f3e3c7d142945315c88c2b2d","integratedAt":"2026-08-30T10:28:39.000Z"},"focusedEvidenceDigest":"296b98aaf6d66d11c82f990c67a45755dbc93a92e69692e9b69bbd1936f30ece","manifestDigest":"74c3d3c4f961a867bb7dceba611bffa62e66427797c820643e058f22e2ddedbe","operatorDecisionDigest":"b1369c0bf06608db928bb56e5760944e9599a82f7e2d3b7504e10d7ce31bb048","integrationIntentDigest":"0c8a8fe325e7174b12048c8fcc5ef4d4e1e81c17f3e3c7d142945315c88c2b2d"},"integration":{"schema":"agentic-integration-commit/v1","commitSha":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","treeSha":"d6bf44c8242e32b1833b07e8a3b903c776bb7906","commitMessage":"docs(runtime-readiness-docs-pin-4bb7790f): promote ACOS pin","manifestDigest":"3e2009b6a9396f97a4aa8a47dd1df7c4f5c6d52650a349d68d8431eee031bb92","stagedDiffDigest":"245519601a7f8ff6f3cc6440f6e886c84de2fe360af8ef6a7d0515491811b0f5","paths":["docs/runtime-readiness-contract.md"],"recordedAt":"2026-08-30T10:25:11.429Z"},"taskAuthority":{"schema":"agentic-task-authority-binding/v1","authoritySubjectId":"urn:agentic-task:de84e48b99cfa5f68af636dcac96e9c312b2f5e57828e4df76d343eae5953a6f","proofAdapterId":"urn:agentic-proof:ed25519-file:v1","generation":1,"publicKey":"MCowBQYDK2VwAyEAK+OhgblBaW517tbUX8na8IRtPfjsGnIJ1Gdw8wmBruY=","publicKeyDigest":"e8962723a772be5efdf677931857a2dd2f055547c788eb1f007671280bc0b65a","laneBindingDigest":"886048412107c68c9ef57b1259da6005f0d25fe15b4f9582de2c19989c6c8169","bindingMode":"claim","boundAt":"2026-08-30T10:21:14.192Z","transitionPlanDigest":null,"priorBindingDigest":null,"bindingDigest":"b68653c70ba6007d5709e47a882722ba0bdd3bc96dd506d929c83a8ab2d280ee"}},"leaseIdentityDigest":"a7c5917c17ea59d7bb756569ea592a70735807e5dffcb5528c463468c6c61812","taskAuthorityBindingDigest":"b68653c70ba6007d5709e47a882722ba0bdd3bc96dd506d929c83a8ab2d280ee","taskAuthority":{"schema":"agentic-task-authority-binding/v1","authoritySubjectId":"urn:agentic-task:de84e48b99cfa5f68af636dcac96e9c312b2f5e57828e4df76d343eae5953a6f","proofAdapterId":"urn:agentic-proof:ed25519-file:v1","generation":1,"publicKey":"MCowBQYDK2VwAyEAK+OhgblBaW517tbUX8na8IRtPfjsGnIJ1Gdw8wmBruY=","publicKeyDigest":"e8962723a772be5efdf677931857a2dd2f055547c788eb1f007671280bc0b65a","laneBindingDigest":"886048412107c68c9ef57b1259da6005f0d25fe15b4f9582de2c19989c6c8169","bindingMode":"claim","boundAt":"2026-08-30T10:21:14.192Z","transitionPlanDigest":null,"priorBindingDigest":null,"bindingDigest":"b68653c70ba6007d5709e47a882722ba0bdd3bc96dd506d929c83a8ab2d280ee"},"claimId":"8a27e270a308bf391bfc7f5f5035a6bfb4b45c81f5177383f339534e11a0fd82","claimDigest":"33309320c066172fb6516a9b916b99cda5422a3f34aef412812a0b76b98a7c96","integrationReceiptDigest":"fb24049beda83c87b02ba9a80427d496bad497ba45f3b7c82cfd7226fb1e774c","cloudAuthority":{"schema":"agentic-lane-cloud-authority/v1","provider":"github","ledgerRepository":"huijoohwee/agentic-canvas-os","targetRepository":"huijoohwee/knowgrph","claimId":"8a27e270a308bf391bfc7f5f5035a6bfb4b45c81f5177383f339534e11a0fd82","claimDigest":"33309320c066172fb6516a9b916b99cda5422a3f34aef412812a0b76b98a7c96","ledgerRevision":"b4aa5181d0cc063c330f1093e4139c927cdd426b","ledgerDigest":"215b5fcd0ac91074071af7356e0bfaaf4250caf4b8dcd2135deba1a66edb9d4e","claimLedgerRevision":"215b5fcd0ac91074071af7356e0bfaaf4250caf4b8dcd2135deba1a66edb9d4e","entrySchema":"agentic-cloud-collaboration-entry/v2","claimIdentitySchema":"agentic-cloud-collaboration-entry/v2","operationReceiptDigest":"fb24049beda83c87b02ba9a80427d496bad497ba45f3b7c82cfd7226fb1e774c","mutationAuthorityEligible":true,"canonicalBaseSha":"3257a94c29272c8dce8bb5d58842b0012df4d554","laneRevision":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","cloudDeclaredWriteScope":["path:docs/runtime-readiness-contract.md","semantic:runtime-readiness-docs-pin-4bb7790f"],"writeSetDigest":"0b24820f59add89d723aca4008037803f17753924337e2a9c1bebb1d8861a5c9","deviceId":"katrinas-macbook-pro.local","sessionId":"runtime-readiness-docs-pin-4bb7790f-20260830","reviewRequestId":"github-pull-request:PR_kwDOOYnpZs8AAAABBfw4PA","leaseEpoch":1,"transitionCounter":5,"state":"delivery_authorized","expiresAt":"2026-08-30T11:18:59.000Z","integrationReceiptDigest":"fb24049beda83c87b02ba9a80427d496bad497ba45f3b7c82cfd7226fb1e774c","integration":{"candidateRevision":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","reviewRequestId":"github-pull-request:PR_kwDOOYnpZs8AAAABBfw4PA","focusedEvidenceDigest":"296b98aaf6d66d11c82f990c67a45755dbc93a92e69692e9b69bbd1936f30ece","dependencyClosureDigest":"34cd7f37d2966da47cc09413fb4a9b56b3e887dd1fcb3e35369f1c7011a7888a","namedChecksDigest":"8f5e07351fda014a23b8dcb86b094d5830c8bd1937a9201dc68f34ac69194e95","handoffEvidenceDigest":"7afed943ea11ca70e222b0decbfc73208cdfb23e3ab2db545b4cb2da88f310fe","operatorDecisionDigest":"b1369c0bf06608db928bb56e5760944e9599a82f7e2d3b7504e10d7ce31bb048","integrationIntentDigest":"0c8a8fe325e7174b12048c8fcc5ef4d4e1e81c17f3e3c7d142945315c88c2b2d","integratedAt":"2026-08-30T10:28:39.000Z"},"focusedEvidenceDigest":"296b98aaf6d66d11c82f990c67a45755dbc93a92e69692e9b69bbd1936f30ece","manifestDigest":"74c3d3c4f961a867bb7dceba611bffa62e66427797c820643e058f22e2ddedbe","operatorDecisionDigest":"b1369c0bf06608db928bb56e5760944e9599a82f7e2d3b7504e10d7ce31bb048","integrationIntentDigest":"0c8a8fe325e7174b12048c8fcc5ef4d4e1e81c17f3e3c7d142945315c88c2b2d"},"deliveryEvidence":{"dependencyClosureDigest":"34cd7f37d2966da47cc09413fb4a9b56b3e887dd1fcb3e35369f1c7011a7888a","namedChecksDigest":"8f5e07351fda014a23b8dcb86b094d5830c8bd1937a9201dc68f34ac69194e95","handoffEvidenceDigest":"7afed943ea11ca70e222b0decbfc73208cdfb23e3ab2db545b4cb2da88f310fe","operatorDecisionDigest":"b1369c0bf06608db928bb56e5760944e9599a82f7e2d3b7504e10d7ce31bb048","integrationIntentDigest":"0c8a8fe325e7174b12048c8fcc5ef4d4e1e81c17f3e3c7d142945315c88c2b2d"},"reviewedHeadSha":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","reviewedTreeSha":"d6bf44c8242e32b1833b07e8a3b903c776bb7906","remoteBranch":"absent","reviewedCommit":{"sha":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","treeSha":"d6bf44c8242e32b1833b07e8a3b903c776bb7906","messageDigest":"22b2b501ee057bced13e16d2b96e2548acdf3e62484bba5ecd45962a737e6dc7","objectMessageByteLength":418,"objectMessageSha256":"684dbbf21acfd33152e9086caafe479589d151411c7f1d0bc412e4c4140e25ef","objectMessageTerminalLf":true},"pullRequest":{"number":893,"nodeId":"PR_kwDOOYnpZs8AAAABBfw4PA","url":"https://github.com/huijoohwee/knowgrph/pull/893","headBranch":"agent/katrinas-macbook-pro.local/runtime-readiness-docs-pin-4bb7790f","headSha":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","baseBranch":"main","baseSha":"3257a94c29272c8dce8bb5d58842b0012df4d554","mergeSha":"d8fcd41010f1e700d38d589a63f851d37e59b986","mergedAt":"2026-08-30T10:39:21Z","mergedBy":"huijoohwee","autoMergeDigest":"378d938df1a4802853b0ac34a553b1957d3b0c4db32a8d403b47cc9d254e8aeb","autoMergeRequest":{"mergeMethod":"SQUASH","commitHeadline":"docs(runtime-readiness-docs-pin-4bb7790f): promote ACOS pin","commitBody":null,"enabledAt":"2026-08-30T10:29:56Z","enabledBy":{"id":"MDQ6VXNlcjg5NDU4MTI=","login":"huijoohwee","isBot":false}}},"expectedSquashHeadline":"docs(runtime-readiness-docs-pin-4bb7790f): promote ACOS pin","malformedCommit":{"sha":"d8fcd41010f1e700d38d589a63f851d37e59b986","parentSha":"3257a94c29272c8dce8bb5d58842b0012df4d554","treeSha":"d6bf44c8242e32b1833b07e8a3b903c776bb7906","messageDigest":"ad6b99d1d71b221c4b5fb74f27bcfccf3d3f76bc3ae91167e725026829858463","objectMessageByteLength":659,"objectMessageSha256":"e54b07993615c218dd70ed351fbde90a70d0bfc7ac697bed9d7b97119484be39","objectMessageTerminalLf":false,"classification":"provider-rewritten-nonterminal-attribution"},"changedEntries":[{"oldMode":"100644","newMode":"100644","oldBlob":"0f3b4e910d593ba9c333216b68b902b35448c339","newBlob":"f7b9b6594bc726edd7db39ad4c190b06af060044","status":"M","path":"docs/runtime-readiness-contract.md"}],"changedPaths":["docs/runtime-readiness-contract.md"],"pinTransition":{"path":"docs/runtime-readiness-contract.md","oldRevision":"6f5d07da1ad42e1b682c5a379f15563e4bbb09be","newRevision":"4bb7790ff8bbcf5f2786182dbcd02c422994695d","oldBlob":"0f3b4e910d593ba9c333216b68b902b35448c339","newBlob":"f7b9b6594bc726edd7db39ad4c190b06af060044","oldContentDigest":"5dd1df038d3472d6ee60a73bf7b58e5c2b20d1b7e3f5907a1b8ed9803e9dd090","newContentDigest":"31ac51b75e4f0b5ff0efcb3556d3c311f3e884a57c9fab1f0609d45042d65705"},"sourceCommitSubjects":["chore(coordination): claim runtime-readiness-docs-pin-4bb7790f lease 522","docs(runtime-readiness-docs-pin-4bb7790f): promote ACOS pin"],"checks":[{"databaseId":33306620707,"jobDatabaseId":99244210024,"event":"pull_request","headBranch":"agent/katrinas-macbook-pro.local/runtime-readiness-docs-pin-4bb7790f","headSha":"49c54dd61dedd8eebbf450f61c7523b980c5bc0d","workflowName":"Integration","conclusion":"success"},{"databaseId":33307008998,"jobDatabaseId":99245220945,"event":"push","headBranch":"main","headSha":"d8fcd41010f1e700d38d589a63f851d37e59b986","workflowName":"Integration","conclusion":"success"}],"checksDigest":"0e746e4ebac4b4a4093516c1616d11c305877a6e7b56a459b1036a1872f02881"},"recovery":{"pullRequest":{"number":894,"nodeId":"PR_kwDOOYnpZs8AAAABBf17hQ","url":"https://github.com/huijoohwee/knowgrph/pull/894","headBranch":"agent/katrinas-macbook-pro.local/runtime-pin-4bb7790f-attribution-recovery","headSha":"c72193fa470ab24798d325d8186b74b9cd3ac190","baseBranch":"main","baseSha":"d8fcd41010f1e700d38d589a63f851d37e59b986","mergeSha":"36c8c4c5c41f88bc441459d2bbbb7d1db9f7212f","mergedAt":"2026-08-30T11:12:32Z","mergedBy":"huijoohwee","autoMergeDigest":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","autoMergeRequest":null},"sourceHeadSha":"c72193fa470ab24798d325d8186b74b9cd3ac190","sourceTreeSha":"a9301fd0918d1c05727c4a36106811d5281cccfd","sourceCommitMessageDigest":"ee9c477d995d076f9397fd8f78060b265601540a4e5691a852246e57e9df44c9","sourceObjectMessageByteLength":384,"sourceObjectMessageSha256":"e91fa254203cc484f3577f316f70ba8f48569582d3491c035c64a85cbe1b9cdd","sourceObjectMessageTerminalLf":true,"mergeSha":"36c8c4c5c41f88bc441459d2bbbb7d1db9f7212f","parentSha":"d8fcd41010f1e700d38d589a63f851d37e59b986","treeSha":"a9301fd0918d1c05727c4a36106811d5281cccfd","commitMessageDigest":"211f9c5e60ff8a1bf01b74f10ec61f5d52c37b787b40ee142b7c64a0b4663c60","commitObjectMessageByteLength":440,"commitObjectMessageSha256":"be9ecd22f8a90048eacacdab53c19f8046dc1743d03b0ad8dfac2169d2fc9944","commitObjectMessageTerminalLf":false,"evidencePath":"docs/runtime-pin-4bb7790f-squash-attribution-recovery.md","evidenceBlobSha":"8d1faf624aed8227d5789dec1ae988c4a44401a0","evidenceBlobDigest":"e735300ae1ca8629be1cad91204b2834ea6bef16f54ef652a5524193ed919c61","evidenceContentDigest":"74cb45bd6d4aa0f8feb755b71da84a03b354890e3bef2899a725886ad48a115e","frontmatterDigest":"adf2a1b518cf1f756591dc4e154cddc60a873d304d46272b0d5853e6b249acb5","controllerRevision":"4bb7790ff8bbcf5f2786182dbcd02c422994695d","checks":[{"databaseId":33307786376,"jobDatabaseId":99247301014,"event":"pull_request","headBranch":"agent/katrinas-macbook-pro.local/runtime-pin-4bb7790f-attribution-recovery","headSha":"c72193fa470ab24798d325d8186b74b9cd3ac190","workflowName":"Integration","conclusion":"success"},{"databaseId":33308346844,"jobDatabaseId":99248783853,"event":"push","headBranch":"main","headSha":"36c8c4c5c41f88bc441459d2bbbb7d1db9f7212f","workflowName":"Integration","conclusion":"success"}],"checksDigest":"4c2a54c382afd247036a56a8391bf6234e908fa7853e44c5c7af048a9177c1f4","cleanupReceiptDigest":"d81536180609478b0765452950c7766e5a87049a35ac08beddb6af8b2d0428f4","changedEntries":[{"oldMode":"000000","newMode":"100644","oldBlob":"0000000000000000000000000000000000000000","newBlob":"8d1faf624aed8227d5789dec1ae988c4a44401a0","status":"A","path":"docs/runtime-pin-4bb7790f-squash-attribution-recovery.md"}],"changedPaths":["docs/runtime-pin-4bb7790f-squash-attribution-recovery.md"],"deploymentAuthority":"forbidden","terminal":{"status":"completed-and-cleaned","branch":"agent/katrinas-macbook-pro.local/runtime-pin-4bb7790f-attribution-recovery","sessionId":"runtime-pin-4bb7790f-attribution-recovery-20260830","scope":"runtime-pin-4bb7790f-attribution-recovery","completedLeaseDigest":"0557fe1103807cfdfe54d001696568eae467d2d36d2e3ac06cfae98c22bb29d5","taskAuthorityBindingDigest":"a26f41a131b1ef126f265b504f893e827474527fce61e7d62b9e2498130187d4","taskCompletion":{"status":"completed-lease-bound","authoritySubjectId":"urn:agentic-task:8e58eaf8648da5ab9711521fa0183da89ba8bc97dfb5a9e8ebc79256b911a8f5","proofAdapterId":"urn:agentic-proof:ed25519-file:v1","generation":1,"bindingDigest":"a26f41a131b1ef126f265b504f893e827474527fce61e7d62b9e2498130187d4","laneBindingDigest":"7f6b2e38b0deb235497c81b63889c27661167561749779d12877e70514c81600","publicKeyDigest":"ddd16632888d2ffdea4bbfcf87e8a35b4e878bbf19cdb8e8b4347b6f2997847b","completedLeaseDigest":"0557fe1103807cfdfe54d001696568eae467d2d36d2e3ac06cfae98c22bb29d5","evidenceDigest":"6d7aadb6c5926c01074fa40c2db207a968730b2e88a6ea0b58b71bef6fac055c"},"claimId":"c0fc5c7367c3b4ac5aec15d2d84c43a4a41805b45dbb94cafb2e698d834c0723","claimDigest":"adde6d6fcf4d11965a580357253311086f5d8fccaeb88b79c7aa8d66b1e16647","terminalCloud":{"claimId":"c0fc5c7367c3b4ac5aec15d2d84c43a4a41805b45dbb94cafb2e698d834c0723","integrationEntryDigest":"a7fce19516486c77e3c51de72199124f1adbbaf54b93f7a9470f97f6b12ddfc5","retirementEntryDigest":"e06b22992acf07ff46ef783a96055e5ebdd44695945f5df890e7665ba181e3fb","terminalClaimDigest":"dcb347e195f4007f5247ef685ee0e1ccfbdc29888404d4d3d202e5c886566e88","integrationReceiptDigest":"9282328b00ed97d8fe83ab74342d6bb9b06716ed685ed03483df7283fb825b31","repositoryId":"github-repository:R_kgDOOYnpZg","canonicalBaseRevision":"d8fcd41010f1e700d38d589a63f851d37e59b986","declaredWriteScopeDigest":"d6dfa6a6b6e96350df7c8909dedf317c4615ac8eea7b7de7f925571aa7792d39","deviceId":"device:f7c5c694f024ed25783c3c8ee600297a8b2e1e09f7c74010fd5609d74693e665","sessionId":"session:d0b3366905bb07407374191f140cb460c3e2b02059ff232e617263286fcbf3b2","workItemId":"work-item:9fc46d4cb4c4819b8b470db59f4e1dff7577c12a0490da10c3a9cc74ce88fdfb","focusedEvidenceDigest":"6939a9fda8028afb43a9ae5f2cec0d4714e5b74fbcfa2ea54ce1db737b9a9128","historicalAuthorityDigest":"6db952426242ed47b3e1829aeceda28faf1f15e87debc488a453305d46899cd0","reviewRequestId":"github-pull-request:PR_kwDOOYnpZs8AAAABBf17hQ","laneRevision":"c72193fa470ab24798d325d8186b74b9cd3ac190","writeSetDigest":"d6dfa6a6b6e96350df7c8909dedf317c4615ac8eea7b7de7f925571aa7792d39","leaseEpoch":1,"immutableSubjectDigest":"d5d1323a205a11d7e1884098122e4a0be830f8a4eaf251e741b6c71cd839e946","integrationEvidenceDigest":"d6f1ac651c09bd120e1cd156e587fd3c1c55842f4070bb0e101995644e59fcd5","retirementEvidenceDigest":"e062ee11630ac199b38dd9e5b5a4de97791ce231f3e8a123825b5e6fbe7c3264","transitionCounter":6,"sequence":6357},"completion":{"mergeCommitSha":"36c8c4c5c41f88bc441459d2bbbb7d1db9f7212f","mainSha":"36c8c4c5c41f88bc441459d2bbbb7d1db9f7212f"},"cleanupReceiptDigest":"d81536180609478b0765452950c7766e5a87049a35ac08beddb6af8b2d0428f4","worktree":"absent","branchRef":"preserved","remoteBranch":"absent-or-preserved-exact"}},"canonical":{"protectedMainSha":"36c8c4c5c41f88bc441459d2bbbb7d1db9f7212f","recoveryContained":true,"controllerContained":true},"preservation":{"authoredSourceBytes":"unchanged","authoredTree":"unchanged","authoredBranchRef":"unchanged","worktreeProjection":"detached-at-canonical-main","indexProjection":"canonical-main","remoteTrackingRefs":"unchanged","pullRequest":"unchanged","autoMerge":"unchanged","newClaims":"none","runtime":"not-performed","cleanup":"not-performed","release":"not-performed","deployment":"not-performed"},"evidenceDigest":"056272c4619a7633d51c56e2dcfdbb5b147a2a6966e885dc80fb1c12143d4dde"});
const hash = label => digestValue({ label });
const clone = value => structuredClone(value);
const PR819 = Object.freeze({
  repository: "huijoohwee/agentic-canvas-os",
  number: 819,
  nodeId: "PR_kwDOSr5-fM8AAAABBf_I-Q",
  url: "https://github.com/huijoohwee/agentic-canvas-os/pull/819",
  sessionId: "01a04dfc-3492-71f0-83ce-ac8e0ec66663",
  device: "huis-macbook-pro-3.local",
  epoch: 5,
  scope: "successor-rollover-pr-marker-replan",
  branch: "agent/huis-macbook-pro-3.local/successor-rollover-pr-marker-replan",
  claimId: "06dc664eabb28b6e685f6773911e1b1f84b6364cb43edb756157a380f49c2e14",
  claimDigest: "13ebe9e21f0bae1cd8387f87f4171f40a25ded61fea99ec1d209de9423561a04",
  baseSha: "a909f2418aba9e43996f649a7d9fffef8d364639",
  fenceSha: "84ee696bc4eefd74979705e82812fb1a01b9e340",
  fenceTreeSha: "036ad30104cc544da2df2e0c8253707f1ee6adf8",
  headSha: "91fbc80a03c82b5ee49f0f89a8d1fba1af21ac48",
  treeSha: "7362a11e7cb8cf2d5488257a1c71afdbd5650c3b",
  mergeSha: "a2fd604b8471659ccbbf1bdc5a7ac0757872141c",
  headline: "fix(successor-rollover-pr-marker-replan): seal refresh",
  integrationReceiptDigest:
    "09fb254233370de877322ddaeec39262d7d8f878935170972496265ef58e6c14",
  continuationReceiptDigest:
    "2dda014387c3e12278e4197fc27d08343c93a141e1c9ccf0065232144cf58dbd",
  paths: Object.freeze([
    "__tests__/active-dirty-scope-expansion-successor-rollover-continuation-refresh.test.mjs",
    "docs/ACTIVE-DIRTY-SCOPE-EXPANSION-SUCCESSOR-ROLLOVER.md",
    "scripts/active-dirty-scope-expansion-successor-rollover-continuation-refresh.mjs",
    "scripts/active-dirty-scope-expansion-successor-rollover-repository-adapter.mjs",
    "scripts/active-dirty-scope-expansion-successor-rollover.mjs",
  ]),
  taskAuthority: Object.freeze({
    schema: "agentic-task-authority-binding/v1",
    authoritySubjectId:
      "urn:agentic-task:a24f3e75cf0cf9440eb6683bb276b67bc65535d9c7f3505ccc4f3680801791cd",
    proofAdapterId: "urn:agentic-proof:ed25519-file:v1",
    generation: 1,
    publicKey: "MCowBQYDK2VwAyEA7USlRHNINHuKqvNRRkbMHu0niv6eo9ZTmYSouPaKiok=",
    publicKeyDigest: "47986c1876e251f0076739c468a483f6daa621aeb87eaf93ba60f5945f2dbbaa",
    laneBindingDigest: "3a7a2ae5f337b149ae498f5f06cd329478519a8dc97678ab9287c1b7be8cdb03",
    bindingMode: "claim",
    boundAt: "2026-08-30T11:37:02.166Z",
    transitionPlanDigest: null,
    priorBindingDigest: null,
    bindingDigest: "16a20cac9a49ed8d9153391883c4d045b0d4bad9c3a277b59ac630186984fce8",
  }),
});
const PR819_CONTINUATION = Object.freeze({
  schema: "agentic-lane-admission-continuation-receipt/v1",
  status: "admitted",
  claimId: PR819.claimId,
  predecessorPlanReceiptDigest:
    "98b4592703c96b7248203e72d601702a396300f51bb98f5b5c7736b89ccd5e43",
  predecessorAdmissionReceiptDigest:
    "eaf47dbaa8212dccd5d1639c714a7056a6e29ce639bb51981656091b9a138d27",
  manifestDigest: "6540606efab5e3dea4b80003ab315bdbdc9454a7e768afea5c9141036b0f70e8",
  writeSetDigest: "019f684d69c2540c7eec72a02dd56425aaddf9227ecf10ebc5efe070b36b4d06",
  localFenceSha: PR819.fenceSha,
  candidateStateDigest: "7fb57d47d1b710fb396ff780ba7150252a0947531d962b4c2ccdb990a292e90b",
  candidateRevision: PR819.fenceSha,
  candidateTreeSha: PR819.fenceTreeSha,
  preparedIntegrationReceiptDigest: null,
  peerLaneStateDigest: "94c5ed32636593ef251d69452e8b33b44f912008ddaa10ce593074daedba5d4c",
  deliveryPeerAuthorityReceiptDigest:
    "b3c18cb8333024d7e3a47dcbcf42933544f538f74963a611a1f3ccf9c5428f1b",
  peerOperationReceiptDigests: Object.freeze([
    "5e072fd0bf035afef8cacf6a8c47becec8c0ecd4a997ef90680629ceadc85f79",
    "e62a95622b050065067044ca67fd4234414e7e603a69bb998ef53e407ae814d4",
    "f2ef279f54e80fe019d5d37f573b9eabe884f7deee4be5b12771b60e35401c7e",
    "afd451601202e8b66d08bc13da093fd7700fb90d91dea32debdf2fc2b4ef7ee1",
    "62bc955f66b09b1892ed42359ab97a0634ce2dc119339676c5e8ef75863d83d4",
    "34a50e4865f22bdd1d2c92be989a14d4038f5a01eb59f6bcdc1e3ca11553602b",
    "3bcc0251bfd67046f8a86ca3f01c3e8c6d46d6f266026883f414e114818d7c14",
    "0121d9cbab1e1632841047897d821b1700ba37271089afca5490dff2eead0dda",
    "6333d4cebac673544af7eef65d5fe3f1c6a55e5390f2d03eece21d0919ef5e33",
    "69512675c2e845fba9e645586fd335c5281843c624145f199d62fa46e4ba4765",
    "9e2edc54e619daee4fb5edb6b6cb5b4729e9c883eb5f29941ada7e370e78b8a3",
    "7f6f6c022f9d04863d0e19335cb7addc8f926d054d8f8175020f8b283fc4d0cd",
    "deb65b4a377aff64b8770685b14098ff7421e3f63a324665962f67a7be590f6c",
    "77f2db22468dee3c503ce372661b8b73e6323b2cf1952337098a15626e98bb4a",
    "fa64db9c9113138042322420f5821e7b48e8f13187f797a28775e86dbfe009b9",
    "c7df1ef7452cf17d21df0b1d08c99afaab48d54618b6fddf5bc5d491ad37ccab",
    "c948b0dc7592828c08992879dbe2e22cfdce5fd1a9cf1728ded85598dd63fbcf",
    "6545c7dc8b979ecd66e5bcfbf5fde766af5855a911cf40419f9cf5ed4ee35c46",
    "86110a27b71ba04cf6719ac599189925286337b1d3882680f9edc30e820a1e38",
    "bd149901fc3e867c3276743c317e1e917719e286dd7ea819ab4f8f00a92b3489",
    "ae2ddeb22aa2a144004fafc83ca586bc8daa7ff661a7ea593a67a3d0482ee828",
    "0e1b3e496ff443e6249fbfedc182e369e9001ed92bce9ffe5c6c650a7da2516a",
    "8db0b5dbe185a70f3ac1460934b867d3f75f46134de58439aa397a2f6d73ab32",
    "308ef948026db6d362461effa97f8be74b8d6024d120ca9addfb6b465fe73a8b",
    "4a473351d9e9c8da80b8d25db1f5387de69c0bed8254d20f8ade1e4411c4aa8f",
    "ff255ab63a5ebdd80e65f17df0e92fd7e219a5d8f7094d8ae6c38b8735de8833",
    "73ecaf0a0fb0dd488791e25b7d3d7b3c447d09e365d4bca378cd379e5c43281a",
    "e46c975c76dc61e7e4fd93ab41efb938e68d6821f13e60cd9d90b9a3413c0550",
    "a590a695d99f3e73b26372fadf7448bc9d5ab7a49d380582ec9cf72e0e1f0125",
    "7bf9570440938d70751abdf881ea9dfae78551cac5c3fce9d7cbb8a8fc1afea1",
  ]),
  dormantPreservationReceiptDigest:
    "f301d4b06dd7e4ce35e86ac466f47882feac3d409f135ec45afb964fd3b77dc2",
  protectedAdvanceReceiptDigest:
    "50339556933a5d7a832571ad014931728cddd0edd19ff2bff171e83a4e547493",
  cloudVerificationReceiptDigest:
    "9bb134f3b3ee511e43234e69ddf8eec344745082d1b5598649b9a13e1f9620c9",
  plannedMutationAuthorityReceiptDigest:
    "8aa2f4a83bd6c39f8cbfc37eb8673b7c2c812e8dda2695fdf9fb2785bca813fe",
  mutationAuthorityReceiptDigest:
    "8aa2f4a83bd6c39f8cbfc37eb8673b7c2c812e8dda2695fdf9fb2785bca813fe",
  continuedAt: "2026-08-30T11:40:46.000Z",
  receiptDigest: PR819.continuationReceiptDigest,
});
function leaseFromSubject(subject, {
  status = "delivery",
  mainSha = null,
} = {}) {
  const {
    ownedDirtRecovery: _ownedDirtRecovery,
    pullRequestProjectionRepair: _pullRequestProjectionRepair,
    reviewHeadSha: _reviewHeadSha,
    parkHeadSha: _parkHeadSha,
    parkBranchHeadSha: _parkBranchHeadSha,
    parkSourceEpoch: _parkSourceEpoch,
    parkSourceFenceSha: _parkSourceFenceSha,
    parkStashRef: _parkStashRef,
    parkStashSha: _parkStashSha,
    parkStashMessage: _parkStashMessage,
    parkStashStatus: _parkStashStatus,
    successorLineage,
    ...identity
  } = clone(subject.leaseIdentity);
  return {
    ...identity,
    ...(successorLineage || {}),
    status,
    heartbeatAt: "2026-08-30T12:21:00.000Z",
    expiresAt: "2026-08-30T12:51:00.000Z",
    ...(status === "delivery" ? {} : {
      completion: {
        mergeCommitSha: subject.malformedCommit.sha,
        mainSha,
      },
    }),
  };
}
function resealEvidence(value) {
  const next = clone(value);
  delete next.evidenceDigest;
  next.evidenceDigest = digestValue(next);
  return next;
}
function genericEvidenceFixture(variant) {
  const value = clone(liveEvidence);
  const paths = [...GENERIC_SELF_HOSTED_RECOVERY_PATHS];
  value.controller.targetRepository = value.controller.repository;
  value.subject.repository = value.controller.repository;
  value.subject.leaseIdentity.cloudAuthority.targetRepository = value.controller.repository;
  value.subject.cloudAuthority.targetRepository = value.controller.repository;
  value.subject.pinTransition = null;
  value.subject.protectedRefresh = null;
  value.subject.predecessorAuthority = null;
  value.subject.historicalLeaseEpoch = value.subject.cloudAuthority.leaseEpoch;
  value.subject.sourceCommitAuthors = [{
    name: "katrinateh-dotcom",
    email: "katrinateh@live.com",
  }];
  value.subject.sourceCommitSubjects = [value.subject.expectedSquashHeadline];
  value.subject.changedPaths = paths;
  value.subject.changedEntries = paths.map((repositoryPath, index) => ({
    oldMode: "100644",
    newMode: "100644",
    oldBlob: String(index + 1).repeat(40),
    newBlob: String(index + 5).repeat(40),
    status: "M",
    path: repositoryPath,
  }));
  value.subject.leaseIdentity.integration.paths = paths;
  value.subject.leaseIdentity.successorLineage = null;
  const scopes = paths.map(repositoryPath => `path:${repositoryPath}`);
  value.subject.leaseIdentity.admission.declaredWriteSet = [
    ...scopes,
    `semantic:${value.subject.scope}`,
  ];
  value.subject.leaseIdentity.cloudAuthority.cloudDeclaredWriteScope = [
    ...scopes,
    `semantic:${value.subject.scope}`,
  ];
  value.subject.cloudAuthority = clone(value.subject.leaseIdentity.cloudAuthority);
  value.subject.checks = value.subject.checks.map(run => ({
    ...run,
    workflowName: "CI",
    workflowPath: ".github/workflows/ci.yml",
  }));
  value.subject.checksDigest = digestValue(value.subject.checks);
  value.subject.leaseIdentityDigest = digestValue(value.subject.leaseIdentity);

  value.recovery.genericRecoveryVariant = variant;
  value.recovery.subjectAncestorOfRecoveryParent = true;
  value.recovery.checks = value.recovery.checks.map(run => ({
    ...run,
    workflowName: "CI",
    workflowPath: ".github/workflows/ci.yml",
  }));
  value.recovery.checksDigest = digestValue(value.recovery.checks);
  if (variant === "evidence-document") {
    const evidencePath = `docs/CANONICAL-SQUASH-PR${value.subject.pullRequest.number}-ATTRIBUTION-RECOVERY.md`;
    value.recovery.evidencePath = evidencePath;
    value.recovery.changedPaths = [evidencePath];
    value.recovery.changedEntries = [{
      oldMode: "000000",
      newMode: "100644",
      oldBlob: "0".repeat(40),
      newBlob: value.recovery.evidenceBlobSha,
      status: "A",
      path: evidencePath,
    }];
    value.recovery.controllerRevision = value.subject.malformedCommit.sha;
  } else {
    value.recovery.evidencePath = GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH;
    value.recovery.changedPaths = paths;
    value.recovery.changedEntries = paths.map((repositoryPath, index) => ({
      oldMode: "100644",
      newMode: "100644",
      oldBlob: String(index + 1).repeat(40),
      newBlob: repositoryPath === GENERIC_SELF_HOSTED_RECOVERY_EVIDENCE_PATH
        ? value.recovery.evidenceBlobSha
        : String(index + 6).repeat(40),
      status: "M",
      path: repositoryPath,
    }));
    value.recovery.controllerRevision = value.recovery.mergeSha;
    value.controller.revision = value.recovery.mergeSha;
    value.controller.tree = value.recovery.treeSha;
  }
  return resealEvidence(value);
}
function resealAdmissionContinuation(lease) {
  const { receiptDigest: _receiptDigest, ...core } = lease.admissionContinuation;
  lease.admissionContinuation = {
    ...core,
    receiptDigest: digestValue(core),
  };
  lease.admission.continuationReceiptDigest = lease.admissionContinuation.receiptDigest;
  return lease;
}
function legacyAdmissionContinuationLeaseFixture({ candidateTreeSha = PR819.fenceTreeSha } = {}) {
  const lease = clone(genericEvidenceFixture("evidence-document").subject.leaseIdentity);
  const scopes = [
    ...PR819.paths.map(repositoryPath => `path:${repositoryPath}`),
    `semantic:${PR819.scope}`,
  ];
  Object.assign(lease, {
    epoch: PR819.epoch,
    sessionId: PR819.sessionId,
    device: PR819.device,
    scope: PR819.scope,
    branch: PR819.branch,
    baseSha: PR819.baseSha,
    fenceSha: PR819.fenceSha,
    pullRequestUrl: PR819.url,
    deliveryHeadSha: PR819.headSha,
    acquiredAt: PR819.taskAuthority.boundAt,
  });
  lease.autoDelivery = false;
  lease.runtimeRequired = false;
  lease.admission = {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: PR819.scope,
    declaredWriteSet: [...scopes],
    writeSetDigest: PR819_CONTINUATION.writeSetDigest,
    manifestDigest: PR819_CONTINUATION.manifestDigest,
    planReceiptDigest: PR819_CONTINUATION.predecessorPlanReceiptDigest,
    admissionReceiptDigest: PR819_CONTINUATION.predecessorAdmissionReceiptDigest,
    existingLaneStateDigest: PR819_CONTINUATION.peerLaneStateDigest,
    admittedReportDigest:
      "6e9787245c35afec74f3c3249c16159f8baf649e25e8516b47bcebe71d462b1e",
    preservationReceiptDigest:
      "6e9787245c35afec74f3c3249c16159f8baf649e25e8516b47bcebe71d462b1e",
    continuationReceiptDigest: PR819.continuationReceiptDigest,
  };
  Object.assign(lease.cloudAuthority, {
    targetRepository: PR819.repository,
    claimId: PR819.claimId,
    claimDigest: PR819.claimDigest,
    operationReceiptDigest: PR819.integrationReceiptDigest,
    canonicalBaseSha: PR819.baseSha,
    laneRevision: PR819.headSha,
    cloudDeclaredWriteScope: [...scopes],
    writeSetDigest: PR819_CONTINUATION.writeSetDigest,
    deviceId: PR819.device,
    sessionId: PR819.sessionId,
    reviewRequestId: `github-pull-request:${PR819.nodeId}`,
    integrationReceiptDigest: PR819.integrationReceiptDigest,
    manifestDigest: PR819_CONTINUATION.manifestDigest,
  });
  Object.assign(lease.cloudAuthority.integration, {
    candidateRevision: PR819.headSha,
    reviewRequestId: `github-pull-request:${PR819.nodeId}`,
  });
  lease.integration = {
    schema: "agentic-integration-commit/v1",
    commitSha: PR819.headSha,
    treeSha: PR819.treeSha,
    commitMessage: PR819.headline,
    manifestDigest: "4d2dcd821d8aad21796c1a5d2624d5d97a8214c02aeb1fd2ab786014b1cb2330",
    stagedDiffDigest: "453be478f1043267853fa35a1ca701b167e8743c888c36dd1edcd19517d3a421",
    paths: [...PR819.paths],
    recordedAt: "2026-08-30T12:15:43.521Z",
  };
  lease.taskAuthority = clone(PR819.taskAuthority);
  lease.admissionContinuation = {
    ...clone(PR819_CONTINUATION),
    candidateTreeSha,
  };
  return resealAdmissionContinuation(lease);
}
function legacyAdmissionContinuationEvidenceFixture() {
  const value = genericEvidenceFixture("evidence-document");
  const lease = legacyAdmissionContinuationLeaseFixture();
  Object.assign(value.subject, {
    repository: PR819.repository,
    branch: PR819.branch,
    sessionId: PR819.sessionId,
    scope: PR819.scope,
    leaseIdentity: lease,
    taskAuthorityBindingDigest: PR819.taskAuthority.bindingDigest,
    taskAuthority: clone(PR819.taskAuthority),
    claimId: PR819.claimId,
    claimDigest: PR819.claimDigest,
    integrationReceiptDigest: PR819.integrationReceiptDigest,
    cloudAuthority: clone(lease.cloudAuthority),
    reviewedHeadSha: PR819.headSha,
    reviewedTreeSha: PR819.treeSha,
    remoteBranch: "absent",
    expectedSquashHeadline: PR819.headline,
    changedPaths: [...PR819.paths],
    pinTransition: null,
    protectedRefresh: null,
    historicalLeaseEpoch: 1,
    predecessorAuthority: null,
    sourceCommitAuthors: [{
      name: "huijoohwee",
      email: "8945812+huijoohwee@users.noreply.github.com",
    }],
  });
  value.subject.deliveryEvidence = {
    dependencyClosureDigest: lease.cloudAuthority.integration.dependencyClosureDigest,
    namedChecksDigest: lease.cloudAuthority.integration.namedChecksDigest,
    handoffEvidenceDigest: lease.cloudAuthority.integration.handoffEvidenceDigest,
    operatorDecisionDigest: lease.cloudAuthority.integration.operatorDecisionDigest,
    integrationIntentDigest: lease.cloudAuthority.integration.integrationIntentDigest,
  };
  value.subject.reviewedCommit.sha = PR819.headSha;
  value.subject.reviewedCommit.treeSha = PR819.treeSha;
  value.subject.pullRequest = {
    number: PR819.number,
    nodeId: PR819.nodeId,
    url: PR819.url,
    headBranch: PR819.branch,
    headSha: PR819.headSha,
    baseBranch: "main",
    baseSha: PR819.baseSha,
    mergeSha: PR819.mergeSha,
    mergedAt: "2026-08-30T12:27:19Z",
    mergedBy: "huijoohwee",
    autoMergeDigest: null,
    autoMergeRequest: {
      mergeMethod: "SQUASH",
      commitHeadline: PR819.headline,
      commitBody: null,
      enabledAt: "2026-08-30T12:26:33Z",
      enabledBy: {
        id: "MDQ6VXNlcjg5NDU4MTI=",
        login: "huijoohwee",
        isBot: false,
      },
    },
  };
  value.subject.pullRequest.autoMergeDigest =
    digestValue(value.subject.pullRequest.autoMergeRequest);
  Object.assign(value.subject.malformedCommit, {
    sha: PR819.mergeSha,
    parentSha: PR819.baseSha,
    treeSha: PR819.treeSha,
    classification: "provider-rewritten-terminal-attribution-body-mismatch",
  });
  value.subject.changedEntries = PR819.paths.map((repositoryPath, index) => ({
    oldMode: index === 0 || index === 2 ? "000000" : "100644",
    newMode: "100644",
    oldBlob: index === 0 || index === 2 ? "0".repeat(40) : String(index + 1).repeat(40),
    newBlob: (index + 6).toString(16).repeat(40),
    status: index === 0 || index === 2 ? "A" : "M",
    path: repositoryPath,
  }));
  value.subject.checks[0].headBranch = PR819.branch;
  value.subject.checks[0].headSha = PR819.headSha;
  value.subject.checks[1].headSha = PR819.mergeSha;
  value.subject.checksDigest = digestValue(value.subject.checks);
  value.subject.leaseIdentityDigest = digestValue(value.subject.leaseIdentity);
  value.subject.sourceCommitSubjects = [
    "chore(coordination): claim successor-rollover-pr-marker-replan lease 5",
    PR819.headline,
  ];
  value.subject.sourceCommitProviderActors = [
    value.subject.leaseIdentity.fenceSha,
    value.subject.reviewedHeadSha,
  ].map(revision => ({
    revision,
    authorLogin: value.subject.pullRequest.mergedBy,
    committerLogin: value.subject.pullRequest.mergedBy,
  }));
  const recoveryPath = `docs/CANONICAL-SQUASH-PR${PR819.number}-ATTRIBUTION-RECOVERY.md`;
  value.recovery.evidencePath = recoveryPath;
  value.recovery.changedPaths = [recoveryPath];
  value.recovery.changedEntries[0].path = recoveryPath;
  value.recovery.controllerRevision = PR819.mergeSha;
  return resealEvidence(value);
}
function refreshedGenericEvidenceFixture() {
  const value = genericEvidenceFixture("evidence-document");
  value.subject.changedEntries = value.subject.changedEntries.map(entry => ({
    ...entry,
    status: "A",
    oldMode: "000000",
    oldBlob: "0".repeat(40),
  }));
  const authoredHeadSha = "a".repeat(40);
  const authoredTreeSha = "b".repeat(40);
  value.subject.leaseIdentity.integration.commitSha = authoredHeadSha;
  value.subject.leaseIdentity.integration.treeSha = authoredTreeSha;
  value.subject.protectedRefresh = {
    authoredCommit: {
      ...clone(value.subject.reviewedCommit),
      sha: authoredHeadSha,
      treeSha: authoredTreeSha,
    },
    authoredParentSha: "c".repeat(40),
    reviewedParentShas: [authoredHeadSha, value.subject.leaseIdentity.baseSha],
    changedEntries: clone(value.subject.changedEntries),
  };
  value.subject.leaseIdentityDigest = digestValue(value.subject.leaseIdentity);
  return resealEvidence(value);
}
function lineagedGenericEvidenceFixture() {
  const value = refreshedGenericEvidenceFixture();
  value.subject.cloudAuthority.leaseEpoch = 3;
  value.subject.leaseIdentity.cloudAuthority.leaseEpoch = 3;
  value.subject.leaseIdentity.fenceSha = value.subject.leaseIdentity.deliveryHeadSha;
  value.subject.historicalLeaseEpoch = 2;
  const priorBindingDigest = value.subject.taskAuthority.bindingDigest;
  const lane = leaseFromSubject(value.subject);
  const taskAuthority = createTaskAuthorityBinding({
    capability: createTaskAuthorityCapability({ issuedAt: "2026-08-30T00:00:00.000Z" }),
    lease: lane,
    bindingMode: "continuation",
    priorBindingDigest,
    boundAt: "2026-08-30T20:38:16.817Z",
  });
  value.subject.taskAuthority = clone(taskAuthority);
  value.subject.taskAuthorityBindingDigest = taskAuthority.bindingDigest;
  value.subject.leaseIdentity.taskAuthority = clone(taskAuthority);
  const sourceClaimId = hash("source-claim");
  const successorClaimId = hash("successor-claim");
  const recoveryPlanDigest = hash("recovery-plan");
  const sourceFenceSha = "2".repeat(40);
  const targetBaseSha = "3".repeat(40);
  const targetLaneRevision = "4".repeat(40);
  value.subject.protectedRefresh.authoredParentSha = targetLaneRevision;
  const successorCore = {
    schema: "agentic-active-publish-task-authority-successor-receipt/v1",
    branch: value.subject.branch,
    epoch: value.subject.leaseIdentity.epoch,
    sourceBaseSha: targetBaseSha,
    sourceFenceSha: targetLaneRevision,
    sourceClaimId: successorClaimId,
    sourceBindingDigest: priorBindingDigest,
    targetBaseSha: value.subject.leaseIdentity.baseSha,
    targetFenceSha: value.subject.leaseIdentity.deliveryHeadSha,
    targetClaimId: value.subject.cloudAuthority.claimId,
    targetBindingDigest: taskAuthority.bindingDigest,
    cloudOperationReceiptDigest: hash("successor-operation"),
    cloudVerificationReceiptDigest: hash("successor-verification"),
    boundAt: "2026-08-30T20:38:16.817Z",
  };
  value.subject.leaseIdentity.successorLineage = {
    activeOwnedDirtRecovery: {
      schema: "agentic-active-owned-dirt-recovery-lease/v1",
      status: "recovered",
      sourceEpoch: value.subject.leaseIdentity.epoch - 1,
      sourceSessionId: value.subject.sessionId,
      sourceDevice: value.subject.leaseIdentity.device,
      sourceBranch: value.subject.branch,
      sourceFenceSha,
      sourceClaimId,
      planDigest: recoveryPlanDigest,
      evidenceDigest: hash("recovery-evidence"),
      snapshotReceiptDigest: hash("snapshot-receipt"),
      snapshotRef: `refs/agentic-canvas-os/recovery/active-owned-dirt/${sourceClaimId}/${recoveryPlanDigest}`,
      snapshotCommitSha: "5".repeat(40),
      snapshotIndexCommitSha: "6".repeat(40),
      recoveredClaimDigest: hash("recovered-claim"),
      recoveredLedgerRevision: "7".repeat(40),
      recoveredClaimLedgerRevision: hash("recovered-ledger-entry"),
      recoveredTransitionCounter: 10,
      recoveredAt: "2026-08-30T15:55:40.000Z",
    },
    activeOwnedDirtCurrentBaseReanchor: {
      schema: "agentic-active-owned-dirt-current-base-reanchor-lease/v1",
      status: "reanchored",
      planDigest: hash("reanchor-plan"),
      sourceClaimId,
      successorClaimId,
      sourceBaseSha: "8".repeat(40),
      sourceFenceSha,
      targetCanonicalBaseSha: targetBaseSha,
      targetLaneRevision,
      targetDirtEvidenceDigest: hash("target-dirt"),
      taskContinuationReceiptDigest: hash("task-continuation"),
    },
    activePublishTaskAuthoritySuccessor: {
      ...successorCore,
      receiptDigest: digestValue(successorCore),
    },
    activePublishSuccessorIntent: null,
  };
  value.subject.predecessorAuthority = {
    currentClaimId: value.subject.cloudAuthority.claimId,
    predecessorClaimId: successorClaimId,
    canonicalBaseSha: targetBaseSha,
    laneRevision: targetLaneRevision,
    leaseEpoch: value.subject.historicalLeaseEpoch,
  };
  value.subject.leaseIdentityDigest = digestValue(value.subject.leaseIdentity);
  return resealEvidence(value);
}
function taskReceipt(subject, operation, label) {
  const core = {
    schema: "agentic-task-authority-verification-receipt/v1",
    status: "verified",
    authoritySubjectId: subject.taskAuthority.authoritySubjectId,
    proofAdapterId: subject.taskAuthority.proofAdapterId,
    generation: subject.taskAuthority.generation,
    bindingDigest: subject.taskAuthority.bindingDigest,
    proofDigest: hash(`proof-${label}`),
    operation,
    verifiedAt: "2026-08-30T12:21:00.000Z",
  };
  return Object.freeze({
    ...core,
    receiptDigest: digestValue({
      authoritySubjectId: core.authoritySubjectId,
      bindingDigest: core.bindingDigest,
      proofDigest: core.proofDigest,
      operation: core.operation,
      verifiedAt: core.verifiedAt,
    }),
  });
}
function terminalCloud(plan) {
  const subject = plan.evidence.subject;
  return Object.freeze({
    claimId: subject.claimId,
    integrationEntryDigest: hash("integration-entry"),
    retirementEntryDigest: hash("retirement-entry"),
    terminalClaimDigest: hash("terminal-claim"),
    integrationReceiptDigest: subject.integrationReceiptDigest,
    repositoryId: "github-repository:R_target",
    canonicalBaseRevision: subject.cloudAuthority.canonicalBaseSha,
    declaredWriteScopeDigest: hash("declared-write-scope"),
    deviceId: "device:exact",
    sessionId: "session:exact",
    workItemId: "work-item:exact",
    focusedEvidenceDigest: hash("focused"),
    historicalAuthorityDigest: hash("historical"),
    reviewRequestId: `github-pull-request:${subject.pullRequest.nodeId}`,
    laneRevision: subject.reviewedHeadSha,
    writeSetDigest: subject.cloudAuthority.writeSetDigest,
    leaseEpoch: subject.cloudAuthority.leaseEpoch,
    immutableSubjectDigest: hash("immutable"),
    integrationEvidenceDigest: hash("integration-evidence"),
    retirementEvidenceDigest: hash("retirement-evidence"),
    transitionCounter: 6,
    sequence: 7000,
  });
}
function pullIdentityDigest(pull) {
  return digestValue({
    number: pull.number,
    nodeId: pull.nodeId,
    url: pull.url,
    headBranch: pull.headBranch,
    headSha: pull.headSha,
    baseBranch: pull.baseBranch,
    baseSha: pull.baseSha,
    mergeSha: pull.mergeSha,
    mergedAt: pull.mergedAt,
    mergedBy: pull.mergedBy,
    autoMergeDigest: pull.autoMergeDigest,
  });
}
function terminalEvidence(plan, cloud, completingLeaseDigest) {
  const subject = plan.evidence.subject;
  return Object.freeze({
    schema: "agentic-canonical-squash-attribution-recovery-terminal-evidence/v1",
    status: "completion-ready",
    planDigest: plan.planDigest,
    evidenceDigest: plan.evidence.evidenceDigest,
    subject: {
      branch: subject.branch,
      reviewedHeadSha: subject.reviewedHeadSha,
      reviewedTreeSha: subject.reviewedTreeSha,
      authoredBranchSha: subject.reviewedHeadSha,
      authoredTreeSha: subject.reviewedTreeSha,
      mergeSha: subject.malformedCommit.sha,
      pullRequestIdentityDigest: pullIdentityDigest(subject.pullRequest),
    },
    cloud: {
      status: "retired",
      claimId: subject.claimId,
      terminalStateDigest: digestValue(cloud),
    },
    completion: {
      status: "completion-ready-or-completed",
      mainSha: plan.evidence.canonical.protectedMainSha,
      completingLeaseDigest,
    },
    recovery: {
      status: "completed-and-cleaned",
      mergeSha: plan.evidence.recovery.mergeSha,
      terminalStateDigest: digestValue(plan.evidence.recovery.terminal),
    },
    effects: {
      cloudClaim: "retired",
      localLease: "completion-ready",
      worktreeProjection: "detached-canonical-or-terminally-cleaned",
      authoredSourceBytes: "unchanged",
      authoredTree: "unchanged",
      authoredBranchRef: "unchanged",
      pullRequest: "unchanged",
      autoMerge: "unchanged",
      newClaims: "none",
      runtime: "not-performed",
      cleanup: "not-performed-by-this-controller",
      release: "not-performed",
      deployment: "not-performed",
    },
    continuation: "device:integrate",
  });
}
function fakeAdapter({
  evidence = liveEvidence,
  failAtomicCompleteOnce = false,
  wrongTaskIdentity = false,
} = {}) {
  let journal = null;
  let fail = failAtomicCompleteOnce;
  let terminalVerifications = 0;
  const effects = [];
  return {
    effects,
    get journal() { return journal; },
    get terminalVerifications() { return terminalVerifications; },
    async withOperationLock(_context, action) { return action(); },
    async withLaneFence(_context, action) { return action(); },
    async readJournal() { return journal; },
    async writeJournal({ expected, next }) {
      assert.equal(expected?.journalDigest || null, journal?.journalDigest || null);
      if (fail && next.state?.phase === "complete") {
        fail = false;
        throw new Error("simulated crash before atomic terminal CAS");
      }
      journal = clone(next);
      return journal;
    },
    async observe(input = {}) {
      assert.ok(input.observedAt === undefined
        || input.observedAt === evidence.observedAt);
      return clone(evidence);
    },
    async verifyEvidence({ plan }) {
      return { evidenceVerificationDigest: digestValue({
        planDigest: plan.planDigest,
        evidenceDigest: plan.evidence.evidenceDigest,
      }) };
    },
    async retireCloud({ plan, operationKey: key }) {
      effects.push("cloud");
      const operation = `canonical-squash-attribution-recovery:cloud:${plan.planDigest}:${key}`;
      const task = taskReceipt(plan.evidence.subject, operation, "cloud");
      const returnedTask = wrongTaskIdentity
        ? { ...task, authoritySubjectId: "urn:foreign" }
        : task;
      const cloud = terminalCloud(plan);
      const receipt = {
        schema: "agentic-post-merge-cloud-authority-verification/v1",
        status: "integrated-retired",
        claimId: plan.evidence.subject.claimId,
        pullRequestNumber: plan.evidence.subject.pullRequest.number,
        pullRequestNodeId: plan.evidence.subject.pullRequest.nodeId,
        headSha: plan.evidence.subject.reviewedHeadSha,
        mergeCommitSha: plan.evidence.subject.malformedCommit.sha,
        integrationReceiptDigest: plan.evidence.subject.integrationReceiptDigest,
      };
      return {
        disposition: "retired-or-adopted",
        cloudRetirementReceiptDigest: digestValue(receipt),
        cloudRetirementReceipt: receipt,
        terminalCloud: cloud,
        terminalCloudDigest: digestValue(cloud),
        taskAuthorizationReceipt: returnedTask,
        taskAuthorizationReceiptDigest: task.receiptDigest,
      };
    },
    async projectCompletion({ plan, operationKey: key }) {
      effects.push("completion");
      const operation = `canonical-squash-attribution-recovery:completion:${plan.planDigest}:${key}`;
      const task = taskReceipt(plan.evidence.subject, operation, "completion");
      return {
        disposition: "projected",
        mainSha: plan.evidence.canonical.protectedMainSha,
        completionBaseSha: plan.evidence.canonical.protectedMainSha,
        completionTopologyDigest: digestValue({
          baseSha: plan.evidence.canonical.protectedMainSha,
          targetSha: plan.evidence.canonical.protectedMainSha,
          relation: "protected-descendant",
        }),
        completingLeaseDigest: hash("completing-lease"),
        taskAuthorizationReceipt: task,
        taskAuthorizationReceiptDigest: task.receiptDigest,
        completionSummary: {
          completedBranch: plan.evidence.subject.branch,
          pullRequestUrl: plan.evidence.subject.pullRequest.url,
          mergeCommitSha: plan.evidence.subject.malformedCommit.sha,
          mainSha: plan.evidence.canonical.protectedMainSha,
          status: "runtime_pending",
        },
      };
    },
    async verifyTerminal({ plan }) {
      terminalVerifications += 1;
      const cloud = terminalCloud(plan);
      const evidence = terminalEvidence(plan, cloud, hash("completing-lease"));
      return {
        terminalEvidence: evidence,
        terminalEvidenceDigest: digestValue(evidence),
      };
    },
  };
}
test("live PR893/PR894 evidence closes exact commits, runs, task identity, and recovery", () => {
  const plan = buildPlan(liveEvidence);
  assert.equal(plan.evidence.subject.pullRequest.number, 893);
  assert.equal(plan.evidence.recovery.pullRequest.number, 894);
  assert.deepEqual(plan.evidence.subject.checks.map(value => value.databaseId),
    [33306620707, 33307008998]);
  assert.deepEqual(plan.evidence.recovery.checks.map(value => value.databaseId),
    [33307786376, 33308346844]);
  assert.equal(plan.evidence.recovery.terminal.remoteBranch,
    "absent-or-preserved-exact");
  assert.equal(plan.evidence.subject.remoteBranch, "absent");
  assert.equal(plan.evidence.preservation.remoteTrackingRefs, "unchanged");
  assert.ok(!plan.effects.includes("canonical-remote-tracking-sync"));
});
test("generic evidence-document and self-hosted recovery variants are exact and disjoint", () => {
  for (const variant of ["evidence-document", "self-hosted-controller-update"]) {
    const evidence = genericEvidenceFixture(variant);
    const plan = buildPlan(evidence);
    assert.equal(plan.evidence.subject.pinTransition, null);
    assert.equal(plan.evidence.recovery.genericRecoveryVariant, variant);
    assert.equal(plan.evidence.recovery.subjectAncestorOfRecoveryParent, true);
    assert.deepEqual(plan.evidence.subject.checks.map(run => [
      run.workflowName, run.workflowPath,
    ]), [["CI", ".github/workflows/ci.yml"], ["CI", ".github/workflows/ci.yml"]]);
  }
  const addedSubject = genericEvidenceFixture("evidence-document");
  addedSubject.subject.changedEntries = addedSubject.subject.changedEntries.map(entry => ({
    ...entry,
    status: "A",
    oldMode: "000000",
    oldBlob: "0".repeat(40),
  }));
  assert.equal(buildPlan(resealEvidence(addedSubject))
    .evidence.recovery.genericRecoveryVariant, "evidence-document");
  assert.throws(() => buildPlan(refreshedGenericEvidenceFixture()),
    /protected refresh successor lineage/u);
  const lineaged = buildPlan(lineagedGenericEvidenceFixture()).evidence.subject;
  assert.equal(lineaged.protectedRefresh.authoredCommit.sha, "a".repeat(40));
  const rawLease = leaseFromSubject(lineaged);
  assert.deepEqual(canonicalSquashRecoveryImmutableLeaseProjection(rawLease, {
    genericSelfHosted: true,
  }), lineaged.leaseIdentity);
});
test("closed PR819 admission-continuation profile is sealed and completes without runtime", async () => {
  const standardLease = genericEvidenceFixture("evidence-document").subject.leaseIdentity;
  assert.deepEqual(normalizeCanonicalSquashRecoveryDeliveryProfile(standardLease, {
    genericSelfHosted: true,
  }), {
    profile: "standard-auto-delivery",
    runtime: "canonical",
    admissionContinuation: null,
  });

  const evidence = legacyAdmissionContinuationEvidenceFixture();
  const profile = normalizeCanonicalSquashRecoveryDeliveryProfile(
    evidence.subject.leaseIdentity,
    { genericSelfHosted: true },
  );
  assert.equal(profile.profile, "legacy-admission-continuation");
  assert.equal(profile.runtime, "none");
  assert.deepEqual(profile.admissionContinuation,
    evidence.subject.leaseIdentity.admissionContinuation);
  assert.ok(Object.isFrozen(profile));
  assert.equal(buildPlan(evidence).evidence.subject.malformedCommit.classification,
    "provider-rewritten-terminal-attribution-body-mismatch");

  const adapter = fakeAdapter({ evidence });
  const controller = createCanonicalSquashAttributionRecoveryTerminalizationController({
    adapter,
  });
  const plan = await controller.plan();
  const receipt = await controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  assert.equal(receipt.continuation.runtime, "none");
  assert.equal(normalizeReceipt(receipt, { expectedRuntime: "none" }).receiptDigest,
    receipt.receiptDigest);

  const driftedRuntime = clone(receipt);
  driftedRuntime.continuation.runtime = "canonical";
  const { receiptDigest: _receiptDigest, ...runtimeCore } = driftedRuntime;
  driftedRuntime.receiptDigest = digestValue(runtimeCore);
  assert.throws(() => normalizeReceipt(driftedRuntime, { expectedRuntime: "none" }),
    /receipt continuation/u);
});
test("PR819 legacy profile rejects every structurally valid foreign lineage", () => {
  const foreignSha = label => digestValue({ foreign: label }).slice(0, 40);
  const mutations = [
    value => {
      value.subject.pullRequest.number = 820;
      const recoveryPath = "docs/CANONICAL-SQUASH-PR820-ATTRIBUTION-RECOVERY.md";
      value.recovery.evidencePath = recoveryPath;
      value.recovery.changedPaths = [recoveryPath];
      value.recovery.changedEntries[0].path = recoveryPath;
    },
    value => {
      value.subject.pullRequest.nodeId = "PR_kwDOSr5-fM8AAAABBf_I-R";
      value.subject.leaseIdentity.cloudAuthority.reviewRequestId =
        "github-pull-request:PR_kwDOSr5-fM8AAAABBf_I-R";
      value.subject.leaseIdentity.cloudAuthority.integration.reviewRequestId =
        "github-pull-request:PR_kwDOSr5-fM8AAAABBf_I-R";
    },
    value => {
      const url = "https://github.com/huijoohwee/agentic-canvas-os/pull/820";
      value.subject.pullRequest.url = url;
      value.subject.leaseIdentity.pullRequestUrl = url;
    },
    value => {
      const sessionId = "01a04dfc-3492-71f0-83ce-ac8e0ec66664";
      value.subject.sessionId = sessionId;
      value.subject.leaseIdentity.sessionId = sessionId;
      value.subject.leaseIdentity.cloudAuthority.sessionId = sessionId;
    },
    value => {
      const treeSha = foreignSha("tree");
      value.subject.reviewedTreeSha = treeSha;
      value.subject.reviewedCommit.treeSha = treeSha;
      value.subject.leaseIdentity.integration.treeSha = treeSha;
      value.subject.malformedCommit.treeSha = treeSha;
    },
    value => {
      const headSha = foreignSha("head");
      value.subject.reviewedHeadSha = headSha;
      value.subject.reviewedCommit.sha = headSha;
      value.subject.pullRequest.headSha = headSha;
      value.subject.leaseIdentity.deliveryHeadSha = headSha;
      value.subject.leaseIdentity.integration.commitSha = headSha;
      value.subject.leaseIdentity.cloudAuthority.laneRevision = headSha;
      value.subject.leaseIdentity.cloudAuthority.integration.candidateRevision = headSha;
      value.subject.sourceCommitProviderActors.at(-1).revision = headSha;
      value.subject.checks[0].headSha = headSha;
    },
    value => {
      const fenceSha = foreignSha("fence");
      value.subject.leaseIdentity.fenceSha = fenceSha;
      value.subject.leaseIdentity.admissionContinuation.localFenceSha = fenceSha;
      value.subject.leaseIdentity.admissionContinuation.candidateRevision = fenceSha;
      resealAdmissionContinuation(value.subject.leaseIdentity);
      value.subject.sourceCommitProviderActors[0].revision = fenceSha;
    },
    value => {
      value.subject.leaseIdentity.admissionContinuation.candidateStateDigest =
        hash("foreign-resealed-continuation");
      resealAdmissionContinuation(value.subject.leaseIdentity);
    },
  ];
  for (const mutate of mutations) {
    const value = legacyAdmissionContinuationEvidenceFixture();
    mutate(value);
    value.subject.cloudAuthority = clone(value.subject.leaseIdentity.cloudAuthority);
    value.subject.leaseIdentityDigest = digestValue(value.subject.leaseIdentity);
    value.subject.checksDigest = digestValue(value.subject.checks);
    assert.equal(normalizeCanonicalSquashRecoveryDeliveryProfile(
      value.subject.leaseIdentity,
      { genericSelfHosted: true },
    ).profile, "legacy-admission-continuation");
    assert.throws(() => buildPlan(resealEvidence(value)), /legacy PR819 lineage/u);
  }
});
test("PR819 delivery profiles reject mixed flags, successor combinations, and receipt drift", () => {
  for (const [autoDelivery, runtimeRequired] of [[true, false], [false, true]]) {
    const lease = legacyAdmissionContinuationLeaseFixture();
    lease.autoDelivery = autoDelivery;
    lease.runtimeRequired = runtimeRequired;
    assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
      genericSelfHosted: true,
    }), /delivery profile/u);
  }

  const missingReceipt = legacyAdmissionContinuationLeaseFixture();
  delete missingReceipt.admissionContinuation;
  assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(missingReceipt, {
    genericSelfHosted: true,
  }), /delivery profile/u);

  const standardWithReceipt = clone(genericEvidenceFixture("evidence-document")
    .subject.leaseIdentity);
  standardWithReceipt.admissionContinuation = legacyAdmissionContinuationLeaseFixture()
    .admissionContinuation;
  assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(standardWithReceipt, {
    genericSelfHosted: true,
  }), /standard delivery profile continuation/u);

  const successor = legacyAdmissionContinuationLeaseFixture();
  successor.successorLineage = { activePublishSuccessorIntent: null };
  assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(successor, {
    genericSelfHosted: true,
  }), /delivery profile/u);
  assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(
    legacyAdmissionContinuationLeaseFixture(),
    { genericSelfHosted: false },
  ), /delivery profile/u);

  const receiptMutations = [
    value => { value.admissionContinuation.extra = true; },
    value => { value.admissionContinuation.claimId = hash("foreign-claim"); },
    value => { value.admissionContinuation.predecessorPlanReceiptDigest = hash("foreign-plan"); },
    value => { value.admissionContinuation.manifestDigest = hash("foreign-manifest"); },
    value => { value.admissionContinuation.localFenceSha = "0".repeat(40); },
    value => { value.admissionContinuation.candidateRevision = "1".repeat(40); },
    value => { value.admissionContinuation.preparedIntegrationReceiptDigest = hash("foreign-prepared"); },
    value => { value.admissionContinuation.peerLaneStateDigest = hash("foreign-peer-state"); },
    value => {
      value.admissionContinuation.peerOperationReceiptDigests[1] =
        value.admissionContinuation.peerOperationReceiptDigests[0];
    },
    value => { value.admissionContinuation.peerOperationReceiptDigests = []; },
    value => { value.admissionContinuation.mutationAuthorityReceiptDigest = hash("foreign-final"); },
    value => { value.admissionContinuation.continuedAt = "not-an-instant"; },
  ];
  for (const mutate of receiptMutations) {
    const lease = legacyAdmissionContinuationLeaseFixture();
    mutate(lease);
    resealAdmissionContinuation(lease);
    assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(lease, {
      genericSelfHosted: true,
    }), /admission continuation/u);
  }
  const unsealed = legacyAdmissionContinuationLeaseFixture();
  unsealed.admissionContinuation.candidateStateDigest = hash("unsealed-tamper");
  assert.throws(() => normalizeCanonicalSquashRecoveryDeliveryProfile(unsealed, {
    genericSelfHosted: true,
  }), /admission continuation/u);

  for (const mutate of [
    value => { value.subject.leaseIdentity.admission.declaredWriteSet.push("semantic:foreign"); },
    value => {
      value.subject.leaseIdentity.cloudAuthority.cloudDeclaredWriteScope
        .push("semantic:foreign");
      value.subject.cloudAuthority = clone(value.subject.leaseIdentity.cloudAuthority);
    },
  ]) {
    const evidence = legacyAdmissionContinuationEvidenceFixture();
    mutate(evidence);
    evidence.subject.leaseIdentityDigest = digestValue(evidence.subject.leaseIdentity);
    assert.throws(() => buildPlan(resealEvidence(evidence)),
      /scope authority join|invalid/u);
  }
});
test("PR819 fence and no-coauthor provider framing are exact", () => {
  const lease = legacyAdmissionContinuationLeaseFixture({
    candidateTreeSha: "036ad30104cc544da2df2e0c8253707f1ee6adf8",
  });
  const reviewedHeadSha = "91fbc80a03c82b5ee49f0f89a8d1fba1af21ac48";
  assert.equal(assertCanonicalSquashRecoveryLegacyContinuationTopology({
    lease,
    reviewedHeadSha,
    fenceTreeSha: lease.admissionContinuation.candidateTreeSha,
    isAncestorRevision: (ancestor, descendant) =>
      ancestor === lease.fenceSha && descendant === reviewedHeadSha,
  }), true);
  assert.throws(() => assertCanonicalSquashRecoveryLegacyContinuationTopology({
    lease,
    reviewedHeadSha,
    fenceTreeSha: "0".repeat(40),
    isAncestorRevision: () => true,
  }), /Legacy admission continuation/u);
  assert.throws(() => assertCanonicalSquashRecoveryLegacyContinuationTopology({
    lease,
    reviewedHeadSha,
    fenceTreeSha: lease.admissionContinuation.candidateTreeSha,
    isAncestorRevision: () => false,
  }), /Legacy admission continuation/u);

  const headline = "fix(successor-rollover-pr-marker-replan): seal refresh";
  const sourceHistorySubjects = [
    "chore(coordination): claim successor-rollover-pr-marker-replan lease 5",
    headline,
  ];
  const expectedBody = [
    "Integrate the declared successor-rollover-pr-marker-replan change through its protected managed task lane so downstream policy can attribute the change to its writer lease.",
    "",
    "Agentic-Task: successor-rollover-pr-marker-replan",
    "Agentic-Scope: successor-rollover-pr-marker-replan",
    "Agentic-Lease-Epoch: 1",
    "Agentic-Mechanism: Agentic Canvas OS protected integration",
  ].join("\n");
  const legacyMessage = [
    headline,
    "",
    `* ${sourceHistorySubjects[0]}`,
    "",
    `* ${sourceHistorySubjects[1]}`,
    "",
    expectedBody,
  ].join("\n");
  const pullRequest = {
    mergedBy: "huijoohwee",
    autoMergeRequest: {
      mergeMethod: "SQUASH",
      commitHeadline: headline,
      commitBody: null,
      enabledBy: { login: "huijoohwee", isBot: false },
    },
  };
  const sourceCommitProviderActors = [
    {
      revision: "84ee696bc4eefd74979705e82812fb1a01b9e340",
      authorLogin: "huijoohwee",
      committerLogin: "huijoohwee",
    },
    {
      revision: reviewedHeadSha,
      authorLogin: "huijoohwee",
      committerLogin: "huijoohwee",
    },
  ];
  const sourceCommitRevisions = sourceCommitProviderActors
    .map(actor => actor.revision);
  const messageInput = {
    profile: "legacy-admission-continuation",
    message: legacyMessage,
    headline,
    expectedBody,
    sourceHistorySubjects,
    sourceCommitRevisions,
    attributionTrailers: [],
    pullRequest,
    sourceCommitProviderActors,
  };
  assert.deepEqual(assertCanonicalSquashRecoveryMalformedProviderMessage(messageInput),
    sourceHistorySubjects);

  const legacyMessageFor = bullets => [
    headline,
    "",
    ...bullets.flatMap((subject, index) => index === 0
      ? [`* ${subject}`]
      : ["", `* ${subject}`]),
    "",
    expectedBody,
  ].join("\n");
  const invalidMessages = [
    legacyMessageFor([headline]),
    legacyMessageFor([...sourceHistorySubjects].reverse()),
    `${legacyMessage}\n\n---------`,
    `${legacyMessage}\n\nCo-authored-by: huijoohwee <8945812+huijoohwee@users.noreply.github.com>`,
    legacyMessage.replace("declared successor", "foreign successor"),
  ];
  for (const message of invalidMessages) {
    assert.throws(() => assertCanonicalSquashRecoveryMalformedProviderMessage({
      ...messageInput,
      message,
    }), /provider|framing|message/u);
  }
  const actorDrift = clone(sourceCommitProviderActors);
  actorDrift[0].committerLogin = "foreign";
  assert.throws(() => assertCanonicalSquashRecoveryMalformedProviderMessage({
    ...messageInput,
    sourceCommitProviderActors: actorDrift,
  }), /provider|actor/u);
  assert.throws(() => assertCanonicalSquashRecoveryMalformedProviderMessage({
    ...messageInput,
    sourceCommitRevisions: [...sourceCommitRevisions].reverse(),
  }), /provider|actor/u);
  assert.throws(() => assertCanonicalSquashRecoveryMalformedProviderMessage({
    ...messageInput,
    pullRequest: {
      ...pullRequest,
      autoMergeRequest: { ...pullRequest.autoMergeRequest, commitBody: expectedBody },
    },
  }), /provider|null-body|squash/u);

  const attributionTrailers = [
    "Co-authored-by: huijoohwee <8945812+huijoohwee@users.noreply.github.com>",
  ];
  const standardMessage = `${legacyMessage}\n\n---------\n\n${attributionTrailers[0]}`;
  assert.deepEqual(assertCanonicalSquashRecoveryMalformedProviderMessage({
    ...messageInput,
    profile: "standard-auto-delivery",
    message: standardMessage,
    attributionTrailers,
  }), sourceHistorySubjects);
});
test("generic recovery variants reject additions, evidence aliasing, and profile drift", () => {
  const mutations = [
    value => {
      value.subject.changedEntries[0].status = "A";
      value.subject.changedEntries[0].oldMode = "000000";
      value.subject.changedEntries[0].oldBlob = "1".repeat(40);
    },
    value => { value.recovery.changedEntries[1].newBlob = "f".repeat(40); },
    value => { value.subject.checks[0].workflowPath = ".github/workflows/release.yml"; },
    value => { value.recovery.genericRecoveryVariant = "foreign"; },
    value => { value.controller.revision = "0".repeat(40); },
  ];
  for (const mutate of mutations) {
    const value = genericEvidenceFixture("self-hosted-controller-update");
    mutate(value);
    assert.throws(() => buildPlan(resealEvidence(value)), /invalid/u);
  }
  const evidence = genericEvidenceFixture("evidence-document");
  evidence.recovery.changedEntries[0].status = "M";
  evidence.recovery.changedEntries[0].oldMode = "100644";
  evidence.recovery.changedEntries[0].oldBlob = "1".repeat(40);
  assert.throws(() => buildPlan(resealEvidence(evidence)), /invalid/u);
  for (const mutate of [
    value => { value.subject.protectedRefresh.reviewedParentShas[1] = "d".repeat(40); },
    value => { value.subject.protectedRefresh.authoredCommit.treeSha = "e".repeat(40); },
    value => { value.subject.protectedRefresh.changedEntries[0].newBlob = "f".repeat(40); },
  ]) {
    const refreshed = lineagedGenericEvidenceFixture();
    mutate(refreshed);
    refreshed.subject.leaseIdentityDigest = digestValue(refreshed.subject.leaseIdentity);
    assert.throws(() => buildPlan(resealEvidence(refreshed)), /invalid/u);
  }
  for (const mutate of [
    value => {
      value.subject.leaseIdentity.successorLineage
        .activeOwnedDirtRecovery.sourceClaimId = hash("foreign-source");
    },
    value => {
      value.subject.leaseIdentity.successorLineage
        .activePublishTaskAuthoritySuccessor.targetFenceSha = "0".repeat(40);
    },
    value => {
      value.subject.historicalLeaseEpoch = value.subject.cloudAuthority.leaseEpoch;
    },
    value => { value.subject.protectedRefresh.authoredParentSha = "9".repeat(40); },
    value => { value.subject.leaseIdentity.successorLineage = null; },
    value => { value.subject.predecessorAuthority.predecessorClaimId = hash("foreign-predecessor"); },
  ]) {
    const lineaged = lineagedGenericEvidenceFixture();
    mutate(lineaged);
    lineaged.subject.leaseIdentityDigest = digestValue(lineaged.subject.leaseIdentity);
    assert.throws(() => buildPlan(resealEvidence(lineaged)), /invalid/u);
  }
  const staleSimpleEpoch = genericEvidenceFixture("evidence-document");
  staleSimpleEpoch.subject.historicalLeaseEpoch -= 1;
  assert.throws(() => buildPlan(resealEvidence(staleSimpleEpoch)),
    /historical attribution epoch/u);
  const staleLineageEpoch = lineagedGenericEvidenceFixture();
  staleLineageEpoch.subject.historicalLeaseEpoch = 1;
  assert.throws(() => buildPlan(resealEvidence(staleLineageEpoch)),
    /historical attribution epoch|predecessor authority join/u);

  for (const mutate of [
    value => { value.activeOwnedDirtRecovery.snapshotRef += "-foreign"; },
    value => { value.activeOwnedDirtRecovery.recoveredTransitionCounter = 1; },
    value => { value.activeOwnedDirtRecovery.recoveredAt = "not-an-instant"; },
    value => { value.activeOwnedDirtRecovery.extra = true; },
    value => { value.activeOwnedDirtCurrentBaseReanchor.sourceBaseSha = "invalid"; },
    value => { value.activePublishTaskAuthoritySuccessor.boundAt = "not-an-instant"; },
  ]) {
    const lineaged = lineagedGenericEvidenceFixture();
    mutate(lineaged.subject.leaseIdentity.successorLineage);
    lineaged.subject.leaseIdentityDigest = digestValue(lineaged.subject.leaseIdentity);
    assert.throws(() => buildPlan(resealEvidence(lineaged)), /invalid/u);
  }

  for (const mutate of [
    value => { value.admission.declaredWriteSet.push("semantic:foreign"); },
    value => { value.admission.semanticScope = "foreign"; },
    value => { value.cloudAuthority.canonicalBaseSha = "f".repeat(40); },
    value => { value.cloudAuthority.targetRepository = "foreign/repository"; },
  ]) {
    const generic = genericEvidenceFixture("evidence-document");
    mutate(generic.subject.leaseIdentity);
    generic.subject.cloudAuthority = clone(generic.subject.leaseIdentity.cloudAuthority);
    generic.subject.leaseIdentityDigest = digestValue(generic.subject.leaseIdentity);
    assert.throws(() => buildPlan(resealEvidence(generic)), /invalid/u);
  }
});
test("contract rejects identity, topology, run, pin, and task projection drift", () => {
  const mutations = [
    value => { value.subject.taskAuthority.authoritySubjectId = "urn:foreign"; },
    value => { value.subject.taskAuthority.generation += 1; },
    value => { value.subject.cloudAuthority.deviceId = "foreign-device"; },
    value => { value.subject.pullRequest.headSha = "0".repeat(40); },
    value => { value.subject.remoteBranch = "2".repeat(40); },
    value => { value.subject.pinTransition.newRevision = "1".repeat(40); },
    value => { value.recovery.checks[0].event = "push"; },
    value => { value.recovery.terminal.remoteBranch = "absent"; },
    value => { value.recovery.changedEntries[0].newMode = "120000"; },
  ];
  for (const mutate of mutations) {
    const value = clone(liveEvidence);
    mutate(value);
    assert.throws(() => buildPlan(resealEvidence(value)), /invalid/u);
  }
  const hybrid = clone(liveEvidence);
  hybrid.controller.targetRepository = hybrid.controller.repository;
  hybrid.subject.repository = hybrid.controller.repository;
  hybrid.subject.leaseIdentity.cloudAuthority.targetRepository = hybrid.controller.repository;
  hybrid.subject.cloudAuthority.targetRepository = hybrid.controller.repository;
  hybrid.subject.leaseIdentity.successorLineage = null;
  hybrid.subject.leaseIdentityDigest = digestValue(hybrid.subject.leaseIdentity);
  assert.throws(() => buildPlan(resealEvidence(hybrid)),
    /subject repository classification/u);
});
test("controller seals both task proofs, typed terminal evidence, and stable replay receipt", async () => {
  const adapter = fakeAdapter();
  const controller = createCanonicalSquashAttributionRecoveryTerminalizationController({
    adapter,
  });
  const plan = await controller.plan();
  const receipt = await controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  assert.deepEqual(adapter.effects, ["cloud", "completion"]);
  assert.equal(receipt.cloud.terminalStateDigest,
    adapter.journal.state.receipts["cloud-retired"].terminalCloudDigest);
  assert.equal(receipt.cloud.taskBindingDigest,
    plan.evidence.subject.taskAuthorityBindingDigest);
  assert.equal(receipt.completion.mainSha,
    adapter.journal.state.receipts["completion-projected"].mainSha);
  assert.equal(normalizeReceipt(receipt).receiptDigest, receipt.receiptDigest);
  const replay = await controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  assert.equal(replay.receiptDigest, receipt.receiptDigest);
  assert.equal(adapter.terminalVerifications, 2);
});
test("verified and complete persist atomically and replay re-verifies after a crash", async () => {
  const adapter = fakeAdapter({ failAtomicCompleteOnce: true });
  const controller = createCanonicalSquashAttributionRecoveryTerminalizationController({
    adapter,
  });
  const plan = await controller.plan();
  await assert.rejects(() => controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  }), /simulated crash/u);
  assert.equal(adapter.journal.state.phase, "completion-projected");
  const receipt = await controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  });
  assert.equal(receipt.status, "completion-ready");
  assert.equal(adapter.terminalVerifications, 2);
});
test("effect receipts must retain the exact plan-bound task identity", async () => {
  const adapter = fakeAdapter({ wrongTaskIdentity: true });
  const controller = createCanonicalSquashAttributionRecoveryTerminalizationController({
    adapter,
  });
  const plan = await controller.plan();
  await assert.rejects(() => controller.run({
    planDigest: plan.planDigest,
    authorization: plan.exactAuthorization,
  }), /task authorization|task authorization plan join|invalid/u);
  assert.equal(adapter.journal.state.phase, "cloud-retirement-intent");
});
test("intent cannot authorize a different task operation", () => {
  const plan = buildPlan(liveEvidence);
  const authorized = startJournal(createJournal(plan), plan.exactAuthorization);
  const verified = advanceJournal(authorized, "evidence-verified", {
    operationKey: operationKey(plan, "evidence-verified"),
    evidenceVerificationDigest: hash("evidence-verification"),
  });
  assert.throws(() => advanceJournal(verified, "cloud-retirement-intent", {
    operationKey: operationKey(plan, "cloud-retirement-intent"),
    priorJournalDigest: verified.journalDigest,
    taskAuthorityBindingDigest: plan.evidence.subject.taskAuthorityBindingDigest,
    taskAuthorizationOperation: "foreign-operation",
  }), /invalid/u);
});
test("actual-shaped full task binding is accepted only for the exact completing projection", () => {
  const plan = buildPlan(liveEvidence);
  const subject = plan.evidence.subject;
  const lease = leaseFromSubject(subject, {
    status: "completing",
    mainSha: plan.evidence.canonical.protectedMainSha,
  });
  const journal = { state: { phase: "completion-intent", receipts: {} } };
  assert.equal(assertExactCanonicalSquashRecoveryCompletingReplay({
    lease, plan, journal,
  }), lease);
  const drifted = clone(lease);
  drifted.completion.mainSha = "0".repeat(40);
  assert.throws(() => assertExactCanonicalSquashRecoveryCompletingReplay({
    lease: drifted, plan, journal,
  }), /sealed projection/u);
});
test("completion topology accepts only a protected-main recovery descendant", () => {
  const [base, recovery, target, current, side] = ["1", "2", "3", "4", "5"]
    .map(value => value.repeat(40));
  const ancestry = new Set([
    `${base}:${target}`, `${target}:${current}`, `${recovery}:${target}`,
    `${base}:${side}`, `${recovery}:${side}`,
  ]);
  const input = {
    baseSha: base,
    targetSha: target,
    protectedMainSha: current,
    recoverySha: recovery,
    recoveryBlobMatches: true,
    isAncestorRevision: (left, right) => left === right || ancestry.has(`${left}:${right}`),
  };
  assert.equal(assertCanonicalSquashRecoveryCompletionTopology(input), true);
  assert.throws(() => assertCanonicalSquashRecoveryCompletionTopology({
    ...input,
    targetSha: side,
  }), /protected recovery descendant/u);
  assert.throws(() => assertCanonicalSquashRecoveryCompletionTopology({
    ...input,
    recoveryBlobMatches: false,
  }), /protected recovery descendant/u);
});

test("newest matching Integration run must itself be completed successfully", () => {
  const sha = "6".repeat(40);
  const exact = {
    id: 10,
    name: "Integration",
    event: "pull_request",
    head_branch: "agent/device/scope",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  };
  assert.equal(selectNewestExactIntegrationRun([exact], {
    sha,
    event: "pull_request",
    branch: "agent/device/scope",
  }).id, 10);
  for (const newest of [
    { ...exact, id: 11, status: "in_progress", conclusion: null },
    { ...exact, id: 12, conclusion: "failure" },
  ]) {
    assert.throws(() => selectNewestExactIntegrationRun([exact, newest], {
      sha,
      event: "pull_request",
      branch: "agent/device/scope",
    }), /not terminally successful/u);
  }
  assert.throws(() => selectNewestExactIntegrationRun([exact], {
    sha, event: "pull_request", branch: "agent/device/scope", expectedRunId: 9,
  }), /not the newest exact run/u);
});
test("self-hosted CI selection binds workflow path instead of a dynamic run title", () => {
  const sha = "7".repeat(40);
  const exact = {
    id: 33340720688,
    name: "fix(claim-only-waiting-bridge): reconcile live topology",
    path: ".github/workflows/ci.yml",
    event: "pull_request",
    head_branch: "agent/device/self-hosted",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  };
  assert.equal(selectNewestExactIntegrationRun([exact], {
    sha,
    event: "pull_request",
    branch: "agent/device/self-hosted",
    profile: "self-hosted-ci",
  }).id, 33340720688);
  for (const drift of [
    { ...exact, path: ".github/workflows/release.yml" },
    { ...exact, path: undefined, name: "CI" },
  ]) {
    assert.throws(() => selectNewestExactIntegrationRun([drift], {
      sha,
      event: "pull_request",
      branch: "agent/device/self-hosted",
      profile: "self-hosted-ci",
    }), /not terminally successful/u);
  }
  assert.throws(() => selectNewestExactIntegrationRun([exact], {
    sha,
    event: "pull_request",
    branch: "agent/device/self-hosted",
    profile: "foreign",
  }), /selection input is invalid/u);
});
test("self-hosted CI job inventory selects one materialized job and only terminal provider projections", () => {
  const repository = "huijoohwee/agentic-canvas-os";
  const runId = 33345692525;
  const materializedJob = {
    databaseId: 99351243179,
    name: "collaboration-integration",
    status: "completed",
    conclusion: "success",
    url: `https://github.com/${repository}/actions/runs/${runId}/job/99351243179`,
    steps: [
      { name: "Require exact CI authorization", status: "completed", conclusion: "success" },
      { name: "Set up job", status: "completed", conclusion: "success" },
      { name: "Run npm run collab:test", status: "completed", conclusion: "success" },
    ],
  };
  const providerProjection = {
    databaseId: 99351687813,
    name: "collaboration-integration",
    status: "completed",
    conclusion: "success",
    url: `https://github.com/${repository}/runs/99351687813`,
    steps: [],
  };
  const unrelated = {
    databaseId: 99351243180,
    name: "policy-runtime-readiness",
    status: "completed",
    conclusion: "success",
    url: `https://github.com/${repository}/actions/runs/${runId}/job/99351243180`,
    steps: [],
  };
  const exact = classifySelfHostedSuccessfulJobInventory({
    jobs: [providerProjection, unrelated, materializedJob], repository, runId,
  });
  assert.equal(exact.materializedJobId, materializedJob.databaseId);
  assert.deepEqual(exact.providerProjectionJobIds, [providerProjection.databaseId]);

  const secondMaterialized = {
    ...materializedJob,
    databaseId: 99351243181,
    url: `https://github.com/${repository}/actions/runs/${runId}/job/99351243181`,
  };
  const invalidInventories = [
    [providerProjection],
    [materializedJob, secondMaterialized],
    [materializedJob, { ...providerProjection, status: "in_progress", conclusion: null }],
    [materializedJob, { ...providerProjection, conclusion: "failure" }],
    [materializedJob, { ...providerProjection, steps: [{
      name: "Run npm run collab:test", status: "completed", conclusion: "success",
    }] }],
    [materializedJob, { ...providerProjection,
      url: `https://github.com/foreign/repository/runs/${providerProjection.databaseId}` }],
    [materializedJob, { ...providerProjection,
      url: `https://github.com/${repository}/actions/runs/${runId}/job/${providerProjection.databaseId}` }],
    [materializedJob, { ...providerProjection, databaseId: materializedJob.databaseId,
      url: `https://github.com/${repository}/runs/${materializedJob.databaseId}` }],
    [{ ...materializedJob,
      url: `https://github.com/${repository}/actions/runs/${runId + 1}/job/${materializedJob.databaseId}` }],
    [{ ...materializedJob, steps: materializedJob.steps.filter(step =>
      step.name !== "Require exact CI authorization") }],
    [{ ...materializedJob, steps: materializedJob.steps.map(step =>
      step.name === "Require exact CI authorization" ? { ...step, conclusion: "failure" } : step) }],
    [{ ...materializedJob, steps: materializedJob.steps.filter(step =>
      step.name !== "Run npm run collab:test") }],
    [{ ...materializedJob, steps: [...materializedJob.steps,
      { name: "Run npm run collab:test", status: "completed", conclusion: "success" }] }],
    [{ ...materializedJob, steps: [...materializedJob.steps].reverse() }],
  ];
  for (const jobs of invalidInventories) {
    assert.throws(() => classifySelfHostedSuccessfulJobInventory({
      jobs, repository, runId,
    }), /Self-hosted CI/u);
  }
  assert.throws(() => classifySelfHostedSuccessfulJobInventory({
    jobs: [materializedJob], repository: "foreign", runId,
  }), /repository is invalid/u);
  assert.throws(() => classifySelfHostedSuccessfulJobInventory({
    jobs: [materializedJob], repository, runId: 0,
  }), /inventory input is invalid/u);
});
test("self-hosted controller replay requires the exact sealed executable revision and tree", () => {
  const plan = buildPlan(genericEvidenceFixture("self-hosted-controller-update"));
  const current = "9".repeat(40);
  assert.equal(assertCanonicalSquashRecoveryControllerProjection({
    plan,
    currentController: clone(plan.evidence.controller),
  }), true);
  const descendant = { ...plan.evidence.controller, revision: current, tree: "8".repeat(40) };
  assert.throws(() => assertCanonicalSquashRecoveryControllerProjection({
    plan,
    currentController: descendant,
  }), /controller drifted/u);
  const first = clone(plan.evidence);
  const second = clone(plan.evidence);
  first.controller = clone(descendant);
  second.controller = clone(descendant);
  first.observedAt = "2026-08-30T13:01:00.000Z";
  second.observedAt = "2026-08-30T13:02:00.000Z";
  first.canonical.protectedMainSha = current;
  second.canonical.protectedMainSha = current;
  first.evidenceDigest = hash("first-controller-descendant-observation");
  second.evidenceDigest = hash("second-controller-descendant-observation");
  assert.throws(() => assertCanonicalSquashRecoveryPreRetirementProjection({
    sealedEvidence: plan.evidence,
    firstEvidence: first,
    secondEvidence: second,
  }), /preservation projection drifted/u);
});

test("begin-completion response loss resumes only attached review or detached sealed main", () => {
  const subject = liveEvidence.subject;
  const completionMainSha = liveEvidence.canonical.protectedMainSha;
  const common = {
    worktreeState: "present",
    statusPorcelain: "",
    subjectBranch: subject.branch,
    reviewedHeadSha: subject.reviewedHeadSha,
    completionMainSha,
  };
  assert.equal(classifyCanonicalSquashRecoveryCompletingProjection({
    ...common,
    currentBranch: subject.branch,
    headSha: subject.reviewedHeadSha,
  }), "attached-reviewed");
  assert.equal(classifyCanonicalSquashRecoveryCompletingProjection({
    ...common,
    currentBranch: "",
    headSha: completionMainSha,
  }), "detached-main");
  for (const drift of [
    { currentBranch: subject.branch, headSha: completionMainSha },
    { currentBranch: "foreign", headSha: subject.reviewedHeadSha },
    { currentBranch: "", headSha: "0".repeat(40) },
    { currentBranch: "", headSha: completionMainSha, statusPorcelain: " M file" },
    { currentBranch: "", headSha: completionMainSha, worktreeState: "absent" },
  ]) {
    assert.throws(() => classifyCanonicalSquashRecoveryCompletingProjection({
      ...common,
      ...drift,
    }), /Completing replay worktree/u);
  }
});

test("completion-ready Q survives ordinary cleanup at protected descendant R", () => {
  const [q, r, current] = ["7", "8", "9"].map(value => value.repeat(40));
  const ancestry = new Set([`${q}:${r}`, `${r}:${current}`, `${q}:${current}`]);
  const isAncestorRevision = (left, right) => left === right
    || ancestry.has(`${left}:${right}`);
  assert.equal(assertCanonicalSquashRecoveryTerminalMainTopology({
    status: "completing",
    projectedMainSha: q,
    leaseMainSha: q,
    protectedMainSha: current,
    isAncestorRevision,
  }), true);
  assert.equal(assertCanonicalSquashRecoveryTerminalMainTopology({
    status: "completed",
    projectedMainSha: q,
    leaseMainSha: r,
    protectedMainSha: current,
    isAncestorRevision,
  }), true);
  assert.throws(() => assertCanonicalSquashRecoveryTerminalMainTopology({
    status: "completed",
    projectedMainSha: q,
    leaseMainSha: "a".repeat(40),
    protectedMainSha: current,
    isAncestorRevision,
  }), /Terminal completion main topology/u);
});

test("completed descendant replay retains every immutable original-lease identity", () => {
  const subject = liveEvidence.subject;
  const lease = leaseFromSubject(subject, {
    status: "completed",
    mainSha: "b".repeat(40),
  });
  assert.equal(assertExactCanonicalSquashRecoveryTerminalLeaseIdentity({
    lease,
    subject,
  }), lease);
  for (const mutate of [
    value => { value.cloudAuthority.claimDigest = hash("foreign-claim"); },
    value => { value.integration.treeSha = "c".repeat(40); },
    value => { value.taskAuthority.generation += 1; },
    value => { value.deliveryHeadSha = "d".repeat(40); },
    value => { value.device = "foreign-device"; },
    value => { value.epoch += 1; },
    value => { value.fenceSha = "e".repeat(40); },
    value => { value.acquiredAt = "2026-08-30T12:22:00.000Z"; },
    value => { value.admission.manifestDigest = hash("foreign-manifest"); },
    value => { value.integration.manifestDigest = hash("foreign-integration-manifest"); },
    value => { value.integration.stagedDiffDigest = hash("foreign-staged-diff"); },
    value => { value.integration.recordedAt = "2026-08-30T12:22:00.000Z"; },
    value => { value.schema = "agentic-writer-lease/v3"; },
    value => { value.activeOwnedDirtRecovery = { status: "foreign" }; },
  ]) {
    const drifted = clone(lease);
    mutate(drifted);
    assert.throws(() => assertExactCanonicalSquashRecoveryTerminalLeaseIdentity({
      lease: drifted,
      subject,
    }), /Terminal local lease|Task authority binding|Canonical squash recovery/u);
  }
});
test("completed recovery head projection keeps generic delivery and legacy review shapes disjoint", () => {
  const genericRecovery = genericEvidenceFixture("evidence-document").recovery;
  const genericLease = {
    reviewHeadSha: null,
    deliveryHeadSha: genericRecovery.sourceHeadSha,
    integration: { paths: [genericRecovery.evidencePath] },
  };
  assert.equal(assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
    lease: genericLease,
    recovery: genericRecovery,
    genericSelfHosted: true,
  }), true);
  for (const mutate of [
    value => { value.reviewHeadSha = genericRecovery.sourceHeadSha; },
    value => { value.deliveryHeadSha = "0".repeat(40); },
  ]) {
    const drifted = clone(genericLease);
    mutate(drifted);
    assert.throws(() => assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
      lease: drifted,
      recovery: genericRecovery,
      genericSelfHosted: true,
    }), /exact reviewed head/u);
  }
  const genericReviewReadyLease = {
    reviewHeadSha: genericRecovery.sourceHeadSha,
    deliveryHeadSha: null,
    integration: null,
  };
  assert.equal(assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
    lease: genericReviewReadyLease,
    recovery: genericRecovery,
    genericSelfHosted: true,
  }), true);
  for (const mutate of [
    value => { value.deliveryHeadSha = genericRecovery.sourceHeadSha; },
    value => { value.integration = { paths: [genericRecovery.evidencePath] }; },
  ]) {
    const mixed = clone(genericReviewReadyLease);
    mutate(mixed);
    assert.throws(() => assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
      lease: mixed,
      recovery: genericRecovery,
      genericSelfHosted: true,
    }), /exact reviewed head/u);
  }
  assert.equal(assertCanonicalSquashRecoveryCompletedRecoveryHeadProjection({
    lease: { reviewHeadSha: liveEvidence.recovery.sourceHeadSha },
    recovery: liveEvidence.recovery,
    genericSelfHosted: false,
  }), true);
});
test("generic completed replay preserves protected-refresh and successor lineage", () => {
  const subject = buildPlan(lineagedGenericEvidenceFixture()).evidence.subject;
  const lease = leaseFromSubject(subject, {
    status: "completed",
    mainSha: "b".repeat(40),
  });
  assert.equal(assertExactCanonicalSquashRecoveryTerminalLeaseIdentity({ lease, subject }),
    lease);
  const drifted = clone(lease);
  drifted.activePublishTaskAuthoritySuccessor.targetClaimId = hash("foreign-target");
  assert.throws(() => assertExactCanonicalSquashRecoveryTerminalLeaseIdentity({
    lease: drifted,
    subject,
  }), /Terminal local lease|successor\/reanchor lineage/u);
});

test("completed recovery task binding rejects epoch or device drift before terminal adoption", () => {
  const lease = { status: "completed", branch: "agent/device/recovery", scope: "recovery",
    device: "device", epoch: 2, baseSha: "1".repeat(40),
    cloudAuthority: { claimId: hash("claim") } };
  lease.taskAuthority = createTaskAuthorityBinding({
    capability: createTaskAuthorityCapability({ issuedAt: "2026-08-30T00:00:00.000Z" }),
    lease, boundAt: "2026-08-30T00:00:00.000Z",
  });
  assert.deepEqual(assertExactCanonicalSquashRecoveryCompletedTaskAuthority(lease),
    lease.taskAuthority);
  for (const mutate of [value => { value.epoch += 1; },
    value => { value.device = "foreign"; }]) {
    const drifted = clone(lease); mutate(drifted);
    assert.throws(() => assertExactCanonicalSquashRecoveryCompletedTaskAuthority(drifted),
      /does not bind/u);
  }
});

test("pre-retirement double-read seals every non-time preservation subject", () => {
  const first = clone(liveEvidence);
  const second = clone(liveEvidence);
  first.observedAt = "2026-08-30T13:01:00.000Z";
  second.observedAt = "2026-08-30T13:02:00.000Z";
  first.canonical.protectedMainSha = "a".repeat(40);
  second.canonical.protectedMainSha = "b".repeat(40);
  first.evidenceDigest = hash("fresh-first");
  second.evidenceDigest = hash("fresh-second");
  assert.equal(assertCanonicalSquashRecoveryPreRetirementProjection({
    sealedEvidence: liveEvidence,
    firstEvidence: first,
    secondEvidence: second,
  }), true);

  for (const mutate of [
    value => { value.subject.reviewedTreeSha = "c".repeat(40); },
    value => { value.subject.remoteBranch = "d".repeat(40); },
    value => { value.subject.pullRequest.autoMergeDigest = hash("foreign-auto-merge"); },
    value => { value.subject.checks[0].databaseId += 1; },
    value => { value.recovery.terminal.cleanupReceiptDigest = hash("foreign-cleanup"); },
    value => { value.recovery.checks[0].databaseId += 1; },
    value => { value.controller.revision = "e".repeat(40); },
    value => { value.preservation.authoredTree = "changed"; },
  ]) {
    const drifted = clone(second);
    mutate(drifted);
    assert.throws(() => assertCanonicalSquashRecoveryPreRetirementProjection({
      sealedEvidence: liveEvidence,
      firstEvidence: first,
      secondEvidence: drifted,
    }), /Pre-retirement preservation projection drifted/u);
  }
});

test("private journal lock spans an awaited action and replaces a dead owner only", async t => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "canonical-recovery-lock-"));
  const canonical = path.join(root, "canonical");
  const subject = path.join(root, "subject");
  const controllerRoot = path.join(root, "controller");
  const privateRoot = path.join(root, "private");
  for (const directory of [canonical, subject, controllerRoot, privateRoot]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  execFileSync("git", ["init", canonical], { stdio: "ignore" });
  const statePath = path.join(privateRoot, "state.json");
  const adapter = createCanonicalSquashAttributionRecoveryTerminalizationRepositoryAdapter({
    repository: canonical,
    subjectWorktree: subject,
    targetRepository: "owner/repository",
    subjectPullRequest: 1,
    recoveryPullRequest: 2,
    recoveryEvidencePath: "docs/recovery.md",
    recoveryCleanupReceiptDigest: hash("cleanup"),
    controllerRoot,
    statePath,
  }, { leaseStore: {} });
  let release;
  const held = adapter.withOperationLock({}, async () =>
    new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => adapter.withOperationLock({}, async () => null),
    /owns the journal lock/u);
  release();
  await held;
  await t.test("dead owner is recovered by stable double-read", async () => {
    writeFileSync(`${statePath}.lock`,
      JSON.stringify({ pid: 99999999, startedAt: "absent" }) + "\n", { mode: 0o600 });
    chmodSync(`${statePath}.lock`, 0o600);
    assert.equal(await adapter.withOperationLock({}, async () => "recovered"), "recovered");
  });
});
