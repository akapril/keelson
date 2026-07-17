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
  /** 逗号分隔的标签文本（前端拆/合） */
  tags: string;
  /** AI 摘要（一段） */
  summary: string;
  /** 要点：JSON 字符串数组（前端 parse） */
  key_points: string;
  /** 缓存的网页正文（可长；PB 字段 max:0） */
  content_text: string;
  /** 是否置顶 */
  pinned: boolean;
}
