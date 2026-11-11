use crate::MobileClient;
use std::{future::Future, pin::Pin};
use tokio::sync::{watch, Mutex};

type Operation<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub struct MobileState {
    client: Mutex<MobileClient>,
    epoch: watch::Sender<u64>,
}

impl MobileState {
    pub fn new() -> Result<Self, String> {
        Ok(Self {
            client: Mutex::new(MobileClient::new()?),
            epoch: watch::channel(0).0,
        })
    }

    pub async fn run<T>(
        &self,
        replace: bool,
        operation: impl for<'a> FnOnce(&'a mut MobileClient) -> Operation<'a, T>,
    ) -> Result<T, String> {
        let mut cancellation = self.epoch.subscribe();
        if replace {
            let mut own_epoch = 0;
            self.epoch.send_modify(|epoch| {
                *epoch = epoch.wrapping_add(1);
                own_epoch = *epoch;
            });
            if *cancellation.borrow_and_update() != own_epoch {
                return Err("AUTH_REQUIRED: 连接操作已取消，请重新配对".into());
            }
        }
        tokio::select! {
            biased;
            _ = cancellation.changed() => Err("AUTH_REQUIRED: 连接操作已取消，请重新配对".into()),
            result = async {
                let mut client = self.client.lock().await;
                operation(&mut client).await
            } => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn replacing_connection_cancels_inflight_operation_before_mutation() {
        let state = MobileState::new().unwrap();
        let (started, ready) = tokio::sync::oneshot::channel();
        let old_request = state.run(false, |client| {
            Box::pin(async move {
                started.send(()).unwrap();
                std::future::pending::<()>().await;
                client.disconnect(); // a late 401 must never reach this mutation
                Ok(())
            })
        });
        let replacement = async {
            ready.await.unwrap();
            state
                .run(true, |client| {
                    Box::pin(async move {
                        client.connection = Some(crate::Connection {
                            host: crate::validate_host("https://new.example").unwrap(),
                            token: "b".repeat(43),
                        });
                        Ok(())
                    })
                })
                .await
        };
        let (old, new) = tokio::time::timeout(std::time::Duration::from_secs(1), async {
            tokio::join!(old_request, replacement)
        })
        .await
        .expect("replacement must cancel the blocked request");
        assert!(old.unwrap_err().starts_with("AUTH_REQUIRED:"));
        assert!(new.is_ok());
        assert_eq!(
            state
                .client
                .lock()
                .await
                .connection
                .as_ref()
                .unwrap()
                .host
                .as_str(),
            "https://new.example/"
        );
    }
}
