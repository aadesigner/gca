/**
 * Extract normalized vehicle history events from Encar supplementary API payloads.
 */

import type { NormalizedEvent } from "@workspace/providers";
import {
  bodyConditionLegendFromStatus,
  extractBodyConditionFromDiagnosis,
  guessPanelKey,
  type BodyConditionPanel,
} from "../body-condition";
import {
  normalizeEncarFuel,
  normalizeEncarInspectionStatus,
  normalizeEncarMaker,
  translateEncarAccidentType,
  translateEncarCodeTitle,
  translateEncarComment,
  translateEncarEventDescription,
  translateEncarInspectionPanel,
  translateEncarRecallStatus,
  translateEncarUsageChange,
  formatInsuranceGapPeriod,
  containsHangul,
} from "./encar-locale";

export interface EncarAggregatedPayload {
  listingId?: string;
  vehicleId?: string;
  detail?: Record<string, unknown>;
  view?: Record<string, unknown> | null;
  diagnosis?: Record<string, unknown> | null;
  inspection?: Record<string, unknown> | null;
  record?: Record<string, unknown> | null;
}

interface EncarRecordAccident {
  type?: string;
  date?: string;
  insuranceBenefit?: number;
  partCost?: number;
  laborCost?: number;
  paintingCost?: number;
}

export function extractEncarEvents(payload: EncarAggregatedPayload): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  events.push(...extractRecordEvents(payload.record));
  events.push(...extractDiagnosisEvents(payload.diagnosis));
  events.push(...extractInspectionEvents(payload.inspection));

  return events.map((event) => ({
    ...event,
    description: translateEncarEventDescription(event.description) ?? event.description,
  }));
}

export function extractEncarCounts(payload: EncarAggregatedPayload): {
  accidentCount?: number;
  ownerChangeCount?: number;
} {
  const record = payload.record;
  if (!record) return {};

  const myAccidents = num(record.myAccidentCnt);
  const otherAccidents = num(record.otherAccidentCnt);
  const accidentCount =
    myAccidents != null || otherAccidents != null
      ? (myAccidents ?? 0) + (otherAccidents ?? 0)
      : num(record.accidentCnt);

  return {
    accidentCount,
    ownerChangeCount: num(record.ownerChangeCnt),
  };
}

