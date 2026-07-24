export const WORKFLOW_TOOL_NAMES = [
  'ask_user', 'react_to_latest_user_message', 'search_memory_vault', 'keyword_search_memory_vault', 'query_diary', 'add_diary', 'save_memory',
  'accounting_read_today', 'accounting_add_record', 'accounting_delete_record', 'conversation_windows_list', 'conversation_window_floor_count', 'conversation_window_read_floors', 'conversation_window_search', 'conversation_windows_search_all', 'conversation_windows_search_multi', 'conversation_search_result_read',
  'artifact_list', 'artifact_read', 'artifact_create', 'artifact_replace', 'artifact_patch_text', 'artifact_delete', 'artifact_show_card', 'artifact_upload_to_server', 'artifact_download_from_server',
  'web_search', 'get_hotboard', 'webview_open', 'webview_eval_js', 'webview_screenshot', 'html_artifact_get_source', 'html_artifact_open', 'html_artifact_observe', 'html_artifact_click_element', 'html_artifact_click_selector', 'html_artifact_tap', 'html_artifact_wait', 'html_artifact_screenshot', 'html_artifact_replace_source', 'html_artifact_patch_element', 'html_artifact_save',
  'ssh_connect', 'ssh_status', 'ssh_command', 'ssh_read_file', 'ssh_write_file', 'ssh_close', 'run_android_shell',
  'read_device_info', 'read_battery_status', 'read_app_usage_stats', 'open_usage_access_settings', 'read_notifications', 'open_notification_access_settings', 'read_clipboard', 'read_weather', 'calendar_list_events', 'calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'find_contacts', 'edit_contact', 'send_sms', 'dial_phone',
  'request_android_control_permission', 'open_android_input_method_settings', 'show_android_input_method_picker', 'switch_android_input_method_to_ysclaude', 'observe_android_screen', 'tap_android_screen', 'tap_android_relative', 'swipe_android_screen', 'click_android_node', 'scroll_android_node', 'set_android_text', 'set_focused_android_text', 'ime_commit_android_text', 'ime_android_action', 'ime_delete_android_text', 'android_global_action',
  'start_ai_voice_call', 'hangup_ai_voice_call', 'qq_bot_list_messages', 'qq_bot_read_messages', 'qq_bot_send_message', 'wechat_clawbot_read_messages', 'wechat_clawbot_send_message',
] as const;

