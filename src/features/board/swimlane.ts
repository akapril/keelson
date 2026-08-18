// 泳道分组纯函数：把任务按二级维度（优先级/负责人/标签/agent）分成横向泳道带。
// 看板列仍是 state；本函数只决定"哪些任务进哪条泳道带"。多值维度(assignee/label)一任务可进多带。
import type { BoardTask } from "@/types/board";
import type { SwimlaneKey } from "@/store/board-view";
import { PRIORITY_ORDER, PRIORITY_META } from "./board-meta";

export interface Lane {
  laneId: string;
  laneLabel: string;
  taskIds: string[];
}

export interface SwimlaneCtx {
  /** label id → 显示名 */
  labelName: (id: string) => string;
  /** 任务 → agent 显示名（无则"无 agent"） */
  agentName: (t: BoardTask) => string;
}

const NONE_LANE = "__none__";
const ALL_LANE = "__all__";

/**
 * 按泳道维度将任务分组，返回有序泳道数组。
 * - key="none"：单带含全部任务（扁平渲染）。
 * - key="priority"：按 PRIORITY_ORDER 顺序出带（"none" 归「无」带排最后）。
 * - key="agent"：单值分组，无 agent 归「无」带。
 * - key="label"|"assignee"：多值分组，一任务进每个匹配带；空数组归「无」带。
 * 「无」带 laneId 固定为 "__none__"，始终排最后。
 */
export function groupBySwimlane(tasks: BoardTask[], key: SwimlaneKey, ctx: SwimlaneCtx): Lane[] {
  // key=none：返回单带含全部任务
  if (key === "none") {
    return [{ laneId: ALL_LANE, laneLabel: "", taskIds: tasks.map((t) => t.id) }];
  }

  // 用有序 Map 保插入序，确保泳道顺序可预测
  const lanes = new Map<string, Lane>();

  // 辅助：确保带存在并返回（已存在则直接返回，避免重复创建）
  const ensure = (id: string, label: string): Lane => {
    let l = lanes.get(id);
    if (!l) {
      l = { laneId: id, laneLabel: label, taskIds: [] };
      lanes.set(id, l);
    }
    return l;
  };

  if (key === "priority") {
    // 先按 PRIORITY_ORDER 预建非"none"带，保证顺序；"none"优先级归「无」带
    for (const p of PRIORITY_ORDER) {
      if (p === "none") continue;
      // PRIORITY_META[p].label 字段确认存在（见 board-meta.ts）
      ensure(p, PRIORITY_META[p].label);
    }
    for (const t of tasks) {
      if (t.priority && t.priority !== "none") {
        ensure(t.priority, PRIORITY_META[t.priority].label).taskIds.push(t.id);
      } else {
        ensure(NONE_LANE, "无").taskIds.push(t.id);
      }
    }
  } else if (key === "agent") {
    // 单值分组：按 agent_id（首选）或 agent_provider 分组，无则归「无」带
    for (const t of tasks) {
      const agentId = t.agent_id || t.agent_provider;
      if (!agentId) {
        ensure(NONE_LANE, "无").taskIds.push(t.id);
      } else {
        ensure(agentId, ctx.agentName(t)).taskIds.push(t.id);
      }
    }
  } else {
    // 多值维度 label / assignee：一任务进每个匹配带，空值归「无」带
    for (const t of tasks) {
      const vals = key === "label" ? (t.labels ?? []) : (t.assignees ?? []);
      if (vals.length === 0) {
        ensure(NONE_LANE, "无").taskIds.push(t.id);
      } else {
        for (const v of vals) {
          const displayLabel = key === "label" ? ctx.labelName(v) : v;
          ensure(v, displayLabel).taskIds.push(t.id);
        }
      }
    }
  }

  // 「无」带移到末尾；去掉空带（预建了但无任务的优先级带）
  const arr = [...lanes.values()].filter((l) => l.laneId !== NONE_LANE && l.taskIds.length > 0);
  const noneLane = lanes.get(NONE_LANE);
  if (noneLane && noneLane.taskIds.length > 0) arr.push(noneLane);
  return arr;
}
