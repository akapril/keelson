//! PB REST 薄客户端(reqwest)。仅覆盖本产品用到的端点。
//! Task 15+ 中的会话同步将使用这些方法。
#![allow(dead_code)]
use serde_json::Value;

/// 将响应按状态码转为 Result：失败时把 PocketBase 的错误响应体一并带出，
/// 便于定位字段级校验错误（如 validation_not_unique / 必填缺失）。
/// 替代 reqwest 的 error_for_status()（后者会丢弃响应体）。
async fn json_or_err(resp: reqwest::Response) -> anyhow::Result<Value> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp.json().await?);
    }
    // 读取错误体（PB 返回 JSON：{"message":..,"data":{字段->错误}}）
    let body = resp.text().await.unwrap_or_default();
    anyhow::bail!("PB {status}: {body}");
}

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

    /// 内部：构建 reqwest 客户端。连本机 PB 必须绕过代理（见 pb::local_http_client）。
    fn http(&self) -> reqwest::Client {
        crate::pb::local_http_client()
    }

    /// 按 filter 取一条记录（用于 upsert 前查存在）。
    pub async fn find_one(&self, coll: &str, filter: &str) -> anyhow::Result<Option<Value>> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        let resp = self
            .http()
            .get(&url)
            .bearer_auth(&self.token)
            .query(&[("filter", filter), ("perPage", "1")])
            .send()
            .await?;
        let body = json_or_err(resp).await?;
        Ok(body["items"].as_array().and_then(|a| a.first()).cloned())
    }

    /// 创建一条记录，返回完整记录 JSON。
    pub async fn create(&self, coll: &str, data: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        let resp = self
            .http()
            .post(&url)
            .bearer_auth(&self.token)
            .json(data)
            .send()
            .await?;
        json_or_err(resp).await
    }

    /// 更新（PATCH）指定 id 的记录，返回更新后的完整记录。
    pub async fn patch(&self, coll: &str, id: &str, data: &Value) -> anyhow::Result<Value> {
        let url = format!("{}/api/collections/{}/records/{}", self.base_url, coll, id);
        let resp = self
            .http()
            .patch(&url)
            .bearer_auth(&self.token)
            .json(data)
            .send()
            .await?;
        json_or_err(resp).await
    }

    /// 翻页拉取集合记录（累积全部页，perPage=500）。读 totalPages 循环到末页，
    /// 消除原先只取第 1 页导致的「超 500 条静默丢数据」（任务少列、并发计数失真）。
    async fn list_paged(&self, coll: &str, extra: &[(&str, &str)]) -> anyhow::Result<Vec<Value>> {
        let url = format!("{}/api/collections/{}/records", self.base_url, coll);
        let mut items: Vec<Value> = Vec::new();
        let mut page: u32 = 1;
        loop {
            let page_s = page.to_string();
            let mut q: Vec<(&str, &str)> = vec![("perPage", "500"), ("page", page_s.as_str())];
            q.extend_from_slice(extra);
            let resp = self.http().get(&url).bearer_auth(&self.token).query(&q).send().await?;
            let body = json_or_err(resp).await?;
            match body["items"].as_array() {
                Some(arr) if !arr.is_empty() => items.extend(arr.iter().cloned()),
                _ => break, // 无更多数据，收尾
            }
            let total_pages = body["totalPages"].as_i64().unwrap_or(1);
            if page as i64 >= total_pages {
                break;
            }
            page += 1;
        }
        Ok(items)
    }

    /// 拉取集合全部记录（翻页累积），仅返回指定字段。
    pub async fn list_all(&self, coll: &str, fields: &str) -> anyhow::Result<Vec<Value>> {
        self.list_paged(coll, &[("fields", fields)]).await
    }

    /// 按 filter 拉取记录（翻页累积），仅返回指定字段。
    pub async fn list(&self, coll: &str, filter: &str, fields: &str) -> anyhow::Result<Vec<Value>> {
        self.list_paged(coll, &[("filter", filter), ("fields", fields)]).await
    }
}
