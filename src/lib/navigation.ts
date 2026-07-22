// 侧栏导航数据（数据驱动，结构移植自 workavera，内容改为 rework 路由）。
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
} from "@hugeicons/core-free-icons";

export type NavItem = {
  title: string;
  url: string;
  icon: IconSvgElement;
  description?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    label: "工作区",
    items: [
      {
        title: "总览",
        url: "/dashboard",
        icon: Home01Icon,
        description: "会话 · 看板 · 阅读 · 日程一览",
      },
      {
        title: "会话中枢",
        url: "/sessions",
        icon: Chat01Icon,
        description: "本地 AI CLI 会话的浏览、检索与恢复",
      },
      {
        title: "项目",
        url: "/board",
        icon: DashboardSquare02Icon,
        description: "项目工作台：会话 · 看板 · 文档 · git",
      },
      {
        title: "文档",
        url: "/docs",
        icon: File01Icon,
        description: "跨项目文档汇总与搜索",
      },
      {
        title: "阅读",
        url: "/reading",
        icon: BookOpen01Icon,
        description: "个人书签 / 稍后读",
      },
      {
        title: "日历",
        url: "/calendar",
        icon: Calendar03Icon,
        description: "个人日程 / 事件",
      },
      {
        title: "记忆账本",
        url: "/memory",
        icon: BrainIcon,
        description: "跨厂商提炼的可复用记忆",
      },
      {
        title: "指令库",
        url: "/prompts",
        icon: CommandIcon,
        description: "可复用 prompt / 片段，支持变量与一键插入",
      },
    ],
  },
  {
    label: "系统",
    items: [
      {
        title: "设置",
        url: "/settings",
        icon: Settings02Icon,
        description: "偏好与账户设置",
      },
    ],
  },
];

export const flatNavItems: NavItem[] = navGroups.flatMap((g) => g.items);
