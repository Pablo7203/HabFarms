export type BirdPurpose = "layer_pullet" | "broiler";

export function elapsedAge(arrivalDate: string, today: string) {
  const elapsedDays = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${arrivalDate}T00:00:00Z`)) / 86_400_000));
  return { elapsedDays, weeks: Math.floor(elapsedDays / 7), days: elapsedDays % 7 };
}

export function lifecycleMilestones(purpose: BirdPurpose) {
  if (purpose === "broiler") return [
    { key: "starter-review", day: 14, title: "Review broiler starter-to-grower feed phase", detail: "Cobb 700 guidance changes phase around day 15; confirm the breed-specific feeding guide and bird condition." },
    { key: "grower-review", day: 27, title: "Review broiler grower-to-finisher feed phase", detail: "Cobb 700 guidance moves to finisher around day 28; verify the strain guide before changing feed." },
    { key: "market-review", day: 38, title: "Review broiler finishing and market plan", detail: "Check live weights, health, and buyer/market readiness. This is a review reminder, not a prescribed slaughter date." },
  ];
  return [
    { key: "brooding-review", day: 42, title: "Review brooding-to-growing transition", detail: "Around six weeks, assess feathering, body weight, uniformity, housing and feed guidance before changing stage." },
    { key: "prelay-review", day: 105, title: "Prepare for the pre-lay period", detail: "Around week 15, review body weight, uniformity, vaccination records, housing and the farm’s pre-lay plan." },
    { key: "transfer-review", day: 112, title: "Review pullet transfer readiness", detail: "Around week 16, check weight, uniformity, health and destination readiness. Age alone does not mean birds are ready." },
  ];
}
