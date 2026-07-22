// 指令库（Prompt Library）迁移：prompts 集合（owner-only）。
// 可复用的 prompt/指令片段，支持 {{变量}} 占位，插入会话/AI 面板。
// content 用 max:0 绕开 PB 运行时 5000 字符上限（指令可能很长）。不用 :changed 修饰符。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const c = new Collection({
    name: "prompts",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  c.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  c.fields.add(new Field({ name: "title", type: "text", required: true, max: 200 }));
  c.fields.add(new Field({ name: "content", type: "text", required: true, max: 0 }));
  c.fields.add(new Field({ name: "tags", type: "text", max: 500 }));
  c.fields.add(auto("created", false));
  c.fields.add(auto("updated", true));
  c.addIndex("idx_prompts_owner_updated", false, "owner, updated", "");
  app.save(c);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("prompts"));
  } catch (_) {}
});
