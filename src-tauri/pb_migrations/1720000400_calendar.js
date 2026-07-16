// rework 日历迁移：calendar_events 集合（个人日程/事件）。
// owner-only 访问；不使用 @request.body.X:changed（PB 0.30 会生成坏 SQL 导致 404）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const cal = new Collection({
    name: "calendar_events",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  cal.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  cal.fields.add(new Field({ name: "title", type: "text", required: true, max: 300 }));
  cal.fields.add(new Field({ name: "description", type: "text", max: 5000 }));
  // start 必填；end 可空（多日事件）；均为 date 类型
  cal.fields.add(new Field({ name: "start", type: "date", required: true }));
  cal.fields.add(new Field({ name: "end", type: "date" }));
  cal.fields.add(new Field({ name: "all_day", type: "bool" }));
  cal.fields.add(new Field({ name: "color", type: "text", max: 20 }));
  cal.fields.add(auto("created", false));
  cal.fields.add(auto("updated", true));
  cal.addIndex("idx_cal_owner_start", false, "owner, start", "");
  app.save(cal);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("calendar_events"));
  } catch (_) {}
});
