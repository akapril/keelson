use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Never derive Debug or return this type from a webview command.
#[derive(Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub host: String,
    pub token: String,
}

pub struct MobileVault<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    // The unsupported-platform adapter owns no runtime; do not inherit R's auto traits.
    marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> MobileVault<R> {
    pub fn save(&self, credentials: Credentials) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<serde_json::Value>("save", credentials)
                .map(|_| ())
                .map_err(|_| "VAULT_WRITE_FAILED: 无法安全保存配对信息".into())
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = credentials;
            Err("VAULT_UNAVAILABLE: 当前平台未启用持久化凭据".into())
        }
    }

    pub fn load(&self) -> Result<Option<Credentials>, String> {
        #[cfg(target_os = "android")]
        {
            #[derive(Deserialize)]
            struct Loaded {
                credentials: Option<Credentials>,
            }
            self.handle
                .run_mobile_plugin::<Loaded>("load", serde_json::json!({}))
                .map(|response| response.credentials)
                .map_err(|_| "VAULT_READ_FAILED: 已保存的配对信息不可用，请重新配对".into())
        }
        #[cfg(not(target_os = "android"))]
        {
            Err("VAULT_UNAVAILABLE: 当前平台未启用持久化凭据".into())
        }
    }

    pub fn delete(&self) -> Result<(), String> {
        #[cfg(target_os = "android")]
        {
            self.handle
                .run_mobile_plugin::<serde_json::Value>("delete", serde_json::json!({}))
                .map(|_| ())
                .map_err(|_| "VAULT_DELETE_FAILED: 无法删除配对信息".into())
        }
        #[cfg(not(target_os = "android"))]
        {
            Err("VAULT_UNAVAILABLE: 当前平台未启用持久化凭据".into())
        }
    }
}

pub trait MobileVaultExt<R: Runtime> {
    fn mobile_vault(&self) -> &MobileVault<R>;
}
impl<R: Runtime, T: Manager<R>> MobileVaultExt<R> for T {
    fn mobile_vault(&self) -> &MobileVault<R> {
        self.state::<MobileVault<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-vault")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let vault = MobileVault {
                handle: api
                    .register_android_plugin("com.keelson.mobilevault", "MobileVaultPlugin")?,
            };
            #[cfg(not(target_os = "android"))]
            let vault = {
                let _ = api;
                MobileVault::<R> {
                    marker: std::marker::PhantomData,
                }
            };
            app.manage(vault);
            Ok(())
        })
        .build()
}
