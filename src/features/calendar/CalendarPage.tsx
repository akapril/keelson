// Calendar 页面 —— 月视图网格：按月浏览、在格子内查看/新建/编辑/删除事件。
// 组件仅调用 store；数据访问由 store 收口，绝不直接触碰 invoke / pb。
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
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
import { parseQuickLog } from "@/lib/calendar/quick-log";
import { collectMaterial } from "@/features/report/generateReport";
import { computeRange } from "@/features/report/report-range";
import type { ReportMaterial } from "@/features/report/report-collect";
import type { CalendarEvent } from "@/types/calendar";
import { listDueTasks, listProjects, updateTaskDueDate } from "@/lib/pb/board";
import type { BoardTask, BoardProject } from "@/types/board";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { toast } from "sonner";
import {
  expandRecurringEvents,
  REPEAT_OPTIONS,
  parseRepeat,
  buildRepeat,
} from "./recurrence";
import AgendaView from "./AgendaView";
import WeekView from "./WeekView";
import DayView from "./DayView";
import { minutesToHM, addMinutesToHM, durationMin } from "./timeGrid";

// 弹窗默认颜色（十六进制，供 <input type="color"> 使用）
const DEFAULT_COLOR = "#6366f1";

// 月视图每格最多显示的事件条数；超出折叠为「+N 更多」→ 点击跳该天日视图看全部
const MONTH_CELL_MAX_EVENTS = 3;

// 日历视图种类
type CalendarView = "month" | "week" | "day" | "agenda";
// 视图偏好持久化的 localStorage 键
const VIEW_STORAGE_KEY = "keelson-calendar-view";

/** 从 localStorage 读取上次选中的视图（非法值回退 month）。 */
function loadInitialView(): CalendarView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "month" || v === "week" || v === "day" || v === "agenda") return v;
  } catch {
    /* localStorage 不可用时静默回退 */
  }
  return "month";
}

// 弹窗状态：open 控制显隐；editing 为编辑目标（无则新建）；dateStr 为预填日期。
// startTime/endTime 为可选预填时刻（点空白时段新建时按落点填充；月视图点格子不带）。
interface DialogState {
  open: boolean;
  editing?: CalendarEvent;
  dateStr?: string;
  /** 预填开始时刻 "HH:mm"（点时间轴空白新建时用；不带=沿用无时刻默认） */
  startTime?: string;
  /** 预填结束时刻 "HH:mm"（点时间轴空白新建时用；一般为 startTime + 1h） */
  endTime?: string;
}

// 表单字段集合（日期均为 yyyy-MM-dd 字符串，直接透传 store）
interface FormState {
  title: string;
  start: string;
  end: string;
  /** 开始时刻 "HH:mm"（仅非全天时使用） */
  startTime: string;
  /** 结束时刻 "HH:mm"（仅非全天时使用） */
  endTime: string;
  all_day: boolean;
  color: string;
  description: string;
  project: string;
  /** 重复单位（""=不重复 / daily / weekly / monthly / yearly） */
  repeatUnit: string;
  /** 周期步长 N（每 N 个单位） */
  repeatInterval: number;
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
function taskOnDay(task: BoardTask, day: Date): boolean {
  if (!task.due_date) return false;
  try {
    return isSameDay(startOfDay(parseISO(task.due_date)), startOfDay(day));
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
      startTime: ev.start_time || "", // 回填开始时刻
      endTime: ev.end_time || "", // 回填结束时刻
      all_day: ev.all_day,
      color: ev.color || DEFAULT_COLOR,
      description: ev.description,
      project: ev.project || "",
      repeatUnit: parseRepeat(ev.repeat)?.unit ?? "",
      repeatInterval: parseRepeat(ev.repeat)?.interval ?? 1,
    };
  }
  // 新建：起始日预填为点击的日期（或今天）；点时间轴空白时另带落点时刻（非全天定时事件）
  const dateStr = state.dateStr || format(new Date(), "yyyy-MM-dd");
  return {
    title: "",
    start: dateStr,
    end: "",
    // 落点时刻优先；否则预填「当前时刻」——按下新建即带上此刻，贴合「记录刚做了什么」
    startTime: state.startTime || format(new Date(), "HH:mm"),
    endTime: state.endTime || "",
    all_day: false, // 新建默认非全天（带落点时刻时即为定时事件）
    color: DEFAULT_COLOR,
    description: "",
    project: "",
    repeatUnit: "",
    repeatInterval: 1,
  };
}

