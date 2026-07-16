// Reading 类型定义 —— 阅读列表条目（owner-only 访问，非项目维度）。

/** 阅读条目状态：未读 / 在读 / 已归档 */
export type ReadingStatus = "unread" | "reading" | "archived";

/** 单条阅读条目记录（对应 PB reading_items 集合） */
export interface ReadingItem {
  id: string;
  owner: string;
  title: string;
  url: string;
  note: string;
  status: ReadingStatus;
  created: string;
  updated: string;
}
