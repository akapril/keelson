// rework 跨厂商记忆账本迁移：memories 集合（owner-only）。
// 把 claude/codex 会话里提炼的事实/偏好/决策/约定存为可去重、可溯源、可注入的本地知识层。
// 不用 @request.body.X:changed（PB 0.30 会生成坏 SQL 导致 404）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const mem = new Collection({
    name: "memories",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  mem.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  // 记忆正文（一句话断言）。max 2000：短文本，避免整段会话。
  mem.fields.add(new Field({ name: "content", type: "text", required: true, max: 2000 }));
  // 粒度类别
  mem.fields.add(
    new Field({
      name: "kind",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["fact", "preference", "decision", "convention"],
    }),
  );
  // 作用域：global=进每个 CLAUDE.md；project=仅对应仓库
  mem.fields.add(
    new Field({
      name: "scope",
      type: "select",
      required: true,
      maxSelect: 1,
      values: ["global", "project"],
    }),
  );
  // scope=project 时的关联项目 id（可空）
  mem.fields.add(new Field({ name: "project", type: "text", max: 200 }));
  // 置信度（多来源命中会累加；0-100 或自由小数）
  mem.fields.add(new Field({ name: "confidence", type: "number" }));
  // 溯源：来源会话 + provider + 锚点（第 N 条消息，可空）
  mem.fields.add(new Field({ name: "source_session_id", type: "text", max: 200 }));
  mem.fields.add(new Field({ name: "source_provider", type: "text", max: 40 }));
  mem.fields.add(new Field({ name: "source_anchor", type: "text", max: 200 }));
  // 去重合并时指向胜出记忆的 id（保留溯源链）
  mem.fields.add(new Field({ name: "superseded_by", type: "text", max: 200 }));
  mem.fields.add(auto("created", false));
  mem.fields.add(auto("updated", true));
  mem.addIndex("idx_mem_owner_kind", false, "owner, kind", "");
  mem.addIndex("idx_mem_owner_scope", false, "owner, scope", "");
  mem.addIndex("idx_mem_owner_project", false, "owner, project", "");
  app.save(mem);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("memories"));
  } catch (_) {}
});
