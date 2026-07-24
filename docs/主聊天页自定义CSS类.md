# 主聊天页自定义 CSS 类

美化页的「高级自定义 CSS」会把 CSS 声明转换成 React Native style。它不是浏览器 DOM CSS：任意 selector 都可以被解析保存，但只有主聊天页中已经挂载的类会影响界面。

## 顶栏

| 类名 | 作用位置 |
| --- | --- |
| `.top-bar` | 主聊天页顶部栏容器 |
| `.chat-top-bar` | 顶部栏容器别名 |
| `.top-bar-background` | 顶栏自定义背景图片 |
| `.chat-top-bar-background` | 顶栏背景图片别名 |
| `.top-bar-fade` | 顶栏渐隐遮罩 |
| `.chat-top-bar-fade` | 顶栏渐隐遮罩别名 |
| `.top-bar-left` | 顶栏左侧按钮组 |
| `.top-bar-left-group` | 顶栏左侧按钮组别名 |
| `.top-bar-right` | 顶栏右侧按钮组 |
| `.top-bar-right-group` | 顶栏右侧按钮组别名 |
| `.top-bar-center` | 顶栏中间 Clawd 入口区域 |
| `.top-bar-center-slot` | 中间入口区域别名 |
| `.top-bar-button` | 顶栏所有普通按钮 |
| `.top-bar-history-button` | 历史按钮 |
| `.top-bar-reading-button` | 阅读按钮 |
| `.top-bar-web-button` | Web 按钮 |
| `.top-bar-game-button` | 游戏按钮 |
| `.top-bar-focus-button` | 专注按钮 |
| `.top-bar-calendar-button` | 日历按钮 |
| `.top-bar-music-button` | 音乐按钮 |
| `.top-bar-settings-button` | 设置按钮 |
| `.top-bar-center-button` | 中间 Clawd 按钮 |
| `.top-bar-clawd-button` | 中间 Clawd 按钮别名 |
| `.top-bar-icon` | 顶栏所有图标外层 |
| `.top-bar-history-icon` | 历史图标 |
| `.top-bar-reading-icon` | 阅读图标 |
| `.top-bar-web-icon` | Web 图标 |
| `.top-bar-game-icon` | 游戏图标 |
| `.top-bar-focus-icon` | 专注图标 |
| `.top-bar-calendar-icon` | 日历图标 |
| `.top-bar-music-icon` | 音乐图标 |
| `.top-bar-settings-icon` | 设置图标 |
| `.top-bar-clawd-icon` | 中间 Clawd 图标 |

顶栏默认高度是 `96`，左右按钮组和中间按钮默认都固定在 `top: 48`。如果只想加高顶栏背景区域，改 `.top-bar { height: ... }`；消息列表顶部留白和文字渐隐高度会跟随这个数值。如果想移动按钮位置，改 `.top-bar-left`、`.top-bar-right`、`.top-bar-center` 的 `top`。

`.top-bar-background` 可以用 `opacity` 调整自定义背景图透明度；`.top-bar-fade` 的 `background-color` 会作为顶栏渐隐遮罩颜色，例如 `#ffffff` 会生成白色到透明的渐变遮罩。

## 灵动岛

