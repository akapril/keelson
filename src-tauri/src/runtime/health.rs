/// health.rs — 进程健康检查模块
///
/// 提供 TCP 连接检查和 HTTP 健康检查两种方式，
/// 综合判断进程是否正常响应。
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// TCP 连接检查（端口是否可连接）
pub fn check_tcp(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_secs(2),
    )
    .is_ok()
}

/// HTTP 检查（GET 请求，返回 2xx 视为健康）
/// 使用原始 TCP 实现，不依赖第三方 HTTP 库
pub fn check_http(url: &str) -> bool {
    let url = url.trim();

    // 去除 http:// 前缀
    let stripped = url.strip_prefix("http://").unwrap_or(url);

    // 分离 host:port 和 path
    let (host_port, path) = match stripped.find('/') {
        Some(i) => (&stripped[..i], &stripped[i..]),
        None => (stripped, "/"),
    };

    // 若未指定端口则默认使用 80
    let addr = if host_port.contains(':') {
        host_port.to_string()
    } else {
        format!("{}:80", host_port)
    };

    // 建立 TCP 连接
    let addr_parsed = match addr.parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr_parsed, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return false,
    };

    // 设置读超时，避免阻塞
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok();

    // 发送最简 HTTP/1.0 GET 请求
    let request = format!(
        "GET {} HTTP/1.0\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, host_port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    // 读取响应头（最多 256 字节，足够判断状态码）
    let mut response = vec![0u8; 256];
    match stream.read(&mut response) {
        Ok(n) if n > 12 => {
            let header = String::from_utf8_lossy(&response[..n]);
            // 检查是否为 HTTP/1.x 2xx 状态
            header.starts_with("HTTP/1.")
                && header.chars().nth(9).map(|c| c == '2').unwrap_or(false)
        }
        _ => false,
    }
}

/// 综合健康检查：优先 HTTP URL，回退到 TCP 端口检查
/// 返回 "healthy" / "unhealthy" / "unknown"
pub fn check(health_url: &Option<String>, ports: &[u16]) -> String {
    if let Some(url) = health_url {
        if check_http(url) {
            "healthy"
        } else {
            "unhealthy"
        }
        .to_string()
    } else if let Some(&port) = ports.first() {
        if check_tcp(port) {
            "healthy"
        } else {
            "unhealthy"
        }
        .to_string()
    } else {
        "unknown".to_string()
    }
}
