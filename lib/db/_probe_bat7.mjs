const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

async function page(n, per = 45) {
  const url = `https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter?page=${n}&per_page=${per}&get_items=1&get_stats=0`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  const data = await r.json();
  const items = data.items || [];
  const sample = items[0] ? Object.keys(items[0]) : [];
  const urls = items.slice(0, 3).map((it) => ({
    url: it.url || it.permalink || it.link,
    slug: it.slug || it.post_name,
    id: it.id || it.ID,
    title: it.title,
  }));
  console.log({
    status: r.status,
    page: data.page_current,
    pages: data.pages_total,
    total: data.items_total,
    per: data.items_per_page,
    count: items.length,
    keys: sample,
    urls,
  });
  return data;
}

const p1 = await page(1);
const p2 = await page(2);
const set1 = new Set((p1.items || []).map((i) => i.url || i.permalink || i.slug || i.id));
const set2 = new Set((p2.items || []).map((i) => i.url || i.permalink || i.slug || i.id));
let overlap = 0;
for (const x of set2) if (set1.has(x)) overlap++;
console.log("overlap p1/p2", overlap, "p2only", set2.size - overlap);

await page(1, 100);
await page(50, 45);
