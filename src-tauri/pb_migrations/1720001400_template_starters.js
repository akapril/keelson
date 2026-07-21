// 模板专业化：给 board_templates 增 tasks / starter_docs 两个 json 字段，
// 并 seed 若干「开箱即用」的专业模板（含初始任务 + 起始文档），
// 让模板从「只是换列名」升级为「带工作流的启动包」。体现 rework 的 AI 开发身份。
migrate((app) => {
  const templates = app.findCollectionByNameOrId("board_templates");

  // 1) 加字段（若已存在则跳过，保证可重入）
  const addJsonField = (name) => {
    if (templates.fields.getByName(name)) return;
    templates.fields.add(new Field({ name, type: "json", required: false, maxSize: 262144 }));
  };
  addJsonField("tasks");
  addJsonField("starter_docs");
  app.save(templates);

  // 2) seed 专业模板（owner 留空 = 内置全局）
  const SPEC_DOC = [
    "# 项目 Spec",
    "",
    "## 目标",
    "一句话说明要解决什么问题、给谁用。",
    "",
    "## 背景 / 现状",
    "当前如何、痛点在哪。",
    "",
    "## 方案",
    "选定方案与关键取舍（KISS / YAGNI）。",
    "",
    "## 任务分解",
    "- [ ] 切片一",
    "- [ ] 切片二",
    "",
    "## 验收标准",
    "怎样算完成、如何验证。",
    "",
  ].join("\n");

  const CONTENT_CALENDAR = [
    "## 内容日历",
    "",
    "| 日期 | 平台 | 选题 | 状态 |",
    "| --- | --- | --- | --- |",
    "|  |  |  | 选题 |",
    "",
  ].join("\n");

  const LIT_LIST = [
    "## 文献清单",
    "",
    "- [ ] 标题 —— 作者 —— 链接 —— 一句话要点",
    "",
  ].join("\n");

  const seeds = [
    {
      name: "AI 开发流水线",
      description: "面向 AI 辅助编码：计划→编码→审查→合并，附 spec 骨架与起步任务",
      states: [
        { name: "计划", color: "#94a3b8", category: "pending" },
        { name: "编码", color: "#3b82f6", category: "active" },
        { name: "审查", color: "#a855f7", category: "active" },
        { name: "合并", color: "#22c55e", category: "completed" },
      ],
      labels: [
        { name: "feature", color: "#3b82f6" },
        { name: "bug", color: "#ef4444" },
        { name: "重构", color: "#f59e0b" },
        { name: "spec", color: "#8b5cf6" },
      ],
      tasks: [
        { title: "写 spec / 明确目标", category: "pending", description: "用起始的「项目 Spec」文档细化目标、方案与验收标准" },
        { title: "拆解实现计划", category: "pending" },
        { title: "实现首个可测切片", category: "active" },
        { title: "自测 + 类型/单测通过", category: "active" },
        { title: "自审 diff + 提 PR", category: "active" },
      ],
      starter_docs: [{ title: "项目 Spec", content: SPEC_DOC }],
    },
    {
      name: "内容创作",
      description: "选题→初稿→精修→已发布，附内容日历",
      states: [
        { name: "选题", color: "#94a3b8", category: "pending" },
        { name: "初稿", color: "#3b82f6", category: "active" },
        { name: "精修", color: "#a855f7", category: "active" },
        { name: "已发布", color: "#22c55e", category: "completed" },
      ],
      labels: [
        { name: "视频", color: "#ef4444" },
        { name: "图文", color: "#3b82f6" },
        { name: "脚本", color: "#f59e0b" },
      ],
      tasks: [
        { title: "确定选题 + 大纲", category: "pending" },
        { title: "完成初稿", category: "active" },
        { title: "精修 + 配图", category: "active" },
      ],
      starter_docs: [{ title: "内容日历", content: CONTENT_CALENDAR }],
    },
    {
      name: "研究笔记",
      description: "收集→精读→综述→归档，附文献清单",
      states: [
        { name: "收集", color: "#94a3b8", category: "pending" },
        { name: "精读", color: "#3b82f6", category: "active" },
        { name: "综述", color: "#a855f7", category: "active" },
        { name: "归档", color: "#22c55e", category: "completed" },
      ],
      labels: [
        { name: "论文", color: "#3b82f6" },
        { name: "想法", color: "#f59e0b" },
      ],
      tasks: [
        { title: "收集相关文献", category: "pending" },
        { title: "精读并做笔记", category: "active" },
        { title: "写综述 / 总结", category: "active" },
      ],
      starter_docs: [{ title: "文献清单", content: LIT_LIST }],
    },
  ];

  for (const s of seeds) {
    // 同名已存在则跳过（可重入）
    try {
      const existing = app.findFirstRecordByFilter(
        "board_templates",
        `owner = "" && name = {:n}`,
        { n: s.name },
      );
      if (existing) continue;
    } catch (_) {
      // 未找到 → 继续 seed
    }
    const rec = new Record(templates);
    rec.set("owner", "");
    rec.set("name", s.name);
    rec.set("description", s.description);
    rec.set("states", s.states);
    rec.set("labels", s.labels);
    rec.set("tasks", s.tasks);
    rec.set("starter_docs", s.starter_docs);
    app.save(rec);
  }
}, (app) => {
  // 回滚：删除本迁移 seed 的三个模板 + 移除字段
  for (const name of ["AI 开发流水线", "内容创作", "研究笔记"]) {
    try {
      const rec = app.findFirstRecordByFilter(
        "board_templates",
        `owner = "" && name = {:n}`,
        { n: name },
      );
      if (rec) app.delete(rec);
    } catch (_) {}
  }
  try {
    const templates = app.findCollectionByNameOrId("board_templates");
    for (const f of ["tasks", "starter_docs"]) {
      const field = templates.fields.getByName(f);
      if (field) templates.fields.removeById(field.id);
    }
    app.save(templates);
  } catch (_) {}
});
