# YSClaude

YSClaude 是一个基于 Expo 和 React Native 的 Android 优先 AI 伴侣应用。应用以聊天为主入口，围绕本地长期记忆、工具调用、网页交互、阅读、音乐、专注、日报、来信、悬浮窗和 Android 原生能力扩展，构建一个可长期运行、可本地持久化、可主动触达用户的移动端 AI 工作台。

本文档以技术栈、系统结构和实现方案为主，便于继续开发、排查问题和扩展功能。

## 更新记录

- 2026.07.10 更新本地Artifact文件与SSH连接的服务器文件互传，在「远程命令」+「对话文件」同时启用时自动激活。
- 2026.07.11
  - 新增发送真实定位功能：开启定位权限后抓取经纬度坐标，使用腾讯位置服务逆解析，在设置-工具设置页填写腾讯地图key，可在https://lbs.qq.com/申请，每日6000次免费额度。推荐使用高德地图MCP，AI可以根据提供的位置查天气、查周边、导航等。
  - 优化历史对话页UI。




## 技术栈

### 基础框架

- Expo SDK 56：项目依赖 `expo ~56.0.14`，并按 Expo SDK 56 文档进行开发。
- React Native 0.85.3：移动端 UI 和原生桥接基础。
- React 19.2.3 / React DOM 19.2.3：组件模型与 Web 兼容支持。
- Expo Router 56：基于 `app/` 目录的文件路由。
- TypeScript 6：开启 `strict` 模式，使用 `expo/tsconfig.base`。
- Node.js / Expo CLI：按 Expo SDK 56 版本文档准备本地运行环境。

### UI 与交互

- React Native 原生组件：页面、列表、弹窗、输入框、图片和触控交互。
- React Native Reanimated 4：键盘联动、消息入场动画、流式回复过程中的 UI 过渡。
- React Native Gesture Handler / Screens / Safe Area Context：导航、手势和安全区适配。
- Expo Splash Screen / Status Bar：启动屏和状态栏管理。
- Expo Linear Gradient / Blur / SVG / View Shot：视觉效果、图标渲染和截图能力。
- 字体：默认使用系统字体；仓库不提交本地字体文件。

### 数据与状态

- Zustand：聊天、设置、音乐、阅读、专注、日记、经期记录等业务状态管理。
- Expo SQLite：本地结构化数据持久化，包含对话、消息、阅读、日报、专注、API 用量等表。
- 自定义 SQLite KV Storage：为 Zustand 持久化配置提供本地 KV 存储。
- Expo File System / Asset / Media Library / Sharing：文件、资源、相册保存和系统分享。

### AI 与工具能力

- OpenAI 兼容 Chat Completions API：支持流式和非流式请求。
- Function Calling 工具体系：统一定义工具 schema、执行工具、记录调用结果。
- Prompt Cache / Thinking 配置：支持不同供应商兼容模式。
- 图像生成：通过独立配置调用 OpenAI 兼容图片生成接口，并将生成图状态落库。
- TTS：通过配置的语音接口播放回复。
- MCP 远程工具：将远程 MCP Server 的工具、资源读取能力转为模型可调用工具。

### Android 原生扩展

项目包含原生 Android 目录，属于自定义 Dev Client / 原生构建项目，不是纯托管 Expo 应用。

- Kotlin 原生模块：`FloatingBall`、`AndroidSystemTools`、`AndroidFilePicker`、`RemoteSshCommand`、`AccessibilityScreenContext`。
- Android Service：悬浮窗前台服务、屏幕采集服务、无障碍服务、输入法服务。
- Android 权限：悬浮窗、通知、前台服务、媒体投影、日历、相册、录音、网络、用量统计等。
- EAS Build：通过 `eas.json` 定义 development、preview、production 构建 profile。

## 系统结构

