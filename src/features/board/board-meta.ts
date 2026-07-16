// 看板共享元数据：优先级 / 状态类别的展示信息。
// 供 TaskCard / TaskSheet / StatusColumn / ProjectSheet 统一引用，避免各处硬编码。
import type { TaskPriority, StateCategory } from "@/types/board";

/** 优先级 → 展示标签 + 语义色点 class（点色用语义/调色类，非硬编码 hex）。 */
export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; dot: string; badge: string }
> = {
  none: {
    label: "无",
    dot: "bg-muted-foreground",
    badge: "bg-muted text-muted-foreground",
  },
  low: {
    label: "低",
    dot: "bg-sky-400",
    badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  medium: {
    label: "中",
    dot: "bg-yellow-400",
    badge: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  },
  high: {
    label: "高",
    dot: "bg-orange-400",
    badge: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  urgent: {
    label: "紧急",
    dot: "bg-destructive",
    badge: "bg-destructive/15 text-destructive",
  },
};

/** 优先级下拉的固定顺序（= 展示顺序）。 */
export const PRIORITY_ORDER: TaskPriority[] = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
];

/** 状态类别 → 中文标签。 */
export const STATE_CATEGORY_META: Record<StateCategory, { label: string }> = {
  pending: { label: "待处理" },
  active: { label: "进行中" },
  completed: { label: "已完成" },
};

export const STATE_CATEGORY_ORDER: StateCategory[] = [
  "pending",
  "active",
  "completed",
];
