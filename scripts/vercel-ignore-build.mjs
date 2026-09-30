const stagingProjectId = "prj_kVFfydcwPQaoBamCSKtJy5Q0STXT";
const productionProjectId = "prj_cRdCqG1IKn6dgYQL0B0kUgK9j8EC";
const approvedProductionReleaseMessages = new Set([
  "release: deploy HabFarms logo refresh 2026-09-27",
  "release: explain production feed ledger errors 2026-09-28",
  "release: deploy HabFarms PWA login start 2026-09-30",
]);

if (process.env.VERCEL_PROJECT_ID === stagingProjectId) {
  console.log("HabFarms staging project: build enabled.");
  process.exit(1);
}

if (
  process.env.VERCEL_PROJECT_ID === productionProjectId &&
  process.env.VERCEL_GIT_COMMIT_REF === "main" &&
  approvedProductionReleaseMessages.has(process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "")
) {
  console.log("Approved one-time HabFarms production release: build enabled.");
  process.exit(1);
}

console.log("Non-staging Vercel project: automatic build blocked. Use an explicitly approved manual deployment.");
process.exit(0);
