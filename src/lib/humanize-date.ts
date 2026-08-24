// 截止日期人性化（TaskCard 等共用）。把一律绝对『8月24』改成 逾期Nd / 今天 / 明天 / 绝对短日期，
// 免去分诊时心算日期差。逾期返回 overdue=true 供调用方上 destructive 色。
// i18n key 走调用方传入的 t（board ns：due.overdue / due.today / due.tomorrow）。
export interface DueInfo {
  text: string;
  overdue: boolean;
}

export function humanizeDueDate(
  dateStr: string,
  now: number,
  locale: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): DueInfo {
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) return { text: "", overdue: false };
  // 归一到本地零点算整天差，避免时分误差
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return { text: t("due.overdue", { n: -diffDays }), overdue: true };
  if (diffDays === 0) return { text: t("due.today"), overdue: false };
  if (diffDays === 1) return { text: t("due.tomorrow"), overdue: false };
  // 更远：回落绝对短日期（本地化，砍 weekday 档）
  return {
    text: due.toLocaleDateString(locale, { month: "short", day: "numeric" }),
    overdue: false,
  };
}
