const decimalFormatter = new Intl.NumberFormat("en-GH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function money(value: unknown, currency = "GHS") {
  const amount = Number(value ?? 0);
  return `${currency} ${decimalFormatter.format(Number.isFinite(amount) ? amount : 0)}`;
}
