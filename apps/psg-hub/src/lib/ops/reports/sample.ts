// v1.4 / PSG-28 — Deterministic sample-data primitives for the reports
// framework. No clock read, no randomness (so tests are stable and the
// framework demonstrates identically on every run). Values are index-derived.

const SHOPS = [
  "Anaheim Collision",
  "Riverside Auto Body",
  "Pomona Paint & Body",
  "Fontana Collision Center",
  "Ontario Body Works",
  "Corona Auto Craft",
];

const ESTIMATORS = [
  "J. Morales",
  "T. Nguyen",
  "R. Patel",
  "S. Carter",
  "L. Brooks",
];

const TECHS = ["M. Diaz", "K. Owens", "D. Reyes", "P. Hughes", "B. Foster"];

const MAKES = ["Toyota", "Honda", "Ford", "Chevrolet", "Nissan", "Tesla"];
const MODELS = ["Camry", "Civic", "F-150", "Silverado", "Altima", "Model 3"];

const PAY_TYPES = ["Insurance", "Customer Pay", "Internal", "Warranty"];

const INSURERS = [
  "State Farm",
  "GEICO",
  "Allstate",
  "Progressive",
  "Farmers",
  "USAA",
];

const CATEGORIES = [
  "Insurance Agent",
  "Repeat Customer",
  "Dealership",
  "Web/Search",
  "Word of Mouth",
];

export function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

export function shopName(i: number) {
  return pick(SHOPS, i);
}
export function estimator(i: number) {
  return pick(ESTIMATORS, i);
}
export function tech(i: number) {
  return pick(TECHS, i);
}
export function make(i: number) {
  return pick(MAKES, i);
}
export function model(i: number) {
  return pick(MODELS, i);
}
export function payType(i: number) {
  return pick(PAY_TYPES, i);
}
export function insurer(i: number) {
  return pick(INSURERS, i);
}
export function category(i: number) {
  return pick(CATEGORIES, i);
}

/** Stable pseudo-int in [min, max] from an index — deterministic, no RNG. */
export function seeded(i: number, min: number, max: number): number {
  const span = max - min + 1;
  // simple LCG-style mix on the index; deterministic and spread-out
  const mixed = (i * 2654435761) % 2147483647;
  return min + (mixed % span);
}

/** A YYYY-MM-DD date offset within a window start, or a fixed fallback date. */
export function sampleDate(start: string | null, offsetDays: number): string {
  const base = start ?? "2026-05-01";
  const [y, m, d] = base.split("-").map((n) => parseInt(n, 10));
  // Construct a UTC date arithmetically; avoids `new Date()` clock semantics.
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return dt.toISOString().slice(0, 10);
}

export function roNumber(i: number): string {
  return `RO-${(10500 + i).toString()}`;
}

export function customerName(i: number): string {
  const first = ["Alex", "Jordan", "Casey", "Morgan", "Riley", "Taylor"];
  const last = ["Sutton", "Hale", "Vance", "Ortiz", "Beck", "Frost"];
  return `${pick(first, i)} ${pick(last, i + 2)}`;
}
