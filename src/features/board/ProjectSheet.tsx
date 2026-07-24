// 项目设置侧边抽屉：编辑当前打开项目的基础字段、状态列、标签。
// 移植自 workavera 的 edit-mode 交互（草稿式行内编辑 + 保存/删除），
// 但完全走本仓库的 useBoardStore，本组件不直接访问 PB / invoke。
import { useState, useEffect, useMemo } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  Add01Icon,
  AiChat02Icon,
} from "@hugeicons/core-free-icons"

import { ipc } from "@/lib/tauri/ipc"
import { useSettingsStore } from "@/store/settings"
import { buildProjectContext } from "@/features/ai/project-context"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ColorPicker } from "@/components/ui/color-picker"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import { useBoardStore } from "@/store/board"
import { normalizeSortOrders } from "@/store/board-rank"
import { STATE_CATEGORY_META, STATE_CATEGORY_ORDER } from "@/features/board/board-meta"
import type { BoardState, BoardLabel, StateCategory } from "@/types/board"

// ── Props（board 页面依赖此签名，勿改） ─────────────────────────
interface ProjectSheetProps {
  /** 是否打开抽屉 */
  open: boolean
  /** 关闭回调 */
  onClose: () => void
}

// 状态类别下拉的固定顺序（复用共享元数据的中文标签）
const CATEGORY_OPTIONS: { value: StateCategory; label: string }[] =
  STATE_CATEGORY_ORDER.map((value) => ({
    value,
    label: STATE_CATEGORY_META[value].label,
  }))

// 新增行的默认颜色（中性灰）
const DEFAULT_COLOR = "#64748b"

/**
 * 项目设置抽屉（受控）。作用于 store 中当前打开的项目（openedProjectId）。
 * 顶部承接子区块抛出的错误（如删除守卫），统一以 alert 展示。
 */
