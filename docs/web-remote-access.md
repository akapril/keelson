# Web 远程访问：Tailscale 接入指南

本文说明如何通过 Tailscale 私有网在外部设备（手机、平板、另一台电脑）安全访问本机运行的 Keelson。

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

## 可选方案：Cloudflare Tunnel + Access

如果你有自己的域名，也可以用 Cloudflare Tunnel 暴露本地服务并由 Cloudflare Access 提供额外鉴权：

```bash
cloudflared tunnel --url http://localhost:47700
```

Cloudflare Tunnel 会提供 HTTPS 终结，满足 Secure cookie 要求。配置 Cloudflare Access 后可增加一层 SSO 鉴权（Email OTP 或 GitHub OAuth 等）。

此方案适合需要在更广泛设备上访问且不想使用 Tailscale 的情况，但配置相对复杂，需要 Cloudflare 账号和域名。

---

## 常见问题

**Q: 配对后立刻掉线，循环要求重新配对。**  
A: 大概率是用了明文 `http://` 访问非 localhost 地址，浏览器丢弃了 Secure cookie。请确认使用的是 `tailscale serve` 提供的 `https://` 地址。

**Q: `tailscale serve` 命令提示权限错误。**  
A: 在 Windows 上 `tailscale serve` 可能需要管理员权限——用管理员身份打开终端后重试，或在 Tailscale 图形界面的 Serve 标签页里配置。**切勿改用 `--tcp` 透传模式**：它不做 HTTPS 终结、无法承载浏览器 Secure cookie，配对仍会掉线；务必用上文的 `tailscale serve https / http://localhost:47700`（HTTPS 终结）。

**Q: 手机访问提示「无法连接」。**  
A: 确认手机上的 Tailscale 已登录同一账号且状态为「已连接」。可在手机 Tailscale 应用的设备列表里确认本机是否可见。

**Q: 配对码在哪里？**  
A: Keelson 设置页 → Web 远程访问 → 网关开启后，配对码显示在「配对码」区块。
