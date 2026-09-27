import type { NormalizedEvent, NormalizedListing } from "@workspace/providers";

const IM_KEEP_FIELDS = new Set([
  "keys",
  "steeringType",
  "steering_type",
  "horsepower",
  "generation",
  "equipment",
  "engine",
  "primary_damage",
  "secondary_damage",
]);

export function importMotorEncarLotId(listing: NormalizedListing): string | undefined {
  const fromSource = String(listing.sourceId ?? "").match(/^im-(\d{6,})$/i)?.[1];
  if (fromSource) return fromSource;
  const fromUrl = String(listing.sourceUrl ?? "").match(/\/(\d{6,})(?:[/?]|$)/)?.[1];
  return fromUrl;
}

function eventField(event: NormalizedEvent): string {
  const meta = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
  return String(meta.field ?? "");
}

export function mergeImportMotorEncarEvents(
  imEvents: NormalizedEvent[],
  encarEvents: NormalizedEvent[],
): NormalizedEvent[] {
  if (encarEvents.length === 0) return imEvents;
  const merged = [...encarEvents];
  const seen = new Set(
    merged.map((event) => `${event.eventType}|${eventField(event)}|${event.description ?? ""}`),
  );
  for (const event of imEvents) {
    if (event.eventType !== "sale" && !IM_KEEP_FIELDS.has(eventField(event))) continue;
    const key = `${event.eventType}|${eventField(event)}|${event.description ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }
  return merged;
}
