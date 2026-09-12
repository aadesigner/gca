/**
 * Run with: DATABASE_URL=postgres://localhost/test pnpm dlx tsx src/lib/__tests__/encar-accidents.test.ts
 */
import { extractEncarEvents } from "../providers/encar-history";
import { buildAccidentTable, isAccidentEvent } from "../accidents";

let passed = 0;
let failed = 0;

function assert(value: boolean, message: string): void {
  if (value) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log("\n=== Encar dated stubs + registry totals ===");
{
  const events = extractEncarEvents({
    record: {
      openData: true,
      myAccidentCnt: 1,
      otherAccidentCnt: 0,
      myAccidentCost: 1_200_000,
      otherAccidentCost: 0,
      accidents: [
        {
          type: "내차피해",
          date: "20210315",
          partCost: 0,
          laborCost: 0,
          paintingCost: 0,
          insuranceBenefit: 0,
        },
      ],
    },
  });
  const accidents = events.filter((e) => e.eventType === "accident");
  assert(accidents.length === 2, "keeps dated stub + emits summary totals");
  const dated = accidents.find((e) => String((e.metadata as { date?: string } | undefined)?.date ?? "").includes("2021"));
  assert(!!dated, "dated claim kept");
  assert(
    /Own-vehicle damage|Insurance claim/.test(String(dated?.description ?? "")),
    "category translated in description",
  );
  const summary = accidents.find(
    (e) => (e.metadata as { source?: string } | undefined)?.source === "encar_record_summary",
  );
  assert(!!summary, "summary emitted when stubs have no money");
  assert(
    (summary?.metadata as { myAccidentCost?: number } | undefined)?.myAccidentCost === 1_200_000,
    "summary keeps myAccidentCost",
  );
  const rows = buildAccidentTable(accidents);
  assert(rows.length === 2, "buildAccidentTable keeps both rows");
  assert(
    rows.some((r) => r.myAccidentCost === 1_200_000),
    "summary myAccidentCost projected",
  );
}

console.log("\n=== Encar part/labor/paint breakdown ===");
{
  const events = extractEncarEvents({
    record: {
      openData: true,
      myAccidentCost: 1_100_000,
      otherAccidentCost: 0,
      accidents: [
        {
          type: "내차피해",
          date: "20220401",
          partCost: 800_000,
          laborCost: 200_000,
          paintingCost: 100_000,
          insuranceBenefit: 900_000,
        },
      ],
    },
  });
  const accidents = events.filter((e) => e.eventType === "accident");
  assert(accidents.length === 1, "no duplicate summary when monetary detail exists");
  const meta = accidents[0]?.metadata as Record<string, unknown>;
  assert(meta?.partCost === 800_000, "partCost stored");
  assert(meta?.laborCost === 200_000, "laborCost stored");
  assert(meta?.paintingCost === 100_000, "paintingCost stored");
  assert(meta?.type === "Own-vehicle damage", "type translated");
  const rows = buildAccidentTable(accidents);
  assert(rows[0]?.partCost === 800_000, "partCost on AccidentRow");
  assert(rows[0]?.repairTotal === 1_100_000, "repairTotal summed");
  assert(rows[0]?.insuranceBenefit === 900_000, "insuranceBenefit on AccidentRow");
  assert(rows[0]?.category === "Own-vehicle damage", "category translated on row");
}

console.log("\n=== total_loss in accidents ===");
{
  const events = extractEncarEvents({
    record: {
      openData: true,
      totalLossCnt: 1,
      totalLossDate: "20190501",
    },
  });
  const loss = events.find((e) => e.eventType === "total_loss");
  assert(!!loss, "total_loss event extracted");
  assert(isAccidentEvent(loss!), "total_loss is accident-category");
  const rows = buildAccidentTable([loss!]);
  assert(rows.length === 1 && rows[0]?.category === "total_loss", "total_loss category on row");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