export function ProjectSheet({ open, onClose }: ProjectSheetProps) {
  const openedProjectId = useBoardStore((s) => s.openedProjectId)
  const projects = useBoardStore((s) => s.projects)
  const closeProject = useBoardStore((s) => s.closeProject)
  const project = projects.find((p) => p.id === openedProjectId)

  // 项目删除后：关抽屉 + 关闭当前项目（回到项目列表）
  const handleDeleted = () => {
    onClose()
    closeProject()
  }

  // 顶层错误：由各子区块通过 onError 回调上抛
  const [error, setError] = useState<string | undefined>(undefined)

  // 抽屉关闭时清空残留错误，避免下次打开时误显示
  useEffect(() => {
    if (!open) setError(undefined)
  }, [open])

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg!">
        <SheetHeader>
          <SheetTitle>项目设置</SheetTitle>
          <SheetDescription>编辑项目的基础信息、状态列与标签。</SheetDescription>
        </SheetHeader>

        {/* 顶层错误横幅 */}
        {error && (
          <div className="px-6 pb-2">
            <p
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          </div>
        )}

        {!project ? (
          <div className="px-6 py-8 text-sm text-muted-foreground">
            未打开任何项目。
          </div>
        ) : (
          <div className="flex flex-col gap-6 overflow-y-auto px-6 pb-6">
            {/* ── 区块 1：基础信息 ───────────────────────────── */}
            <ProjectFields
              key={project.id}
              projectId={project.id}
              onError={setError}
              onDeleted={handleDeleted}
            />

            <Separator />

            {/* ── 区块 2：状态列 ─────────────────────────────── */}
            <StatesSection onError={setError} />

            <Separator />

            {/* ── 区块 3：标签 ───────────────────────────────── */}
            <LabelsSection onError={setError} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// 各子区块统一的错误上抛回调类型
type OnError = (msg: string | undefined) => void

/** 从 unknown 提取人类可读的错误信息。 */
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ── 子组件：项目基础字段 ─────────────────────────────────────────
function ProjectFields({
  projectId,
  onError,
  onDeleted,
}: {
  projectId: string
  onError: OnError
  /** 删除成功后的回调（关抽屉 + 关项目） */
  onDeleted: () => void
}) {
  const projects = useBoardStore((s) => s.projects)
  const updateProject = useBoardStore((s) => s.updateProject)
  const deleteProject = useBoardStore((s) => s.deleteProject)
  const project = projects.find((p) => p.id === projectId)

  // 本地草稿：编辑期间不直接改 store，保存/失焦时才写回
  const [name, setName] = useState(project?.name ?? "")
  const [description, setDescription] = useState(project?.description ?? "")
  const [repoPath, setRepoPath] = useState(project?.repo_path ?? "")
  const archived = project?.archived ?? false
  // AI 生成描述 / 删除确认
  const [aiBusy, setAiBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 删除时是否同时删除「仅属于本项目」的文档（默认否，只解除关联）
  const [deleteDocs, setDeleteDocs] = useState(false)

  // 项目切换时同步草稿（key 已按 projectId 隔离，此处兜底 store 侧更新）
  useEffect(() => {
    setName(project?.name ?? "")
    setDescription(project?.description ?? "")
    setRepoPath(project?.repo_path ?? "")
  }, [project?.name, project?.description, project?.repo_path])

  if (!project) return null

  // 统一写回：仅提交发生变化的字段，失败时把错误上抛到顶层
  async function patch(next: Partial<{
    name: string
    description: string
    repo_path: string
    archived: boolean
  }>) {
    onError(undefined)
    try {
      await updateProject(projectId, next)
    } catch (e) {
      onError(errMessage(e))
    }
  }

  // 失焦保存单个文本字段（仅在有实际变化时写回）
  function saveField(
    field: "name" | "description" | "repo_path",
    value: string,
    current: string,
  ) {
    const v = value.trim()
    if (v === (current ?? "").trim()) return
    void patch({ [field]: v })
  }

  // AI 分析生成项目描述：取项目文档 + 关联会话上下文 → AI 概括 → 填入并保存
  async function generateDescription() {
    if (!project || aiBusy) return
    const cfg = useSettingsStore.getState().aiConfig
    const isCli = cfg.provider === "claude-cli" || cfg.provider === "codex-cli"
    if (!isCli && !cfg.api_key) {
      onError("尚未配置 AI 服务（在设置页填 API Key，或改用本地 CLI provider）")
      return
    }
    setAiBusy(true)
    onError(undefined)
    try {
      const ctx = await buildProjectContext(projectId, project.repo_path, project.name)
      const reply = await ipc.aiChat(
        cfg,
        [
          {
            role: "system",
            content:
              "你是项目分析助手。根据给定的项目资料（文档/关联会话），用一句简洁中文概括这个项目是做什么的（不超过 60 字），直接输出描述本身，不要任何解释、前缀或引号。",
          },
          { role: "user", content: ctx || `项目名：${project.name}` },
        ],
        project.repo_path,
      )
      const desc = reply.trim().replace(/^["「『]+|["」』]+$/g, "").slice(0, 300)
      if (desc) {
        setDescription(desc)
        void patch({ description: desc })
        toast.success("已由 AI 生成描述")
      }
    } catch (e) {
      onError(`AI 生成失败：${errMessage(e)}`)
    } finally {
      setAiBusy(false)
    }
  }

  // 删除项目（仅归档后可见入口；二次确认后执行）
  async function handleDelete() {
    if (!project || deleting) return
    setDeleting(true)
    onError(undefined)
    try {
      await deleteProject(projectId, { deleteDocs })
      setConfirmDelete(false)
      onDeleted()
    } catch (e) {
      onError(errMessage(e))
      setDeleting(false)
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <Label className="text-sm font-semibold">基础信息</Label>

      {/* 名称 */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ps-name" className="text-xs text-muted-foreground">
          名称
        </Label>
        <Input
          id="ps-name"
          value={name}
          placeholder="项目名称"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveField("name", name, project.name)}
        />
      </div>

      {/* 描述（可 AI 分析生成） */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ps-desc" className="text-xs text-muted-foreground">
            描述
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={aiBusy}
            onClick={() => void generateDescription()}
            className="gap-1 text-xs text-muted-foreground hover:text-primary"
            title="根据项目文档与关联会话，AI 概括项目在做什么"
          >
            <HugeiconsIcon icon={AiChat02Icon} strokeWidth={2} className="size-3.5" />
            {aiBusy ? "生成中…" : "AI 生成"}
          </Button>
        </div>
        <Textarea
          id="ps-desc"
          value={description}
          placeholder="项目描述（可选，可点「AI 生成」自动概括）"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() =>
            saveField("description", description, project.description ?? "")
          }
        />
      </div>

      {/* 仓库路径 */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ps-repo" className="text-xs text-muted-foreground">
          仓库路径
        </Label>
        <Input
          id="ps-repo"
          value={repoPath}
          placeholder="/path/to/repo"
          onChange={(e) => setRepoPath(e.target.value)}
          onBlur={() => saveField("repo_path", repoPath, project.repo_path ?? "")}
        />
      </div>

      {/* 归档开关：无 switch 原语，使用带样式的 checkbox */}
      <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm text-foreground select-none">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => void patch({ archived: e.target.checked })}
          className="size-4 cursor-pointer rounded border-input accent-primary"
        />
        <span>已归档</span>
        <span className="text-xs text-muted-foreground">
          （归档后项目将从看板列表隐藏）
        </span>
      </label>

      {/* 删除项目：仅归档后可用（先归档再删，防误删）。级联删任务/状态列/标签，文档只断链保留 */}
      {archived ? (
        <div className="pt-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={() => {
              setDeleteDocs(false) // 每次打开默认不勾
              setConfirmDelete(true)
            }}
            className="text-destructive hover:text-destructive"
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            删除项目
          </Button>
        </div>
      ) : (
        <p className="pt-1 text-xs text-muted-foreground/70">
          需先「归档」项目，才能删除（防误删）。
        </p>
      )}

      {/* 删除二次确认 */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除项目「{project.name}」？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5">
                <p>将永久删除该项目及其任务、状态列、标签，无法撤销。</p>
                <p className="text-foreground">
                  不会删除本地仓库文件 / git / 会话记录。关联文档默认<strong>仅解除关联、保留</strong>。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* 可选：同时删除仅属于本项目的文档（共享文档仍只解除关联） */}
          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm select-none">
            <input
              type="checkbox"
              checked={deleteDocs}
              onChange={(e) => setDeleteDocs(e.target.checked)}
              disabled={deleting}
              className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-input accent-destructive"
            />
            <span>
              同时删除本项目的文档
              <span className="mt-0.5 block text-xs text-muted-foreground">
                仅删除<strong>只属于本项目</strong>的文档；与其他项目共享的文档仍只解除关联、不删除。
              </span>
            </span>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
            >
              {deleting ? "删除中…" : "删除项目"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ── 子组件：状态列区块 ───────────────────────────────────────────
function StatesSection({ onError }: { onError: OnError }) {
  const states = useBoardStore((s) => s.states)
  const createState = useBoardStore((s) => s.createState)

  // 按 sort_order 排序，作为本区块的稳定顺序（useMemo：states 变才重排，稳定引用）
  const ordered = useMemo(
    () => [...states].sort((a, b) => a.sort_order - b.sort_order),
    [states],
  )

  return (
    <section className="flex flex-col gap-3">
      <Label className="text-sm font-semibold">状态列</Label>
      <div className="flex flex-col gap-2">
        {ordered.map((state, index) => (
          <StateRow
            key={state.id}
            state={state}
            index={index}
            total={ordered.length}
            ordered={ordered}
            onError={onError}
          />
        ))}
        <AddStateRow
          onAdd={async (input) => {
            onError(undefined)
            try {
              await createState(input)
            } catch (e) {
              onError(errMessage(e))
            }
          }}
        />
      </div>
    </section>
  )
}

// ── 子组件：单个状态行（草稿式行内编辑 + 保存/上下移/删除） ────────
function StateRow({
  state,
  index,
  total,
  ordered,
  onError,
}: {
  state: BoardState
  index: number
  total: number
  ordered: BoardState[]
  onError: OnError
}) {
  const updateState = useBoardStore((s) => s.updateState)
  const deleteState = useBoardStore((s) => s.deleteState)

  // 本地草稿：与 store 记录合并展示，保存后由 store 回流覆盖
  const [name, setName] = useState(state.name)
  const [color, setColor] = useState(state.color)
  const [category, setCategory] = useState<StateCategory>(state.category)
  const [saving, setSaving] = useState(false)

  // store 记录变化（如实时回流）时同步草稿
  useEffect(() => {
    setName(state.name)
    setColor(state.color)
    setCategory(state.category)
  }, [state.name, state.color, state.category])

  const dirty =
    name.trim() !== state.name ||
    color !== state.color ||
    category !== state.category

  // 保存当前行的所有变更
  async function handleSave() {
    if (!name.trim() || !dirty) return
    setSaving(true)
    onError(undefined)
    try {
      await updateState(state.id, {
        name: name.trim(),
        color,
        category,
      })
    } catch (e) {
      onError(errMessage(e))
    } finally {
      setSaving(false)
    }
  }

  // 上下移：交换相邻两项，用 normalizeSortOrders 归一化，仅写回变化项
  async function handleMove(dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= ordered.length) return
    const next = [...ordered]
    const tmp = next[index]
    next[index] = next[target]
    next[target] = tmp
    const orders = normalizeSortOrders(next.length)
    onError(undefined)
    try {
      for (let i = 0; i < next.length; i++) {
        if (next[i].sort_order !== orders[i]) {
          await updateState(next[i].id, { sort_order: orders[i] })
        }
      }
    } catch (e) {
      onError(errMessage(e))
    }
  }

  // 删除：store 在该状态仍有任务时会抛错，需把错误上抛
  async function handleDelete() {
    onError(undefined)
    try {
      await deleteState(state.id)
    } catch (e) {
      onError(errMessage(e))
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-[1fr_8rem_auto]">
      {/* 颜色 + 名称 */}
      <div className="flex items-center gap-2">
        <ColorPicker
          value={color}
          onChange={setColor}
          size={24}
          aria-label={`${state.name} 颜色`}
        />
        <Input
          value={name}
          placeholder="状态名称"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {/* 类别 */}
      <Select
        value={category}
        onValueChange={(v) => setCategory(v as StateCategory)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CATEGORY_OPTIONS.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* 操作：上移 / 下移 / 保存 / 删除 */}
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === 0}
          onClick={() => void handleMove(-1)}
          aria-label="上移"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === total - 1}
          onClick={() => void handleMove(1)}
          aria-label="下移"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!name.trim() || !dirty || saving}
          onClick={() => void handleSave()}
        >
          保存
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          onClick={() => void handleDelete()}
          aria-label="删除状态"
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </div>
    </div>
  )
}

// ── 子组件：新增状态行 ───────────────────────────────────────────
function AddStateRow({
  onAdd,
}: {
  onAdd: (input: {
    name: string
    color: string
    category: StateCategory
  }) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [category, setCategory] = useState<StateCategory>("pending")

  async function handleAdd() {
    const v = name.trim()
    if (!v) return
    await onAdd({ name: v, color, category })
    // 成功后仅清空名称，保留颜色/类别便于连续录入
    setName("")
  }

  return (
    <div className="grid gap-2 rounded-xl border border-dashed border-border p-3 md:grid-cols-[1fr_8rem_auto]">
      <div className="flex items-center gap-2">
        <ColorPicker
          value={color}
          onChange={setColor}
          size={24}
          aria-label="新状态颜色"
        />
        <Input
          value={name}
          placeholder="新状态名称"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd()
          }}
        />
      </div>
      <Select
        value={category}
        onValueChange={(v) => setCategory(v as StateCategory)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CATEGORY_OPTIONS.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-end">
        <Button size="sm" disabled={!name.trim()} onClick={() => void handleAdd()}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          添加
        </Button>
      </div>
    </div>
  )
}

// ── 子组件：标签区块 ─────────────────────────────────────────────
function LabelsSection({ onError }: { onError: OnError }) {
  const labels = useBoardStore((s) => s.labels)
  const createLabel = useBoardStore((s) => s.createLabel)

  return (
    <section className="flex flex-col gap-3">
      <Label className="text-sm font-semibold">标签</Label>
      <div className="flex flex-col gap-2">
        {labels.map((label) => (
          <LabelRow key={label.id} label={label} onError={onError} />
        ))}
        <AddLabelRow
          onAdd={async (input) => {
            onError(undefined)
            try {
              await createLabel(input)
            } catch (e) {
              onError(errMessage(e))
            }
          }}
        />
      </div>
    </section>
  )
}

// ── 子组件：单个标签行（草稿式行内编辑 + 保存 + 二次确认删除） ────
function LabelRow({
  label,
  onError,
}: {
  label: BoardLabel
  onError: OnError
}) {
  const updateLabel = useBoardStore((s) => s.updateLabel)
  const deleteLabel = useBoardStore((s) => s.deleteLabel)

  const [name, setName] = useState(label.name)
  const [color, setColor] = useState(label.color)
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    setName(label.name)
    setColor(label.color)
  }, [label.name, label.color])

  const dirty = name.trim() !== label.name || color !== label.color

  async function handleSave() {
    if (!name.trim() || !dirty) return
    setSaving(true)
    onError(undefined)
    try {
      await updateLabel(label.id, { name: name.trim(), color })
    } catch (e) {
      onError(errMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    onError(undefined)
    try {
      await deleteLabel(label.id)
      setConfirmOpen(false)
    } catch (e) {
      onError(errMessage(e))
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border p-3">
      <ColorPicker
        value={color}
        onChange={setColor}
        size={24}
        aria-label={`${label.name} 颜色`}
      />
      <Input
        value={name}
        placeholder="标签名称"
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        variant="ghost"
        size="sm"
        disabled={!name.trim() || !dirty || saving}
        onClick={() => void handleSave()}
      >
        保存
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
        aria-label={`删除标签 ${label.name}`}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
      </Button>

      {/* 删除二次确认 */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(v) => setConfirmOpen(v)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除标签？</AlertDialogTitle>
            <AlertDialogDescription>
              标签 <strong>{label.name}</strong> 将从本项目移除，使用该标签的任务也会解除关联。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                // 阻止 Radix 默认关闭，交由异步结果决定何时关闭
                e.preventDefault()
                void handleDelete()
              }}
            >
              删除标签
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── 子组件：新增标签行 ───────────────────────────────────────────
function AddLabelRow({
  onAdd,
}: {
  onAdd: (input: { name: string; color: string }) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [color, setColor] = useState(DEFAULT_COLOR)

  async function handleAdd() {
    const v = name.trim()
    if (!v) return
    await onAdd({ name: v, color })
    setName("")
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3">
      <ColorPicker
        value={color}
        onChange={setColor}
        size={24}
        aria-label="新标签颜色"
      />
      <Input
        value={name}
        placeholder="新标签名称"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleAdd()
        }}
      />
      <Button size="sm" disabled={!name.trim()} onClick={() => void handleAdd()}>
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
        添加
      </Button>
    </div>
  )
}
