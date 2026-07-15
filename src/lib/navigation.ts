// 侧栏导航数据（数据驱动，结构移植自 workavera，内容改为 rework 路由）。
import type { IconSvgElement } from "@hugeicons/react";
import {
  Chat01Icon,
  KanbanIcon,
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
        title: "会话中枢",
        url: "/sessions",
        icon: Chat01Icon,
        description: "本地 AI CLI 会话的浏览、检索与恢复",
      },
      {
        title: "看板",
        url: "/board",
        icon: KanbanIcon,
        description: "项目与任务的看板管理",
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
