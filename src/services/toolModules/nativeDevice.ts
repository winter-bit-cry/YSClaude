import {
  clickAccessibilityNode,
  commitInputMethodText,
  createCalendarEvent,
  deleteInputMethodText,
  deleteCalendarEvent,
  listCalendarEvents,
  openAccessibilitySettings,
  openInputMethodSettings,
  openUsageAccessSettings,
  performAccessibilityGlobalAction,
  performInputMethodAction,
  readAccessibilityScreenContext,
  readAppUsageStats,
  readBatteryStatus,
  readDeviceInfo,
  scrollAccessibilityNode,
  setAccessibilityNodeText,
  setFocusedAccessibilityText,
  showInputMethodPicker,
  switchToYSClaudeInputMethod,
  swipeAccessibilityScreen,
  tapAccessibilityScreen,
  tapAccessibilityScreenRelative,
  updateCalendarEvent,
  readNotifications,
  openNotificationAccessSettings,
  readClipboard,
  editContact,
  findContacts,
  composeSms,
  dialPhone,
  readWeather,
} from '../nativeTools';
import { ToolDefinition, ToolModule } from './types';

const DEVICE_INFO_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_device_info',
    description: '读取当前用户设备的基础信息，例如品牌、型号、系统版本、设备类型、内存和运行时长。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const NOTIFICATION_READ_TOOL: ToolDefinition = { type: 'function', function: { name: 'read_notifications', description: '读取 Android 当前通知，可读取全部通知或按应用名称/包名筛选。若未授权会返回授权提示。', parameters: { type: 'object', properties: { app: { type: 'string', description: '可选，应用名称或包名关键词' }, limit: { type: 'number', description: '最多返回数量，默认 50' } }, required: [] } } };
const NOTIFICATION_SETTINGS_TOOL: ToolDefinition = { type: 'function', function: { name: 'open_notification_access_settings', description: '打开 Android 通知使用权设置页，供用户授权通知读取。', parameters: { type: 'object', properties: {}, required: [] } } };
const CLIPBOARD_READ_TOOL: ToolDefinition = { type: 'function', function: { name: 'read_clipboard', description: '读取剪切板中最新的文本内容。', parameters: { type: 'object', properties: {}, required: [] } } };
const CONTACT_EDIT_TOOL: ToolDefinition = { type: 'function', function: { name: 'edit_contact', description: '打开系统联系人编辑器并预填姓名、电话和邮箱，最终保存由用户确认。', parameters: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } }, required: [] } } };
const CONTACT_FIND_TOOL: ToolDefinition = { type: 'function', function: { name: 'find_contacts', description: '按姓名查询 Android 通讯录，返回匹配联系人的姓名和电话号码。当用户只说了联系人姓名就要拨号或发短信时，先调用本工具获取手机号。', parameters: { type: 'object', properties: { name: { type: 'string', description: '联系人姓名，支持部分匹配' }, limit: { type: 'number', description: '最多返回数量，默认 10，最大 50' } }, required: ['name'] } } };
const SMS_TOOL: ToolDefinition = { type: 'function', function: { name: 'send_sms', description: '打开系统短信编辑器，预填收件人手机号和短信正文，发送前由用户确认。phone 必须是号码；只有姓名时先调用 find_contacts。', parameters: { type: 'object', properties: { phone: { type: 'string' }, message: { type: 'string' } }, required: ['phone'] } } };
const DIAL_TOOL: ToolDefinition = { type: 'function', function: { name: 'dial_phone', description: '打开系统拨号盘并填入电话号码，实际拨号由用户确认。phone 必须是号码；只有姓名时先调用 find_contacts。', parameters: { type: 'object', properties: { phone: { type: 'string' } }, required: ['phone'] } } };
const WEATHER_TOOL: ToolDefinition = { type: 'function', function: { name: 'read_weather', description: '通过国内天气服务读取实时天气与未来 7 天预报。优先提供城市/区县名；也可提供经纬度，全部省略时使用设备当前位置。', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市或区县名称，例如北京、浦东新区' }, latitude: { type: 'number' }, longitude: { type: 'number' } }, required: [] } } };

const BATTERY_STATUS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_battery_status',
    description: '读取当前设备电池状态，例如电量、充电状态、低电量模式和 Android 电池优化状态。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const APP_USAGE_STATS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_app_usage_stats',
    description: '读取 Android 应用使用时间统计。首次使用若未授权，会返回 permissionGranted=false，并提示用户去系统“使用情况访问权限”中授权 YSClaude。',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: '开始时间，ISO 8601 字符串，可选，默认结束时间前 24 小时' },
        end_date: { type: 'string', description: '结束时间，ISO 8601 字符串，可选，默认当前时间' },
        limit: { type: 'number', description: '最多返回多少个应用，可选，默认 20' },
      },
      required: [],
    },
  },
};

