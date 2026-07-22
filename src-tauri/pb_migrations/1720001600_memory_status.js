// 记忆账本「待审」状态：给 memories 增 status(pending/accepted)。
// 外部 AI 经 MCP create_memory 写入的记忆默认 pending，需用户在 rework 里采纳后才正式生效；
// 存量记忆(本就经前端审核入账)一律回填 accepted。
migrate((app) => {
  const mem = app.findCollectionByNameOrId("memories");
  if (!mem.fields.getByName("status")) {
    mem.fields.add(
      new Field({
        name: "status",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["pending", "accepted"],
      }),
    );
    app.save(mem);
  }
  // 回填存量为 accepted（空 status 视为历史已采纳）
  try {
    const recs = app.findAllRecords("memories");
    for (const r of recs) {
      if (!r.getString("status")) {
        r.set("status", "accepted");
        app.save(r);
      }
    }
  } catch (_) {}
}, (app) => {
  try {
    const mem = app.findCollectionByNameOrId("memories");
    const f = mem.fields.getByName("status");
    if (f) {
      mem.fields.removeById(f.id);
      app.save(mem);
    }
  } catch (_) {}
});
