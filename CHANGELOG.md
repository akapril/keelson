# Changelog

## [0.8.0](https://github.com/akapril/keelson/compare/v0.7.0...v0.8.0) (2026-09-04)


### Features

* **agent:** agent_stop 中止运行中的agent(协作式取消:executor select超时/中止信号,靠kill_on_drop杀子进程,run置blocked已手动中止)+running态停止按钮;AppState加task_id→Notify注册表 ([6cbc1ae](https://github.com/akapril/keelson/commit/6cbc1ae9d2b62a7c74c610095fd8502ff028f68b))
* **agent:** AgentRunPanel美化(状态徽标走statusTone与看板同源/头部队友名突出+状态+元信息分层/running态加已耗时计时器打消卡了没的疑虑) ([0ed9ab7](https://github.com/akapril/keelson/commit/0ed9ab7cea1fe0fdd394d02d7f82d1c9716f917a))
* **board+docs:** 移动端响应式——board/docs/工作台容器 p-3、页头换行收紧;工作台8个tab的TabsList窄屏横向滚动(不再挤爆) ([16fbaa5](https://github.com/akapril/keelson/commit/16fbaa516110b2b4d7800aa7673c846c01cfd55e))
* **board:** 任务删除即撤销(toast 内一键反写 deleted_at 恢复,6s) ([f944add](https://github.com/akapril/keelson/commit/f944add2813ffffbbcb77e4800683e731a600147))
* **board:** 列内联快速加任务(输入即建·Enter续输·Esc收起;泳道/多选禁用) ([bb1e834](https://github.com/akapril/keelson/commit/bb1e8346f04ccdc670038758920ef14c71455101))
* **board:** 新建对话框自动聚焦首字段 + Enter 提交(TaskSheet 仅新建) ([2647079](https://github.com/akapril/keelson/commit/264707943717ea129088632d8d9663c98a7acf68))
* **board:** 看板快录丝滑(QuickAdd回车瞬间清空非阻塞不冻输入+createTask乐观插卡后台对账失败回滚)——连录如流水、卡片秒现、rank不乱序 ([01b6769](https://github.com/akapril/keelson/commit/01b67693e2d750ca05d31e7b5f62f0c7ddb42a5b))
* **calendar:** 今日活动可点跳转(会话→深链/任务→项目看板/提交→关联会话)——只读汇入变成通往源头的入口 ([e849a8b](https://github.com/akapril/keelson/commit/e849a8b7e8ca192edea9ea53597f5397f39b8098))
* **calendar:** 快录/⌘K 支持中文自然语言(明天下午3点/下周一/1小时/半小时…自动解析日期时刻时长)——parseQuickLog 扩展纯解析器+6测,零新依赖,未识别不破坏纯手填 ([4b74ed4](https://github.com/akapril/keelson/commit/4b74ed4f13812c60b602e85ff06debeaacfe764f))
* **calendar:** 快录支持 @项目 自动关联(parseQuickLog 纯函数+5测)+命令面板⌘K「记一笔」全局捕获(输入词以此刻建条·不用切到日历页) ([3e17bdc](https://github.com/akapril/keelson/commit/3e17bdcabc617ab98b40c1aff8db295e7cd1615c))
* **calendar:** 新增「回顾」视图——近30天活动热力图(GitHub贡献图式)+按类型总览+按项目占比;review-stats纯函数(3个+4测)复用collectMaterial采集层 ([28f360b](https://github.com/akapril/keelson/commit/28f360b579fa5e2feae02d9acab6ec34fe132ad9))
* **calendar:** 新建事件弹窗提速——标题改多行Textarea(可换行·承载记录内容·⌘/Ctrl+Enter保存)+结束时刻自动=开始+1h(新建默认+改开始时自动跟上)+标题自动聚焦 ([6526e40](https://github.com/akapril/keelson/commit/6526e4098b27d503e077070f3a5d7827805d2fc0))
* **calendar:** 日历当日记本化——新建自动填当前时刻+Toggl式快速记录条(议程/日视图回车即以此刻建条)+议程显示描述预览+月视图标题放宽两行(不再逼你把内容全挤进单行标题) ([b43388e](https://github.com/akapril/keelson/commit/b43388ebb1c39c41587969180c64f0832d67c9d6))
* **calendar:** 月视图每格事件超3条折叠为「+N 更多」→点击跳该天日视图(此前 overflow-hidden 把超出事件静默裁掉·两行标题后更严重) ([3501c60](https://github.com/akapril/keelson/commit/3501c609e6401cbb6bf457b41c7a31f2af45b7f1))
* **calendar:** 移动端更友好——头部窄屏换行/收紧间距/标题缩小·视图切换器横向滚动·容器 p-3;无历史偏好时窄屏默认落议程列表(月网格在手机太挤) ([124b565](https://github.com/akapril/keelson/commit/124b5651803bff9fa82d9e1190a450997993bac1))
* **calendar:** 自然语言到点提醒（关着也提醒）——含「提醒」意图才通知,纯流水账静默;parseQuickLog 识别提醒意图+computeRemindAt 算UTC秒级ISO;calendar_events 加 remind_at/reminded(迁移);Rust 后台 worker 每30s轮询到点未提醒事件→系统通知(OS级/托盘可见)+收件箱+标记去重;新增「日程提醒」通知来源可开关 ([471126b](https://github.com/akapril/keelson/commit/471126b353b6d28e31b2a496a5086e53f572ea41))
* **calendar:** 议程视图自动汇入「今日活动」(今天的提交/完成任务/会话只读展示)——把 generateReport 采集层抽成纯函数 collectMaterial 与 AI 日报共用 ([ec30589](https://github.com/akapril/keelson/commit/ec305891adbd68a41956bf35e299bac0161fd4ee))
* **dashboard:** 无数据的截止/事件/阅读面板折叠成一行入口(恒空面板本身是缺陷,多数任务不设截止) ([42460aa](https://github.com/akapril/keelson/commit/42460aa0c6a86ee3c06dd8b4353b8f7f9d90c04c))
* **dashboard:** 近期会话行 hover 一键接续箭头(对齐侧栏收藏行) ([fc4b24f](https://github.com/akapril/keelson/commit/fc4b24f8568f2b6fd70bc088b2a06f5f1e6dfebb))
* **mcp:** 对外触角补齐(create_task/update_task 支持 enqueue 派agent自主执行/get_doc只读消除盲覆盖/get_session放开provider全6家)+PB list翻页消除超500静默丢数据+resolve_project_id过滤软删 ([70b7013](https://github.com/akapril/keelson/commit/70b70131a6f81255b16bcf131961c4389fa9aa65))
* **memory:** 记忆卡露出创建时间(解「无时间戳致旧决定伪装永久真理」)+待审区全部采纳/丢弃批量 ([03e5d8b](https://github.com/akapril/keelson/commit/03e5d8b1b2b0c9e5e647effa14f0852fbef29cc9))
* **report:** 加「今天」时间范围preset+报告页按钮+命令面板⌘K「今天回顾」一键触发AI日报(复用report-job后台任务·跳报告页看进度) ([c4033ee](https://github.com/akapril/keelson/commit/c4033eeb828533f99f17aa5600f5b7890462d224))
* **sessions:** 会话一键接续(记住新窗/标签偏好),去掉恢复弹窗;换模式走卡片右键 ([e8f37cb](https://github.com/akapril/keelson/commit/e8f37cb89b8d9aa3cd7d7b01590604e9557d26ac))
* **sessions:** 会话列表加时间范围过滤chip(全部/本周/上周/近30天,按updated_at收窄,复用computeRange)——忘词也能翻旧账 ([c0d11ff](https://github.com/akapril/keelson/commit/c0d11ff07d20d05b37197ed5abcd185a8f81f590))
* **sessions:** 进会话中枢自动选中最近一条 + 空库给接入 MCP 的 CTA ([a99fd09](https://github.com/akapril/keelson/commit/a99fd0984e5dff44e4cd757dc5b4ceac511bbdf0))
* **shell:** ? 全局快捷键速查表(命令面板/Spotlight 键位索引) ([5f84b68](https://github.com/akapril/keelson/commit/5f84b6865bb42e858a84945e732efa05776ce830))
* **shell:** ⌘K 加任务分组(跨项目直达)+会话深搜桥(命中不足时跳/sessions触发全文检索) ([e146115](https://github.com/akapril/keelson/commit/e146115cdc047d72dec2b9c7038a72c906ee56a2))
* **shell:** ⌘K 面板升级(动作组:继续上次/切主题/设置/MCP + 最近项 MRU 快速切换) ([84e424d](https://github.com/akapril/keelson/commit/84e424df298b153ab1cdf3bfbcd77fc6a7afae7f))
* **shell:** g 前缀直达导航(g+页面键,IME/修饰键守卫,无定时器)+? 表列出 ([7db3d53](https://github.com/akapril/keelson/commit/7db3d5328561a64441fad7a6c9a29d93938b1190))
* **sidebar:** 「更多」里的页面可拖进自定义「常用」组置顶(跨容器DnD·localStorage持久化·组内拖排序·行内×移除·空组拖拽时浮现虚线放置区引导) ([6243852](https://github.com/akapril/keelson/commit/6243852ec2a77948c25ea54a6c3efdd8d06de7c0))
* **sidebar:** 收藏(固定项目)组支持折叠(默认展开,记住状态) ([d2db47e](https://github.com/akapril/keelson/commit/d2db47e4e3b1e2ed1f9c2af96dac2bdd01fee854))
* **terminal:** 启用 WebGL 硬件加速渲染——加 @xterm/addon-webgl,共享 loadWebglRenderer(open 后加载/不支持静默回退DOM/onContextLoss自动dispose),web+桌面两端终端整帧重绘与滚动大幅提速(缓解移动端不丝滑) ([88725e3](https://github.com/akapril/keelson/commit/88725e3de45d93b1532a0b522053ad57d0d8770d))
* **ui:** AgentRunPanel加宽480→640+补横向内边距(原内容贴边)+区块间距;看板快录加淡提示「↵添加下一个·Esc关闭」让连续录入可发现 ([fc8c195](https://github.com/akapril/keelson/commit/fc8c195315c04baf06f148a1fe47042ab0deef88))
* **ui:** P2收尾(文档条目减重修层级倒挂/会话卡动作hover揭示/任务卡页脚左右簇去ml-auto/看板工具条同形同高/text-2xs token采纳) ([751a055](https://github.com/akapril/keelson/commit/751a055ddd3aa20e88aa67a9de11f0a381a58a42))
* **ui:** 日期人性化(截止逾期/今天/明天+相对时间hover本地化)+加载骨架(会话列表/看板项目卡) ([229bf1b](https://github.com/akapril/keelson/commit/229bf1b4ef9cfc64dfba2358624464e0cf1aec4d))
* **ui:** 视觉P1批(focusRing统一键盘焦点环/仪表盘假空态骨架/会话卡内容层级+选中token+去双截断/预览按钮墙立主次/provider label去哈希/删sonner死类) ([ff1b6fd](https://github.com/akapril/keelson/commit/ff1b6fd0cbef6176a00fcb7e94d232fd0454e2a7))
* **ui:** 设计系统地基(--text-2xs token/reduced-motion基线/Badge加xs尺寸/statusTone单一色调收编TaskCard/卡片表面统一rounded-xl+border/收藏星标改Hugeicons) ([c602cc4](https://github.com/akapril/keelson/commit/c602cc406158feff70bb1f789c48f6ae57d83da5))
* **ux:** 体验快赢批(会话空态改重扫不再误导接入MCP/合并toast带merge短sha+revert提示/agents-inbox空态价值化/周报重复生成问替换还是另存) ([65f1be3](https://github.com/akapril/keelson/commit/65f1be3799ee5a52b049ef7be62c5c3581cad435))
* **web-terminal:** 刷新不断——分离式终端:PTY常驻抽取线程drain到环形缓冲(512KB)+broadcast,独立于WS(agent不再因断连stdout满而卡死);WS重连attach回放历史快照+订阅实时(push+send与subscribe+snapshot同锁原子,无缝无重复);前端记住tab+会话刷新自动重连 ([fb5b7bf](https://github.com/akapril/keelson/commit/fb5b7bfd85c0785d042b4ba9d4371290032a2022))
* **web-terminal:** 加「📋查看/复制」文本浮层——倒出终端缓冲(普通屏含回滚全历史/备用屏可见屏)为纯文本,原生平滑滚动+长按选择+复制全部,绕开canvas触摸选区之难 ([a96a69a](https://github.com/akapril/keelson/commit/a96a69a4b808ec334f25d6378c7bda1e2a508acf))
* **web-terminal:** 可点链接+搜索+键条增强+退出重启——createXtermCore 接 addon-web-links(web:window.open)/addon-search(回滚查找高亮);面板加搜索栏(输入即高亮/↑↓/Esc);键条加粘贴(读剪贴板)+字号±(重新fit并同步PTY)+Home/End/PgUp/PgDn/Ctrl-L/Ctrl-Z;进程退出后一键重启(重挂重连resume同会话) ([3c90f06](https://github.com/akapril/keelson/commit/3c90f06ec555c5a328d8c810fbe06cb431a243fe))
* **web-terminal:** 图标统一+复制粘贴体验——emoji 换内联描边SVG(对齐WebApp TabIcon风格,新增icons图标集);移动端去📋按钮改长按终端(≥500ms不动)开可选文本层+触感反馈;PC选中即复制(mouseup写剪贴板)+右键粘贴(拦contextmenu读剪贴板送stdin,不再弹浏览器菜单) ([2da22f1](https://github.com/akapril/keelson/commit/2da22f12d41e66796ce2b12834e40eb09b1410b8))
* **web-terminal:** 多 tab 终端——工作台可开多个会话终端并列 tab 切换,各自独立WS/PTY常驻挂载不断线;tab栏移动端横向滚动;打开列表+活动id持久化,刷新逐个重连回放 ([721d4f6](https://github.com/akapril/keelson/commit/721d4f636abb6fd311531a79810acd4307ded08b))
* **web-terminal:** 移动端断连韧性——回前台(visibilitychange)/网络恢复(online)立即重连并重置退避(不受8次上限封顶),20s 心跳 ping 保活防 NAT 空闲断连;监听随 close 解绑 ([8eb5261](https://github.com/akapril/keelson/commit/8eb526120e7e080e66020f5a02b631a09e736930))
* **web-terminal:** 移动端点终端不再自动弹键盘挡界面——隐藏输入框默认 inputmode=none(可聚焦滚动不召唤软键盘),键条加「⌨键盘」按钮显式弹出,失焦复位 ([0921c2e](https://github.com/akapril/keelson/commit/0921c2eb823fbb889e887e28e492452d4d8cc3e0))
* **web:** web 远程加「日历」tab——复用桌面 CalendarPage(MemoryRouter 兜路由依赖);事件走PB·今日活动/回顾走/api/git_log,web端日历全功能可用 ([f48d9ce](https://github.com/akapril/keelson/commit/f48d9ceb8400ea82b20049c82c4d52a3f7e54386))
* **web:** web 远程加「看板」「文档」tab——复用桌面 Board/DocsPage(MemoryRouter配内部路由);纯PB两端通用,看板任务/文档增删改可用(项目工作台git/终端子tab在web降级) ([02c237d](https://github.com/akapril/keelson/commit/02c237df119e8a28fa6e3f49dbe844598c66d380))
* **web:** web 远程访问功能开关框架——WebFeatures(sessions/activity/ai)按能力门控网关/api·敏感默认关;新增 /api/git_log(activity门控)让 web 日历今日活动/回顾可用;bootstrap 回传 features 前端自适应;设置页开关组(ai 占位) ([7208a86](https://github.com/akapril/keelson/commit/7208a867f9335cef79edc108c5b5f7bee6cd38cb))
* **web:** 会话记录查看器——新增 /api/sessions_timeline(sessions门控/spawn_blocking读jsonl/复用provider registry分派)+web端SessionTranscript只读浮层(读完整对话/气泡展示/复制全部);工作台每会话加📄记录入口;claude历史复制的正解(完整干净可选) ([318deb3](https://github.com/akapril/keelson/commit/318deb326ea36ad9219ce9f062dff606217e91a4))
* **web:** 功能开关补全+真生效——WebFeatures 加 board/calendar/docs/terminal(每 tab 一个开关,工作台基础常驻);前端按开关隐藏 tab(侧栏/底栏/回落工作台);后端强制(纵深):/ws/terminal 按 terminal 拒绝、/pb 反代按集合门控(calendar_events→calendar/board_*→board/docs→docs,认证/realtime/通知放行);设置页列全开关+i18n ([8931a67](https://github.com/akapril/keelson/commit/8931a67bbb4a52c6f6f604e822cc70bdf05d1d4e))
* **web:** 布局重构——通知/设置移顶栏右上(通知带未读徽标),内容5tab独立主导航;移动底栏去掉「更多」溢出(5个正好放下)且长按可拖拽排序(dnd-kit,顺序持久化);抽 tabs.tsx 共享 tab 定义/图标避免循环依赖 ([597a625](https://github.com/akapril/keelson/commit/597a6258ff8150ae2714f113de4f4af001066b1a))
* **web:** 移动端更顺——文档编辑器容器 p-3(TOC本就移动端隐藏);底栏7tab收纳为「工作台/看板/日历/文档 + 更多(终端/通知/设置)」不再挤 ([bd67737](https://github.com/akapril/keelson/commit/bd67737c77138332b7c2cbf50512a34447769c62))


### Bug Fixes

* **agent:** worker/MCP派发run实时日志打通(此前|_piece|{}丢日志致面板永久「执行中,等待输出…」假象)——emit agent-run-log全局事件+前端桥接append日志store ([254415c](https://github.com/akapril/keelson/commit/254415c26af9af106857d6d80941b61015989a72))
* **agent:** 合并脏工区自动stash/pop(免逼先提交无关改动)+真冲突给可操作出口(列冲突文件·打开worktree·rebase解决命令)而非甩手动处理 ([350def1](https://github.com/akapril/keelson/commit/350def1c60343d06f8ac457480bf7f18b01db1d4))
* **agent:** 合并闭环信任地基(判定计入领先提交解合并封锁/冲突兜底回滚不留半合并态/重派前保命提交/agent_run_diff只读审阅patch) ([174ec75](https://github.com/akapril/keelson/commit/174ec758a69bcb6f70ff04f8aff4618516388450))
* **agent:** 独立迁移补 agent_runs.base_branch(老库改已应用迁移不生效)+写入不再吞错 ([eacb582](https://github.com/akapril/keelson/commit/eacb582817f3d19fce940e2f166dfe81a325cd4f))
* **board:** 近期事件只显示设了提醒的日程——流水账(记'刚才做了什么'、无 remind_at)不再挤进项目概览'近期事件' ([04d812f](https://github.com/akapril/keelson/commit/04d812f79266027cfe048f78fd7109d89cb4323f))
* **calendar:** 「+N 更多」原在 overflow-hidden 容器内被裁掉点不到——移到滚动区外作格子底部常驻脚注,恢复跳日视图 ([e799e25](https://github.com/akapril/keelson/commit/e799e25e08172a3a3c457cbdf8c4ea660c8863f4))
* **dashboard:** 首页「近期事件」也只显示设了提醒的日程——上次只改了项目概览,漏了首页 dashboard 这处(仍按 end&gt;=今天显示所有事件,故还能看到流水账历史);统计卡口径一并对齐 ([1ec1cef](https://github.com/akapril/keelson/commit/1ec1cef82727e766ddedcf4966752d0b0b6717d1))
* **docs:** 文档图片重启后图裂(存绝对URL含随机端口,重启端口变即失效)——改存端口无关相对路径+渲染归一到当前baseURL,自动修复历史文档无需迁移 ([8f2f5cf](https://github.com/akapril/keelson/commit/8f2f5cf7a267fee48148e8e232ba112dbd10b059))
* **fs:** open_path 在 Windows 归一正斜杠为反斜杠(explorer 遇正斜杠静默打不开——agent worktree 等 PB 存储路径带正斜杠时'打开目录'哑火) ([5c294cb](https://github.com/akapril/keelson/commit/5c294cb5601525d3508bf0c75fc64a47df1229e3))
* **notifications:** 日历活动记录刷爆收件箱——移除对日历事件的截止提醒(日历现为活动流水账=过去时,对 start&lt;=今天的事件逐条提醒等于提醒已发生的事,纯噪音);保留任务截止提醒;加一次性自愈清理历史遗留的事件提醒通知(link含reminder=event-) ([927292d](https://github.com/akapril/keelson/commit/927292d7a01bbe89eebea45420f62defd7ab9092))
* **web-mobile:** 点终端直接弹键盘+整界面顶到键盘之上——去掉 inputmode=none 抑制(恢复点击即聚焦弹键盘),根容器跟随 visualViewport 收缩并按 offsetTop 顶起(iOS 页面下滚补偿),输入行不再被遮挡 ([0fb44a9](https://github.com/akapril/keelson/commit/0fb44a94edd1eae689791a7e6484360d6dcedea5))
* **web-mobile:** 终端历史滚动加虚拟键条滚动按钮(▲▼⤓,xterm.scrollLines——触摸滚canvas遮挡失灵的可靠解)+聚焦不再放大(viewport maximum-scale=1) ([a9dca14](https://github.com/akapril/keelson/commit/a9dca146c1084f86e926fe10f500cf5a7f04f3c0))
* **web-mobile:** 软键盘遮挡输入——根容器跟随 visualViewport 实高收缩,内容(终端输入行等)落到键盘之上可见 ([11f0361](https://github.com/akapril/keelson/commit/11f0361696ba3962748179bdd714d95abbd40597))
* **web-terminal:** 刷新后颜色变——观察&lt;html&gt;class变化重应用xterm主题(修硬刷新时主题class未就位读到浅色调色板);移动端历史改为直接触摸滑动滚动(scrollLines手势)并移除滚动按钮 ([92010e1](https://github.com/akapril/keelson/commit/92010e1f2091b41627b2ea7fd0e3b144b9787520))
* **web-terminal:** 备用屏滑动改模拟鼠标滚轮(SGR1006)而非方向键——方向键被claude当输入历史;滚轮走鼠标通道不碰输入,与桌面终端滚TUI一致 ([a3dd5f3](https://github.com/akapril/keelson/commit/a3dd5f3d21dca9818a2bfcaa50ae09fa079bd042))
* **web-terminal:** 滚动步长回到1行行高(1:1跟手,不再过快);键盘按钮改直接ta.focus()+inputmode=text(iOS更可靠拉起软键盘) ([538383f](https://github.com/akapril/keelson/commit/538383f1fd58d37402666617ba0f30a08ed3bd8f))
* **web-terminal:** 环形缓冲截断切断转义序列致重连首屏乱码——trim_scrollback 硬裁后再裁到换行边界(限幅扫描),回放快照从整行开头起;无换行整帧(alt-screen重绘)不过裁交resize重绘自愈;4 纯函数测试 ([870ed2a](https://github.com/akapril/keelson/commit/870ed2abeefc8e45f7f0b79e60754fd461e1f7f3))
* **web-terminal:** 移动端下滑触发页面刷新——终端容器 touch-action:none+overscroll:contain+拖拽期全程 preventDefault(起手前几像素不再被浏览器下拉刷新抢走);终端字体补 CJK 等宽兜底缓解 IME 组字左移 ([971ce09](https://github.com/akapril/keelson/commit/971ce0941f383d7530b3309f083a4c8644738477))
* **web-terminal:** 移动端滚不动——手势改捕获阶段先于xterm拿事件;备用屏(claude/codex全屏TUI无xterm回滚)时把滑动转成上/下方向键发给CLI让应用自滚,普通屏仍走scrollLines ([450c17a](https://github.com/akapril/keelson/commit/450c17ab913edd2f10934e1d9bf2cbaa4573cc9b))
* **web:** 日历面板等 pbReady 再挂载——修 CalendarPage 子effect抢在 initPbAuth 设 baseURL 前发 PB 请求打到占位 127.0.0.1:0 的竞态 ([ff94187](https://github.com/akapril/keelson/commit/ff9418792a008da20df6fe6d8b171f1425cebcb7))

## [0.7.0](https://github.com/akapril/keelson/compare/v0.6.0...v0.7.0) (2026-08-19)


### Features

* **agent:** /inbox 拆通知/Agent待办双标签 + 深链(S3) ([5c8ddf9](https://github.com/akapril/keelson/commit/5c8ddf9b505b023ca66500e80157f0af5f1970d7))
* **agent:** Agent Run 面板(日志/diff/合并/打回) ([ff5e26c](https://github.com/akapril/keelson/commit/ff5e26cf933eec61316f87f6b511b04da87a4ed8))
* **agent:** agent 决策通知文案纯函数 + notify_decision + display_name(S3) ([919ddd9](https://github.com/akapril/keelson/commit/919ddd9807360f66f1ac06e0dbeaab9200d48145))
* **agent:** Agent 待办行 + 列表(行内合并/打回/重派+展开)(S3) ([7619c03](https://github.com/akapril/keelson/commit/7619c03f39123db9f634cdaa51d6622f73e009cb))
* **agent:** Agents 管理页 + 侧栏入口 + 路由(S2) ([95d36d3](https://github.com/akapril/keelson/commit/95d36d3d197a9ebc51eb1d7f90001690625d5947))
* **agent:** build_task_prompt 组任务 prompt(纯函数) ([03983fc](https://github.com/akapril/keelson/commit/03983fc50c0f53a26782fb5045c04d88ad0f0e2f))
* **agent:** decide_outcome 退出码+diff→状态(纯函数四分支) ([e51387a](https://github.com/akapril/keelson/commit/e51387a48c030843344c8b34450e801e696e9455))
* **agent:** ensure_default_agents 幂等预置默认队友+回填(S2) ([4d56c12](https://github.com/akapril/keelson/commit/4d56c1263029323f1eca603809fc8192d90602ec))
* **agent:** execute_task_with_agent 执行内核(worktree+CLI+超时+判定) ([0fffd94](https://github.com/akapril/keelson/commit/0fffd941b21f3e518822c12db0548355ee1a5e8d))
* **agent:** executor 各 review/blocked 终态写决策通知(S3) ([d69ccfd](https://github.com/akapril/keelson/commit/d69ccfdfcdf1c205694e07817ff7f5726e1b5e06))
* **agent:** listPendingAgentRuns + pendingRunSummary + Agent 通知源(S3) ([a179efb](https://github.com/akapril/keelson/commit/a179efbfb18145d2b71f18c723dc86b9c9497237))
* **agent:** PB 迁移 board_tasks 加 agent 字段 + agent_runs 集合 ([4da6a8c](https://github.com/akapril/keelson/commit/4da6a8c031ba2715895de655e44c2389d7975b2d))
* **agent:** pick_eligible 派发决策纯函数 + worker 常量(S1) ([374605d](https://github.com/akapril/keelson/commit/374605d399df1b70adcfd9551cf045c1fa31fa5a))
* **agent:** resolve_agent + prompt/runtime 注入 + agent_ref 语义(S2) ([8f41852](https://github.com/akapril/keelson/commit/8f4185274e610cd27a651074315ce43da1123ae6))
* **agents:** 技能选择器只列 skill 类型指令 + 空态引导 ([a0eee0a](https://github.com/akapril/keelson/commit/a0eee0aa31e16b5b568f0a5dbc2fd68672e19d11))
* **agent:** TaskCard 指派改选队友 + 徽标/面板/过滤(S2) ([2f1a722](https://github.com/akapril/keelson/commit/2f1a722a82f63e8e7032682d8b7bf956833618dd))
* **agent:** worker 按 agent 并发分组 + 候选认 agent_id(S2) ([2ee1d70](https://github.com/akapril/keelson/commit/2ee1d70ab29313956b93237a28e2a7d9ef4038ae))
* **agent:** worktree 分支名/路径命名(纯函数) ([902cf8a](https://github.com/akapril/keelson/commit/902cf8a35bc41db3fa863d6b6012a605ae66061e))
* **agent:** worktree 建/diff/合并/移除 git 操作(走 hidden_command) ([03a36d7](https://github.com/akapril/keelson/commit/03a36d7cde5aad20af29fe461902bb72a9580832))
* **agent:** 任务卡派 agent 执行下拉 + 运行状态徽标 ([0c34b98](https://github.com/akapril/keelson/commit/0c34b98e2e735d869aec6500dbef75ce6f286d04))
* **agent:** 前端 agent_runs 类型/访问层/IPC 绑定 ([cf43c41](https://github.com/akapril/keelson/commit/cf43c41d7a6f23ebca60f2daad64903a6e9e4229))
* **agent:** 四个 Tauri 命令(run/merge/discard/list)+注册 ([471dbf3](https://github.com/akapril/keelson/commit/471dbf38e212a003c7a04afd171f90aec4ec83fe))
* **agent:** 迁移 agent_profiles 集合 + board_tasks.agent_id + agent_runs.agent(S2) ([19c6aaf](https://github.com/akapril/keelson/commit/19c6aaf2c2b566bc03a6bae31cad8a75ca168967))
* **agent:** 队列 worker 轮询循环 + 启动恢复 + wiring(S1) ([9b2b40a](https://github.com/akapril/keelson/commit/9b2b40add90b1678f8e93d40473266b00f1ebe8d))
* **agent:** 队友前端数据层(类型/PB/store)(S2) ([d4e7557](https://github.com/akapril/keelson/commit/d4e75573b512b2d014b963b445ad802353301ecd))
* **board:** agent 执行实时日志流——delta 写 store，面板边跑边看 ([6b35b7d](https://github.com/akapril/keelson/commit/6b35b7d481e64639b5b2d1e75ab397e2ff0f2892))
* **board:** board-view store 升为当前视图配置真源(viewType/filter/swimlane) ([34ad42d](https://github.com/akapril/keelson/commit/34ad42d851fe7f11a20efaae192e64eae827cb66))
* **board:** BoardListView 列表视图（按状态分组, 行开 TaskSheet） ([045acaf](https://github.com/akapril/keelson/commit/045acaf9275ef74652a4082500f3c7c373cd2478))
* **board:** BoardSurface 包装(项目切换器+视图切换) + board tab 接入 + /board 直落看板 ([788a39c](https://github.com/akapril/keelson/commit/788a39c42c3ea71304b132ed861f726d2632d12e))
* **board:** bucketByDue 截止日归桶纯函数(周/月/未排期) ([63ecd82](https://github.com/akapril/keelson/commit/63ecd8263b0a68120d42287fe567f21700c64a49))
* **board:** groupBySwimlane 泳道分组纯函数(单值/多值/无带) ([561b9b8](https://github.com/akapril/keelson/commit/561b9b8747faeada368114285549f9c86d20d54b))
* **board:** orderedTaskGroups 列表分组纯函数 ([537e43c](https://github.com/akapril/keelson/commit/537e43c7587cdb18bab2915724c4de6928cb1759))
* **board:** PB 迁移 board_views 集合(命名视图配置,owner+project,软删) ([1342a71](https://github.com/akapril/keelson/commit/1342a7174a35ea099432563ace6504e934bce7ab))
* **board:** TaskCard 指派语义(即派发) + 已入队徽标 + 事件刷新(S1) ([e129a1b](https://github.com/akapril/keelson/commit/e129a1bb2828999a369dc744efff91e238155eed))
* **board:** 三视图接入 board-view store(filter 提升/改名 viewType/List 读 filter/切项目重置) ([b284589](https://github.com/akapril/keelson/commit/b28458927865c1d58d1c09ea10d65c4bb13b92d0))
* **board:** 保存视图数据层(types+pb board-views+store 乐观重抛) ([10a9b0a](https://github.com/akapril/keelson/commit/10a9b0a420a3dec792360bf656a0369f17861302))
* **board:** 加 taskHasAgent 纯函数 + BoardTask agent 字段(S1) ([9fc738b](https://github.com/akapril/keelson/commit/9fc738b092be2c8d458dc474dcc4bae7af808960))
* **board:** 工具条保存视图下拉(列/应用/存/改名/删) ([e13e3aa](https://github.com/akapril/keelson/commit/e13e3aaa1b3231b3b5e66ee20eb15603998f0c29))
* **board:** 截止日时间线视图(周/月桶+未排期+拖拽改 due) ([cce43ab](https://github.com/akapril/keelson/commit/cce43ab1f8406930589c384d41905284c2cc32b6))
* **board:** 板顶项目切换器（搜索+收藏优先, 板内切项目） ([dacea14](https://github.com/akapril/keelson/commit/dacea14b7308b87cccb3f2faed2fc71190c25143))
* **board:** 看板「有 agent 参与」过滤开关(S1) ([8a43ec5](https://github.com/akapril/keelson/commit/8a43ec5003ea129541e9cc751765d3eb96388b69))
* **board:** 看板泳道渲染(优先级/负责人/标签/agent)+工具条泳道下拉 ([f6f7c8f](https://github.com/akapril/keelson/commit/f6f7c8f3bd6e306654b748f7fca0c21c95a1ca4c))
* **board:** 看板视图 store（看板/列表, 持久化） ([f063d1c](https://github.com/akapril/keelson/commit/f063d1ca9fe56f18b3f940bd4e141bc3713c1db4))
* **board:** 项目工作台返回区分来源(收藏回列表/跳转回来源) ([3258861](https://github.com/akapril/keelson/commit/3258861d366ba5b572d5f183da7f6d904d402bd9))
* **memory:** 记忆账本页支持 ?open 深链滚动定位+高亮 ([0c23c13](https://github.com/akapril/keelson/commit/0c23c137c3e007ae4e2bef09fbbcb85ef746dea4))
* **nav:** 侧栏重排三组(工作/Agent团队/知识)+Inbox/成本进侧栏 ([62335fd](https://github.com/akapril/keelson/commit/62335fddb021b8c880f010b8e35759131551c5e7))
* **nav:** 折叠组改绑知识组+收藏行 from=fav 标记与精确高亮 ([c0e1043](https://github.com/akapril/keelson/commit/c0e104393337ee1693d7fbae9f4777eab5d5a961))
* **prompts:** /prompts 类型筛选/徽标与编辑弹窗支持技能三态 ([4c6f5fa](https://github.com/akapril/keelson/commit/4c6f5fabe0f08462680e70f4cadd160698e15970))
* **prompts:** PB 迁移 prompts.type 加 skill + 回填已绑定指令为技能 ([2fa58be](https://github.com/akapril/keelson/commit/2fa58be64350f8c8589ec0b45ad97dd33dce6d1d))
* **prompts:** promptType 归一识别 skill 三态 + 技能标签 ([5b7fc8e](https://github.com/akapril/keelson/commit/5b7fc8e127e334c825fc590fadff25ee6d01b3cf))
* **runtime:** /processes 正名运行时 + 挂卡 + 侧栏/i18n(S4) ([b518fda](https://github.com/akapril/keelson/commit/b518fda1e408ab6f6b5f1fe6c9eec4a256452841))
* **runtime:** runtime_status 聚合命令 + AppState.started_at(S4) ([7a58932](https://github.com/akapril/keelson/commit/7a58932c4b73d2a3cb1599c6e466dde7c0b1b4fa))
* **runtime:** RuntimeStatus 类型/ipc + runtime-format 纯函数(S4) ([83ff5f2](https://github.com/akapril/keelson/commit/83ff5f251f3e77460f569d89070f6b916ae29c02))
* **runtime:** RuntimeStatusCard 卡组件(四区+3s轮询)(S4) ([1b1da34](https://github.com/akapril/keelson/commit/1b1da34ddc551f53f5e279d592eb9c7079240b83))
* **runtime:** system_usage(机器CPU/内存) + disk.dir_size(S4) ([20766bf](https://github.com/akapril/keelson/commit/20766bf648c01a5e325d5a1514481a36971e944e))
* **spotlight:** buildItems 改类别签名 + 预取项目/记忆五类数据 ([713ca05](https://github.com/akapril/keelson/commit/713ca05cf9774db3d31c7ff4da459f9a7b1de5e7))
* **spotlight:** store 加类别状态 category + 循环切换 nextCategory ([cf4692a](https://github.com/akapril/keelson/commit/cf4692a2efdf751d514f36f9f00f15f7f40b0b3a))
* **spotlight:** Tab/⌘数字切类别，恢复模式迁移为底栏徽标点击 ([343cd7a](https://github.com/akapril/keelson/commit/343cd7adfbb37e06f34043353ee6522900e6b59a))
* **spotlight:** 列表行支持项目/记忆徽标 ([d55dc22](https://github.com/akapril/keelson/commit/d55dc22c775b557a2681ad447458e5c3ffdae929))
* **spotlight:** 类别切换 chips 组件 + i18n 标签 ([c2d5692](https://github.com/akapril/keelson/commit/c2d5692f2edb943d4d1bde24c0738faabae820a6))
* **spotlight:** 输入前缀解析/格式化纯函数 parsePrefix/formatInput ([24ea05c](https://github.com/akapril/keelson/commit/24ea05c7b86cae90117d73f811763410b7f02694))
* **spotlight:** 输入框前缀与类别互映（formatInput/parsePrefix） ([021917d](https://github.com/akapril/keelson/commit/021917d0d92a52b154772f61003cdf4d8f9df5c0))
* **spotlight:** 项目/记忆候选 projectToItem/memoryToItem + 过滤器 ([be8a2dc](https://github.com/akapril/keelson/commit/be8a2dcf8a413cfe47b895493b18300ff47b254e))


### Bug Fixes

* **agent:** ensure_default_agents 改按 provider 逐个 ensure(自愈部分播种)(S2) ([49ab037](https://github.com/akapril/keelson/commit/49ab03713df048eeb8136221ad4e9ceec4fa64cf))
* **agent:** provider 不支持落可见 blocked run + prompt 技能段缩进(S2) ([1f0e79a](https://github.com/akapril/keelson/commit/1f0e79acfd8e795193e4e93634536d200e364fcf))
* **agent:** 修颜色下拉空值崩溃 + 重派空 agentRef + 归档队友徽标(S2 末审) ([ec6d603](https://github.com/akapril/keelson/commit/ec6d6038a60bc19b1462219320453ce582b9b6bf))
* **agent:** 子进程 kill_on_drop 超时真正终止(补 P1 缺口) ([203681e](https://github.com/akapril/keelson/commit/203681ee492ba228c52d5b87405f2731d3f6442b))
* **agent:** 技能区空态提示 + AgentCard 文案走 i18n(S2) ([ff83768](https://github.com/akapril/keelson/commit/ff837689dd27a0fae3807d21ce19ef74aa005b8c))
* **agent:** 持久化 base_branch + 合并后切回用户原 HEAD (C1) ([2cf82a3](https://github.com/akapril/keelson/commit/2cf82a38bde56e42100c86e8fa9fcad8f56c31f7))
* **agent:** 末审修复 pre-run 失败可见 + 非终态排除 + 指派防手滑(S1) ([f08ea93](https://github.com/akapril/keelson/commit/f08ea93f4447813eb3fede05b4854bc82d97ab68))
* **agent:** 校验 repo_path 存在且是 git 仓库，建 run 前快失败 ([bd886d6](https://github.com/akapril/keelson/commit/bd886d6759635b086bcd837097219751ec629597))
* **agent:** 重启恢复写决策通知 + 通知 body 截断防 PB 超限 ([ce71386](https://github.com/akapril/keelson/commit/ce71386d5125537b1c0f36953892288426ba05a3))
* **board:** board_views createRule 改用已验证的 project.owner 记录解析式(防创建 403) ([a2b54d2](https://github.com/akapril/keelson/commit/a2b54d21974b3d20003258a50cc7495bf138b0d8))
* **board:** 泳道带标题本地化(优先级走 meta.priority)+agent 带显队友名而非原始 id ([ce2d160](https://github.com/akapril/keelson/commit/ce2d160c4bf22d14a1558661f1481f71bb178cd5))
* **nav:** 收藏⋯菜单打开也带 from=fav 一致返回 + 修 NavGroup 注释示例 ([6f5ea64](https://github.com/akapril/keelson/commit/6f5ea641fbb835aa6849220d03022fa8036c197f))
* **pb:** 本地 PocketBase 客户端绕过代理(.no_proxy),修开机自启代理致 os error 10053 ([a292b0a](https://github.com/akapril/keelson/commit/a292b0abf1b1a45045efbd646a734233ef5fa3e5))
* **prompts:** 迁移回填兼容 skill_prompts 数组/JSON串两种返回(防静默空跑) ([21aaae7](https://github.com/akapril/keelson/commit/21aaae7c2db573e06b395534f18086631bef2927))
* **spotlight:** mac 透明窗方角改圆角（外层透明留白内嵌面板） ([54f21ad](https://github.com/akapril/keelson/commit/54f21ada5a43fccaa54ba70586b9bae3e341c47f))
* **spotlight:** pb 数据(项目/文档/任务/记忆)预取等认证就绪再拉 ([1e29839](https://github.com/akapril/keelson/commit/1e29839ed6ff3c4981782941510ec286300fd286))
* **spotlight:** Tab 还给会话恢复方式切换, 类别切换保留 chips 点选 + ⌘1-6 ([947622f](https://github.com/akapril/keelson/commit/947622f7c004d795c1c9f25a9fa69c92190c234f))
* **win:** WebView 绕代理(--no-proxy-server)+开机自启启动自愈(指向当前安装)+卸载清理 Run 项 ([69283a8](https://github.com/akapril/keelson/commit/69283a83b08a0cb6d20d46ed961751cef3e854ac))

## [0.6.0](https://github.com/akapril/keelson/compare/v0.5.1...v0.6.0) (2026-08-13)


### Features

* **sessions:** 接入 OpenCode/Gemini/Hermes/Antigravity 四个 CLI + 工具调用显示 + provider 徽标/筛选/新建下拉 ([cbe4f0c](https://github.com/akapril/keelson/commit/cbe4f0c2828f25707faeb8bef341e3b26324e946))
* **ui:** macOS 原生标题栏 overlay(修圆角/红绿灯) ([d4b0bb3](https://github.com/akapril/keelson/commit/d4b0bb33c031887b17c8151968a28717d334e802))
* **usage:** 用量页——成本控制塔 + 额度燃烧(暂隐藏) ([bc2d519](https://github.com/akapril/keelson/commit/bc2d51956185716ff19f88dced8497d5c2eaeff7))

## [0.5.1](https://github.com/akapril/keelson/compare/v0.5.0...v0.5.1) (2026-08-13)


### Bug Fixes

* **ui:** 多选框统一为 Checkbox 组件，替换 20 处原生 checkbox ([ac89ce6](https://github.com/akapril/keelson/commit/ac89ce6f00e057167c55c9d1dc696937e07eadb1))

## [0.5.0](https://github.com/akapril/keelson/compare/v0.4.2...v0.5.0) (2026-08-13)


### Features

* **nav:** 收藏行「⋯ 更多操作」菜单——选历史会话/选终端类型/更多 ([d1b1bc7](https://github.com/akapril/keelson/commit/d1b1bc77ef2c52a5caf47087c566e51b609e90f4))

## [0.4.2](https://github.com/akapril/keelson/compare/v0.4.1...v0.4.2) (2026-08-13)


### Bug Fixes

* **pb:** 密钥读取文件回退优先，消除 macOS 反复弹钥匙串 ([e1ca526](https://github.com/akapril/keelson/commit/e1ca5260fa9e32541096beaaf6780bf4779e5978))
* **web:** macOS 从 Dock 启动注入登录 shell PATH，修复 web 终端起不来 ([c31b09f](https://github.com/akapril/keelson/commit/c31b09f630d2495e23be68bc8d70b839dc23490e))

## [0.4.1](https://github.com/akapril/keelson/compare/v0.4.0...v0.4.1) (2026-08-12)


### Bug Fixes

* **web:** 打包 dist 供网关 serve，修复远程访问「web dist 未构建」 ([659a863](https://github.com/akapril/keelson/commit/659a8632a86ba2aa6cc9e84787e494dc0ee82c23))

## [0.4.0](https://github.com/akapril/keelson/compare/v0.3.1...v0.4.0) (2026-08-12)


### Features

* **board:** 项目卡片一键「继续/新终端」，治会话入口太深 ([42a8794](https://github.com/akapril/keelson/commit/42a8794efedaafc7a136221e2725756a42a85974))
* **calendar:** 事件加时刻 + 视图切换框架 + 议程视图 (stage 1+2) ([9c8cee0](https://github.com/akapril/keelson/commit/9c8cee013caec2aa55a4cd7005ac82b0270093a0))
* **calendar:** 周/日视图拖拽改期 + 点空白按时刻新建 (stage 5) ([264f649](https://github.com/akapril/keelson/commit/264f6496848992420b7a600a2e0364fb2886397e))
* **calendar:** 周视图(全天行 + 小时时间轴) (stage 3) ([a22cf34](https://github.com/akapril/keelson/commit/a22cf341a65e9f17742f58dd55dd218689c06d73))
* **calendar:** 日视图 (stage 4) ([cfc98ab](https://github.com/akapril/keelson/commit/cfc98ab0f0037d4308edd0e2f9f1c4bd4d573886))
* **nav:** 「更多」组可折叠(默认收起, 记住选择) ([9139966](https://github.com/akapril/keelson/commit/9139966cbd00fc4e44ba3ce153c98072b22302f3))
* **nav:** 侧栏收藏行加「新终端」(+)，与继续并排 ([43bc287](https://github.com/akapril/keelson/commit/43bc2878df1bd9fdae00ede3db74733911b66b3e))
* **nav:** 侧栏收藏行加悬停「继续」，一键续接收藏项目最近会话 ([41c6a5d](https://github.com/akapril/keelson/commit/41c6a5d7f86f6d0a0306b27ce4c5dfbf8084a63c))
* **nav:** 收藏行以接续为主 + 提示显示会接到哪个会话 ([8ec6563](https://github.com/akapril/keelson/commit/8ec656391932c1747c048187bd03adfc74610538))
* **settings:** 设置页改为左侧分类导航（通用 / AI 与集成 / 数据与远程 / 系统） ([3d42c0f](https://github.com/akapril/keelson/commit/3d42c0f56010883a3591089774eaad8f6590ba3e))


### Bug Fixes

* **docs:** 独立文档窗口的窗口控制移入顶部 TitleBar ([8500119](https://github.com/akapril/keelson/commit/85001194479b4391e231047072a89da1c132f40d))
* **settings:** 固定设置页宽度，切换分类不再抖动 ([fc9f29b](https://github.com/akapril/keelson/commit/fc9f29bf0b57a60c38e52b1db50e3e9303160602))
* **ui:** 精简啰嗦文案 + 面包屑改纯标题 + 修两处半截描述 ([e539eee](https://github.com/akapril/keelson/commit/e539eee603c9bd3e9046d062c29f08434786ee7a))

## [0.3.1](https://github.com/akapril/keelson/compare/v0.3.0...v0.3.1) (2026-08-12)


### Bug Fixes

* **updater:** 安装成功不再误弹错误 toast ([d9522a6](https://github.com/akapril/keelson/commit/d9522a6b8cd7fa1b0876e64c7e2755a9625159e3))
* **web:** 配对码后台轮询改静默刷新，不再每 4 秒闪一次 ([7b888bb](https://github.com/akapril/keelson/commit/7b888bb132a9f61e92da66ba2d44eed378e3512f))

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
