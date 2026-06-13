export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

export function usdInputToCents(value: string | number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
}

export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

export function payPhoneAmountCents(parts: {
  amountWithoutTax: string;
  amountWithTax: string;
  tax: string;
  service: string;
  tip: string;
}): number {
  return (
    usdInputToCents(parts.amountWithoutTax) +
    usdInputToCents(parts.amountWithTax) +
    usdInputToCents(parts.tax) +
    usdInputToCents(parts.service) +
    usdInputToCents(parts.tip)
  );
}
