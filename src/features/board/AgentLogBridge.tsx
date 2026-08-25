// 全局 agent 日志桥接：监听后端 worker/MCP 派发路径 emit 的 agent-run-log 事件，
// 把日志增量 append 到 useAgentLogStore（按 task_id），让「在途」run 在 AgentRunPanel 里真的看得见。
// 修复此前 worker 丢弃日志导致的「执行中，等待输出…」永久假象。
// run-now 路径走独立 Channel 追加日志，不发此事件，故不会重复。挂一次即可（dashboard-layout）。
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAgentLogStore } from "@/store/agent-run-logs";

interface AgentRunLogEvent {
  task_id: string;
  delta: string;
}

export function AgentLogBridge() {
  useEffect(() => {
    let cancelled = false;
    const un = listen<AgentRunLogEvent>("agent-run-log", (e) => {
      if (cancelled) return;
      const { task_id, delta } = e.payload ?? {};
      if (task_id && delta) useAgentLogStore.getState().append(task_id, delta);
    });
    return () => {
      cancelled = true;
      void un.then((f) => f());
    };
  }, []);
  return null;
}
