// rework 文档迁移：docs 集合（项目内富文本/Markdown 笔记）。
// owner + project(relation board_projects) + 单用户 owner-only 访问规则。
// 注意：不使用 @request.body.X:changed（PB 0.30 会生成坏 SQL 导致 404）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const projId = app.findCollectionByNameOrId("board_projects").id;

  // autodate：PB 0.30 base 表不自动加 created/updated，需显式添加。
  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const docs = new Collection({
    name: "docs",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    updateRule: `owner = @request.auth.id`,
    deleteRule: `owner = @request.auth.id`,
  });
  docs.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  docs.fields.add(
    new Field({
      name: "project",
      type: "relation",
      required: true,
      collectionId: projId,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  docs.fields.add(new Field({ name: "title", type: "text", required: true, max: 200 }));
  // content：Markdown 正文，max 0 = 不限长度
  docs.fields.add(new Field({ name: "content", type: "text", max: 0 }));
  docs.fields.add(auto("created", false));
  docs.fields.add(auto("updated", true));
  docs.addIndex("idx_docs_owner_project", false, "owner, project", "");
  docs.addIndex("idx_docs_project_updated", false, "project, updated", "");
  app.save(docs);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("docs"));
  } catch (_) {}
});
