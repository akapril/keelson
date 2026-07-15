// 项目设置抽屉：编辑当前打开项目的基础字段、状态列、标签。
// 数据全部经 useBoardStore（其内部走 lib/pb/board.ts），本组件不直接访问 PB。
import { useState, useEffect, type FormEvent } from "react";
import { useBoardStore } from "../../store/board";
import { normalizeSortOrders } from "../../store/board-rank";
import type { StateCategory } from "../../types/board";

// ── Props ──────────────────────────────────────────────────────
interface ProjectSheetProps {
  /** 是否显示抽屉 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

// 类别下拉可选项（中文标签）
const CATEGORY_OPTIONS: { value: StateCategory; label: string }[] = [
  { value: "pending", label: "待处理" },
  { value: "active", label: "进行中" },
  { value: "completed", label: "已完成" },
];

// 输入框统一样式
const inputCls = [
  "rounded-md border border-input bg-background px-2.5 py-1.5",
  "text-sm text-foreground placeholder:text-muted-foreground",
  "focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
].join(" ");

/**
 * 项目设置抽屉（受控）。
 * 作用于 store 中当前打开的项目（openedProjectId）。
 */
export function ProjectSheet({ open, onClose }: ProjectSheetProps) {
  // ── 从 store 读取数据与动作 ───────────────────────────────
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const projects = useBoardStore((s) => s.projects);
  const states = useBoardStore((s) => s.states);
  const labels = useBoardStore((s) => s.labels);
  const updateProject = useBoardStore((s) => s.updateProject);
  const createState = useBoardStore((s) => s.createState);
  const updateState = useBoardStore((s) => s.updateState);
  const deleteState = useBoardStore((s) => s.deleteState);
  const createLabel = useBoardStore((s) => s.createLabel);
  const updateLabel = useBoardStore((s) => s.updateLabel);
  const deleteLabel = useBoardStore((s) => s.deleteLabel);

  const project = projects.find((p) => p.id === openedProjectId);

  // ── 顶层错误提示（承接抛出的错误，如删除守卫） ───────────
  const [error, setError] = useState<string | undefined>(undefined);

  // 统一执行异步动作并把错误浮到界面上
  async function run(fn: () => Promise<void>) {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) return null;

  return (
    /* 遮罩层 */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-sheet-title"
      className="fixed inset-0 z-50 flex justify-end bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 抽屉面板（阻止冒泡） */}
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题行 */}
        <div className="mb-5 flex items-center justify-between">
          <h2
            id="project-sheet-title"
            className="text-base font-semibold text-foreground"
          >
            项目设置
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            ✕
          </button>
        </div>

        {/* 顶层错误提示 */}
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {!project ? (
          <p className="text-sm text-muted-foreground">未打开任何项目。</p>
        ) : (
          <div className="flex flex-col gap-8">
            {/* ── 区块 1：项目基础字段 ─────────────────────── */}
            <ProjectFields
              key={project.id}
              name={project.name}
              description={project.description ?? ""}
              repoPath={project.repo_path ?? ""}
              archived={project.archived ?? false}
              onSave={(patch) => run(() => updateProject(project.id, patch))}
            />

            {/* ── 区块 2：状态列 ───────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">状态列</h3>
              <ul className="flex flex-col gap-2">
                {states.map((st, idx) => (
                  <li
                    key={st.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
                  >
                    {/* 颜色 */}
                    <input
                      type="color"
                      aria-label="状态颜色"
                      value={st.color}
                      onChange={(e) =>
                        run(() =>
                          updateState(st.id, { color: e.target.value }),
                        )
                      }
                      className="h-7 w-7 shrink-0 cursor-pointer rounded border border-input bg-background"
                    />
                    {/* 名称 */}
                    <input
                      type="text"
                      aria-label="状态名称"
                      defaultValue={st.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== st.name)
                          run(() => updateState(st.id, { name: v }));
                      }}
                      className={`${inputCls} min-w-0 flex-1`}
                    />
                    {/* 类别 */}
                    <select
                      aria-label="状态类别"
                      value={st.category}
                      onChange={(e) =>
                        run(() =>
                          updateState(st.id, {
                            category: e.target.value as StateCategory,
                          }),
                        )
                      }
                      className={`${inputCls} shrink-0`}
                    >
                      {CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {/* 上移 */}
                    <button
                      type="button"
                      aria-label="上移"
                      disabled={idx === 0}
                      onClick={() => run(() => reorderState(states, idx, -1))}
                      className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ↑
                    </button>
                    {/* 下移 */}
                    <button
                      type="button"
                      aria-label="下移"
                      disabled={idx === states.length - 1}
                      onClick={() => run(() => reorderState(states, idx, 1))}
                      className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ↓
                    </button>
                    {/* 删除 */}
                    <button
                      type="button"
                      aria-label="删除状态"
                      onClick={() => run(() => deleteState(st.id))}
                      className="rounded p-1 text-destructive hover:bg-destructive/10"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {/* 新增状态行 */}
              <AddStateRow onAdd={(input) => run(() => createState(input))} />
            </section>

            {/* ── 区块 3：标签 ─────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">标签</h3>
              <ul className="flex flex-col gap-2">
                {labels.map((lb) => (
                  <li
                    key={lb.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-background p-2"
                  >
                    {/* 颜色 */}
                    <input
                      type="color"
                      aria-label="标签颜色"
                      value={lb.color}
                      onChange={(e) =>
                        run(() =>
                          updateLabel(lb.id, { color: e.target.value }),
                        )
                      }
                      className="h-7 w-7 shrink-0 cursor-pointer rounded border border-input bg-background"
                    />
                    {/* 名称 */}
                    <input
                      type="text"
                      aria-label="标签名称"
                      defaultValue={lb.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== lb.name)
                          run(() => updateLabel(lb.id, { name: v }));
                      }}
                      className={`${inputCls} min-w-0 flex-1`}
                    />
                    {/* 删除 */}
                    <button
                      type="button"
                      aria-label="删除标签"
                      onClick={() => run(() => deleteLabel(lb.id))}
                      className="rounded p-1 text-destructive hover:bg-destructive/10"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              {/* 新增标签行 */}
              <AddLabelRow onAdd={(input) => run(() => createLabel(input))} />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 状态列重排辅助：把 idx 处的项与其相邻项交换，再按 normalizeSortOrders 重排全部 sort_order。
async function reorderState(
  states: { id: string; sort_order: number }[],
  idx: number,
  dir: -1 | 1,
): Promise<void> {
  const store = useBoardStore.getState();
  const ordered = [...states].sort((a, b) => a.sort_order - b.sort_order);
  const target = idx + dir;
  if (target < 0 || target >= ordered.length) return;
  // 交换位置
  const swap = ordered[idx];
  ordered[idx] = ordered[target];
  ordered[target] = swap;
  // 归一化重新分配 sort_order，逐个写回受影响项
  const orders = normalizeSortOrders(ordered.length);
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].sort_order !== orders[i]) {
      await store.updateState(ordered[i].id, { sort_order: orders[i] });
    }
  }
}

