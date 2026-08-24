// 统一的键盘焦点环类（与 ui/button-variants 同款）。
// 目的：全仓手搓的 interactive button 焦点提示三套并存（ring-[3px] / ring-2 / 零环），
// 且部分用 focus 而非 focus-visible 致鼠标点击也亮环。统一挂此常量：
// 仅键盘态(focus-visible)显现，宽度/颜色与 shadcn 按钮一致，不引入新色。
export const focusRing =
  "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
