import pg from "pg";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { buildBodyCondition } = await import(
  pathToFileURL(path.resolve("artifacts/api-server/src/lib/body-condition.ts")).href
);
const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();

const vins = [
  "WBS3C910XFP708160",
  "WDDUX8GB8JA397509",
  "ZAM57XSA4E1123233",
  "WDDUF3DB4GA267276",
  "WBA21FJ06TCX16053",
  "LGXCE4CB9S2012502",
  "YV1UZL121P1393787",
];

for (const vin of vins) {
  const v = (await c.query(`SELECT id, make, model, year FROM vehicles WHERE vin=$1`, [vin])).rows[0];
  if (!v) {
    console.log({ vin, missing: true });
    continue;
  }
  const events = (
    await c.query(
      `SELECT event_type AS "eventType", description, occurred_at AS "occurredAt", metadata
       FROM vehicle_events WHERE vehicle_id=$1`,
      [v.id],
    )
  ).rows.map((e) => ({
    ...e,
    metadata: e.metadata ? JSON.parse(e.metadata) : null,
  }));

  const diag = events.filter((e) => e.metadata?.source === "encar_diagnosis" || e.metadata?.source === "encar_inspection_panels");
  const bc = buildBodyCondition(events);
  console.log(
    JSON.stringify(
      {
        vin,
        car: `${v.make} ${v.model} ${v.year}`,
        diagEvents: diag.length,
        panels: bc?.panels?.length ?? 0,
        date: bc?.date ?? null,
        sample: (bc?.panels ?? []).slice(0, 8).map((p) => `${p.legend}:${p.label}[${p.key || ""}]`),
        rawPanelSnippets: diag.slice(0, 2).map((e) => ({
          source: e.metadata?.source,
          panels: Array.isArray(e.metadata?.panels)
            ? e.metadata.panels.slice(0, 4)
            : e.metadata?.panels,
          desc: String(e.description || "").slice(0, 100),
        })),
      },
      null,
      2,
    ),
  );
}
await c.end();
