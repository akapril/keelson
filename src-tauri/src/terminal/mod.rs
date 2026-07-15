// Terminal 模块：负责检测终端类型、构建启动计划并执行。
//
// 架构设计（关注点分离）：
// - kind.rs   : TerminalKind 枚举 + detect_terminal（纯枚举映射 + IO 探测）
// - plan.rs   : LaunchPlan 枚举 + build_plan（纯函数，无 IO，可单元测试）
// - spawn.rs  : execute（薄 IO 层，仅负责将 LaunchPlan 转换为进程调用）

pub mod kind;
pub mod plan;
pub mod spawn;

// 为外部调用方重导出最常用的类型和函数
pub use kind::{TerminalKind, detect_terminal};
pub use plan::{LaunchPlan, ResumeRequest, build_plan};
pub use spawn::execute;
