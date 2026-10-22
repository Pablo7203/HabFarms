const legacyTimezoneAliases: Record<string, string> = { "africa/nigeria": "Africa/Lagos" };

export function canonicalFarmTimezone(timezone: string): string | null {
  const value = timezone.trim();
  if (!value) return null;
  const alias = legacyTimezoneAliases[value.toLowerCase()];
  if (alias) return alias;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidFarmTimezone(timezone: string) {
  return canonicalFarmTimezone(timezone) !== null;
}

export function resolveFarmTimezone(timezone: string) {
  return canonicalFarmTimezone(timezone) ?? "UTC";
}

export function farmToday(timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: resolveFarmTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export function formatFarmDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)); }
