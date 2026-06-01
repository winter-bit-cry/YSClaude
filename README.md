# YSClaude

## AI 网页巡游

AI 网页巡游是聊天页左下角加号菜单中的工具入口。点击后会在对话中插入一条可见系统消息「已启用 AI 网页巡游」，这条消息不会立刻触发回复；用户可以继续补充想看的平台或方向，然后点击发送键开始巡游。

巡游工作流会先调用 UAPI 热榜接口获取热搜，再从榜单中挑选 1-3 个带链接的话题，用 App 内 WebView 打开网页查看内容，最后只选择 1 个话题自然回复用户。热榜接口需要在设置页的 Tool 设置中开启 AI 网页巡游 Hotboard，并填写 UAPI API Key；支持的平台可在可折叠的平台面板中勾选。

巡游模式下通过 WebView 打开的网页会使用桌面端 User-Agent，普通 WebView 网页交互仍使用默认 User-Agent。针对部分站点的登录、注册、打开 App、下载客户端遮罩，WebView 会注入保守的清理脚本优先点击关闭按钮；桌面页面会额外启用横向和纵向滚动，方便在移动端小窗口中查看 PC 版页面。

精简版 Claude 客户端，React Native + Expo 构建，打包为 Android APK。个人使用。

## 技术栈

| 层面 | 选型 |
|------|------|
| 框架 | React Native + Expo (SDK 56) |
| 路由 | expo-router |
| 状态管理 | Zustand (persist) |
| 本地存储 | expo-sqlite |
| API 格式 | OpenAI 兼容 (`/v1/chat/completions`) |
| Markdown | @ronradtke/react-native-markdown-display |
| TTS | MiniMax T2A (expo-audio + expo-file-system) |
| WebView | react-native-webview |
| 设备能力 | expo-device / expo-battery / expo-calendar |
| 打包 | EAS Build → APK |

## 功能

### 核心（已完成）
- 文本对话（OpenAI 兼容格式）
- 流式输出（SSE 逐 token 渲染）
- Markdown 渲染（代码块深色高亮，长表格在气泡内横向滚动）
- 对话历史管理（SQLite 持久化、恢复、删除、重命名）
- 多 API 配置管理（命名保存、同名覆盖、拉取模型列表、测试连接）
- 多模型随时切换
- TTS 语音播放（MiniMax 语音合成，支持自定义 Voice ID）
- System Prompt 自定义（自动在最前注入当前时间）
- 空输入触发回复：输入框为空时也可点击发送键直接请求 AI 回复
- 消息隐藏（节省 token）
  - 按对话独立保存，切换对话自动加载各自的隐藏范围
  - 重叠或相邻范围自动合并（如 1-6 与 3-7 合并为 1-7）
  - 填写起止楼层后实时预览该范围的首尾两条消息
  - 已隐藏楼层在聊天界面降低透明度并标注「已隐藏」
- AI 输出长度限制
- 时间戳分隔（相邻消息间隔 ≥ 30 分钟时，聊天页插入居中小字时间，并同步告知 AI）
- 图片消息 + AI 识图
  - 点击输入栏左侧加号从相册选择图片，发送前可在输入框内预览/取消
  - 图片以无气泡形式直接展示在对话内（圆角缩略图）
  - 自动转 base64 data URL，以 OpenAI 视觉格式（`image_url` 多段内容）发送给模型，让 AI 识别图片内容
  - 图片随消息持久化（SQLite 存储本地 URI），重开历史对话仍可见
- 聊天页 UI
  - 悬浮输入框：仅输入框气泡悬浮于聊天内容之上，两侧与下方留透明空隙，滚动时可透出底层聊天记录
  - 工具调用展示：AI 回复中实际发生的工具调用以「时钟图标 + 动作描述 + 展开箭头」单行展示于正文上方，每次调用一行，随消息持久化（重开历史对话仍可见）
  - 工具调用详情：点击工具调用行可展开参数与执行结果，便于调试工具链行为
  - 思维链折叠：AI 输出中 `<thinking>...</thinking>` 包裹的内容拆分为可点击展开的「Thought process」胶囊，正文仅渲染剩余部分
- 日记系统
  - AI 日记总结：选择消息范围，AI 以第一人称流水账形式自动总结为日记
  - 手动添加：在日记 tab 点「+ 新建」可手动撰写日记（标题留空自动生成）
  - 手动编辑：支持创建、编辑、删除日记
  - 收藏功能：收藏的日记会作为近期日记注入 AI 上下文，让 AI 了解你的生活（仅注入标题+正文，不含时间戳，日期由用户自行写入标题）
  - AI 日记查询：AI 可通过 `query_diary` 工具按日期查询日记内容
  - 上传云端：每条日记可单独上传到 Memory Vault 云端记忆库（上传时确认日期，标题并入正文）
  - SQLite 持久化存储

