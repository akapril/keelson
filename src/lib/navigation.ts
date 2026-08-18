// 侧栏导航数据（数据驱动，结构移植自 workavera，内容改为 rework 路由）。
// title/description/label 存储 shell ns i18n key，由组件翻译展示。
import type { IconSvgElement } from "@hugeicons/react";
import {
  Home01Icon,
  Chat01Icon,
  DashboardSquare02Icon,
  File01Icon,
  BookOpen01Icon,
  Calendar03Icon,
  BrainIcon,
  CommandIcon,
  Settings02Icon,
  TerminalIcon,
  BotIcon,
  InboxIcon,
  Coins01Icon,
} from "@hugeicons/core-free-icons";

export type NavItem = {
  /** shell ns i18n key（如 "nav.dashboard.title"） */
  titleKey: string;
  url: string;
  icon: IconSvgElement;
  /** shell ns i18n key（如 "nav.dashboard.description"） */
  descriptionKey?: string;
};

export type NavGroup = {
  /** shell ns i18n key（如 "nav.groupWorkspace"） */
  labelKey: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    // 工作：日常主线——总览 / 看板 / 会话（降级为平级项）/ 文档
    labelKey: "nav.groupWork",
    items: [
      {
        titleKey: "nav.dashboard.title",
        url: "/dashboard",
        icon: Home01Icon,
        descriptionKey: "nav.dashboard.description",
      },
      {
        titleKey: "nav.board.title",
        // ?tab=board 使 ProjectWorkspace 深链直落看板 tab；仅移位，标题键不改名
        url: "/board?tab=board",
        icon: DashboardSquare02Icon,
        descriptionKey: "nav.board.description",
      },
      {
        // 会话中枢降级：从主入口降为「工作」组一员（页本身不改）
        titleKey: "nav.sessions.title",
        url: "/sessions",
        icon: Chat01Icon,
        descriptionKey: "nav.sessions.description",
      },
      {
        titleKey: "nav.docs.title",
        url: "/docs",
        icon: File01Icon,
        descriptionKey: "nav.docs.description",
      },
    ],
  },
  {
    // Agent 团队：命名队友 / 运行时 / 收件箱（需人决策的 agent 待办）
    labelKey: "nav.groupAgentTeam",
    items: [
      {
        titleKey: "nav.agents.title",
        url: "/agents",
        icon: BotIcon,
        descriptionKey: "nav.agents.description",
      },
      {
        // 正名「运行时」，路由保持 /processes（不破深链）
        titleKey: "nav.runtime.title",
        url: "/processes",
        icon: TerminalIcon,
        descriptionKey: "nav.runtime.description",
      },
      {
        // Inbox 首次进侧栏；原铃铛入口保留
        titleKey: "nav.inbox.title",
        url: "/inbox",
        icon: InboxIcon,
        descriptionKey: "nav.inbox.description",
      },
    ],
  },
  {
    // 知识 · 更多：低频/参考类收进此组（可折叠，默认收起）
    labelKey: "nav.groupKnowledge",
    items: [
      {
        titleKey: "nav.memory.title",
        url: "/memory",
        icon: BrainIcon,
        descriptionKey: "nav.memory.description",
      },
      {
        titleKey: "nav.reading.title",
        url: "/reading",
        icon: BookOpen01Icon,
        descriptionKey: "nav.reading.description",
      },
      {
        titleKey: "nav.calendar.title",
        url: "/calendar",
        icon: Calendar03Icon,
        descriptionKey: "nav.calendar.description",
      },
      {
        titleKey: "nav.prompts.title",
        url: "/prompts",
        icon: CommandIcon,
        descriptionKey: "nav.prompts.description",
      },
      {
        // 成本页进侧栏；顶部 header「成本」按钮仍在（双入口）
        titleKey: "nav.usage.title",
        url: "/usage",
        icon: Coins01Icon,
        descriptionKey: "nav.usage.description",
      },
      {
        titleKey: "nav.settings.title",
        url: "/settings",
        icon: Settings02Icon,
        descriptionKey: "nav.settings.description",
      },
    ],
  },
];

export const flatNavItems: NavItem[] = navGroups.flatMap((g) => g.items);
