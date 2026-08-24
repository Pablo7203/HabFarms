const stagingProjectId = "prj_kVFfydcwPQaoBamCSKtJy5Q0STXT";

if (process.env.VERCEL_PROJECT_ID === stagingProjectId) {
  console.log("HabFarms staging project: build enabled.");
  process.exit(1);
}

console.log("Non-staging Vercel project: automatic build blocked. Use an explicitly approved manual deployment.");
process.exit(0);
