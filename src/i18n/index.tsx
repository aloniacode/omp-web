import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "en" | "zh";

const STORAGE_KEY = "omp-web.lang";

export const messages = {
  en: {
    "app.title": "omp web",
    "app.subtitle": "Chat with your oh-my-pi coding agent",

    "sidebar.newChat": "New chat",
    "sidebar.search": "Search conversations",
    "sidebar.noMatches": "No matches",
    "sidebar.empty": "No conversations yet",
    "sidebar.close": "Close sidebar",
    "sidebar.rename": "Rename",
    "sidebar.delete": "Delete",
    "sidebar.pin": "Pin",
    "sidebar.unpin": "Unpin",
    "sidebar.pinned": "Pinned",
    "sidebar.groupDate": "Date",
    "sidebar.groupProject": "Project",
    "sidebar.groupToday": "Today",
    "sidebar.groupYesterday": "Yesterday",
    "sidebar.groupThisWeek": "This week",
    "sidebar.groupThisMonth": "This month",
    "sidebar.groupOlder": "Older",
    "sidebar.groupUnknownProject": "Unknown project",

    "dialog.renameTitle": "Rename conversation",
    "dialog.deleteTitle": "Delete conversation?",
    "dialog.deleteBody": "“{title}” will be permanently removed from disk.",
    "dialog.cancel": "Cancel",
    "dialog.rename": "Rename",
    "dialog.delete": "Delete",

    "status.connected": "agent connected",
    "status.starting": "starting agent…",
    "status.reconnecting": "reconnecting…",
    "status.connecting": "connecting…",
    "status.disconnected": "disconnected",
    "status.ompMissing": "omp missing?",

    "topbar.queued": "{n} queued",
    "topbar.streaming": "streaming",
    "topbar.session": "Session {id}",
    "topbar.untitled": "New conversation",
    "topbar.settings": "Settings",
    "topbar.toggleSidebar": "Toggle sidebar",
    "topbar.more": "More actions",
    "topbar.rename": "Rename",
    "topbar.delete": "Delete",
    "topbar.exportHtml": "Export HTML",
    "topbar.compact": "Compact context",

    "chat.agentWorking": "Agent is thinking…",
    "chat.suggestion.1": "Explain this codebase",
    "chat.suggestion.2": "Find and fix failing tests",
    "chat.suggestion.3": "Review uncommitted changes",

    "composer.attach": "Attach",
    "composer.attachFile": "Attach file",
    "composer.attachImage": "Attach image",
    "composer.removeAttachment": "Remove attachment",
    "composer.placeholder": "Message the agent…",
    "composer.placeholderWaiting": "Waiting for agent connection…",
    "composer.send": "Send",
    "composer.stop": "Stop the agent",
    "composer.stopping": "Stopping…",
    "composer.fileRef": "Reference a file (@)",
    "composer.skillsRef": "Insert a skill (/)",
    "composer.files": "Files",
    "composer.skills": "Skills",
    "composer.noFiles": "No matching files",
    "composer.noSkills": "No matching skills",
    "composer.usageTotal": "{tokens} tokens",
    "composer.usageCost": "estimated conversation cost",
    "composer.usageContext": "Context: {used} / {window} tokens ({percent})",

    "message.thinking": "☁️ Thinking…",
    "message.thoughtDone": "☁️ Thought",
    "message.reasoningWithheld": "[reasoning content withheld by provider]",
    "message.aborted": "aborted",
    "message.error": "error",
    "time.justNow": "just now",
    "time.minutesAgo": "{n}m ago",
    "time.hoursAgo": "{h}h ago",
    "time.daysAgo": "{d}d ago",
    "message.sending": "sending…",
    "message.failed": "failed",
    "message.usageTooltip": "{input} input · {output} output",
    "message.cacheTooltip": "{read} cache read · {write} cache write",
    "status.ompTooltip": "omp binary not found on PATH",
    "picker.noModels": "No models available",
    "picker.loadingModels": "Loading model catalog…",
    "picker.models": "Models",
    "picker.thinking": "Thinking",
    "picker.project": "Project",
    "picker.noProjects": "No projects yet",
    "picker.searchProjects": "Search or enter a path…",
    "picker.useCustom": "Switch to “{path}”",
    "notice.compacted": "Context compacted",
    "notice.projectSwitched": "Switched project: {cwd} — reconnecting agent…",
    "notice.exported": "Transcript exported",
    "notice.exportedTo": "Exported: {path}",

    "ext.defaultTitle": "Agent needs your input",
    "ext.openLink": "Open link",
    "ext.dismiss": "Dismiss",
    "ext.yes": "Yes",
    "ext.no": "No",

    "settings.title": "Settings",
    "settings.tab.web": "Web",
    "settings.tab.omp": "OMP",
    "settings.appearance": "Appearance",
    "settings.language": "Language",
    "settings.themeMode": "Theme mode",
    "settings.themeMode.system": "System",
    "settings.themeMode.light": "Light",
    "settings.themeMode.dark": "Dark",
    "settings.accent": "Accent color",
    "settings.accent.graphite": "Graphite",
    "settings.accent.violet": "Violet",
    "settings.accent.blue": "Blue",
    "settings.accent.emerald": "Emerald",
    "settings.accent.rose": "Rose",
    "settings.accent.amber": "Amber",

    "settings.omp.model": "Model",
    "settings.omp.thinking": "Thinking level",
    "settings.omp.steering": "Steering",
    "settings.omp.followUp": "Follow-up",
    "settings.omp.interrupt": "Interrupt",
    "settings.omp.all": "All",
    "settings.omp.oneAtATime": "One at a time",
    "settings.omp.immediate": "Immediate",
    "settings.omp.wait": "Wait",
    "settings.omp.fastMode": "Fast mode",
    "settings.omp.fastModeHint": "Provider priority serving, when supported",
    "settings.omp.autoCompaction": "Auto compaction",
    "settings.omp.autoCompactionHint": "Compact context automatically near the limit",
    "settings.omp.compactNow": "Compact now",
    "settings.omp.compacting": "Compacting…",
    "settings.omp.autoRetry": "Auto retry",
    "settings.omp.autoRetryHint": "Retry failed provider requests automatically",
    "settings.omp.sessionName": "Name",
    "settings.omp.sessionId": "ID",
    "settings.omp.sessionFile": "Transcript file",
    "settings.omp.exportHtml": "Export HTML",
    "settings.omp.exportHint": "Save the full transcript as a self-contained HTML file",

    "setup.title": "oh-my-pi not found",
    "setup.subtitle": "oh-my-pi was not found on this machine",
    "setup.body": "omp web only provides the interface and transport; it needs the local {omp} coding agent. The bridge looks for the {omp} executable under {cwd} (override with the {bin} environment variable).",
    "setup.afterInstall": "No page reload needed after installing — press the button below to re-check. After installing, run {omp} once in a terminal to finish model configuration (login / API key).",
    "setup.copyCommand": "Copy command",
    "setup.recheck": "Re-check",
    "setup.rechecking": "Re-checking…",
  },

  zh: {
    "app.title": "omp web",
    "app.subtitle": "与你的 oh-my-pi 编码智能体对话",

    "sidebar.newChat": "新对话",
    "sidebar.search": "搜索对话",
    "sidebar.noMatches": "无匹配结果",
    "sidebar.empty": "暂无对话",
    "sidebar.close": "关闭侧边栏",
    "sidebar.rename": "重命名",
    "sidebar.delete": "删除",
    "sidebar.pin": "置顶",
    "sidebar.unpin": "取消置顶",
    "sidebar.pinned": "已置顶",
    "sidebar.groupDate": "日期",
    "sidebar.groupProject": "项目",
    "sidebar.groupToday": "今天",
    "sidebar.groupYesterday": "昨天",
    "sidebar.groupThisWeek": "本周",
    "sidebar.groupThisMonth": "本月",
    "sidebar.groupOlder": "更早",
    "sidebar.groupUnknownProject": "未知项目",

    "dialog.renameTitle": "重命名对话",
    "dialog.deleteTitle": "删除对话？",
    "dialog.deleteBody": "“{title}” 将从磁盘永久移除。",
    "dialog.cancel": "取消",
    "dialog.rename": "重命名",
    "dialog.delete": "删除",

    "status.connected": "智能体已连接",
    "status.starting": "智能体启动中…",
    "status.reconnecting": "重新连接中…",
    "status.connecting": "连接中…",
    "status.disconnected": "已断开",
    "status.ompMissing": "未找到 omp？",

    "topbar.queued": "{n} 条排队",
    "topbar.streaming": "输出中",
    "topbar.session": "会话 {id}",
    "topbar.untitled": "新对话",
    "topbar.settings": "设置",
    "topbar.toggleSidebar": "切换侧边栏",
    "topbar.more": "更多操作",
    "topbar.rename": "重命名",
    "topbar.delete": "删除",
    "topbar.exportHtml": "导出 HTML",
    "topbar.compact": "压缩上下文",

    "chat.agentWorking": "智能体思考中…",
    "chat.suggestion.1": "解释这个代码库",
    "chat.suggestion.2": "查找并修复失败的测试",
    "chat.suggestion.3": "审查未提交的更改",

    "composer.attach": "附件",
    "composer.attachFile": "引用文件",
    "composer.attachImage": "添加图片",
    "composer.removeAttachment": "移除附件",
    "composer.placeholder": "给智能体发消息…",
    "composer.placeholderWaiting": "等待智能体连接…",
    "composer.send": "发送",
    "composer.stop": "停止智能体",
    "composer.stopping": "停止中…",
    "composer.fileRef": "引用文件（@）",
    "composer.skillsRef": "插入技能（/）",
    "composer.files": "文件",
    "composer.skills": "技能",
    "composer.noFiles": "没有匹配的文件",
    "composer.noSkills": "没有匹配的技能",
    "composer.usageTotal": "{tokens} tokens",
    "composer.usageCost": "对话预估费用",
    "composer.usageContext": "上下文：{used} / {window} tokens（{percent}）",

    "message.thinking": "☁️ 思考中…",
    "message.thoughtDone": "☁️ 已思考",
    "message.reasoningWithheld": "[推理内容已被提供方隐藏]",
    "message.aborted": "已中止",
    "message.error": "错误",
    "message.cacheTooltip": "{read} 缓存读取 · {write} 缓存写入",
    "message.usageTooltip": "{input} 输入 · {output} 输出",

    "ext.defaultTitle": "智能体需要你的输入",
    "ext.openLink": "打开链接",
    "ext.dismiss": "关闭",
    "ext.yes": "是",
    "ext.no": "否",

    "settings.title": "设置",
    "settings.tab.web": "网页",
    "settings.tab.omp": "OMP",
    "settings.appearance": "外观",
    "settings.language": "语言",
    "settings.themeMode": "主题模式",
    "settings.themeMode.system": "跟随系统",
    "settings.themeMode.light": "浅色",
    "settings.themeMode.dark": "深色",
    "settings.accent": "主题色",
    "settings.accent.graphite": "石墨黑",
    "settings.accent.violet": "紫罗兰",
    "settings.accent.blue": "蓝色",
    "settings.accent.emerald": "翠绿",
    "settings.accent.rose": "玫红",
    "settings.accent.amber": "琥珀",

    "settings.omp.model": "模型",
    "settings.omp.thinking": "思考等级",
    "settings.omp.steering": "转向（Steering）",
    "settings.omp.followUp": "追问（Follow-up）",
    "settings.omp.interrupt": "打断（Interrupt）",
    "settings.omp.all": "全部",
    "settings.omp.oneAtATime": "逐条",
    "settings.omp.immediate": "立即",
    "settings.omp.wait": "等待",
    "settings.omp.fastMode": "极速模式",
    "settings.omp.fastModeHint": "在支持的服务商上启用优先级服务",
    "settings.omp.autoCompaction": "自动压缩",
    "settings.omp.autoCompactionHint": "接近上限时自动压缩上下文",
    "settings.omp.compactNow": "立即压缩",
    "settings.omp.compacting": "压缩中…",
    "settings.omp.autoRetry": "自动重试",
    "settings.omp.autoRetryHint": "自动重试失败的模型请求",
    "settings.omp.sessionName": "名称",
    "settings.omp.sessionId": "ID",
    "settings.omp.sessionFile": "记录文件",
    "settings.omp.exportHtml": "导出 HTML",
    "settings.omp.exportHint": "将完整对话记录保存为独立 HTML 文件",

    "setup.title": "未检测到 oh-my-pi",
    "setup.body": "omp web 只负责界面与通信，需要本机安装 {omp} 编码智能体。桥接进程在 {cwd} 下查找 {omp} 可执行文件（可用环境变量 {bin} 指定路径）。",
    "setup.afterInstall": "安装完成后无需刷新页面，点击下方按钮重新检测。安装后请先在终端运行一次 {omp} 完成模型配置（登录 / API Key）。",
    "setup.copyCommand": "复制命令",
    "setup.recheck": "重新检测",
    "setup.rechecking": "检测中…",
    "time.justNow": "刚刚",
    "time.minutesAgo": "{n} 分钟前",
    "time.hoursAgo": "{h} 小时前",
    "time.daysAgo": "{d} 天前",
    "setup.subtitle": "本机未找到 oh-my-pi",
    "message.sending": "发送中…",
    "message.failed": "失败",
    "status.ompTooltip": "PATH 中未找到 omp 可执行文件",
    "picker.noModels": "没有可用模型",
    "picker.loadingModels": "模型目录加载中…",
    "picker.models": "模型",
    "picker.thinking": "思考等级",
    "picker.project": "项目",
    "picker.noProjects": "暂无项目",
    "picker.searchProjects": "搜索或输入路径…",
    "picker.useCustom": "切换到“{path}”",
    "notice.compacted": "上下文已压缩",
    "notice.projectSwitched": "已切换项目：{cwd} — 正在重连智能体…",
    "notice.exported": "对话已导出",
    "notice.exportedTo": "已导出：{path}",
  },
} as const;

let activeLang: Lang = "en";

/** Translation for non-React modules (store notices). Kept in sync by I18nProvider. */
export function storeT(key: keyof (typeof messages)["en"], vars?: Record<string, string | number>): string {
  const template = messages[activeLang][key] ?? messages.en[key] ?? key;
  if (!vars) return template;
  return template.replaceAll(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function syncStoreLang(lang: Lang) {
  activeLang = lang;
}

export type MessageKey = keyof (typeof messages)["en"];

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    syncStoreLang(lang);
  }, [lang]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      const template = messages[lang][key] ?? messages.en[key] ?? key;
      if (!vars) return template;
      return template.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
