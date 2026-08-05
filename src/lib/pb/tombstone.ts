// 软删除谓词：deleted_at 非空即已软删。供实时订阅把"带 deleted_at 的 update"当删除。
export function isTombstoned(rec: { deleted_at?: string }): boolean {
  return !!rec.deleted_at && rec.deleted_at.length > 0;
}
