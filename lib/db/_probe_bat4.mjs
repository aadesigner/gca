import { writeFileSync } from "fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const page = await fetch("https://bringatrailer.com/auctions/results/", {
  headers: { "User-Agent": UA },
});
const html = await page.text();
const bat = JSON.parse(html.match(/var BaT_Theme = (\{.*?\});/s)?.[1] ?? "{}");
console.log(
  Object.fromEntries(
    Object.entries(bat).filter(([k]) => /auction|result|ajaxUrl|nonce|page/i.test(k)),
  ),
);
writeFileSync("_bat_theme.json", JSON.stringify(bat, null, 2));

const ajaxUrl = bat.ajaxurl || bat.ajaxUrl || "https://bringatrailer.com/wp-admin/admin-ajax.php";
console.log("ajaxUrl", ajaxUrl);

async function tryPost(params) {
  const body = new URLSearchParams(params);
  const r = await fetch(ajaxUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://bringatrailer.com/auctions/results/",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  const t = await r.text();
  let parsed = null;
  try {
    parsed = JSON.parse(t);
  } catch {
    /* ignore */
  }
  const keys = parsed && typeof parsed === "object" ? Object.keys(parsed) : null;
  const items = parsed?.data?.items || parsed?.items || parsed?.data?.listings || parsed?.html;
  const itemCount = Array.isArray(items)
    ? items.length
    : typeof items === "string"
      ? (items.match(/listing\//g) || []).length
      : null;
  console.log({
    params,
    status: r.status,
    len: t.length,
    keys,
    success: parsed?.success,
    itemCount,
    sample: typeof t === "string" ? t.slice(0, 180).replace(/\s+/g, " ") : null,
  });
  return parsed;
}

const action = bat.ajaxActionAuctionsResults || "bat_auctions_results";

for (const params of [
  { action, page: "1" },
  { action, page: "2" },
  { action, paged: "2" },
  { action, page: "2", status: "results" },
  { action, page: "2", auction_status: "results" },
  { action, page: "2", type: "results" },
  { action, page: "2", keyword: "", make: "", model: "" },
]) {
  await tryPost(params);
}
