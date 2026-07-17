# rework 阅读增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 rework 阅读从"稍后读清单"升级为 AI 摘要/要点 + 标签 + 置顶的阅读工作台(借鉴 workavera)。

**Architecture:** reading_items 加字段(tags/summary/key_points/content_text[max:0]/pinned);AI 摘要走前端编排(复用 `ipc.fetchUrlText` + `ipc.aiChat`,解析 JSON,同 chemistry/extract.ts);纯逻辑(解析/标签/分组)抽 `reading-utils.ts` 单测;UI 改造详情弹窗 + 列表页。

**Tech Stack:** React 19 + TS + zustand + PocketBase(JS migration);复用现有 Rust `fetch_url_text` / `ai_chat`,无新依赖。

参考 spec:`docs/superpowers/specs/2026-07-17-reading-enhance-design.md`。

## Global Constraints

- 注释与日志默认中文;中性主题**不硬编码颜色**(用 Tailwind 语义类 / var(--*))。
- **PB text 字段运行时强制 5000 字符默认上限** → `content_text` 缓存正文**必须 `max: 0`**;summary/key_points/tags 用有限 max。
- 无新 crate、无新 npm 依赖。复用:`ipc.fetchUrlText(url) -> string`、`ipc.aiChat(config, messages) -> string`、`useSettingsStore.getState().aiConfig`。
- 数据访问只走 `src/lib/pb/reading.ts`(唯一允许 pb.collection);组件走 `useReadingStore`。
- migration 不用 `@request.body.X:changed`(PB 0.30 坏 SQL);沿用 reading_items 现有 owner-only 规则。
- AI 摘要默认输出中文;手动触发;幂等(已有 summary 不自动重复)。
- 现状:`ReadingItem { id, owner, title, url, note, status:"unread"|"reading"|"archived", created, updated }`;store `updateItem(id, patch)` 目前只允许 `Pick<ReadingItem,"title"|"url"|"note"|"status">`(需拓宽)。

---

### Task 1: 数据模型(migration + 类型 + store 拓宽)

**Files:**
- Create: `src-tauri/pb_migrations/1720000700_reading_enhance.js`
- Modify: `src/types/reading.ts`
- Modify: `src/store/reading.ts:54-57`(updateItem 的 patch 类型)

**Interfaces:**
- Produces:`ReadingItem` 增加 `tags: string; summary: string; key_points: string; content_text: string; pinned: boolean`;`updateItem` 接受这些字段。

- [ ] **Step 1: 写 migration**

`src-tauri/pb_migrations/1720000700_reading_enhance.js`:

```js
// 阅读增强迁移：reading_items 加 AI 摘要/要点、正文缓存、标签、置顶。
// content_text 必须 max:0（PB text 默认 5000 上限，缓存正文会超）。
migrate((app) => {
  const col = app.findCollectionByNameOrId("reading_items");
  col.fields.add(new Field({ name: "tags", type: "text", max: 500 }));
  col.fields.add(new Field({ name: "summary", type: "text", max: 5000 }));
  col.fields.add(new Field({ name: "key_points", type: "text", max: 5000 }));
  col.fields.add(new Field({ name: "content_text", type: "text", max: 0 }));
  col.fields.add(new Field({ name: "pinned", type: "bool" }));
  col.addIndex("idx_reading_owner_pinned", false, "owner, pinned", "");
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("reading_items");
  for (const n of ["tags", "summary", "key_points", "content_text", "pinned"]) {
    const f = col.fields.find((x) => x.name === n);
    if (f) col.fields.removeById(f.id);
  }
  app.save(col);
});
```

- [ ] **Step 2: 扩展前端类型**

`src/types/reading.ts` 的 `ReadingItem` 接口末尾(在 `updated` 之前或之后)加:

```typescript
  /** 逗号分隔的标签文本（前端拆/合） */
  tags: string;
  /** AI 摘要（一段） */
  summary: string;
  /** 要点：JSON 字符串数组（前端 parse） */
  key_points: string;
  /** 缓存的网页正文（可长；PB 字段 max:0） */
  content_text: string;
  /** 是否置顶 */
  pinned: boolean;
```

