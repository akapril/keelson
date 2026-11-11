# Agent Note: 移动测试包只上传 Actions Artifact

Status: implemented

## Problem

用户要求在 GitHub 生成移动端测试产物，明确不发布 Release。本机没有配置 Android SDK，因此需要云端验证独立移动 crate 的实际交叉编译。主工作区还含大量无关未提交工作，不可一起推送。

## Decision

移动源码和 mobile-test.yml 位于独立 mobile-android-test 分支，基于 origin/master，仅复制本轮新增移动端文件。工作流在该分支相关 push 时运行，保留 workflow_dispatch，但首次运行不依赖默认分支已存在工作流。

GitHub Ubuntu runner 安装 Java17、Android SDK36、NDK27.2.12479018 和 aarch64-linux-android Rust target。使用锁定依赖与独立构建入口，执行前端/原生测试，再由 Tauri CLI 生成测试 Android 工程和 debug APK。当前不提交自动生成的Android工程，避免未经验证的模板混入；正式开发阶段再固定工程与定制资源。

Artifact 保存14天，包含 APK、SHA256、apksigner验证、aapt包信息和源码SHA。权限为 contents:read，无release/token/签名secret，无打tag或发布步骤。

## Alternatives considered

- 合入master后走已有release流程：复用自动化，但会触发版本管理，与用户“先不发布”的约束冲突。
- 只workflow_dispatch：干净但新工作流尚不在默认分支时不可直接分发；初次使用限定分支push触发。
- 正式签名APK/AAB：可以覆盖安装与商店分发，但本轮只测功能，不引入发布密钥。临时debug签名不同可能需要卸载旧测试版。
- iOS IPA：需要Apple签名配置，当前先生成可安装的Android测试包；不把模拟器App称为iPhone安装包。

## Consequences

不触碰主工作区脏改动，也不修改现有Release。代价是单一ARM64目标、临时签名及Artifact过期；通过编译与签名验证不等于真机运行通过。历史审计：移动架构笔记描述运行时隔离，AppImage笔记描述桌面发布，均与本篇部分相关但不被取代。
