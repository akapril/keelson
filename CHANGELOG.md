# Changelog

## [0.3.0](https://github.com/akapril/keelson/compare/v0.2.0...v0.3.0) (2026-08-12)


### Features

* **auth:** 用户菜单/登出按模式门控, 本地免登录隐藏防锁死 ([c393f70](https://github.com/akapril/keelson/commit/c393f704111bfa12e47d8f7a32d5b3990f17f934))
* LoginScreen 逃生入口(Logo+切回本地) + Dashboard 首次 MCP 引导卡 ([5863de2](https://github.com/akapril/keelson/commit/5863de292ea12f5d4413f7c65106c5f2e729dbb6))
* **packaging:** 一键安装脚本 + winget CI + scoop/aur 清单骨架 ([3ba9abd](https://github.com/akapril/keelson/commit/3ba9abd89a362de8236a4a22f8232b19bbf1465a))
* **process:** 进程可重命名/备注 + 启动失败不再假成功 + 同名已退出记录覆盖重跑 ([e91d719](https://github.com/akapril/keelson/commit/e91d7199746140535c13d9e6ba0d582b57a978e9))
* **reading:** 支持粘贴正文做 AI 摘要(登录墙/付费墙/JS渲染站) ([5b7972d](https://github.com/akapril/keelson/commit/5b7972d3b6bfb586fe6c5aa6cb9a306d0814c245))
* **reading:** 详情打开时预填已存正文, 登录墙条目重新摘要免再粘(方案B) ([ffe36c2](https://github.com/akapril/keelson/commit/ffe36c26921fda9c6a84ae33a50ba8148f54be60))
* **sessions:** Codex 会话文件改动视图(apply_patch 解析) ([4f30990](https://github.com/akapril/keelson/commit/4f309907a7e2e81c2a6e22024132d7c8386bd6c0))
* **settings:** 开机自启 + PocketBase 日志保留天数/清空(回收磁盘) ([ac1213e](https://github.com/akapril/keelson/commit/ac1213ef5704b15a96eeaaa564085a7940fa13da))
* **sync:** collections 加 NOT_DELETED/combineFilters/softDeleteRecord, deleteRecord 改软删 ([b76cf2d](https://github.com/akapril/keelson/commit/b76cf2d844552c954d2a41c5689eab191d580dd5))
* **sync:** deleteProject 改应用层级联软删(状态/标签/成员/任务) ([c41f69e](https://github.com/akapril/keelson/commit/c41f69e2254e2814119fc4735a8d3d0b322c1b18))
* **sync:** MCP 查询注入 deleted_at 过滤(项目/状态/任务/文档/记忆) ([a7e930b](https://github.com/akapril/keelson/commit/a7e930baf9b4b8829ff4b9297be05603fd6282b2))
* **sync:** reading/calendar/memory/prompts/docs 删除改软删 ([4287043](https://github.com/akapril/keelson/commit/428704385dbff84de43e704f40f392267b33dab8))
* **sync:** 同步集合读取路径注入 NOT_DELETED 过滤 ([1476705](https://github.com/akapril/keelson/commit/1476705a33f980c95364b84619e741b341de1853))
* **sync:** 实时订阅把带 deleted_at 的 update 当删除处理 ([a263e38](https://github.com/akapril/keelson/commit/a263e38f989fcb222e8db4d9aed3e1be9546849b))
* **sync:** 迁移给 12 个同步集合加 deleted_at tombstone 字段 ([e492079](https://github.com/akapril/keelson/commit/e492079cfa469273bc21f18b67553b74d41035b5))
* **updater:** 每 6 小时定时静默复查更新 ([b74025d](https://github.com/akapril/keelson/commit/b74025db33df34437f5de00ca087e7ad4ded37ad))
* **web:** 设置里把配对码渲染成二维码, 移动端扫码取码免手输 ([877cb62](https://github.com/akapril/keelson/commit/877cb621c25bdeb2602b9aabc241c912367d104b))
* **web:** 配对码自动刷新 + 设备改名/吊销改图标 + 列表滚动 ([bd00e8c](https://github.com/akapril/keelson/commit/bd00e8c57502fa7cb0366052c422b39538b5f7fa))
* **web:** 配对设备按 User-Agent 自动命名 + 设置里可改名 ([c9591b3](https://github.com/akapril/keelson/commit/c9591b392bc23be6d60f5509f9d6ee047ff6c95a))
* **web:** 配对页加"扫描二维码"按钮, 手机扫桌面配对码即连 ([7d83621](https://github.com/akapril/keelson/commit/7d836214c8d86fb693ede380807c643138af70f6))


### Bug Fixes

* **ai:** openai_body 显式 max_tokens=4096, 修 OpenAI 兼容 provider 截断 ([39cdb16](https://github.com/akapril/keelson/commit/39cdb16eddbfe845ff0528a1478847446ec36939))
* **config:** 补全 save_and_load_roundtrip 测试的 AppConfig 字段 ([69c412e](https://github.com/akapril/keelson/commit/69c412e9c34df31699f9ceb2c395d42460934edc))
* **i18n:** 语言默认跟随系统 ([f8ec5ed](https://github.com/akapril/keelson/commit/f8ec5ed261fe50dc07bfd016179e4313374920aa))
* **pb:** 启动前清理残留 PocketBase + upsert 超时兜底 + 初始化错误落日志 ([165d004](https://github.com/akapril/keelson/commit/165d004a32183f6b6ab861edef12b3c4869ec41e))
* **reading:** 无摘要/备注的条目也能点开详情 ([1440f9f](https://github.com/akapril/keelson/commit/1440f9f2dcbc4591a682f27be7e01b6a9856665e))
* **reading:** 粘贴即存(AI前乐观落库)+空摘要兜底 ([c47c723](https://github.com/akapril/keelson/commit/c47c72306117210ff8f7361c3a271238e51f374a))
* **reading:** 解析失败时捞出 summary 文本, 不再把原始 JSON 当摘要 ([73a4006](https://github.com/akapril/keelson/commit/73a4006a0e2790250a20f31584c9bfc87ccfd9f7))
* **sync:** board deleteRecord 改软删(补 Task2 漏改, 函数在 board.ts 非 collections.ts) ([693a51e](https://github.com/akapril/keelson/commit/693a51e1bd7be652986ae4d2be29c4d11ad0e141))
* **sync:** listMembers 补 NOT_DELETED 过滤(同步集合读取一致性) ([ecd4303](https://github.com/akapril/keelson/commit/ecd4303d759f2e62db4a8d5316572f47e23a0df9))
* **ui:** report 下拉改 shadcn Select(跨平台一致) + 首页去接入精确定位 MCP 区 ([eaa21fe](https://github.com/akapril/keelson/commit/eaa21fee12428d04c5eeafab8cfbf9c70fe718d1))
* **ui:** 侧栏分组标题滚动时钉顶(sticky) ([23599de](https://github.com/akapril/keelson/commit/23599de1ea7b6134a11ab7848c4f5d5f2cb00533))
* **web:** iOS 终端重连死循环/持久登录 + codex 启动修复 ([b24b79e](https://github.com/akapril/keelson/commit/b24b79e82915b571ce60c6371ac6d030a98a8f24))
* **win:** 子进程隐藏控制台窗口，消除打包后黑窗闪现 ([2adb981](https://github.com/akapril/keelson/commit/2adb98167ed60b9be81bbfc41bb904966825501b))


### Performance Improvements

* **reading:** 阅读列表 virtua 虚拟化, 条目多不卡 ([8e33f9f](https://github.com/akapril/keelson/commit/8e33f9fef2a78695fca42d3d5d554f15bce937d7))
