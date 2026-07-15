// 下载 PocketBase 官方二进制并按 Tauri sidecar 命名规则(带 target triple)放入 src-tauri/binaries/
import { execSync } from "node:child_process";
import { mkdirSync, createWriteStream, existsSync, chmodSync, renameSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PB_VERSION = "0.30.0"; // 固定版本，升级需同步改这里
const triple = execSync("rustc -Vv").toString().match(/host: (\S+)/)[1];
const isWin = triple.includes("windows");
const platform = isWin ? "windows" : triple.includes("darwin") ? "darwin" : "linux";
const arch = triple.startsWith("aarch64") ? "arm64" : "amd64";
const zipName = `pocketbase_${PB_VERSION}_${platform}_${arch}.zip`;
const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${zipName}`;

const outDir = "src-tauri/binaries";
mkdirSync(outDir, { recursive: true });
const outBin = `${outDir}/pocketbase-${triple}${isWin ? ".exe" : ""}`;
if (existsSync(outBin)) { console.log("已存在:", outBin); process.exit(0); }

const zipPath = `${outDir}/${zipName}`;
console.log("下载", url);
const res = await fetch(url);
if (!res.ok) throw new Error(`下载失败 ${res.status}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));

// 解压：Windows 用 PowerShell Expand-Archive（原生支持 ZIP），其余用 unzip
const absZip = `${process.cwd()}/${zipPath}`.replace(/\//g, "\\");
const absDest = `${process.cwd()}/${outDir}`.replace(/\//g, "\\");
if (isWin) {
  execSync(`powershell -Command "Expand-Archive -LiteralPath '${absZip}' -DestinationPath '${absDest}' -Force"`, { stdio: "inherit" });
} else {
  execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: "inherit" });
}
const extracted = `${outDir}/pocketbase${isWin ? ".exe" : ""}`;
renameSync(extracted, outBin);
if (!isWin) chmodSync(outBin, 0o755);
console.log("就绪:", outBin);
