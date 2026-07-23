export type WorkflowNodeType = 'timer' | 'trigger' | 'agent' | 'tool' | 'notify';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  x: number;
  y: number;
  config: Record<string, any>;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface AIWorkflow {
  id: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  conversationId?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
