import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { randomUUID } from 'expo-crypto';
import { sqliteStorage } from '../db/kv-storage';
import type { AIWorkflow, WorkflowEdge, WorkflowNode } from '../types/workflow';

interface WorkflowState {
  workflows: AIWorkflow[];
  hydrated: boolean;
  setHydrated: (value: boolean) => void;
  createWorkflow: () => string;
  updateWorkflow: (id: string, patch: Partial<AIWorkflow>) => void;
  deleteWorkflow: (id: string) => void;
  addNode: (workflowId: string, node: Omit<WorkflowNode, 'id'>) => string;
  updateNode: (workflowId: string, nodeId: string, patch: Partial<WorkflowNode>) => void;
  deleteNode: (workflowId: string, nodeId: string) => void;
  addEdge: (workflowId: string, from: string, to: string) => void;
}

export const useWorkflowStore = create<WorkflowState>()(persist((set, get) => ({
  workflows: [],
  hydrated: false,
  setHydrated: (hydrated) => set({ hydrated }),
  createWorkflow: () => {
    const id = randomUUID();
    const now = Date.now();
    const timerId = randomUUID();
    const agentId = randomUUID();
    const workflow: AIWorkflow = {
      id,
      name: `工作流 ${get().workflows.length + 1}`,
      enabled: false,
      nodes: [
        { id: timerId, type: 'trigger', title: '代码触发器', x: 180, y: 30, config: { checkIntervalMinutes: 1, code: 'return true;' } },
        { id: agentId, type: 'agent', title: 'AI 任务', x: 180, y: 185, config: { prompt: '查看当前状态，并在有需要时提醒我。', toolNames: [], aiDecidesPush: true } },
      ],
      edges: [{ id: randomUUID(), from: timerId, to: agentId }],
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({ workflows: [...state.workflows, workflow] }));
    return id;
  },
  updateWorkflow: (id, patch) => set((state) => ({
    workflows: state.workflows.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item),
  })),
  deleteWorkflow: (id) => set((state) => ({ workflows: state.workflows.filter((item) => item.id !== id) })),
  addNode: (workflowId, input) => {
    const id = randomUUID();
    set((state) => ({ workflows: state.workflows.map((workflow) => workflow.id === workflowId
      ? { ...workflow, nodes: [...workflow.nodes, { ...input, id }], updatedAt: Date.now() }
      : workflow) }));
    return id;
  },
  updateNode: (workflowId, nodeId, patch) => set((state) => ({ workflows: state.workflows.map((workflow) => workflow.id === workflowId
    ? { ...workflow, nodes: workflow.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node), updatedAt: Date.now() }
    : workflow) })),
  deleteNode: (workflowId, nodeId) => set((state) => ({ workflows: state.workflows.map((workflow) => workflow.id === workflowId
    ? { ...workflow, nodes: workflow.nodes.filter((node) => node.id !== nodeId), edges: workflow.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId), updatedAt: Date.now() }
    : workflow) })),
  addEdge: (workflowId, from, to) => {
    if (from === to) return;
    set((state) => ({ workflows: state.workflows.map((workflow) => {
      if (workflow.id !== workflowId || workflow.edges.some((edge) => edge.from === from && edge.to === to)) return workflow;
      const edge: WorkflowEdge = { id: randomUUID(), from, to };
      return { ...workflow, edges: [...workflow.edges, edge], updatedAt: Date.now() };
    }) }));
  },
}), {
  name: 'ysclaude-workflows',
  version: 2,
  migrate: (persisted: any, version) => {
    if (version < 1 && Array.isArray(persisted?.workflows)) {
      persisted.workflows = persisted.workflows.map((workflow: AIWorkflow) => ({
        ...workflow,
        nodes: workflow.nodes.map((node, index) => ({ ...node, x: 80, y: 30 + index * 160 })),
      }));
    }
    if (version < 2 && Array.isArray(persisted?.workflows)) {
      persisted.workflows = persisted.workflows.map((workflow: AIWorkflow) => {
        const toolNodes = workflow.nodes.filter((node) => node.type === 'tool');
        const legacyTools = toolNodes.map((node) => String(node.config.toolName || '')).filter(Boolean);
        const removedIds = new Set(toolNodes.map((node) => node.id));
        let edges = workflow.edges.filter((edge) => !removedIds.has(edge.from) && !removedIds.has(edge.to));
        toolNodes.forEach((toolNode) => {
          const predecessors = workflow.edges.filter((edge) => edge.to === toolNode.id).map((edge) => edge.from);
          const successors = workflow.edges.filter((edge) => edge.from === toolNode.id).map((edge) => edge.to);
          predecessors.forEach((from) => successors.forEach((to) => edges.push({ id: randomUUID(), from, to })));
        });
        return {
          ...workflow,
          nodes: workflow.nodes.filter((node) => node.type !== 'tool').map((node) => node.type === 'agent'
            ? { ...node, config: { ...node.config, toolNames: [...new Set([...(Array.isArray(node.config.toolNames) ? node.config.toolNames : []), ...legacyTools])] } }
            : node),
          edges,
        };
      });
    }
    return persisted;
  },
  storage: createJSONStorage(() => sqliteStorage),
  partialize: (state) => ({ workflows: state.workflows }),
  onRehydrateStorage: () => (state) => state?.setHydrated(true),
}));
