// Docs 类型定义 —— 项目内 Markdown 文档（owner-only 访问）。

/** 单篇看板文档记录（对应 PB docs 集合） */
export interface BoardDoc {
  id: string;
  owner: string;
  project: string;
  title: string;
  content: string;
  created: string;
  updated: string;
}
