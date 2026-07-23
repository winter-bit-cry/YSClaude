import { getAllConversations, updateMessageContent } from '../db/operations';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';
import { useWorkflowStore } from '../stores/workflows';
import type { AIWorkflow } from '../types/workflow';
import { syncWorkflowSchedule } from './workflowScheduler';
import { notifyReplyReady } from './notifications';

let queue: Promise<unknown> = Promise.resolve();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHydration(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (useSettingsStore.getState()._hydrated && useWorkflowStore.getState().hydrated) return;
    await delay(100);
  }
  throw new Error('工作流配置尚未加载完成');
}

async function ensureConversation(workflow: AIWorkflow): Promise<string> {
  const latest = (await getAllConversations()).find((item) => !item.archivedFromRecents);
  if (!latest) throw new Error('没有可绑定的未归档对话，请先创建一个聊天窗口');
  if (workflow.conversationId !== latest.id) useWorkflowStore.getState().updateWorkflow(workflow.id, { conversationId: latest.id });
  return latest.id;
}

export interface WorkflowTriggerContext { foregroundPackage?: string; manual?: boolean }

function evaluateTrigger(workflow: AIWorkflow, input: WorkflowTriggerContext): { matched: boolean; foregroundPackage?: string } {
  const trigger = workflow.nodes.find((node) => node.type === 'trigger' || node.type === 'timer');
  if (!trigger || trigger.type === 'timer' || input.manual) return { matched: true, foregroundPackage: input.foregroundPackage };
  const now = new Date();
  const previousPackage = String(trigger.config.lastForegroundPackage || '');
  const foregroundPackage = String(input.foregroundPackage || '');
  const ctx = Object.freeze({
    now: now.getTime(), year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(),
    weekday: now.getDay(), hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds(),
    lastRunAt: workflow.lastRunAt || null,
    minutesSinceLastRun: workflow.lastRunAt ? Math.floor((Date.now() - workflow.lastRunAt) / 60000) : null,
    foregroundPackage: foregroundPackage || null,
    previousForegroundPackage: previousPackage || null,
    foregroundChanged: !!foregroundPackage && foregroundPackage !== previousPackage,
  });
  try {
    const matched = Boolean(new Function('ctx', `"use strict";\n${String(trigger.config.code || 'return false;')}`)(ctx));
    return { matched, foregroundPackage };
  } catch (error: any) {
    throw new Error(`触发器代码错误：${error?.message || error}`);
  }
}

function buildExecution(workflow: AIWorkflow) {
  const starts = workflow.nodes.filter((node) => node.type === 'timer' || node.type === 'trigger').map((node) => node.id);
  const reachable = new Set(starts);
  const queue = [...starts];
  const orderedIds: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    orderedIds.push(current);
    workflow.edges.filter((edge) => edge.from === current).forEach((edge) => {
      if (!reachable.has(edge.to)) { reachable.add(edge.to); queue.push(edge.to); }
    });
  }
  const executionNodes = workflow.nodes.filter((node) => reachable.has(node.id));
  const legacyToolNames = executionNodes.filter((node) => node.type === 'tool').map((node) => String(node.config.toolName || '')).filter(Boolean);
  const nodeById = new Map(executionNodes.map((node) => [node.id, node]));
  const agentSteps = orderedIds
    .map((id) => nodeById.get(id))
    .filter((node) => node?.type === 'agent')
    .map((node) => ({
      prompt: String(node!.config.prompt || '').trim() || '根据当前上下文执行这个 AI 任务。',
      toolNames: [...new Set([...(Array.isArray(node!.config.toolNames) ? node!.config.toolNames : []), ...legacyToolNames])].map(String),
      aiDecidesPush: node!.config.aiDecidesPush === true,
    }));
  return agentSteps.length > 0 ? agentSteps : [{ prompt: '根据当前上下文执行这个定时工作流。', toolNames: legacyToolNames, aiDecidesPush: false }];
}

const PUSH_MARKER = '[工作流输出：推送]';
const ACTIVITY_MARKER = '[工作流输出：活动]';

function stripWorkflowMarker(content: string): string {
  return content
    .replace(/^\s*(?:<thinking>[\s\S]*?<\/thinking>\s*)?/u, '')
    .replace(/^\s*\[工作流输出[：:]\s*(?:推送|活动)\]\s*/u, '')
    .trim();
}