const WORKFLOW_TOOL_DESCRIPTION_MAP: Record<string, string> = {
  ask_user: '向用户提出问题并等待选择或输入。', react_to_latest_user_message: '给最近一条用户消息添加表情回应。',
  search_memory_vault: '按语义搜索记忆库内容。', keyword_search_memory_vault: '按关键词搜索记忆库。', query_diary: '查询已保存的日记。', add_diary: '新增一篇日记。', save_memory: '把重要信息保存到记忆库。',
  accounting_read_today: '查看今天的记账记录。', accounting_add_record: '新增一条收支记录。', accounting_delete_record: '删除指定记账记录。',
  conversation_windows_list: '列出可读取的对话窗口。', conversation_window_floor_count: '统计对话窗口的消息楼层数。', conversation_window_read_floors: '读取指定范围的对话消息。', conversation_window_search: '在指定对话窗口中搜索。', conversation_windows_search_all: '搜索全部对话窗口。', conversation_windows_search_multi: '同时搜索多个对话窗口。', conversation_search_result_read: '读取对话搜索结果详情。',
  artifact_list: '列出当前对话中的文件与制品。', artifact_read: '读取制品内容。', artifact_create: '创建新的文本制品。', artifact_replace: '替换制品的全部内容。', artifact_patch_text: '局部修改制品文本。', artifact_delete: '删除指定制品。', artifact_show_card: '在对话中展示制品卡片。', artifact_upload_to_server: '把制品上传到服务器。', artifact_download_from_server: '从服务器下载制品。',
  web_search: '搜索互联网并返回相关结果。', get_hotboard: '查看指定平台的热榜。', webview_open: '在内置网页中打开链接。', webview_eval_js: '在当前网页执行 JavaScript。', webview_screenshot: '截取当前网页画面。',
  html_artifact_get_source: '读取 HTML 制品源代码。', html_artifact_open: '打开 HTML 制品预览。', html_artifact_observe: '观察 HTML 页面结构和状态。', html_artifact_click_element: '点击观察结果中的网页元素。', html_artifact_click_selector: '按 CSS 选择器点击网页元素。', html_artifact_tap: '按坐标点击 HTML 页面。', html_artifact_wait: '等待 HTML 页面更新。', html_artifact_screenshot: '截取 HTML 制品画面。', html_artifact_replace_source: '替换 HTML 制品源代码。', html_artifact_patch_element: '局部修改 HTML 页面元素。', html_artifact_save: '保存 HTML 制品修改。',
  ssh_connect: '连接远程 SSH 主机。', ssh_status: '查看 SSH 连接状态。', ssh_command: '在 SSH 主机执行命令。', ssh_read_file: '读取 SSH 主机上的文件。', ssh_write_file: '写入 SSH 主机上的文件。', ssh_close: '关闭 SSH 连接。', run_android_shell: '在 Android 设备上执行 Shell 命令。',
  read_device_info: '读取设备型号和系统信息。', read_battery_status: '查看电池电量和充电状态。', read_app_usage_stats: '查看应用使用情况。', open_usage_access_settings: '打开应用使用权限设置。', read_notifications: '读取设备通知。', open_notification_access_settings: '打开通知读取权限设置。', read_clipboard: '读取剪贴板文本。', read_weather: '查询当前位置或指定地点天气。',
  calendar_list_events: '查询日历事件。', calendar_create_event: '创建日历事件。', calendar_update_event: '修改日历事件。', calendar_delete_event: '删除日历事件。', find_contacts: '搜索手机联系人。', edit_contact: '新增或修改联系人。', send_sms: '向指定号码发送短信。', dial_phone: '拨打指定电话号码。',
  request_android_control_permission: '申请 Android 屏幕控制权限。', open_android_input_method_settings: '打开输入法设置。', show_android_input_method_picker: '显示输入法选择器。', switch_android_input_method_to_ysclaude: '切换到 YSClaude 输入法。', observe_android_screen: '观察当前屏幕内容和控件。', tap_android_screen: '点击屏幕指定坐标。', tap_android_relative: '按相对位置点击屏幕。', swipe_android_screen: '在屏幕上执行滑动。', click_android_node: '点击识别到的界面控件。', scroll_android_node: '滚动指定界面控件。', set_android_text: '设置指定输入框文本。', set_focused_android_text: '设置当前输入框文本。', ime_commit_android_text: '通过输入法输入文本。', ime_android_action: '执行输入法确认、搜索等动作。', ime_delete_android_text: '通过输入法删除文本。', android_global_action: '执行返回、主页等系统操作。',
  start_ai_voice_call: '开始 AI 语音通话。', hangup_ai_voice_call: '结束当前 AI 语音通话。',
  qq_bot_list_messages: '查看 QQ 联系人和群聊的消息列表。', qq_bot_read_messages: '读取指定 QQ 联系人或群聊的消息。', qq_bot_send_message: '向指定 QQ 联系人或群聊发送消息。', wechat_clawbot_read_messages: '读取微信 ClawBot 最近消息。', wechat_clawbot_send_message: '通过微信 ClawBot 发送消息。',
};

export function getWorkflowToolDescription(toolName: string, fallback = ''): string {
  return WORKFLOW_TOOL_DESCRIPTION_MAP[toolName]
    || fallback.trim()
    || (toolName.startsWith('mcp__') ? '调用 MCP 服务器提供的工具。' : '执行此工具对应的操作。');
}
