// 了解更多 Tauri 命令：https://tauri.app/develop/calling-rust/

// 核心数据模型：Session、TimelineMessage、SessionMeta
pub mod models;
// 应用路径管理：AppPaths（替代 retalk 硬编码的 ~/.claude/retalk/）
pub mod paths;
// PocketBase 集成层（进程、客户端、首启初始化）
mod pb;
// 命令模块（Task 16 实现具体命令，当前为占位）
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

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::Manager;

/// 全局应用状态：持有首启认证结果。
#[derive(Default)]
pub struct AppState {
    pub auth: Arc<Mutex<Option<pb::bootstrap::BootstrapAuth>>>,
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
    // 先尝试 Resource 路径（打包后）
    if let Ok(p) = app
        .path()
        .resolve("pb_migrations", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return p;
        }
    }
    // 开发环境回退：CARGO_MANIFEST_DIR/pb_migrations
    let fallback = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("pb_migrations");
    fallback
}

/// 应用入口：注册插件与命令处理器，启动 PocketBase 并执行 bootstrap。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let state: tauri::State<AppState> = app.state();
            let auth_slot = state.auth.clone();

            // 确定 PB 数据目录和迁移文件目录
            let data_dir = app.path().app_data_dir()?.join("pb_data");
            let mig_dir = resolve_migrations_dir(&handle);
            std::fs::create_dir_all(&data_dir)?;

            // 在后台 tokio 任务中完成 PB 启动 + bootstrap
            tauri::async_runtime::spawn(async move {
                if let Err(e) = setup_pocketbase(handle, data_dir, mig_dir, auth_slot).await {
                    // 仅记录错误，不 panic（UI 层通过 get_bootstrap_auth 的 Err 感知）
                    eprintln!("[rework] PocketBase 初始化失败: {e:#}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_bootstrap_auth, commands::ping])
        .run(tauri::generate_context!())
        .expect("运行 rework 失败");
}

/// 完整的 PocketBase 初始化流程：
/// 1. 统一从 keychain 获取 superuser 密码和本地用户密码（仅一次调用，后续共用）
/// 2. 通过 CLI `superuser upsert` 幂等地创建 superuser（迁移也在此时运行）
/// 3. 启动 `serve`
/// 4. 等待健康检查通过
/// 5. 执行 `bootstrap`（确保 local-user，返回 token；传入已获取密码，无第二次 keychain 调用）
async fn setup_pocketbase(
    handle: tauri::AppHandle,
    data_dir: std::path::PathBuf,
    mig_dir: std::path::PathBuf,
    auth_slot: Arc<Mutex<Option<pb::bootstrap::BootstrapAuth>>>,
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
    let _child = pb::process::spawn_pocketbase(&handle, &data_dir, &mig_dir, port)?;

    // 步骤 4：等待 PB 就绪
    pb::process::wait_healthy(&base, 15_000).await?;

    // 步骤 5：bootstrap — 确保 local-user，缓存 token（传入已获取的密码，避免再次访问 keychain）
    let auth = pb::bootstrap::bootstrap(&base, &super_pw, &user_pw).await?;
    *auth_slot.lock() = Some(auth);

    // TODO(Task 15)：挂载会话扫描→PB 同步任务
    Ok(())
}
