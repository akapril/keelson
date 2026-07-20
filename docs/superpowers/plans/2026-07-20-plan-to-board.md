# 计划→看板 / spec→文档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 executing-plans。Steps 用 `- [ ]`。

**Goal:** 项目工作台一键：解析计划 `### Task N` → 看板卡片（幂等）；可选 spec → 项目文档。

**Architecture:** 纯前端解析（可测）+ 复用 `createTask`/`createDocRecord`；后端补 `read_text_file`/`list_markdown_files`。零 PB schema 变更。

**Tech Stack:** Rust/Tauri、React 19/TS、vitest。

## Global Constraints
- 注释/日志中文；中性主题不硬编码颜色。
- 幂等键 `source_anchor = "plan:<文件名>#task-<N>"`；已存在同 anchor 卡片跳过。
- 只读仓库 md、只建卡/文档；不改删用户既有数据。
- 无 PB schema 变更。构建 Rust 前 `taskkill //IM pocketbase.exe //F`（不碰 rework.exe），构建后 `git checkout -- src-tauri/Cargo.toml`。

---

### Task 1: 后端文件命令 `read_text_file` / `list_markdown_files`

**Files:**
- Modify: `src-tauri/src/commands/fs.rs`
- Modify: `src-tauri/src/lib.rs`（注册）
- Test: `src-tauri/src/commands/fs.rs`（`#[cfg(test)]`）

**Interfaces:**
- Produces: `read_text_file(path: String) -> Result<String, String>`、`list_markdown_files(dir: String) -> Result<Vec<MdFile>, String>`、`MdFile { name, path }`。

- [ ] **Step 1: 写命令**（fs.rs 末尾，`use` 处补 `serde::Serialize` 无需——用全路径）

```rust
/// markdown 文件项（导入计划对话框用）。
#[derive(serde::Serialize)]
pub struct MdFile {
    pub name: String,
    pub path: String,
}

/// 读文本文件（导入计划 / 规格用）。不存在或非 UTF-8 → Err。
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

/// 列目录下 .md 文件（非递归，按名排序）。目录不存在 → 空列表（非错误）。
#[tauri::command]
pub fn list_markdown_files(dir: String) -> Result<Vec<MdFile>, String> {
    let d = Path::new(&dir);
    if !d.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<MdFile> = vec![];
    let rd = std::fs::read_dir(d).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                out.push(MdFile { name: name.to_string(), path: p.to_string_lossy().into_owned() });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}
```

- [ ] **Step 2: 注册命令**

`lib.rs` 中 `commands::fs::pb_data_dir,`（或 `write_text_file` 附近）后加：
```rust
            commands::fs::read_text_file,
            commands::fs::list_markdown_files,
```

- [ ] **Step 3: 测试**

fs.rs 追加：
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_markdown_missing_dir_is_empty() {
        let out = list_markdown_files("Z:/no/such/dir/xxxx".into()).unwrap();
        assert!(out.is_empty());
    }

    #[test]
    fn read_missing_file_errors() {
        assert!(read_text_file("Z:/no/such/file.md".into()).is_err());
    }
}
```

- [ ] **Step 4: 编译+测试**

Run: `taskkill //IM pocketbase.exe //F ; cd src-tauri && cargo test --lib commands::fs 2>&1 | tail -20`
Expected: 2 测试 PASS，0 error。之后 `git checkout -- Cargo.toml`。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/fs.rs src-tauri/src/lib.rs
git commit -m "feat(board): 读仓库 markdown 命令 read_text_file/list_markdown_files [Rust]"
```

---

### Task 2: 前端解析纯函数 + 单测

**Files:**
- Create: `src/features/board/plan-import.ts`
- Test: `src/features/board/plan-import.test.ts`

**Interfaces:**
- Produces: `PlanTask{n,title,body}`、`parsePlanTasks(md)`、`parseDocTitle(md)`、`specNameForPlan(name)`、`taskAnchor(name,n)`。

- [ ] **Step 1: 写测试（先失败）**

`plan-import.test.ts`：
```ts
import { describe, it, expect } from "vitest";
import { parsePlanTasks, parseDocTitle, specNameForPlan, taskAnchor } from "./plan-import";