```text
.
├── app/                         # Expo Router 页面和路由入口
│   ├── _layout.tsx              # 全局初始化、导航栈、全局浮层
│   ├── index.tsx                # 主聊天界面
│   ├── chat/[id].tsx            # 指定会话入口
│   ├── settings.tsx             # 设置页
│   ├── reading/                 # 阅读模块
│   ├── game/                    # 游戏/脚本模块
│   └── daily-paper/[date].tsx   # 日报详情
├── src/
│   ├── components/              # 可复用 UI 组件
│   ├── db/                      # SQLite 初始化、迁移、CRUD
│   ├── hooks/                   # 交互相关 hooks
│   ├── screens/settings/        # 设置页分 tab 实现
│   ├── services/                # API、工具、原生能力、导入导出等服务
│   ├── stores/                  # Zustand 业务状态
│   ├── theme/                   # 字体、颜色、全局默认字体
│   ├── types/                   # 核心业务类型
│   └── utils/                   # 纯函数工具和 prompt 构造
├── android/                     # Android 原生工程与 Kotlin 模块
├── assets/                      # 图标、图片、音频等资源
├── app.json                     # Expo 配置、插件、权限、scheme
├── eas.json                     # EAS 构建配置
├── package.json                 # 依赖和脚本
└── tsconfig.json                # TypeScript 配置
```

## 核心模块

### 1. 应用启动与全局初始化

入口文件 `index.js` 先应用全局默认字体回退，再进入 `expo-router/entry`。

`app/_layout.tsx` 是应用级编排层，负责：

- 控制 Splash Screen 隐藏时机。
- 初始化通知渠道和通知权限。
- 启动前后台状态监听。
- 根据设置显示或隐藏 Android 悬浮球。
- 注册悬浮球动作监听，并转发到工具动作处理。
- 启动桌面歌词同步、专注状态监听和 Prompt Cache 远程快照同步。
- 挂载全局 `WebViewPanel` 和 `IncomingShareHandler`。
- 定义所有页面的 `Stack` 导航行为。

### 2. 路由与页面层

项目使用 Expo Router 文件路由：

- `app/index.tsx` 是默认首页，也是主聊天界面。
- `app/chat/[id].tsx` 支持从历史记录或外部入口进入指定会话。
- `app/settings.tsx` 聚合 API、工具、TTS、外观、悬浮球、来信等配置。
- `app/history.tsx` 管理会话历史。
- `app/music.tsx` 和 `app/music-playlists.tsx` 提供音乐播放和歌单能力。
- `app/focus.tsx` 提供专注计时。
- `app/reading/*` 提供本地书籍导入、阅读、笔记和 AI 阅读对话。
- `app/daily-paper/[date].tsx` 展示按日期生成的日报。
- `app/api-usage.tsx` 和 `app/api-achievements.tsx` 展示 API 用量与成就。

页面层主要做交互编排，不直接承担底层能力实现。网络、数据库、工具、原生模块等逻辑集中在 `src/services/`、`src/db/` 和 `src/stores/`。

### 3. 状态管理层

`src/stores/` 通过 Zustand 按业务域拆分状态：

- `chat.ts`：当前会话、消息分页、流式回复、工具调用、图片生成、隐藏楼层、远程收件箱同步。
- `settings.ts`：API 配置、工具开关、TTS、外观、Prompt Cache、悬浮球、MCP、日报、来信等配置。
- `music.ts` / `netease.ts` / `radio.ts`：音乐播放、网易云导入、AI 电台。
- `reading.ts` 相关能力分布在页面、服务和 DB 操作中。
- `focus.ts`：专注任务、专注会话和前后台状态恢复。
- `period.ts`：经期记录和预测。
- `diary.ts`：日记和记忆上传。
- `api-achievements.ts`：API 使用成就定义和状态。

设置类状态使用 SQLite KV Storage 持久化，业务数据则通过 `src/db/operations.ts` 进入结构化 SQLite 表。

### 4. 本地数据层

`src/db/database.ts` 负责打开数据库、建表和迁移。数据库文件为 `ysclaude.db`。

核心数据表包括：

- `conversations` / `messages`：会话、消息、工具调用、生成图片、隐藏消息。
- `diaries`：日记与收藏。
- `period_records`：经期记录。
- `daily_papers`：日报生成结果和来源。
- `incoming_letters`：主动来信。
- `reading_books` / `reading_messages` / `reading_notes` / `reading_highlights` / `reading_book_snapshots`：阅读书籍、阅读对话、笔记、高亮和快照。
- `focus_tasks` / `focus_sessions`：专注任务和专注会话。
- `api_usage_events`：API 请求、token、耗时和错误统计。
- `conversation_artifacts` / `conversation_artifact_versions`：对话文件和版本。

