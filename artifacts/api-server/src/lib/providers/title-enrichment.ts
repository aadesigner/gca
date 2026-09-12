/**
 * Shared title enrichment — literal tokens only.
 * Never invent displacement/CC from badges like "350d" or "3.3T".
 */

import type { NormalizedEvent } from "@workspace/providers";
import { translateExtraValue } from "../vehicle-extra";

/**
 * Pull chassis / trim tokens that appear literally in Seobuk-style titles.
 *
 * Examples:
 *   "[BMW] 5 Series (F10) 528i xDrive …" → chassis F10, titleTrim "528i xDrive …"
 *   "[Mercedes Benz] E-Class W213 E220d …" → chassis W213, titleTrim "E220d …"
 */
export function seobukTitleEnrichment(title: string): { chassis?: string; titleTrim?: string } {
  const body = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\[[^\]]+\]\s*/, "")
    .trim();
  if (!body) return {};

  // BMW / KR export: generation in parentheses — only accept letter+2 digits (+ optional letter).
  const paren = body.match(/\(([A-Za-z][0-9]{2}[A-Za-z]?)\)/);
  if (paren?.[1] && paren.index != null) {
    const chassis = paren[1].toUpperCase();
    const titleTrim = body
      .slice(paren.index + paren[0].length)
      .replace(/^[\s\-–—|/.,]+/, "")
      .trim();
    return { chassis, titleTrim: titleTrim || undefined };
  }

  // Mercedes body codes that appear as their own token (W213, C257, V167, …).
  const mb = body.match(/\b((?:W|C|V|X|A)\d{3})\b/i);
  if (mb?.[1] && mb.index != null) {
    const chassis = mb[1].toUpperCase();
    const titleTrim = body
      .slice(mb.index + mb[0].length)
      .replace(/^[\s\-–—|/.,]+/, "")
      .trim();
    return { chassis, titleTrim: titleTrim || undefined };
  }

  return {};
}

/** Drop placeholder / zero displacements — never keep "0", "0 CC", "0.0L". */
export function cleanEngineDisplacement(raw?: string | null): string | undefined {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text || text === "-") return undefined;
  if (/^0+(\.0+)?(?:\s*(?:cc|cm3|cm³|l|liter|litre))?$/i.test(text)) return undefined;
  const digits = text.replace(/[^\d.]/g, "");
  if (!digits || /^0+(\.0+)?$/.test(digits)) return undefined;
  const n = Number(digits);
  if (Number.isFinite(n) && n <= 0) return undefined;
  return text;
}

const JUNK_SPEC =
  /^(0+|n\/?a|n\.a\.?|null|undefined|unknown|unspecified|not\s*specified|none|other|others|unspecific|-|—|\.|--+|car|vehicle|auto|tbd|nil)$/i;

/** Reject UI placeholders that providers send instead of a real enum value. */
export function cleanEnumSpec(raw?: string | null): string | undefined {
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (JUNK_SPEC.test(text)) return undefined;
  return text;
}

/** Sanitize vehicle enum / displacement fields before DB write. */
export function sanitizeVehicleSpecFields<T extends {
  fuelType?: string;
  bodyType?: string;
  transmission?: string;
  driveType?: string;
  color?: string;
  trim?: string;
  engineDisplacement?: string;
}>(vehicle: T): T {
  return {
    ...vehicle,
    fuelType: cleanEnumSpec(vehicle.fuelType),
    bodyType: cleanEnumSpec(vehicle.bodyType),
    transmission: cleanEnumSpec(vehicle.transmission),
    driveType: cleanEnumSpec(vehicle.driveType),
    color: cleanEnumSpec(vehicle.color),
    trim: cleanEnumSpec(vehicle.trim),
    engineDisplacement: cleanEngineDisplacement(vehicle.engineDisplacement),
  };
}

