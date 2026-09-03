// web/panels/icons.tsx — web 栏内联描边图标集
//
// 与 WebApp.tsx 的 TabIcon 同一风格（Lucide/Feather：24×24 / fill:none / stroke:currentColor /
// strokeWidth 1.75 / 圆角圆头），替代终端键条/工作台里风格不统一的 emoji。
// 无额外依赖（web 包刻意不引 hugeicons，保持体积）。
import type { SVGProps } from "react";

/** 图标通用属性：默认 size-4，颜色继承 currentColor。 */
function Base({ className = "size-4", children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** 键盘：显式弹出软键盘。 */
export function KeyboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
    </Base>
  );
}

/** 剪贴板：粘贴（读剪贴板 → stdin）。 */
export function PasteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </Base>
  );
}

/** 放大镜：搜索。 */
export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Base>
  );
}

/** 刷新：进程退出后重启。 */
export function RestartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </Base>
  );
}

/** 文档：会话记录查看入口。 */
export function FileTextIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
    </Base>
  );
}

/** 扳手：工具调用条目标记。 */
export function WrenchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Base {...props}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </Base>
  );
}
