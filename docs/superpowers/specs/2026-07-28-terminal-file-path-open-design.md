# 终端文件路径智能打开设计

> 状态：设计已确认，待收尾 web 工程后写实现计划。日期：2026-07-28。
> 依赖：feat/web-remote 的 web 终端（xterm）已就绪；本功能在其基础上扩展。

## 目标

web 终端（xterm）里 claude/codex 输出的文件路径渲染成可点击，点击后提供三种打开方式：① web 端只读预览文件内容 ② markdown 文件在 web 端 Milkdown 就地编辑并写回原文件 ③ 触发本机系统程序打开。让"远程看 agent 提到的文件"和"顺手改个笔记"在手机上一步完成。

## 非目标

- 不做代码文件的编辑器（Keelson 无 CodeMirror/Monaco，代码文件仅只读预览 + 系统打开）。
- 不把文件导入成 PB 知识库文档（md 编辑写回**原文件**，不进 docs 集合）。
- 系统打开在纯远程手机场景无实际反馈（本机弹窗手机看不到），定位为 localhost 本机浏览器场景的便利项，远程隐藏/降级。
- 不放宽任意文件读写——所有读/写/打开严格限会话 `project_path` 目录内。

## 三支能力

1. **只读预览**（任何文本文件）：点路径 → 读文件 → FilePreview 面板展示（代码语法高亮 / markdown 渲染）；路径含 `:42` 行号则滚动定位到该行。
2. **md 就地编辑**：`.md` 文件在 FilePreview 里点「编辑」→ 切 Milkdown 编辑器（包装现有 `MilkdownDocumentEditor` 成"文件版"：读 md 文件内容 → 编辑 → 写回**原文件**，不落 PB docs）→ 保存写回。
3. **系统打开**：点「用本机程序打开」→ 触发本机 `open_path`（localhost 场景显示；远程手机隐藏/灰）。

## 安全（重中之重）

新增 gateway endpoints，全部**限会话 `project_path` 目录内**：
- `POST /api/read_project_file`（受 token 闸）：入参 `{ sessionProjectPath, path }`。`path` 相对则按 `project_path` 解析、绝对则直接取 → **`canonicalize` 规范化后必须以 `project_path`（同样 canonicalize）为前缀** → 否则拒（防 `..` 穿越、符号链接逃逸、绝对路径逃逸）。预览允许文本类扩展名（代码 + md + 常见文本），拒明显二进制/敏感。
- `POST /api/write_project_file`：**只允许 `.md`**（对应 md 就地编辑），同样项目内 canonicalize 前缀校验。
- `POST /api/open_path`：`open_path` 目标也做项目内校验。
- 路径安全校验抽成纯函数（`resolve_within_project(project_path, path) -> Result<PathBuf>`），便于 standalone 测试穿越/逃逸拒绝。
- 现有 `read_text_file`（限 .md/.json）不复用——本功能需"限目录 + 放宽扩展名到文本类"，是新的 project-scoped 版本，二者并存。

## 路径识别

XtermView `registerLinkProvider` + 正则匹配相对/绝对路径（可带 `:行号`）。误报控制：点击时才 `read_project_file` 校验存在，不存在则提示而非报错（不预先对每个 token 探测文件系统）。相对路径按当前会话 `project_path` 解析。

## 点击交互

点 link → 直接打开 **FilePreview**（最常用路径最快）：面板顶部动作栏含「编辑」（仅 `.md` 显示，切 Milkdown）、「本机打开」（localhost 场景显示）。移动优先全屏 sheet，桌面 dialog。

## 组件边界

- **Rust**：`src-tauri/src/web/files.rs`（`read_project_file`/`write_project_file` + `resolve_within_project` 安全纯函数）；`/api/open_path` handler（复用 `commands::fs::open_path` core + 项目内校验）。挂 gateway `require_token` layer 内。
- **前端**：
  - XtermView：`registerLinkProvider`（路径正则 + 点击回调）。
  - `src/web/FilePreview.tsx`：预览面板（代码高亮 + md 渲染 + 行号 + 动作栏）。
  - md 编辑：`MilkdownDocumentEditor` 包装成文件版（读/写文件而非 PB doc）。
  - `ipc.ts`：`readProjectFile`/`writeProjectFile`/`openPath`（web 走 `/api/*`，桌面走 invoke——桌面反哺时可用）。

## 错误处理

文件不存在/非文本/超大 → 友好提示；写回失败（权限/占用）→ toast 重抛；穿越/逃逸 → 403 拒并提示"仅限项目内文件"；系统打开在远程无反馈 → UI 明示"已请求本机打开"。

## 测试

- 路径识别正则（相对/绝对/带行号/误报）。
- **安全 `resolve_within_project`**（`../` 穿越、绝对路径逃逸、符号链接、项目内正常路径）standalone 测。
- read/write endpoint 受闸（无 cookie 401）+ 项目内校验（越界 403）。
- FilePreview 预览渲染（代码/md/行号）。
- md 写回往返。

## 实现分阶段（供 writing-plans）

1. **安全地基**：`web/files.rs` 的 `resolve_within_project` + `read_project_file`/`write_project_file` core + `/api/*` endpoints 受闸。standalone 测穿越拒绝。
2. **路径识别 + 点击壳**：XtermView `registerLinkProvider` + 点击弹 FilePreview 空壳。
3. **只读预览**：FilePreview 代码语法高亮 + markdown 渲染 + `:行号` 定位。
4. **md 就地编辑**：Milkdown 文件版（读文件→编辑→`write_project_file` 写回）。
5. **系统打开 + 收尾**：`/api/open_path` 触发本机（localhost 场景显示）+ 全量校验。

## 全局约束

- 复用现有：`open_path`（系统打开 core）、`MilkdownDocumentEditor`（包装文件版）、markdown 渲染组件、gateway `require_token` 闸、ipc 双通道（isTauri）。
- 新增依赖：代码语法高亮若无现成库，评估最小方案（优先复用项目已有；若引入如 `shiki`/`highlight.js` 须在 plan 说明）。
- 安全铁律：读/写/打开一律经 `resolve_within_project` 项目内校验，无例外；`/api/*` 全在 token 闸内。
- 内部代号 `rework` 不露 web UI；移动优先；不硬编色；store 写失败重抛+toast；中文注释。
