//! Web Gateway 认证 core：配对码生成、token 签发/校验/吊销、失败限流。
//!
//! 这是外网入口的安全基石——写错等于「远程任意命令执行被绕过」，故逐条落实安全要求：
//! 1. 配对码 & token 高熵：≥32 字节 CSPRNG（`OsRng`）→ base64url 无填充。
//! 2. token 不存明文：仅存 SHA-256 hash；`verify_token` 用常量时间比对 hash。
//! 3. `check_pairing` 常量时间比较配对码 + 失败限流（连续失败超阈值拉长间隔/拒绝，防在线爆破）。
//! 4. `revoke(device_id)` 后该 token 立即失效（从 devices 移除对应 hash）。
//! 5. `AuthState` 用 parking_lot Mutex（项目惯例，`.lock()` 无 `unwrap`）。
//!
//! 纯逻辑、无 Tauri/axum 依赖，可 standalone（`rustc --test`）测试。

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use parking_lot::Mutex;
use rand::RngCore;
use rand::rngs::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;

/// 单个已配对设备。token 明文永不落地，仅存其 SHA-256 hash。
#[derive(Debug, Clone)]
pub struct Device {
    /// 设备 ID（用于 revoke 定位；非敏感，可对外）。
    pub id: String,
    /// token 的 SHA-256 hash（32 字节）。校验时用它做常量时间比对。
    pub token_hash: [u8; 32],
    /// 配对时间（RFC3339 字符串）。
    pub paired_at: String,
    /// 设备标签（如 "phone"、"laptop"，用户可读，非敏感）。
    pub label: String,
}

/// 失败限流状态：防在线爆破配对码。
///
/// 策略（简单计数 + 时间窗口）：连续失败计数 `fail_count`，每次失败后要求下一次
/// 尝试至少间隔 `backoff`；`backoff` 随失败次数指数增长（封顶）。成功后清零。
#[derive(Debug)]
pub struct RateLimit {
    /// 连续失败次数。
    fail_count: u32,
    /// 上一次尝试的 unix 毫秒时间戳（0 表示从未尝试）。
    last_attempt_ms: u64,
}

impl RateLimit {
    /// 连续失败达到此阈值后开始施加退避间隔。
    const THRESHOLD: u32 = 3;
    /// 退避基准间隔（毫秒）。实际间隔 = BASE_MS << (fail_count - THRESHOLD)，封顶 MAX_MS。
    const BASE_MS: u64 = 1_000;
    /// 退避间隔上限（毫秒，30 秒）。
    const MAX_MS: u64 = 30_000;

    fn new() -> Self {
        RateLimit {
            fail_count: 0,
            last_attempt_ms: 0,
        }
    }

    /// 当前是否被退避拦截（距上次尝试不足要求间隔则拦截）。
    fn is_blocked(&self, now_ms: u64) -> bool {
        if self.fail_count < Self::THRESHOLD {
            return false;
        }
        // 超阈值后：按失败次数指数拉长要求间隔。
        let shift = (self.fail_count - Self::THRESHOLD).min(31);
        let required = (Self::BASE_MS << shift).min(Self::MAX_MS);
        now_ms.saturating_sub(self.last_attempt_ms) < required
    }

    /// 记录一次失败尝试。
    fn record_failure(&mut self, now_ms: u64) {
        self.fail_count = self.fail_count.saturating_add(1);
        self.last_attempt_ms = now_ms;
    }

    /// 成功后清零，解除退避。
    fn record_success(&mut self, now_ms: u64) {
        self.fail_count = 0;
        self.last_attempt_ms = now_ms;
    }
}

/// 认证状态：单实例持有配对码、服务端 secret 与已配对设备表。
///
/// 字段私有，仅经方法访问，避免外部误改绕过安全约束。测试通过 `new_with_code` 构造。
pub struct AuthState {
    /// 配对码明文（一次性配对流程用；外网仅短暂暴露给受信设备）。
    ///
    /// Task 3 改为 `Mutex<String>`：`/pair` 成功签发 token 后立即 `rotate_pairing_code`
    /// 轮换新码，旧码即刻失效——防「泄露的旧配对码 = 永久后门」（Task 2 转交项 2）。
    pairing_code: Mutex<String>,
    /// 服务端 secret（32 字节，用于未来签名/派生；此处保留以满足接口约定）。
    #[allow(dead_code)]
    secret: [u8; 32],
    /// 已配对设备表。parking_lot Mutex，`.lock()` 无 `unwrap`。
    pub devices: Mutex<Vec<Device>>,
    /// 配对失败限流状态。
    fails: Mutex<RateLimit>,
}

