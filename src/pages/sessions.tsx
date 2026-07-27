import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
  const { t } = useTranslation("shell");
  // 当前预览的会话
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const sessions = useSessionsStore((s) => s.sessions);
  const [searchParams] = useSearchParams();
  // 深链接：?session=<id>（来自看板任务「来源会话」徽章回跳）
  const wantSessionId = searchParams.get("session");

  // 挂载时加载数据（并行，互不依赖）
  useEffect(() => {
    useSessionsStore.getState().load();
    useSessionMetaStore.getState().load();
  }, []);

  // 会话加载完成后，若 URL 指定了 ?session= 则自动选中定位
  useEffect(() => {
    if (!wantSessionId || sessions.length === 0) return;
    if (selectedSession?.session_id === wantSessionId) return;
    const target = sessions.find((s) => s.session_id === wantSessionId);
    if (target) setSelectedSession(target);
    // 仅在 id 或会话列表变化时尝试定位
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantSessionId, sessions]);

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-hidden">
      {/* 左侧：会话列表（固定宽度，可滚动） */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-border p-4">
        <h1 className="mb-4 shrink-0 text-base font-semibold">{t("sessions.pageTitle")}</h1>
        <div className="min-h-0 flex-1">
          <SessionListView
            selectedId={selectedSession?.session_id ?? null}
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
