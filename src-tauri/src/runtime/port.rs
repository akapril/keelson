/// 检测指定 PID 当前监听的 TCP 端口列表
pub fn detect_ports(pid: u32) -> Vec<u16> {
    #[cfg(windows)]
    {
        detect_ports_windows(pid)
    }
    #[cfg(target_os = "linux")]
    {
        detect_ports_linux(pid)
    }
    #[cfg(target_os = "macos")]
    {
        detect_ports_macos(pid)
    }
}

/// Windows 实现：通过 netstat -ano 解析 LISTENING 状态的端口
#[cfg(windows)]
fn detect_ports_windows(pid: u32) -> Vec<u16> {
    use std::process::Command;

    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pid_str = pid.to_string();
    let mut ports = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        // 格式: TCP  0.0.0.0:PORT  0.0.0.0:0  LISTENING  PID
        if !trimmed.starts_with("TCP") {
            continue;
        }
        if !trimmed.contains("LISTENING") {
            continue;
        }

        // 按空白分割后最后一列是 PID
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        // 最后一列为 PID
        let line_pid = parts[parts.len() - 1];
        if line_pid != pid_str {
            continue;
        }

        // 第二列为本地地址，格式 0.0.0.0:PORT 或 [::]:PORT
        let local_addr = parts[1];
        if let Some(port) = parse_port_from_addr(local_addr) {
            if !ports.contains(&port) {
                ports.push(port);
            }
        }
    }

    ports
}

/// Linux 实现：通过 ss -tlnp 查找指定 PID 的监听端口
#[cfg(target_os = "linux")]
fn detect_ports_linux(pid: u32) -> Vec<u16> {
    use std::process::Command;

    let output = match Command::new("ss").args(["-tlnp"]).output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pid_marker = format!("pid={}", pid);
    let mut ports = Vec::new();

    for line in stdout.lines() {
        if !line.contains(&pid_marker) {
            continue;
        }

        // 格式: State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }

        // 第四列（索引3）是本地地址
        let local_addr = parts[3];
        if let Some(port) = parse_port_from_addr(local_addr) {
            if !ports.contains(&port) {
                ports.push(port);
            }
        }
    }

    ports
}

/// macOS 实现：通过 lsof -iTCP -sTCP:LISTEN -P -p PID 查找监听端口
#[cfg(target_os = "macos")]
fn detect_ports_macos(pid: u32) -> Vec<u16> {
    use std::process::Command;

    let output = match Command::new("lsof")
        .args(["-iTCP", "-sTCP:LISTEN", "-P", "-p", &pid.to_string()])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ports = Vec::new();
    let mut first_line = true;

    for line in stdout.lines() {
        // 跳过标题行
        if first_line {
            first_line = false;
            continue;
        }

        // 格式: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        // NAME 列格式: *:PORT 或 hostname:PORT
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        // 最后一列是 NAME（地址:端口）
        let name = parts[parts.len() - 1];
        if let Some(port) = parse_port_from_addr(name) {
            if !ports.contains(&port) {
                ports.push(port);
            }
        }
    }

    ports
}

/// 从地址字符串中解析端口号
/// 支持格式：0.0.0.0:8080、[::]:8080、*:8080、hostname:8080
fn parse_port_from_addr(addr: &str) -> Option<u16> {
    // 处理 IPv6 格式 [::]:PORT
    let port_str = if let Some(bracket_end) = addr.rfind("]:") {
        &addr[bracket_end + 2..]
    } else if let Some(colon_pos) = addr.rfind(':') {
        &addr[colon_pos + 1..]
    } else {
        return None;
    };

    port_str.parse::<u16>().ok()
}
