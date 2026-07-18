// Git 相关类型（与 Rust commands/git.rs 的 serde 结构对齐）。

/** 一条提交的元信息；rework_session 解析自 commit 的 Rework-Session trailer（若有）。 */
export interface CommitInfo {
  hash: string;
  short: string;
  subject: string;
  author: string;
  committed_at: string; // ISO8601
  rework_session: string | null;
}

/** 关联方式：trailer 精确 / time 时间窗可能相关。 */
export type LinkKind = "trailer" | "time";

/** 与某会话关联的提交及其关联方式。 */
export interface CorrelatedCommit {
  commit: CommitInfo;
  link_kind: LinkKind;
}
