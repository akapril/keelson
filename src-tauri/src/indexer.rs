use crate::models::Session;
use jieba_rs::Jieba;
use std::path::Path;
use std::sync::Arc;
use tantivy::directory::MmapDirectory;
use tantivy::schema::*;
use tantivy::tokenizer::*;
use tantivy::{doc, Index, IndexReader, IndexWriter, ReloadPolicy};
use parking_lot::Mutex;

/// Tantivy 会话全文索引管理器
///
/// 与 retalk 的主要差异：
/// - `new(dir)` 接受外部目录路径，不依赖 retalk_dir()
/// - IndexWriter 复用：持有 `Arc<Mutex<IndexWriter>>`，避免每次 upsert/delete 重建（retalk 的瓶颈）
pub struct SessionIndex {
    index: Index,
    reader: IndexReader,
    schema: Schema,
    /// 复用的 IndexWriter（retalk 每次操作都重新创建，此处修复为持久持有）
    writer: Arc<Mutex<IndexWriter>>,
    #[allow(dead_code)]
    jieba: Arc<Jieba>,
    // 缓存字段句柄，避免每次 add_session_to_writer 时查找
    f_session_id: Field,
    f_provider: Field,
    f_project_path: Field,
    f_project_name: Field,
    f_first_prompt: Field,
    f_last_prompt: Field,
    f_content: Field,
    f_updated_at: Field,
    f_message_count: Field,
    f_total_tokens: Field,
}

/// jieba 中文分词器，适配 tantivy Tokenizer trait
#[derive(Clone)]
struct JiebaTokenizer {
    jieba: Arc<Jieba>,
}

impl Tokenizer for JiebaTokenizer {
    type TokenStream<'a> = JiebaTokenStream;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let words = self.jieba.cut(text, true);
        let mut tokens = Vec::new();
        let mut offset = 0;
        for word in words {
            // 保留原始词长度用于偏移计算，再做 trim
            let raw_len = word.len();
            let trimmed = word.trim();
            if !trimmed.is_empty() {
                // 计算 trimmed 在原始 word 中的起始偏移
                let leading = word.len() - word.trim_start().len();
                tokens.push(Token {
                    offset_from: offset + leading,
                    offset_to: offset + leading + trimmed.len(),
                    position: tokens.len(),
                    text: trimmed.to_lowercase(),
                    position_length: 1,
                });
            }
            offset += raw_len;
        }
        JiebaTokenStream { tokens, index: 0 }
    }
}

/// jieba 分词结果的 TokenStream 实现
struct JiebaTokenStream {
    tokens: Vec<Token>,
    index: usize,
}

