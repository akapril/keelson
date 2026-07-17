# rework 阅读模块增强 —— 设计

> 借鉴 workavera（`D:/workspace/workavera`，Go）的阅读功能,不抄码。把 rework 的"稍后读清单"升级为
> **AI 摘要 + 标签 + 置顶** 的阅读工作台。

## 决策纪要（脑暴结论）

| 维度 | 决定 |
|---|---|
| v1 范围 | 三块:①AI 摘要/要点 + 正文缓存 ②标签 tags + 筛选 ③固定置顶 pinned + 分组 |
| AI 摘要触发 | **手动**「AI 摘要」按钮(详情弹窗);幂等(已有摘要不重复,可"重新摘要"覆盖) |
| 摘要实现 | **前端编排**:复用现有 `ipc.fetchUrlText` + `ipc.aiChat`,零新 Rust(同 `chemistry/extract.ts` 套路) |
| 摘要语言 | 默认中文(rework 惯例);不做语言选择(YAGNI) |
| 标签 | **自由输入**(逗号/回车分隔),存为逗号分隔文本;PB `~` 可搜 |
| 置顶上限 | 不设死上限(前端提示即可) |
| 非目标 | 关联项目 project、自动摘要、重型全文索引 —— 均留后续 |

## 关键约束(既有代码事实)

- **PB text 字段运行时强制 5000 字符默认上限**([[rework-pb-debug-notes]])→ `content_text` 缓存正文可能很长,**必须 `max: 0`** 绕过。
- 现有:`ReadingItem { id, owner, title, url, note, status: "unread"|"reading"|"archived", created, updated }`(`src/types/reading.ts`);PB 集合 `reading_items`(migration `1720000300_reading.js`,owner-only)。
- UI:`src/features/reading/{ReadingPage,ReadingDetailDialog,CreateTaskFromReadingDialog}.tsx`;PB SDK 层 `src/lib/pb/reading.ts`。
- 复用命令:`ipc.fetchUrlText(url) -> string`(Rust `fetch_url_text`,抓网页粗提取正文,已 MAX 12000 截断);`ipc.aiChat(config, messages) -> string`;`useSettingsStore.getState().aiConfig`。
- 参考模式:`src/features/chemistry/extract.ts`(前端 AI 编排 + JSON 解析 + 纯函数可测),照此写摘要解析。

## 架构总览

分三层,各自单一职责:

1. **数据层(migration + PB SDK)** —— reading_items 加字段;`reading.ts` 的 create/update 透传新字段 + `setPinned` + 列表已按需返回新字段。
2. **摘要编排(纯前端)** —— `src/features/reading/summarize.ts`:抓正文→调 AI→解析 JSON。解析为纯函数,单测覆盖容错。
3. **UI(详情弹窗 + 列表页)** —— 摘要/要点展示 + AI 摘要按钮、标签编辑、置顶开关、置顶分组、标签/关键词筛选。

## 1) 数据模型

migration 新增(`reading_items` 加字段;新建一个后续迁移文件,如 `1720000700_reading_enhance.js`,用 `collection.fields.add` + `app.save`):

| 字段 | 类型 | 说明 |
|---|---|---|
| `tags` | text, max 500 | 逗号分隔标签文本(前端拆/合);`~` 可搜 |
| `summary` | text, max 5000 | AI 摘要(一段) |
| `key_points` | text, max 5000 | 要点,存为 JSON 字符串数组(前端 parse) |
| `content_text` | text, **max 0** | 缓存的网页正文(可长,必须 0) |
| `pinned` | bool | 是否置顶 |

索引:`(owner, pinned)`、`(owner, status)`(owner+updated 若已有则复用)。
访问规则:沿用现有 owner-only(不改)。新字段无 `:changed`(PB 0.30 坏 SQL 规避)。

前端类型 `ReadingItem` 相应加 `tags: string; summary: string; key_points: string; content_text: string; pinned: boolean`。

## 2) AI 摘要编排（`src/features/reading/summarize.ts`）

