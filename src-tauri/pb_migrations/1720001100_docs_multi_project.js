// docs 文档：单项目 → 多项目（多对多）。
// 新增 projects（多选关系，不级联删——删项目仅断链、不删多链文档），回填 = [原 project]；
// 旧 project 降为非必填保留（代码不再使用，避免高风险字段删除）。
migrate((app) => {
  const projId = app.findCollectionByNameOrId("board_projects").id;
  const docs = app.findCollectionByNameOrId("docs");

  // 旧 project 单选：降为非必填（新文档只写 projects）
  const projField = docs.fields.getByName("project");
  if (projField) {
    projField.required = false;
  }

  // 新 projects 多选关系：一个文档可链接多个项目；不级联删除
  docs.fields.add(
    new Field({
      name: "projects",
      type: "relation",
      required: false,
      collectionId: projId,
      cascadeDelete: false,
      maxSelect: 50,
      minSelect: 0,
    }),
  );
  app.save(docs);

  // 回填：每篇文档 projects = [原 project]
  const records = app.findAllRecords("docs");
  for (const r of records) {
    const p = r.get("project");
    if (p) {
      r.set("projects", [p]);
      app.save(r);
    }
  }
}, (app) => {
  // 回滚：移除 projects，恢复 project 必填（best-effort）
  try {
    const docs = app.findCollectionByNameOrId("docs");
    const f = docs.fields.getByName("projects");
    if (f) docs.fields.removeById(f.id);
    const projField = docs.fields.getByName("project");
    if (projField) projField.required = true;
    app.save(docs);
  } catch (_) {}
});
