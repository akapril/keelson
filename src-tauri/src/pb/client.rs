//! PB REST 薄客户端(reqwest)。仅覆盖本产品用到的端点。
//! Task 15+ 中的会话同步将使用这些方法。
#![allow(dead_code)]
use serde_json::Value;

/// PocketBase REST 客户端，持有基础 URL 和用户 token。
#[derive(Clone)]
pub struct PbClient {
    pub base_url: String,
    pub token: String,
}

impl PbClient {
    /// 创建新的客户端实例。
    pub fn new(base_url: &str, token: &str) -> Self {
        Self {
            base_url: base_url.into(),
            token: token.into(),
        }
    }

    /// 内部：构建带 bearer auth 的 reqwest 客户端。
    fn http(&self) -> reqwest::Client {
        reqwest::Client::new()
    }

    /// 按 filter 取一条记录（用于 upsert 前查存在）。
    pub async fn find_one(&self, coll: &str, filter: &str) -> anyhow::Result<Option<Value>> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        let r = self
            .http()
            .get(&url)
            .bearer_auth(&self.token)
            .query(&[("filter", filter), ("perPage", "1")])
            .send()
            .await?
            .error_for_status()?;
        let body: Value = r.json().await?;
        Ok(body["items"].as_array().and_then(|a| a.first()).cloned())
    }

    /// 创建一条记录，返回完整记录 JSON。
    pub async fn create(&self, coll: &str, data: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        Ok(self
            .http()
            .post(&url)
            .bearer_auth(&self.token)
            .json(data)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    /// 更新（PATCH）指定 id 的记录，返回更新后的完整记录。
    pub async fn patch(&self, coll: &str, id: &str, data: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/api/collections/{}/records/{}", self.base_url, coll, id);
        Ok(self
            .http()
            .patch(&url)
            .bearer_auth(&self.token)
            .json(data)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    /// 拉取集合全部记录（最多 500 条），仅返回指定字段。
    pub async fn list_all(&self, coll: &str, fields: &str) -> anyhow::Result<Vec<Value>> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        let r = self
            .http()
            .get(&url)
            .bearer_auth(&self.token)
            .query(&[("perPage", "500"), ("fields", fields)])
            .send()
            .await?
            .error_for_status()?;
        let body: Value = r.json().await?;
        Ok(body["items"].as_array().cloned().unwrap_or_default())
    }
}
