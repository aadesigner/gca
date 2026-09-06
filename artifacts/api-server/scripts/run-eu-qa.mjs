import * as esbuild from "esbuild";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(__dirname, "eu-provider-qa.mjs");

await esbuild.build({
  entryPoints: [path.join(__dirname, "eu-provider-qa.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  packages: "external",
});

const child = spawn(process.execPath, [outfile], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
