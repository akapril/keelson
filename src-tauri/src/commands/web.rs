// commands/web.rs — 网页正文抓取（供阅读「AI 解析」）。
// 抓取 URL → 粗提取可读正文（去 script/style/标签、解实体、压空白、限长）→ 交前端喂给 AI 摘要。
use std::time::Duration;

/// 送入 AI 的正文字符上限（控制 token/费用）。
const MAX_TEXT_CHARS: usize = 12000;

/// 抓取 URL 并返回粗提取的可读正文文本。
#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    // 仅允许 http/https，拒绝 file:// 等（防本地文件读取 / SSRF）
    let lower = url.trim().to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("仅支持 http/https 链接".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (rework reader)")
        .build()
        .map_err(|e| format!("构建请求失败: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("抓取失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| format!("读取正文失败: {e}"))?;
    Ok(html_to_text(&html))
}

/// 极简 HTML→纯文本（char 索引扫描，UTF-8 安全）：
/// 跳过 script/style 块内容，去掉标签（当空白），解码常见实体，压缩空白，限长。
fn html_to_text(html: &str) -> String {
    let chars: Vec<char> = html.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(n);
    let mut i = 0;
    while i < n {
        if chars[i] == '<' {
            let name = tag_name(&chars, i + 1);
            if name == "script" || name == "style" {
                i = skip_to_close(&chars, i, &name);
                continue;
            }
            // 普通标签：跳到 '>'，并以空白替代（便于后续分词）
            while i < n && chars[i] != '>' {
                i += 1;
            }
            if i < n {
                i += 1; // 跳过 '>'
            }
            out.push(' ');
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }

    // 常见 HTML 实体
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    // 压缩空白
    let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");

    // 限长
    if collapsed.chars().count() > MAX_TEXT_CHARS {
        collapsed.chars().take(MAX_TEXT_CHARS).collect()
    } else {
        collapsed
    }
}

/// 从 '<' 之后的位置读取标签名（小写；跳过前导 '/'）。
fn tag_name(chars: &[char], mut i: usize) -> String {
    if i < chars.len() && chars[i] == '/' {
        i += 1;
    }
    let mut name = String::new();
    while i < chars.len() && chars[i].is_ascii_alphanumeric() {
        name.push(chars[i].to_ascii_lowercase());
        i += 1;
    }
    name
}

/// 从 start（'<' 所在处）跳到 `</name>` 之后的位置；找不到闭合则跳到末尾。
fn skip_to_close(chars: &[char], start: usize, name: &str) -> usize {
    let n = chars.len();
    let mut i = start + 1;
    while i < n {
        if chars[i] == '<' && i + 1 < n && chars[i + 1] == '/' {
            let close = tag_name(chars, i + 1);
            if close == name {
                // 跳到该闭合标签的 '>' 之后
                let mut j = i;
                while j < n && chars[j] != '>' {
                    j += 1;
                }
                return if j < n { j + 1 } else { n };
            }
        }
        i += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_and_scripts() {
        let html = "<html><head><style>.a{color:red}</style></head><body><p>你好 world</p><script>var x=1;</script></body></html>";
        let text = html_to_text(html);
        assert!(text.contains("你好"));
        assert!(text.contains("world"));
        assert!(!text.contains("color:red")); // style 内容被跳过
        assert!(!text.contains("var x")); // script 内容被跳过
    }

    #[test]
    fn decodes_entities_and_collapses_ws() {
        let html = "<p>a&nbsp;&amp;&nbsp;b\n\n   c</p>";
        let text = html_to_text(html);
        assert_eq!(text, "a & b c");
    }

    #[tokio::test]
    async fn rejects_non_http_scheme() {
        // file:// 与裸路径一律拒绝（防本地文件读取）
        assert!(fetch_url_text("file:///etc/passwd".into()).await.is_err());
        assert!(fetch_url_text("C:/Windows/win.ini".into()).await.is_err());
    }

    #[test]
    fn handles_unclosed_script() {
        // 无闭合 script：其后内容被丢弃，不 panic
        let html = "<p>keep</p><script>runaway";
        let text = html_to_text(html);
        assert!(text.contains("keep"));
        assert!(!text.contains("runaway"));
    }
}
