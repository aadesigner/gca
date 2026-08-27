const CDP_URL = "http://127.0.0.1:9222";
const vin = "1GCWGAFP6M1174039";
const pageUrl = "https://import-motor.com/v/" + vin;
const targets = await (await fetch(CDP_URL + "/json/list")).json();
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = id++;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
await send("Page.enable");
await send("Page.navigate", { url: pageUrl });
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 400));
  const out = await send("Runtime.evaluate", {
    expression: "({href:location.href,len:(document.body&&document.body.innerText||'').length})",
    returnByValue: true,
  });
  if (String(out.result.value.href).includes(vin) && out.result.value.len > 800) break;
}
const htmlOut = await send("Runtime.evaluate", {
  expression: "document.documentElement.outerHTML",
  returnByValue: true,
});
const { writeFileSync } = await import("fs");
writeFileSync("_im_chevy.html", htmlOut.result.value);
const meta = await send("Runtime.evaluate", {
  expression: `(() => {
    const text = document.body.innerText || "";
    function pick(label) {
      const idx = text.toLowerCase().indexOf(label.toLowerCase());
      if (idx < 0) return null;
      const after = text.slice(idx + label.length).trim();
      return after.split(/\\n/)[0].trim().slice(0, 80) || null;
    }
    return {
      href: location.href,
      h1: (document.querySelector("h1")||{}).innerText || "",
      vehicleTitle: pick("Vehicle title"),
      detailedTitle: pick("Detailed title"),
      odometer: pick("Odometer"),
      brand: pick("Brand"),
      model: pick("Model"),
      snip: text.slice(0, 1400),
    };
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(meta.result.value, null, 2));
ws.close();
