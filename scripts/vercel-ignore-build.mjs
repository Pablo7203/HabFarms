const stagingProjectId = "prj_kVFfydcwPQaoBamCSKtJy5Q0STXT";
const productionProjectId = "prj_cRdCqG1IKn6dgYQL0B0kUgK9j8EC";
const approvedProductionReleaseMessages = new Set([
  "release: deploy seo hardening 2026-09-26",
  "release: deploy invitation acceptance fix",
]);

if (process.env.VERCEL_PROJECT_ID === stagingProjectId) {
  console.log("HabFarms staging project: build enabled.");
  process.exit(1);
}

if (
  process.env.VERCEL_PROJECT_ID === productionProjectId &&
  process.env.VERCEL_GIT_COMMIT_REF === "main" &&
  approvedProductionReleaseMessages.has(process.env.VERCEL_GIT_COMMIT_MESSAGE)
) {
  console.log("Approved one-time HabFarms production release: build enabled.");
  process.exit(1);
}

console.log("Non-staging Vercel project: automatic build blocked. Use an explicitly approved manual deployment.");
process.exit(0);
