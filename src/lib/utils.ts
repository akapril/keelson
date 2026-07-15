// cn —— 合并 Tailwind 类名（clsx 组合 + tailwind-merge 去冲突）。
// 移植自 workavera（Apache-2.0），是 shadcn/ui 组件的通用依赖。
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
