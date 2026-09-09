import {
  reportProvisioningFailure,
  runProvisionReviewerCli,
} from "../src/reviewer/provision.mjs";

runProvisionReviewerCli().catch(() => {
  reportProvisioningFailure();
  process.exitCode = 1;
});
