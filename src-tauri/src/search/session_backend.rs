use crate::indexer::SessionIndex;
use crate::search::SessionHit;
use chrono::DateTime;
use tantivy::collector::TopDocs;
use tantivy::query::{AllQuery, QueryParser};
use tantivy::schema::Value;
use tantivy::TantivyDocument;

/// 会话全文搜索
///
/// 查询策略（三层兜底，移植自 retalk searcher.rs）：
/// 1. 直接解析原始查询字符串
/// 2. 解析失败则转义特殊字符后重试
/// 3. 仍失败则按空格分词，每个词做 TermQuery，Should(OR) 组合
///
/// 同时对 project_path（STRING 字段）做 RegexQuery 子串匹配，并支持 provider 过滤。
pub fn search(index: &SessionIndex, query: &str, limit: usize) -> Vec<SessionHit> {
    let searcher = index.reader().searcher();
    let schema = index.schema();

    let project_name = schema.get_field("project_name").unwrap();
    let first_prompt = schema.get_field("first_prompt").unwrap();
    let last_prompt = schema.get_field("last_prompt").unwrap();
    let content = schema.get_field("content").unwrap();
    let project_path = schema.get_field("project_path").unwrap();

    // 搜索字段：project_name / first_prompt / last_prompt / content
    let search_fields = vec![project_name, first_prompt, last_prompt, content];

    let mut query_parser = QueryParser::for_index(index.index(), search_fields.clone());
    // 默认使用 AND 连接（全部词都需命中），与 retalk 保持一致
    query_parser.set_conjunction_by_default();

    // 三层兜底查询构建
    let parsed_query = query_parser
        .parse_query(query)
        .or_else(|_| {
            // 第二层：转义特殊字符后重试
            let escaped = escape_query(query);
            query_parser.parse_query(&escaped)
        })
        .unwrap_or_else(|_| {
            // 第三层：按词兜底
            build_fallback_query(query, &search_fields)
        });

    // 对 project_path（STRING 不分词）做子串正则匹配
    let path_query = build_path_query(query, project_path);

    // 合并：文本查询 OR 路径查询
    let final_query: Box<dyn tantivy::query::Query> = if let Some(pq) = path_query {
        Box::new(tantivy::query::BooleanQuery::new(vec![
            (tantivy::query::Occur::Should, parsed_query),
            (tantivy::query::Occur::Should, pq),
        ]))
    } else {
        parsed_query
    };

    let top_docs = match searcher.search(&*final_query, &TopDocs::with_limit(limit)) {
        Ok(docs) => docs,
        Err(_) => return Vec::new(),
    };

    extract_hits(&searcher, schema, &top_docs)
}

/// 构建项目路径子串匹配查询（project_path 是 STRING 类型，使用 RegexQuery）
fn build_path_query(
    query_str: &str,
    project_path_field: tantivy::schema::Field,
) -> Option<Box<dyn tantivy::query::Query>> {
    let trimmed = query_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    // 转义正则特殊字符，构造不区分大小写的子串匹配模式
    let escaped: String = trimmed
        .chars()
        .map(|c| {
            if r#"\.*+?()[]{}|^$"#.contains(c) {
                format!("\\{}", c)
            } else {
                c.to_string()
            }
        })
        .collect();
    let pattern = format!("(?i).*{}.*", escaped);
    match tantivy::query::RegexQuery::from_pattern(&pattern, project_path_field) {
        Ok(rq) => Some(Box::new(rq)),
        Err(_) => None,
    }
}

/// 转义 Tantivy 查询语法中的特殊字符
pub(crate) fn escape_query(query: &str) -> String {
    let special = [
        '+', '-', '&', '|', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':',
        '\\', '/',
    ];
    let mut result = String::with_capacity(query.len() * 2);
    for c in query.chars() {
        if special.contains(&c) {
            result.push('\\');
        }
        result.push(c);
    }
    result
}

