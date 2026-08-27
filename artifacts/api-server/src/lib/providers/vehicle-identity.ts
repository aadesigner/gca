/**
 * Shared vehicle identity helpers for VIN history gating.
 * History DB requires a usable make or model (not VIN-only / "unknown" stubs).
 */

const JUNK_TOKEN =
  /^(unknown|n\/?a|null|none|undefined|not\s*available|tbd|-+|\.+|404|403|500|502|503)$/i;

const MULTI_WORD_MAKES =
  /^(Land Rover|Mercedes-Benz|Mercedes Benz|Alfa Romeo|Aston Martin|Rolls-Royce|CF Moto|Cf Moto|BMW Motorrad|Harley-Davidson|Range Rover)\b/i;

function cleanToken(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const t = String(value).replace(/\s+/g, " ").trim();
  if (!t || JUNK_TOKEN.test(t)) return undefined;
  return t;
}

function isJunkTitle(title: string): boolean {
  if (JUNK_TOKEN.test(title)) return true;
  if (/^\d{3}$/.test(title)) return true; // bare HTTP-ish codes
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(title)) return true;
  return false;
}

export function isUsableVehicleIdentity(input: {
  make?: string | null;
  model?: string | null;
}): boolean {
  return Boolean(cleanToken(input.make) || cleanToken(input.model));
}

/**
 * Fill missing make/model/year from listing titles like
 * "2020 Freightliner Mt45G Delivery Truck vin: …".
 */
export function salvageVehicleIdentity(input: {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  title?: string | null;
}): { make?: string; model?: string; year?: number } {
  let make = cleanToken(input.make);
  let model = cleanToken(input.model);
  let year =
    typeof input.year === "number" && input.year >= 1980 && input.year <= 2035
      ? input.year
      : undefined;

  const rawTitle = cleanToken(input.title);
  if (!rawTitle || isJunkTitle(rawTitle)) {
    return { make, model, year };
  }

  let rest = rawTitle
    .replace(/\s*vin:?\s*[A-HJ-NPR-Z0-9]{17}\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!year) {
    const ym = rest.match(/^(\d{4})\b/);
    if (ym) {
      const y = Number(ym[1]);
      if (y >= 1980 && y <= 2035) {
        year = y;
        rest = rest.slice(ym[0].length).trim();
      }
    }
  } else {
    rest = rest.replace(new RegExp(`^${year}\\s+`), "").trim();
  }

  if (!make && rest) {
    const multi = rest.match(MULTI_WORD_MAKES);
    if (multi?.[1]) {
      make = multi[1].replace(/\s+/g, " ").trim();
      rest = rest.slice(multi[0].length).trim();
    } else {
      const single = rest.match(/^([A-Za-z][A-Za-z0-9-]*)\b/);
      if (single?.[1] && !JUNK_TOKEN.test(single[1])) {
        make = single[1];
        rest = rest.slice(single[0].length).trim();
      }
    }
  } else if (make) {
    rest = rest.replace(new RegExp(`^${escapeRegExp(make)}\\b`, "i"), "").trim();
  }

  if (!model && rest && !isJunkTitle(rest)) {
    // Keep a short model phrase; drop trailing noise words.
    model = rest
      .replace(/\b(vin|lot|auction|sold|active)\b.*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join(" ");
    if (!model || JUNK_TOKEN.test(model)) model = undefined;
  }

  return { make, model, year };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
