use regex::Regex;
use std::sync::LazyLock;

/// 日志解析结果
pub struct ParsedLog {
    pub level: Option<String>,
    #[allow(dead_code)]
    pub structured: Option<String>,
}

// 预编译正则
static ERROR_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(error|err!|panic|fatal|exception|failed|failure)\b").unwrap()
});
static WARN_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(warn(?:ing)?|deprecated)\b").unwrap()
});
static DEBUG_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(debug|trace)\b").unwrap()
});
static BRACKET_LEVEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\]").unwrap()
});

pub fn parse_line(raw: &str) -> ParsedLog {
    let trimmed = raw.trim();

    // 1. JSON 检测
    if trimmed.starts_with('{') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let level = extract_level_from_json(&value);
            return ParsedLog {
                level,
                structured: Some(trimmed.to_string()),
            };
        }
    }

    // 2. [LEVEL] 括号模式匹配
    if let Some(caps) = BRACKET_LEVEL.captures(trimmed) {
        let level = normalize_level(&caps[1]);
        return ParsedLog {
            level: Some(level),
            structured: None,
        };
    }

    // 3. 正则关键词匹配
    let level = if ERROR_PATTERN.is_match(trimmed) {
        Some("error".to_string())
    } else if WARN_PATTERN.is_match(trimmed) {
        Some("warn".to_string())
    } else if DEBUG_PATTERN.is_match(trimmed) {
        Some("debug".to_string())
    } else {
        None
    };

    ParsedLog {
        level,
        structured: None,
    }
}

fn extract_level_from_json(value: &serde_json::Value) -> Option<String> {
    let level_keys = ["level", "severity", "log_level", "loglevel", "lvl"];
    for key in &level_keys {
        if let Some(v) = value.get(key) {
            if let Some(s) = v.as_str() {
                return Some(normalize_level(s));
            }
        }
    }
    None
}

fn normalize_level(raw: &str) -> String {
    match raw.to_uppercase().as_str() {
        "WARNING" => "warn".to_string(),
        "ERR" | "FATAL" | "CRITICAL" => "error".to_string(),
        "TRACE" => "debug".to_string(),
        other => other.to_lowercase(),
    }
}
