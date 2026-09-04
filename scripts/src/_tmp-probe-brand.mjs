import fs from "fs";
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const pages = await fetch(`${CDP}/json/list`).then(r=>r.json()).catch(()=>[]);
const page = (pages||[]).find(p=>p.type==="page");
if (!page?.webSocketDebuggerUrl) { console.log("no page target"); process.exit(0); }
const WS = globalThis.WebSocket;
const ws = new WS(page.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ ws.addEventListener("open",res); ws.addEventListener("error",e=>rej(e.error||e)); });
let id=1;
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const i=id++; const t=setTimeout(()=>reject(new Error("timeout "+method)),20000);
  const onMsg=(ev)=>{ const msg=JSON.parse(ev.data); if(msg.id!==i) return; clearTimeout(t); ws.removeEventListener("message",onMsg); if(msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result); };
  ws.addEventListener("message",onMsg); ws.send(JSON.stringify({id:i,method,params}));
});
await send("Page.enable");
await send("Page.navigate",{url:"https://import-motor.com/audi"});
await new Promise(r=>setTimeout(r,4000));
const {result} = await send("Runtime.evaluate",{expression:"document.documentElement.outerHTML",returnByValue:true});
const html = String(result?.value||"");
fs.writeFileSync("scripts/.im-audi-sample.html", html.slice(0,200000));
const vins = [...html.matchAll(/\/v\/([A-HJ-NPR-Z0-9]{17})/gi)].map(m=>m[1].toUpperCase());
const next = [...html.matchAll(/href="([^"]*page=\d+[^"]*)"|rel="next"|Next/gi)].slice(0,10).map(m=>m[0]);
const pagination = html.match(/Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)/i);
console.log({htmlLen:html.length, uniqueVins:new Set(vins).size, sampleVins:vins.slice(0,5), pagination, nextHints:next.slice(0,5)});
// find brand links in nav
const brands=[...html.matchAll(/href="https?:\/\/import-motor\.com\/([a-z0-9-]+)"/gi)].map(m=>m[1]);
console.log("brand-like hrefs sample", [...new Set(brands)].filter(b=>!['v','buyer-locations','login','register','about','contact','faq'].includes(b)).slice(0,40));
ws.close();
