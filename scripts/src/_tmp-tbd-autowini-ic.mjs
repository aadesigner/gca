const url = process.argv[2];
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const autowini = [...html.matchAll(/autowini\.com\/items\/[^"\\]+-(IC\d{7})/gi)].map((m) => m[1]);
const encar = [...html.matchAll(/cdn\.thebidrive\.com\/encar\/(\d{5,})\//gi)].map((m) => m[1]);
const lot = [...html.matchAll(/cdn\.thebidrive\.com\/(?:lots?|auctions?)\/([a-f0-9-]{36})\//gi)].map((m) => m[1]);
console.log(JSON.stringify({ autowiniIc: [...new Set(autowini)], encarIds: [...new Set(encar)], lotUuids: [...new Set(lot)] }, null, 2));
