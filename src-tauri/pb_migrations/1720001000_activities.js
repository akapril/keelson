// rework 实时活动流迁移：activities 集合（owner-only）。
// 只落「写操作」活动（MCP create_task/update_task/create_doc/update_doc 等），可回放历史。
// 读操作只走内存流不入库。沿用 memories 迁移写法，不用 @request.body.X:changed（PB 0.30 会生成坏 SQL 致 404）。
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const auto = (name, onUpdate) =>
    new Field({ name, type: "autodate", onCreate: true, onUpdate: !!onUpdate });

  const act = new Collection({
    name: "activities",
    type: "base",
    listRule: `@request.auth.id != "" && owner = @request.auth.id`,
    viewRule: `@request.auth.id != "" && owner = @request.auth.id`,
    createRule: `@request.auth.id != "" && @request.body.owner = @request.auth.id`,
    // 活动为不可变审计记录：不提供 updateRule（默认禁改），仅 owner 可删。
    deleteRule: `owner = @request.auth.id`,
  });
  act.fields.add(
    new Field({
      name: "owner",
      type: "relation",
      required: true,
      collectionId: users.id,
      cascadeDelete: true,
      maxSelect: 1,
    }),
  );
  // 来源档：mcp（进程内 MCP 调用）| hook（Phase 2 全量工具）
  act.fields.add(new Field({ name: "source", type: "text", max: 20 }));
  // 触发方：claude | codex | ""（MCP 侧未必可知则空）
  act.fields.add(new Field({ name: "provider", type: "text", max: 40 }));
  // 原始工具名：create_task / Edit / Bash ...
  act.fields.add(new Field({ name: "tool", type: "text", max: 100 }));
  // 归一动作：write | read | run | search（用于图标/分组）
  act.fields.add(new Field({ name: "action", type: "text", max: 20 }));
  // 一行人类可读摘要（短文本，避免整段内容）
  act.fields.add(new Field({ name: "summary", type: "text", max: 1000 }));
  // 关联 board 项目 id（有则路由到该项目「活动」tab）
  act.fields.add(new Field({ name: "project", type: "text", max: 200 }));
  // hook 侧 cwd；用于 repo→project 路由（Phase 2）
  act.fields.add(new Field({ name: "repo_path", type: "text", max: 500 }));
  // 触发会话 id（可空）
  act.fields.add(new Field({ name: "session_id", type: "text", max: 200 }));
  // 结果状态：ok | error
  act.fields.add(new Field({ name: "status", type: "text", max: 20 }));
  act.fields.add(auto("created", false));
  act.addIndex("idx_act_owner_created", false, "owner, created", "");
  act.addIndex("idx_act_owner_project", false, "owner, project", "");
  app.save(act);
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId("activities"));
  } catch (_) {}
});
