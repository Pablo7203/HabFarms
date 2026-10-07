const stagingProjectId = "prj_kVFfydcwPQaoBamCSKtJy5Q0STXT";
const productionProjectId = "prj_cRdCqG1IKn6dgYQL0B0kUgK9j8EC";
const approvedProductionReleaseMessage = "release: deploy seo hardening 2026-09-26";

if (process.env.VERCEL_PROJECT_ID === stagingProjectId) {
  console.log("HabFarms staging project: build enabled.");
  process.exit(1);
}

if (
  process.env.VERCEL_PROJECT_ID === productionProjectId &&
  process.env.VERCEL_GIT_COMMIT_REF === "main" &&
  process.env.VERCEL_GIT_COMMIT_MESSAGE === approvedProductionReleaseMessage
) {
  console.log("Approved one-time HabFarms SEO production release: build enabled.");
  process.exit(1);
}

console.log("Non-staging Vercel project: automatic build blocked. Use an explicitly approved manual deployment.");
process.exit(0);