const OPEN_USAGE_ACCESS_SETTINGS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_usage_access_settings',
    description: '打开 Android 使用情况访问权限设置页。仅当 read_app_usage_stats 返回 permissionGranted=false 且用户需要授权时调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const OPEN_ACCESSIBILITY_SETTINGS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'request_android_control_permission',
    description: 'Request or verify Shizuku permission when Android screen observation or control is unavailable.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const OPEN_INPUT_METHOD_SETTINGS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_android_input_method_settings',
    description: 'Open Android keyboard/input method settings so the user can enable YSClaude IME. Use this when IME text entry reports that YSClaude IME is not active or not enabled.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const SHOW_INPUT_METHOD_PICKER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'show_android_input_method_picker',
    description: 'Show the Android input method picker so the user can switch the current keyboard to YSClaude IME. Use after the user has enabled YSClaude IME in system settings.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const SWITCH_TO_YSCLAUDE_INPUT_METHOD_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'switch_android_input_method_to_ysclaude',
    description: 'Enable and switch to YSClaude IME through Shizuku. Use after focusing an input if ime_commit_android_text reports that no input connection is ready.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const OBSERVE_ANDROID_SCREEN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'observe_android_screen',
    description: 'Capture the Android screen through Shizuku and read a uiautomator node snapshot. Returns a compact screenSummary and interactiveElements with snapshot node ids.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const TAP_ANDROID_SCREEN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'tap_android_screen',
    description: 'Last-resort absolute coordinate tap on Android. Do NOT estimate coordinates from screenshots when an interactiveElements node id exists. Prefer click_android_node almost always. Returns the updated screen tree.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Absolute screen x coordinate in pixels.' },
        y: { type: 'number', description: 'Absolute screen y coordinate in pixels.' },
      },
      required: ['x', 'y'],
    },
  },
};

const TAP_ANDROID_RELATIVE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'tap_android_relative',
    description: 'Tap a relative screen position on Android. Use this when no reliable accessibility node exists but the target is visible in the screenshot, such as a custom note card. x_ratio and y_ratio are 0..1 from left/top of the full screen. Prefer this over absolute pixel taps.',
    parameters: {
      type: 'object',
      properties: {
        x_ratio: { type: 'number', description: 'Horizontal position from 0.0 left to 1.0 right.' },
        y_ratio: { type: 'number', description: 'Vertical position from 0.0 top to 1.0 bottom.' },
      },
      required: ['x_ratio', 'y_ratio'],
    },
  },
};

const SWIPE_ANDROID_SCREEN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'swipe_android_screen',
    description: 'Swipe from one absolute screen coordinate to another through Shizuku. Use for scrolling or gesture navigation.',
    parameters: {
      type: 'object',
      properties: {
        start_x: { type: 'number', description: 'Swipe start x coordinate in pixels.' },
        start_y: { type: 'number', description: 'Swipe start y coordinate in pixels.' },
        end_x: { type: 'number', description: 'Swipe end x coordinate in pixels.' },
        end_y: { type: 'number', description: 'Swipe end y coordinate in pixels.' },
        duration_ms: { type: 'number', description: 'Gesture duration in milliseconds. Defaults to 360.' },
      },
      required: ['start_x', 'start_y', 'end_x', 'end_y'],
    },
  },
};