/** 根据当前语言格式化月份标题（中文：yyyy 年 M 月；英文：MMMM yyyy） */
function formatMonthTitle(date: Date): string {
  if (i18n.language.startsWith("zh")) {
    return format(date, "yyyy") + " 年 " + format(date, "M") + " 月";
  }
  return format(date, "MMMM yyyy");
}

/** 根据当前语言格式化单日标题（中文：yyyy 年 M 月 d 日；英文：MMMM d, yyyy） */
function formatDayTitle(date: Date): string {
  if (i18n.language.startsWith("zh")) {
    return (
      format(date, "yyyy") + " 年 " + format(date, "M") + " 月 " + format(date, "d") + " 日"
    );
  }
  return format(date, "MMMM d, yyyy");
}

export default function CalendarPage() {
  const { t } = useTranslation("calendar");

  // 星期表头（周日起，与 startOfWeek 默认 weekStartsOn=0 对齐）
  const weekdays = t("page.weekdays", { returnObjects: true }) as string[];

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
  // 「今日活动」自动汇入（今天的提交/完成任务/会话，只读）——议程视图展示
  const [todayActivity, setTodayActivity] = useState<ReportMaterial | null>(null);

  // 当前浏览的月份（取任意一天即可代表该月）
  const [viewDate, setViewDate] = useState<Date>(() => new Date());
  // 当前视图（月/周/日/议程），持久化到 localStorage
  const [view, setView] = useState<CalendarView>(() => loadInitialView());

  // 切换视图并持久化偏好
  const changeView = (next: CalendarView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* localStorage 不可用时静默忽略 */
    }
  };
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

  // 议程视图打开时采集「今日活动」（今天的提交/完成任务/会话），只读汇入；失败静默不阻断
  useEffect(() => {
    if (view !== "agenda") return;
    let alive = true;
    void collectMaterial(computeRange("today", new Date()), "all")
      .then((m) => {
        if (alive) setTodayActivity(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [view]);

  // 计算网格覆盖的所有日期：从当月首日所在周的周日，到末日所在周的周六
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(viewDate));
    const gridEnd = endOfWeek(endOfMonth(viewDate));
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [viewDate]);

  // 把重复事件在网格可视区间展开成 occurrence（只读）；非重复事件原样。occurrence 携带母 id。
  const expandedEvents = useMemo(
    () =>
      days.length > 0
        ? expandRecurringEvents(events, days[0], days[days.length - 1])
        : events,
    [events, days],
  );

  // 议程视图专用：把重复事件在「今天起未来 30 天」区间内展开（与月网格区间不同）
  const agendaEvents = useMemo(() => {
    if (view !== "agenda") return events; // 非议程视图不额外计算
    const start = startOfDay(new Date());
    const end = addDays(start, 29); // 含今天共 30 天
    return expandRecurringEvents(events, start, end);
  }, [events, view]);

  // 周视图的 7 天：以 viewDate（游标）所在周展开。周起始与月网格一致（同用 startOfWeek 默认 weekStartsOn=0）。
  const weekDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(viewDate),
        end: endOfWeek(viewDate),
      }),
    [viewDate],
  );

  // 周视图专用：把重复事件在「当前周 7 天」区间内展开（仅周视图时计算）
  const weekEvents = useMemo(() => {
    if (view !== "week") return events; // 非周视图不额外计算
    return expandRecurringEvents(events, weekDays[0], weekDays[weekDays.length - 1]);
  }, [events, view, weekDays]);

  // 日视图专用：把重复事件在「viewDate 当天」区间内展开（仅日视图时计算）
  const dayEvents = useMemo(() => {
    if (view !== "day") return events; // 非日视图不额外计算
    const d = startOfDay(viewDate);
    return expandRecurringEvents(events, d, d);
  }, [events, view, viewDate]);

  // 打开新建弹窗（可携带预填日期 + 可选落点时刻，用于点时段新建）
  const openAdd = (dateStr?: string, startTime?: string, endTime?: string) => {
    const next: DialogState = { open: true, dateStr, startTime, endTime };
    setForm(initialForm(next));
    setDialog(next);
  };

  // 点周/日视图时间轴空白：按落点时刻（吸附 15 分）新建，预填 start_time + end_time(+1h)。
  const handleTimedAdd = (day: Date, startMin?: number) => {
    const dateStr = format(day, "yyyy-MM-dd");
    if (startMin === undefined) {
      // 无落点时刻（如全天行点击）→ 沿用无时刻新建
      openAdd(dateStr);
      return;
    }
    // 落点分钟 → "HH:mm"，结束默认 +60 分钟（内部已夹到当天末）
    openAdd(dateStr, minutesToHM(startMin), addMinutesToHM(minutesToHM(startMin), 60));
  };

  // 时段事件拖拽落定改期：保留原时长，改天（周视图跨列）+ 改起始时刻。
  // 时段事件视为单日 → start=end=目标日；start_time=新时刻，end_time=新时刻+原时长。
  const handleReschedule = async (
    ev: CalendarEvent,
    targetDay: Date,
    newStartMin: number,
  ) => {
    // 作用于母事件：occurrence 携带母 id，避免用平移日期覆盖母事件
    const master = events.find((e) => e.id === ev.id) ?? ev;
    const dayStr = format(targetDay, "yyyy-MM-dd");
    const durMin = durationMin(master.start_time, master.end_time); // 保留原时长
    const newStart = minutesToHM(newStartMin);
    const newEnd = addMinutesToHM(newStart, durMin);
    try {
      await updateEvent(master.id, {
        start: dayStr,
        end: dayStr,
        start_time: newStart,
        end_time: newEnd,
      });
    } catch (e) {
      // 拖拽改期失败提示（store 已回滚乐观更新）
      toast.error(t("toast.moveError", { msg: String(e) }));
    }
  };

  // 打开编辑弹窗（回填该事件）。occurrence 携带母 id → 取回真实母事件编辑（作用于全部），
  // 避免用平移后的 occurrence 日期覆盖母事件。
  const openEdit = (ev: CalendarEvent) => {
    const master = events.find((e) => e.id === ev.id) ?? ev;
    const next: DialogState = { open: true, editing: master };
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
      // 全天事件忽略时刻，存空串
      start_time: form.all_day ? "" : form.startTime,
      end_time: form.all_day ? "" : form.endTime,
      all_day: form.all_day,
      color: form.color,
      description: form.description.trim(),
      project: form.project, // 空串 = 不关联
      repeat: buildRepeat(form.repeatUnit, form.repeatInterval), // ""=不重复 / "daily" / "daily:N"
    };
    try {
      if (dialog.editing) {
        await updateEvent(dialog.editing.id, payload);
      } else {
        await addEvent(payload);
      }
    } catch (e) {
      // 更新/新建失败时弹 toast，不关闭弹窗让用户可以重试
      const key = dialog.editing ? "toast.updateError" : "toast.createError";
      toast.error(t(key, { msg: String(e) }));
      return;
    }
    closeDialog();
  };

  // 快速记录（Toggl 式）：以当前时刻在指定日建一条事件；乐观插卡在 store 内，失败弹 toast。
  const handleQuickLog = async (dayStr: string, text: string) => {
    // 解析 @项目 标记：命中则关联项目并从标题剥离该 token
    const { title, project } = parseQuickLog(text, projects);
    if (!title) return;
    try {
      await addEvent({
        title,
        project,
        start: dayStr,
        start_time: format(new Date(), "HH:mm"),
        all_day: false,
        color: DEFAULT_COLOR,
      });
    } catch (e) {
      toast.error(t("toast.createError", { msg: String(e) }));
    }
  };

  // 删除（仅编辑态可用）
  const handleDelete = async () => {
    if (!dialog.editing) return;
    try {
      await removeEvent(dialog.editing.id);
    } catch (e) {
      // 删除失败时弹 toast，不关闭弹窗让用户可以重试
      toast.error(t("toast.deleteError", { msg: String(e) }));
      return;
    }
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
        ts.map((tk) => (tk.id === d.id ? { ...tk, due_date: dayStr } : tk)),
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
    try {
      await updateEvent(d.id, patch);
    } catch (e) {
      // 拖拽移动事件失败时提示
      toast.error(t("toast.moveError", { msg: String(e) }));
    }
  };

  // 通用导航步进：按当前视图移动游标（月=±1 月 / 周=±7 天 / 日=±1 天，为 Stage 4 预留）。
  // dir 取 -1（上一页）或 +1（下一页）。
  const stepCursor = (dir: number) => {
    setViewDate((cur) => {
      switch (view) {
        case "week":
          return addDays(cur, 7 * dir);
        case "day":
          return addDays(cur, dir);
        case "month":
        default:
          return addMonths(cur, dir);
      }
    });
  };

  // 重复单位对应的步长单位文案
  const repeatUnitLabel = (unit: string): string => {
    switch (unit) {
      case "daily": return t("dialog.fieldRepeatUnitDay");
      case "weekly": return t("dialog.fieldRepeatUnitWeek");
      case "monthly": return t("dialog.fieldRepeatUnitMonth");
      case "yearly": return t("dialog.fieldRepeatUnitYear");
      default: return "";
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-6">
      {/* 头部：标题 + 视图切换 + 导航 + 新建 */}
      <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* 月/周视图显示所在月份标题（周视图跟随游标所在月）；日视图显示当日日期；其它显示视图名 */}
          <h1 className="font-heading text-xl font-semibold text-foreground">
            {view === "month" || view === "week"
              ? formatMonthTitle(viewDate)
              : view === "day"
                ? formatDayTitle(viewDate)
                : t(`view.${view}`)}
          </h1>
          {/* 分段视图切换：月 | 周 | 日 | 议程 */}
          <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
            {(["month", "week", "day", "agenda"] as CalendarView[]).map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={view === v ? "default" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => changeView(v)}
              >
                {t(`view.${v}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 加载 / 错误状态（低调展示于按钮区左侧） */}
          {loading && (
            <span className="text-xs text-muted-foreground">{t("page.loading")}</span>
          )}
          {error && (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          )}

          {/* 导航在月/周/日视图显示（按当前视图步进：月±1月 / 周±7天 / 日±1天；议程无需导航）。 */}
          {(view === "month" || view === "week" || view === "day") && (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("page.prev")}
                onClick={() => stepCursor(-1)}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              </Button>
              <Button variant="outline" onClick={() => setViewDate(new Date())}>
                {t("page.today")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("page.next")}
                onClick={() => stepCursor(1)}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
              </Button>
            </>
          )}
          <Button onClick={() => openAdd(format(new Date(), "yyyy-MM-dd"))}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            {t("page.create")}
          </Button>
        </div>
      </header>

      {/* 议程视图 */}
      {view === "agenda" && (
        <AgendaView
          events={agendaEvents}
          tasks={dueTasks}
          onEventClick={openEdit}
          onTaskClick={(tk) => navigate(`/board?open=${tk.project}`)}
          onQuickLog={(text) => void handleQuickLog(format(new Date(), "yyyy-MM-dd"), text)}
          activity={todayActivity}
        />
      )}

      {/* 周视图：全天行 + 小时时间轴（Stage 3） */}
      {view === "week" && (
        <WeekView
          days={weekDays}
          events={weekEvents}
          tasks={dueTasks}
          onEventClick={openEdit}
          onTaskClick={(tk) => navigate(`/board?open=${tk.project}`)}
          onDayClick={handleTimedAdd}
          onEventReschedule={handleReschedule}
        />
      )}

      {/* 日视图：单日「表头 + 全天行 + 小时时间轴」（Stage 4） */}
      {view === "day" && (
        <DayView
          day={viewDate}
          events={dayEvents}
          tasks={dueTasks}
          onEventClick={openEdit}
          onTaskClick={(tk) => navigate(`/board?open=${tk.project}`)}
          onDayClick={handleTimedAdd}
          onEventReschedule={handleReschedule}
          onQuickLog={(text) => void handleQuickLog(format(viewDate, "yyyy-MM-dd"), text)}
        />
      )}

      {/* ── 月视图（星期表头 + 网格），仅在 month 视图渲染 ── */}
      {view === "month" && (
      <>
      {/* 星期表头：7 列 */}
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {weekdays.map((w, i) => (
          <div
            key={i}
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
          const dayEvents = expandedEvents.filter((ev) => eventCoversDay(ev, day));
          const dayTasks = dueTasks.filter((tk) => taskOnDay(tk, day));

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
                {dayEvents.slice(0, MONTH_CELL_MAX_EVENTS).map((ev) => (
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
                        className="flex items-start gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                        title={ev.description ? `${ev.title}\n${ev.description}` : ev.title}
                      >
                        {/* 颜色圆点：事件自定义颜色（用户数据）走内联样式；两行标题下对齐首行 */}
                        <span
                          className="mt-1 size-2 shrink-0 rounded-full"
                          style={{
                            background: ev.color || "var(--color-primary)",
                          }}
                        />
                        {/* 标题放宽到两行（line-clamp-2）：不再逼你把内容全挤进单行标题 */}
                        <span className="line-clamp-2 leading-snug text-foreground">
                          {/* 带时刻的非全天事件：标题前缀显示 "HH:mm " */}
                          {!ev.all_day && ev.start_time ? ev.start_time + " " : ""}
                          {ev.title}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => openEdit(ev)}>{t("event.contextEdit")}</ContextMenuItem>
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() =>
                          void removeEvent(ev.id).catch((e) =>
                            toast.error(t("toast.deleteError", { msg: String(e) })),
                          )
                        }
                      >
                        {t("event.contextDelete")}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}

                {/* 超出上限：「+N 更多」→ 跳该天日视图看全部（消灭 overflow-hidden 静默裁切） */}
                {dayEvents.length > MONTH_CELL_MAX_EVENTS && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation(); // 阻止冒泡到格子的新建
                      setViewDate(day);
                      changeView("day");
                    }}
                    className="rounded px-1 py-0.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t("event.more", { count: dayEvents.length - MONTH_CELL_MAX_EVENTS })}
                  </button>
                )}

                {/* 看板任务 due_date（只读叠加，点击跳到该任务的项目工作台） */}
                {dayTasks.map((tk) => (
                  <button
                    key={tk.id}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      setDrag({ kind: "task", id: tk.id });
                    }}
                    onDragEnd={() => {
                      setDrag(null);
                      setDragOverKey(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/board?open=${tk.project}`);
                    }}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                    title={t("event.taskTooltip", { title: tk.title })}
                  >
                    <HugeiconsIcon
                      icon={KanbanIcon}
                      strokeWidth={2}
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate text-muted-foreground">
                      {tk.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      </>
      )}

      {/* 新建 / 编辑弹窗 */}
      <Dialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog.editing ? t("dialog.titleEdit") : t("dialog.titleCreate")}</DialogTitle>
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
              <Label htmlFor="cal-title">{t("dialog.fieldTitle")}</Label>
              <Input
                id="cal-title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={t("dialog.fieldTitlePlaceholder")}
                required
              />
            </div>

            {/* 开始 / 结束日期 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cal-start">{t("dialog.fieldStart")}</Label>
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
                <Label htmlFor="cal-end">{t("dialog.fieldEnd")}</Label>
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
                <Checkbox
                  id="cal-allday"
                  checked={form.all_day}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, all_day: v === true }))
                  }
                />
                {t("dialog.fieldAllDay")}
              </Label>
              <Label htmlFor="cal-color" className="cursor-pointer">
                {t("dialog.fieldColor")}
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

            {/* 开始 / 结束时刻：仅非全天时显示 */}
            {!form.all_day && (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cal-start-time">{t("dialog.fieldStartTime")}</Label>
                  <Input
                    id="cal-start-time"
                    type="time"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startTime: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cal-end-time">{t("dialog.fieldEndTime")}</Label>
                  <Input
                    id="cal-end-time"
                    type="time"
                    value={form.endTime}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endTime: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            {/* 重复（轻量循环：单位 + 每 N 步长，仅展开显示） */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-repeat">{t("dialog.fieldRepeat")}</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={form.repeatUnit || "none"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, repeatUnit: v === "none" ? "" : v }))
                  }
                >
                  <SelectTrigger id="cal-repeat" className="flex-1">
                    <SelectValue placeholder={t("repeat.none")} />
                  </SelectTrigger>
                  <SelectContent>
                    {REPEAT_OPTIONS.map((o) => (
                      <SelectItem key={o.value || "none"} value={o.value || "none"}>
                        {t(`repeat.${o.value || "none"}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* 选了单位才显示「每 N」步长输入 */}
                {form.repeatUnit && (
                  <div className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
                    <span>{t("dialog.fieldRepeatEvery")}</span>
                    <Input
                      type="number"
                      min={1}
                      value={form.repeatInterval}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          repeatInterval: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        }))
                      }
                      className="w-16"
                      aria-label={t("dialog.fieldRepeatInterval")}
                    />
                    <span>{repeatUnitLabel(form.repeatUnit)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 关联项目（可选） */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cal-project">{t("dialog.fieldProject")}</Label>
              <Select
                value={form.project || "none"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, project: v === "none" ? "" : v }))
                }
              >
                <SelectTrigger id="cal-project" className="w-full">
                  <SelectValue placeholder={t("dialog.fieldProjectNone")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("dialog.fieldProjectNone")}</SelectItem>
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
              <Label htmlFor="cal-desc">{t("dialog.fieldDesc")}</Label>
              <Textarea
                id="cal-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder={t("dialog.fieldDescPlaceholder")}
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
                  {t("common:action.delete")}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={closeDialog}>
                {t("common:action.cancel")}
              </Button>
              <Button type="submit" disabled={!form.title.trim()}>
                {t("common:action.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
