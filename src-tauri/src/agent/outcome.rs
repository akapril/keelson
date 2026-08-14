//! 由「退出码 + 有无 diff + agent 是否报 blocker」判定运行结果状态（纯函数，可测）。

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// 进 待审：no_change=true 表示 agent 未产生任何改动
    Review { no_change: bool },
    /// 受阻：reason 记录原因
    Blocked { reason: String },
}

/// 判定规则（优先级从上到下）：
/// 1. agent 已报 blocker → Blocked(该原因)
/// 2. 退出码非 0 或缺失 → Blocked(退出异常)
/// 3. 退出 0 → Review{ no_change = !has_diff }
pub fn decide_outcome(exit_code: Option<i32>, has_diff: bool, blocker: Option<&str>) -> Outcome {
    // 优先级 1：agent 明确报告阻塞原因
    if let Some(b) = blocker {
        if !b.trim().is_empty() {
            return Outcome::Blocked { reason: format!("agent 报告阻塞：{}", b.trim()) };
        }
    }
    // 优先级 2/3：按退出码判定
    match exit_code {
        Some(0) => Outcome::Review { no_change: !has_diff },
        Some(code) => Outcome::Blocked { reason: format!("CLI 退出码非零（{code}）") },
        None => Outcome::Blocked { reason: "CLI 未正常退出".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exit0_with_diff_is_review() {
        assert_eq!(decide_outcome(Some(0), true, None), Outcome::Review { no_change: false });
    }
    #[test]
    fn exit0_no_diff_is_review_no_change() {
        assert_eq!(decide_outcome(Some(0), false, None), Outcome::Review { no_change: true });
    }
    #[test]
    fn nonzero_exit_is_blocked() {
        match decide_outcome(Some(1), true, None) {
            Outcome::Blocked { reason } => assert!(reason.contains("非零")),
            _ => panic!("应为 Blocked"),
        }
    }
    #[test]
    fn blocker_overrides_even_exit0() {
        match decide_outcome(Some(0), true, Some("缺依赖")) {
            Outcome::Blocked { reason } => assert!(reason.contains("缺依赖")),
            _ => panic!("应为 Blocked"),
        }
    }
    #[test]
    fn empty_blocker_ignored() {
        assert_eq!(decide_outcome(Some(0), true, Some("  ")), Outcome::Review { no_change: false });
    }
}