// ── 子组件：项目基础字段表单 ───────────────────────────────
interface ProjectFieldsProps {
  name: string;
  description: string;
  repoPath: string;
  archived: boolean;
  onSave: (patch: {
    name: string;
    description: string;
    repo_path: string;
  }) => Promise<void> | void;
}

function ProjectFields({
  name: initName,
  description: initDesc,
  repoPath: initRepo,
  archived,
  onSave,
}: ProjectFieldsProps) {
  const updateProject = useBoardStore((s) => s.updateProject);
  const openedProjectId = useBoardStore((s) => s.openedProjectId);
  const [name, setName] = useState(initName);
  const [description, setDescription] = useState(initDesc);
  const [repoPath, setRepoPath] = useState(initRepo);

  // 项目切换时同步本地表单
  useEffect(() => {
    setName(initName);
    setDescription(initDesc);
    setRepoPath(initRepo);
  }, [initName, initDesc, initRepo]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void onSave({
      name: name.trim(),
      description: description.trim(),
      repo_path: repoPath.trim(),
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">基础信息</h3>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          名称
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          描述
          <textarea
            value={description}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputCls} resize-none`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
          仓库路径
          <input
            type="text"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/path/to/repo"
            className={inputCls}
          />
        </label>
        {/* 归档开关 */}
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              if (openedProjectId)
                void updateProject(openedProjectId, {
                  archived: e.target.checked,
                });
            }}
            className="h-4 w-4 rounded border-input accent-primary"
          />
          已归档
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            保存
          </button>
        </div>
      </form>
    </section>
  );
}

// ── 子组件：新增状态行 ─────────────────────────────────────
interface AddStateRowProps {
  onAdd: (input: {
    name: string;
    color: string;
    category: StateCategory;
  }) => Promise<void> | void;
}

function AddStateRow({ onAdd }: AddStateRowProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const [category, setCategory] = useState<StateCategory>("pending");

  function handleAdd() {
    const v = name.trim();
    if (!v) return;
    void Promise.resolve(onAdd({ name: v, color, category })).then(() => {
      // 成功后仅重置名称，保留颜色/类别便于连续录入
      setName("");
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2">
      <input
        type="color"
        aria-label="新状态颜色"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-input bg-background"
      />
      <input
        type="text"
        aria-label="新状态名称"
        value={name}
        placeholder="新状态名称"
        onChange={(e) => setName(e.target.value)}
        className={`${inputCls} min-w-0 flex-1`}
      />
      <select
        aria-label="新状态类别"
        value={category}
        onChange={(e) => setCategory(e.target.value as StateCategory)}
        className={`${inputCls} shrink-0`}
      >
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleAdd}
        disabled={!name.trim()}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        添加
      </button>
    </div>
  );
}

// ── 子组件：新增标签行 ─────────────────────────────────────
interface AddLabelRowProps {
  onAdd: (input: { name: string; color: string }) => Promise<void> | void;
}

function AddLabelRow({ onAdd }: AddLabelRowProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");

  function handleAdd() {
    const v = name.trim();
    if (!v) return;
    void Promise.resolve(onAdd({ name: v, color })).then(() => setName(""));
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2">
      <input
        type="color"
        aria-label="新标签颜色"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-input bg-background"
      />
      <input
        type="text"
        aria-label="新标签名称"
        value={name}
        placeholder="新标签名称"
        onChange={(e) => setName(e.target.value)}
        className={`${inputCls} min-w-0 flex-1`}
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!name.trim()}
        className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        添加
      </button>
    </div>
  );
}
