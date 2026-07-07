/**
 * Shop-settings validation (PSG-779, B4).
 *
 * Single source of truth for validating the editable Settings form. Runs on BOTH
 * the server (POST /api/shop/settings — the authoritative check) and the client
 * (settings-form.tsx — mirror, for inline errors before the request). No
 * server-only imports so it is safe to bundle into the client component.
 *
 * Field/column mapping (real prod `shops` schema, verified PSG-779):
 *   name, telephone, url, radius, address_street, address_locality,
 *   address_region, address_postal_code, hours.
 * Messages are plain-language on purpose (board comms standard) — inline, never
 * silent failure.
 */

/** The editable, validated shape written to `public.shops`. */
export type ShopSettingsValues = {
  name: string;
  telephone: string;
  url: string;
  radius: number;
  address_street: string;
  address_locality: string;
  address_region: string;
  address_postal_code: string;
  hours: string;
};

export type ShopSettingsField = keyof ShopSettingsValues;

export type FieldErrors = Partial<Record<ShopSettingsField, string>>;

export type ValidateSettingsResult =
  | { ok: true; values: ShopSettingsValues }
  | { ok: false; fieldErrors: FieldErrors };

/** Plain-language messages, one place so client + server stay in lockstep. */
export const SETTINGS_MESSAGES = {
  name_required: "Enter your shop name.",
  telephone_required: "Enter your shop's phone number.",
  telephone_invalid: "Enter a valid US phone number, e.g. (203) 555-0148.",
  url_required: "Enter your website starting with https://.",
  url_invalid: "Enter your website starting with https://.",
  radius_required: "Enter your service radius in miles (1–100).",
  radius_invalid: "Enter your service radius in miles (1–100).",
  address_street_required: "Enter your shop's street address.",
  address_region_invalid: "Use the 2-letter state code, e.g. CT.",
  address_postal_code_invalid: "Enter a 5-digit ZIP code, e.g. 06484.",
  hours_too_long: "Keep hours under 200 characters.",
} as const;

const HOURS_MAX = 200;

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v.trim() : String(v).trim();
}

/** Digits only — US number is valid at 10 digits, or 11 with a leading country 1. */
export function isValidUsPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return true;
  if (digits.length === 11 && digits.startsWith("1")) return true;
  return false;
}

/** True only for a well-formed https:// URL. */
export function isHttpsUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.length > 0;
}

/**
 * Validate + normalize raw input (form strings or JSON). On success returns the
 * exact values to persist; on failure returns per-field plain-language messages.
 */
export function validateShopSettings(input: unknown): ValidateSettingsResult {
  const src = (input ?? {}) as Record<string, unknown>;
  const fieldErrors: FieldErrors = {};

  const name = asString(src.name);
  if (name.length === 0) fieldErrors.name = SETTINGS_MESSAGES.name_required;

  const telephone = asString(src.telephone);
  if (telephone.length === 0) {
    fieldErrors.telephone = SETTINGS_MESSAGES.telephone_required;
  } else if (!isValidUsPhone(telephone)) {
    fieldErrors.telephone = SETTINGS_MESSAGES.telephone_invalid;
  }

  const url = asString(src.url);
  if (url.length === 0) {
    fieldErrors.url = SETTINGS_MESSAGES.url_required;
  } else if (!isHttpsUrl(url)) {
    fieldErrors.url = SETTINGS_MESSAGES.url_invalid;
  }

  // radius: required integer 1–100. Accept number or numeric string from the form.
  const radiusRaw = src.radius;
  let radius = NaN;
  if (typeof radiusRaw === "number") {
    radius = radiusRaw;
  } else {
    const rs = asString(radiusRaw);
    if (rs.length === 0) {
      fieldErrors.radius = SETTINGS_MESSAGES.radius_required;
    } else if (/^\d+$/.test(rs)) {
      radius = Number(rs);
    } else {
      fieldErrors.radius = SETTINGS_MESSAGES.radius_invalid;
    }
  }
  if (
    !fieldErrors.radius &&
    (!Number.isInteger(radius) || radius < 1 || radius > 100)
  ) {
    fieldErrors.radius = SETTINGS_MESSAGES.radius_invalid;
  }

  const addressStreet = asString(src.address_street);
  if (addressStreet.length === 0) {
    fieldErrors.address_street = SETTINGS_MESSAGES.address_street_required;
  }

  const addressLocality = asString(src.address_locality);

  // State: optional, but if present must be a 2-letter code. Normalize to upper.
  const addressRegion = asString(src.address_region).toUpperCase();
  if (addressRegion.length > 0 && !/^[A-Z]{2}$/.test(addressRegion)) {
    fieldErrors.address_region = SETTINGS_MESSAGES.address_region_invalid;
  }

  // ZIP: optional, but if present must be exactly 5 digits.
  const addressPostal = asString(src.address_postal_code);
  if (addressPostal.length > 0 && !/^\d{5}$/.test(addressPostal)) {
    fieldErrors.address_postal_code =
      SETTINGS_MESSAGES.address_postal_code_invalid;
  }

  const hours = asString(src.hours);
  if (hours.length > HOURS_MAX) {
    fieldErrors.hours = SETTINGS_MESSAGES.hours_too_long;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    values: {
      name,
      telephone,
      url,
      radius,
      address_street: addressStreet,
      address_locality: addressLocality,
      address_region: addressRegion,
      address_postal_code: addressPostal,
      hours,
    },
  };
}
