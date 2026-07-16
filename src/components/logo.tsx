// rework 品牌标记 —— 极简错位叠层方块（隐喻会话 × 看板的融合/分层）。
// 前景色填充、无底色方块，风格对齐 workavera 的裸 SVG logo。
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={`logo ${className ?? ""}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      {/* 后层（较淡） */}
      <rect
        x="4"
        y="4"
        width="17"
        height="17"
        rx="4.5"
        className="fill-foreground"
        opacity="0.35"
      />
      {/* 前层（实心） */}
      <rect
        x="11"
        y="11"
        width="17"
        height="17"
        rx="4.5"
        className="fill-foreground"
      />
    </svg>
  );
}
