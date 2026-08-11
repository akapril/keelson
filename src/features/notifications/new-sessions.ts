// 发现新会话提醒 —— 启动时对比"已见过的会话 id",有新增则推一条摘要通知。
// 低噪声设计:一次/会话、只推摘要(不逐条)、首次运行只播种不提醒、只进应用内(不弹系统)、可关。
import { useSessionsStore } from "@/store/sessions";
import { useNotificationsStore } from "@/store/notifications";
import i18n from "@/i18n";

const SEEN_KEY = "keelson-seen-session-ids";
const PREF_KEY = "keelson-notify-new-sessions"; // "0" = 关,其它/缺省 = 开

/** 是否开启"发现新会话"提醒(默认开)。 */
export function newSessionsPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

/** 设置"发现新会话"提醒开关。 */
export function setNewSessionsPref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* 忽略 */
  }
}

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* 忽略 */
  }
}

// 本会话只检查一次(会话中枢的实时刷新不重复提醒)
let didCheck = false;

/**
 * 扫描新会话并推摘要通知。一次/会话;首次运行只记录基线不提醒。
 * 数据加载失败静默跳过。
 */
export async function syncNewSessionsReminder(): Promise<void> {
  if (didCheck) return;
  didCheck = true;

  const store = useSessionsStore.getState();
  if (store.sessions.length === 0) {
    await store.load().catch(() => {});
  }
  const ids = useSessionsStore.getState().sessions.map((s) => s.session_id);

  const seen = loadSeen();
  const firstRun = seen.size === 0;
  const newIds = ids.filter((id) => !seen.has(id));

  // 总是更新基线为当前全集
  saveSeen(ids);

  if (firstRun) return; // 首次只播种,不提醒(避免"发现 N 条"刷屏)
  if (!newSessionsPref()) return;
  if (newIds.length === 0) return;

  await useNotificationsStore
    .getState()
    .add({
      title: i18n.t("notif.newSessions", { ns: "shell", count: newIds.length }),
      body: i18n.t("notif.newSessionsBody", { ns: "shell" }),
      kind: "info",
      source: "会话",
      link: "/sessions",
    })
    .catch(() => {});
}
