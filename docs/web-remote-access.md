# Web 远程访问 接入指南

本文说明如何在外部设备（手机、平板、另一台电脑）安全访问本机运行的 Keelson——可选 **Tailscale 私有网**（推荐，安全）或 **公网隧道**（Cloudflare Tunnel / ngrok，方便）。下文先讲 Tailscale，公网隧道见后面的「公网隧道」一节。

---

## 安全须知（必读）

> **外网入口必须经过 HTTPS 终结，不可直接使用明文 HTTP 访问。**
>
> Keelson Web 网关使用 `Secure` 属性的 cookie 保持登录态。浏览器对非 localhost 地址的明文 `http://` 连接会**静默丢弃** Secure cookie——配对成功后立即掉线，症状极具迷惑性。
>
> 正确做法：通过 `tailscale serve` 在 tailnet 内暴露 HTTPS 终结点（见下文步骤 4）。
>
> **本机 `http://localhost:47700` 是安全上下文例外，不受此限制，可直接用于本机调试。**

**双层安全防护：**

1. **Tailscale 私有网**：只有你用同一账号登录的设备才能访问 tailnet 内的地址，无法从公网直接到达。
2. **应用配对 token**：即使在 tailnet 内，外部设备也需完成一次配对（输入配对码）才能访问，后续用 token 鉴权。

**警告：** Keelson 远程终端可在本机执行任意命令。务必只在受信设备上完成配对；如设备丢失，立即在设置页吊销对应设备的 token。

---

## 能远程做什么 · 按能力开关

远程端是**移动优先**的响应式界面（底栏可长按拖拽排序），可用能力：

- **多终端**——跑并续接 `claude` / `codex`；PTY 刷新不断线（环形缓冲回放）、断网 / 回前台自动重连、支持搜索 / 粘贴 / 字号调节、长按选择复制。
- **工作台会话**——本机 CLI 会话列表，点开即在远程终端接续。
- **看板 / 日历 / 文档**——浏览与编辑（经 PocketBase 同源反代）；日历支持「记一笔」快录与到点提醒。
- **会话记录**——读某会话的完整对话（原生可选择、整段复制）——在手机上翻 `claude` 历史的正确来源。
- **通知**——收件箱只读。

**逐项开关（设置 → Web 远程访问 → 功能）：** 每个能力都能单独开 / 关，敏感项默认关。开关是**双重门控**：

- **前端隐藏**——关掉的 tab 在远程界面直接不显示；
- **后端强制**——网关按路由 / PocketBase 集合拒绝：关掉的能力，外部设备**直连也拿不到**，不只是藏起来。

> 建议：不需要远程跑命令时，把**终端**开关关掉——这是最敏感的一项（远程 shell）。

---

## 准备工作

**需要安装 Tailscale 的设备：**

- **本机**（运行 Keelson 的电脑）
- **远程设备**（手机、平板或另一台电脑）

两台设备必须登录**同一个 Tailscale 账号**，才能互相访问。

### 安装 Tailscale

