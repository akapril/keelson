// script-command.ts —— 脚本文件路径 → 启动命令（纯函数，跨平台可测）。
//
// 「选脚本」选中文件后，按扩展名生成一条可编辑命令填进命令框，并把 cwd 默认设为脚本目录。
// 命令仅作起点，用户可在命令框继续加参数；平台差异（如 Windows 的 .sh 需 bash）由用户按需纠正。

/** 生成结果：命令文本 + 脚本所在目录（作为默认 cwd）。 */
export interface ScriptCommand {
  command: string;
  cwd: string;
}

/** 取路径的父目录（同时兼容 `/` 与 `\`；无分隔符则返回空串）。 */
export function dirnameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : "";
}

/** 取小写扩展名（不含点；无扩展名返回空串）。 */
function extOf(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** 路径加双引号（含空格的路径需要），内部不做转义——本机用户自选路径，命令框可编辑。 */
function quote(path: string): string {
  return `"${path}"`;
}

/**
 * 脚本路径 → 命令 + cwd。
 * @param path 脚本绝对路径
 * @param isWindows 是否 Windows（影响 .sh 的解释器：unix 用 sh，windows 用 bash）
 */
export function scriptToCommand(path: string, isWindows: boolean): ScriptCommand {
  const q = quote(path);
  const ext = extOf(path);
  let command: string;
  switch (ext) {
    case "sh":
    case "bash":
      // unix 用 sh；Windows 无原生 sh，用 bash（git-bash/wsl，需在 PATH）。
      command = isWindows ? `bash ${q}` : `sh ${q}`;
      break;
    case "ps1":
      command = `pwsh -File ${q}`;
      break;
    case "js":
    case "mjs":
    case "cjs":
      command = `node ${q}`;
      break;
    case "py":
      command = `python ${q}`;
      break;
    case "rb":
      command = `ruby ${q}`;
      break;
    case "bat":
    case "cmd":
      // Windows 批处理：直接执行。
      command = q;
      break;
    default:
      // 可执行文件或未知类型：直接执行路径。
      command = q;
      break;
  }
  return { command, cwd: dirnameOf(path) };
}
