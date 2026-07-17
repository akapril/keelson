// 阅读增强迁移：reading_items 加 AI 摘要/要点、正文缓存、标签、置顶。
// content_text 必须 max:0（PB text 默认 5000 上限，缓存正文会超）。
migrate((app) => {
  const col = app.findCollectionByNameOrId("reading_items");
  col.fields.add(new Field({ name: "tags", type: "text", max: 500 }));
  // summary / key_points 也用 max:0：AI 输出长度不定，避免超 5000 默认上限致 PB 写失败
  col.fields.add(new Field({ name: "summary", type: "text", max: 0 }));
  col.fields.add(new Field({ name: "key_points", type: "text", max: 0 }));
  col.fields.add(new Field({ name: "content_text", type: "text", max: 0 }));
  col.fields.add(new Field({ name: "pinned", type: "bool" }));
  col.addIndex("idx_reading_owner_pinned", false, "owner, pinned", "");
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("reading_items");
  for (const n of ["tags", "summary", "key_points", "content_text", "pinned"]) {
    const f = col.fields.find((x) => x.name === n);
    if (f) col.fields.removeById(f.id);
  }
  app.save(col);
});