| 平台 | 获取方式 |
|------|----------|
| Windows / macOS / Linux | [tailscale.com/download](https://tailscale.com/download) |
| iOS | App Store 搜索「Tailscale」 |
| Android | Google Play 搜索「Tailscale」|

安装后登录同一账号，两台设备会出现在同一个 tailnet 里。

---

## 接入步骤

### 步骤 1：启动 Keelson 并开启远程访问

1. 打开 Keelson 桌面应用。
2. 进入 **设置 → Web 远程访问**。
3. 点击「启动」，网关会绑定本机 `0.0.0.0:47700`。
4. 页面显示**配对码**，备用。

### 步骤 2：通过 tailscale serve 暴露 HTTPS 终结点

在本机（运行 Keelson 的电脑）打开终端，执行：

```bash
tailscale serve https / http://localhost:47700
```

此命令让 Tailscale 在 tailnet 内以 **HTTPS** 方式暴露本机的 47700 端口。  
Tailscale 会自动管理 TLS 证书，无需手动配置。

执行后，你可以通过以下命令查看暴露的地址：

```bash
tailscale serve status
```

输出示例：

```
https://<机器名>.<tailnet-name>.ts.net
  / -> http://127.0.0.1:47700
```

记下这个 `https://` 地址。

> **为什么不能用 `http://<tailscale-ip>:47700`？**  
> 明文 HTTP 连接会导致浏览器丢弃 Secure cookie，配对成功后立即掉线。必须使用 `tailscale serve` 提供的 HTTPS 终结。

### 步骤 3：在远程设备上完成配对

1. 在远程设备（手机/平板）确认 Tailscale 已登录且已连接。
2. 打开浏览器，访问步骤 2 中得到的 `https://<机器名>.<tailnet-name>.ts.net`。
3. 首次访问会跳转到配对页，输入步骤 1 中在设置页看到的**配对码**。
4. 配对成功，后续同一设备无需再次输入配对码。

### 步骤 4：管理已配对设备

- 在 **设置 → Web 远程访问 → 已配对设备** 查看所有已配对设备及配对时间。
- 点击「吊销」立即使该设备的 token 失效，设备需重新配对。
- 点击「重新生成」轮换配对码（不影响已配对设备），用于下一台设备配对或在怀疑配对码泄露时使用。

---

## 关闭 tailscale serve

当不需要外网访问时，可关闭 HTTPS 终结点：

```bash
tailscale serve https / off
```

也可以在 Keelson 设置页点「停止」，这会关闭网关（`tailscale serve` 终结点仍然存在但无服务可转发）。

---

## 本机快速验证

不需要 Tailscale 即可验证 Web 端功能：

1. Keelson 设置页启动网关（端口 47700）。
2. 本机浏览器打开 `http://localhost:47700`。
3. 输入配对码完成配对。

`localhost` 属于浏览器安全上下文例外，Secure cookie 可以正常工作，不受 HTTPS 限制。

---

## 公网隧道（Cloudflare Tunnel / ngrok）

不想用 Tailscale、或想让更多设备临时可达时，可用公网隧道把本机 47700 暴露成一个**公网 HTTPS 地址**（隧道边缘自动终结 TLS，天然满足 Secure cookie）。**Keelson 无需任何配置改动**——网关不校验 Host、终端 WebSocket 也能穿隧道。

### Cloudflare Tunnel（推荐，免费）

**快速隧道（免账号、免域名，临时地址）：**

```bash
# 先在 Keelson 设置里开启 Web 网关(47700)，然后：
cloudflared tunnel --url http://localhost:47700
```

立刻得到一个 `https://<随机>.trycloudflare.com` 地址，手机打开即可扫码/输码配对。地址是临时的，进程一关即失效——适合临时使用。

**命名隧道（需 Cloudflare 账号 + 域名，地址稳定）：** 绑到你自己的子域名，长期可用（配置见 Cloudflare 文档）。

### ngrok（最省事）

```bash
ngrok http 47700
```

免费版给随机 HTTPS 地址（有会话时长 / 警告页等限制）。

### ⚠️ 公网暴露的安全须知（重要）

配对码是 **256 位 CSPRNG**（`src-tauri/src/web/auth.rs` 的 `gen_pairing_code`），暴力猜解在密码学上不可行——所以"未授权配对"这一关本身很硬。但仍需注意：

- **这是能在本机执行任意命令的服务**。公网 = 网关对全互联网开放，配对码是**唯一**那道闸；任何预授权层的漏洞、或配对码 / 隧道地址泄露（二维码被拍到、地址进了浏览器历史或日志），后果都是整机沦陷。私有网（Tailscale）多一层网络隔离作纵深。
- **务必**：用完即关隧道（快速隧道关进程即失效）；不用时在 **设置 → 已配对设备** 里**吊销 token**；别把隧道地址 / 配对二维码外泄。
- **长期或经常公网使用**：强烈建议在隧道前加一层 **Cloudflare Access**（免费，Email OTP / SSO），把"单个秘密守 shell"变成"登录闸 + 秘密"两层，补回纵深防御。

一句话：**码够强，临时自用、用完即关是可以的；但要长期公网，请前置 Cloudflare Access，别让单一秘密长期独扛。**

---

## 常见问题

**Q: 配对后立刻掉线，循环要求重新配对。**  
A: 大概率是用了明文 `http://` 访问非 localhost 地址，浏览器丢弃了 Secure cookie。请确认使用的是 `tailscale serve` 提供的 `https://` 地址。

**Q: `tailscale serve` 命令提示权限错误。**  
A: 在 Windows 上 `tailscale serve` 可能需要管理员权限——用管理员身份打开终端后重试，或在 Tailscale 图形界面的 Serve 标签页里配置。**切勿改用 `--tcp` 透传模式**：它不做 HTTPS 终结、无法承载浏览器 Secure cookie，配对仍会掉线；务必用上文的 `tailscale serve https / http://localhost:47700`（HTTPS 终结）。

**Q: 手机访问提示「无法连接」。**  
A: 确认手机上的 Tailscale 已登录同一账号且状态为「已连接」。可在手机 Tailscale 应用的设备列表里确认本机是否可见。

**Q: 配对码在哪里？**  
A: Keelson 设置页 → Web 远程访问 → 网关开启后，配对码显示在「配对码」区块（含二维码，移动端可扫码）。

**Q: 可以不用 Tailscale 吗？**  
A: 可以，用公网隧道（Cloudflare Tunnel / ngrok，见上文「公网隧道」节）——Keelson 无需改动。但那是把服务暴露到公网，务必读该节的安全须知：临时自用、用完即关、吊销 token；长期用请前置 Cloudflare Access。

**Q: 怎么只开放一部分能力（比如只看日历、不给终端）？**  
A: 设置 → Web 远程访问 → **功能**，逐项开 / 关（看板 / 日历 / 文档 / 终端…）。关掉的能力前端不显示、后端也拒绝直连请求（双重门控），敏感项默认关。最省心的做法：平时把**终端**关掉，需要远程跑命令时再临时打开。
