// 保存视图集合 board_views：命名视图配置(视图类型/筛选/泳道)，owner+project 级，软删可跨机同步。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const projects = app.findCollectionByNameOrId("board_projects");

  const rel = (name, collId, required) => new Field({ name, type: "relation", required: !!required, collectionId: collId, cascadeDelete: true, maxSelect: 1 });
  const text = (name, required, max) => new Field({ name, type: "text", required: !!required, max: max || 0 });
  const sel = (name, values) => new Field({ name, type: "select", required: true, maxSelect: 1, values });
  const num = (name) => new Field({ name, type: "number", required: false });
  const json = (name) => new Field({ name, type: "json", required: false, maxSize: 8192 });
  const auto = (name, onUpdate) => new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const c = new Collection({
    name: "board_views",
    type: "base",
    // owner-only：经 project.owner 判定（与其它 board 表一致）
    listRule: `@request.auth.id != "" && project.owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && project.owner = @request.auth.id`,
    // createRule 用记录关联解析 project.owner（与 1720000100_board.js 子表一致、已验证可用），
    // 而非 @request.body.project.owner 的 body 遍历式（该式在本 PB 设置未验证，可能致创建 403）
    createRule: `@request.auth.id != "" && project.owner = @request.auth.id`,
    updateRule: `project.owner = @request.auth.id`,
    deleteRule: `project.owner = @request.auth.id`,
  });
  c.fields.add(rel("owner", users.id, true));
  c.fields.add(rel("project", projects.id, true));
  c.fields.add(text("name", true, 160));
  c.fields.add(sel("view_type", ["kanban", "list", "timeline"]));
  c.fields.add(json("filter"));
  c.fields.add(sel("swimlane", ["none", "priority", "assignee", "label", "agent"]));
  c.fields.add(num("sort_order"));
  c.fields.add(text("deleted_at", false, 40));
  c.fields.add(auto("created", false));
  c.fields.add(auto("updated", true));
  c.addIndex("idx_board_views_project", false, "project, sort_order", "");
  app.save(c);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("board_views");
    app.delete(c);
  } catch (_) {}
});