数据库初始化使用 in-flight Promise 保护，避免冷启动时多个查询并发触发表结构尚未初始化的竞态。迁移基于 `PRAGMA user_version`，同时使用列存在性检查防止全新安装时重复 `ALTER TABLE`。

### 5. AI 请求与流式回复

`src/services/api.ts` 封装 OpenAI 兼容接口：

- `chatCompletion`：非流式请求，主要用于 Tool Use 阶段。
- `streamChatCompletion`：带工具定义的流式请求。
- `streamChat`：普通流式聊天请求。

实现要点：

- 使用 `/chat/completions` 作为统一 API 路径。
- 流式请求通过 SSE `data:` 行解析增量 token。
- 支持 `stream_options.include_usage`，并记录 token 用量。
- 支持 reasoning / thinking 兼容模式，把原生 thinking 内容包装成 `<thinking>...</thinking>`。
- 支持 Prompt Cache 兼容头和 body 适配。
- 请求结果写入 `api_usage_events`，供用量页和成就系统消费。

`src/stores/chat.ts` 负责把 API 能力组织成完整对话流程：

1. 创建或加载会话。
2. 插入用户消息。
3. 构造系统 prompt、历史消息、运行时上下文和工具定义。
4. 发起流式回复。
5. 实时更新 assistant 消息内容。
6. 如模型返回工具调用，执行工具并把结果回填给模型。
7. 处理图片生成 token、TTS、悬浮球播报、通知和远程快照同步。
8. 持久化消息、工具调用、生成图状态和 API 用量。

### 6. 工具体系

工具统一由 `src/services/tools.ts` 聚合，具体模块位于 `src/services/toolModules/`。

当前工具模块包括：

- `memoryVault`：日记/记忆上传与检索。
- `webSearch`：联网搜索。
- `hotboard`：热榜数据。
- `runCommand`：远程 SSH 命令执行和远程文件读写。
- `sshArtifactTransfer`：对话文件与 SSH 服务器互传（上传 artifact 到服务器、拉取服务器文本文件为 artifact），仅在「远程命令」和「对话文件」同时启用时自动激活。
- `mcpRemote`：远程 MCP 工具和资源读取。
- `webView`：应用内 WebView 打开、观察、点击、截图、HTML artifact 编辑。
- `conversationArtifacts`：对话文件管理和版本化。
- `nativeDevice`：Android 设备、截图、无障碍上下文等原生能力。

每个工具模块实现统一接口：

- `labels`：工具名到显示名的映射。
- `getDefinitions(config)`：根据用户设置生成模型可见的 function schema。
- `execute(toolName, args, context)`：执行工具并返回文本或图片结果。

这种结构让模型工具能力可以按设置动态启用，也让新增工具时只需要实现一个模块并注册到 `TOOL_MODULES`。

### 7. WebView 与 HTML Artifact

`src/components/WebViewPanel.tsx` 提供全局 WebView 容器，`src/services/webviewController.ts` 提供命令式控制接口。

支持能力：

- 打开网页或 HTML artifact。
- 观察当前页面文本、元素和截图。
- 点击坐标、点击元素索引、点击 CSS selector。
- 等待页面变化。
- 读取、替换、patch HTML artifact 源码。
- 保存 artifact 到当前会话。

这使 AI 可以在应用内完成网页查看、交互和轻量网页作品编辑，而不需要跳出 App。

### 8. Android 原生能力

`android/app/src/main/java/com/ysclaude/app/` 中的 Kotlin 模块负责 React Native 无法直接覆盖的系统能力：

- `FloatingBallModule`：悬浮球显示、隐藏、状态更新、动作事件、前台服务和屏幕采集。
- `FloatingAccessibilityService`：无障碍节点读取与操作。
- `AccessibilityScreenContextModule`：把当前屏幕上下文暴露给 JS。
- `AndroidSystemToolsModule`：系统级工具接口。
- `AndroidFilePickerModule`：Android 文件选择。
- `RemoteSshCommandModule`：通过原生侧执行远程 SSH 命令。
- `YSClaudeInputMethodService`：输入法服务。

这些模块通过 React Native NativeModules 暴露给 `src/services/`，再被工具系统、悬浮球、通知或设置页调用。

## 核心实现方案

