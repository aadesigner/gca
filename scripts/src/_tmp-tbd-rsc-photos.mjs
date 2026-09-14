const url = process.argv[2];
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const m = html.match(/"photos":\{"primaryUrl"[^}]+\}/);
console.log(m?.[0] ?? "no match");
const m2 = html.match(/\\"photos\\":\{\\"primaryUrl\\"[^}]+\}/);
console.log(m2?.[0] ?? "no escaped match");