describe("parsePlanTasks", () => {
  const md = `# 标题

### Task 1: 建命令

**Files:** a.rs
正文一

### Task 2：中文冒号

正文二

## 其它小节
不该算任务`;

  it("切出两个任务", () => {
    const ts = parsePlanTasks(md);
    expect(ts.length).toBe(2);
    expect(ts[0].n).toBe(1);
    expect(ts[0].title).toBe("建命令");
    expect(ts[1].title).toBe("中文冒号");
  });
  it("body 到下一个 ###/## 截断", () => {
    const ts = parsePlanTasks(md);
    expect(ts[0].body).toContain("正文一");
    expect(ts[0].body).not.toContain("Task 2");
    expect(ts[1].body).toContain("正文二");
    expect(ts[1].body).not.toContain("不该算任务");
  });
  it("无任务返回空", () => expect(parsePlanTasks("# 只有标题\n正文").length).toBe(0));
});

describe("parseDocTitle", () => {
  it("取首个 #", () => expect(parseDocTitle("# 我的设计\n\n正文")).toBe("我的设计"));
  it("无标题空串", () => expect(parseDocTitle("正文无标题")).toBe(""));
});

describe("specNameForPlan / taskAnchor", () => {
  it("plan→spec 名", () =>
    expect(specNameForPlan("2026-07-20-foo.md")).toBe("2026-07-20-foo-design.md"));
  it("anchor", () => expect(taskAnchor("2026-07-20-foo.md", 3)).toBe("plan:2026-07-20-foo.md#task-3"));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/features/board/plan-import.test.ts 2>&1 | tail -15`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`src/features/board/plan-import.ts`：
```ts
// 计划 markdown 解析（纯函数，可测）：### Task N → 卡片；# 标题 → 文档标题。
export interface PlanTask {
  n: number;
  title: string;
  body: string;
}

const TASK_RE = /^###\s+Task\s+(\d+)\s*[:：]\s*(.+?)\s*$/;

/** 解析 ### Task N: 标题 段落；body = 到下一个 ###/## 或 EOF。 */
export function parsePlanTasks(md: string): PlanTask[] {
  const lines = md.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let cur: PlanTask | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) {
      cur.body = buf.join("\n").trim();
      tasks.push(cur);
    }
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(TASK_RE);
    if (m) {
      flush();
      cur = { n: Number(m[1]), title: m[2], body: "" };
      continue;
    }
    // 遇到其它 ###/## 小节：结束当前任务的 body 收集
    if (cur && /^##/.test(line.trim())) {
      flush();
      cur = null;
      continue;
    }
    if (cur) buf.push(line);
  }
  flush();
  return tasks;
}

/** 首个 `# 标题`；无则空串。 */
export function parseDocTitle(md: string): string {
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1];
  }
  return "";
}

/** 计划文件名 → 同名 spec 文件名：<base>.md → <base>-design.md。 */
export function specNameForPlan(planName: string): string {
  return planName.replace(/\.md$/i, "-design.md");
}

