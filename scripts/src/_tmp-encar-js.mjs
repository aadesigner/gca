const headers = { "User-Agent": "Mozilla/5.0", Accept: "*/*", Referer: "https://fem.encar.com/" };
const js = await (await fetch("https://fem.encar.com/assets/index-CacQRcEP.js", { headers, signal: AbortSignal.timeout(30000) })).text();
console.log("js len", js.length);
const hits = [...js.matchAll(/readside\/[a-zA-Z0-9_\/${}]+/g)].map(m=>m[0]);
console.log([...new Set(hits)].sort().join("\n"));
const mile = [...js.matchAll(/[a-zA-Z0-9_\/]{0,40}(mileage|Mileage|odo|recall|Recall|carhistory|보험|주행)[a-zA-Z0-9_\/]{0,40}/g)].map(m=>m[0]);
console.log("mile-ish", [...new Set(mile)].slice(0,50));
