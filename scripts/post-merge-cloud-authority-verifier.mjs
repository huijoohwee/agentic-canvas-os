// Responsibility: route live delivery verification through exact post-merge convergence.
import { verifyCloudDeliveryAuthority } from "./cloud-collaboration-delivery-verifier.mjs";
import { createPostMergeCloudAuthorityController }
  from "./post-merge-cloud-authority-controller.mjs";
import {
  POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
  verifyIntegratedRetirementEvidence,
} from "./integrated-delivery-terminal-retirement.mjs";

export {
  POST_MERGE_CLOUD_AUTHORITY_VERIFICATION_SCHEMA,
  verifyIntegratedRetirementEvidence,
};

export function createPostMergeCloudAuthorityVerifier({
  environment = process.env,
  ghText,
  readLedger,
  readPullRequest,
  retireClaim,
  validate,
  verifyLive = verifyCloudDeliveryAuthority,
} = {}) {
  return createPostMergeCloudAuthorityController({
    environment,
    ghText,
    readLedger,
    readPullRequest,
    retireClaim,
    validate,
    verifyLive,
  });
}