| 类名 | 作用位置 |
| --- | --- |
| `.dynamic-island-overlay` | 灵动岛全屏定位层，可用 `top` 调整垂直位置 |
| `.dynamic-island` | 药丸与展开面板的共同外层，可设置背景、边框和阴影 |
| `.dynamic-island-collapsed-content` | 收起时 Logo 与 Token 的横向容器 |
| `.dynamic-island-logo` | 收起与展开状态的 Claude Logo |
| `.dynamic-island-panel-logo` | 仅展开面板的 Claude Logo |
| `.dynamic-island-text` | 灵动岛内全部已挂载文字的通用样式 |
| `.dynamic-island-token-group` | 右侧输入/输出 Token 组 |
| `.dynamic-island-input-arrow` | 输入箭头 |
| `.dynamic-island-output-arrow` | 输出箭头 |
| `.dynamic-island-token-count` | 收起状态的 Token 数字 |
| `.dynamic-island-music-content` | 音乐状态横向容器 |
| `.dynamic-island-music-cover` | 歌曲封面外框 |
| `.dynamic-island-music-cover-fallback` | 无歌曲封面时的音符文字 |
| `.dynamic-island-music-effect` | 音柱效果外层 |
| `.dynamic-island-music-bar` | 每根音乐音柱 |
| `.dynamic-island-panel` | 展开详情内容区 |
| `.dynamic-island-title` | 展开面板标题 |
| `.dynamic-island-status` | 调用状态标签 |
| `.dynamic-island-model` | 模型名称 |
| `.dynamic-island-meta` | 功能、时间和耗时信息 |
| `.dynamic-island-metric-card` | Token 指标卡片 |
| `.dynamic-island-metric-label` | Token 指标标题 |
| `.dynamic-island-metric-value` | Token 指标数字 |
| `.dynamic-island-quota` | Claude 额度区域 |
| `.dynamic-island-quota-title` | 额度标题 |
| `.dynamic-island-quota-account` | 额度账号与同步状态 |
| `.dynamic-island-quota-label` | 额度周期名称 |
| `.dynamic-island-quota-percent` | 剩余额度百分比 |
| `.dynamic-island-quota-reset` | 额度重置时间 |
| `.dynamic-island-quota-track` | 额度进度条轨道 |
| `.dynamic-island-quota-fill` | 额度进度条填充 |
| `.dynamic-island-quota-error` | 额度同步错误文字 |
| `.dynamic-island-empty-text` | 暂无 API 日志提示文字 |

Logo 是单色 PNG，可使用 `tint-color` 修改颜色。灵动岛的宽、高和圆角由展开/收起弹簧动画控制，`.dynamic-island` 中的这些属性不会覆盖动画目标值；位置、背景、边框、阴影和透明度可以正常覆盖。

```css
.dynamic-island-overlay {
  top: 8px;
}

.dynamic-island {
  background-color: #080808;
  border-width: 1px;
  border-color: rgba(255,255,255,0.12);
}

.dynamic-island-logo {
  width: 21px;
  height: 21px;
  tint-color: #d97757;
}

.dynamic-island-input-arrow {
  color: #45c779;
}

.dynamic-island-output-arrow {
  color: #ef6464;
}

.dynamic-island-token-count,
.dynamic-island-metric-value {
  color: #e5e5e5;
}

.dynamic-island-music-cover {
  border-radius: 7px;
}

.dynamic-island-music-bar {
  width: 3px;
  background-color: #ffffff;
}

.dynamic-island-metric-card {
  background-color: #181818;
}

.dynamic-island-quota-fill {
  background-color: #45c779;
}
```

## 消息区域