/// 生成配对码：32 字节 CSPRNG → base64url 无填充（高熵，≥256 bit）。
pub fn gen_pairing_code() -> String {
    let mut buf = [0u8; 32];
    // OsRng 直接取操作系统 CSPRNG，密码学安全。
    OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// 生成高熵 token：32 字节 CSPRNG → base64url 无填充。
fn gen_token() -> String {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// 对 token 明文求 SHA-256，得到 32 字节 hash（用于存储与常量时间比对）。
fn hash_token(token: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let out = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&out);
    hash
}

/// 当前 unix 毫秒时间戳（限流用；单调性不敏感，系统回拨仅影响退避判定，安全侧偏保守）。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 当前时间的 RFC3339 字符串。为保持 auth.rs 纯逻辑 & standalone 可测，
/// 此处不引 chrono，用 unix 毫秒表示（`paired_at` 仅作记录，非安全关键）。
fn now_rfc3339_like() -> String {
    format!("unixms:{}", now_ms())
}

impl AuthState {
    /// 用给定配对码构造。secret 用 CSPRNG 随机生成。
    pub fn new_with_code(pairing_code: String) -> Self {
        let mut secret = [0u8; 32];
        OsRng.fill_bytes(&mut secret);
        AuthState {
            pairing_code: Mutex::new(pairing_code),
            secret,
            devices: Mutex::new(Vec::new()),
            fails: Mutex::new(RateLimit::new()),
        }
    }

    /// 生成随机配对码并构造（生产入口）。
    pub fn new() -> Self {
        Self::new_with_code(gen_pairing_code())
    }
}

impl Default for AuthState {
    fn default() -> Self {
        Self::new()
    }
}

/// 签发 token：生成高熵 token，存其 SHA-256 hash 到 devices，返回明文（仅此一次可见）。
pub fn issue_token(state: &AuthState, label: String) -> String {
    let token = gen_token();
    let token_hash = hash_token(&token);
    let device = Device {
        // 设备 ID 用独立随机值（16 字节 base64url），与 token 无关联，避免从 ID 反推 token。
        id: {
            let mut idb = [0u8; 16];
            OsRng.fill_bytes(&mut idb);
            URL_SAFE_NO_PAD.encode(idb)
        },
        token_hash,
        paired_at: now_rfc3339_like(),
        label,
    };
    state.devices.lock().push(device);
    token
}

/// 校验 token：对每个 device 的 hash 做常量时间比对。
///
/// 关键：全程不用 `==` 短路，也不因某个 device 命中而提前 return——用累加器聚合，
/// 遍历所有 device 后再判定，避免命中位置泄露时序信息。
pub fn verify_token(state: &AuthState, token: &str) -> bool {
    let candidate = hash_token(token);
    let devices = state.devices.lock();
    // u8 累加器：任一 device 命中则某次 ct_eq 返回 1，累加后非 0 即通过。
    let mut matched: u8 = 0;
    for dev in devices.iter() {
        // subtle 的 ct_eq 返回 Choice；unwrap_u8 得 0/1，常量时间，无分支短路。
        matched |= candidate.ct_eq(&dev.token_hash).unwrap_u8();
    }
    matched != 0
}

/// 吊销设备：从 devices 移除对应 hash，该 token 立即失效。
pub fn revoke(state: &AuthState, device_id: &str) {
    let mut devices = state.devices.lock();
    devices.retain(|d| d.id != device_id);
}

/// 校验配对码：常量时间比对 + 失败限流（只读校验，不轮换）。
///
/// `/pair` handler 应改用 `check_and_rotate`（原子校验+轮换，消除 TOCTOU）。
/// 此函数保留供单元测试与内部逻辑复用。
#[allow(dead_code)]
pub fn check_pairing(state: &AuthState, code: &str) -> bool {
    let now = now_ms();
    let mut fails = state.fails.lock();

    // 退避拦截：在线爆破时，超阈值后每次尝试都被间隔要求挡住。
    if fails.is_blocked(now) {
        // 记为一次失败以持续拉长间隔，防止攻击者「贴着窗口」高频试探。
        fails.record_failure(now);
        return false;
    }

    // 常量时间比对配对码：先对两侧 hash 到定长 32 字节，再做 ct_eq。
    // 直接对原始 &[u8] 做 ct_eq 时，subtle 对不等长 slice 会短路返回 0，
    // 攻击者可通过计时探测配对码长度（长度侧信道）。
    // hash 到定长后两侧始终为 32 字节，消除该侧信道。
    // 取当前配对码明文（clone 出短生命周期串，随即释放锁；比对在锁外做）。
    let current = state.pairing_code.lock().clone();
    let ok = bool::from(hash_token(code).ct_eq(&hash_token(&current)));

    if ok {
        fails.record_success(now);
    } else {
        fails.record_failure(now);
    }
    ok
}

/// 轮换配对码：生成新随机码替换旧码，旧码即刻失效（Task 2 转交项 2）。
///
/// 直接调用仅供内部/测试使用；`/pair` handler 应改用 `check_and_rotate`（原子操作）。
#[allow(dead_code)]
pub fn rotate_pairing_code(state: &AuthState) {
    *state.pairing_code.lock() = gen_pairing_code();
}

/// 原子「校验配对码 + 成功则立即轮换」：全程持 `pairing_code` 锁，杜绝并发同码换多个
/// token 的 TOCTOU（I-2 安全修复）。返回 `true` 表示配对成功（且旧码已轮换作废）。
///
/// 流程：
/// 1. 先查失败限流（持 `fails` 锁）：退避窗口内直接拒绝，不触碰配对码锁。
/// 2. 持 `pairing_code` 锁：hash 两侧定长 32 字节常量时间比对。
/// 3. **在同一 `pairing_code` 锁临界区内**：命中则立即换新随机码并返回 `true`。
/// 4. 锁释放后：更新限流计数（持 `fails` 锁），成功清零/失败累加。
///
/// 关键保证：「比对通过 → 轮换」之间不释放 `pairing_code` 锁，并发到达的同码请求
/// 要么在步骤 2 拿到旧锁被阻塞，等锁后拿到的是新码（比对失败）→ 返回 false。
pub fn check_and_rotate(state: &AuthState, code: &str) -> bool {
    let now = now_ms();

    // 步骤 1：限流前置拦截（持 fails 锁；退避窗口内直接拒绝）。
    {
        let mut fails = state.fails.lock();
        if fails.is_blocked(now) {
            // 持续累加，防贴窗高频试探。
            fails.record_failure(now);
            return false;
        }
    }

    // 步骤 2+3：持 pairing_code 锁做原子「比对 + 轮换」。
    let ok = {
        let mut current = state.pairing_code.lock();
        let matched = bool::from(hash_token(code).ct_eq(&hash_token(&*current)));
        if matched {
            // 命中：在同一临界区内立即换码，旧码在锁释放前就已失效。
            *current = gen_pairing_code();
        }
        matched
    };

    // 步骤 4：锁外更新限流计数（pairing_code 锁已释放，避免两把锁同时持有）。
    {
        let mut fails = state.fails.lock();
        if ok {
            fails.record_success(now);
        } else {
            fails.record_failure(now);
        }
    }

    ok
}

/// 读取当前配对码明文（供 Task 5 设置栏展示，让用户抄给待配对设备）。
///
/// ⚠️ 仅在受信本机 UI 中调用；配对码是外网入口凭据，切勿写日志/回传外部。
pub fn current_pairing_code(state: &AuthState) -> String {
    state.pairing_code.lock().clone()
}

/// 设备信息（对外脱敏版）：仅含可公开字段，绝不含 `token_hash`。
/// 由 `list_devices` 返回，供设置栏展示已配对设备。
#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    /// 设备 ID（同 Device.id，非敏感；用于前端发起吊销请求）。
    pub id: String,
    /// 用户可读标签（如 "phone"、"laptop"）。
    pub label: String,
    /// 配对时间（与 Device.paired_at 相同格式）。
    pub paired_at: String,
}

