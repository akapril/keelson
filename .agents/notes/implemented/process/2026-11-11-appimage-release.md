# Agent Note: AppImage 发布权限检查

Status: implemented

## Problem

AppImage 目录 PR #6376 在 Firejail 中执行 AppRun.wrapped 时报告 Permission denied。Tauri CLI 2.11.4 的启动器权限为 0770，普通用户自己的 FUSE 挂载会掩盖其他身份无法运行的问题。上游 issue tauri-apps/tauri#16155 报告 2.12 已修复。上次发版的 macos-13 作业排队 24 小时后取消，缺少 Intel Mac 产物。

## Decision

CLI 最低版本提高到 2.12.0，锁文件固定本次解析版本。Intel Mac 使用 macos-15-intel，保持主机架构与 PocketBase 下载脚本一致。发布作业只接受草稿 Release，避免手动补构建覆盖已发布产物。

Linux 构建完成后用 unsquashfs 读取实际 AppImage 的存储权限，要求普通文件对其他用户可读、目录可遍历、拥有者可执行文件对其他用户也可执行。必须发现 AppRun 启动器。检查失败会阻止整个构建成功；产物已上传但仍保留在草稿，发布者必须检查全部平台成功后发布。

## Alternatives considered

预置 0755 的缓存 AppRun 可以保留旧 CLI，且上游已有成功案例；采用升级可以同时使用新版 linuxdeploy，不再维护额外下载路径。仅检查 AppImage 外层 chmod 或以构建用户启动，不能验证内部启动器对其他身份的权限。解压后的权限可能被 runtime 改写，因此检查 SquashFS 原始列表。

## Consequences

增加 squashfs-tools 构建依赖和一个只读检查脚本；无需改业务代码或 Rust 依赖。该检查验证文件权限，不替代 Linux 图形界面启动及目录复测。手动 workflow_dispatch 仍构建所选分支的 HEAD，补构建必须选择与草稿版本一致的源码。

检索现有 .agents/notes 未找到同主题笔记，无需合并历史决定。
