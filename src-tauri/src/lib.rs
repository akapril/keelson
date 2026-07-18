// 了解更多 Tauri 命令：https://tauri.app/develop/calling-rust/

// 核心数据模型：Session、TimelineMessage、SessionMeta
pub mod models;
// 应用路径管理：AppPaths（替代 retalk 硬编码的 ~/.claude/retalk/）
pub mod paths;
// 应用配置：AppConfig（hotkey + terminal_pref，持久化到 config.toml）
pub mod config;
// PocketBase 集成层（进程、客户端、首启初始化）
mod pb;
// 命令模块（Task 16 按领域分域实现）
mod commands;
// provider 抽象层：SessionProvider trait + ProviderRegistry（Task 9）
pub mod providers;
// 注册表驱动的全量/增量扫描器（Task 12）
pub mod scanner;
// 注册表驱动的文件系统 Watcher + 三策略更新管理器（Task 12）
pub mod updater;
// Tantivy 全文索引管理器（Task 13）
pub mod indexer;
// 会话搜索后端：SessionHit + session_backend（Task 13）
pub mod search;
// 终端启动模块：TerminalKind 检测、LaunchPlan 纯函数构建、execute spawn（Task 14）
pub mod terminal;
// 会话元数据同步到 PocketBase（Task 15）
pub mod sync;
// 扫描缓存 + 增量更新（⑥ 启动秒加载）
pub mod scan_cache;
// 跨会话语义检索：分块纯逻辑、向量存储、嵌入（Task 1）
pub mod rag;
// 应用内 MCP server
mod mcp;

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 注册 Spotlight 全局快捷键的可复用辅助函数。
///
/// 先注销所有已注册的旧快捷键，再注册新的快捷键。
/// 快捷键触发时切换 spotlight 窗口的显示/隐藏状态（toggle 行为）。
///
/// # 参数
/// - `app`    — Tauri AppHandle，用于访问插件和窗口
/// - `hotkey` — 快捷键字符串，如 "CommandOrControl+Shift+Space"
///
/// # 错误
/// 注册失败时返回错误信息字符串（非致命，调用方可记录日志后继续）。
pub fn register_spotlight_hotkey(app: &tauri::AppHandle, hotkey: &str) -> Result<(), String> {
    // 先注销所有已注册快捷键（清除旧绑定）
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("注销旧快捷键失败: {e:#}"))?;

    // 注册新快捷键（克隆 handle 供回调持有）
    let handle_for_cb = app.clone();
    app.global_shortcut()
        .on_shortcut(hotkey, move |_app, _shortcut, event| {
            // 仅响应 Pressed 事件，避免重复触发
            if event.state() != ShortcutState::Pressed {
                return;
            }
            // 获取 spotlight 窗口并切换可见性
            if let Some(win) = handle_for_cb.get_webview_window("spotlight") {
                let is_visible = win.is_visible().unwrap_or(false);
                if is_visible {
                    // 已可见 → 隐藏（toggle）
                    let _ = win.hide();
                } else {
                    // 不可见 → 显示并设置焦点
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .map_err(|e| format!("注册快捷键 '{hotkey}' 失败: {e:#}"))?;

    Ok(())
}

/// 全局应用状态。
///
/// Task 16 扩展：在 Task 15 的 `auth + sessions` 基础上增加：
/// - `reg`   — ProviderRegistry（路由 provider 命令，无需 Mutex：构建后只读）
/// - `index` — Option<SessionIndex>（Tantivy 索引，启动后填充）
/// - `paths` — AppPaths（目录路径集合，构建后只读）
/// - `config` — AppConfig（hotkey + terminal_pref，需写入故包一层 Mutex）
pub struct AppState {
    /// PocketBase bootstrap 认证结果（base_url / token / user_id）
    pub auth: Arc<Mutex<Option<pb::bootstrap::BootstrapAuth>>>,
    /// 最近一次全量扫描的会话列表缓存（Task 16 命令层读取用）
    pub sessions: Arc<Mutex<Vec<crate::models::Session>>>,
    /// Provider 注册表（claude + codex；启动后只读，无需 Mutex）
    pub reg: providers::ProviderRegistry,
    /// Tantivy 会话全文索引（启动时构建，搜索命令只读访问）
    pub index: Arc<Mutex<Option<indexer::SessionIndex>>>,
    /// 应用路径集合（home / app_data 等）
    pub paths: paths::AppPaths,
    /// 应用配置（hotkey + terminal_pref，可被命令写入）
    pub config: Arc<Mutex<config::AppConfig>>,
    /// PocketBase sidecar 子进程句柄；应用退出时回收，避免遗留孤儿进程锁 .exe / 抢数据目录
    pub pb_child: Arc<Mutex<Option<CommandChild>>>,
    /// AI 流式对话的取消标志表（stream_id → 取消位），供「停止生成」使用
    pub ai_cancels:
        Arc<Mutex<std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        let paths = paths::AppPaths::detect();
        let config_path = paths.app_data.join("config.toml");
        let cfg = config::AppConfig::load(&config_path);
        Self {
            auth: Arc::new(Mutex::new(None)),
            sessions: Arc::new(Mutex::new(Vec::new())),
            reg: providers::ProviderRegistry::new(),
            index: Arc::new(Mutex::new(None)),
            paths,
            config: Arc::new(Mutex::new(cfg)),
            pb_child: Arc::new(Mutex::new(None)),
            ai_cancels: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }
}

/// IPC 命令：返回 bootstrap 认证信息（baseUrl / token / userId）。
/// 前端在 PB 初始化完成后调用，获取访问凭据。
#[tauri::command]
fn get_bootstrap_auth(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    let g = state.auth.lock();
    let a = g.as_ref().ok_or("尚未初始化")?;
    Ok(serde_json::json!({
        "baseUrl": a.base_url,
        "token":   a.token,
        "userId":  a.user_id,
    }))
}

/// 解析 pb_migrations 目录：
/// - 生产环境：从 Tauri Resource 目录解析
/// - 开发环境：回退到 Cargo manifest 所在目录下的 pb_migrations
fn resolve_migrations_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pb_migrations");
    // 开发环境：始终用源码目录。Resource 副本（target/debug/pb_migrations）是上次构建时
    // 复制的，纯前端 / 迁移文件改动不触发重建 → 副本会漏掉新迁移，导致新集合缺失（404）。
    if cfg!(debug_assertions) {
        return source;
    }
    // 生产环境：从打包的 Resource 目录解析
    if let Ok(p) = app
        .path()
        .resolve("pb_migrations", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return p;
        }
    }
    source
}

/// 应用入口：注册插件与命令处理器，启动 PocketBase 并执行 bootstrap。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// 显示并聚焦主窗口（从托盘唤起用）。
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 创建系统托盘：图标 + 菜单（显示 / 退出）+ 左键点击唤起主窗口。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "tray_show", "显示 rework", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("rework")
        .menu(&menu)
        // 左键点击唤起窗口，不弹菜单；菜单走右键
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => show_main(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    // 复用打包的窗口图标作为托盘图标
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<AppState> = app.state();
            let auth_slot = state.auth.clone();
            let sessions_slot = state.sessions.clone();
            let index_slot = state.index.clone();
            let pb_child_slot = state.pb_child.clone();

            // ── Spotlight 全局快捷键注册 ───────────────────────────────
            // 从配置中读取 hotkey 字符串，通过可复用的辅助函数注册全局快捷键
            // Task 21：已重构为 register_spotlight_hotkey，供启动和 config_set_hotkey 命令共用
            let hotkey_str = {
                let cfg = state.config.lock();
                cfg.hotkey.clone()
            };
            if let Err(e) = register_spotlight_hotkey(app.handle(), &hotkey_str) {
                eprintln!("[rework] 全局快捷键注册失败（非致命）: {e:#}");
            }

            // ── 系统托盘（常驻）───────────────────────────────────────
            if let Err(e) = setup_tray(app.handle()) {
                eprintln!("[rework] 托盘初始化失败（非致命）: {e:#}");
            }

            // 确定 PB 数据目录和迁移文件目录
            let data_dir = app.path().app_data_dir()?.join("pb_data");
            let mig_dir = resolve_migrations_dir(&handle);
            std::fs::create_dir_all(&data_dir)?;

            // 在后台 tokio 任务中完成 PB 启动 + bootstrap + 会话同步
            tauri::async_runtime::spawn(async move {
                if let Err(e) = setup_pocketbase(handle, data_dir, mig_dir, auth_slot, sessions_slot, index_slot, pb_child_slot).await {
                    // 仅记录错误，不 panic（UI 层通过 get_bootstrap_auth 的 Err 感知）
                    eprintln!("[rework] PocketBase 初始化失败: {e:#}");
                }
            });
            Ok(())
        })
        // ── Spotlight 失焦自动隐藏 ────────────────────────────────────
        // 当 spotlight 窗口失去焦点时（WindowEvent::Focused(false)）自动隐藏
        .on_window_event(|window, event| {
            if window.label() == "spotlight" {
                if let tauri::WindowEvent::Focused(false) = event {
                    // 失去焦点 → 隐藏 spotlight 窗口
                    let _ = window.hide();
                }
            } else if window.label() == "main" {
                // 关闭主窗口 → 隐藏到托盘而非退出（常驻）；真正退出走托盘「退出」菜单
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        // ───── 命令注册（按领域分组） ─────
        // 注意：generate_handler! 宏要求使用函数定义所在的完整路径，
        // 不能使用 re-export 路径（宏展开需要原始路径上的辅助符号）。
        .invoke_handler(tauri::generate_handler![
            // 基础命令
            get_bootstrap_auth,
            commands::ping,
            // 会话相关（Task 16 - sessions.rs）
            commands::sessions::sessions_list,
            commands::sessions::sessions_search,
            commands::sessions::sessions_timeline,
            commands::sessions::sessions_project_paths,
            commands::sessions::session_commits,
            // 终端（Task 16 - terminal.rs）
            commands::terminal::terminal_resume,
            // 配置（Task 16 - config.rs）
            commands::config::config_get_hotkey,
            commands::config::config_set_hotkey,
            // git 状态 + 提交日志（Board - git.rs）
            commands::git::git_info,
            commands::git::git_log,
            // AI 对话（ai.rs，provider 可切）
            commands::ai::ai_chat,
            commands::ai::ai_chat_stream,
            commands::ai::ai_cancel_stream,
            commands::ai::ai_chat_tools,
            commands::ai::list_models,
            // RAG 语义检索（rag_build_index / rag_search）
            commands::rag::rag_build_index,
            commands::rag::rag_search,
            // MCP 一键接入 claude / codex
            commands::mcp::mcp_endpoint,
            commands::mcp::mcp_install_claude,
            commands::mcp::mcp_install_codex,
            // 文件写入（导出「另存为」）
            commands::fs::write_text_file,
            // 在系统文件管理器打开路径（会话中枢 / 项目工作台「打开位置」）
            commands::fs::open_path,
            // 返回 PocketBase 数据目录路径（设置页「打开数据目录」）
            commands::fs::pb_data_dir,
            // 网页抓取（阅读「AI 解析」）
            commands::web::fetch_url_text,
        ])
        .build(tauri::generate_context!())
        .expect("构建 rework 失败")
        .run(|app_handle, event| {
            // 应用退出：回收 PocketBase sidecar，避免遗留进程锁住 .exe / 抢占数据目录
            if let tauri::RunEvent::Exit = event {
                let state: tauri::State<AppState> = app_handle.state();
                // 先取出句柄再释放锁：避免 MutexGuard 临时借用跨越 state 生命周期
                let child = state.pb_child.lock().take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        });
}

/// 完整的 PocketBase 初始化流程：
/// 1. 统一从 keychain 获取 superuser 密码和本地用户密码（仅一次调用，后续共用）
/// 2. 通过 CLI `superuser upsert` 幂等地创建 superuser（迁移也在此时运行）
/// 3. 启动 `serve`
/// 4. 等待健康检查通过
/// 5. 执行 `bootstrap`（确保 local-user，返回 token；传入已获取密码，无第二次 keychain 调用）
/// 6. 全量扫描会话，重建 Tantivy 索引（存入 AppState），同步到 PB sessions_meta（Task 15）
/// 7. 启动文件系统 Watcher，增量同步变化会话（Task 15）
async fn setup_pocketbase(
    handle: tauri::AppHandle,
    data_dir: std::path::PathBuf,
    mig_dir: std::path::PathBuf,
    auth_slot: Arc<Mutex<Option<pb::bootstrap::BootstrapAuth>>>,
    sessions_slot: Arc<Mutex<Vec<crate::models::Session>>>,
    index_slot: Arc<Mutex<Option<indexer::SessionIndex>>>,
    pb_child_slot: Arc<Mutex<Option<CommandChild>>>,
) -> anyhow::Result<()> {
    let port = pb::process::pick_free_port();
    let base = format!("http://127.0.0.1:{port}");

    // 步骤 0：统一获取密码（keychain 仅调用一次），后续所有步骤共用同一份密码
    let (super_pw, user_pw) = pb::bootstrap::get_passwords();

    // 步骤 1+2：superuser upsert（同时触发 JS 迁移 automigrate）
    pb::process::create_superuser_via_sidecar(
        &handle,
        &data_dir,
        &mig_dir,
        "local@app.internal",
        &super_pw,
    )
    .await?;

    // 步骤 3：启动 serve
    // 存入 AppState 供退出时回收（不再立即 drop 而遗留孤儿进程）
    *pb_child_slot.lock() = Some(pb::process::spawn_pocketbase(&handle, &data_dir, &mig_dir, port)?);

    // 步骤 4：等待 PB 就绪
    pb::process::wait_healthy(&base, 15_000).await?;

    // 步骤 5：bootstrap — 确保 local-user，缓存 token（传入已获取的密码，避免再次访问 keychain）
    // bootstrap 幂等，对瞬时连接中断（如 os error 10053）做有限重试，避免单次抖动导致整个初始化失败。
    let auth = {
        let mut attempt = 0u32;
        loop {
            match pb::bootstrap::bootstrap(&base, &super_pw, &user_pw).await {
                Ok(a) => break a,
                Err(e) if attempt < 4 => {
                    attempt += 1;
                    eprintln!("[rework] bootstrap 第 {attempt} 次失败，{}ms 后重试: {e:#}", 500 * attempt);
                    tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                }
                Err(e) => return Err(e),
            }
        }
    };
    let user_id = auth.user_id.clone();
    let pb_client = pb::client::PbClient::new(&auth.base_url, &auth.token);
    *auth_slot.lock() = Some(auth);

    // 启动应用内 MCP server（auth 已就绪；失败不阻断应用启动，仅打日志）。
    {
        let mcp_handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            match crate::mcp::server::start(mcp_handle).await {
                Ok(ep) => println!("[mcp] MCP server 就绪：{}", ep.url),
                Err(e) => eprintln!("[mcp] MCP server 启动失败：{e}"),
            }
        });
    }

    // 步骤 6：扫描会话（缓存秒加载 + 增量）+ 重建 Tantivy 索引 + 同步到 PB
    let reg = Arc::new(providers::ProviderRegistry::new());
    let cache_path = data_dir.join("scan_cache.json");
    // 有缓存则增量（只重解析 mtime 变化的文件）；无缓存 / 遇结构性变化则全量
    let sessions = match scan_cache::load(&cache_path) {
        Some(cached) => {
            let cached_count = cached.sessions.len();
            match scan_cache::incremental(&reg, cached) {
                Some(s) => {
                    eprintln!("[rework] 缓存加载 {cached_count} 条 → 增量后 {} 条", s.len());
                    s
                }
                None => {
                    eprintln!("[rework] 结构性变化，退回全量扫描");
                    scanner::scan_all(&reg)
                }
            }
        }
        None => {
            let s = scanner::scan_all(&reg);
            eprintln!("[rework] 无缓存，全量扫描完成：{} 条会话", s.len());
            s
        }
    };
    // 写回缓存供下次启动秒加载
    if let Err(e) = scan_cache::save(&cache_path, &sessions) {
        eprintln!("[rework] 扫描缓存写入失败（非致命）: {e:#}");
    }

    // 重建 Tantivy 全文索引，并将 SessionIndex 存入 AppState.index 供搜索命令使用
    let index_dir = data_dir.join("tantivy_index");
    match indexer::SessionIndex::new(&index_dir) {
        Ok(idx) => {
            if let Err(e) = idx.rebuild(&sessions) {
                eprintln!("[rework] Tantivy rebuild 失败（非致命）: {e:#}");
            }
            // 存入 AppState，供 sessions_search 命令访问
            *index_slot.lock() = Some(idx);
        }
        Err(e) => eprintln!("[rework] SessionIndex::new 失败（非致命）: {e:#}"),
    }

    // 同步到 PocketBase sessions_meta
    if let Err(e) = sync::sync_to_pb(&pb_client, &user_id, &sessions).await {
        eprintln!("[rework] 首次 sync_to_pb 失败（非致命）: {e:#}");
    }

    // 缓存会话供 Task 16 命令层使用
    *sessions_slot.lock() = sessions;
    // 通知前端：会话缓存已就绪（前端首帧可能抢在扫描完成前取到空列表 → 需刷新）
    let _ = handle.emit("sessions-updated", ());

    // 步骤 7：启动文件系统 Watcher（增量同步）
    // 克隆依赖项供回调闭包持有
    let pb_client_for_watcher = pb_client.clone();
    let user_id_for_watcher = user_id.clone();
    let reg_for_watcher = Arc::clone(&reg);
    let sessions_slot_for_watcher = Arc::clone(&sessions_slot);
    let handle_for_watcher = handle.clone();

    // 构造回调：full_rescan=true 时重新 scan_all；false 时仅同步增量变化的会话
    let watcher_cb: updater::SessionChangedCallback = Arc::new(move |changed_sessions: Vec<crate::models::Session>, full_rescan: bool| {
        let client = pb_client_for_watcher.clone();
        let owner = user_id_for_watcher.clone();
        let reg = Arc::clone(&reg_for_watcher);
        let slot = Arc::clone(&sessions_slot_for_watcher);
        let h = handle_for_watcher.clone();

        // 在 Tauri 的异步运行时执行同步任务（回调本身是同步的，故 spawn）
        tauri::async_runtime::spawn(async move {
            // 决定本次要同步的会话列表
            let to_sync: Vec<crate::models::Session> = if full_rescan {
                // full_rescan=true：scan_single 返回 None，需全量重扫
                let fresh = scanner::scan_all(&reg);
                *slot.lock() = fresh.clone();
                fresh
            } else {
                // 增量：更新缓存中对应的会话后同步
                {
                    let mut cache = slot.lock();
                    for s in &changed_sessions {
                        // 替换缓存中同 session_id 的旧记录
                        if let Some(pos) = cache.iter().position(|c| c.session_id == s.session_id) {
                            cache[pos] = s.clone();
                        } else {
                            cache.push(s.clone());
                        }
                    }
                }
                changed_sessions
            };

            if let Err(e) = sync::sync_to_pb(&client, &owner, &to_sync).await {
                eprintln!("[rework] Watcher 触发的 sync_to_pb 失败（非致命）: {e:#}");
            }
            // 通知前端会话有更新（文件变化增量同步后）
            let _ = h.emit("sessions-updated", ());
        });
    });

    // 启动 Watcher（_watcher 持有 handle，drop 时停止监听；通过 leak 使其存活到进程退出）
    match updater::Watcher::start(Arc::clone(&reg), watcher_cb) {
        Ok(watcher) => {
            // 通过 Box::leak 使 watcher 存活到进程退出（与 Tauri 生命周期对齐）
            Box::leak(Box::new(watcher));
        }
        Err(e) => eprintln!("[rework] Watcher 启动失败（非致命）: {e:#}"),
    }

    Ok(())
}
