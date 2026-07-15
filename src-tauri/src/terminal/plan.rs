use crate::terminal::kind::TerminalKind;

/// 请求在终端中恢复某个 AI 工具会话所需的全部信息。
/// `resume_cmd` 来自 provider.resume_command()，已包含工具名和会话 ID，
/// 例如 "claude --resume abc123"。
pub struct ResumeRequest {
    /// 项目绝对路径（终端启动后需 cd 到此目录）
    pub project_path: String,
    /// provider 生成的恢复命令，如 "claude --resume abc"
    pub resume_cmd: String,
}

/// 描述如何启动终端进程。
/// 纯数据结构，不含任何 IO 或 spawn 操作。
pub enum LaunchPlan {
    /// 直接以 program + args 启动（如 wt.exe / cmd.exe / pwsh.exe）
    Program {
        program: String,
        args: Vec<String>,
    },
    /// 通过脚本解释器运行 script 字符串（如 osascript -e <script>）
    Script {
        program: String,
        script: String,
    },
}

/// 根据终端类型和恢复请求，纯函数地构建启动计划。
///
/// # 纯度保证
/// 此函数无任何 IO、文件系统访问或进程 spawn —— 仅做字符串拼接与数据组装。
/// 这使得 `build_plan` 可在单元测试中安全调用而无副作用。
pub fn build_plan(kind: &TerminalKind, req: &ResumeRequest) -> LaunchPlan {
    match kind {
        // ===== Windows =====

        TerminalKind::WindowsTerminal => {
            // wt.exe new-tab --title "..." cmd /k "cd /d \"<path>\" && <resume_cmd>"
            // Windows 必须用 cd /d 以支持跨盘符切换（如 C: → D:）
            let full_cmd = windows_cd_and_resume(&req.project_path, &req.resume_cmd);
            let project_name = project_name(&req.project_path);
            LaunchPlan::Program {
                program: "wt.exe".to_string(),
                args: vec![
                    "new-tab".to_string(),
                    "--title".to_string(),
                    format!("rework: {}", project_name),
                    "cmd".to_string(),
                    "/k".to_string(),
                    full_cmd,
                ],
            }
        }

        TerminalKind::PowerShell => {
            // pwsh.exe -NoExit -Command "Set-Location -LiteralPath '<path>'; <resume_cmd>"
            // PowerShell 使用 Set-Location 而非 cd，以正确处理含特殊字符的路径
            let ps_cmd = if req.resume_cmd.is_empty() {
                format!("Set-Location -LiteralPath '{}'", req.project_path)
            } else {
                format!(
                    "Set-Location -LiteralPath '{}'; {}",
                    req.project_path, req.resume_cmd
                )
            };
            // Windows 用 pwsh.exe，其他平台用 pwsh
            let pwsh = if cfg!(windows) { "pwsh.exe" } else { "pwsh" };
            LaunchPlan::Program {
                program: pwsh.to_string(),
                args: vec!["-NoExit".to_string(), "-Command".to_string(), ps_cmd],
            }
        }

        TerminalKind::Cmd => {
            // cmd.exe /k "cd /d \"<path>\" && <resume_cmd>"
            let full_cmd = windows_cd_and_resume(&req.project_path, &req.resume_cmd);
            LaunchPlan::Program {
                program: "cmd.exe".to_string(),
                args: vec!["/k".to_string(), full_cmd],
            }
        }

        // ===== macOS =====

        TerminalKind::MacDefault => {
            // 通过 osascript 在 Terminal.app 中打开新脚本窗口
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let script = format!(
                "tell application \"Terminal\"\n\
                    activate\n\
                    do script \"{}\"\n\
                end tell",
                unix_cmd.replace('"', "\\\"")
            );
            LaunchPlan::Script {
                program: "osascript".to_string(),
                script,
            }
        }

        TerminalKind::MacIterm => {
            // 通过 osascript 在 iTerm2 中创建新标签页并执行命令
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let script = format!(
                "tell application \"iTerm\"\n\
                    activate\n\
                    tell current window\n\
                        create tab with default profile\n\
                        tell current session\n\
                            write text \"{}\"\n\
                        end tell\n\
                    end tell\n\
                end tell",
                unix_cmd.replace('"', "\\\"")
            );
            LaunchPlan::Script {
                program: "osascript".to_string(),
                script,
            }
        }

        TerminalKind::MacGhostty => {
            // open -na Ghostty --args -e /bin/zsh -c "<cmd>; exec $SHELL"
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec $SHELL", unix_cmd);
            LaunchPlan::Program {
                program: "open".to_string(),
                args: vec![
                    "-na".to_string(),
                    "Ghostty".to_string(),
                    "--args".to_string(),
                    "-e".to_string(),
                    "/bin/zsh".to_string(),
                    "-c".to_string(),
                    shell_cmd,
                ],
            }
        }

        TerminalKind::MacAlacritty => {
            // alacritty -e /bin/zsh -c "<cmd>; exec zsh"
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec zsh", unix_cmd);
            LaunchPlan::Program {
                program: "alacritty".to_string(),
                args: vec![
                    "-e".to_string(),
                    "/bin/zsh".to_string(),
                    "-c".to_string(),
                    shell_cmd,
                ],
            }
        }

        TerminalKind::MacKitty => {
            // kitty --hold zsh -c "<cmd>; exec zsh"
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec zsh", unix_cmd);
            LaunchPlan::Program {
                program: "kitty".to_string(),
                args: vec![
                    "--hold".to_string(),
                    "zsh".to_string(),
                    "-c".to_string(),
                    shell_cmd,
                ],
            }
        }

        TerminalKind::MacWezterm => {
            // wezterm start --cwd <path> -- zsh -c "<cmd>; exec zsh"
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec zsh", unix_cmd);
            LaunchPlan::Program {
                program: "wezterm".to_string(),
                args: vec![
                    "start".to_string(),
                    "--cwd".to_string(),
                    req.project_path.clone(),
                    "--".to_string(),
                    "zsh".to_string(),
                    "-c".to_string(),
                    shell_cmd,
                ],
            }
        }

        TerminalKind::MacRio => {
            // rio -w <path> -e zsh -c "<cmd>; exec zsh"
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec zsh", unix_cmd);
            LaunchPlan::Program {
                program: "rio".to_string(),
                args: vec![
                    "-w".to_string(),
                    req.project_path.clone(),
                    "-e".to_string(),
                    "zsh".to_string(),
                    "-c".to_string(),
                    shell_cmd,
                ],
            }
        }

        TerminalKind::MacWarp => {
            // Warp 通过 URI scheme 打开窗口，再由 osascript 输入命令
            // 注意：此处仅能返回一个 LaunchPlan；Warp 的两步流程（open URL + keystroke）
            // 在 spawn.rs 中通过特殊处理实现。这里只提供 open 步骤。
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let script = format!(
                "tell application \"System Events\" to tell process \"Warp\"\n\
                    keystroke \"{}\"\n\
                    key code 36\n\
                end tell",
                unix_cmd.replace('"', "\\\"")
            );
            LaunchPlan::Script {
                program: "osascript".to_string(),
                script,
            }
        }

        // ===== Linux =====

        TerminalKind::LinuxTerminal(term) => {
            // 不同终端的参数格式略有不同，但都是 shell -c "<cmd>; exec $SHELL"
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec $SHELL", unix_cmd);
            let args = match term.as_str() {
                "gnome-terminal" => vec!["--".to_string(), "bash".to_string(), "-c".to_string(), shell_cmd],
                "konsole" => vec!["-e".to_string(), "bash".to_string(), "-c".to_string(), shell_cmd],
                "xfce4-terminal" => vec!["-e".to_string(), format!("bash -c '{}'", shell_cmd)],
                "alacritty" => vec!["-e".to_string(), "bash".to_string(), "-c".to_string(), shell_cmd],
                "kitty" => vec!["bash".to_string(), "-c".to_string(), shell_cmd],
                _ => vec!["-e".to_string(), "bash".to_string(), "-c".to_string(), shell_cmd],
            };
            LaunchPlan::Program {
                program: term.clone(),
                args,
            }
        }

        TerminalKind::LinuxFallback => {
            // 回退到 xterm
            let unix_cmd = unix_cd_and_resume(&req.project_path, &req.resume_cmd);
            let shell_cmd = format!("{}; exec $SHELL", unix_cmd);
            LaunchPlan::Program {
                program: "xterm".to_string(),
                args: vec!["-e".to_string(), "bash".to_string(), "-c".to_string(), shell_cmd],
            }
        }

        // ===== 自定义 =====

        TerminalKind::Custom(template) => {
            // 模板中 {cmd} 替换为 "cd /d <path> && <resume_cmd>"（Windows）
            // 或 "cd <path> && <resume_cmd>"（Unix），{dir} 替换为项目路径
            let full_cmd = if cfg!(windows) {
                windows_cd_and_resume(&req.project_path, &req.resume_cmd)
            } else {
                unix_cd_and_resume(&req.project_path, &req.resume_cmd)
            };
            let resolved = template
                .replace("{cmd}", &full_cmd)
                .replace("{dir}", &req.project_path);
            // 用系统 shell 执行解析后的自定义命令
            if cfg!(windows) {
                LaunchPlan::Program {
                    program: "cmd.exe".to_string(),
                    args: vec!["/c".to_string(), resolved],
                }
            } else {
                LaunchPlan::Program {
                    program: "sh".to_string(),
                    args: vec!["-c".to_string(), resolved],
                }
            }
        }
    }
}

