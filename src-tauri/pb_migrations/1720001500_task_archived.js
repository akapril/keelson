// 看板任务归档：给 board_tasks 增 archived(bool) 字段。
// 已完成任务归档而非删除——保留「会话→任务→提交」溯源链；配合前端自动归档(完成 N 天后)。
migrate((app) => {
  const tasks = app.findCollectionByNameOrId("board_tasks");
  if (!tasks.fields.getByName("archived")) {
    tasks.fields.add(new Field({ name: "archived", type: "bool", required: false }));
    app.save(tasks);
  }
}, (app) => {
  // 回滚：移除字段
  try {
    const tasks = app.findCollectionByNameOrId("board_tasks");
    const f = tasks.fields.getByName("archived");
    if (f) {
      tasks.fields.removeById(f.id);
      app.save(tasks);
    }
  } catch (_) {}
});
