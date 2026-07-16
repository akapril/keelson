// rework 通知中心迁移：notifications 集合（应用内通知，未来「化学反应」主动提议落点）。
// owner-only 访问；不使用 @request.body.X:changed（PB 0.30 会生成坏 SQL 导致 404）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const notif = new Collection({
    name: "notifications",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  notif.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  notif.fields.add(new Field({ name: "title", type: "text", required: true, max: 300 }));
  notif.fields.add(new Field({ name: "body", type: "text", max: 2000 }));
  notif.fields.add(
    new Field({
      name: "kind",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["info", "success", "warning", "error"],
    }),
  );
  notif.fields.add(new Field({ name: "read", type: "bool" }));
  // 可选：点击跳转的应用内路由（如 /board?open=xxx）
  notif.fields.add(new Field({ name: "link", type: "text", max: 500 }));
  // 可选：来源标签（如 "更新" / "AI" / "沉淀"）
  notif.fields.add(new Field({ name: "source", type: "text", max: 100 }));
  notif.fields.add(auto("created", false));
  notif.fields.add(auto("updated", true));
  notif.addIndex("idx_notif_owner_read", false, "owner, read", "");
  notif.addIndex("idx_notif_owner_created", false, "owner, created", "");
  app.save(notif);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("notifications"));
  } catch (_) {}
});
