// 截止提醒 —— 把到期/逾期的**任务**推送到通知中心。
// 时机:应用启动后跑一次(通知铃挂载时)。窗口:当天 + 已逾期(回看 14 天,防旧项刷屏)。
// 去重:通知 link 里埋 `reminder=<type>-<id>-<date>` 标记;已存在则不重复建
//      (改了截止日 -> 新 date -> 重新提醒;标记已读的通知仍在列表里 -> 不会重复)。
//
// ⚠️ 不再为**日历事件**生成提醒:日历现为「活动流水账」(记录刚才做了什么=过去时),
// 原逻辑对 start<=今天 的事件逐条推提醒,等于提醒"已经发生的事"——纯噪音、且刷爆收件箱。
// 事件提醒功能整体移除;将来若要"未来事件提醒"应作为单独的 opt-in 功能重做(默认关)。
import { listDueTasks, listAllStates } from "@/lib/pb/board";
import { useNotificationsStore } from "@/store/notifications";
import i18n from "@/i18n";

/** 逾期回看窗(天):比这更久远的逾期项不再提醒,避免首次运行刷屏。 */
const LOOKBACK_DAYS = 14;

/** 取 ISO 时间戳的日期部分(YYYY-MM-DD)。 */
function dayOf(iso: string): string {
  return (iso || "").slice(0, 10);
}

/** 今天的日期键(本地时区)。 */
function todayKey(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** N 天前的日期键(本地时区)。 */
function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/**
 * 是否落在"该提醒"的窗口:非空、当天或已逾期、且不早于回看下限。
 * 纯逻辑,可测。day/today/cutoff 均为 YYYY-MM-DD(字典序即时间序)。
 */
export function inDueWindow(day: string, today: string, cutoff: string): boolean {
  return !!day && day <= today && day >= cutoff;
}

/**
 * 扫描到期的任务,为尚未提醒过的生成通知。幂等:重复调用不会重复推送。
 * 任何数据加载失败都静默跳过(不阻断应用)。
 * 并顺带一次性清理历史遗留的"日历事件提醒"噪音(自愈,见下)。
 */
export async function syncDueReminders(): Promise<void> {
  const store = useNotificationsStore.getState();
  // 确保通知已加载(去重依据现有 items 的 link 标记)
  if (store.items.length === 0 && !store.loading) {
    await store.load().catch(() => {});
  }

  // 一次性自愈清理:事件提醒功能已移除,历史遗留的"日历事件提醒"(link 含 reminder=event-)
  // 是活动流水账刷出来的噪音,主动删除,让老用户收件箱自动回归干净。清完后续运行为空 no-op。
  const staleEventReminders = useNotificationsStore
    .getState()
    .items.filter((n) => n.link.includes("reminder=event-"))
    .map((n) => n.id);
  if (staleEventReminders.length > 0) {
    await useNotificationsStore.getState().removeMany(staleEventReminders).catch(() => {});
  }

  const today = todayKey();
  const cutoff = daysAgoKey(LOOKBACK_DAYS);

  // 当前已有的 reminder 标记集合(去重用)
  const hasMark = (mark: string): boolean =>
    useNotificationsStore.getState().items.some((n) => n.link.includes(mark));

  // ── 任务(due_date <= 今天、未完成、在回看窗内) ──
  try {
    const [tasks, states] = await Promise.all([listDueTasks(), listAllStates()]);
    const completed = new Set(
      states.filter((s) => s.category === "completed").map((s) => s.id),
    );
    for (const t of tasks) {
      const due = dayOf(t.due_date || "");
      if (!inDueWindow(due, today, cutoff)) continue; // 未来 / 太久远 跳过
      if (completed.has(t.state)) continue; // 已完成跳过
      const mark = `reminder=task-${t.id}-${due}`;
      if (hasMark(mark)) continue;
      const overdue = due < today;
      await useNotificationsStore.getState().add({
        title: i18n.t("notif.dueSoon", { ns: "shell", title: t.title }),
        body: overdue
          ? i18n.t("notif.overdueBody", { ns: "shell", date: due })
          : i18n.t("notif.dueBody", { ns: "shell" }),
        kind: overdue ? "warning" : "info",
        source: "截止提醒",
        link: `/board?open=${t.project}&tab=board&${mark}`,
      });
    }
  } catch {
    /* 任务加载失败：跳过 */
  }

  // 日历事件不再生成提醒(见文件头注释:活动流水账=过去时,提醒即噪音)。
}
