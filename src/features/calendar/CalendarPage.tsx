// Calendar 页面 —— 月视图网格：按月浏览、在格子内查看/新建/编辑/删除事件。
// 组件仅调用 store；数据访问由 store 收口，绝不直接触碰 invoke / pb。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  addDays,
  differenceInCalendarDays,
  format,
  isSameMonth,
  isToday,
  isSameDay,
  parseISO,
  startOfDay,
  isWithinInterval,
} from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  KanbanIcon,
} from "@hugeicons/core-free-icons";

import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useCalendarStore } from "@/store/calendar";
import type { CalendarEvent } from "@/types/calendar";
import { listDueTasks, listProjects, updateTaskDueDate } from "@/lib/pb/board";
import type { BoardTask, BoardProject } from "@/types/board";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// 星期表头（周日起，与 startOfWeek 默认 weekStartsOn=0 对齐）
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

// 弹窗默认颜色（十六进制，供 <input type="color"> 使用）
const DEFAULT_COLOR = "#6366f1";

// 弹窗状态：open 控制显隐；editing 为编辑目标（无则新建）；dateStr 为预填日期
interface DialogState {
  open: boolean;
  editing?: CalendarEvent;
  dateStr?: string;
}

// 表单字段集合（日期均为 yyyy-MM-dd 字符串，直接透传 store）
interface FormState {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  color: string;
  description: string;
  project: string;
}

// 拖拽载荷：事件带 start/end（改期时保留时长），任务只需 id
type DragPayload =
  | { kind: "event"; id: string; start: string; end: string }
  | { kind: "task"; id: string };

/**
 * 判断事件 ev 是否覆盖某一天 day。
 * 覆盖区间为 [start 当日 00:00, (end || start) 当日 00:00]，闭区间。
 * 解析失败（非法日期）时跳过该事件，避免整页崩溃。
 */
function eventCoversDay(ev: CalendarEvent, day: Date): boolean {
  try {
    const start = startOfDay(parseISO(ev.start));
    // end 可能为空串 —— 回退到 start，表示单日事件
    const end = startOfDay(parseISO(ev.end || ev.start));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return false;
    }
    return isWithinInterval(startOfDay(day), { start, end });
  } catch {
    return false;
  }
}

/** 判断带 due_date 的任务是否落在某一天（安全解析）。 */
function taskOnDay(t: BoardTask, day: Date): boolean {
  if (!t.due_date) return false;
  try {
    return isSameDay(startOfDay(parseISO(t.due_date)), startOfDay(day));
  } catch {
    return false;
  }
}

/** 将 ISO 字符串安全格式化为 yyyy-MM-dd；空串或解析失败返回空串 */
function toDateInput(iso: string): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "yyyy-MM-dd");
  } catch {
    return "";
  }
}

/** 根据弹窗状态推导表单初值（编辑回填 / 新建预填日期） */
function initialForm(state: DialogState): FormState {
  if (state.editing) {
    const ev = state.editing;
    return {
      title: ev.title,
      start: toDateInput(ev.start),
      end: toDateInput(ev.end),
      all_day: ev.all_day,
      color: ev.color || DEFAULT_COLOR,
      description: ev.description,
      project: ev.project || "",
    };
  }
  // 新建：起始日预填为点击的日期（或今天）
  const dateStr = state.dateStr || format(new Date(), "yyyy-MM-dd");
  return {
    title: "",
    start: dateStr,
    end: "",
    all_day: false,
    color: DEFAULT_COLOR,
    description: "",
    project: "",
  };
}

