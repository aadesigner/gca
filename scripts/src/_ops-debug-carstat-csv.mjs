import fs from "node:fs";

const input =
  "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/vin-catalog-2026-10-28.csv";

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const lines = raw.split("\n").filter((l) => l.trim());
const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
const photoIdx = header.indexOf("photos");
const counts = {};
let sampleBad = null;
let encarHits = 0;
let anyHttp = 0;
for (const line of lines.slice(1)) {
  const cols = parseCsvLine(line);
  counts[cols.length] = (counts[cols.length] || 0) + 1;
  const photos = cols[photoIdx] || "";
  if (/encar\.com/i.test(photos)) encarHits++;
  if (/https?:\/\//i.test(photos)) anyHttp++;
  if (!sampleBad && cols.length !== header.length) {
    sampleBad = { cols: cols.length, vin: cols[1], photos: String(photos).slice(0, 80) };
  }
}
console.log(
  JSON.stringify(
    {
      headerLen: header.length,
      photoIdx,
      photoHeader: header[photoIdx],
      colCounts: counts,
      encarHits,
      anyHttp,
      rows: lines.length - 1,
      sampleBad,
      row1Photos: String(parseCsvLine(lines[1])[photoIdx] || "").slice(0, 100),
    },
    null,
    2,
  ),
);
