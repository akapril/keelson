// 指令库分类：给 prompts 增 type(snippet/report)。
// snippet=会话/AI 面板插入片段(支持 {{变量}})；report=工作报告模板(纯系统提示，不替换变量)。
// 各消费方按 type 过滤：会话插入只看 snippet，报告页只看 report。
// 存量指令(本就是插入用)一律回填 snippet。
migrate((app) => {
  const c = app.findCollectionByNameOrId("prompts");
  if (!c.fields.getByName("type")) {
    c.fields.add(
      new Field({
        name: "type",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["snippet", "report"],
      }),
    );
    app.save(c);
  }
  // 回填存量为 snippet（空 type 视为历史片段）
  try {
    const recs = app.findAllRecords("prompts");
    for (const r of recs) {
      if (!r.getString("type")) {
        r.set("type", "snippet");
        app.save(r);
      }
    }
  } catch (_) {}
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("prompts");
    const f = c.fields.getByName("type");
    if (f) {
      c.fields.removeById(f.id);
      app.save(c);
    }
  } catch (_) {}
});