| 类名 | 作用位置 |
| --- | --- |
| `.user-row` | 用户消息整行容器 |
| `.chat-user-row` | 用户消息整行容器别名 |
| `.user-message` | 用户消息列容器 |
| `.chat-user-message` | 用户消息列容器别名 |
| `.chat-user-column` | 用户消息列容器别名 |
| `.user-bubble` | 用户消息气泡 |
| `.chat-user-bubble` | 用户消息气泡别名 |
| `.user-bubble-tail` | 用户消息气泡尾巴，默认隐藏 |
| `.chat-user-bubble-tail` | 用户气泡尾巴别名 |
| `.user-bubble-tail-svg` | 用户消息 SVG 气泡尾巴，默认隐藏 |
| `.chat-user-bubble-tail-svg` | 用户 SVG 气泡尾巴别名 |
| `.user-text` | 用户消息文字/Markdown 正文 |
| `.chat-user-text` | 用户消息文字/Markdown 正文别名 |
| `.user-image` | 用户发送图片 |
| `.chat-user-image` | 用户发送图片别名 |
| `.reference-image` | 生图参考图缩略图 |
| `.chat-reference-image` | 生图参考图缩略图别名 |
| `.assistant-message` | AI 消息整行容器 |
| `.assistant-row` | AI 消息整行容器别名 |
| `.chat-assistant-row` | AI 消息整行容器别名 |
| `.assistant-bubble` | AI 气泡模式下的消息气泡 |
| `.chat-assistant-bubble` | AI 气泡别名 |
| `.assistant-bubble-stack` | AI 气泡模式下，同一条 AI 消息内多个气泡的纵向容器 |
| `.chat-assistant-bubble-stack` | AI 气泡纵向容器别名 |
| `.assistant-bubble-tail` | AI 气泡模式下的气泡尾巴，默认隐藏 |
| `.chat-assistant-bubble-tail` | AI 气泡尾巴别名 |
| `.assistant-bubble-tail-svg` | AI 气泡模式下的 SVG 气泡尾巴，默认隐藏 |
| `.chat-assistant-bubble-tail-svg` | AI SVG 气泡尾巴别名 |
| `.assistant-content` | AI 非气泡模式正文区域 |
| `.chat-assistant-content` | AI 正文区域别名 |
| `.assistant-text` | AI 消息文字/Markdown 正文 |
| `.chat-assistant-text` | AI 消息文字/Markdown 正文别名 |

## 消息头像

头像类只有在美化页打开「显示消息头像」后才会出现。

| 类名 | 作用位置 |
| --- | --- |
| `.message-avatar-row` | 头像、名称、楼层时间所在行 |
| `.chat-message-avatar-row` | 头像行别名 |
| `.user-avatar-row` | 用户头像行 |
| `.chat-user-avatar-row` | 用户头像行别名 |
| `.assistant-avatar-row` | AI 头像行 |
| `.chat-assistant-avatar-row` | AI 头像行别名 |
| `.message-avatar` | 所有头像外观，图片头像和文字头像都会应用 |
| `.chat-message-avatar` | 头像外观别名 |
| `.message-avatar-image` | 图片头像 |
| `.message-avatar-fallback` | 没有图片时的文字头像圆块 |
| `.user-avatar` | 用户头像外观 |
| `.chat-user-avatar` | 用户头像外观别名 |
| `.user-avatar-image` | 用户图片头像 |
| `.user-avatar-fallback` | 用户文字头像圆块 |
| `.assistant-avatar` | AI 头像外观 |
| `.chat-assistant-avatar` | AI 头像外观别名 |
| `.assistant-avatar-image` | AI 图片头像 |
| `.assistant-avatar-fallback` | AI 文字头像圆块 |
| `.message-avatar-text` | 文字头像里的字 |
| `.message-avatar-fallback-text` | 文字头像里的字别名 |
| `.user-avatar-text` | 用户文字头像里的字 |
| `.user-avatar-fallback-text` | 用户文字头像里的字别名 |
| `.assistant-avatar-text` | AI 文字头像里的字 |
| `.assistant-avatar-fallback-text` | AI 文字头像里的字别名 |
| `.message-avatar-name` | 头像名称 |
| `.user-avatar-name` | 用户名称 |
| `.assistant-avatar-name` | AI 名称 |
| `.message-avatar-meta` | 楼层号和时间 |
| `.user-avatar-meta` | 用户楼层号和时间 |
| `.assistant-avatar-meta` | AI 楼层号和时间 |
| `.message-avatar-side-row` | 侧边头像模式下，头像和气泡所在横向行 |
| `.user-avatar-side-row` | 用户侧边头像横向行 |
| `.assistant-avatar-side-row` | AI 侧边头像横向行 |
| `.message-avatar-side-slot` | 侧边头像槽位 |
| `.user-avatar-side-slot` | 用户侧边头像槽位 |
| `.assistant-avatar-side-slot` | AI 侧边头像槽位 |

## 输入栏