export default function CalendarPage() {
  const events = useCalendarStore((s) => s.events);
  const loading = useCalendarStore((s) => s.loading);
  const error = useCalendarStore((s) => s.error);
  const addEvent = useCalendarStore((s) => s.addEvent);
  const updateEvent = useCalendarStore((s) => s.updateEvent);
  const removeEvent = useCalendarStore((s) => s.removeEvent);
  const navigate = useNavigate();

  // 跨项目聚合的「带 due_date 的看板任务」（只读叠加到日历）
  const [dueTasks, setDueTasks] = useState<BoardTask[]>([]);
  // 项目列表（用于事件的「关联项目」下拉）
  const [projects, setProjects] = useState<BoardProject[]>([]);

  // 当前浏览的月份（取任意一天即可代表该月）
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  // 弹窗状态
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  // 表单状态
  const [form, setForm] = useState<FormState>(() =>
    initialForm({ open: false }),
  );
  // 拖拽改期：当前被拖动项 + 悬停高亮的目标日（yyyy-MM-dd）
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // 挂载时加载数据；卸载时清理订阅
  useEffect(() => {
    void useCalendarStore.getState().load();
    return () => {
      useCalendarStore.getState().close();
    };
  }, []);

  // 聚合看板任务的 due_date（跨项目，只读；失败不阻断日历）
  useEffect(() => {
    void listDueTasks()
      .then(setDueTasks)
      .catch(() => {});
  }, []);

  // 项目列表（供「关联项目」下拉）
  useEffect(() => {
    void listProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);

  // 计算网格覆盖的所有日期：从当月首日所在周的周日，到末日所在周的周六
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewDate));
    const gridEnd = endOfWeek(endOfMonth(viewDate));
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewDate]);

  // 打开新建弹窗（可携带预填日期）
  const openAdd = (dateStr?: string) => {
    const next: DialogState = { open: true, dateStr };
    setForm(initialForm(next));
    setDialog(next);
  };

  // 打开编辑弹窗（回填该事件）
  const openEdit = (ev: CalendarEvent) => {
    const next: DialogState = { open: true, editing: ev };
    setForm(initialForm(next));
    setDialog(next);
  };

  // 关闭弹窗
  const closeDialog = () => setDialog({ open: false });

  // 保存：新建走 addEvent，编辑走 updateEvent；日期字符串直接透传 store
  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) return; // 标题必填
    const payload = {
      title,
      start: form.start,
      end: form.end || undefined,
      all_day: form.all_day,
      color: form.color,
      description: form.description.trim(),
      project: form.project, // 空串 = 不关联
    };
    if (dialog.editing) {
      await updateEvent(dialog.editing.id, payload);
    } else {
      await addEvent(payload);
    }
    closeDialog();
  };

  // 删除（仅编辑态可用）
  const handleDelete = async () => {
    if (!dialog.editing) return;
    await removeEvent(dialog.editing.id);
    closeDialog();
  };

  // 拖拽放到某天：事件平移(保留时长)改 start/end；任务改 due_date（乐观 + 失败回滚）
  const handleDropOnDay = async (day: Date) => {
    const d = drag;
    setDrag(null);
    setDragOverKey(null);
    if (!d) return;
    const dayStr = format(day, "yyyy-MM-dd");

    if (d.kind === "task") {
      const prev = dueTasks;
      // 乐观：本地先把该任务移到目标日
      setDueTasks((ts) =>
        ts.map((t) => (t.id === d.id ? { ...t, due_date: dayStr } : t)),
      );
      try {
        await updateTaskDueDate(d.id, dayStr);
      } catch {
        setDueTasks(prev); // 回滚
      }
      return;
    }

    // 事件：以 start 为锚点计算位移，end 同步平移以保留时长
    const origStart = startOfDay(parseISO(d.start));
    if (Number.isNaN(origStart.getTime())) return;
    const delta = differenceInCalendarDays(startOfDay(day), origStart);
    if (delta === 0) return;
    const patch: { start: string; end?: string } = { start: dayStr };
    if (d.end) {
      const newEnd = addDays(startOfDay(parseISO(d.end)), delta);
      if (!Number.isNaN(newEnd.getTime())) patch.end = format(newEnd, "yyyy-MM-dd");
    }
    await updateEvent(d.id, patch);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 头部：当前月份标题 + 月份切换 + 新建 */}
      <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          {format(viewDate, "yyyy 年 M 月")}
        </h1>

        <div className="flex items-center gap-2">
          {/* 加载 / 错误状态（低调展示于按钮区左侧） */}
          {loading && (
            <span className="text-xs text-muted-foreground">加载中…</span>
          )}
          {error && (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          )}

          <Button
            variant="outline"
            size="icon"
            aria-label="上个月"
            onClick={() => setViewDate(addMonths(viewDate, -1))}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <Button variant="outline" onClick={() => setViewDate(new Date())}>
            今天
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="下个月"
            onClick={() => setViewDate(addMonths(viewDate, 1))}
          >
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
          <Button onClick={() => openAdd(format(new Date(), "yyyy-MM-dd"))}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            新建
          </Button>
        </div>
      </header>

      {/* 星期表头：7 列 */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>

      {/* 月网格：填满剩余高度，每格为带边框的盒子 */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
        {days.map((day) => {
          const outside = !isSameMonth(day, viewDate); // 非本月的补充日
          const today = isToday(day);
          // 该天覆盖的事件（跳过非法日期）
          const dayEvents = events.filter((ev) => eventCoversDay(ev, day));
          const dayTasks = dueTasks.filter((t) => taskOnDay(t, day));

          const dayKey = format(day, "yyyy-MM-dd");
          return (
            <div
              key={day.toISOString()}
              onClick={() => openAdd(dayKey)}
              // 拖拽改期：允许放置 + 悬停高亮 + 放下时改期
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (dragOverKey !== dayKey) setDragOverKey(dayKey);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void handleDropOnDay(day);
              }}
              className={cn(
                "flex min-h-24 cursor-pointer flex-col gap-1 border-r border-b border-border p-1.5 text-left transition-colors hover:bg-muted/40",
                outside && "bg-muted/20",
                dragOverKey === dayKey && "ring-2 ring-inset ring-primary bg-primary/5",
              )}
            >
              {/* 日期数字：右上；非本月置灰；今天为主色实心圆 */}
              <div className="flex justify-end">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    outside && "text-muted-foreground",
                    today && "bg-primary font-medium text-primary-foreground",
                  )}
                >
                  {format(day, "d")}
                </span>
              </div>

              {/* 事件小片列表 */}
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                {dayEvents.map((ev) => (
                  <ContextMenu key={ev.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDrag({ kind: "event", id: ev.id, start: ev.start, end: ev.end || "" });
                        }}
                        onDragEnd={() => {
                          setDrag(null);
                          setDragOverKey(null);
                        }}
                        onClick={(e) => {
                          e.stopPropagation(); // 阻止冒泡到格子的新建
                          openEdit(ev);
                        }}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                        title={ev.title}
                      >
                        {/* 颜色圆点：事件自定义颜色（用户数据）走内联样式 */}
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            background: ev.color || "var(--color-primary)",
                          }}
                        />
                        <span className="truncate text-foreground">{ev.title}</span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => openEdit(ev)}>编辑</ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => void removeEvent(ev.id)}
                      >
                        删除
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}

                {/* 看板任务 due_date（只读叠加，点击跳到该任务的项目工作台） */}
                {dayTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDrag({ kind: "task", id: t.id });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setDragOverKey(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/board?open=${t.project}`);
                    }}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                    title={`任务：${t.title}（可拖到其它日期改期）`}
                  >
                    <HugeiconsIcon
                      icon={KanbanIcon}
                      strokeWidth={2}
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate text-muted-foreground">
                      {t.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 新建 / 编辑弹窗 */}
      <Dialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.editing ? "编辑事件" : "新建事件"}</DialogTitle>
          </DialogHeader>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            {/* 标题（必填） */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-title">标题</Label>
              <Input
                id="cal-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="事件标题"
                required
              />
            </div>

            {/* 开始 / 结束日期 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cal-start">开始日期</Label>
                <Input
                  id="cal-start"
                  type="date"
                  value={form.start}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, start: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cal-end">结束日期</Label>
                <Input
                  id="cal-end"
                  type="date"
                  value={form.end}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, end: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* 全天 + 颜色 */}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="cal-allday" className="cursor-pointer">
                <input
                  id="cal-allday"
                  type="checkbox"
                  checked={form.all_day}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, all_day: e.target.checked }))
                  }
                  className="size-4 accent-primary"
                />
                全天
              </Label>
              <Label htmlFor="cal-color" className="cursor-pointer">
                颜色
                <input
                  id="cal-color"
                  type="color"
                  value={form.color}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, color: e.target.value }))
                  }
                  className="size-8 cursor-pointer rounded border border-input bg-transparent"
                />
              </Label>
            </div>

            {/* 关联项目（可选） */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-project">关联项目（可选）</Label>
              <Select
                value={form.project || "none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, project: v === "none" ? "" : v }))
                }
              >
                <SelectTrigger id="cal-project" className="w-full">
                  <SelectValue placeholder="不关联" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不关联</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 描述 */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-desc">描述</Label>
              <Textarea
                id="cal-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="补充说明（可选）"
              />
            </div>

            <DialogFooter className="items-center">
              {/* 编辑态提供删除（危险操作），左对齐 */}
              {dialog.editing && (
                <Button
                  type="button"
                  variant="destructive"
                  className="mr-auto"
                  onClick={() => void handleDelete()}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  删除
                </Button>
              )}
              <Button type="button" variant="outline" onClick={closeDialog}>
                取消
              </Button>
              <Button type="submit" disabled={!form.title.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