### 扩展
- MCP Tool 调用
  - Memory Vault 记忆库语义检索
  - 日记查询（按日期）
  - 日记上传：将本地日记单条上传到云端记忆库（管理接口，需管理员 Token）
  - Tavily 联网搜索
  - 网页读取：用户发送链接后，AI 可调用 `read_web_page` 抓取标题、正文和摘要；可选配置 JS 渲染读取服务兜底
  - 网页交互：AI 可在 App 内打开可见 WebView 面板，并通过 `webview_open` / `webview_observe` / `webview_click_element` / `webview_click_selector` / `webview_tap` / `webview_wait` 进行简单网页操作
  - 设备原生 Tools：可选开启 `read_device_info`、`read_battery_status`、`read_app_usage_stats`、`calendar_list_events`、`calendar_create_event`、`calendar_update_event`、`calendar_delete_event`
  - 日历工具：通过 Expo Calendar 读写系统日历；首次使用会请求系统日历权限
  - 应用使用统计：Android 专属能力，依赖 `AndroidSystemTools` 原生模块；未打入原生模块时会返回需要重新安装 development build 的说明
  - 流式 Tool 调用：启用工具后仍使用流式输出；模型需要工具时暂停执行工具，再继续流式回复
  - 流式 tool_call 合并：兼容部分模型把工具名或多个工具调用分片输出的情况，减少工具名串联或调用错位
  - 工具调用可视化：AI 调用工具时在回复上方逐行展示「调用了什么工具 + 参数」（clock 图标 + 描述 + 箭头），点击可查看参数和结果，随消息持久化
- WebView 网页面板
  - AI 打开网页时，用户端同步显示可见窗口
  - 顶部标题栏可拖动，右下角可缩放窗口大小
  - 同一链接重复打开时优先复用当前页面状态，不强制刷新
  - 普通 DOM 点击优先使用元素编号 / selector，坐标点击主要用于 canvas 或无标准控件的页面
- 思维链展示：AI 输出中 `<thinking></thinking>` 包裹的内容自动折叠为「Thought process」胶囊，单击展开查看

### 未来规划
  - AI后台消息
  - 共读功能
  - AI网络新闻迅游
  - 悬浮窗
  - STT

## TTS 配置

使用 MiniMax 语音合成服务，需在设置 > TTS 配置中填写：

- **Group ID** — MiniMax 控制台获取
- **API Key** — MiniMax API 密钥
- **Voice ID** — 音色 ID（如 `male-qn-qingse`、`Wise_Woman` 等）
- **模型** — `speech-02-hd` / `speech-02-turbo` / `speech-2.8-hd`
- 语速、音量、音调可调

配置完成后可点击「测试播放」验证，保存后持久化到本地。

## 记忆库（Memory Vault）配置

在设置 > Tool 设置 > 记忆库中配置，连接自建的 Memory Vault 记忆向量库（FastAPI + ChromaDB）：

- **记忆库地址** — 服务的 Base URL（如 `https://your-memory-vault.com`）
- **管理员 Token** — 上传日记所需的认证 token（对应服务端的 `ADMIN_TOKEN`）。语义搜索 / 日记查询走公开接口无需 token，仅**上传日记**用到
- **返回条数 / Token 预算 / 最大查询次数** — 语义搜索参数

配置后可点击「测试连接」验证（请求 `/health`）。

**上传本地日记到云端**：在日记 tab 点任意日记的「上传」按钮，确认/修改日期（`YYYY-MM-DD`）后上传。日记标题会并入正文（`标题\n正文`）一起上传，调用服务端 `POST /api/diary`（仅保存原文，不自动 LLM 拆分）。

> 注意：云端日记以日期为主键（一个日期对应一篇），同一天重复上传可能覆盖。

## Tool 设置

在设置 > Tool 设置中可分别开启以下工具能力：

- **记忆库 Memory Vault** — 连接自建记忆库，供 AI 搜索记忆和查询日记
- **联网搜索 Web Search** — 配置 Tavily API Key 后，AI 可搜索实时信息
- **网页读取 Web Page Reader** — 开启后，用户发送 `http/https` 链接时，AI 可调用 `read_web_page` 读取网页正文
  - 静态网页会直接抓取 HTML 并提取正文
  - 动态网页可选配置 Playwright 等后端渲染读取服务地址
