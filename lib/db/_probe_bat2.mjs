const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const r = await fetch("https://bringatrailer.com/auctions/results/", {
  headers: { "User-Agent": UA },
});
const t = await r.text();

// Find script srcs that look like bat/knockout
const scripts = [...t.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
console.log(
  "scripts",
  scripts.filter((s) => /bat|auction|knock|listing|results/i.test(s)).slice(0, 30),
);

// Inline config
for (const pat of [
  /admin-ajax\.php[^"']*/g,
  /bat_[a-z_]+/gi,
  /loadNextPage[^;]{0,200}/g,
  /auctions\/results[^"']{0,80}/g,
  /"page"\s*:\s*\d+/g,
  /apiUrl[^,]{0,80}/g,
  /listingsUrl[^,]{0,80}/g,
]) {
  const hits = [...t.matchAll(pat)].slice(0, 10).map((m) => m[0]);
  if (hits.length) console.log(pat.source.slice(0, 40), hits);
}

// Try common ajax actions
const actions = [
  "bat_action_ajax_get_results",
  "bat_action_ajax_listings",
  "bat_get_listings",
  "get_results",
  "bat_action_ajax_search",
];
for (const action of actions) {
  const body = new URLSearchParams({ action, page: "2", paged: "2" });
  const ar = await fetch("https://bringatrailer.com/wp-admin/admin-ajax.php", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const at = await ar.text();
  console.log("ajax", action, ar.status, at.slice(0, 120).replace(/\s+/g, " "));
}
