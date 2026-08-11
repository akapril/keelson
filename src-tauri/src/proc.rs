//! 子进程构造助手：Windows 上隐藏控制台窗口（CREATE_NO_WINDOW）。
//!
//! 背景：release 版为 GUI 子系统（`windows_subsystem = "windows"`），进程本身无控制台。
//! 用 `Command` spawn 控制台程序（git / tasklist / netstat / taskkill …）时，若不带
//! CREATE_NO_WINDOW，系统会为子进程**新建一个控制台窗口**并一闪而过。dev 版父进程带
//! 控制台、子进程继承，故不闪——**此问题仅打包后出现**。所有 headless 系统命令统一经
//! 此助手构造，从源头消除黑窗闪现。非 Windows 平台无此问题，助手退化为普通 `Command`。

/// CREATE_NO_WINDOW：不为子进程分配控制台窗口（仅 Windows 有意义）。
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 构造**不弹控制台窗口**的 [`std::process::Command`]。
///
/// 用于所有后台调用系统命令、只取其 stdout / exit code 的场景。
#[cfg(windows)]
pub fn hidden_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 非 Windows：无控制台窗口问题，直接返回普通 `Command`。
#[cfg(not(windows))]
pub fn hidden_command(program: &str) -> std::process::Command {
    std::process::Command::new(program)
}

/// [`hidden_command`] 的 tokio 版：构造不弹窗的 [`tokio::process::Command`]。
/// 注：tokio 在 Windows 直接提供同名 inherent 方法 `creation_flags`，无需引 CommandExt。
#[cfg(windows)]
pub fn hidden_tokio_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 非 Windows：直接返回普通 tokio `Command`。
#[cfg(not(windows))]
pub fn hidden_tokio_command(program: &str) -> tokio::process::Command {
    tokio::process::Command::new(program)
}
