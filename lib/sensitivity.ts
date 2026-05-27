export const DEFAULT_SENSITIVITY = "public" as const;

export const SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;

export type Sensitivity = (typeof SENSITIVITIES)[number];

export function normalizeSensitivity(value: string | null | undefined) {
  return SENSITIVITIES.includes(value as Sensitivity)
    ? (value as Sensitivity)
    : DEFAULT_SENSITIVITY;
}
