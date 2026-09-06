const html = await (await fetch("https://getcarapi.com/adminz/")).text();
console.log("adminz status html len", html.length);
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log("scripts", scripts);
for (const s of scripts.slice(0, 5)) {
  const url = s.startsWith("http") ? s : new URL(s, "https://getcarapi.com/adminz/").href;
  const js = await (await fetch(url)).text();
  console.log({
    url,
    len: js.length,
    supportTicketsPath: js.includes("support-tickets"),
    supportLabel: js.includes("Support tickets"),
    adminSupportApi: js.includes("/admin/support/tickets"),
    supportInbox: js.includes("Select a ticket"),
  });
}
