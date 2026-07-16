// rework 品牌标记 —— 圆角方块「看板」内嵌三根高低不一的列（隐喻看板/进度）。
// 采用 workavera 同款技法：实心前景形状 + 背景色负空间镂空，前景色填充、无底色方块。
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={`logo ${className ?? ""}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      {/* 看板底板 */}
      <rect x="3" y="5" width="26" height="22" rx="6" className="fill-foreground" />
      {/* 三根列（背景色镂空，高低错落，隐喻进行中的看板） */}
      <rect x="7.5" y="10" width="4" height="12" rx="1.6" className="fill-background" />
      <rect x="14" y="10" width="4" height="7.5" rx="1.6" className="fill-background" />
      <rect x="20.5" y="10" width="4" height="10" rx="1.6" className="fill-background" />
    </svg>
  );
}
