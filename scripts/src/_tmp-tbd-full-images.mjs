const url = process.argv[2];
const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
const all = [
  ...html.matchAll(/https:\\\/\\\/cdn\.thebidrive\.com[^"\\]+/g),
  ...html.matchAll(/https:\/\/cdn\.thebidrive\.com[^"'\\\s>]+/gi),
].map((m) => m[0].replace(/\\\//g, "/"));
console.log("total cdn refs", all.length, [...new Set(all)].slice(0, 20));
const photoFields = [...html.matchAll(/"photos?":\[/gi)].length;
console.log("photo json arrays", photoFields);
