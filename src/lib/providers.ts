// 统一的 provider 元数据（单一事实来源）——消除 favorite-row-menu / ProjectList /
// WorkspaceSessions 三处各自维护的 providerLabel 与散落的颜色映射。
// 6 个 provider 各配：展示名 label + 一套 tailwind 颜色类（dark/light 都可读）。
//   - dot：小色点（实心 -500，两个主题下都显眼）
//   - chip：徽标背景 + 文字（-500/15 背景 + -700/dark:-400 文字，低饱和不刺眼）
// 注意：颜色类需为「完整静态字符串」，Tailwind 才能在构建时收集（不能拼接动态类名）。

/** 单个 provider 的展示元数据 */
export interface ProviderMeta {
  /** 展示名（固定大小写） */
  label: string;
  /** 小色点的背景类（实心 -500） */
  dot: string;
  /** 徽标（背景 + 文字）类，用于 provider 标签 */
  chip: string;
}

/**
 * 6 个 provider 的统一元数据。
 * 颜色分配：claude=amber / codex=sky / opencode=violet / gemini=emerald /
 *          hermes=rose / antigravity=indigo。
 */
export const PROVIDER_META: Record<string, ProviderMeta> = {
  claude: {
    label: "Claude",
    dot: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  codex: {
    label: "Codex",
    dot: "bg-sky-500",
    chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  },
  opencode: {
    label: "OpenCode",
    dot: "bg-violet-500",
    chip: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  },
  gemini: {
    label: "Gemini",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  hermes: {
    label: "Hermes",
    dot: "bg-rose-500",
    chip: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  },
  antigravity: {
    label: "Antigravity",
    dot: "bg-indigo-500",
    chip: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
  },
};

/** 未知 provider 的兜底样式（中性灰） */
const FALLBACK_META: ProviderMeta = {
  label: "",
  dot: "bg-muted-foreground",
  chip: "bg-muted text-muted-foreground",
};

/**
 * provider 显示名：命中 META 用其 label，否则首字母大写兜底。
 * 这是 providerLabel 的唯一实现（DRY）——各处改为 import 此函数。
 */
export function providerLabel(id: string): string {
  const meta = PROVIDER_META[id];
  if (meta) return meta.label;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** 取 provider 的样式元数据（含兜底 label）；未知 id 返回中性兜底 + 首字母大写 label。 */
export function providerMeta(id: string): ProviderMeta {
  const meta = PROVIDER_META[id];
  if (meta) return meta;
  return { ...FALLBACK_META, label: providerLabel(id) };
}