/// 列出已配对设备（脱敏）：只返回 `{ id, label, paired_at }`，不含 token_hash。
pub fn list_devices(state: &AuthState) -> Vec<DeviceInfo> {
    state
        .devices
        .lock()
        .iter()
        .map(|d| DeviceInfo {
            id: d.id.clone(),
            label: d.label.clone(),
            paired_at: d.paired_at.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_token_verifies_and_revokes() {
        let a = AuthState::new_with_code("CODE".into());
        let tok = issue_token(&a, "phone".into());
        assert!(verify_token(&a, &tok));
        assert!(!verify_token(&a, "wrong"));
        // 注：brief 骨架写的是 `.lock().unwrap()`，但项目用 parking_lot，
        // 其 `.lock()` 直接返回守卫（非 Result），故此处无 `.unwrap()`。
        let dev = a.devices.lock()[0].id.clone();
        revoke(&a, &dev);
        assert!(!verify_token(&a, &tok)); // 吊销后失效
    }

    #[test]
    fn pairing_constant_time_and_reject_wrong() {
        let a = AuthState::new_with_code("SECRET".into());
        assert!(check_pairing(&a, "SECRET"));
        assert!(!check_pairing(&a, "nope"));
    }

    #[test]
    fn tokens_and_codes_are_high_entropy() {
        // 高熵自证：32 字节 → base64url 无填充，长度 43；两次生成不相等。
        let c1 = gen_pairing_code();
        let c2 = gen_pairing_code();
        assert_eq!(c1.len(), 43);
        assert_ne!(c1, c2);
        let t1 = gen_token();
        assert_eq!(t1.len(), 43);
        assert_ne!(t1, gen_token());
    }

    #[test]
    fn token_plaintext_not_stored() {
        // token 不存明文：devices 里只有 hash；用 token 明文的 hash 才能匹配。
        let a = AuthState::new_with_code("X".into());
        let tok = issue_token(&a, "l".into());
        let stored = a.devices.lock()[0].token_hash;
        // 存的是 SHA-256(tok)，不是 tok 本身。
        assert_eq!(stored, hash_token(&tok));
        // 明文 token 的字节不等于存储的 hash 字节（长度/内容都不同）。
        assert_ne!(tok.as_bytes(), &stored[..]);
    }

    #[test]
    fn rate_limit_blocks_after_threshold() {
        // 连续失败超阈值后被退避拦截：即使给对的码，退避窗口内也拒绝。
        let a = AuthState::new_with_code("RIGHT".into());
        // 前 THRESHOLD 次失败不触发退避（is_blocked 返回 false，比对后失败）。
        for _ in 0..RateLimit::THRESHOLD {
            assert!(!check_pairing(&a, "wrong"));
        }
        // 现已达阈值：紧接着的尝试处于退避窗口（BASE_MS=1s），被直接拒绝。
        assert!(!check_pairing(&a, "RIGHT"));
        // 计数应仍在累加（fail_count > THRESHOLD）。
        assert!(a.fails.lock().fail_count > RateLimit::THRESHOLD);
    }

    #[test]
    fn pairing_reject_wrong_length_no_panic() {
        // 不等长输入必须正确拒绝且不 panic：hash 到定长 32 字节后 ct_eq 不再短路。
        let a = AuthState::new_with_code("SECRETCODE".into());
        assert!(!check_pairing(&a, ""));            // 空字符串
        assert!(!check_pairing(&a, "x"));           // 短于正确码
        assert!(!check_pairing(&a, "SECRETCODE_extra_long_xxxxxxxxxxxxx")); // 长于正确码
        // 正确码在未触发退避的首次检查中应通过（每个 AuthState 独立）。
        let b = AuthState::new_with_code("SECRETCODE".into());
        assert!(check_pairing(&b, "SECRETCODE"));
    }

    #[test]
    fn rotate_invalidates_old_pairing_code() {
        // 轮换后旧码失效、新码生效：验证「一次性配对码」转交项 2 的语义。
        let a = AuthState::new_with_code("OLD".into());
        assert_eq!(current_pairing_code(&a), "OLD");
        rotate_pairing_code(&a);
        let fresh = current_pairing_code(&a);
        assert_ne!(fresh, "OLD"); // 已换新
        assert_eq!(fresh.len(), 43); // 新码为 32 字节 base64url
        // 用一个独立实例避免退避干扰：旧码不再通过，新码通过。
        let b = AuthState::new_with_code("OLD".into());
        rotate_pairing_code(&b);
        let new_code = current_pairing_code(&b);
        assert!(!check_pairing(&b, "OLD")); // 旧码失效
        // 新实例避免上一次失败触发的退避窗口。
        let c = AuthState::new_with_code(new_code.clone());
        assert!(check_pairing(&c, &new_code)); // 新码有效
    }

    #[test]
    fn check_and_rotate_atomic_one_succeeds() {
        // I-2 TOCTOU 修复验证：并发同一旧码只有一个请求能成功（原子比对+轮换）。
        use std::sync::Arc;
        use std::thread;

        let a = Arc::new(AuthState::new_with_code("RACECODE".into()));
        let mut handles = vec![];
        for _ in 0..8 {
            let a_clone = a.clone();
            handles.push(thread::spawn(move || {
                check_and_rotate(&a_clone, "RACECODE")
            }));
        }
        let ok_count = handles
            .into_iter()
            .map(|h| h.join().unwrap()) // into_iter 产 owned JoinHandle，可 join（filter 只给 &h 会 E0507）
            .filter(|&ok| ok)
            .count();
        // 同一旧码并发 8 次，只有 1 次应成功（其余见到轮换后的新码，比对失败）。
        assert_eq!(ok_count, 1, "同一旧码并发只应成功一次，实际成功 {ok_count} 次");
    }

    #[test]
    fn revoke_unknown_id_is_noop() {
        let a = AuthState::new_with_code("C".into());
        let tok = issue_token(&a, "l".into());
        revoke(&a, "does-not-exist");
        assert!(verify_token(&a, &tok)); // 未误删
    }
}
