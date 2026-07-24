// 修坑：docs.content 在 1720000200 建表时设 max:0（PB 0.30 回落默认 5000 上限）。
// 1720002100 修了 reading_items/prompts 却漏了 docs.content —— 长文档保存 400、静默丢数据。
// 顺带兜底 sessions_meta.last_prompt / session_notes.content（同 max:0/无 max 隐患）。
migrate((app) => {
  const setMax = (collName, fieldName, max) => {
    try {
      const c = app.findCollectionByNameOrId(collName);
      const f = c.fields.getByName(fieldName);
      if (f) {
        f.max = max;
        app.save(c);
      }
    } catch (_) {
      /* 集合/字段不存在则跳过 */
    }
  };
  // 文档正文可很长 → 256KB
  setMax("docs", "content", 262144);
  // 会话最后 prompt 常粘长代码 → 16KB；备注 → 64KB
  setMax("sessions_meta", "last_prompt", 16384);
  setMax("session_notes", "content", 65536);
}, (app) => {
  // 回滚：还原 max:0（即回到默认 5000 行为）
  const setMax = (collName, fieldName, max) => {
    try {
      const c = app.findCollectionByNameOrId(collName);
      const f = c.fields.getByName(fieldName);
      if (f) {
        f.max = max;
        app.save(c);
      }
    } catch (_) {}
  };
  setMax("docs", "content", 0);
  setMax("sessions_meta", "last_prompt", 0);
  setMax("session_notes", "content", 0);
});
