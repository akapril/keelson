// 演示数据播种脚本 —— 往一个独立的演示 PocketBase 灌入好看的 mock 数据，供 README 截图。
// 不碰真实 pb_data：只打你传进来的 PB_URL（独立演示实例）。
//
// 用法：
//   node scripts/seed-demo.mjs
// 环境变量（都有默认值）：
//   PB_URL       演示 PB 地址        默认 http://127.0.0.1:8099
//   ADMIN_EMAIL  超级管理员邮箱      默认 admin@demo.local
//   ADMIN_PASS   超级管理员密码      默认 demopass123
//   DEMO_EMAIL   演示用户（登录用）  默认 demo@keelson.app
//   DEMO_PASS    演示用户密码        默认 keelson-demo
//
// 前置：演示 PB 已 serve、已 `pocketbase superuser upsert ADMIN_EMAIL ADMIN_PASS`、迁移已应用。

const PB = process.env.PB_URL || "http://127.0.0.1:8099";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.local";
const ADMIN_PASS = process.env.ADMIN_PASS || "demopass123";
const DEMO_EMAIL = process.env.DEMO_EMAIL || "demo@keelson.app";
const DEMO_PASS = process.env.DEMO_PASS || "keelson-demo";

let TOKEN = "";
const H = () => ({ "Content-Type": "application/json", Authorization: TOKEN });

