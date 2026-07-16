// rework 阅读列表迁移：reading_items 集合（个人书签/稍后读）。
// owner-only 访问；不使用 @request.body.X:changed（PB 0.30 会生成坏 SQL 导致 404）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const reading = new Collection({
    name: "reading_items",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  reading.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  reading.fields.add(new Field({ name: "title", type: "text", required: true, max: 300 }));
  reading.fields.add(new Field({ name: "url", type: "text", max: 2000 }));
  reading.fields.add(new Field({ name: "note", type: "text", max: 5000 }));
  reading.fields.add(
    new Field({
      name: "status",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["unread", "reading", "archived"],
    }),
  );
  reading.fields.add(auto("created", false));
  reading.fields.add(auto("updated", true));
  reading.addIndex("idx_reading_owner_status", false, "owner, status", "");
  reading.addIndex("idx_reading_owner_updated", false, "owner, updated", "");
  app.save(reading);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("reading_items"));
  } catch (_) {}
});