const CLICK_ANDROID_NODE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'click_android_node',
    description: 'Click a reliable node id from the interactiveElements list returned by the screen context or observe_android_screen, for example w0.2.1. Prefer this over tap_android_screen. If the node itself is not clickable, YSClaude will try clickable parents. Returns the updated screen tree.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Snapshot node id from observe_android_screen.' },
      },
      required: ['node_id'],
    },
  },
};

const SCROLL_ANDROID_NODE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'scroll_android_node',
    description: 'Swipe inside a scrollable node bounds from the latest uiautomator snapshot.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Scrollable snapshot node id.' },
        direction: { type: 'string', enum: ['forward', 'backward', 'up', 'down', 'left', 'right'], description: 'Scroll direction.' },
      },
      required: ['node_id'],
    },
  },
};

const SET_ANDROID_TEXT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'set_android_text',
    description: 'Tap an editable field from the latest node snapshot, switch to YSClaude IME through Shizuku, and commit text. Do not use for passwords, verification codes, payment, banking, or publishing/sending content unless explicitly requested.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Node id from observe_android_screen. Prefer nodes with flags containing edit.' },
        text: { type: 'string', description: 'Text to place into the input field. Replaces current field content.' },
      },
      required: ['node_id', 'text'],
    },
  },
};

const SET_FOCUSED_ANDROID_TEXT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'set_focused_android_text',
    description: 'Set text in the currently focused Android input field. Use this after clicking/tapping an input field and the system keyboard or text focus is active. This replaces the field content; pass an empty string to clear. Do not use for passwords, verification codes, payment, banking, or publishing/sending content unless the user explicitly asked.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to place into the focused input field. Replaces current field content.' },
      },
      required: ['text'],
    },
  },
};

const IME_COMMIT_ANDROID_TEXT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ime_commit_android_text',
    description: 'Commit text to the current focused input through YSClaude IME. Use this after tapping/clicking an input field. If YSClaude IME is enabled but not active, YSClaude will try to switch to it automatically before inserting text. This does not require an accessibility input node and works better for apps like WeChat whose input boxes are not exposed. Do not use for passwords, verification codes, payment, banking, or publishing/sending content unless the user explicitly asked.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to insert at the current cursor through YSClaude IME.' },
      },
      required: ['text'],
    },
  },
};

const IME_ANDROID_ACTION_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ime_android_action',
    description: 'Perform an editor action through YSClaude IME, such as send, search, done, go, or next. This can send or submit content in many apps, so only use when the user explicitly asked to send/search/submit.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['send', 'search', 'done', 'go', 'next'] },
      },
      required: ['action'],
    },
  },
};

const IME_DELETE_ANDROID_TEXT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ime_delete_android_text',
    description: 'Delete text around the current cursor through YSClaude IME. Use for small corrections only.',
    parameters: {
      type: 'object',
      properties: {
        before_length: { type: 'number', description: 'Number of characters before cursor to delete. Defaults to 1.' },
        after_length: { type: 'number', description: 'Number of characters after cursor to delete. Defaults to 0.' },
      },
      required: [],
    },
  },
};

const ANDROID_GLOBAL_ACTION_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'android_global_action',
    description: 'Perform an Android system key action through Shizuku: back, home, recents, notifications, or quick_settings.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['back', 'home', 'recents', 'notifications', 'quick_settings'] },
      },
      required: ['action'],
    },
  },
};

const CALENDAR_LIST_EVENTS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calendar_list_events',
    description: '读取设备日历中指定时间范围内的日程。参数必须用字符串，不要用 Date 对象。若用户说“今天/明天/本周”，请先换算成 ISO 8601 时间字符串。需要系统日历权限。',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: '开始时间，ISO 8601 字符串，例如 2026-06-01T00:00:00+08:00。可省略，默认当前时间。' },
        end_date: { type: 'string', description: '结束时间，ISO 8601 字符串，例如 2026-06-07T23:59:59+08:00。可省略，默认开始时间后 24 小时。' },
        calendar_ids: { type: 'array', items: { type: 'string' }, description: '可选，限定要读取的日历 ID 列表' },
      },
      required: [],
    },
  },
};

