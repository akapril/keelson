use std::process::Command;

/// 创建隐藏窗口的 Command（Windows 上不闪 cmd 窗口）
#[cfg(windows)]
fn silent_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    cmd
}

#[cfg(not(windows))]
fn silent_command(program: &str) -> Command {
    Command::new(program)
}

/// 支持的终端类型（跨平台）
#[derive(Debug, Clone)]
#[allow(dead_code)] // 各平台仅使用自身的变体
pub enum TerminalKind {
    // Windows
    WindowsTerminal,
    PowerShell,
    Cmd,
    // macOS
    MacDefault,   // Terminal.app
    MacIterm,     // iTerm2
    MacGhostty,   // Ghostty
    MacAlacritty, // Alacritty
    MacKitty,     // Kitty
    MacWezterm,   // WezTerm
    MacRio,       // Rio
    MacWarp,      // Warp
    // Linux
    LinuxTerminal(String),
    LinuxFallback,
    // 自定义命令模板 — {cmd} 和 {dir} 会被替换
    Custom(String),
}

/// 根据用户偏好检测终端类型，"auto" 时自动探测系统可用终端
pub fn detect_terminal(pref: &str) -> TerminalKind {
    match pref {
        // Windows
        "wt" => TerminalKind::WindowsTerminal,
        "pwsh" => TerminalKind::PowerShell,
        "cmd" => TerminalKind::Cmd,
        // macOS
        "terminal" | "Terminal" => TerminalKind::MacDefault,
        "iterm" | "iTerm" | "iTerm2" => TerminalKind::MacIterm,
        "ghostty" | "Ghostty" => TerminalKind::MacGhostty,
        "alacritty" => TerminalKind::MacAlacritty,
        "kitty" => TerminalKind::MacKitty,
        "wezterm" | "WezTerm" => TerminalKind::MacWezterm,
        "rio" | "Rio" => TerminalKind::MacRio,
        "warp" | "Warp" => TerminalKind::MacWarp,
        // 自定义命令模板
        s if s.starts_with("custom:") => TerminalKind::Custom(s[7..].to_string()),
        // Linux — 用户可直接指定终端名称（非 "auto" 的其他非空字符串）
        #[cfg(target_os = "linux")]
        name if !name.is_empty() && name != "auto" => TerminalKind::LinuxTerminal(name.to_string()),
        // 其余情况自动探测
        _ => auto_detect(),
    }
}

/// Windows: 优先 Windows Terminal > PowerShell > Cmd
#[cfg(windows)]
fn auto_detect() -> TerminalKind {
    if silent_command("where")
        .arg("wt.exe")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return TerminalKind::WindowsTerminal;
    }
    if silent_command("where")
        .arg("pwsh.exe")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return TerminalKind::PowerShell;
    }
    TerminalKind::Cmd
}

/// macOS: 按优先级检测已安装的终端
#[cfg(target_os = "macos")]
fn auto_detect() -> TerminalKind {
    let checks: Vec<(&str, TerminalKind)> = vec![
        ("/Applications/Ghostty.app", TerminalKind::MacGhostty),
        ("/Applications/iTerm.app", TerminalKind::MacIterm),
        ("/Applications/Warp.app", TerminalKind::MacWarp),
        ("/Applications/kitty.app", TerminalKind::MacKitty),
        ("/Applications/Alacritty.app", TerminalKind::MacAlacritty),
        ("/Applications/WezTerm.app", TerminalKind::MacWezterm),
        ("/Applications/Rio.app", TerminalKind::MacRio),
    ];
    for (path, kind) in checks {
        if std::path::Path::new(path).exists() {
            return kind;
        }
    }
    TerminalKind::MacDefault
}

/// Linux: 探测常见终端仿真器
#[cfg(target_os = "linux")]
fn auto_detect() -> TerminalKind {
    for term in &[
        "gnome-terminal",
        "konsole",
        "alacritty",
        "kitty",
        "xfce4-terminal",
        "xterm",
    ] {
        if silent_command("which")
            .arg(term)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return TerminalKind::LinuxTerminal(term.to_string());
        }
    }
    TerminalKind::LinuxFallback
}

/// 兜底：其他 Unix 类平台或非 windows/macos/linux 系统回退
#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn auto_detect() -> TerminalKind {
    TerminalKind::LinuxFallback
}
