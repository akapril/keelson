import { defineConfig } from "vitepress";

// Keelson 文档站配置
// 说明：文档站是独立于桌面应用的一套构建，复用仓库 docs/*.md 内容。
export default defineConfig({
  lang: "zh-Hans",
  title: "Keelson",
  description: "本地优先的 AI 工作台 —— 把散落的 AI-CLI 会话、项目、任务、文档收拢到一处。",

  // 自定义域名根路径部署（keelson.work），非子路径
  base: "/",

  // 排除内部规格/计划目录，绝不发布
  srcExclude: ["superpowers/**"],

  // 现有 md 含指向仓库文件的相对链接，忽略死链避免构建失败
  ignoreDeadLinks: true,

  themeConfig: {
    // 顶部导航
    nav: [
      { text: "首页", link: "/" },
      { text: "指南", link: "/mcp-setup" },
      { text: "路线图", link: "/ROADMAP" },
      { text: "GitHub", link: "https://github.com/akapril/keelson" },
    ],

    // 侧边栏分组
    sidebar: [
      {
        text: "指南",
        items: [
          { text: "MCP 接入", link: "/mcp-setup" },
          { text: "记忆系统", link: "/memory-systems" },
          { text: "Web 远程访问", link: "/web-remote-access" },
        ],
      },
      {
        text: "项目",
        items: [
          { text: "路线图", link: "/ROADMAP" },
        ],
      },
    ],

    // 社交链接指向仓库
    socialLinks: [
      { icon: "github", link: "https://github.com/akapril/keelson" },
    ],

    // 编辑链接指向 GitHub 上的 docs
    editLink: {
      pattern: "https://github.com/akapril/keelson/edit/master/docs/:path",
      text: "在 GitHub 上编辑此页",
    },

    // 页脚
    footer: {
      message: "基于 MIT 许可发布",
      copyright: "Copyright © 2026 akapril",
    },

    // 中文界面文案
    docFooter: {
      prev: "上一页",
      next: "下一页",
    },
    outline: {
      label: "本页目录",
    },
    lastUpdated: {
      text: "最后更新于",
    },
    returnToTopLabel: "返回顶部",
    sidebarMenuLabel: "菜单",
    darkModeSwitchLabel: "主题",
    lightModeSwitchTitle: "切换到浅色模式",
    darkModeSwitchTitle: "切换到深色模式",
  },
});
