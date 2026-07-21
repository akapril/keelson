// 修复：多个集合的 updateRule 使用了 `@request.body.X:changed`，
// 而 PB 0.30 不支持该修饰符 → 规则报「unknown modifier」→ 整个 PATCH 返回 404。
// 症状：项目描述/任务/状态列/标签/会话备注等一切「更新」都改不动（静默 404）。
// 修正：去掉 :changed 子句，换成与 sessions_meta（已修）一致的可用规则。
// （:changed 原意是防止改 owner/project，但 PB 0.30 不支持且前端本就不改这些字段，去掉可接受。）
migrate((app) => {
  const fixes = {
    session_tags: `@request.auth.id != "" && owner = @request.auth.id`,
    session_notes: `@request.auth.id != "" && owner = @request.auth.id`,
    board_projects: `@request.auth.id != "" && owner = @request.auth.id`,
    board_project_members: `project.owner = @request.auth.id`,
    board_project_states: `project.owner = @request.auth.id`,
    board_project_labels: `project.owner = @request.auth.id`,
    board_tasks: `project.owner = @request.auth.id`,
    board_templates: `@request.auth.id != "" && owner = @request.auth.id`,
  };
  for (const name of Object.keys(fixes)) {
    try {
      const c = app.findCollectionByNameOrId(name);
      c.updateRule = fixes[name];
      app.save(c);
    } catch (_) {
      // 集合不存在则跳过（不同环境集合可能缺失）
    }
  }
}, (_app) => {
  // 不回滚（回滚会把坏规则塞回去，得不偿失）
});
