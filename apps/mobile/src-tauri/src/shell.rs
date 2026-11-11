use crate::MobileState;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_mobile_vault::Credentials;
#[cfg(target_os = "android")]
use tauri_plugin_mobile_vault::MobileVaultExt;

fn delete_saved(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        app.mobile_vault().delete()
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

fn save_pair(app: &AppHandle, host: String, token: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        app.mobile_vault().save(Credentials { host, token })
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, host, token);
        Ok(())
    }
}

fn forget_revoked(app: &AppHandle, result: Result<Value, String>) -> Result<Value, String> {
    if matches!(&result, Err(reason) if reason.starts_with("AUTH_REQUIRED:")) {
        delete_saved(app)?;
    }
    result
}

#[tauri::command]
async fn mobile_restore(state: State<'_, MobileState>, app: AppHandle) -> Result<Value, String> {
    state
        .run(true, |client| {
            Box::pin(async move {
                #[cfg(target_os = "android")]
                let stored = app.mobile_vault().load()?;
                #[cfg(not(target_os = "android"))]
                let stored: Option<Credentials> = None;
                let Some(saved) = stored else {
                    return Ok(json!({ "connected": false }));
                };
                if client
                    .restore_connection(&saved.host, &saved.token)
                    .is_err()
                {
                    delete_saved(&app)?;
                    return Err("保存的配对信息无效，请重新配对".into());
                }
                forget_revoked(&app, client.sessions().await)?;
                Ok(json!({ "connected": true, "host": saved.host }))
            })
        })
        .await
}

#[tauri::command]
async fn mobile_pair(
    host: String,
    code: String,
    state: State<'_, MobileState>,
    app: AppHandle,
) -> Result<(), String> {
    state
        .run(true, |client| {
            Box::pin(async move {
                delete_saved(&app)?;
                client.disconnect();
                client.pair(&host, &code).await?;
                let (host, token) = client.credentials().ok_or("配对信息丢失")?;
                if let Err(error) = save_pair(&app, host, token) {
                    client.disconnect();
                    return Err(error);
                }
                Ok(())
            })
        })
        .await
}

#[tauri::command]
async fn mobile_sessions(state: State<'_, MobileState>, app: AppHandle) -> Result<Value, String> {
    state
        .run(false, |client| {
            Box::pin(async move { forget_revoked(&app, client.sessions().await) })
        })
        .await
}

#[tauri::command]
async fn mobile_timeline(
    provider: String,
    session_id: String,
    state: State<'_, MobileState>,
    app: AppHandle,
) -> Result<Value, String> {
    state
        .run(false, |client| {
            Box::pin(
                async move { forget_revoked(&app, client.timeline(&provider, &session_id).await) },
            )
        })
        .await
}

#[tauri::command]
async fn mobile_disconnect(state: State<'_, MobileState>, app: AppHandle) -> Result<(), String> {
    state
        .run(true, |client| {
            Box::pin(async move {
                delete_saved(&app)?;
                client.disconnect();
                Ok(())
            })
        })
        .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_mobile_vault::init())
        .manage(MobileState::new().expect("native client initialization failed"))
        .invoke_handler(tauri::generate_handler![
            mobile_restore,
            mobile_pair,
            mobile_sessions,
            mobile_timeline,
            mobile_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("mobile shell failed");
}
