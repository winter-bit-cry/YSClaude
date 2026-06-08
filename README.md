# YSClaude

YSClaude 是一个个人向移动端 AI 客户端，基于 React Native、Expo 和 `expo-router` 构建。它的核心是 OpenAI 兼容聊天，同时把网页面板、工具调用、AI 共读、日记、音乐/AI 电台、番茄专注、生理期上下文、表情包和多角色副本整合到同一个本地应用里。

项目当前使用 Expo SDK 56。开始改代码前请先查看版本化文档：<https://docs.expo.dev/versions/v56.0.0/>。当前依赖组合为 Expo `~56.0.9`、React Native `0.85.3`、React `19.2.3`、TypeScript `~6.0.3`；Expo 56 文档要求的最低 Node.js 版本为 `22.13.x`。

## 技术栈

| 领域 | 当前选型 |
| --- | --- |
| App 框架 | Expo SDK 56 + React Native 0.85.3 |
| 路由 | `expo-router` |
| 状态管理 | Zustand + `persist` |
| 本地存储 | `expo-sqlite` + 自定义 KV storage |
| 模型接口 | OpenAI 兼容 `/v1/chat/completions` 与 `/v1/models` |
| Markdown | `@ronradtke/react-native-markdown-display` |
| 音频 | `expo-audio` |
| WebView | `react-native-webview` |
| 文件/图片/分享 | `expo-file-system`、`expo-image-picker`、`expo-sharing`、Android 文件来源选择器 |
| 电子书解析 | `fflate`、`fast-xml-parser` |
| 系统能力 | `expo-device`、`expo-battery`、`expo-calendar`、`expo-notifications` |
| 图标/图形 | `lucide-react-native`、`react-native-svg` |
| 构建 | EAS Build，可产出 Android APK |

## 主要功能

### AI 对话

- 支持 OpenAI 兼容 API，可保存多个命名配置、切换模型、拉取模型列表和测试连接。
- 支持流式回复、停止生成、重新生成、编辑消息、删除消息、分页加载历史对话。
- 输入框可发送文字、图片和自定义表情包；图片会作为 `image_url` 多段内容发送给视觉模型，图片 URI 随消息持久化。
- 空输入可触发 AI 基于当前上下文继续回复。
- 消息支持 Markdown、代码块、表格横向滚动、`<thinking>...</thinking>` 折叠显示。
- 支持按楼层隐藏上下文；隐藏范围按对话独立存储，发送给模型时会跳过对应楼层。
- 会自动注入运行时上下文，包括当前时间、相邻消息时间间隔、正在听的歌曲、当前 WebView 页面、专注事件、收藏日记和可选生理期记录。
- 可选 Prompt Cache：对兼容服务端在请求消息中添加 ephemeral cache control 标记，并用当前对话 ID 作为 session。

### Tool 与网页能力

- Memory Vault：语义检索、日记查询、单篇日记上传。
- Tavily Web Search：联网搜索实时信息。
- Web Page Reader：自动检测用户消息中的链接，读取网页标题、正文和摘要，可配置动态渲染服务。
- Web Interaction：应用内 WebView 面板可由 AI 打开、观察、点击元素/selector、坐标点击和等待。
- AI 网页巡游：通过 UAPI 热榜选择话题，结合 WebView 浏览页面后生成自然回复。
- Native Tools：读取设备信息、电池状态、应用使用统计，以及列出/创建/更新/删除系统日历事件。
- Shizuku 文件工具：在用户授权的根目录内列目录、读文件、写入、文本替换、复制和移动文件。
- 工具调用过程会显示在 AI 气泡上方，并持久化调用参数、结果和状态，方便回看与调试。

### WebView 面板

- 可由用户主动打开，也可由 AI 工具打开。
- 支持拖动、缩放、收起为贴边入口、关闭会话。
- 内置首页、Bing 搜索框、收藏夹、地址栏、刷新、返回、收藏/取消收藏、UA 切换、缓存/Cookie 清理。
- 当面板有活动页面时，下一次聊天请求会自动观察当前网页，并作为运行时上下文附带给 AI。
- 应用处于前台时不会弹出系统回复通知；即使前台打开 WebView 面板或通知已排队，也会由 Expo 通知 handler 在展示前再次拦截。

### AI 共读

- 书架支持导入 `txt` / `epub`，解析正文、章节、作者和封面。
- 阅读页按章节阅读，保存进度，支持目录跳转和章节底部自动切换。
- 长按句子可添加或移除划线，高亮记录独立存储。
- 共读对话独立于主聊天，可编辑/删除消息，并显示楼层。
- 共读面板可拖动、缩放、折叠为悬浮球。
- AI 回复会带入书名、作者、当前位置前方原文片段和最近共读对话。
- 可按楼层范围总结共读聊天，并保存为读书总结。
- 总结页按书聚合划线、AI 总结和手动读书心得；删除书后仍保留快照展示历史记录。

### 日记与个人上下文

