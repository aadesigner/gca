const PROD = process.env.PROD_API_URL || "https://getcarapi.com";
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

async function login() {
  const res = await fetch(`${PROD}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

const cookie = await login();
for (const st of ["running", "pending", "failed"]) {
  const r = await fetch(`${PROD}/api/admin/jobs?status=${st}&limit=25`, { headers: { Cookie: cookie } });
  const b = await r.json();
  console.log(`\n${st.toUpperCase()} (${b.total ?? "?"}):`);
  for (const j of b.items ?? []) {
    console.log(
      `  #${j.id} ${j.providerName} type=${j.jobType} pages=${j.pagesProcessed} listings=${j.listingsFetched ?? j.itemsProcessed} vins=${j.vinsFound}${j.errorMessage ? ` ERR=${j.errorMessage.slice(0, 60)}` : ""}`,
    );
  }
}

const mirror = await fetch(`${PROD}/api/admin/photos/mirror-status`, { headers: { Cookie: cookie } });
console.log("\nMirror:", await mirror.text());
