//! 任务 rank 计算：MCP 建任务一律追加到目标列末尾。纯函数,可测。
const STEP: f64 = 1000.0;

/// 追加到末尾的 rank = 现有最大 rank + STEP；空列表则 STEP。
pub fn next_rank(existing: &[f64]) -> f64 {
    existing.iter().cloned().fold(0.0_f64, f64::max) + STEP
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_yields_first_step() {
        assert_eq!(next_rank(&[]), 1000.0);
    }

    #[test]
    fn appends_after_max() {
        assert_eq!(next_rank(&[1000.0, 2000.0]), 3000.0);
        assert_eq!(next_rank(&[500.0]), 1500.0);
    }

    #[test]
    fn ignores_order_uses_max() {
        assert_eq!(next_rank(&[3000.0, 1000.0, 2000.0]), 4000.0);
    }
}
