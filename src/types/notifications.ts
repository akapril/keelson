// 通知中心类型定义 —— 对应 PB notifications 集合（owner-only）。

/** 通知类别（影响图标/颜色） */
export type NotificationKind = "info" | "success" | "warning" | "error";

/** 单条应用内通知 */
export interface AppNotification {
  id: string;
  owner: string;
  title: string;
  body: string;
  kind: NotificationKind;
  read: boolean;
  /** 点击跳转的应用内路由（可空，如 /board?open=xxx） */
  link: string;
  /** 来源标签（可空，如 更新 / AI / 沉淀） */
  source: string;
  created: string;
  updated: string;
}