const CALENDAR_CREATE_EVENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calendar_create_event',
    description: '在设备日历中创建日程。参数必须用字符串，不要用 Date 对象。start_date 必填；end_date 可省略，默认开始时间后 1 小时。需要系统日历权限。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '日程标题' },
        start_date: { type: 'string', description: '开始时间，ISO 8601 字符串，例如 2026-06-01T14:00:00+08:00' },
        end_date: { type: 'string', description: '结束时间，ISO 8601 字符串，可选；省略时默认开始后 1 小时' },
        all_day: { type: 'boolean', description: '是否全天日程' },
        location: { type: 'string', description: '地点，可选' },
        notes: { type: 'string', description: '备注，可选' },
        time_zone: { type: 'string', description: '时区，可选，例如 Asia/Shanghai' },
        calendar_id: { type: 'string', description: '目标日历 ID，可选，默认使用系统默认日历' },
      },
      required: ['title', 'start_date'],
    },
  },
};

const CALENDAR_UPDATE_EVENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calendar_update_event',
    description: '修改设备日历中的已有日程。需要系统日历权限和日程 id。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要修改的日程 ID' },
        title: { type: 'string', description: '新标题，可选' },
        start_date: { type: 'string', description: '新开始时间，ISO 8601 字符串，可选' },
        end_date: { type: 'string', description: '新结束时间，ISO 8601 字符串，可选' },
        all_day: { type: 'boolean', description: '是否全天日程，可选' },
        location: { type: 'string', description: '地点，可选' },
        notes: { type: 'string', description: '备注，可选' },
        time_zone: { type: 'string', description: '时区，可选' },
      },
      required: ['id'],
    },
  },
};

const CALENDAR_DELETE_EVENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calendar_delete_event',
    description: '删除设备日历中的已有日程。需要系统日历权限和日程 id。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '要删除的日程 ID' } },
      required: ['id'],
    },
  },
};

