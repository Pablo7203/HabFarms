export type FeedForecastBasis = "configured_plan" | "recent_actual" | "not_configured";

export function formatFeedRunway(days: number | null | undefined, quantityKg: number) {
  if (quantityKg <= 0) return "Out of stock";
  if (days == null || !Number.isFinite(days)) return "Forecast unavailable";
  const hours = days * 24;
  if (hours < 1) return "Less than 1 hour";
  if (days < 1) return `About ${Math.max(1, Math.round(hours))} hours`;
  return `About ${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

export function feedForecastBasisLabel(basis: FeedForecastBasis | string | null | undefined) {
  if (basis === "configured_plan") return "Current flock and rearing plans";
  if (basis === "recent_actual") return "Recent recorded use";
  return "No plan or recent usage yet";
}
