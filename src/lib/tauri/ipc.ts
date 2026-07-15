import { invoke } from "@tauri-apps/api/core";
// 唯一允许出现 invoke 字符串命令名的地方。新增本地能力只加一个方法。
export const ipc = {
  ping: () => invoke<string>("ping"),
  // Task 16 起补充：scanSessions / searchSessions / restoreSessions / getEcosystem ...
};