/** 幂等锚点：plan:<文件名>#task-<N>。 */
export function taskAnchor(planName: string, n: number): string {
  return `plan:${planName}#task-${n}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/features/board/plan-import.test.ts 2>&1 | tail -15`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/features/board/plan-import.ts src/features/board/plan-import.test.ts
git commit -m "feat(board): 计划 markdown 解析纯函数 + 单测"
```

---

### Task 3: ipc 封装 + store `importPlanTasks`

**Files:**
- Modify: `src/lib/tauri/ipc.ts`（加 `readTextFile`/`listMarkdownFiles` + `MdFile` 类型）
- Modify: `src/store/board.ts`（加 `importPlanTasks`）

**Interfaces:**
- Consumes: `parsePlanTasks` 的 `PlanTask`、`taskAnchor`、`createTask`。
- Produces: `importPlanTasks(tasks: PlanTask[], planName: string) => Promise<{ created: number; skipped: number }>`；`ipc.readTextFile`/`ipc.listMarkdownFiles`。

- [ ] **Step 1: ipc**

`ipc.ts` 加类型与命令（`fs` 相关区）：
```ts
export interface MdFile { name: string; path: string }
```
```ts
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  listMarkdownFiles: (dir: string) => invoke<MdFile[]>("list_markdown_files", { dir }),
```

- [ ] **Step 2: store 动作**

`board.ts`：`BoardStoreState` 接口加：
```ts
  /** 导入计划任务为看板卡片（幂等：同 source_anchor 跳过）。 */
  importPlanTasks: (tasks: PlanTask[], planName: string) => Promise<{ created: number; skipped: number }>;
```
实现（`createTask` 动作附近；import `parsePlanTasks` 的类型 + `taskAnchor`）：
```ts
  importPlanTasks: async (tasks, planName) => {
    const { states, tasks: existing, createTask, openedProjectId } = get();
    if (!openedProjectId) return { created: 0, skipped: 0 };
    // 首个 pending 列（无则首个 state）
    const pending = states.find((s) => s.category === "pending") ?? states[0];
    if (!pending) return { created: 0, skipped: 0 };
    let created = 0, skipped = 0;
    for (const t of tasks) {
      const anchor = taskAnchor(planName, t.n);
      if (existing.some((x) => x.source_anchor === anchor)) {
        skipped++;
        continue;
      }
      await createTask({
        project: openedProjectId,
        state: pending.id,
        title: t.title,
        description: t.body,
        source_anchor: anchor,
        source_provider: "rework-plan",
      });
      created++;
    }
    return { created, skipped };
  },
```
（文件顶部 import：`import { taskAnchor, type PlanTask } from "@/features/board/plan-import";`）

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri/ipc.ts src/store/board.ts
git commit -m "feat(board): ipc 读文件 + store importPlanTasks（幂等建卡）"
```

---

### Task 4: `ImportPlanDialog` + 挂载

**Files:**
- Create: `src/features/board/ImportPlanDialog.tsx`
- Modify: `src/features/board/ProjectWorkspace.tsx`（头部按钮 + 渲染对话框）

**Interfaces:**
- Consumes: `ipc.listMarkdownFiles/readTextFile`、`parsePlanTasks/parseDocTitle/specNameForPlan`、`useBoardStore().importPlanTasks`、`createDocRecord`、`currentUserId`。

- [ ] **Step 1: 对话框**

`src/features/board/ImportPlanDialog.tsx`：
```tsx
// ImportPlanDialog —— 从 <repo>/docs/superpowers/plans 选计划 → 解析建卡；可选把同名 spec 存为文档。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ipc, type MdFile } from "@/lib/tauri/ipc";
import { useBoardStore } from "@/store/board";
import { createDocRecord } from "@/lib/pb/docs";
import { currentUserId } from "@/lib/pb";
import { parsePlanTasks, parseDocTitle, specNameForPlan, type PlanTask } from "./plan-import";
import type { BoardProject } from "@/types/board";

const PLANS_SUBDIR = "docs/superpowers/plans";
const SPECS_SUBDIR = "docs/superpowers/specs";
const joinPath = (a: string, b: string) => `${a.replace(/[\\/]$/, "")}/${b}`;

export function ImportPlanDialog({
  open, onClose, project,
}: { open: boolean; onClose: () => void; project: BoardProject }) {
  const importPlanTasks = useBoardStore((s) => s.importPlanTasks);
  const repo = project.repo_path ?? "";
  const [files, setFiles] = useState<MdFile[]>([]);
  const [sel, setSel] = useState<MdFile | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [withSpec, setWithSpec] = useState(true);
  const [specExists, setSpecExists] = useState(false);
  const [busy, setBusy] = useState(false);

  // 打开时列计划文件
  useEffect(() => {
    if (!open || !repo) return;
    setSel(null); setTasks([]);
    ipc.listMarkdownFiles(joinPath(repo, PLANS_SUBDIR)).then(setFiles).catch(() => setFiles([]));
  }, [open, repo]);

  // 选中计划 → 读+解析 + 探测 spec
  const pick = async (f: MdFile) => {
    setSel(f);
    try {
      const md = await ipc.readTextFile(f.path);
      setTasks(parsePlanTasks(md));
      const specFiles = await ipc.listMarkdownFiles(joinPath(repo, SPECS_SUBDIR)).catch(() => []);
      setSpecExists(specFiles.some((s) => s.name === specNameForPlan(f.name)));
    } catch (e) {
      toast.error(`读取失败：${String(e)}`);
      setTasks([]);
    }
  };

  const doImport = async () => {
    if (!sel || tasks.length === 0 || busy) return;
    setBusy(true);
    try {
      const { created, skipped } = await importPlanTasks(tasks, sel.name);
      let docMsg = "";
      if (withSpec && specExists) {
        try {
          const specPath = joinPath(joinPath(repo, SPECS_SUBDIR), specNameForPlan(sel.name));
          const md = await ipc.readTextFile(specPath);
          await createDocRecord({
            owner: currentUserId(),
            project: project.id,
            title: parseDocTitle(md) || specNameForPlan(sel.name),
            content: md,
          });
          docMsg = "，spec 已存为文档";
        } catch (e) {
          docMsg = `，spec 存文档失败：${String(e)}`;
        }
      }
      toast.success(`新建 ${created} 张卡片，跳过 ${skipped} 张已存在${docMsg}`);
      onClose();
    } catch (e) {
      toast.error(`导入失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>导入计划到看板</DialogTitle>
          <DialogDescription>
            解析 <code className="font-mono">{PLANS_SUBDIR}</code> 下计划的 Task 段落为卡片（幂等，已存在跳过）。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-1">
          {files.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              未找到计划文件（{PLANS_SUBDIR}）。
            </p>
          ) : (
            files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => void pick(f)}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  sel?.path === f.path ? "border-primary bg-accent" : "border-border bg-card hover:bg-accent"
                }`}
              >
                <span className="font-mono text-foreground">{f.name}</span>
                {sel?.path === f.path && (
                  <span className="ml-2 text-xs text-muted-foreground">解析出 {tasks.length} 个任务</span>
                )}
              </button>
            ))
          )}
        </div>

        {sel && specExists && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={withSpec} onChange={(e) => setWithSpec(e.target.checked)} className="size-3.5 accent-primary" />
            同时把设计 spec（{specNameForPlan(sel.name)}）存为项目文档
          </label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void doImport()} disabled={busy || !sel || tasks.length === 0}>
            {busy ? "导入中…" : `导入 ${tasks.length} 个任务`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 挂载到 ProjectWorkspace**

`ProjectWorkspace.tsx`：
- import：`import { ImportPlanDialog } from "./ImportPlanDialog";` + 已有 `useState`。
- 组件内加 state：`const [showImport, setShowImport] = useState(false);`
- 头部「项目设置」按钮前（仅 `repoPath` 时）加：
```tsx
        {repoPath && (
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
            导入计划
          </Button>
        )}
```
- 组件 return 末尾（`ProjectSheet` 之后）加：
```tsx
      <ImportPlanDialog open={showImport} onClose={() => setShowImport(false)} project={project} />
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit 2>&1 | tail -15`
Expected: 0 error。

- [ ] **Step 4: Commit**

```bash
git add src/features/board/ImportPlanDialog.tsx src/features/board/ProjectWorkspace.tsx
git commit -m "feat(board): 导入计划对话框（建卡 + 可选 spec 存文档）"
```

---

## Self-Review
- [x] Spec 覆盖：读文件命令（T1）、解析（T2）、ipc+store 幂等建卡（T3）、对话框+挂载（T4）。
- [x] 无占位符：每步含完整代码/命令/期望。
- [x] 类型一致：`PlanTask`/`MdFile`/`taskAnchor`/`importPlanTasks` 跨任务签名一致。
- [x] 约束：幂等 source_anchor、只读只建、无 schema 变更、pocketbase kill + Cargo.toml checkout。
