// 模板角色化：给 board_templates 增 category 字段（用于新建对话框按领域分组），
// 回填现有模板的分类，并 seed 面向不同角色的「富模板」（列+标签+起步任务+起始文档），
// 让模板不只服务开发者，覆盖职场/管理、内容/营销、个人/生活、商业/创业。
migrate((app) => {
  const templates = app.findCollectionByNameOrId("board_templates");

  // 1) 加 category 字段（可重入）
  if (!templates.fields.getByName("category")) {
    templates.fields.add(new Field({ name: "category", type: "text", required: false, max: 40 }));
    app.save(templates);
  }

  // 2) 回填现有模板的分类
  const EXISTING_CAT = {
    "简易看板": "通用",
    "Simple Kanban": "通用",
    "软件开发": "开发",
    "问题跟踪": "开发",
    "AI 开发流水线": "开发",
    "内容创作": "内容营销",
    "研究笔记": "研究",
  };
  try {
    for (const rec of app.findAllRecords("board_templates")) {
      const nm = rec.getString("name");
      if (EXISTING_CAT[nm] && !rec.getString("category")) {
        rec.set("category", EXISTING_CAT[nm]);
        app.save(rec);
      }
    }
  } catch (_) {}

  // 起始文档（保持简短，够用即可）
  const D_PRD = ["# PRD", "", "## 目标 / 背景", "要解决谁的什么问题。", "", "## 需求点", "- [ ] 需求一", "- [ ] 需求二", "", "## 验收标准", "怎样算完成。", ""].join("\n");
  const D_PLAN = ["## 项目计划", "", "**目标**：", "", "**里程碑**：", "- M1 ", "- M2 ", "", "**风险 / 依赖**：", "- ", ""].join("\n");
  const D_JD = ["## 岗位 JD", "", "**职责**：", "**要求**：", "", "## 评估维度", "| 维度 | 评分 | 备注 |", "| --- | --- | --- |", "|  |  |  |", ""].join("\n");
  const D_BRIEF = ["## Campaign Brief", "", "**目标 / KPI**：", "**受众**：", "**渠道**：", "**预算**：", "**排期**：", ""].join("\n");
  const D_OUTLINE = ["## 写作大纲", "", "- 第 1 章 ", "  - 要点", "- 第 2 章 ", "", "## 待查 / 素材", "- ", ""].join("\n");
  const D_WEEK = ["## 本周计划", "", "**本周三件事**：", "1. ", "2. ", "3. ", "", "## 收集箱", "- ", ""].join("\n");
  const D_STUDY = ["## 学习计划", "", "**目标**：", "**每日**：", "", "## 错题本", "- 题目 —— 原因 —— 订正", ""].join("\n");
  const D_JOB = ["## 目标公司清单", "", "| 公司 | 岗位 | 渠道 | 状态 |", "| --- | --- | --- | --- |", "|  |  |  | 投递 |", "", "## 简历要点", "- ", ""].join("\n");
  const D_CRM = ["## 客户跟进", "", "| 客户 | 意向 | 下一步 | 跟进日期 |", "| --- | --- | --- | --- |", "|  |  |  |  |", ""].join("\n");
  const D_LEAN = ["## 精益画布", "", "**问题**：", "**目标用户**：", "**独特价值**：", "**解决方案**：", "**关键指标（北极星）**：", ""].join("\n");
  const D_EVENT = ["## 活动策划案", "", "**主题 / 目标**：", "**时间 / 场地**：", "**预算**：", "", "## 执行 Checklist", "- [ ] 场地确认", "- [ ] 物料到位", "- [ ] 嘉宾确认", ""].join("\n");

  // 颜色约定：pending 灰、active 蓝/紫、completed 绿
  const G = "#94a3b8", B = "#3b82f6", P = "#a855f7", GR = "#22c55e";
  const st = (name, color, category) => ({ name, color, category });

  const seeds = [
    // ── 职场 / 管理 ──
    {
      name: "产品经理", category: "职场管理", description: "需求→评审→开发跟进→上线，附 PRD 骨架",
      states: [st("需求", G, "pending"), st("评审", B, "active"), st("开发跟进", P, "active"), st("已上线", GR, "completed")],
      labels: [{ name: "需求", color: B }, { name: "缺陷", color: "#ef4444" }, { name: "优化", color: "#f59e0b" }],
      tasks: [
        { title: "撰写 PRD / 明确目标", category: "pending", description: "用起始的 PRD 文档细化目标、需求点与验收标准" },
        { title: "组织需求评审", category: "pending" },
        { title: "跟进开发 + 联调", category: "active" },
        { title: "上线 + 数据复盘", category: "active" },
      ],
      starter_docs: [{ title: "PRD", content: D_PRD }],
    },
    {
      name: "项目管理", category: "职场管理", description: "待办→进行→阻塞→完成，附项目计划",
      states: [st("待办", G, "pending"), st("进行中", B, "active"), st("阻塞", P, "active"), st("已完成", GR, "completed")],
      labels: [{ name: "里程碑", color: B }, { name: "风险", color: "#ef4444" }, { name: "依赖", color: "#f59e0b" }],
      tasks: [
        { title: "拆解里程碑", category: "pending" },
        { title: "排期 + 分工", category: "pending" },
        { title: "每周同步进度 + 清风险", category: "active" },
      ],
      starter_docs: [{ title: "项目计划", content: D_PLAN }],
    },
    {
      name: "招聘 HR", category: "职场管理", description: "初筛→面试→终面→录用，附岗位 JD 与评估表",
      states: [st("初筛", G, "pending"), st("面试", B, "active"), st("终面", P, "active"), st("已录用", GR, "completed")],
      labels: [{ name: "急招", color: "#ef4444" }, { name: "高级", color: B }, { name: "内推", color: "#f59e0b" }],
      tasks: [
        { title: "明确岗位 JD", category: "pending", description: "用起始的岗位 JD 文档写清职责/要求/评估维度" },
        { title: "简历初筛", category: "pending" },
        { title: "安排面试 + 评估", category: "active" },
      ],
      starter_docs: [{ title: "岗位 JD", content: D_JD }],
    },
    // ── 内容 / 营销 ──
    {
      name: "市场 Campaign", category: "内容营销", description: "策划→制作→投放→复盘，附 Brief",
      states: [st("策划", G, "pending"), st("制作", B, "active"), st("投放", P, "active"), st("复盘", GR, "completed")],
      labels: [{ name: "品牌", color: B }, { name: "增长", color: GR }, { name: "活动", color: "#f59e0b" }],
      tasks: [
        { title: "明确目标 + 受众", category: "pending", description: "用起始的 Campaign Brief 定 KPI/受众/渠道/预算" },
        { title: "制作物料", category: "active" },
        { title: "投放 + 监测数据", category: "active" },
        { title: "复盘 ROI", category: "active" },
      ],
      starter_docs: [{ title: "Campaign Brief", content: D_BRIEF }],
    },
    {
      name: "写作 / 出书", category: "内容营销", description: "大纲→写作→修订→定稿，附写作大纲",
      states: [st("大纲", G, "pending"), st("写作", B, "active"), st("修订", P, "active"), st("定稿", GR, "completed")],
      labels: [{ name: "章节", color: B }, { name: "待查", color: "#ef4444" }, { name: "灵感", color: "#f59e0b" }],
      tasks: [
        { title: "列全书 / 全文大纲", category: "pending" },
        { title: "完成首章初稿", category: "active" },
        { title: "通读修订", category: "active" },
      ],
      starter_docs: [{ title: "写作大纲", content: D_OUTLINE }],
    },
    // ── 个人 / 生活 ──
    {
      name: "GTD 待办", category: "个人生活", description: "收集→本周→进行→完成，附周计划",
      states: [st("收集箱", G, "pending"), st("本周", B, "pending"), st("进行中", P, "active"), st("已完成", GR, "completed")],
      labels: [{ name: "重要", color: "#ef4444" }, { name: "紧急", color: "#f59e0b" }, { name: "等待", color: G }],
      tasks: [
        { title: "清空收集箱", category: "pending" },
        { title: "规划本周三件事", category: "pending" },
      ],
      starter_docs: [{ title: "周计划", content: D_WEEK }],
    },
    {
      name: "学习计划", category: "个人生活", description: "计划→学习→复习→掌握，附错题本",
      states: [st("计划", G, "pending"), st("学习中", B, "active"), st("复习", P, "active"), st("已掌握", GR, "completed")],
      labels: [{ name: "重点", color: B }, { name: "难点", color: "#ef4444" }, { name: "错题", color: "#f59e0b" }],
      tasks: [
        { title: "制定学习计划", category: "pending" },
        { title: "完成第一单元", category: "active" },
        { title: "整理错题 + 复习", category: "active" },
      ],
      starter_docs: [{ title: "学习计划", content: D_STUDY }],
    },
    {
      name: "求职找工作", category: "个人生活", description: "投递→笔试→面试→offer，附公司清单",
      states: [st("投递", G, "pending"), st("笔试", B, "active"), st("面试", P, "active"), st("Offer", GR, "completed")],
      labels: [{ name: "心仪", color: "#ef4444" }, { name: "保底", color: G }, { name: "内推", color: "#f59e0b" }],
      tasks: [
        { title: "更新简历", category: "pending" },
        { title: "整理目标公司清单", category: "pending", description: "用起始文档维护公司/岗位/渠道/状态" },
        { title: "准备面试题 + 复盘", category: "active" },
      ],
      starter_docs: [{ title: "目标公司清单", content: D_JOB }],
    },
    // ── 商业 / 创业 ──
    {
      name: "销售管道", category: "商业创业", description: "线索→跟进→谈判→成交，附跟进记录",
      states: [st("线索", G, "pending"), st("跟进", B, "active"), st("谈判", P, "active"), st("成交", GR, "completed")],
      labels: [{ name: "高意向", color: "#ef4444" }, { name: "大客户", color: B }, { name: "待回访", color: "#f59e0b" }],
      tasks: [
        { title: "整理线索", category: "pending" },
        { title: "首次触达", category: "active" },
        { title: "报价 + 谈判", category: "active" },
      ],
      starter_docs: [{ title: "客户跟进", content: D_CRM }],
    },
    {
      name: "创业 0→1", category: "商业创业", description: "想法→验证→MVP→增长（精益），附精益画布",
      states: [st("想法", G, "pending"), st("验证", B, "active"), st("MVP", P, "active"), st("增长", GR, "completed")],
      labels: [{ name: "假设", color: B }, { name: "用户", color: GR }, { name: "增长", color: "#f59e0b" }],
      tasks: [
        { title: "写下核心假设", category: "pending", description: "用起始的精益画布梳理问题/用户/价值/指标" },
        { title: "访谈 5 个目标用户", category: "active" },
        { title: "做最小 MVP", category: "active" },
        { title: "定北极星指标", category: "active" },
      ],
      starter_docs: [{ title: "精益画布", content: D_LEAN }],
    },
    {
      name: "活动策划", category: "商业创业", description: "策划→筹备→执行→复盘，附策划案与 checklist",
      states: [st("策划", G, "pending"), st("筹备", B, "active"), st("执行", P, "active"), st("复盘", GR, "completed")],
      labels: [{ name: "场地", color: B }, { name: "物料", color: "#f59e0b" }, { name: "嘉宾", color: P }],
      tasks: [
        { title: "确定主题 + 预算", category: "pending" },
        { title: "场地 + 物料筹备", category: "active" },
        { title: "现场执行 checklist", category: "active" },
        { title: "活动复盘", category: "active" },
      ],
      starter_docs: [{ title: "活动策划案", content: D_EVENT }],
    },
  ];

  for (const s of seeds) {
    try {
      const existing = app.findFirstRecordByFilter("board_templates", `owner = "" && name = {:n}`, { n: s.name });
      if (existing) continue; // 同名已存在则跳过（可重入）
    } catch (_) {}
    const rec = new Record(templates);
    rec.set("owner", "");
    rec.set("name", s.name);
    rec.set("description", s.description);
    rec.set("category", s.category);
    rec.set("states", s.states);
    rec.set("labels", s.labels);
    rec.set("tasks", s.tasks);
    rec.set("starter_docs", s.starter_docs);
    app.save(rec);
  }
}, (app) => {
  // 回滚：删除本迁移 seed 的模板 + 移除 category 字段
  const names = ["产品经理", "项目管理", "招聘 HR", "市场 Campaign", "写作 / 出书", "GTD 待办", "学习计划", "求职找工作", "销售管道", "创业 0→1", "活动策划"];
  for (const name of names) {
    try {
      const rec = app.findFirstRecordByFilter("board_templates", `owner = "" && name = {:n}`, { n: name });
      if (rec) app.delete(rec);
    } catch (_) {}
  }
  try {
    const templates = app.findCollectionByNameOrId("board_templates");
    const f = templates.fields.getByName("category");
    if (f) {
      templates.fields.removeById(f.id);
      app.save(templates);
    }
  } catch (_) {}
});
