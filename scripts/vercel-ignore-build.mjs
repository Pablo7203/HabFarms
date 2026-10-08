const stagingProjectId = "prj_kVFfydcwPQaoBamCSKtJy5Q0STXT";
const productionProjectId = "prj_cRdCqG1IKn6dgYQL0B0kUgK9j8EC";
const approvedProductionReleaseMessage = "release: deploy seo hardening 2026-09-26";
const approvedManualReleaseBranch = "release/admin-egg-sale-correction";
const approvedManualReleaseMessage = "release: deploy admin egg sale correction 2026-10-08";

if (process.env.VERCEL_PROJECT_ID === stagingProjectId) {
  console.log("HabFarms staging project: build enabled.");
  process.exit(1);
}

if (
  process.env.VERCEL_PROJECT_ID === productionProjectId &&
  ((process.env.VERCEL_GIT_COMMIT_REF === "main" &&
    process.env.VERCEL_GIT_COMMIT_MESSAGE === approvedProductionReleaseMessage) ||
    (process.env.VERCEL_GIT_COMMIT_REF === approvedManualReleaseBranch &&
      process.env.VERCEL_GIT_COMMIT_MESSAGE === approvedManualReleaseMessage))
) {
  console.log("Approved one-time HabFarms production release: build enabled.");
  process.exit(1);
}

console.log("Non-staging Vercel project: automatic build blocked. Use an explicitly approved manual deployment.");
process.exit(0);