| 类名 | 作用位置 |
| --- | --- |
| `.input-wrapper` | 输入栏外层区域，适合放阴影 |
| `.chat-input-wrapper` | 输入栏外层区域别名 |
| `.chat-input` | 输入栏最外层容器 |
| `.input-container` | 输入栏最外层容器别名 |
| `.input-bar` | 输入栏最外层容器别名 |
| `.input-text` | 输入框文字区域 |
| `.input-toolbar` | 默认输入栏底部工具栏 |
| `.input-compact-row` | 紧凑输入栏横向布局 |
| `.input-actions` | 右侧按钮组 |
| `.options-button` | 左侧选项按钮 |
| `.sticker-button` | 表情包按钮 |
| `.send-button` | 发送/停止/触发回复按钮 |
| `.model-pill` | 当前模型胶囊按钮 |
| `.input-preview-row` | 待发送图片预览行 |
| `.input-preview` | 待发送图片预览容器 |
| `.input-reference-row` | 生图参考图预览行 |
| `.input-reference-preview` | 单张生图参考图预览容器 |

## 支持的属性

常用可用属性包括：

```css
background-color
border-color
border-width
border-radius
box-shadow
color
font-size
font-weight
line-height
margin
margin-top
margin-right
margin-bottom
margin-left
padding
padding-top
padding-right
padding-bottom
padding-left
width
height
min-width
max-width
min-height
max-height
opacity
svg-path
svg-view-box
text-align
```

也支持对应的 camelCase 写法，例如 `backgroundColor`、`borderRadius`、`fontSize`。

## 示例

```css
.user-message {
  max-width: 86%;
}

.user-bubble {
  background-color: rgba(255,255,255,0.82);
  border-radius: 22px;
  padding: 12px 14px;
}

.assistant-text {
  color: #25221f;
  font-size: 17px;
  line-height: 25px;
}

.input-bar {
  border-width: 0;
  border-color: transparent;
  border-radius: 25px;
  box-shadow: 0 0 15px 0 rgba(0,0,0,0.05);
}

.top-bar-button {
  background-color: rgba(255,255,255,0.52);
  border-radius: 14px;
}

.top-bar {
  height: 124px;
}

.top-bar-background {
  opacity: 0.78;
}

.top-bar-fade {
  background-color: #ffffff;
  opacity: 0.86;
}

.top-bar-left,
.top-bar-right,
.top-bar-center {
  top: 58px;
}

.top-bar-icon {
  color: #2f2a25;
  opacity: 0.9;
}

.message-avatar {
  width: 34px;
  height: 34px;
  border-radius: 17px;
  border-width: 1px;
  border-color: rgba(255,255,255,0.8);
  box-shadow: 0 3px 8px rgba(0,0,0,0.12);
}

.message-avatar-name {
  color: #5e554d;
  font-size: 12px;
}

.message-avatar-side-slot {
  margin-top: 2px;
}

.send-button {
  opacity: 0.86;
}
```

## 气泡尾巴

`.user-bubble-tail` 和 `.assistant-bubble-tail` 默认是隐藏的三角形节点；写 `display: flex` 后会显示。尾巴位于气泡内部，通常需要把气泡的 `overflow` 设为 `visible`，尤其是 AI 气泡默认会裁剪内容。

用户和 AI 纯表情包消息不会显示气泡尾巴，避免表情包被尾巴拉开距离；其中用户纯表情包会直接渲染图片，不应用 `.user-bubble`。

如果想要更圆润的尾巴，可以改用 SVG 尾巴类：`.user-bubble-tail-svg` 和 `.assistant-bubble-tail-svg`。SVG 尾巴同样默认隐藏，写 `display: flex` 后显示；填充色优先读取 `color`，其次读取 `background-color`。

同一方在时间分隔阈值内连续发送多条消息时，普通三角尾巴仍会显示在每个气泡上；SVG 尾巴只会显示在最后一条消息上。

