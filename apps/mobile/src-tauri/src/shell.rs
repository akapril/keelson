use crate::MobileState;
use serde_json::Value;
use tauri::State;

#[tauri::command]
async fn mobile_pair(
    host: String,
    code: String,
    state: State<'_, MobileState>,
) -> Result<(), String> {
    state
        .run(true, |client| {
            Box::pin(async move { client.pair(&host, &code).await })
        })
        .await
}

#[tauri::command]
async fn mobile_sessions(state: State<'_, MobileState>) -> Result<Value, String> {
    state.run(false, |client| Box::pin(client.sessions())).await
}

#[tauri::command]
async fn mobile_timeline(
    provider: String,
    session_id: String,
    state: State<'_, MobileState>,
) -> Result<Value, String> {
    state
        .run(false, |client| {
            Box::pin(async move { client.timeline(&provider, &session_id).await })
        })
        .await
}

#[tauri::command]
async fn mobile_disconnect(state: State<'_, MobileState>) -> Result<(), String> {
    state
        .run(true, |client| {
            Box::pin(async move {
                client.disconnect();
                Ok(())
            })
        })
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MobileState::new().expect("native HTTPS client initialization failed"))
        .invoke_handler(tauri::generate_handler![
            mobile_pair,
            mobile_sessions,
            mobile_timeline,
            mobile_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("mobile shell failed");
}
