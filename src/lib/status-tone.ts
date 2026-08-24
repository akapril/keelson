// 状态色调单一映射（与 providers.ts chip 同公式：-500/15 背景 + -700/dark:-400 文字，低饱和不刺眼）。
// 消除 TaskCard 内联复刻的 running/review/blocked/enqueued 状态色，收敛为语义色调。
// 颜色类须为完整静态字符串（Tailwind 构建时收集，禁止拼接动态类名）。
export type StatusTone = "info" | "warning" | "danger" | "neutral";

interface Tone {
  /** 徽标背景 + 文字类 */
  chip: string;
  /** 小色点背景类（实心 -500） */
  dot: string;
}

const TONES: Record<StatusTone, Tone> = {
  info: { chip: "bg-blue-500/15 text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  warning: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  danger: { chip: "bg-red-500/15 text-red-700 dark:text-red-400", dot: "bg-red-500" },
  neutral: { chip: "bg-slate-500/15 text-slate-700 dark:text-slate-400", dot: "bg-slate-500" },
};

export function statusTone(tone: StatusTone): Tone {
  return TONES[tone];
}
