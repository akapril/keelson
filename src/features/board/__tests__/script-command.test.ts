import { describe, it, expect } from "vitest";
import { scriptToCommand, dirnameOf } from "../script-command";

describe("dirnameOf", () => {
  it("兼容 / 与 \\ 分隔符", () => {
    expect(dirnameOf("/home/u/proj/deploy.sh")).toBe("/home/u/proj");
    expect(dirnameOf("C:\\work\\proj\\run.ps1")).toBe("C:\\work\\proj");
  });
  it("无目录 → 空串", () => {
    expect(dirnameOf("deploy.sh")).toBe("");
  });
});

describe("scriptToCommand", () => {
  it(".sh：unix 用 sh，windows 用 bash", () => {
    expect(scriptToCommand("/p/x.sh", false).command).toBe('sh "/p/x.sh"');
    expect(scriptToCommand("C:\\p\\x.sh", true).command).toBe('bash "C:\\p\\x.sh"');
  });
  it(".ps1 → pwsh -File", () => {
    expect(scriptToCommand("/p/x.ps1", false).command).toBe('pwsh -File "/p/x.ps1"');
  });
  it(".js/.mjs/.cjs → node", () => {
    expect(scriptToCommand("/p/a.js", false).command).toBe('node "/p/a.js"');
    expect(scriptToCommand("/p/a.mjs", false).command).toBe('node "/p/a.mjs"');
  });
  it(".py → python，.rb → ruby", () => {
    expect(scriptToCommand("/p/a.py", false).command).toBe('python "/p/a.py"');
    expect(scriptToCommand("/p/a.rb", false).command).toBe('ruby "/p/a.rb"');
  });
  it(".bat/.cmd 与未知/可执行 → 直接路径", () => {
    expect(scriptToCommand("C:\\p\\go.bat", true).command).toBe('"C:\\p\\go.bat"');
    expect(scriptToCommand("/p/tool", false).command).toBe('"/p/tool"');
  });
  it("cwd = 脚本所在目录", () => {
    expect(scriptToCommand("/home/u/proj/deploy.sh", false).cwd).toBe("/home/u/proj");
  });
});