impl TokenStream for JiebaTokenStream {
    fn advance(&mut self) -> bool {
        if self.index < self.tokens.len() {
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn token(&self) -> &Token {
        &self.tokens[self.index - 1]
    }

    fn token_mut(&mut self) -> &mut Token {
        &mut self.tokens[self.index - 1]
    }
}

impl SessionIndex {
    /// 创建或打开指定目录下的 Tantivy 索引，注册 jieba 分词器
    pub fn new(dir: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(dir)?;

        let jieba = Arc::new(Jieba::new());

        // 构建 schema：文本字段使用 jieba 分词器
        let mut schema_builder = Schema::builder();
        let text_options = TextOptions::default()
            .set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer("jieba")
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            )
            .set_stored();

        // content 字段：仅索引，不存储（节省空间）
        let text_indexed_only = TextOptions::default()
            .set_indexing_options(
                TextFieldIndexing::default()
                    .set_tokenizer("jieba")
                    .set_index_option(IndexRecordOption::WithFreqsAndPositions),
            );

        schema_builder.add_text_field("session_id", STRING | STORED);
        schema_builder.add_text_field("provider", STRING | STORED);
        schema_builder.add_text_field("project_path", STRING | STORED);
        schema_builder.add_text_field("project_name", text_options.clone());
        schema_builder.add_text_field("first_prompt", text_options.clone());
        schema_builder.add_text_field("last_prompt", text_options.clone());
        schema_builder.add_text_field("content", text_indexed_only);
        schema_builder.add_date_field("updated_at", INDEXED | STORED | FAST);
        schema_builder.add_u64_field("message_count", STORED);
        schema_builder.add_u64_field("total_tokens", STORED);

        let schema = schema_builder.build();

        // 尝试打开已有索引，若 schema 不匹配则删除重建
        let index = match MmapDirectory::open(dir)
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
            .and_then(|d| {
                Index::open_or_create(d, schema.clone())
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
            }) {
            Ok(idx) => {
                // 检查 schema 是否包含必需字段（provider, total_tokens）
                if idx.schema().get_field("provider").is_err()
                    || idx.schema().get_field("total_tokens").is_err()
                {
                    drop(idx);
                    std::fs::remove_dir_all(dir)?;
                    std::fs::create_dir_all(dir)?;
                    let d = MmapDirectory::open(dir)?;
                    Index::open_or_create(d, schema.clone())?
                } else {
                    idx
                }
            }
            Err(_) => {
                // 索引损坏或不兼容，删除重建
                let _ = std::fs::remove_dir_all(dir);
                std::fs::create_dir_all(dir)?;
                let d = MmapDirectory::open(dir)?;
                Index::open_or_create(d, schema.clone())?
            }
        };

        // 注册 jieba 分词器到索引
        index
            .tokenizers()
            .register("jieba", JiebaTokenizer { jieba: Arc::clone(&jieba) });

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;

        // 创建复用的 IndexWriter（50 MB 内存预算）
        // 修复：retalk 每次 upsert/delete 都调用 index.writer()，性能较差；此处持久持有
        let writer = index.writer(50_000_000)?;

        // 缓存字段句柄
        let f_session_id = schema.get_field("session_id").unwrap();
        let f_provider = schema.get_field("provider").unwrap();
        let f_project_path = schema.get_field("project_path").unwrap();
        let f_project_name = schema.get_field("project_name").unwrap();
        let f_first_prompt = schema.get_field("first_prompt").unwrap();
        let f_last_prompt = schema.get_field("last_prompt").unwrap();
        let f_content = schema.get_field("content").unwrap();
        let f_updated_at = schema.get_field("updated_at").unwrap();
        let f_message_count = schema.get_field("message_count").unwrap();
        let f_total_tokens = schema.get_field("total_tokens").unwrap();

        Ok(Self {
            index,
            reader,
            schema,
            writer: Arc::new(Mutex::new(writer)),
            jieba,
            f_session_id,
            f_provider,
            f_project_path,
            f_project_name,
            f_first_prompt,
            f_last_prompt,
            f_content,
            f_updated_at,
            f_message_count,
            f_total_tokens,
        })
    }

    /// 全量重建索引：清空后批量写入
    pub fn rebuild(&self, sessions: &[Session]) -> Result<(), Box<dyn std::error::Error>> {
        let mut writer = self.writer.lock();
        writer.delete_all_documents()?;
        for session in sessions {
            self.add_session_to_writer(&mut writer, session)?;
        }
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    /// 单条会话更新：先删除旧文档再写入新文档
    pub fn upsert(&self, s: &Session) -> Result<(), Box<dyn std::error::Error>> {
        let mut writer = self.writer.lock();
        let term = tantivy::Term::from_field_text(self.f_session_id, &s.session_id);
        writer.delete_term(term);
        self.add_session_to_writer(&mut writer, s)?;
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    /// 从索引中删除指定会话
    pub fn delete(&self, session_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let mut writer = self.writer.lock();
        let term = tantivy::Term::from_field_text(self.f_session_id, session_id);
        writer.delete_term(term);
        writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    /// 增量同步：只 upsert 新增/更新的会话，删除已不存在的
    pub fn incremental_sync(
        &self,
        sessions: &[Session],
    ) -> Result<(), Box<dyn std::error::Error>> {
        use std::collections::HashSet;
        use tantivy::schema::Value;
        use tantivy::TantivyDocument;

        let searcher = self.reader.searcher();
        let session_id_field = self.f_session_id;
        let updated_at_field = self.f_updated_at;

        // 收集索引中所有 session_id -> updated_at（微秒时间戳）
        let mut indexed: std::collections::HashMap<String, i64> =
            std::collections::HashMap::new();
        for segment_reader in searcher.segment_readers() {
            let store = segment_reader.get_store_reader(1)?;
            for doc_id in 0..segment_reader.num_docs() {
                let doc: TantivyDocument = store.get(doc_id)?;
                let sid = doc
                    .get_first(session_id_field)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let ts = doc
                    .get_first(updated_at_field)
                    .and_then(|v| v.as_datetime())
                    .map(|d| d.into_timestamp_micros())
                    .unwrap_or(0);
                if !sid.is_empty() {
                    indexed.insert(sid, ts);
                }
            }
        }

        // 计算需要 upsert 的和需要删除的
        let new_ids: HashSet<&str> = sessions.iter().map(|s| s.session_id.as_str()).collect();
        let mut to_upsert = Vec::new();
        for session in sessions {
            let new_ts = session.updated_at.timestamp_micros();
            match indexed.get(&session.session_id) {
                Some(&old_ts) if old_ts == new_ts => {} // 无变化，跳过
                _ => to_upsert.push(session),
            }
        }

        let to_delete: Vec<String> = indexed
            .keys()
            .filter(|id| !new_ids.contains(id.as_str()))
            .cloned()
            .collect();

        if to_upsert.is_empty() && to_delete.is_empty() {
            return Ok(()); // 无变化，直接返回
        }

        let mut writer = self.writer.lock();

        // 删除已不存在的会话
        for id in &to_delete {
            let term = tantivy::Term::from_field_text(session_id_field, id);
            writer.delete_term(term);
        }

        // upsert 有变化的会话
        for session in &to_upsert {
            let term = tantivy::Term::from_field_text(session_id_field, &session.session_id);
            writer.delete_term(term);
            self.add_session_to_writer(&mut writer, session)?;
        }

        writer.commit()?;
        self.reader.reload()?;
        eprintln!(
            "[rework] 增量同步：{} upsert，{} delete",
            to_upsert.len(),
            to_delete.len()
        );
        Ok(())
    }

    /// 将单个 Session 写入 IndexWriter
    fn add_session_to_writer(
        &self,
        writer: &mut IndexWriter,
        session: &Session,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // 合并所有用户消息作为全文检索内容
        let all_content = session.user_messages.join("\n");
        let date_val =
            tantivy::DateTime::from_timestamp_micros(session.updated_at.timestamp_micros());

        writer.add_document(doc!(
            self.f_session_id    => session.session_id.as_str(),
            self.f_provider      => session.provider.as_str(),
            self.f_project_path  => session.project_path.as_str(),
            self.f_project_name  => session.project_name.as_str(),
            self.f_first_prompt  => session.first_prompt.as_str(),
            self.f_last_prompt   => session.last_prompt.as_str(),
            self.f_content       => all_content.as_str(),
            self.f_updated_at    => date_val,
            self.f_message_count => session.message_count as u64,
            self.f_total_tokens  => session.total_tokens,
        ))?;

        Ok(())
    }

    /// 索引中的文档数
    pub fn doc_count(&self) -> u64 {
        self.reader.searcher().num_docs()
    }

    /// 获取底层 Index 引用（供 search 模块使用）
    pub fn index(&self) -> &Index {
        &self.index
    }

    /// 获取 IndexReader 引用（供 search 模块使用）
    pub fn reader(&self) -> &IndexReader {
        &self.reader
    }

    /// 获取 Schema 引用（供 search 模块使用）
    pub fn schema(&self) -> &Schema {
        &self.schema
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::session_backend;
    use chrono::Utc;
    use tempfile::TempDir;

    /// 创建测试用的假 Session
    fn fake_session(id: &str, project: &str, first_prompt: &str, provider: &str) -> Session {
        Session {
            session_id: id.to_string(),
            provider: provider.to_string(),
            project_path: format!("/tmp/{}", project),
            project_name: project.to_string(),
            first_prompt: first_prompt.to_string(),
            last_prompt: first_prompt.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            message_count: 2,
            user_messages: vec![first_prompt.to_string()],
            total_tokens: 100,
        }
    }

    /// index_roundtrip 测试：
    /// 1. rebuild 写入 2 条 Session
    /// 2. search 找到特定词
    /// 3. incremental_sync 删除其中一条
    /// 4. search 不再找到已删除的那条
    #[test]
    fn index_roundtrip() {
        let tmp: TempDir = tempfile::tempdir().expect("创建临时目录失败");
        let idx_dir = tmp.path().join("index");

        let index = SessionIndex::new(&idx_dir).expect("SessionIndex::new 失败");

        // 构造两条不同主题的会话
        // 注意：jieba 分词 "全文检索引擎" → ["全文检索", "引擎"]，搜索需用整体分词词组
        let s1 = fake_session("sess-001", "tantivy-demo", "全文检索引擎", "claude");
        let s2 = fake_session("sess-002", "other-project", "机器学习模型训练", "codex");

        // Step 1: rebuild 写入两条会话
        index.rebuild(&[s1.clone(), s2.clone()]).expect("rebuild 失败");

        // Step 2: search 应能找到 s1（含"引擎"：jieba 对"全文检索引擎"分词产生 ["全文检索", "引擎"]）
        let hits = session_backend::search(&index, "引擎", 10);
        assert!(
            hits.iter().any(|h| h.session_id == "sess-001"),
            "应找到 sess-001，实际结果：{:?}",
            hits.iter().map(|h| &h.session_id).collect::<Vec<_>>()
        );

        // Step 3: incremental_sync 只保留 s2，s1 应被删除
        index
            .incremental_sync(&[s2.clone()])
            .expect("incremental_sync 失败");

        // Step 4: 再次搜索，s1 不应出现
        let hits_after = session_backend::search(&index, "引擎", 10);
        assert!(
            !hits_after.iter().any(|h| h.session_id == "sess-001"),
            "sess-001 应已被删除，实际结果：{:?}",
            hits_after
                .iter()
                .map(|h| &h.session_id)
                .collect::<Vec<_>>()
        );
    }

    /// delete 接口测试：单独删除某条记录后搜不到
    #[test]
    fn delete_removes_document() {
        let tmp: TempDir = tempfile::tempdir().expect("创建临时目录失败");
        let idx_dir = tmp.path().join("index");

        let index = SessionIndex::new(&idx_dir).expect("SessionIndex::new 失败");

        let s = fake_session("sess-del", "delete-test", "独特关键词唯一字符串", "claude");
        index.rebuild(&[s]).expect("rebuild 失败");

        // 确认可以搜到
        let hits = session_backend::search(&index, "独特关键词唯一字符串", 10);
        assert!(
            hits.iter().any(|h| h.session_id == "sess-del"),
            "删除前应找到 sess-del"
        );

        // 删除
        index.delete("sess-del").expect("delete 失败");

        // 确认搜不到
        let hits_after = session_backend::search(&index, "独特关键词唯一字符串", 10);
        assert!(
            !hits_after.iter().any(|h| h.session_id == "sess-del"),
            "删除后不应找到 sess-del"
        );
    }
}
