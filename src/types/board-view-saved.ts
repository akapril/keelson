// 保存视图类型定义 —— 与 PB board_views 集合字段一一对应。
import type { BoardView, SwimlaneKey } from "@/store/board-view";
import type { TaskFilter } from "@/features/board/task-filter";

/** 保存视图（PB board_views）：命名的视图配置，项目级，软删。 */
export interface SavedBoardView {
  id: string;
  /** 拥有者用户 ID */
  owner: string;
  /** 所属项目 ID */
  project: string;
  /** 视图名称 */
  name: string;
  /** 视图类型：看板 / 列表 / 时间轴 */
  view_type: BoardView;
  /** 筛选条件（JSON 存储） */
  filter: TaskFilter;
  /** 泳道分组方式 */
  swimlane: SwimlaneKey;
  /** 列表排序权重 */
  sort_order: number;
  /** 软删时间戳（空串 = 未删） */
  deleted_at?: string;
  created: string;
  updated: string;
}
