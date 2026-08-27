const tabs = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = tabs.find(t => t.type==="page" && t.webSocketDebuggerUrl);
if (!page) { console.log("no_page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id=1; const pending=new Map();
function send(method, params={}, timeout=20000){
  const mid=id++;
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>{pending.delete(mid);reject(new Error(method+" to"));},timeout);
    pending.set(mid,{resolve,reject,t});
    ws.send(JSON.stringify({id:mid,method,params}));
  });
}
ws.onmessage=(ev)=>{
  const msg=JSON.parse(ev.data);
  if(msg.id==null) return;
  const p=pending.get(msg.id); if(!p) return; clearTimeout(p.t); pending.delete(msg.id);
  if(msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
};
await new Promise((r,j)=>{ws.onopen=r; ws.onerror=()=>j(new Error("fail")); setTimeout(()=>j(new Error("open")),5000);});
await send("Page.enable");
await send("Page.navigate", { url: "https://import-motor.com/buyer-locations" });
await new Promise(r=>setTimeout(r,8000));
const {result} = await send("Runtime.evaluate", { expression: `({title:document.title, html:document.documentElement.outerHTML.slice(0,200000), cf:/just a moment|cloudflare/i.test(document.title+document.body?.innerText||"")})`, returnByValue:true }, 30000);
const v = result.value;
console.log({title:v.title, cf:v.cf, len:v.html?.length});
const codes=[...v.html.matchAll(/\/buyer-locations\/([a-z]{2})(?:["/?#]|$)/gi)].map(m=>m[1].toLowerCase());
const uniq=[...new Set(codes)].filter(cc=>/^[a-z]{2}$/.test(cc)).sort();
console.log("countries", uniq.length, uniq.join(","));
ws.close();