### 聊天主流程

聊天的核心是 `useChatStore`。它把 UI、数据库、模型 API 和工具系统串成一个状态机：

```text
用户输入
  -> addUserMessage 写入本地消息
  -> triggerResponse 构造请求上下文
  -> streamAssistantResponse 发起流式请求
  -> 增量 token 写入 assistant 消息
  -> 如出现 tool_calls，执行本地工具
  -> 将工具结果追加为 tool 消息继续请求
  -> 完成后落库、统计用量、触发通知/悬浮球/TTS/生图
```

消息列表采用分页加载，默认每页 20 条。支持向上加载旧消息、围绕指定消息打开会话、加载更新消息，以及通过 `hiddenRanges` / `hiddenMessageIds` 控制哪些历史发送给 AI 或在诊断中隐藏。

### Prompt 与上下文组装

请求上下文不只是聊天历史，还会按设置动态加入：

- 系统 prompt 和稳定 prompt cache 片段。
- 当前时间、音乐、专注、经期、日报等运行时上下文。
- 网页巡游、WebView 观察结果、Android 无障碍截图上下文。
- 已收藏日记、记忆库、MCP pinned resource。
- 远程命令操作提示。
- 图片生成、贴纸、工具说明等行为约束。

构造时会根据 Prompt Cache 配置标记缓存断点，并按不同供应商兼容模式调整请求格式。

### Tool Use 循环

模型返回工具调用后，应用会：

1. 将工具调用记录为 `ToolInvocation`，供消息气泡展示。
2. 根据工具名找到对应 `ToolModule`。
3. 执行工具并捕获结果或错误。
4. 将工具结果以 `tool` 消息形式回传给模型。
5. 继续请求，直到模型完成回复或被用户中止。

工具结果会持久化到消息中，既能回放，也能在调试页查看真实调用过程。

### 对话文件与服务器互传

当「远程命令」和「对话文件」两个工具同时开启时，`sshArtifactTransfer` 模块会自动向模型注入两个互传工具：

- `artifact_upload_to_server`：读取当前对话某个 artifact 的最新版本内容，通过持久化 SSH session 分块 base64 写入远程服务器指定路径（父目录自动创建，支持覆盖或追加）。
- `artifact_download_from_server`：先检查远程文件大小（上限 512KB），再分块 base64 拉取并严格按 UTF-8 解码校验，保存为当前对话的新 artifact，或以新版本形式覆盖已有 artifact。

文件内容全程在工具层直接流转，不经过模型上下文，避免大文件占用 token。二进制文件和超限文件会被拒绝。底层传输逻辑与 `ssh_read_file` / `ssh_write_file` 共用 `runCommand` 模块中的分块实现。

### 本地优先持久化

应用采用本地优先策略：

- 聊天、阅读、日报、专注、来信、成就和 API 用量全部落地到 SQLite。
- 设置类数据通过 SQLite KV Storage 持久化。
- 图片、书籍、附件等文件使用 Expo File System 或系统文件 URI。
- 数据库迁移内置在启动流程中，不依赖外部服务。

这种设计保证应用离线时仍能查看历史数据，也方便做备份、恢复和长期使用。

### Prompt Cache 远程保活

`src/services/promptCacheKeepalive.ts` 实现远程快照与收件箱机制：

- 本地成功命中 1h cache 后，可把会话快照同步到远程服务。
- App 前台恢复时拉取远程 inbox，把 AI 主动消息写入本地会话。
- 支持刷新远程服务器状态、手动 flush、ack inbox/activity。
- 支持远程推送配置测试，如 WxPusher、DingTalk。

主布局和聊天页都会触发同步，避免打开应用后主动消息延迟出现。

### 图像生成方案

AI 回复中出现 `[Pic:...]` token 时，`useChatStore` 会：

1. 解析 token 并创建 `GeneratedPicture` pending 状态。
2. 合并全局人脸参考图和当前消息参考图。
3. 根据图片生成配置调用 `generateOpenAIImage`。
4. 实时更新进度标签。
5. 成功后保存图片 URI，失败则记录错误。
6. 支持单图重试、仅删除图片、删除图片并移除 prompt token。

生成图状态和消息一起持久化，真实图片不自动作为视觉输入发回给聊天模型。

