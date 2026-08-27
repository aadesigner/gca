process.env.IMPORT_MOTOR_CDP_URL = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
process.env.IMPORT_MOTOR_CDP_TABS = "10";
const env = await (await import("fs")).promises.readFile("../../.env","utf8");
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { importMotorGetViaCdp } = await import("./dist/index.mjs").catch(()=>({}));
// dist may not export it - call via dynamic path
