const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const tabs = await (await fetch(`${CDP}/json/list`)).json();
console.log("tabs", tabs.length);
const byType = {};
for (const t of tabs) byType[t.type] = (byType[t.type] || 0) + 1;
console.log(byType);

const close = process.argv.includes("--close-stale");
let closed = 0;
if (close) {
  for (const t of tabs) {
    if (t.type !== "page") continue;
    const url = String(t.url || "");
    const keep =
      url.startsWith("chrome://") ||
      url.startsWith("devtools://") ||
      url === "about:blank" ||
      /localhost|127\.0\.0\.1/.test(url);
    // Close crawler leftovers (IM/AP/JCT/etc.) so the pool can recreate clean tabs.
    if (!keep && t.id) {
      try {
        await fetch(`${CDP}/json/close/${t.id}`);
        closed += 1;
      } catch {
        /* ignore */
      }
    }
  }
}
console.log(JSON.stringify({ closed }, null, 2));
