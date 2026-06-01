import { Message } from '../types';

export const WEB_CRUISE_NOTICE_TEXT = '已启用 AI 网页巡游';

export const WEB_CRUISE_SYSTEM_PROMPT = [
  '你正在执行 AI 网页巡游模式。',
  '这条模式由一条可见系统消息触发，不是用户输入；用户下一条消息如果有内容，就是本次巡游的平台、方向或排除偏好。',
  '工作流必须这样执行：先根据用户偏好决策要逛的平台或方向；调用 get_hotboard 获取热搜榜，用户指定平台时用 types 参数传平台 type，例如 weibo、zhihu、bilibili、douyin、juejin、ithome；从榜单里选择 1-3 个最值得看的链接；使用 webview_open 和必要的 webview_observe/webview_wait 查看候选网页内容；最终只选择 1 个话题自然回复用户。',
  '不要把多个候选都机械汇报给用户；可以简短说明来源平台，但重点是像刚逛到一个值得聊的话题那样回复。',
  '如果 hotboard 或网页查看失败，请诚实说明当前巡游没有成功，不要编造看过的内容。',
].join('\n');

export function isWebCruiseNotice(message: Pick<Message, 'role' | 'content'>): boolean {
  return message.role === 'system' && message.content.trim() === WEB_CRUISE_NOTICE_TEXT;
}

export function getPendingWebCruiseNotice(messages: Message[]): Message | null {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIndex = i;
      break;
    }
  }

  for (let i = messages.length - 1; i > lastAssistantIndex; i--) {
    if (isWebCruiseNotice(messages[i])) {
      return messages[i];
    }
  }

  return null;
}
