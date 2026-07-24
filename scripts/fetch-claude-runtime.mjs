// 把 claude-runtime 可执行文件按 Tauri sidecar 命名规则(带 target triple)放入 src-tauri/binaries/
// claude-runtime 暂无公开 release，故从本地已安装处拷贝（开发者需先 `cargo install claude-runtime`
// 或 `cargo install --path <claude-runtime>/crates/cli`）。幂等：binaries/ 已有则跳过。
// 目的：最终用户装 rework 安装包即内置 daemon，零额外安装。
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, copyFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const triple = execSync("rustc -Vv").toString().match(/host: (\S+)/)[1];
const isWin = triple.includes("windows");
const ext = isWin ? ".exe" : "";
const binName = `claude-runtime${ext}`;

const outDir = "src-tauri/binaries";
mkdirSync(outDir, { recursive: true });
const outBin = `${outDir}/claude-runtime-${triple}${ext}`;
if (existsSync(outBin)) {
  console.log("已存在:", outBin);
  process.exit(0);
}

/** 依次尝试定位已安装的 claude-runtime：PATH → ~/.cargo/bin。 */
function locateSource() {
  // 1) PATH（where/which）
  try {
    const cmd = isWin ? `where ${binName}` : `which claude-runtime`;
    const found = execSync(cmd).toString().split(/\r?\n/)[0].trim();
    if (found && existsSync(found)) return found;
  } catch {
    // 未在 PATH，继续
  }
  // 2) ~/.cargo/bin
  const cargoBin = join(homedir(), ".cargo", "bin", binName);
  if (existsSync(cargoBin)) return cargoBin;
  return null;
}

const src = locateSource();
if (!src) {
  console.error(
    [
      "找不到 claude-runtime 可执行文件。请先安装（任一）：",
      "  cargo install claude-runtime",
      "  cargo install --path <claude-runtime>/crates/cli",
      `然后重试，或手动把二进制放到 ${outBin}`,
    ].join("\n"),
  );
  process.exit(1);
}

copyFileSync(src, outBin);
if (!isWin) chmodSync(outBin, 0o755);
console.log("就绪:", outBin, "(源:", src + ")");
