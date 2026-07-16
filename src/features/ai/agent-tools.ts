// AI agent 工具层：给当前项目的 AI 一组「读 + 建/改」看板任务与文档的工具（无删除，安全）。
// 工具执行走 store/PB（用户 token → PB access rules 授权）。中性 schema 交 Rust 按 provider 转换。
// agent loop：ipc.aiChatTools → 若工具调用则本地执行 → 结果回传 → 再调，直到最终文本或达上限。
import { ipc } from "@/lib/tauri/ipc";
import { useBoardStore } from "@/store/board";
import { useDocsStore } from "@/store/docs";
import { listDocs } from "@/lib/pb/docs";
import type {
  AiConfig,
  AiToolDef,
  AiToolCall,
  ToolChatMessage,
} from "@/types/ai";
import type { TaskPriority } from "@/types/board";

/** agent 循环上下文：工具作用于当前打开的项目。 */
export interface AgentContext {
  projectId: string;
}

const PRIORITIES: TaskPriority[] = ["none", "low", "medium", "high", "urgent"];

/** 工具定义（中性 JSON schema）。均作用于「当前项目」，故不需 project 参数。 */
export const TOOL_SCHEMAS: AiToolDef[] = [
  {
    name: "list_states",
    description: "列出当前项目看板的状态列（用于建任务时选择目标列）。返回 id 与名称。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_tasks",
    description: "列出当前项目看板的所有任务（含 id、标题、所在状态列、优先级、截止日期）。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_task",
    description: "在当前项目看板创建一个任务。state_id 需来自 list_states。",
    parameters: {
      type: "object",
      properties: {
        state_id: { type: "string", description: "目标状态列 id" },
        title: { type: "string", description: "任务标题" },
        description: { type: "string", description: "任务描述（可选）" },
        priority: { type: "string", enum: PRIORITIES, description: "优先级（可选）" },
        due_date: { type: "string", description: "截止日期，如 2026-08-01（可选）" },
      },
      required: ["state_id", "title"],
    },
  },
  {
    name: "update_task",
    description: "更新一个任务的字段（task_id 来自 list_tasks）。只传需要修改的字段。",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: PRIORITIES },
        state_id: { type: "string", description: "移动到的目标状态列 id" },
        due_date: { type: "string" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "list_docs",
    description: "列出当前项目的文档（含 id 与标题）。",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_doc",
    description: "在当前项目创建一篇文档（Markdown 正文可选）。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "Markdown 正文（可选）" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_doc",
    description: "更新一篇文档的标题或正文（doc_id 来自 list_docs）。",
    parameters: {
      type: "object",
      properties: {
        doc_id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["doc_id"],
    },
  },
];

/** 执行一次工具调用，返回给模型的结果字符串（JSON）。 */
export async function executeTool(
  name: string,
  argsJson: string,
  ctx: AgentContext,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return JSON.stringify({ ok: false, error: "参数不是合法 JSON" });
  }
  const board = useBoardStore.getState();
  const docs = useDocsStore.getState();
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  try {
    switch (name) {
      case "list_states":
        return JSON.stringify(
          board.states.map((s) => ({ id: s.id, name: s.name, category: s.category })),
        );
      case "list_tasks":
        return JSON.stringify(
          board.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            state: t.state,
            priority: t.priority,
            due_date: t.due_date ?? null,
          })),
        );
      case "create_task": {
        const state_id = str(args.state_id);
        const title = str(args.title);
        if (!state_id || !title) return err("缺少 state_id 或 title");
        const task = await board.createTask({
          project: ctx.projectId,
          state: state_id,
          title,
          description: str(args.description),
          priority: str(args.priority) as TaskPriority | undefined,
          due_date: str(args.due_date),
        });
        return JSON.stringify({ ok: true, id: task.id, title: task.title });
      }
      case "update_task": {
        const task_id = str(args.task_id);
        if (!task_id) return err("缺少 task_id");
        const patch: Record<string, unknown> = {};
        if (args.title != null) patch.title = str(args.title);
        if (args.description != null) patch.description = str(args.description);
        if (args.priority != null) patch.priority = str(args.priority);
        if (args.state_id != null) patch.state = str(args.state_id);
        if (args.due_date != null) patch.due_date = str(args.due_date);
        await board.updateTask(task_id, patch);
        return JSON.stringify({ ok: true, id: task_id });
      }
      case "list_docs": {
        const list = await listDocs(ctx.projectId);
        return JSON.stringify(list.map((d) => ({ id: d.id, title: d.title })));
      }
      case "create_doc": {
        const title = str(args.title);
        if (!title) return err("缺少 title");
        const doc = await docs.createDoc(ctx.projectId, title);
        const content = str(args.content);
        if (content) await docs.updateDoc(doc.id, { content });
        return JSON.stringify({ ok: true, id: doc.id, title });
      }
      case "update_doc": {
        const doc_id = str(args.doc_id);
        if (!doc_id) return err("缺少 doc_id");
        const patch: { title?: string; content?: string } = {};
        if (args.title != null) patch.title = str(args.title);
        if (args.content != null) patch.content = str(args.content);
        await docs.updateDoc(doc_id, patch);
        return JSON.stringify({ ok: true, id: doc_id });
      }
      default:
        return err(`未知工具：${name}`);
    }
  } catch (e) {
    return err(String(e));
  }
}

function err(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}

/** agent 循环最大轮次（防止工具调用无限循环）。 */
const MAX_ITERATIONS = 8;

/** agent 循环回调：用于 UI 实时展示工具活动与最终文本。 */
export interface AgentCallbacks {
  onToolCall?: (call: AiToolCall) => void;
  onToolResult?: (call: AiToolCall, result: string) => void;
  onAssistantText?: (text: string) => void;
}

/**
 * 驱动 agent 循环：模型发起工具调用→本地执行→结果回传→再调，直到最终文本或达上限。
 * @param messages 初始消息（system + 历史 + 用户），会在内部追加工具往返。
 * @returns 最终助手文本
 */
export async function runAgent(
  config: AiConfig,
  messages: ToolChatMessage[],
  ctx: AgentContext,
  cb: AgentCallbacks = {},
): Promise<string> {
  const convo = [...messages];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const turn = await ipc.aiChatTools(config, convo, TOOL_SCHEMAS);

    if (turn.kind === "text" || turn.tool_calls.length === 0) {
      // 最终文本仅通过返回值交给调用方展示（避免与 onAssistantText 重复）
      return turn.content ?? "";
    }

    // 记录 assistant 的工具调用消息
    convo.push({
      role: "assistant",
      content: turn.content ?? null,
      tool_calls: turn.tool_calls,
    });
    if (turn.content) cb.onAssistantText?.(turn.content);

    // 依次执行工具，结果作为 tool 消息回传
    for (const call of turn.tool_calls) {
      cb.onToolCall?.(call);
      const result = await executeTool(call.name, call.arguments, ctx);
      cb.onToolResult?.(call, result);
      convo.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return "（已达工具调用上限，请细化你的要求后重试）";
}
