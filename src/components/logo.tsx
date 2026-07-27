// Keelson 品牌标记 —— 一根横向「龙骨梁」把三根高低不一的肋条(会话/进度)串到一条主线上。
// 隐喻 keelson：龙骨之上的加强纵梁，把散落的肋条收拢成稳定主干。
// 沿用同款技法：实心前景圆角方块 + 背景色负空间镂空，自动适配明暗主题。
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      className={`logo ${className ?? ""}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      {/* 底板 */}
      <rect x="3" y="5" width="26" height="22" rx="6" className="fill-foreground" />
      {/* 龙骨梁(横向主线) + 三根肋条(高低错落，自梁上垂下)，背景色镂空为一体 */}
      <rect x="8" y="10" width="16" height="2.6" rx="1.3" className="fill-background" />
      <rect x="9.4" y="10" width="2.6" height="11.5" rx="1.3" className="fill-background" />
      <rect x="14.7" y="10" width="2.6" height="7.5" rx="1.3" className="fill-background" />
      <rect x="20" y="10" width="2.6" height="9.5" rx="1.3" className="fill-background" />
    </svg>
  );
}