async function api(method, path, body) {
  const r = await fetch(`${PB}${path}`, {
    method,
    headers: H(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${method} ${path} → ${r.status}: ${t}`);
  }
  return r.json();
}
const create = (coll, data) => api("POST", `/api/collections/${coll}/records`, data);

// 相对今天的日期（PB 接受 ISO）；pass 天数偏移
function day(offset = 0, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString().replace("T", " ").replace("Z", "Z");
}

async function main() {
  // 1) 超管登录
  const auth = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: ADMIN_EMAIL, password: ADMIN_PASS }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error("超管登录失败：" + JSON.stringify(auth));
  TOKEN = auth.token;
  console.log("✓ 超管已登录");

  // 2) 演示用户（app 用它登录看演示数据）
  let user;
  try {
    user = await create("users", {
      email: DEMO_EMAIL,
      password: DEMO_PASS,
      passwordConfirm: DEMO_PASS,
      displayName: "Demo User",
      verified: true,
    });
  } catch (e) {
    // 已存在则查出来
    user = await api("GET", `/api/collections/users/records?filter=${encodeURIComponent(`email="${DEMO_EMAIL}"`)}`).then((r) => r.items[0]);
    if (!user) throw e;
  }
  const owner = user.id;
  console.log(`✓ 演示用户 ${DEMO_EMAIL} (id=${owner})`);

  // 3) 项目 + 状态列 + 标签 + 任务
  const projects = [
    { name: "Keelson 核心", description: "本地优先 AI 工作台的主开发项目", repo_path: "/Users/demo/dev/keelson" },
    { name: "个人知识库", description: "阅读、记忆、灵感的沉淀", repo_path: "/Users/demo/notes" },
  ];
  // 注：PocketBase 的「必填 number 字段」会把 0 当空值→校验失败，故 sort_order 从 1 起。
  const stateDefs = [
    { name: "待办", color: "#94a3b8", category: "pending", sort_order: 1 },
    { name: "进行中", color: "#3b82f6", category: "active", sort_order: 2 },
    { name: "已完成", color: "#22c55e", category: "completed", sort_order: 3 },
  ];
  const labelDefs = [
    { name: "feature", color: "#8b5cf6" },
    { name: "bug", color: "#ef4444" },
    { name: "docs", color: "#0ea5e9" },
  ];
  const taskDefs = [
    ["多机同步引擎", "离线优先 LWW，hub-spoke 拓扑", "high", 1],
    ["阅读列表虚拟化", "条目多也不卡", "medium", 2],
    ["软删除地基", "deleted_at tombstone + 级联", "high", 0],
    ["命令面板打磨", "⌘K 全局跳转", "low", 2],
    ["文档内嵌 KaTeX", "公式渲染", "medium", 1],
  ];

  for (const p of projects) {
    const proj = await create("board_projects", { owner, ...p });
    const states = [];
    for (const s of stateDefs) states.push(await create("board_project_states", { project: proj.id, ...s }));
    for (const l of labelDefs) await create("board_project_labels", { project: proj.id, ...l });
    // 每个项目挑几条任务分散到各列
    let i = 0;
    for (const [title, desc, priority, stateIdx] of taskDefs) {
      if (i++ % 2 === 0 && p !== projects[0]) continue; // 第二个项目少放点
      await create("board_tasks", {
        project: proj.id,
        state: states[stateIdx].id,
        title,
        description: desc,
        priority,
        rank: i * 1000,
        created_by: owner,
        due_date: stateIdx === 2 ? "" : day(3 + i, 10),
      });
    }
    console.log(`✓ 项目「${p.name}」+ 状态/标签/任务`);
  }

  // 4) 文档
  const anyProject = await api("GET", "/api/collections/board_projects/records?perPage=1").then((r) => r.items[0]);
  const docs = [
    ["架构设计：多机同步", "# 多机同步\n\n**前端永远连本地 PB**，后台 Rust worker 对账 本地↔hub。\n\n- LWW（按 updated）\n- 软删除 tombstone\n- 关系顺序：项目→状态→任务"],
    ["会议纪要 2026-08", "## 决策\n\n1. 会话中枢降级为入料漏斗\n2. 项目为 home\n\n## 待办\n\n- [ ] 侧栏重排\n- [x] 项目收藏"],
    ["阅读笔记：本地优先应用", "> 数据留在本机，AI 检索倾向本地 embedding。\n\n关键点：隐私边界 = 服务端 access-rules。"],
  ];
  for (const [title, content] of docs) await create("docs", { owner, projects: [anyProject.id], title, content });
  console.log(`✓ ${docs.length} 篇文档`);

  // 5) 阅读条目
  const reading = [
    ["Local-first software", "https://www.inkandswitch.com/local-first/", "reading", "本地优先,CRDT", "**TL;DR** 本地优先七大理想：随时可用、多设备、协作、离线、长存、隐私、用户掌控。"],
    ["Tauri v2 Distribute Docs", "https://v2.tauri.app/distribute/", "unread", "tauri,发布", ""],
    ["PocketBase 单文件后端", "https://pocketbase.io/", "archived", "backend,sqlite", "**一句话** 单二进制的实时后端，SQLite + 规则授权，适合本地优先桌面应用。"],
  ];
  for (const [title, url, status, tags, summary] of reading) await create("reading_items", { owner, title, url, status, tags, summary, note: "" });
  console.log(`✓ ${reading.length} 条阅读`);

  // 6) 日历事件
  const events = [
    ["同步引擎 P2 启动", "worker 核心", day(1, 10), day(1, 11), "#3b82f6"],
    ["版本 v0.3 发布", "打 tag 触发四平台构建", day(5, 15), day(5, 16), "#22c55e"],
    ["读书：本地优先", "", day(2, 20), day(2, 21), "#8b5cf6"],
  ];
  for (const [title, description, start, end, color] of events)
    await create("calendar_events", { owner, title, description, start, end, color, all_day: false });
  console.log(`✓ ${events.length} 个日历事件`);

  // 7) 指令库
  const prompts = [
    ["代码审查", "审查以下 {{语言}} 代码的正确性/安全/性能，按严重程度分级：\n\n{{代码}}", "dev,review", "snippet"],
    ["周报生成", "把这些提交和完成的任务汇总成一份中文周报：\n\n{{内容}}", "report", "report"],
  ];
  for (const [title, content, tags, type] of prompts) await create("prompts", { owner, title, content, tags, type });
  console.log(`✓ ${prompts.length} 条指令`);

  // 8) 记忆账本
  const memories = [
    ["用户偏好中文注释与 KISS/YAGNI", "preference", "global"],
    ["项目为 home，会话中枢是一次性入料漏斗", "decision", "global"],
    ["store 写失败必须重抛 + toast，勿吞错", "convention", "global"],
  ];
  for (const [content, kind, scope] of memories) await create("memories", { owner, content, kind, scope, status: "accepted" });
  console.log(`✓ ${memories.length} 条记忆`);

  console.log("\n✅ 演示数据播种完成。app 设置远程 PB = " + PB + " 后，用 " + DEMO_EMAIL + " / " + DEMO_PASS + " 登录即可看到。");
}

main().catch((e) => {
  console.error("✗ 播种失败：", e.message);
  process.exit(1);
});
