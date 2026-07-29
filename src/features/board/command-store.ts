// command-store.ts —— 按项目的「命令收藏 + 历史」本地存储（localStorage）。
//
// 每个项目（以 repoPath 为 key）独立一份 { favorites, history }：
//   - favorites：⭐ 手动收藏，永不被历史挤掉。
//   - history：启动时自动记录，最近优先、按「命令+cwd」去重、上限 30。
// 每条连同 cwd 存 → 点选可一键还原命令与工作目录。纯本机便捷存储，容错（损坏→空）。

/** 一条命令记录：命令文本 + 可选工作目录。 */
export interface CommandEntry {
  command: string;
  /** 启动时的工作目录；空/缺省表示用项目根。 */
  cwd?: string;
}

/** 单个项目的命令集合。 */
export interface CommandStore {
  favorites: CommandEntry[];
  history: CommandEntry[];
}

/** 历史条数上限（防 localStorage 膨胀）。 */
const HISTORY_CAP = 30;

/** 存储 key 前缀：按项目路径隔离。 */
function storageKey(projectKey: string): string {
  return `rework-cmds:${projectKey}`;
}

/** 两条记录是否「同一命令+同一 cwd」（去重/匹配依据；cwd 空串与 undefined 视为等价）。 */
function sameEntry(a: CommandEntry, b: CommandEntry): boolean {
  return a.command === b.command && (a.cwd || "") === (b.cwd || "");
}

/** 读取某项目的命令集合（无/损坏 → 空集合，不抛）。 */
export function loadCommands(projectKey: string): CommandStore {
  try {
    const raw = localStorage.getItem(storageKey(projectKey));
    if (!raw) return { favorites: [], history: [] };
    const parsed = JSON.parse(raw) as Partial<CommandStore>;
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { favorites: [], history: [] };
  }
}

/** 写回某项目的命令集合（失败静默，不阻断启动）。 */
function saveCommands(projectKey: string, store: CommandStore): void {
  try {
    localStorage.setItem(storageKey(projectKey), JSON.stringify(store));
  } catch {
    /* ignore：隐私模式/配额满等不阻断 */
  }
}

/**
 * 记一条历史（启动时调）：按「命令+cwd」去重后置顶，超过上限截断。
 * 空命令不记。返回更新后的集合。
 */
export function addHistory(projectKey: string, entry: CommandEntry): CommandStore {
  const command = entry.command.trim();
  if (!command) return loadCommands(projectKey);
  const e: CommandEntry = { command, ...(entry.cwd ? { cwd: entry.cwd } : {}) };
  const store = loadCommands(projectKey);
  // 去重（移除已存在的同条），再置顶，最后截断到上限。
  const deduped = store.history.filter((h) => !sameEntry(h, e));
  store.history = [e, ...deduped].slice(0, HISTORY_CAP);
  saveCommands(projectKey, store);
  return store;
}

/** 是否已收藏（按命令+cwd 匹配）。 */
export function isFavorite(projectKey: string, entry: CommandEntry): boolean {
  return loadCommands(projectKey).favorites.some((f) => sameEntry(f, entry));
}

/**
 * 切换收藏：已收藏→移除；未收藏→加入（置顶）。空命令忽略。返回更新后的集合。
 */
export function toggleFavorite(projectKey: string, entry: CommandEntry): CommandStore {
  const command = entry.command.trim();
  if (!command) return loadCommands(projectKey);
  const e: CommandEntry = { command, ...(entry.cwd ? { cwd: entry.cwd } : {}) };
  const store = loadCommands(projectKey);
  if (store.favorites.some((f) => sameEntry(f, e))) {
    store.favorites = store.favorites.filter((f) => !sameEntry(f, e));
  } else {
    store.favorites = [e, ...store.favorites];
  }
  saveCommands(projectKey, store);
  return store;
}

/** 从历史移除一条。返回更新后的集合。 */
export function removeHistory(projectKey: string, entry: CommandEntry): CommandStore {
  const store = loadCommands(projectKey);
  store.history = store.history.filter((h) => !sameEntry(h, entry));
  saveCommands(projectKey, store);
  return store;
}

/** 从收藏移除一条。返回更新后的集合。 */
export function removeFavorite(projectKey: string, entry: CommandEntry): CommandStore {
  const store = loadCommands(projectKey);
  store.favorites = store.favorites.filter((f) => !sameEntry(f, entry));
  saveCommands(projectKey, store);
  return store;
}

/**
 * 终端式 ↑/↓ 历史回溯（纯函数，命令框按方向键调用）。
 *
 * @param commands 命令文本列表，`[0]` 为最近（同 history 顺序）。
 * @param idx      当前索引：`-1`=草稿态（用户正在输入的内容）。
 * @param dir      `"up"`=回到更旧命令；`"down"`=回到更新命令/草稿。
 * @param draft    草稿文本（idx 回到 -1 时还原）。
 * @returns 新的 `{ idx, value }`；无可动作（历史空 / 已在草稿再按 ↓）返回 `null`。
 */
export function recallCommand(
  commands: string[],
  idx: number,
  dir: "up" | "down",
  draft: string,
): { idx: number; value: string } | null {
  if (dir === "up") {
    if (commands.length === 0) return null;
    // 从草稿(-1)或当前位置向更旧移动一格，封顶最旧。
    const next = Math.min((idx < 0 ? -1 : idx) + 1, commands.length - 1);
    return { idx: next, value: commands[next] };
  }
  // down：已在草稿则不动；否则向更新移动，回到 -1 还原草稿。
  if (idx < 0) return null;
  const next = idx - 1;
  return { idx: next, value: next < 0 ? draft : commands[next] };
}