- 设置页「日记」tab 支持新建、编辑、删除、收藏日记。
- 可从聊天消息范围生成第一人称日记总结。
- 收藏日记会注入主聊天 system 上下文，帮助 AI 理解近期生活记录。
- 可上传单篇日记到 Memory Vault；上传时确认日期，标题会并入正文。
- 聊天日历可按日期跳转历史消息，并支持长按记录生理期；开启后会把生理期记录和预测上下文附带给 AI。

### 音乐与 AI 电台

- 内置「一起听」播放器，支持播放/暂停、上一首/下一首、进度拖动、列表循环、单曲循环和随机播放。
- 支持时间轴歌词滚动，点击歌词可跳转播放进度。
- 支持桌面歌词开关和自定义桌面歌词背景。
- 歌单管理可连接 NeteaseCloudMusicApi 或兼容网易云接口，二维码登录，读取歌单并导入可播放歌曲。
- AI 电台会基于当前歌单生成固定节目、AI 主持串场和收尾，并用 TTS 播放主持词。
- 当前歌曲、歌手、播放进度和歌词会自动进入主聊天上下文。

### 番茄专注

- 支持今日任务、倒计时/正计时、目标次数、暂停、继续、完成和放弃。
- 支持手动补记一次专注。
- 统计页可按日期查看专注次数、总时长、任务分布饼图和明细。
- 专注事件会被主聊天读取为运行时上下文。

### Game 副本

- 支持创建独立多角色副本，包含旁白、总结 AI 和任意角色。
- 每个角色可绑定独立 OpenAI 兼容 API preset，并配置 temperature 与 max tokens。
- 支持副本牌面、角色头像、角色气泡颜色、用户头像和头像显示开关。
- 房间内用户先发言，再手动选择旁白、总结 AI 或角色生成回复。
- 支持消息编辑/删除、清空房间和隐藏楼层范围；隐藏消息不会发给副本 AI。

### 表情包与外观

- 设置页「表情包」可管理默认表情包，也可上传图片或用“名称 + 链接”批量导入。
- 输入框会根据文字匹配推荐「我的表情包」，AI 回复也可使用配置好的 AI 表情包 token。
- 设置页「欢迎语」可维护聊天页空状态随机显示的欢迎语池，也可开启系统默认欢迎语并填写名字。
- 设置页「美化」支持自定义顶栏图标、输入框图标、聊天背景、输入框背景、用户/AI 头像、昵称、字体大小、气泡颜色、透明度、圆角、玻璃输入框和主题快照。
- 设置页「悬浮球」支持 Android 悬浮球开关、正常态/贴边态素材池、大小调整，以及 TTS 相关悬浮操作。
- 顶栏中间的 Clawd 入口进入 M5Stack 页面，目前是硬件连接配置预留页。
- 支持浅色/深色主题，内置 Sohne、Sohne Mono、Tiempos Text 字体。

### 数据备份与恢复

- 设置页「API 配置」下提供「数据备份」区域。
- 「创建备份并分享」会生成 `ysclaude-backup-YYYY-MM-DD-HH-mm-ss.zip`，可通过系统分享保存到 Google Drive 等网盘。
- 备份包包含主 SQLite 数据库 `ysclaude.db`、设置数据库 `ysclaude_kv.db`、`manifest.json` 和应用文档目录中的自定义素材，例如表情包、头像、背景、图标、共读导入文件和封面。
- 「从备份恢复」会从系统文件选择器读取备份 zip，适合从 Google Drive 下载/选择后导入。
- 恢复前会校验备份格式和 SQLite 文件，并自动创建一份 `ysclaude-before-restore-...zip` 本地快照。
- 恢复是完整覆盖，不做云同步、不做数据合并；恢复完成后需要完全关闭并重新打开 App，让数据库和持久化状态重新加载。

## 配置入口

### API 配置

在设置页「API 配置」填写：

- `Base URL`：OpenAI 兼容接口地址，例如 `https://api.openai.com/v1`
- `API Key`
- `Model`
- 配置名称

模型列表拉取使用 `${Base URL}/models`，聊天请求使用 `${Base URL}/chat/completions`。

同一页面还提供数据备份功能：

- 创建备份并分享：生成完整备份包，通过系统分享选择 Google Drive 保存。
- 从备份恢复：从 Google Drive 或本地文件选择备份 zip，确认后覆盖当前本地数据。

### 对话设置

设置页「对话设置」可配置：

- 主聊天 System Prompt 和 Prompt 预设。
- 最大输出 token。
- 是否从上下文中剔除 `<thinking>...</thinking>`。
- 隐藏楼层范围。
- 是否启用 Prompt Cache。
- 是否把生理期记录附带给 AI。

### TTS 配置

设置页「TTS 配置」使用 MiniMax T2A：

- `Group ID`
- `API Key`
- `Voice ID`
- 模型，例如 `speech-02-hd`、`speech-02-turbo`、`speech-2.8-hd`
- 语速、音量、音调

TTS 用于普通消息朗读，也用于 AI 电台主持词。

### Tool 设置

设置页「Tool 设置」可分别启用：