function extractRecordEvents(record: Record<string, unknown> | null | undefined): NormalizedEvent[] {
  if (!record || record.openData === false) return [];

  const events: NormalizedEvent[] = [];

  const firstDate = str(record.firstDate);
  if (firstDate) {
    events.push({
      eventType: "delivery",
      description: `First registration: ${firstDate}`,
      occurredAt: parseDate(firstDate),
      metadata: {
        source: "encar_record",
        kind: "firstRegistration",
        field: "firstDate",
        value: firstDate,
      },
    });
  }

  const ownerRows = arr(record.ownerChanges)
    .map((item, index) => {
      if (typeof item === "string") {
        const date = item.trim();
        return date ? { date, sequence: index + 1, mileage: undefined as number | undefined, plate: undefined as string | undefined } : null;
      }
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const date = str(row.date) ?? str(row.changeDate) ?? str(row.ownerChangeDate);
      if (!date) return null;
      return {
        date,
        sequence: index + 1,
        mileage: num(row.mileage) ?? num(row.mileageKm) ?? num(row.odometer) ?? num(row.km),
        plate: str(row.carNo) ?? str(row.plate),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  // Encar returns newest-first; persist chronological (oldest = #1).
  ownerRows.sort((a, b) => a.date.localeCompare(b.date));
  const totalOwners = num(record.ownerChangeCnt) ?? ownerRows.length;

  ownerRows.forEach((row, index) => {
    const sequence = index + 1;
    events.push({
      eventType: "owner_change",
      description: [
        `Owner change ${sequence} of ${ownerRows.length} recorded on ${row.date}`,
        row.mileage != null ? `${row.mileage.toLocaleString("en-US")} km` : null,
      ]
        .filter(Boolean)
        .join(" — "),
      occurredAt: parseDate(row.date),
      metadata: {
        source: "encar_record",
        // Korean vehicle registry transfer date (not auction/listing date).
        kind: "registry_owner_change",
        date: row.date,
        sequence,
        total: ownerRows.length,
        ownerChangeCount: totalOwners,
        mileage: row.mileage,
        mileageKm: row.mileage,
        plate: row.plate,
      },
    });
  });

  for (const change of arr(record.carInfoChanges)) {
    if (!change || typeof change !== "object") continue;
    const item = change as Record<string, unknown>;
    const date = str(item.date);
    const carNo = str(item.carNo);
    if (!date) continue;
    events.push({
      eventType: "other",
      description: carNo
        ? `License plate update on ${date} (${carNo})`
        : `Vehicle registration update on ${date}`,
      occurredAt: parseDate(date),
      metadata: { source: "encar_record", date, carNo },
    });
  }

  if (num(record.totalLossCnt) > 0) {
    events.push({
      eventType: "total_loss",
      description: `Total loss recorded (${num(record.totalLossCnt)} incident(s))`,
      occurredAt: parseDate(str(record.totalLossDate) ?? str(record.regDate)),
      metadata: {
        source: "encar_record",
        totalLossCnt: num(record.totalLossCnt),
        totalLossDate: str(record.totalLossDate),
        salvage: true,
      },
    });
  }

  if (num(record.floodTotalLossCnt) > 0 || num(record.floodPartLossCnt) > 0) {
    events.push({
      eventType: "flood_damage",
      description: "Flood damage recorded in registry history",
      occurredAt: parseDate(str(record.floodDate) ?? str(record.regDate)),
      metadata: {
        source: "encar_record",
        floodTotalLossCnt: num(record.floodTotalLossCnt),
        floodPartLossCnt: num(record.floodPartLossCnt),
        floodDate: str(record.floodDate),
      },
    });
  }

  if (num(record.robberCnt) > 0) {
    events.push({
      eventType: "other",
      description: `Theft record reported (${num(record.robberCnt)} incident(s))`,
      occurredAt: parseDate(str(record.robberDate) ?? str(record.regDate)),
      metadata: {
        source: "encar_record",
        robberCnt: num(record.robberCnt),
        robberDate: str(record.robberDate),
      },
    });
  }

  let monetaryAccidentRows = 0;
  for (const accident of arr(record.accidents) as EncarRecordAccident[]) {
    if (!accident?.date) continue;
    const partCost = num(accident.partCost) ?? 0;
    const laborCost = num(accident.laborCost) ?? 0;
    const paintingCost = num(accident.paintingCost) ?? 0;
    const insuranceBenefit = num(accident.insuranceBenefit) ?? 0;
    const repairTotal = partCost + laborCost + paintingCost;
    const hasMoney = repairTotal > 0 || insuranceBenefit > 0;
    if (hasMoney) monetaryAccidentRows += 1;

    const typeLabel =
      translateEncarAccidentType(accident.type) ?? str(accident.type) ?? "Insurance claim";
    const costBits = [
      partCost > 0 ? `parts ₩${partCost.toLocaleString("en-US")}` : null,
      laborCost > 0 ? `labor ₩${laborCost.toLocaleString("en-US")}` : null,
      paintingCost > 0 ? `paint ₩${paintingCost.toLocaleString("en-US")}` : null,
      repairTotal > 0 ? `total ₩${repairTotal.toLocaleString("en-US")}` : null,
      insuranceBenefit > 0 ? `payout ₩${insuranceBenefit.toLocaleString("en-US")}` : null,
    ].filter(Boolean);
    const description = hasMoney
      ? [`Insurance accident (${typeLabel}) on ${accident.date}`, ...costBits].join(" — ")
      : `Insurance claim recorded (${typeLabel}) on ${accident.date}`;

    events.push({
      eventType: "accident",
      description,
      occurredAt: parseDate(accident.date),
      metadata: {
        source: "encar_record",
        type: typeLabel,
        rawType: accident.type,
        date: accident.date,
        currency: "KRW",
        partCost: partCost > 0 ? partCost : undefined,
        laborCost: laborCost > 0 ? laborCost : undefined,
        paintingCost: paintingCost > 0 ? paintingCost : undefined,
        repairTotal: repairTotal > 0 ? repairTotal : undefined,
        insuranceBenefit: insuranceBenefit > 0 ? insuranceBenefit : undefined,
        emptyCosts: hasMoney ? undefined : true,
      },
    });
  }

  const myAccidentCost = num(record.myAccidentCost);
  const otherAccidentCost = num(record.otherAccidentCost);
  // Encar often ships dated stub rows (₩0) while still exposing non-zero totals —
  // only skip the summary when we already have monetary per-claim rows.
  if (
    ((myAccidentCost ?? 0) > 0 || (otherAccidentCost ?? 0) > 0) &&
    monetaryAccidentRows === 0
  ) {
    events.push({
      eventType: "accident",
      description: `Total insurance repair exposure — own: ₩${(myAccidentCost ?? 0).toLocaleString("en-US")}, third party: ₩${(otherAccidentCost ?? 0).toLocaleString("en-US")}`,
      occurredAt: parseDate(str(record.regDate) ?? new Date().toISOString().slice(0, 10)),
      metadata: {
        source: "encar_record_summary",
        type: "Registry totals",
        currency: "KRW",
        repairTotal: (myAccidentCost ?? 0) + (otherAccidentCost ?? 0) || undefined,
        myAccidentCost,
        otherAccidentCost,
        myAccidentCnt: num(record.myAccidentCnt),
        otherAccidentCnt: num(record.otherAccidentCnt),
      },
    });
  }

  if (num(record.loan) > 0) {
    events.push({
      eventType: "other",
      description: "Active lien/loan flagged on registry record",
      occurredAt: parseDate(str(record.regDate) ?? new Date().toISOString().slice(0, 10)),
      metadata: { source: "encar_record", loan: num(record.loan) },
    });
  }

  if (num(record.government) > 0) {
    events.push({
      eventType: "other",
      description: "Government-use history flagged on Korean registry",
      occurredAt: parseDate(str(record.firstDate) ?? str(record.regDate)),
      metadata: { source: "encar_record", government: num(record.government) },
    });
  }

  if (num(record.business) > 0) {
    events.push({
      eventType: "other",
      description: "Commercial/business-use history flagged on Korean registry",
      occurredAt: parseDate(str(record.firstDate) ?? str(record.regDate)),
      metadata: { source: "encar_record", business: num(record.business) },
    });
  }

  for (let i = 1; i <= 5; i++) {
    const gap = str(record[`notJoinDate${i}`]);
    if (!gap) continue;
    const range = formatInsuranceGapPeriod(gap);
    const startToken = gap.split(/\s*(?:~|～|to|–|—)\s*/i)[0]?.trim() ?? gap;
    const startCompact = startToken.replace(/[^\d]/g, "");
    const occurred =
      startCompact.length >= 6
        ? parseDate(`${startCompact.slice(0, 4)}-${startCompact.slice(4, 6)}-01`)
        : parseDate(startToken);
    events.push({
      eventType: "other",
      description: `Insurance coverage gap: ${range}`,
      occurredAt: occurred,
      metadata: {
        source: "encar_record",
        field: `notJoinDate${i}`,
        value: gap,
        formatted: range,
        date: formatEncarDate(startCompact.length >= 8
          ? startCompact
          : startCompact.length >= 6
            ? `${startCompact}01`
            : undefined) ?? range.slice(0, 7),
      },
    });
  }

  return events;
}

function extractDiagnosisEvents(
  diagnosis: Record<string, unknown> | null | undefined,
): NormalizedEvent[] {
  if (!diagnosis) return [];

  const events: NormalizedEvent[] = [];
  const occurredAt = parseDate(str(diagnosis.diagnosisDate) ?? str(diagnosis.realDiagnosisDate));
  const structured = extractBodyConditionFromDiagnosis(diagnosis);
  const panels: BodyConditionPanel[] = structured?.panels ?? [];
  const comments: string[] = [];

  for (const item of arr(diagnosis.items)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = str(row.name);
    const result = str(row.result);

    if (name === "CHECKER_COMMENT" || name === "OUTER_PANEL_COMMENT") {
      const translated = translateEncarComment(result);
      if (translated) comments.push(translated);
    }
  }

  const summaryLabels = panels.map(
    (p) => `${p.label}: ${p.result ?? p.legendLabel} (${p.legend})`,
  );

  if (panels.length > 0) {
    events.push({
      eventType: "inspection",
      description: `Encar diagnosis — ${summaryLabels.join(", ")}`,
      occurredAt,
      metadata: {
        source: "encar_diagnosis",
        diagnosisNo: num(diagnosis.diagnosisNo),
        center: str(diagnosis.reservationCenterName),
        date: structured?.date,
        bodyCondition: true,
        panels,
        comments: comments.length ? comments : undefined,
      },
    });
  } else if (structured?.allClear) {
    // All listed panels NORMAL — still store a body-map event so the UI shows a clean diagram.
    events.push({
      eventType: "inspection",
      description: "Encar diagnosis — all panels normal",
      occurredAt,
      metadata: {
        source: "encar_diagnosis",
        diagnosisNo: num(diagnosis.diagnosisNo),
        center: str(diagnosis.reservationCenterName),
        date: structured.date,
        bodyCondition: true,
        allClear: true,
        panels: [],
      },
    });
  }

  if (comments.length > 0) {
    // Deduplicate near-identical translations; drop contradictory leftovers.
    const seen = new Set<string>();
    const unique = comments
      .map((c) => translateEncarComment(c) ?? c)
      .map((c) => c.replace(/\s+/g, " ").trim())
      .filter((c) => {
        if (!c) return false;
        const key = c.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // Prefer the accurate "no replacements" phrase over a mangled "replacement vehicle".
    const hasNoReplace = unique.some((c) => /no outer-panel replacements|no replacements/i.test(c));
    const filtered = hasNoReplace
      ? unique.filter((c) => !/classified as an outer-panel replacement vehicle/i.test(c))
      : unique;

    const translated = filtered.filter(Boolean).join(" / ");

    const description =
      translated && !containsHangul(translated)
        ? translated
        : buildDiagnosisSummaryEnglish(
            panels.map((p) => p.label),
            filtered,
          );

    if (description) {
      events.push({
        eventType: "other",
        description,
        occurredAt,
        metadata: { source: "encar_diagnosis", comments: filtered },
      });
    }
  }

  return events;
}

function extractInspectionEvents(
  inspection: Record<string, unknown> | null | undefined,
): NormalizedEvent[] {
  if (!inspection) return [];

  const events: NormalizedEvent[] = [];
  const master = (inspection.master ?? {}) as Record<string, unknown>;
  const detail = (master.detail ?? {}) as Record<string, unknown>;

  const issueDate = formatEncarDate(str(master.registrationDate) ?? str(detail.issueDate));
  const firstReg = formatEncarDate(str(detail.firstRegistrationDate));
  const validFrom = formatEncarDate(str(detail.validityStartDate));
  const validTo = formatEncarDate(str(detail.validityEndDate));
  const occurredAt = parseDate(issueDate ?? validFrom ?? firstReg);

  const mileage = num(detail.mileage);
  const inspectionVin = str(detail.vin);
  const recordNo = str(detail.recordNo);
  const boardState = normalizeEncarInspectionStatus(title(detail.boardStateType)) ??
    normalizeEncarInspectionStatus(str(detail.boardStateType));
  const carState = normalizeEncarInspectionStatus(title(detail.carStateType)) ??
    normalizeEncarInspectionStatus(str(detail.carStateType));
  const comments = translateEncarComment(str(detail.comments));
  const waterlog = detail.waterlog === true;
  const accidentFlagged = master.accdient === true || master.accident === true;
  const simpleRepair = master.simpleRepair === true;

  const meaningfulBoard = isMeaningfulInspectionStatus(boardState);
  const meaningfulCar = isMeaningfulInspectionStatus(carState);

  // Human-readable performance inspection summary (dates + statuses in English).
  const summaryParts: string[] = ["Korean performance inspection"];
  if (recordNo) summaryParts.push(`record #${recordNo}`);
  if (issueDate) summaryParts.push(`issued ${issueDate}`);
  if (mileage != null) summaryParts.push(`${mileage.toLocaleString("en-US")} km`);
  if (meaningfulBoard) summaryParts.push(`structure/frame: ${boardState}`);
  if (meaningfulCar) summaryParts.push(`vehicle condition: ${carState}`);
  if (!meaningfulBoard && !meaningfulCar && (boardState || carState)) {
    summaryParts.push("no defects noted on structure or condition check");
  }
  if (validFrom && validTo) summaryParts.push(`valid ${validFrom} → ${validTo}`);
  else if (validTo) summaryParts.push(`valid until ${validTo}`);
  if (firstReg) summaryParts.push(`first registered ${firstReg}`);
  if (comments) summaryParts.push(`comments: ${comments}`);
  if (simpleRepair) summaryParts.push("simple outer-panel repair flagged");

  if (
    mileage != null ||
    inspectionVin ||
    meaningfulBoard ||
    meaningfulCar ||
    issueDate ||
    validFrom ||
    validTo ||
    firstReg ||
    recordNo ||
    comments ||
    simpleRepair
  ) {
    events.push({
      eventType: "inspection",
      description: summaryParts.join(" — "),
      occurredAt,
      metadata: {
        source: "encar_inspection",
        recordNo,
        mileage,
        mileageKm: mileage,
        vin: inspectionVin,
        date: issueDate,
        issueDate,
        firstRegistrationDate: firstReg,
        validityStartDate: validFrom,
        validityEndDate: validTo,
        boardState: boardState ?? null,
        carState: carState ?? null,
        waterlog,
        accidentFlagged,
        simpleRepair,
        comments: comments ?? null,
      },
    });
  }

  // Manufacturer recall status from the Korean performance inspection sheet.
  const recallFlag = detail.recall === true || detail.recall === "Y" || detail.recall === 1;
  const recallRows = arr(detail.recallFullFillTypes)
    .map((row) => {
      if (!row || typeof row !== "object") return undefined;
      const rec = row as Record<string, unknown>;
      const titleText =
        translateEncarRecallStatus(title(rec)) ??
        translateEncarCodeTitle({
          code: str(rec.code) ?? (typeof rec.code === "number" ? String(rec.code) : undefined),
          title: title(rec),
        });
      return titleText;
    })
    .filter((x): x is string => Boolean(x));
  if (recallFlag || recallRows.length > 0) {
    const status = recallRows.length ? recallRows.join(", ") : "Flagged";
    const outstanding = recallRows.some((r) => /not completed|outstanding|pending|미이행/i.test(r));
    events.push({
      eventType: "other",
      description: outstanding
        ? `Manufacturer recall outstanding on performance inspection${issueDate ? ` (${issueDate})` : ""} — ${status}`
        : `Manufacturer recall recorded on performance inspection${issueDate ? ` (${issueDate})` : ""} — ${status}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        field: "recall",
        kind: "recall",
        recall: true,
        recallStatus: status,
        outstanding,
        date: issueDate,
        mileage,
        mileageKm: mileage,
      },
    });
  }

  for (const row of arr(detail.usageChangeTypes)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const label =
      translateEncarUsageChange(title(rec)) ??
      translateEncarCodeTitle({
        code: str(rec.code) ?? (typeof rec.code === "number" ? String(rec.code) : undefined),
        title: title(rec),
      });
    if (!label) continue;
    events.push({
      eventType: "other",
      description: `Vehicle use history: ${label}${issueDate ? ` (noted ${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        field: "usage_change",
        kind: "usage_change",
        value: label,
        date: issueDate,
        mileage,
        mileageKm: mileage,
      },
    });
  }

  for (const row of arr(detail.seriousTypes)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const label =
      translateEncarCodeTitle({
        code: str(rec.code) ?? (typeof rec.code === "number" ? String(rec.code) : undefined),
        title: title(rec),
      }) ?? title(rec);
    if (!label || /none|없음|n\/a/i.test(label)) continue;
    events.push({
      eventType: "other",
      description: `Serious defect noted on performance inspection: ${label}${issueDate ? ` (${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        field: "serious_defect",
        kind: "serious_defect",
        value: label,
        date: issueDate,
        mileage,
        mileageKm: mileage,
      },
    });
  }

  // Vehicle condition / dates / mileage / comments live on the single inspection
  // summary above — do not emit one `other` row per field.

  if (waterlog) {
    events.push({
      eventType: "flood_damage",
      description: `Flood/water damage flagged on Korean performance inspection${issueDate ? ` (${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        waterlog: true,
        mileage,
        mileageKm: mileage,
        date: issueDate,
      },
    });
  }

  if (accidentFlagged) {
    events.push({
      eventType: "accident",
      description: `Accident history flagged on Korean performance inspection${issueDate ? ` (${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        accidentFlagged: true,
        mileage,
        mileageKm: mileage,
        date: issueDate,
        condition: "Accident history flagged on performance inspection",
      },
    });
  }

  // Outer-panel-only repair flag → damages (not extras / not diagram-only).
  if (simpleRepair) {
    events.push({
      eventType: "accident",
      description: `Simple outer-panel repair flagged on Korean performance inspection${issueDate ? ` (${issueDate})` : ""}`,
      occurredAt,
      metadata: {
        source: "encar_inspection",
        simpleRepair: true,
        mileage,
        mileageKm: mileage,
        date: issueDate,
        condition: "Simple outer-panel repair",
        damage: "Simple outer-panel repair",
      },
    });
  }

  const panels = collectInspectionPanels(inspection);
  if (panels.length > 0) {
    const structuredPanels = panels
      .map((p) => {
        const legend = bodyConditionLegendFromStatus(undefined, p.status);
        if (!legend) return null;
        return {
          key: p.key,
          label: p.panel,
          result: p.status,
          legend,
          legendLabel:
            ({
              Z: "Replacement",
              W: "Painting/Welding",
              R: "Rust",
              C: "Scratch",
              N: "Unevenness",
              P: "Damage",
            } as const)[legend],
          area: p.area,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const findingsText = panels.map((p) => `${p.panel}: ${p.status}`).join("; ");
    const summary = events.find(
      (e) =>
        e.eventType === "inspection" &&
        (e.metadata as Record<string, unknown> | undefined)?.source === "encar_inspection",
    );
    if (summary) {
      // Fold panel findings into the same-date inspection summary (one timeline row).
      summary.description = `${summary.description} — findings: ${findingsText}`;
      const meta = (summary.metadata ?? {}) as Record<string, unknown>;
      meta.panels = structuredPanels.length ? structuredPanels : panels;
      meta.bodyCondition = structuredPanels.length > 0 ? true : undefined;
      summary.metadata = meta;
    } else {
      events.push({
        eventType: "inspection",
        description: `Inspection findings — ${findingsText}`,
        occurredAt,
        metadata: {
          source: "encar_inspection_panels",
          panels: structuredPanels.length ? structuredPanels : panels,
          date: issueDate,
          bodyCondition: structuredPanels.length > 0 ? true : undefined,
        },
      });
    }
  }

  return events;
}

/** Skip empty / "없음" noise; keep Good/Defective/Replacement/etc. */
function isMeaningfulInspectionStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  if (!s) return false;
  if (s === "none" || s === "n/a" || s === "not applicable" || s === "absent") return false;
  return true;
}

function collectInspectionPanels(
  inspection: Record<string, unknown>,
): Array<{ panel: string; status: string; area?: string; key?: string }> {
  const notes: Array<{ panel: string; status: string; area?: string; key?: string }> = [];
  for (const key of ["outers", "inners"] as const) {
    walkInspectionNodes(arr(inspection[key]), notes, key === "inners" ? "interior" : "exterior");
  }
  return notes;
}

function walkInspectionNodes(
  nodes: unknown[],
  notes: Array<{ panel: string; status: string; area?: string; key?: string }>,
  area?: string,
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as Record<string, unknown>;
    const rawTitle = title(row.type);
    const titleText = (translateEncarInspectionPanel(rawTitle) ?? rawTitle ?? "")
      .replace(/\(\s*\)/g, "")
      .replace(/[\/|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const status = normalizeEncarInspectionStatus(title(row.statusType));

    const junkTitle =
      !titleText ||
      titleText.length < 2 ||
      /^[\s():.\-/\\]+$/.test(titleText) ||
      /^(none|n\/a|null|undefined)$/i.test(titleText);

    if (!junkTitle && status && isMeaningfulInspectionStatus(status) && status !== "Good" && status !== "Normal") {
      notes.push({
        panel: titleText,
        status,
        area,
        key: guessPanelKey(titleText),
      });
    }
    walkInspectionNodes(arr(row.children), notes, area);
  }
}

function formatEncarDate(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return undefined;
}

function slugField(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "panel";
}

function buildDiagnosisSummaryEnglish(
  replacements: string[],
  comments: string[],
): string {
  const parts: string[] = [];

  if (replacements.length > 0) {
    parts.push(
      `Encar diagnosis: ${replacements.join(", ")} replaced. Frame structure: all normal. Classified as outer-panel replacement only.`,
    );
  }

  const translatedComments = comments
    .map((c) => translateEncarComment(c))
    .filter((c): c is string => !!c && !containsHangul(c));

  if (translatedComments.length > 0) {
    parts.push(translatedComments.join(" / "));
  } else if (parts.length === 0) {
    parts.push("Encar diagnosis notes available (see panel list).");
  }

  return parts.join(" / ");
}

function parseDate(raw?: string | null): Date {
  if (!raw) return new Date(0); // epoch = unknown; never pretend "today"
  const normalized =
    raw.length === 8 && /^\d+$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
      : formatEncarDate(raw) ?? raw;
  // Noon UTC keeps the calendar day stable across timezones (no off-by-one).
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}T12:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}$/.test(normalized)) {
    return new Date(`${normalized}-01T12:00:00.000Z`);
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function title(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const titleValue = (value as Record<string, unknown>).title;
  return typeof titleValue === "string" ? titleValue.trim() : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function summarizeEncarRecord(record: Record<string, unknown> | null | undefined): string | undefined {
  if (!record) return undefined;
  const maker = normalizeEncarMaker(str(record.maker));
  const fuel = normalizeEncarFuel({ fuelName: str(record.fuel) });
  const model = str(record.model);
  const year = str(record.year);
  return [year, maker, model, fuel].filter(Boolean).join(" ");
}

/**
 * Formerly dropped dated Encar claims with ₩0 costs. Those dates are real
 * registry rows — keep them. Always returns false (kept for call-site compat).
 */
export function isEmptyInsuranceAccidentEvent(_event: {
  eventType?: string | null;
  description?: string | null;
  metadata?: string | Record<string, unknown> | null;
}): boolean {
  return false;
}