// ===== 辅助函数（纯函数，无 IO）=====

/// 从路径中提取最后一段目录名（用于终端标题）
fn project_name(path: &str) -> &str {
    // 兼容 Windows（反斜杠）和 Unix（正斜杠）
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}

/// Windows 跨盘符 cd 命令拼接：cd /d "<path>" && <resume_cmd>
fn windows_cd_and_resume(project_path: &str, resume_cmd: &str) -> String {
    let cd = format!("cd /d \"{}\"", project_path);
    if resume_cmd.is_empty() {
        cd
    } else {
        format!("{} && {}", cd, resume_cmd)
    }
}

/// Unix cd 命令拼接：cd "<path>" && <resume_cmd>
fn unix_cd_and_resume(project_path: &str, resume_cmd: &str) -> String {
    let cd = format!("cd \"{}\"", project_path);
    if resume_cmd.is_empty() {
        cd
    } else {
        format!("{} && {}", cd, resume_cmd)
    }
}

// ===== 单元测试（纯函数，无 spawn/IO）=====

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::kind::TerminalKind;

    /// TDD 首测：Windows Terminal plan 必须包含 cd /d 和 resume_cmd
    #[test]
    fn wt_plan_includes_cd_and_resume() {
        let req = ResumeRequest {
            project_path: "D:\\p".into(),
            resume_cmd: "claude --resume abc".into(),
        };
        let plan = build_plan(&TerminalKind::WindowsTerminal, &req);
        if let LaunchPlan::Program { program, args } = plan {
            assert_eq!(program, "wt.exe");
            let joined = args.join(" ");
            assert!(joined.contains("cd /d"), "args 应包含 'cd /d'，实际: {}", joined);
            assert!(
                joined.contains("claude --resume abc"),
                "args 应包含 resume_cmd，实际: {}",
                joined
            );
        } else {
            panic!("应为 Program plan");
        }
    }

    /// PowerShell plan 使用 Set-Location 而非 cd，且不包含 /d 标志
    #[test]
    fn powershell_plan_uses_set_location() {
        let req = ResumeRequest {
            project_path: "C:\\Users\\dev\\myproject".into(),
            resume_cmd: "codex resume sess123".into(),
        };
        let plan = build_plan(&TerminalKind::PowerShell, &req);
        if let LaunchPlan::Program { program, args } = plan {
            // Windows 上应为 pwsh.exe，其他平台为 pwsh
            assert!(
                program == "pwsh.exe" || program == "pwsh",
                "program 应为 pwsh(.exe)，实际: {}",
                program
            );
            let joined = args.join(" ");
            assert!(
                joined.contains("Set-Location"),
                "args 应包含 Set-Location，实际: {}",
                joined
            );
            assert!(
                joined.contains("codex resume sess123"),
                "args 应包含 resume_cmd，实际: {}",
                joined
            );
            // PowerShell 用 Set-Location，不应有 cd /d
            assert!(
                !joined.contains("cd /d"),
                "PowerShell plan 不应含 cd /d，实际: {}",
                joined
            );
        } else {
            panic!("应为 Program plan");
        }
    }

    /// Cmd plan 直接用 cmd.exe /k 和 cd /d（跨盘符支持）
    #[test]
    fn cmd_plan_uses_cd_d() {
        let req = ResumeRequest {
            project_path: "E:\\workspace\\project".into(),
            resume_cmd: "claude --resume xyz".into(),
        };
        let plan = build_plan(&TerminalKind::Cmd, &req);
        if let LaunchPlan::Program { program, args } = plan {
            assert_eq!(program, "cmd.exe");
            assert!(args.contains(&"/k".to_string()), "args 应包含 /k");
            let joined = args.join(" ");
            assert!(joined.contains("cd /d"), "cmd plan 应含 cd /d，实际: {}", joined);
            assert!(
                joined.contains("claude --resume xyz"),
                "应包含 resume_cmd，实际: {}",
                joined
            );
        } else {
            panic!("应为 Program plan");
        }
    }

    /// 路径含空格时，Windows Terminal plan 仍应正确包含双引号包裹的路径
    #[test]
    fn wt_plan_path_with_spaces() {
        let req = ResumeRequest {
            project_path: "D:\\My Projects\\hello world".into(),
            resume_cmd: "claude --resume abc".into(),
        };
        let plan = build_plan(&TerminalKind::WindowsTerminal, &req);
        if let LaunchPlan::Program { program, args } = plan {
            assert_eq!(program, "wt.exe");
            let joined = args.join(" ");
            // 路径含空格，必须被双引号包围
            assert!(
                joined.contains("\"D:\\My Projects\\hello world\""),
                "含空格路径应被引号包围，实际: {}",
                joined
            );
        } else {
            panic!("应为 Program plan");
        }
    }

    /// resume_cmd 为空时，Windows Terminal plan 仍应正确生成（只有 cd /d）
    #[test]
    fn wt_plan_empty_resume_cmd() {
        let req = ResumeRequest {
            project_path: "C:\\work".into(),
            resume_cmd: "".into(),
        };
        let plan = build_plan(&TerminalKind::WindowsTerminal, &req);
        if let LaunchPlan::Program { program, args } = plan {
            assert_eq!(program, "wt.exe");
            let joined = args.join(" ");
            assert!(joined.contains("cd /d"), "应含 cd /d，实际: {}", joined);
            // 空 resume_cmd 时不应有 &&
            assert!(!joined.contains("&&"), "空 resume_cmd 不应有 &&，实际: {}", joined);
        } else {
            panic!("应为 Program plan");
        }
    }

    /// project_name 辅助函数能正确提取最后一段路径
    #[test]
    fn project_name_extraction() {
        assert_eq!(project_name("D:\\workspace\\myapp"), "myapp");
        assert_eq!(project_name("/home/user/projects/foo"), "foo");
        assert_eq!(project_name("C:\\work\\"), "work");
    }
}
