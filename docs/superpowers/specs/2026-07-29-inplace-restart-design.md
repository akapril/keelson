# 进程原地重启（消除重启后跳位与延迟）设计

> 状态：设计已确认（2026-07-29）。方案 A（后端原地重启）。

## 问题

`handle_restart`（daemon.rs）当前做法：`remove_process(旧id)` → `handle_start(...)`。而 `handle_start` 生成**全新 id** 并 `add_process` push 到进程表 Vec **末尾**。列表按 Vec 顺序无排序渲染，故：
- **顺序改变**：重启后进程换新 id、追加末尾 → 从原位跳到列表最底部。
- **延迟/闪烁**：restart = 先 remove（列表少一项）再 add（末尾冒出），各触发一次 `runtime-processes-changed`，且每次刷新走较重的 `handle_ps`（tasklist + 资源 + 健康 2s）→ 短暂消失后末尾出现、状态迟迟才落定。

根因：restart 不是「原地重启」，而是「删旧建新」。

## 目标（方案 A）

manual restart 改为**原地重启**：同一条目、同一 id、同一 `started_at`、同一 Vec 位置，仅更新 `pid`/`status`/`restart_count`。列表位置不动、无 remove→add 闪烁。

## 设计

**1. 抽出 spawn 核心（daemon.rs）**
从 `handle_start` 抽出「建日志 + 平台化 spawn + forget child + 返回 pid」为纯 spawn 函数：
```
fn spawn_detached(id: &str, command: &str, cwd: &str, env: &HashMap<String,String>) -> Result<u32, String>
```
- 日志文件 `<id>.log` 用 `OpenOptions::create(true).append(true)`（首次=新建；重启=续写，不丢历史；替代原 `File::create` 的截断）。
- Windows：`cmd /C "chcp 65001>nul && <command>"` + `creation_flags(0x00000200)`；unix：`sh -c <command>`。stdout/stderr → 日志；注入 env。
- `handle_start` 改为调用它拿 pid（其余逻辑不变）。

**2. handle_restart 原地化**
```
find entry（by name/id）→ interactive 短路(不变)
kill 旧 pid（taskkill /T /F ; unix kill -TERM）
new_pid = spawn_detached(entry.id, entry.command, entry.cwd, entry.env)?
update_process(entry.id, |e| { e.pid=new_pid; e.status="running"; e.restart_count += 1; e.port.clear(); e.health="unknown"; })
重新起端口检测异步任务（同 handle_start，针对 entry.id + new_pid）
return json（id/name/pid/status）
```
- **不** remove_process、**不**换 id、**不**走 handle_start、**不**新起 watchdog（原 watchdog 若存在则继续，见下）。
- 保留 `started_at`（原地更新不动它）→ 语义「还是同一进程」。
- `port.clear()`：旧端口失效，交给新起的端口检测任务重填。

**3. watchdog 与手动 restart 共存（daemon.rs）**
watchdog 每 2s 按 name 取 entry，当前用**本地旧 `current_pid`** 判活。改为按 **`entry.pid`** 判活：
- 手动原地 restart 更新了 `entry.pid=new_pid` → watchdog 下一 tick 读到新 pid、判活为真 → `continue`，不会因旧 pid 已死而误触发自动重启（消除双重启）。
- watchdog 自身自动重启路径不变（仍更新 entry.pid + 本地 current_pid）。
- 说明：多数手动启动进程 `max_restarts=0`（无 watchdog），此改动仅影响被托管（max_restarts>0）进程被手动重启的边界，属正确性加固。

## 非目标 / 不做

- 不做前端稳定排序（B）：A 后位置本就不动，多余。
- 不做前端乐观「重启中」态（C）：A 后无两段闪烁，YAGNI；若实测仍顿再议。
- 不改 stop/remove/start 的语义。

## 边界 / 风险

- kill 旧 pid 与 spawn 新进程之间有极短空档；条目全程保留（status 仍 running），列表不闪。
- 若 spawn 失败：返回 Err，entry 保持旧 pid/running（旧进程已被 kill → 实际已停）。可在失败时把 status 置 `exited` 更准确 → 失败分支 `update_process(status="exited")`。
- 日志改 append：重启后日志续写而非清空（历史保留），与原「新 id 新空日志」不同但更合理。

## 测试

- spawn/restart 属进程 IO，Windows 本机 `cargo test --lib` 受限（0xc0000139）→ 靠 `cargo check` 编译 + CI + 真机验证。
- 真机验证清单：
  1. 列表里对某进程点重启 → **位置不变**、不跳末尾、不短暂消失；pid 变、restart_count +1、started_at 不变。
  2. 有端口的进程重启后端口重新检测显示。
  3. 重启后日志续写（不清空）。
  4. `max_restarts>0` 的托管进程手动重启 → 不出现双进程/自动再重启。
  5. 非重启操作（start/stop/remove/list）行为不变。

## 变更文件

- `src-tauri/src/runtime/daemon.rs`：抽 `spawn_detached`；`handle_start` 改用它；`handle_restart` 原地化；`watchdog` 判活改用 `entry.pid`。
