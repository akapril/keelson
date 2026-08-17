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
    labelKey: "nav.groupWorkspace",
    items: [
      {
        titleKey: "nav.dashboard.title",
        url: "/dashboard",
        icon: Home01Icon,
        descriptionKey: "nav.dashboard.description",
      },
      {
        titleKey: "nav.sessions.title",
        url: "/sessions",
        icon: Chat01Icon,
        descriptionKey: "nav.sessions.description",
      },
      {
        titleKey: "nav.board.title",
        // ?tab=board 使 ProjectWorkspace 深链直落看板 tab（useEffect 监听 paramTab）
        url: "/board?tab=board",
        icon: DashboardSquare02Icon,
        descriptionKey: "nav.board.description",
      },
      {
        titleKey: "nav.docs.title",
        url: "/docs",
        icon: File01Icon,
        descriptionKey: "nav.docs.description",
      },
      {
        titleKey: "nav.reading.title",
        url: "/reading",
        icon: BookOpen01Icon,
        descriptionKey: "nav.reading.description",
      },
      // 用量/成本页不进侧栏：入口在顶部 header 的「成本」按钮（→ /usage 双 tab）。
    ],
  },
  {
    // 「更多」：非日常主线的功能收进此组，保持主工作区清爽（仍可访问/搜索）
    labelKey: "nav.groupMore",
    items: [
      {
        titleKey: "nav.calendar.title",
        url: "/calendar",
        icon: Calendar03Icon,
        descriptionKey: "nav.calendar.description",
      },
      {
        titleKey: "nav.memory.title",
        url: "/memory",
        icon: BrainIcon,
        descriptionKey: "nav.memory.description",
      },
      {
        titleKey: "nav.prompts.title",
        url: "/prompts",
        icon: CommandIcon,
        descriptionKey: "nav.prompts.description",
      },
      // Agents 管理入口（MVP 放 groupMore；S5 再归到专属分组）
      {
        titleKey: "nav.agents.title",
        url: "/agents",
        icon: BotIcon,
        descriptionKey: "nav.agents.description",
      },
    ],
  },
  {
    labelKey: "nav.groupSystem",
    items: [
      {
        titleKey: "nav.processes.title",
        url: "/processes",
        icon: TerminalIcon,
        descriptionKey: "nav.processes.description",
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
