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
  background-color: rgba(255,255,255,0.72);
  border-radius: 28px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
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

## 磨砂玻璃气泡

给用户或 AI 气泡写 `backdrop-filter: blur(...)` 会启用 `expo-blur` 的背景模糊层。建议同时使用半透明背景色和细边框，玻璃感会更明显：

```css
.user-bubble {
  backdrop-filter: blur(18px);
  blur-intensity: 72;
  blur-tint: light;
  background-color: rgba(255,255,255,0.30);
  border-width: 1px;
  border-color: rgba(255,255,255,0.42);
  box-shadow: 0 6px 18px rgba(0,0,0,0.12);
}

.assistant-bubble {
  backdrop-filter: blur(18px);
  blur-intensity: 68;
  blur-tint: light;
  background-color: rgba(255,255,255,0.24);
  border-width: 1px;
  border-color: rgba(255,255,255,0.36);
}
```

如果 AI 消息没有开启「气泡」样式，`.assistant-bubble` 不会出现；需要先在美化页把 AI 气泡模式打开。

## 注意

复杂浏览器 CSS 不会生效，例如伪类、子选择器、媒体查询、`filter`、动画等。新增页面区域如果需要被 CSS 调整，需要先在对应组件里挂一个 selector。
