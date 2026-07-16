// Calendar 类型定义 —— 日历事件条目（owner-only 访问，非项目维度）。

/**
 * 单条日历事件记录（对应 PB calendar_events 集合）。
 * start / end 为 ISO 日期字符串；end 可为空串（表示无结束时间）。
 */
export interface CalendarEvent {
  id: string;
  owner: string;
  title: string;
  description: string;
  start: string;
  end: string;
  all_day: boolean;
  color: string;
  /** 可选：关联的看板项目 id（空串 = 未关联） */
  project: string;
  created: string;
  updated: string;
}
