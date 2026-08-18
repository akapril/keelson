// 项目工作台「返回」目标判定（纯函数，便于单测）。
// - 上下文跳转（文档/总览/命令面板/会话跳转，URL 带 ?open 且无 from=fav）→ "back"：浏览器后退回来源页。
// - 侧栏收藏浏览进入（?from=fav）或项目列表点开（无 ?open）→ "list"：清 ?open 回项目列表。
export type BackTarget = "back" | "list";

export function backTarget(openId: string | null, fromFav: boolean): BackTarget {
  if (openId && !fromFav) return "back";
  return "list";
}