async function applyDeliveryDecision(messageId: string, rawContent: string): Promise<void> {
  const visibleContent = rawContent.replace(/^\s*(?:<thinking>[\s\S]*?<\/thinking>\s*)?/u, '');
  const shouldPush = visibleContent.trimStart().startsWith(PUSH_MARKER);
  const cleanContent = stripWorkflowMarker(rawContent) || (shouldPush ? '工作流发现了需要你关注的信息。' : 'AI 完成了本次检查，判断暂时不需要打扰你。');
  const finalContent = shouldPush ? cleanContent : `[远程自主判断]\n${cleanContent}`;
  await updateMessageContent(messageId, finalContent);
  useChatStore.setState((state) => ({ messages: state.messages.map((message) => message.id === messageId ? { ...message, content: finalContent } : message) }));
  if (shouldPush) await notifyReplyReady(cleanContent, { showFloatingBall: false });
}

async function runNow(workflowId: string, triggerContext: WorkflowTriggerContext = {}): Promise<void> {
  await waitForHydration();
  const workflow = useWorkflowStore.getState().workflows.find((item) => item.id === workflowId);
  if (!workflow) throw new Error('工作流不存在');
  const triggerResult = evaluateTrigger(workflow, triggerContext);
  const triggerNode = workflow.nodes.find((node) => node.type === 'trigger');
  if (triggerNode && triggerResult.foregroundPackage !== triggerNode.config.lastForegroundPackage) {
    useWorkflowStore.getState().updateNode(workflow.id, triggerNode.id, { config: { ...triggerNode.config, lastForegroundPackage: triggerResult.foregroundPackage } });
  }
  if (!triggerResult.matched) {
    const nextRunAt = workflow.enabled ? await syncWorkflowSchedule(workflow) : undefined;
    useWorkflowStore.getState().updateWorkflow(workflow.id, { nextRunAt });
    return;
  }
  while (useChatStore.getState().isStreaming) await delay(300);
  const conversationId = await ensureConversation(workflow);
  const chat = useChatStore.getState();
  if (chat.conversationId !== conversationId) await chat.loadConversation(conversationId);
  const steps = buildExecution(workflow);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const beforeIds = new Set(useChatStore.getState().messages.map((message) => message.id));
    const deliveryInstruction = step.aiDecidesPush
      ? `\n\n你必须判断本次结果是否值得立即打扰用户，并严格选择一种输出格式：\n${PUSH_MARKER}\n需要立即告知用户的正文\n\n或\n\n${ACTIVITY_MARKER}\n本次后台活动摘要\n\n第一行必须是上述两个标记之一，不要输出 JSON。只有确实值得用户现在查看时才选择“推送”。`
      : '';
    await useChatStore.getState().triggerResponse({
      additionalRuntimeSections: [`当前由后台工作流「${workflow.name}」触发，正在执行第 ${index + 1}/${steps.length} 个 AI 任务。只执行该 AI 节点配置的任务。`],
      ephemeralUserMessage: `${step.prompt}${deliveryInstruction}`,
      allowedToolNames: step.toolNames,
      suppressNotification: step.aiDecidesPush,
    });
    const error = useChatStore.getState().error;
    if (error) throw new Error(error);
    if (step.aiDecidesPush) {
      const response = [...useChatStore.getState().messages].reverse().find((message) => message.role === 'assistant' && !beforeIds.has(message.id));
      if (response) await applyDeliveryDecision(response.id, response.content);
    }
  }
  const latest = useWorkflowStore.getState().workflows.find((item) => item.id === workflowId);
  const nextRunAt = latest?.enabled ? await syncWorkflowSchedule(latest) : undefined;
  useWorkflowStore.getState().updateWorkflow(workflowId, { lastRunAt: Date.now(), nextRunAt });
}

export function runWorkflow(workflowId: string, triggerContext: WorkflowTriggerContext = {}): Promise<void> {
  const next = queue.catch(() => undefined).then(() => runNow(workflowId, triggerContext));
  queue = next.catch(() => undefined);
  return next;
}

export async function handleWorkflowHeadlessTask(data: { workflowId?: string; foregroundPackage?: string }): Promise<void> {
  if (data.workflowId) await runWorkflow(data.workflowId, { foregroundPackage: data.foregroundPackage });
}
