const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const keep = 2;
const pages = await fetch(`${CDP}/json/list`).then((r) => r.json());
const im = (pages || []).filter(
  (p) => p.type === "page" && /import-motor\.com/i.test(p.url || ""),
);
const extra = im.slice(keep);
for (const p of extra) {
  await fetch(`${CDP}/json/close/${p.id}`).catch(() => null);
}
const after = await fetch(`${CDP}/json/list`).then((r) => r.json());
console.log({
  closed: extra.length,
  pagesLeft: (after || []).filter((p) => p.type === "page").length,
});
