import { NativeModules, Platform } from 'react-native';
import type { AIWorkflow } from '../types/workflow';

interface NativeScheduler {
  setKeepAlive(enabled: boolean): Promise<boolean>;
  schedule(workflowId: string, triggerAt: number): Promise<boolean>;
  cancel(workflowId: string): Promise<boolean>;
  triggerNow(workflowId: string): Promise<boolean>;
}

const native = NativeModules.AIWorkflowScheduler as NativeScheduler | undefined;

export function getWorkflowIntervalMs(workflow: AIWorkflow): number {
  const trigger = workflow.nodes.find((node) => node.type === 'trigger' || node.type === 'timer');
  return Math.max(1, Number(trigger?.config.checkIntervalMinutes || trigger?.config.intervalMinutes) || 1) * 60_000;
}

export async function syncWorkflowSchedule(workflow: AIWorkflow): Promise<number | undefined> {
  if (Platform.OS !== 'android' || !native) return undefined;
  if (!workflow.enabled) {
    await native.cancel(workflow.id);
    return undefined;
  }
  const nextRunAt = Date.now() + getWorkflowIntervalMs(workflow);
  await native.schedule(workflow.id, nextRunAt);
  return nextRunAt;
}

export async function restoreWorkflowSchedule(workflow: AIWorkflow): Promise<number | undefined> {
  if (Platform.OS !== 'android' || !native || !workflow.enabled) return undefined;
  const nextRunAt = Math.max(Date.now() + 1000, workflow.nextRunAt || Date.now() + getWorkflowIntervalMs(workflow));
  await native.schedule(workflow.id, nextRunAt);
  return nextRunAt;
}

export async function syncWorkflowKeepAlive(anyEnabled: boolean): Promise<void> {
  if (Platform.OS === 'android') await native?.setKeepAlive(anyEnabled);
}

export async function triggerWorkflowNative(workflowId: string): Promise<void> {
  if (Platform.OS === 'android' && native) await native.triggerNow(workflowId);
}
