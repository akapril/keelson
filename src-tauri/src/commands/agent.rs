//! agent 任务执行相关 Tauri 命令：派发 / 合并 / 打回 / 列运行记录。
use crate::pb::client::PbClient;
use crate::AppState;
use serde::Serialize;
use serde_json::json;
use std::path::Path;
use tauri::State;

/// run 日志流事件（与 AiStreamEvent 同构：delta/done/error）。
#[derive(Clone, Serialize)]
pub struct AgentRunEvent {
    pub kind: String,
    pub text: Option<String>,
    pub run_id: Option<String>,
}

/// 从 AppState 读取 bootstrap auth，返回 (PbClient, owner_id)。
/// 作用域内克隆三个 String，避免持锁跨 await。
fn make_client(state: &State<'_, AppState>) -> Result<(PbClient, String), String> {
    let (base_url, token, owner_id) = {
        let g = state.auth.lock();
        let a = g.as_ref().ok_or("尚未初始化")?;
        (a.base_url.clone(), a.token.clone(), a.user_id.clone())
    };
    Ok((PbClient::new(&base_url, &token), owner_id))
}

/// 派 agent 执行某任务：流式回日志；完成时 run 已落 review/blocked。
/// on_event 为 Tauri Channel，前端监听实时日志与最终 run_id。
#[tauri::command]
pub async fn agent_run_task(
    task_id: String,
    provider: String,
    on_event: tauri::ipc::Channel<AgentRunEvent>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (client, uid) = make_client(&state)?;
    // 克隆 Channel 供闭包内发送 delta 事件（Channel 实现了 Clone）
    let ev = on_event.clone();
    let run_id = crate::agent::executor::execute_task_with_agent(
        &client,
        &uid,
        &task_id,
        &provider,
        move |piece| {
            // 忽略发送失败（前端可能已关闭监听）
            let _ = ev.send(AgentRunEvent {
                kind: "delta".into(),
                text: Some(piece),
                run_id: None,
            });
        },
    )
    .await?;
    // 发送 done 事件，携带最终 run_id 供前端刷新状态
    let _ = on_event.send(AgentRunEvent {
        kind: "done".into(),
        text: None,
        run_id: Some(run_id.clone()),
    });
    Ok(run_id)
}

/// 合并某 run 的 agent 分支到主分支（人工触发；成功后 run.status = merged）。
#[tauri::command]
pub async fn agent_merge_run(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (client, _) = make_client(&state)?;
    // executor_get_run 返回 (task_id, repo_path, base_branch)，base_branch 为建时持久化的值
    let (task_id, repo, base_branch) =
        crate::agent::executor::executor_get_run(&client, &run_id).await?;
    // base_branch 不能为空（旧记录兼容检查）
    if base_branch.trim().is_empty() {
        return Err("agent_run 缺少 base_branch，无法安全合并（请重新派发 agent）".into());
    }
    // 合并 worktree 分支到持久化的 base 分支，合并后切回用户原分支
    crate::agent::worktree::merge_branch(Path::new(&repo), &task_id, &base_branch)
        .map_err(|e| e.to_string())?;
    // 更新 run 状态为 merged
    client
        .patch("agent_runs", &run_id, &json!({ "status": "merged" }))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 打回某 run：清理 worktree / 分支，run.status = discarded。
#[tauri::command]
pub async fn agent_discard_run(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (client, _) = make_client(&state)?;
    // 忽略第三个返回值 base_branch（discard 不需要合并，无需 base 分支信息）
    let (task_id, repo, _base) =
        crate::agent::executor::executor_get_run(&client, &run_id).await?;
    // 清理 worktree（失败不中断，继续将状态置为 discarded）
    let _ = crate::agent::worktree::remove_worktree(Path::new(&repo), &task_id);
    // 更新 run 状态为 discarded
    client
        .patch("agent_runs", &run_id, &json!({ "status": "discarded" }))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 列某任务的运行记录（仅未软删除的，最新在前）。
#[tauri::command]
pub async fn list_agent_runs(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let (client, _) = make_client(&state)?;
    // 过滤软删除；转义 task_id 防注入
    let filter = format!(
        "deleted_at = \"\" && task = \"{}\"",
        task_id.replace('"', "")
    );
    let rows = client
        .list(
            "agent_runs",
            &filter,
            "id,task,project,provider,status,branch,worktree_path,exit_code,\
             blocker,no_change,diff_stat,log_tail,started,ended",
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!(rows))
}