- Memory Vault：填写 Base URL、管理员 Token、返回条数、token 预算、最大调用次数。
- Web Search：填写 Tavily API Key 和最大结果数。
- Web Page Reader：开启链接读取，可选渲染服务地址。
- Web Interaction：设置每轮最大网页操作次数和默认 UA 行为。
- AI 网页巡游 Hotboard：填写 UAPI API Key 并选择热榜平台。
- Native Tools：设备信息、电池状态、应用使用统计、日历。
- Shizuku 文件工具：开启后添加授权根目录，并配置单轮最大文件工具调用次数。

### 共读设置

AI 共读页「设置」中可配置独立 API，也可以复制当前主聊天 API：

- `Base URL`
- `API Key`
- `Model`
- 共读 System Prompt
- 总结 System Prompt
- 每次附带的原文字数
- 每次附带的最近对话条数

### 网易云音乐

音乐页进入「歌单管理」后填写网易云 API 地址，例如局域网中的 NeteaseCloudMusicApi 服务地址。登录流程：

1. 填写 API 地址。
2. 点击获取二维码。
3. 用网易云音乐扫码。
4. 点击确认登录。
5. 刷新歌单并导入。

## 运行与检查

Windows PowerShell 下请使用 `npm.cmd` 和 `npx.cmd`，避免 PowerShell 执行被拦截的 `.ps1` shim。

```bash
# 安装依赖
npm.cmd install

# 启动 Expo 开发服务器
npx.cmd expo start

# Android development build
npm.cmd run android

# Web 预览
npm.cmd run web

# 类型检查
npm.cmd run typecheck
```

部分能力需要 development build、Android 原生权限或设备侧授权：

- 应用使用统计依赖 Android 原生能力和系统「使用情况访问权限」。
- 悬浮球需要系统悬浮窗权限。
- Shizuku 文件工具需要设备安装/运行 Shizuku，并在应用内添加授权根目录。
- 日历工具首次使用会请求系统日历权限。
- 后台音频、通知和 TTS 依赖对应 Expo 插件与权限配置。
- 图片、背景、头像、表情包等自定义素材会复制到应用文档目录。
- 备份分享到 Google Drive 使用系统分享入口；恢复从 Google Drive 选择文件时使用系统文件选择器。

## 构建

`eas.json` 已包含 `development`、`preview` 和 `production` profile：

```bash
# 内部分发 APK
npx.cmd eas build --platform android --profile preview

# development client APK
npx.cmd eas build --platform android --profile development
```

Android 包名为 `com.ysclaude.app`。Expo owner 为 `linwang_004`，EAS projectId 已写入 `app.json`。

## 项目结构

```text
app/
├── _layout.tsx              # 根布局、字体、通知、WebViewPanel、悬浮球和全局监听
├── index.tsx                # 主聊天页
├── history.tsx              # 历史对话
├── settings.tsx             # 设置页：API/对话/TTS/Tool/日记/悬浮球/表情包/美化
├── focus.tsx                # 番茄专注
├── music.tsx                # 播放器与 AI 电台入口
├── music-playlists.tsx      # 网易云歌单管理
├── m5stack.tsx              # Clawd/M5Stack 设备配置预留
├── chat/[id].tsx            # 历史对话详情
├── reading/
│   ├── index.tsx            # 共读书架、总结、共读设置
│   └── [id].tsx             # 阅读页、划线、目录、共读面板
└── game/
    ├── index.tsx            # 副本列表、API preset、场景配置
    └── [id].tsx             # 副本房间

src/
├── components/              # 聊天气泡、输入框、模型选择器、WebView 面板、表情渲染等
├── db/                      # SQLite 初始化、迁移、CRUD、KV storage
├── hooks/                   # 键盘高度等通用 hook
├── services/                # API、TTS、工具、WebView、音乐、导入、备份、通知等服务
├── services/toolModules/    # Memory Vault、Web Search、网页读取、WebView、Native Tool、Shizuku、Hotboard
├── stores/                  # chat/settings/diary/focus/music/netease/radio/game/period
├── theme/                   # 颜色与字体
├── types/                   # 全局 TypeScript 类型
└── utils/                   # 时间、楼层范围、贴纸、热榜平台、专注/生理期上下文等
```

## 数据持久化

- SQLite 数据库名：主库 `ysclaude.db`，Zustand 持久化设置库 `ysclaude_kv.db`
- 核心表：对话、消息、日记、生理期记录、共读书籍、共读消息、阅读笔记、划线、专注任务、专注会话等。
- Zustand persist 通过 `src/db/kv-storage.ts` 落到 SQLite，保存设置、音乐、网易云、游戏副本、表情包、外观主题等状态。
- 数据库迁移基于 `PRAGMA user_version`，并额外使用列存在性检查，避免全新安装重复 `ALTER TABLE`。
- 备份恢复功能通过 `src/services/backup.ts` 打包/恢复数据；导出数据库使用 SQLite serialize，避免直接复制打开中的数据库文件。

## 主要外部服务

- OpenAI 兼容聊天/模型接口。
- MiniMax T2A。
- Memory Vault，自建记忆库服务。
- Tavily Search。
- UAPI 热榜。
- 可选网页渲染读取服务。
- NeteaseCloudMusicApi 或兼容网易云接口。
- Shizuku，提供 Android 侧授权文件访问能力。

## License

MIT
