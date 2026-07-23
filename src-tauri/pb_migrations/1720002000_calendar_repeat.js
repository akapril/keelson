// 日历轻量循环：给 calendar_events 增 repeat 字段（空=不重复 / daily / weekly / monthly / yearly）。
// 仅存规则；展开成 occurrence 在前端做（只读，不做例外/单次编辑）。
migrate((app) => {
  const c = app.findCollectionByNameOrId("calendar_events");
  if (!c.fields.getByName("repeat")) {
    c.fields.add(new Field({ name: "repeat", type: "text", required: false, max: 20 }));
    app.save(c);
  }
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("calendar_events");
    const f = c.fields.getByName("repeat");
    if (f) {
      c.fields.removeById(f.id);
      app.save(c);
    }
  } catch (_) {}
});
