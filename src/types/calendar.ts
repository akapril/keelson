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
  /** 开始时刻（"HH:mm"）；all_day 为真时忽略；空串=未设置 */
  start_time?: string;
  /** 结束时刻（"HH:mm"）；all_day 为真时忽略；空串=未设置 */
  end_time?: string;
  all_day: boolean;
  color: string;
  /** 重复规则（空串=不重复 / daily / weekly / monthly / yearly）；轻量循环，仅展开显示 */
  repeat?: string;
  /** 可选：关联的看板项目 id（空串 = 未关联） */
  project: string;
  /** 提醒时间（UTC ISO，如 "2026-09-03T14:30:00Z"）；空串=不提醒。后台 worker 到点推送。 */
  remind_at?: string;
  /** 是否已推送过提醒（去重）；worker 推送后置 true。 */
  reminded?: boolean;
  created: string;
  updated: string;
  /** 软删除时间戳（非空即已删）；多机同步用。 */
  deleted_at?: string;
}