### 阅读与文档导入

阅读导入由 `src/services/readingImport.ts` 处理：

- 支持 TXT 和 EPUB。
- EPUB 通过 `fflate` 解压，并解析 OPF、章节和 HTML 内容。
- 书籍正文、章节、阅读进度、阅读消息、笔记、高亮和快照存入 SQLite。
- 阅读页可围绕当前书籍内容和笔记进行 AI 辅助阅读。

### 音乐与 AI 电台

音乐模块包括本地播放、网易云歌单导入和 AI 电台生成：

- `src/stores/music.ts` 管理播放队列、播放状态和歌词。
- `src/services/neteaseMusic.ts` 对接网易云相关 API。
- `src/services/aiRadio.ts` 生成开场、续播脚本和电台总结。
- `src/services/desktopLyrics.ts` 负责桌面歌词同步。

`expo-audio` 开启后台播放，Android 侧也注册了媒体播放前台服务。

### 通知、分享与主动触达

- `src/services/notifications.ts` 初始化通知 handler、Android 通知渠道和前后台状态。
- `IncomingShareHandler` 处理系统分享进来的文本链接。
- `incomingLetters` 根据配置生成指定日期来信，并在主界面弹出。
- 悬浮球可接收工具动作、展示流式回复片段、结合无障碍上下文进行操作。

## 开发命令

在 Windows PowerShell 中使用 `npm.cmd` 和 `npx.cmd`，避免执行被策略拦截的 `.ps1` shim。

```powershell
npm.cmd install
npm.cmd run start
npm.cmd run android
npm.cmd run web
npm.cmd run typecheck
```

如需要直接调用 Expo CLI：

```powershell
npx.cmd expo start
npx.cmd expo run:android
```

## 构建

本项目包含 Android 原生工程，适合使用 EAS 或本地原生构建。

```powershell
npx.cmd eas build --profile development --platform android
npx.cmd eas build --profile preview --platform android
npx.cmd eas build --profile production --platform android
```

`eas.json` 中：

- `development`：启用 development client，Android 输出 APK。
- `preview`：内部测试分发，Android 输出 APK。
- `production`：生产构建，自动递增版本。

## 配置入口

主要配置位于应用内设置页和 `src/stores/settings.ts`：

- API 渠道：base URL、API key、模型、温度、thinking、prompt cache。
- Tool：网页搜索、网页交互、热榜、MCP、远程命令、原生设备工具、conversation artifacts。
- TTS：语音接口配置。
- 外观：主题、背景、图标、欢迎语、自定义 CSS。
- 悬浮球：启用状态、素材、自动切换、动作。
- 图片生成：模型、尺寸、质量、人脸参考图。
- 日报和来信：来源、生成 prompt、触发日期。
- 阅读、经期、贴纸、API 成就等业务配置。

## 外部服务

这个应用的大部分核心数据是本地优先保存的，但部分功能需要配合后端服务或第三方接口使用：

- 缓存保活和消息离线推送：可参考另一个仓库 [winter-bit-cry/YSClaude-keepalive-server](https://github.com/winter-bit-cry/YSClaude-keepalive-server)，用于 Prompt Cache 远程快照、远程收件箱和离线消息推送等能力。
- 听歌功能的网易云歌单导入：可使用 [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 提供网易云音乐相关接口。

## 代码约定

- TypeScript 使用 strict 模式。
- 新页面优先放在 `app/`，可复用视图放在 `src/components/`。
- 业务状态放入对应 `src/stores/`，跨页面能力放入 `src/services/`。
- 新增 SQLite 表或字段时，同时更新 `initTables` 和 `runMigrations`。
- 新增模型工具时，实现 `ToolModule` 并注册到 `src/services/tools.ts`。
- 涉及 Android 系统能力时，优先通过 `src/services/` 包装原生模块，不在页面中直接访问 NativeModules。

## Expo SDK 56 参考

开发 Expo 相关能力前，优先查看当前项目指定的版本文档：

- https://docs.expo.dev/versions/v56.0.0/

## License

AGPL-3.0 + 禁止商业化。

本项目采用 AGPL-3.0，并附加禁止商业化使用限制。未经作者明确书面许可，不得将本项目或其衍生作品用于商业化产品、商业服务、付费分发或其它商业获利场景。
