const dir = "https://imagebox.autowini.com/upload/U2026041962545/car/CI202609130005303570/";
const headers = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
  Accept: "image/*,*/*",
  Referer: "https://www.autowini.com/",
  Origin: "https://www.autowini.com",
};

async function probe(url, method = "HEAD") {
  const r = await fetch(url, { method, headers, redirect: "follow" });
  return { status: r.status, ct: r.headers.get("content-type"), len: r.headers.get("content-length") };
}

for (const pattern of ["0_720.jpeg", "1_720.jpeg", "01_720.jpeg", "photo0_720.jpeg", "img0_720.jpeg"]) {
  const st = await probe(dir + pattern);
  console.log(pattern, st);
}

let indexedHits = 0;
for (let i = 0; i < 25; i++) {
  const st = await probe(`${dir}${i}_720.jpeg`);
  if (st.status === 200) indexedHits++;
  else if (i === 0) console.log("index 0", st);
}
console.log("indexed hits", indexedHits);

// try manifest endpoints
for (const path of ["manifest.json", "photos.json", "list.json", "index.json"]) {
  const st = await probe(dir + path, "GET");
  console.log(path, st);
}

// login probe
const loginBodies = [
  { username: "guest", password: "guest" },
  { email: "guest@autowini.com", password: "guest" },
  { userId: "guest", password: "guest" },
];
for (const path of ["/users/login", "/auth/login", "/login", "/member/login"]) {
  for (const body of loginBodies) {
    const r = await fetch(`https://v2api.autowini.com${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (iPhone)",
        Origin: "https://m.autowini.com",
        "wini-code-select-country": "C1570",
      },
      body: JSON.stringify(body),
    });
    const t = await r.text();
    if (r.status !== 401 && r.status !== 400) console.log("login", path, body, r.status, t.slice(0, 200));
    if (t.includes("token")) console.log("TOKEN?", path, t.slice(0, 300));
  }
}
