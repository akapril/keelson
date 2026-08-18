// 指令库技能类型：给 prompts.type select 增加 "skill" 值，并把已被 agent 绑定的指令回填为 skill。
// skill=作为 agent 系统提示注入的可复用能力（区别于 snippet 插入片段 / report 报告模板）。
// 回填：遍历 agent_profiles，凡出现在 skill_prompts(关联字段=id 数组)里的 prompt 一律转 type=skill，
// 保留现有绑定不断、旧绑定自然升为一等技能。幂等：已是 skill 或 values 已含 skill 则跳过。
migrate((app) => {
  // 1) select 值加 skill
  const c = app.findCollectionByNameOrId("prompts");
  const f = c.fields.getByName("type");
  if (f && Array.isArray(f.values) && !f.values.includes("skill")) {
    f.values = ["snippet", "report", "skill"];
    app.save(c);
  }
  // 2) 回填：被任意 agent 绑定过的 prompt → skill
  try {
    const ids = new Set();
    const agents = app.findAllRecords("agent_profiles");
    for (const a of agents) {
      // 归一取关联字段的 id 数组：不同 PB 版本 get() 可能返回数组 / JSON 串，
      // 优先 getStringSlice（多值字段专用，稳返 []string），再兜底 get() 的数组/JSON 串。
      let bound = [];
      try {
        bound = a.getStringSlice("skill_prompts");
      } catch (_) {
        /* 老版本无 getStringSlice */
      }
      if (!Array.isArray(bound) || bound.length === 0) {
        const raw = a.get("skill_prompts");
        if (Array.isArray(raw)) {
          bound = raw;
        } else if (typeof raw === "string" && raw.trim()) {
          try {
            const parsed = JSON.parse(raw);
            bound = Array.isArray(parsed) ? parsed : [raw];
          } catch (_) {
            bound = [raw]; // 单 id 串
          }
        }
      }
      for (const id of bound) {
        if (id) ids.add(id);
      }
    }
    for (const id of ids) {
      try {
        const p = app.findRecordById("prompts", id);
        if (p && p.getString("type") !== "skill") {
          p.set("type", "skill");
          app.save(p);
        }
      } catch (_) {
        // 单条找不到/存已删——跳过
      }
    }
  } catch (_) {
    // agent_profiles 不存在或查询失败——回填留待用户手动改类型，不阻断迁移
  }
}, (app) => {
  // down：仅还原 select 值（不强制把已转 skill 的记录退回，遵循现有迁移 down 克制风格）
  try {
    const c = app.findCollectionByNameOrId("prompts");
    const f = c.fields.getByName("type");
    if (f && Array.isArray(f.values)) {
      f.values = ["snippet", "report"];
      app.save(c);
    }
  } catch (_) {}
});
