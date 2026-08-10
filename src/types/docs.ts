// Docs 类型定义 —— 项目内 Markdown 文档（owner-only 访问）。

/** 单篇看板文档记录（对应 PB docs 集合）。projects：多对多，一篇文档可链接多个项目。 */
export interface BoardDoc {
  id: string;
  owner: string;
  /** 关联的项目 id 列表（多对多）。 */
  projects: string[];
  title: string;
  content: string;
  created: string;
  updated: string;
  /** 软删除时间戳（非空即已删）；多机同步用。 */
  deleted_at?: string;
}