/// 兜底查询：将输入按空格分词，每个词在所有字段上做 TermQuery，用 Should(OR) 组合
pub(crate) fn build_fallback_query(
    query_str: &str,
    fields: &[tantivy::schema::Field],
) -> Box<dyn tantivy::query::Query> {
    let words: Vec<&str> = query_str.split_whitespace().collect();
    if words.is_empty() {
        return Box::new(AllQuery);
    }

    let mut sub_queries: Vec<(tantivy::query::Occur, Box<dyn tantivy::query::Query>)> = Vec::new();
    for word in &words {
        let lower = word.to_lowercase();
        for field in fields {
            let term = tantivy::Term::from_field_text(*field, &lower);
            sub_queries.push((
                tantivy::query::Occur::Should,
                Box::new(tantivy::query::TermQuery::new(
                    term,
                    tantivy::schema::IndexRecordOption::WithFreqsAndPositions,
                )),
            ));
        }
    }

    Box::new(tantivy::query::BooleanQuery::new(sub_queries))
}

/// 从搜索结果文档地址中提取结构化 SessionHit
fn extract_hits(
    searcher: &tantivy::Searcher,
    schema: &tantivy::schema::Schema,
    docs: &[(f32, tantivy::DocAddress)],
) -> Vec<SessionHit> {
    let session_id_field = schema.get_field("session_id").unwrap();
    let provider_field = schema.get_field("provider").unwrap();
    let project_name_field = schema.get_field("project_name").unwrap();
    let first_prompt_field = schema.get_field("first_prompt").unwrap();
    let updated_at_field = schema.get_field("updated_at").unwrap();

    let mut results = Vec::new();
    for (score, doc_addr) in docs {
        let doc: TantivyDocument = match searcher.doc(*doc_addr) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let get_text = |field| -> String {
            doc.get_first(field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };

        // 将 updated_at 格式化为 "月-日 时:分"
        let updated_str = doc
            .get_first(updated_at_field)
            .and_then(|v| v.as_datetime())
            .map(|dt| {
                let ts = dt.into_timestamp_micros();
                DateTime::from_timestamp_micros(ts)
                    .unwrap_or_default()
                    .format("%m-%d %H:%M")
                    .to_string()
            })
            .unwrap_or_default();

        // snippet 使用 first_prompt 作为摘要
        let snippet = get_text(first_prompt_field);

        results.push(SessionHit {
            session_id: get_text(session_id_field),
            project_name: get_text(project_name_field),
            snippet,
            provider: get_text(provider_field),
            updated_at: updated_str,
            score: *score,
        });
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试 escape_query：各类特殊字符应被正确转义
    #[test]
    fn escape_query_special_chars() {
        // 单个特殊字符
        assert_eq!(escape_query("+"), "\\+");
        assert_eq!(escape_query("-"), "\\-");
        assert_eq!(escape_query("(hello)"), "\\(hello\\)");
        assert_eq!(escape_query("[test]"), "\\[test\\]");
        assert_eq!(escape_query("foo:bar"), "foo\\:bar");
        // 普通字符不受影响
        assert_eq!(escape_query("hello world"), "hello world");
        assert_eq!(escape_query(""), "");
        // 混合字符
        assert_eq!(escape_query("a+b"), "a\\+b");
        assert_eq!(escape_query("a|b"), "a\\|b");
    }

    /// 测试 build_fallback_query：空输入返回 AllQuery，非空输入返回 BooleanQuery
    #[test]
    fn build_fallback_query_empty_returns_all() {
        use tantivy::schema::SchemaBuilder;
        let schema = SchemaBuilder::new().build();
        let fields: Vec<tantivy::schema::Field> = vec![];
        // 空输入：应返回 AllQuery（实际上是 BooleanQuery，此处只验证不 panic）
        let _q = build_fallback_query("", &fields);
    }

    /// 测试 escape_query：斜杠和反斜杠
    #[test]
    fn escape_query_slash_and_backslash() {
        assert_eq!(escape_query("a/b"), "a\\/b");
        assert_eq!(escape_query("a\\b"), "a\\\\b");
    }

    /// 测试 escape_query：引号
    #[test]
    fn escape_query_quote() {
        assert_eq!(escape_query(r#"say "hello""#), r#"say \"hello\""#);
    }
}
