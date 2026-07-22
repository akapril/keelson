// 会话文件改动类型 —— 对应 Rust models::FileChange/FileEdit。
// 从会话转录里的 Write/Edit/MultiEdit 工具调用还原「本会话改动了哪些文件、改了什么」。

/** 一次文件改动（Write 时 old 为空、new 为写入内容）。 */
export interface FileEdit {
  tool: string; // Write / Edit / MultiEdit
  old: string;
  new: string;
}

/** 某文件在会话内的全部改动（按文件聚合）。 */
export interface FileChange {
  path: string;
  edits: FileEdit[];
}