- **网页交互 Web Interaction** — 开启后，用户发送链接时，AI 可在 App 内打开可见 WebView 窗口并进行简单操作
  - 支持打开、观察、点击元素、点击 selector、坐标点击、等待
  - 适合简单网页交互和轻量前端小游戏
  - 每轮最大操作次数可配置，防止无限循环
- **设备原生 Tools** — 可按能力分别开启设备信息、电池状态、应用使用统计和日历日程管理
  - 设备信息：读取品牌、型号、系统版本、设备类型、内存、运行时长等
  - 电池状态：读取电量、充电状态、低电量模式和 Android 电池优化状态
  - 应用使用统计：Android 专属；首次使用需到系统「使用情况访问权限」中授权，且需要包含 `AndroidSystemTools` 的 development build
  - 日历日程：支持读取、创建、修改、删除系统日历日程，首次使用会请求日历权限

网页交互窗口会出现在 App 内，用户可拖动标题栏改变位置，也可拖动右下角调整大小。窗口关闭前会保留当前页面状态，后续 AI 可继续观察和操作。

## 运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npx expo start

# 手机测试（Expo Go 扫码）
npx expo start --tunnel

# 浏览器预览
npx expo start --web
```

## 项目结构

```
app/                        # expo-router 页面
├── _layout.tsx             # 根布局（Stack）
├── index.tsx               # 对话主界面
├── history.tsx             # 对话历史（☰ 触发）
├── settings.tsx            # 设置页（⋯ 触发）
└── chat/[id].tsx           # 历史对话详情

src/
├── components/
│   ├── ChatBubble.tsx      # 消息气泡 + 操作图标 + 工具调用行 + 思维链折叠
│   ├── ChatInput.tsx       # 输入框 + 工具栏
│   ├── ModelSelector.tsx   # 模型切换弹窗
│   ├── StickerContent.tsx  # 表情包 token 分段 + 助手 Markdown 渲染
│   ├── TimeDivider.tsx     # 消息间居中时间分隔（间隔 >30min 时显示）
│   └── WebViewPanel.tsx    # AI 网页交互面板（可拖动、可缩放）
├── services/
│   ├── api.ts              # 流式 API 调用（SSE + stream tool_calls）
│   ├── nativeTools.ts      # 设备信息 / 电池 / 应用使用统计 / 日历工具实现
│   ├── tts.ts              # MiniMax TTS 语音合成
│   ├── tools.ts            # 工具定义与执行（记忆库 / 搜索 / 网页读取 / 网页交互 / 设备原生）
│   └── webviewController.ts # Tool 与 WebViewPanel 的控制桥
├── utils/
│   ├── time.ts             # 时间格式化 + 消息间隔时间戳阈值
│   └── ranges.ts           # 隐藏楼层范围合并（重叠/相邻自动合并）
├── stores/
│   ├── chat.ts             # 对话状态 + 隐藏楼层（按对话独立）+ 持久化
│   ├── diary.ts            # 日记状态 + CRUD
│   └── settings.ts         # 配置状态（zustand persist + sqlite）
├── db/
│   ├── database.ts         # SQLite 初始化 + schema
│   ├── operations.ts       # 对话/消息/日记/隐藏楼层 CRUD
│   └── kv-storage.ts       # KV 存储适配器
├── hooks/
│   └── useKeyboardHeight.ts # 软键盘高度监听（edge-to-edge 输入框避让）
├── types/
│   └── index.ts            # TypeScript 类型定义
└── theme/
    ├── colors.ts           # 主题配色
    └── fonts.ts            # 字体配置
```

## 开发阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 | 项目骨架 + 对话 + 流式 + Markdown | ✅ |
| P1 | SQLite 持久化 + 历史管理 + 多配置 | ✅ |
| P2 | TTS 语音合成 + System Prompt + 对话设置 | ✅ |
| P3 | MCP Tool 框架 | - |
| P4 | Memory Vault + Tavily 搜索 | ✅ |
| P5 | EAS Build 打包 APK | - |
| P6 | 时间感知（system 注入当前时间 + 消息时间戳分隔） | ✅ |

## UI 设计

- 浅色暖米色主题，参考 Claude 官方客户端
- 顶栏：☰ 历史 / ✎ 新建 / ⋯ 设置
- 对话气泡：用户右对齐浅棕色，助手左对齐无背景 + Markdown
- 底部输入框：大圆角，内嵌模型选择器 pill
- 助手消息下方操作图标行（复制 / 删除 / TTS 播放）

## License

MIT