export const nativeDeviceTool: ToolModule = {
  id: 'native-device',
  labels: {
    read_notifications: '读取通知',
    open_notification_access_settings: '通知读取授权',
    read_clipboard: '读取剪切板',
    edit_contact: '编辑联系人',
    find_contacts: '查看通讯录',
    send_sms: '发短信',
    dial_phone: '拨号',
    read_weather: '天气',
    read_device_info: '读取设备信息',
    read_battery_status: '读取电池状态',
    read_app_usage_stats: '读取应用使用统计',
    open_usage_access_settings: '打开使用统计授权',
    calendar_list_events: '读取日程',
    calendar_create_event: '创建日程',
    calendar_update_event: '修改日程',
    calendar_delete_event: '删除日程',
    set_android_text: '输入 Android 文本',
    set_focused_android_text: '输入焦点文本',
    open_android_input_method_settings: '打开输入法设置',
    show_android_input_method_picker: '切换输入法',
    switch_android_input_method_to_ysclaude: '切换到 YSClaude IME',
    ime_commit_android_text: 'IME 输入文本',
    ime_android_action: 'IME 执行动作',
    ime_delete_android_text: 'IME 删除文本',
  },
  getDefinitions: (config) => {
    const tools: ToolDefinition[] = [];
    if (config.nativeTools?.deviceInfoEnabled) {
      tools.push(DEVICE_INFO_TOOL);
    }
    if (config.nativeTools?.batteryStatusEnabled) {
      tools.push(BATTERY_STATUS_TOOL);
    }
    if (config.nativeTools?.appUsageStatsEnabled) {
      tools.push(APP_USAGE_STATS_TOOL, OPEN_USAGE_ACCESS_SETTINGS_TOOL);
    }
    if (config.nativeTools?.accessibilityControlEnabled) {
      tools.push(
        OPEN_ACCESSIBILITY_SETTINGS_TOOL,
        OPEN_INPUT_METHOD_SETTINGS_TOOL,
        SHOW_INPUT_METHOD_PICKER_TOOL,
        SWITCH_TO_YSCLAUDE_INPUT_METHOD_TOOL,
        OBSERVE_ANDROID_SCREEN_TOOL,
        TAP_ANDROID_SCREEN_TOOL,
        TAP_ANDROID_RELATIVE_TOOL,
        SWIPE_ANDROID_SCREEN_TOOL,
        CLICK_ANDROID_NODE_TOOL,
        SCROLL_ANDROID_NODE_TOOL,
        SET_ANDROID_TEXT_TOOL,
        SET_FOCUSED_ANDROID_TEXT_TOOL,
        IME_COMMIT_ANDROID_TEXT_TOOL,
        IME_ANDROID_ACTION_TOOL,
        IME_DELETE_ANDROID_TEXT_TOOL,
        ANDROID_GLOBAL_ACTION_TOOL
      );
    }
    if (config.nativeTools?.calendarEnabled) {
      tools.push(
        CALENDAR_LIST_EVENTS_TOOL,
        CALENDAR_CREATE_EVENT_TOOL,
        CALENDAR_UPDATE_EVENT_TOOL,
        CALENDAR_DELETE_EVENT_TOOL
      );
    }
    if (config.nativeTools?.notificationReaderEnabled) tools.push(NOTIFICATION_READ_TOOL, NOTIFICATION_SETTINGS_TOOL);
    if (config.nativeTools?.clipboardReaderEnabled) tools.push(CLIPBOARD_READ_TOOL);
    if (config.nativeTools?.contactsCommunicationEnabled) tools.push(CONTACT_FIND_TOOL, CONTACT_EDIT_TOOL, SMS_TOOL, DIAL_TOOL);
    if (config.nativeTools?.weatherEnabled) tools.push(WEATHER_TOOL);
    return tools;
  },
  execute: async (toolName, args) => {
    switch (toolName) {
      case 'read_device_info':
        return await readDeviceInfo();
      case 'read_battery_status':
        return await readBatteryStatus();
      case 'read_app_usage_stats':
        return await readAppUsageStats(args);
      case 'open_usage_access_settings':
        return await openUsageAccessSettings();
      case 'request_android_control_permission':
        return await openAccessibilitySettings();
      case 'open_android_input_method_settings':
        return await openInputMethodSettings();
      case 'show_android_input_method_picker':
        return await showInputMethodPicker();
      case 'switch_android_input_method_to_ysclaude':
        return await switchToYSClaudeInputMethod();
      case 'observe_android_screen':
        return await readAccessibilityScreenContext();
      case 'tap_android_screen':
        return await tapAccessibilityScreen(args);
      case 'tap_android_relative':
        return await tapAccessibilityScreenRelative(args);
      case 'swipe_android_screen':
        return await swipeAccessibilityScreen(args);
      case 'click_android_node':
        return await clickAccessibilityNode(args);
      case 'scroll_android_node':
        return await scrollAccessibilityNode(args);
      case 'set_android_text':
        return await setAccessibilityNodeText(args);
      case 'set_focused_android_text':
        return await setFocusedAccessibilityText(args);
      case 'ime_commit_android_text':
        return await commitInputMethodText(args);
      case 'ime_android_action':
        return await performInputMethodAction(args);
      case 'ime_delete_android_text':
        return await deleteInputMethodText(args);
      case 'android_global_action':
        return await performAccessibilityGlobalAction(args);
      case 'calendar_list_events':
        return await listCalendarEvents(args);
      case 'calendar_create_event':
        return await createCalendarEvent(args);
      case 'calendar_update_event':
        return await updateCalendarEvent(args);
      case 'calendar_delete_event':
        return await deleteCalendarEvent(args);
      case 'read_notifications': return await readNotifications(args);
      case 'open_notification_access_settings': return await openNotificationAccessSettings();
      case 'read_clipboard': return await readClipboard(args);
      case 'edit_contact': return await editContact(args);
      case 'find_contacts': return await findContacts(args);
      case 'send_sms': return await composeSms(args);
      case 'dial_phone': return await dialPhone(args);
      case 'read_weather': return await readWeather(args);
      default:
        return undefined;
    }
  },
};