SVG 尾巴还支持自定义路径：`svg-view-box` 对应 SVG 的 `viewBox`，`svg-path` 对应 `<Path d="...">`。路径值只支持常见 SVG path 命令和数字字符；如果写了不支持的字符会被忽略。

模拟微信样式可以这样写：

```css
.user-bubble {
  background-color: #95ec69;
  border-radius: 7px;
  border-top-right-radius: 2px;
  padding: 9px 11px;
  overflow: visible;
}

.assistant-bubble {
  background-color: #ffffff;
  border-radius: 7px;
  border-top-left-radius: 2px;
  padding: 9px 11px;
  overflow: visible;
}

.assistant-bubble-stack {
  gap: 2px;
}

.user-bubble-tail {
  display: flex;
  right: -6px;
  top: 9px;
  width: 0px;
  height: 0px;
  border-top-width: 5px;
  border-bottom-width: 5px;
  border-left-width: 7px;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-left-color: #95ec69;
}

.assistant-bubble-tail {
  display: flex;
  left: -6px;
  top: 9px;
  width: 0px;
  height: 0px;
  border-top-width: 5px;
  border-bottom-width: 5px;
  border-right-width: 7px;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-right-color: #ffffff;
}
```

使用 SVG 尾巴时，可以把上面两段 `*-bubble-tail` 换成：

```css
.user-bubble-tail-svg {
  display: flex;
  right: -10px;
  bottom: -2px;
  width: 18px;
  height: 20px;
  color: #95ec69;
}

.assistant-bubble-tail-svg {
  display: flex;
  left: -10px;
  bottom: -2px;
  width: 18px;
  height: 20px;
  color: #ffffff;
}
```

自定义 SVG 路径示例：

```css
.user-bubble-tail-svg {
  display: flex;
  right: -10px;
  bottom: -2px;
  width: 18px;
  height: 20px;
  color: #007aff;
  svg-view-box: 0 0 18 20;
  svg-path: M0 0 C1.8 6.2 6.4 10.8 14.6 11.6 C11.5 13.1 11.4 16.9 17.4 20 C8.2 19.4 1.8 13.7 0 5.2 Z;
}
```

## 磨砂玻璃气泡

给用户或 AI 气泡写 `backdrop-filter: blur(...)` 会启用 `expo-blur` 的背景模糊层。建议同时使用半透明背景色和细边框，玻璃感会更明显：

```css
.user-bubble {
  backdrop-filter: blur(18px);
  blur-intensity: 72;
  blur-reduction-factor: 2;
  blur-tint: light;
  background-color: rgba(255,255,255,0.30);
  border-width: 1px;
  border-color: rgba(255,255,255,0.42);
  box-shadow: 0 6px 18px rgba(0,0,0,0.12);
}

.assistant-bubble {
  backdrop-filter: blur(18px);
  blur-intensity: 68;
  blur-reduction-factor: 2;
  blur-tint: light;
  background-color: rgba(255,255,255,0.24);
  border-width: 1px;
  border-color: rgba(255,255,255,0.36);
}
```

Android 12 及以上会使用原生 `BlurView`。`blur-reduction-factor` 可在 `1` 到 `10` 之间调整，数值越小，Android 上的实际模糊越强。顶栏和输入框也可以分别启用：

```css
.top-bar {
  backdrop-filter: blur(20px);
  blur-intensity: 76;
  blur-reduction-factor: 2;
  background-color: rgba(255,255,255,0.16);
}

.input-bar {
  backdrop-filter: blur(20px);
  blur-intensity: 76;
  blur-reduction-factor: 2;
  background-color: rgba(255,255,255,0.18);
}
```

如果 AI 消息没有开启「气泡」样式，`.assistant-bubble` 不会出现；需要先在美化页把 AI 气泡模式打开。

## 注意

复杂浏览器 CSS 不会生效，例如伪类、子选择器、媒体查询、`filter`、动画等。新增页面区域如果需要被 CSS 调整，需要先在对应组件里挂一个 selector。
