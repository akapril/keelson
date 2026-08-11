//! runtime/port.rs —— 进程监听端口探测。
//!
//! 用 netstat2 库直接读各 OS 内核 socket 表（Windows iphlpapi / Linux netlink / macOS libproc），
//! 跨平台一套代码，无子进程、无 netstat/ss/lsof 文本解析、无 PATH 依赖。

use netstat2::{
    get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState,
};

/// 检测指定 PID 当前监听的 TCP 端口列表（仅 LISTEN 状态）。
/// 读 socket 表失败（权限不足 / 平台不支持）时返回空 Vec，与原命令实现的容错一致。
pub fn detect_ports(pid: u32) -> Vec<u16> {
    let af = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let sockets = match get_sockets_info(af, ProtocolFlags::TCP) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let mut ports = Vec::new();
    for si in sockets {
        // 一个 socket 可能关联多个 pid（fork 共享）；只要包含目标 pid 即算其监听
        if !si.associated_pids.contains(&pid) {
            continue;
        }
        if let ProtocolSocketInfo::Tcp(tcp) = si.protocol_socket_info {
            if tcp.state == TcpState::Listen && !ports.contains(&tcp.local_port) {
                ports.push(tcp.local_port);
            }
        }
    }
    ports
}