/** Merge Seobuk table specs with literal title tokens (title wins only for missing fields / chassis). */
export function applySeobukTitleEnrichment(
  title: string,
  parts: { model?: string; trim?: string; engineDisplacement?: string },
): { model?: string; trim?: string; engineDisplacement?: string } {
  const { chassis, titleTrim } = seobukTitleEnrichment(title);
  let model = parts.model?.replace(/\s+/g, " ").trim() || undefined;
  let trim = parts.trim?.replace(/\s+/g, " ").trim() || undefined;
  const engineDisplacement = cleanEngineDisplacement(parts.engineDisplacement);

  if (chassis) {
    const hasChassis =
      (model && new RegExp(`\\b${chassis}\\b`, "i").test(model)) ||
      (trim && new RegExp(`\\b${chassis}\\b`, "i").test(trim));
    if (!hasChassis && model) {
      model = /\([A-Za-z][0-9]{2}[A-Za-z]?\)/.test(model)
        ? model
        : `${model} (${chassis})`;
    } else if (!hasChassis && !model) {
      model = chassis;
    }
  }

  if ((!trim || trim === "-") && titleTrim) {
    trim = titleTrim;
  }

  return { model, trim, engineDisplacement };
}

/**
 * Literal title tokens after year + make + model (when those are already known).
 * Does not invent fields — only returns the remainder string.
 *
 * Examples:
 *   "2016 Mercedes-Benz GLE 350d 4Matic" + model GLE → "350d 4Matic"
 *   "2018 HYUNDAI SONATA RISE 2.0 MORDERN" + model SONATA RISE → "2.0 MORDERN"
 *   "BMW X5 XDRIVE40i EXCLUSIVE M SPORT PACKAGE" + model X5 → "XDRIVE40i EXCLUSIVE M SPORT PACKAGE"
 */
export function titleRemainderTrim(
  title: string | undefined,
  parts: { year?: number; make?: string; model?: string },
): string | undefined {
  let rest = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!rest) return undefined;

  if (parts.year && parts.year >= 1980 && parts.year <= 2035) {
    rest = rest.replace(new RegExp(`^${parts.year}\\s+`), "").trim();
  } else {
    rest = rest.replace(/^(?:19|20)\d{2}\s+/, "").trim();
  }

  if (parts.make) {
    rest = rest.replace(new RegExp(`^${escapeRegExp(parts.make)}\\s+`, "i"), "").trim();
  }
  if (parts.model) {
    rest = rest.replace(new RegExp(`^${escapeRegExp(parts.model)}\\s+`, "i"), "").trim();
  }

  if (!rest || /^[-–—.?]+$/.test(rest)) return undefined;
  return rest;
}

/** Fill missing trim from literal title remainder; clear junk engine values. */
export function applyTitleTrimEnrichment(
  title: string | undefined,
  parts: {
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    engineDisplacement?: string;
  },
): { model?: string; trim?: string; engineDisplacement?: string } {
  const model = parts.model?.replace(/\s+/g, " ").trim() || undefined;
  let trim = parts.trim?.replace(/\s+/g, " ").trim() || undefined;
  if (trim === "-" || /^n\/?a$/i.test(trim ?? "")) trim = undefined;
  const engineDisplacement = cleanEngineDisplacement(parts.engineDisplacement);

  if (!trim) {
    const rem = titleRemainderTrim(title, {
      year: parts.year,
      make: parts.make,
      model,
    });
    if (rem) trim = rem;
  }

  return { model, trim, engineDisplacement };
}

/** Uncategorizable labeled specs → vehicle_events extras (metadata.field). */
export function extraSpecEvent(
  source: string,
  field: string,
  label: string,
  value?: string | null,
): NormalizedEvent | undefined {
  const text = translateExtraValue(String(value ?? "").replace(/\s+/g, " ").trim());
  if (!text || text === "-" || /^[?\-–—]$/.test(text) || /^n\/?a$/i.test(text)) return undefined;
  return {
    eventType: "other",
    description: `${label}: ${text}`,
    occurredAt: new Date(),
    metadata: { field, value: text, source },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
