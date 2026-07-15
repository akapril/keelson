import { useEffect, useState } from "react";
import { useSessionsStore } from "../store/sessions";
import { useSessionMetaStore } from "../store/session-meta";
import { SessionListView } from "../features/sessions/SessionListView";
import { SessionPreviewPane } from "../features/sessions/SessionPreviewPane";
import type { Session } from "../types/session";

/**
 * 会话中枢页面。
 * 左侧：SessionListView（搜索 + 分组列表）
 * 右侧：SessionPreviewPane（选中会话的消息预览）
 * 挂载时同时加载会话列表和收藏/笔记 meta 数据。
 */
export default function Sessions() {
  // 当前预览的会话
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  // 挂载时加载数据（并行，互不依赖）
  useEffect(() => {
    useSessionsStore.getState().load();
    useSessionMetaStore.getState().load();
  }, []);

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-hidden">
      {/* 左侧：会话列表（固定宽度，可滚动） */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border p-4">
        <h1 className="mb-4 shrink-0 text-base font-semibold">会话中枢</h1>
        <div className="min-h-0 flex-1">
          <SessionListView
            selectedId={selectedSession?.id ?? null}
            onSelect={setSelectedSession}
          />
        </div>
      </aside>

      {/* 右侧：预览面板（弹性填充剩余空间） */}
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        <SessionPreviewPane session={selectedSession} />
      </main>
    </div>
  );
}
