// 修坑：PB 0.30 的 text 字段 max:0 不是"无限"，而是回落默认 5000 上限。
// reading_items 的 content_text(缓存正文)/summary/key_points 曾用 max:0 期望无限，
// 实际被限 5000——正文一长 AI 摘要写回即 400。对齐 workavera 做法：设显式大 max。
// 顺带修 prompts.content(同样 max:0 的隐患，长 prompt 会 5000 截断)。
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
  // 正文缓存可很长 → 256KB；摘要/要点 → 64KB(足够且远超 5000)
  setMax("reading_items", "content_text", 262144);
  setMax("reading_items", "summary", 65536);
  setMax("reading_items", "key_points", 65536);
  // 指令库正文同坑：长 prompt 也会被 5000 截 → 64KB
  setMax("prompts", "content", 65536);
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
  setMax("reading_items", "content_text", 0);
  setMax("reading_items", "summary", 0);
  setMax("reading_items", "key_points", 0);
  setMax("prompts", "content", 0);
});
