// 多机同步 P1：给同步集合加 deleted_at(date) tombstone 字段。
// 空值=未删；有值(ISO 时间)=已软删。与业务字段 archived/status 正交共存。
// 只覆盖参与同步的集合；notifications/activities/sessions_* 不加。
migrate((app) => {
  const COLLS = [
    "board_projects",
    "board_project_states",
    "board_project_labels",
    "board_project_members",
    "board_tasks",
    "board_templates",
    "doc_assets",
    "docs",
    "reading_items",
    "calendar_events",
    "memories",
    "prompts",
  ];
  for (const name of COLLS) {
    const c = app.findCollectionByNameOrId(name);
    if (!c.fields.getByName("deleted_at")) {
      c.fields.add(new Field({ name: "deleted_at", type: "date", required: false }));
      app.save(c);
    }
  }
}, (app) => {
  // 回滚：逐集合移除 deleted_at
  const COLLS = [
    "board_projects", "board_project_states", "board_project_labels",
    "board_project_members", "board_tasks", "board_templates", "doc_assets",
    "docs", "reading_items", "calendar_events", "memories", "prompts",
  ];
  for (const name of COLLS) {
    try {
      const c = app.findCollectionByNameOrId(name);
      const f = c.fields.getByName("deleted_at");
      if (f) { c.fields.removeById(f.id); app.save(c); }
    } catch (_) {}
  }
});
