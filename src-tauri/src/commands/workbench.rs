// commands/workbench.rs — 工作台相关命令（Task 16 MVP 存根）
//
// 会话元数据（收藏、备注等）由前端经 PocketBase 直接写入（lib/pb/collections.ts），
// Rust 侧无需维护冗余的写入命令。
//
// 若未来需要 Rust 侧读取工作台数据（如批量导出），可在此处扩展。