- [ ] **Step 3: 拓宽 store updateItem 的 patch 类型**

`src/store/reading.ts` 的 `updateItem` 声明(约 L54-57)改为:

```typescript
  /** 更新阅读条目字段（乐观更新 + 回滚） */
  updateItem: (
    id: string,
    patch: Partial<
      Pick<
        ReadingItem,
        | "title"
        | "url"
        | "note"
        | "status"
        | "tags"
        | "summary"
        | "key_points"
        | "content_text"
        | "pinned"
      >
    >,
  ) => Promise<void>;
```

- [ ] **Step 4: 类型检查**

Run: `cd /d/workspace/rework && npx tsc --noEmit`
Expected: 通过(新字段可能在 UI 用到前无引用,但类型自洽)。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/pb_migrations/1720000700_reading_enhance.js src/types/reading.ts src/store/reading.ts
git commit -m "feat(reading): reading_items 加 tags/summary/key_points/content_text(max0)/pinned + 类型"
```

> migration 在下次启动应用由 PB 自动应用(控制器实机验证在最后)。

---

### Task 2: 纯逻辑(reading-utils.ts:解析/标签/分组)+ 单测

**Files:**
- Create: `src/features/reading/reading-utils.ts`
- Test: `src/features/reading/reading-utils.test.ts`

**Interfaces:**
- Consumes:`ReadingItem`(`@/types/reading`)。
- Produces:
  - `parseSummary(reply: string): { summary: string; key_points: string[] } | null`
  - `splitTags(csv: string): string[]`
  - `joinTags(tags: string[]): string`
  - `groupReading(items: ReadingItem[]): { pinned: ReadingItem[]; rest: ReadingItem[] }`

- [ ] **Step 1: 写失败测试**

`src/features/reading/reading-utils.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSummary, splitTags, joinTags, groupReading } from "./reading-utils";
import type { ReadingItem } from "@/types/reading";

function item(p: Partial<ReadingItem>): ReadingItem {
  return {
    id: "x", owner: "o", title: "t", url: "", note: "", status: "unread",
    tags: "", summary: "", key_points: "", content_text: "", pinned: false,
    created: "2026-07-01T00:00:00Z", updated: "2026-07-01T00:00:00Z", ...p,
  };
}

describe("parseSummary", () => {
  it("解析正常 JSON", () => {
    const r = parseSummary('{"summary":"一句话","key_points":["a","b"]}');
    expect(r).toEqual({ summary: "一句话", key_points: ["a", "b"] });
  });
  it("剥离 ```json 围栏", () => {
    const r = parseSummary('```json\n{"summary":"s","key_points":["x"]}\n```');
    expect(r?.summary).toBe("s");
    expect(r?.key_points).toEqual(["x"]);
  });
  it("非法 JSON 返回 null", () => {
    expect(parseSummary("not json")).toBeNull();
  });
  it("缺 summary 字段返回 null；key_points 缺失则空数组", () => {
    expect(parseSummary('{"key_points":["a"]}')).toBeNull();
    expect(parseSummary('{"summary":"s"}')).toEqual({ summary: "s", key_points: [] });
  });
});

describe("splitTags / joinTags", () => {
  it("拆分:去空白、去空、去重", () => {
    expect(splitTags("a, b ,, a ,c")).toEqual(["a", "b", "c"]);
    expect(splitTags("")).toEqual([]);
  });
  it("合并:逗号分隔", () => {
    expect(joinTags(["a", "b"])).toBe("a,b");
    expect(joinTags([])).toBe("");
  });
});