- `SUMMARY_SYSTEM`:中文系统提示,要求"根据正文输出 JSON:`{ "summary": "一段中文摘要", "key_points": ["要点1","要点2",...] }`,不要额外文字"。
- `parseSummary(raw: string): { summary: string; key_points: string[] } | null` —— **纯函数**:从 AI 文本里剥出 JSON(容错:代码围栏、前后噪声)、校验字段;失败返回 null。单测覆盖:正常、带```json 围栏、非法、缺字段。
- `summarizeReadingItem(item): Promise<{ summary; key_points: string[]; content_text }>`:
  1. `fetchUrlText(item.url)` 取正文(Rust 已截断);为空则抛「无法抓取正文」。
  2. `aiChat(aiConfig, [SUMMARY_SYSTEM, {user: 正文(再截断至 ~8000 控成本)}])`。
  3. `parseSummary` → 失败抛「AI 摘要解析失败」。
  4. 返回 `{ summary, key_points, content_text }`(供调用方存 PB)。
- 幂等:调用方(详情弹窗)在 `item.summary` 非空时,按钮显示"重新摘要"并二次确认;否则"AI 摘要"。
- 无 `aiConfig.api_key` 且非本地 CLI provider → 提示去设置。失败全程 toast,不阻断。

## 3) 标签

- `ReadingDetailDialog`:标签输入(文本框,展示为可删小胶囊;回车/逗号加标签;存回 `tags`(逗号分隔))。
- `ReadingPage`:搜索框现有对 title/url/note 的过滤,**并入 tags**;可点标签胶囊快速筛。纯前端过滤(条目量小,YAGNI 不上后端搜索)。

## 4) 固定置顶

- `reading.ts` 加 `setPinned(id, pinned)`(update pinned 字段)。
- `ReadingPage`:列表分两组渲染 —— **📌 置顶**(pinned 且非 archived,按 updated 倒序)、**最近**(其余非 archived)。archived 仍在各自的归档视图/过滤下。
- 分组排序为纯函数 `groupReading(items)`,可测。
- 置顶无硬上限;超过一定数(如 12)前端给个"置顶较多"轻提示(可选,非必须)。

## 5) UI 变更

- **ReadingDetailDialog**:
  - 顶部操作加「AI 摘要 / 重新摘要」按钮 + 置顶开关。
  - 摘要区:有 summary 则展示摘要段 + 要点无序列表;无则占位"未摘要"。
  - 标签编辑区。
  - 保留原 note、建任务、状态切换。
- **ReadingPage**:
  - 置顶/最近分组;条目卡显示标签小胶囊 + 摘要首行(若有)。
  - 搜索并入 tags;标签点选筛。

## 6) 错误处理 & 测试

- 抓取失败 / AI 失败 / 解析失败 → 各自明确中文 toast,条目数据不受损(摘要是增量写)。
- 纯逻辑单测:`parseSummary`(4 例:正常/围栏/非法/缺字段)、`tags` 拆合(`splitTags`/`joinTags`,含空白/重复/空)、`groupReading`(置顶/最近/归档分组与排序)。
- AI 编排 `summarizeReadingItem` 依赖 IPC,不单测(手测);解析与分组的纯函数是测试重点。

## 依赖与前置

- 无新 crate、无新 npm 依赖。复用 fetch_url_text / ai_chat / 现有 reading 层。
- 一个新 migration(加字段)+ 一个新前端模块(summarize.ts)+ 改 3 个既有文件(types/reading、pb/reading、ReadingPage、ReadingDetailDialog)。

## 非目标（YAGNI）

- 不做关联看板项目(project 字段 + 双向跳转)——留后续,耦合看板。
- 不做摘要语言选择(默认中文)。
- 不做自动摘要(仅手动按钮,控成本)。
- 不做后端全文索引/搜索(前端过滤够用)。
- 不做高亮/摘录、封面图、favicon、预计阅读时长、评分等 workavera 其它字段。
