// 命令面板「最近项」MRU（本机 localStorage）。
// 记录用户经命令面板跳转过的对象（项目/文档/会话/页面），空查询时置顶展示为快速切换器。
// 存 url + label：label 即选中时的可见文本；轻微陈旧（如项目改名）可接受，下次访问即刷新。
export interface MruEntry {
  url: string;
  label: string;
}

const KEY = "keelson-cmdk-mru";
const CAP = 8; // 上限，超出丢弃最旧

export function getMru(): MruEntry[] {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(a) ? (a as MruEntry[]).filter((e) => e && e.url && e.label) : [];
  } catch {
    return [];
  }
}

/** 记一笔：同 url 去重后置顶，截断到上限。 */
export function pushMru(entry: MruEntry): void {
  try {
    const cur = getMru().filter((e) => e.url !== entry.url);
    localStorage.setItem(KEY, JSON.stringify([entry, ...cur].slice(0, CAP)));
  } catch {
    /* 忽略写入失败 */
  }
}