describe("groupReading", () => {
  it("按 pinned 拆分,保序", () => {
    const a = item({ id: "a", pinned: true });
    const b = item({ id: "b", pinned: false });
    const c = item({ id: "c", pinned: true });
    const g = groupReading([a, b, c]);
    expect(g.pinned.map((x) => x.id)).toEqual(["a", "c"]);
    expect(g.rest.map((x) => x.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/features/reading/reading-utils.test.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

`src/features/reading/reading-utils.ts`:

```typescript
// 阅读增强纯逻辑:AI 摘要 JSON 解析、标签拆合、置顶分组。无副作用,可单测。
import type { ReadingItem } from "@/types/reading";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * 解析 AI 回复为 { summary, key_points }。容错:去 ```json 围栏、截取首个 { 到末个 }。
 * summary 缺失/非字符串 → null;key_points 缺失 → 空数组。
 */
export function parseSummary(
  reply: string,
): { summary: string; key_points: string[] } | null {
  if (!reply) return null;
  let s = reply.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);

  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  const summary = asString(rec.summary)?.trim();
  if (!summary) return null;
  const key_points = Array.isArray(rec.key_points)
    ? rec.key_points
        .map(asString)
        .filter((x): x is string => !!x && !!x.trim())
        .map((x) => x.trim())
    : [];
  return { summary, key_points };
}

/** 拆分逗号分隔标签:去空白、去空、去重(保序)。 */
export function splitTags(csv: string): string[] {
  const out: string[] = [];
  for (const raw of (csv || "").split(",")) {
    const t = raw.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** 合并标签为逗号分隔文本。 */
export function joinTags(tags: string[]): string {
  return tags.join(",");
}

/** 按 pinned 拆成置顶组与其余组(保持传入顺序)。 */
export function groupReading(items: ReadingItem[]): {
  pinned: ReadingItem[];
  rest: ReadingItem[];
} {
  return {
    pinned: items.filter((it) => it.pinned),
    rest: items.filter((it) => !it.pinned),
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/features/reading/reading-utils.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/features/reading/reading-utils.ts src/features/reading/reading-utils.test.ts
git commit -m "feat(reading): 纯逻辑(AI摘要解析/标签拆合/置顶分组)+ 单测"
```

---

### Task 3: AI 摘要编排(summarize.ts)

**Files:**
- Create: `src/features/reading/summarize.ts`

**Interfaces:**
- Consumes:`parseSummary`(Task 2)、`ipc.fetchUrlText`、`ipc.aiChat`、`AiConfig`、`ReadingItem`。
- Produces:
  - `SUMMARY_SYSTEM: string`
  - `summarizeReadingItem(item: ReadingItem, cfg: AiConfig): Promise<{ summary: string; key_points: string[]; content_text: string }>`

- [ ] **Step 1: 实现**

`src/features/reading/summarize.ts`:

```typescript
// 阅读 AI 摘要编排:抓网页正文 → AI 出 JSON{summary,key_points} → 解析。
// 复用现有 fetch_url_text(Rust,已 MAX 12000 截断)+ ai_chat;解析走 parseSummary。
import { ipc } from "@/lib/tauri/ipc";
import type { AiConfig, AiChatMessage } from "@/types/ai";
import type { ReadingItem } from "@/types/reading";
import { parseSummary } from "./reading-utils";

/** 摘要系统提示:严格 JSON、中文。 */
export const SUMMARY_SYSTEM = `你是阅读助手。根据给定网页正文,输出严格 JSON(不要解释、不要代码块围栏):
{"summary":"一段简洁中文摘要","key_points":["要点1","要点2"]}
summary 概括核心内容;key_points 列 3-6 个关键点。用中文。`;

// 送入 AI 的正文上限(控成本;fetch_url_text 已截断,这里再兜底)
const MAX_INPUT = 8000;

/**
 * 对阅读条目做 AI 摘要。抓取/AI/解析任一步失败即抛错(中文),由调用方 toast。
 * @returns { summary, key_points, content_text } —— 调用方负责写回 PB。
 */
export async function summarizeReadingItem(
  item: ReadingItem,
  cfg: AiConfig,
): Promise<{ summary: string; key_points: string[]; content_text: string }> {
  if (!item.url) throw new Error("该条目无链接,无法摘要");
  const content_text = (await ipc.fetchUrlText(item.url)).trim();
  if (!content_text) throw new Error("未能抓取到网页正文");

  const input =
    content_text.length > MAX_INPUT ? content_text.slice(0, MAX_INPUT) : content_text;
  const msgs: AiChatMessage[] = [
    { role: "system", content: SUMMARY_SYSTEM },
    { role: "user", content: input },
  ];
  const reply = (await ipc.aiChat(cfg, msgs)).trim();
  const parsed = parseSummary(reply);
  if (!parsed) throw new Error("AI 摘要解析失败(未返回有效 JSON)");

  return { summary: parsed.summary, key_points: parsed.key_points, content_text };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/features/reading/summarize.ts
git commit -m "feat(reading): AI 摘要编排 summarizeReadingItem(复用 fetchUrlText+aiChat)"
```

---

### Task 4: ReadingDetailDialog 交互化(AI 摘要 + 要点 + 标签 + 置顶)

**Files:**
- Modify: `src/features/reading/ReadingDetailDialog.tsx`(整体改写为交互式)

**Interfaces:**
- Consumes:`useReadingStore().updateItem`、`summarizeReadingItem`(Task 3)、`splitTags`/`joinTags`(Task 2)、`useSettingsStore().aiConfig`。

- [ ] **Step 1: 改写为交互式详情弹窗**

`src/features/reading/ReadingDetailDialog.tsx` 全量替换为:

```tsx
// ReadingDetailDialog —— 阅读条目详情(交互):AI 摘要/要点、标签编辑、置顶、备注。
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  LinkSquare02Icon,
  AiChat02Icon,
  PinIcon,
} from "@hugeicons/core-free-icons";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useReadingStore } from "@/store/reading";
import { useSettingsStore } from "@/store/settings";
import { summarizeReadingItem } from "./summarize";
import { splitTags, joinTags } from "./reading-utils";
import type { ReadingItem, ReadingStatus } from "@/types/reading";

const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: "未读",
  reading: "在读",
  archived: "已归档",
};

interface ReadingDetailDialogProps {
  item: ReadingItem | null;
  onClose: () => void;
}

export function ReadingDetailDialog({ item, onClose }: ReadingDetailDialogProps) {
  const updateItem = useReadingStore((s) => s.updateItem);
  const [summarizing, setSummarizing] = useState(false);
  const [tagInput, setTagInput] = useState("");

  // 切换条目时清空标签输入
  useEffect(() => {
    setTagInput("");
  }, [item?.id]);

  if (!item) {
    return (
      <Dialog open={false} onOpenChange={(o) => !o && onClose()}>
        <DialogContent />
      </Dialog>
    );
  }

  const tags = splitTags(item.tags);
  const keyPoints: string[] = (() => {
    try {
      const v = JSON.parse(item.key_points || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  })();

  // AI 摘要:抓正文 → AI → 写回 summary/key_points/content_text
  const runSummarize = async () => {
    if (summarizing) return;
    const cfg = useSettingsStore.getState().aiConfig;
    const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli";
    if (!isCli && !cfg.api_key) {
      toast.error("请先在设置中配置 AI 服务");
      return;
    }
    setSummarizing(true);
    try {
      const r = await summarizeReadingItem(item, cfg);
      await updateItem(item.id, {
        summary: r.summary,
        key_points: JSON.stringify(r.key_points),
        content_text: r.content_text,
      });
      toast.success("已生成 AI 摘要");
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSummarizing(false);
    }
  };

  const addTag = () => {
    const next = splitTags(joinTags([...tags, tagInput]));
    setTagInput("");
    void updateItem(item.id, { tags: joinTags(next) });
  };
  const removeTag = (t: string) => {
    void updateItem(item.id, { tags: joinTags(tags.filter((x) => x !== t)) });
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="pr-6">{item.title || "阅读条目"}</DialogTitle>
          <DialogDescription>阅读条目详情与 AI 摘要</DialogDescription>
        </DialogHeader>

        {/* 链接 + 状态 + 操作 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-3 text-xs">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
              title={item.url}
            >
              <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3.5 shrink-0" />
              <span className="truncate">{item.url}</span>
            </a>
          ) : (
            <span className="text-muted-foreground">无链接</span>
          )}
          <Badge variant="secondary" className="shrink-0">
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant={item.pinned ? "secondary" : "ghost"}
              size="sm"
              onClick={() => void updateItem(item.id, { pinned: !item.pinned })}
              title={item.pinned ? "取消置顶" : "置顶"}
            >
              <HugeiconsIcon icon={PinIcon} strokeWidth={2} />
              {item.pinned ? "已置顶" : "置顶"}
            </Button>
            {item.url && (
              <Button variant="ghost" size="sm" disabled={summarizing} onClick={() => void runSummarize()}>
                <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} />
                {summarizing ? "摘要中…" : item.summary ? "重新摘要" : "AI 摘要"}
              </Button>
            )}
          </div>
        </div>

        {/* 标签 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border py-2">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => removeTag(t)}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              title="点击删除"
            >
              {t} ✕
            </button>
          ))}
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="加标签，回车/逗号确认"
            className="h-7 w-40 text-xs"
          />
        </div>

        {/* 摘要 / 要点 / 备注 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
          {item.summary ? (
            <div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {item.summary}
              </p>
              {keyPoints.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {keyPoints.map((k, i) => (
                    <li key={i}>{k}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              暂无 AI 摘要。{item.url ? "点右上「AI 摘要」抓取网页并生成。" : "该条目无链接。"}
            </p>
          )}
          {item.note?.trim() && (
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">备注</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{item.note}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过。若 `PinIcon` 名不存在,`grep -oE "Pin[A-Za-z]*Icon" node_modules/.pnpm/@hugeicons+core-free-icons*/**/index.d.ts` 找一个存在的钉图标(如 `PinLocation01Icon`/`Pin02Icon`)替换。

- [ ] **Step 3: 提交**

```bash
git add src/features/reading/ReadingDetailDialog.tsx
git commit -m "feat(reading): 详情弹窗交互化(AI摘要/要点展示 + 标签编辑 + 置顶)"
```

---

### Task 5: ReadingPage 改造(置顶分组 + 标签/关键词筛 + 卡片标签胶囊)

**Files:**
- Modify: `src/features/reading/ReadingPage.tsx`

**Interfaces:**
- Consumes:`groupReading`/`splitTags`(Task 2)。
- 说明:移除 ReadingRow 里旧的 `handleAiParse`(写 note 的老 AI 解析)—— AI 摘要已迁到详情弹窗(Task 4,写结构化字段)。行内展示 `summary` 摘要 + 标签胶囊,点击打开详情。

- [ ] **Step 1: 行内展示 summary + 标签胶囊,移除旧 AI 解析**

`src/features/reading/ReadingPage.tsx` 的 `ReadingRow` 组件:
1. 删除 `handleAiParse` 整个函数(L85-127)、`parsing` state、顶部 `useSettingsStore`/`ipc`/`AiChatMessage` 若仅此处用则一并清理导入(`AiChat02Icon` 仍可能被移除)。
2. 行内"备注/AI 摘要"块改为优先显示 `item.summary`(无则 `item.note`),并在标题下加标签胶囊:

在标题/主机名之后、备注块位置,替换为:

```tsx
          {/* 标签胶囊 */}
          {splitTags(item.tags).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {splitTags(item.tags).map((t) => (
                <span key={t} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* 摘要/备注(截断,点击查看详情) */}
          {(item.summary || item.note) && (
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="mt-1 block w-full text-left"
              title="查看详情"
            >
              <span className="line-clamp-2 text-sm text-muted-foreground">
                {item.summary || item.note}
              </span>
              <span className="text-xs text-primary hover:underline">查看详情</span>
            </button>
          )}
```
3. 右侧操作区移除"AI 解析"按钮(L186-199);保留 建任务 / 状态 / 删除。右键菜单里移除"AI 解析"项(L256-260),并加一项「详情」→ `setDetailOpen(true)`。

- [ ] **Step 2: 顶部搜索框(标题/链接/标签)+ 置顶分组渲染**

`ReadingPage` 主体:
1. 加搜索状态:在 `const [filter, setFilter] = ...` 附近加 `const [query, setQuery] = useState("");`。导入 `groupReading`、`splitTags`。
2. `visible` 的 useMemo 改为先按状态筛、再按关键词(标题/url/tags)筛:

```tsx
  const visible = useMemo(() => {
    const byStatus = filter === "all" ? items : items.filter((it) => it.status === filter);
    const q = query.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.url.toLowerCase().includes(q) ||
        splitTags(it.tags).some((t) => t.toLowerCase().includes(q)),
    );
  }, [items, filter, query]);
```
3. 在状态筛选 Tabs 之后加一个搜索 `<Input>`:

```tsx
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索标题 / 链接 / 标签…"
        className="mb-3 shrink-0"
        aria-label="搜索"
      />
```
4. 列表渲染改为置顶/最近分组(替换 L411-421 的单一 `visible.map`):

```tsx
        ) : (
          (() => {
            const { pinned, rest } = groupReading(visible);
            return (
              <div className="flex flex-col gap-4">
                {pinned.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      📌 置顶（{pinned.length}）
                    </h2>
                    <div className="flex flex-col gap-2">
                      {pinned.map((it) => (
                        <ReadingRow key={it.id} item={it} onCreateTask={setTaskFromItem} />
                      ))}
                    </div>
                  </section>
                )}
                <section>
                  {pinned.length > 0 && (
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      最近
                    </h2>
                  )}
                  <div className="flex flex-col gap-2">
                    {rest.map((it) => (
                      <ReadingRow key={it.id} item={it} onCreateTask={setTaskFromItem} />
                    ))}
                  </div>
                </section>
              </div>
            );
          })()
        )}
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `npx tsc --noEmit && npm run build`
Expected: 通过。清理所有因移除 handleAiParse 产生的未用导入(tsc 会报 unused → 逐个删)。

- [ ] **Step 4: 提交**

```bash
git add src/features/reading/ReadingPage.tsx
git commit -m "feat(reading): 列表置顶分组 + 标签/关键词搜索 + 卡片标签胶囊;AI摘要迁至详情弹窗"
```

---

### Task 6: 控制器实机验证

**Files:** 无(手动/控制器)。

> 前置:释放构建锁(`taskkill //F //IM pocketbase.exe`,只杀 pocketbase),`npm run tauri dev`。

- [ ] **Step 1: migration 应用**

启动后确认 reading_items 有新字段(应用不报错、阅读页正常加载)。

- [ ] **Step 2: AI 摘要**

阅读页加一条带 url 的条目 → 打开详情 → 点「AI 摘要」→ 应抓网页 + 出摘要段 + 要点列表,并持久化(重开仍在)。再次点显示「重新摘要」。

- [ ] **Step 3: 标签 + 置顶 + 搜索**

详情里加几个标签(回车/逗号)→ 列表卡片显示胶囊;点「置顶」→ 列表出现「📌 置顶」分组;顶部搜索按标题/标签能筛。

- [ ] **Step 4: 记录结果**

把实测(摘要成功/失败文案、标签、置顶分组、搜索)记入验收说明。

---

## Self-Review 摘要

- Spec 覆盖:数据模型(5 字段,content_text max:0)✓T1;AI 摘要/要点(前端编排复用 fetchUrlText+aiChat,解析 JSON,幂等)✓T2(parseSummary)+T3+T4;标签(自由输入+筛选)✓T2(split/join)+T4+T5;置顶(分组)✓T2(groupReading)+T4+T5;测试(纯函数)✓T2;实机 ✓T6。
- 无占位符:T1-T4 全为可执行代码;T5 是既有组件改造,给出了替换/新增代码块 + 明确删除范围(handleAiParse/AI解析按钮),并注明"清理未用导入"(tsc 驱动,非 vague)。`PinIcon` 给了不存在时的替换指令。
- 类型一致:`parseSummary`/`splitTags`/`joinTags`/`groupReading`(T2)→ T3/T4/T5 使用一致;`summarizeReadingItem(item,cfg)`(T3)→ T4 调用一致;`ReadingItem` 新字段(T1)贯穿 T2-T5;store `updateItem` 拓宽后的字段(T1)与 T4 的 `updateItem({summary,key_points,content_text,tags,pinned})` 一致。
- 已知取舍:key_points 以 JSON 字符串存于 text 字段(前端 parse/stringify),避免 PB 数组字段的过滤复杂度;摘要迁到详情弹窗,列表旧的 note-based AI 解析移除(spec 明确升级为结构化字段)。
