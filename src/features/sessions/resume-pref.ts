// 会话恢复「新窗口 vs 标签页」偏好（本机 localStorage，默认新窗口）。
// 主循环最高频动作「接续会话」原先每次弹 RestoreDialog 二选一，90% 场景每次同选=纯摩擦；
// 改为记住上次选择、按钮一键接续，需要换模式时再从会话卡右键菜单显式指定（同时更新此偏好）。
const KEY = "keelson-resume-astab";

/** 读取偏好：true=作为标签页恢复，false=新终端窗口（默认）。 */
export function getResumeAsTab(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** 写入偏好（新窗/标签的显式选择会记住，作为下次一键接续的默认）。 */
export function setResumeAsTab(asTab: boolean): void {
  try {
    localStorage.setItem(KEY, asTab ? "1" : "0");
  } catch {
    /* 忽略写入失败 */
  }
}
