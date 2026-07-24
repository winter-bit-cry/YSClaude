import { hotboardTool } from './toolModules/hotboard';
import { accountingTool } from './toolModules/accounting';
import { conversationArtifactsTool } from './toolModules/conversationArtifacts';
import { conversationWindowsTool } from './toolModules/conversationWindows';
import { mcpRemoteTool } from './toolModules/mcpRemote';
import { memoryVaultTool, uploadDiary } from './toolModules/memoryVault';
import { nativeDeviceTool } from './toolModules/nativeDevice';
import { runCommandTool } from './toolModules/runCommand';
import { shizukuShellTool } from './toolModules/shizukuShell';
import { sshArtifactTransferTool } from './toolModules/sshArtifactTransfer';
import { voiceCallTool } from './toolModules/voiceCall';
import { webSearchTool } from './toolModules/webSearch';
import { webViewTool } from './toolModules/webView';
import { botMessagingTool } from './toolModules/botMessaging';
import { discordBotTool } from './toolModules/discordBot';
import { messageReactionTool } from './toolModules/messageReaction';
import { askUserTool } from './toolModules/askUser';
import {
  ToolDefinition,
  ToolDefinitionConfig,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolModule,
} from './toolModules/types';

export type { ToolDefinition, ToolDefinitionConfig, ToolExecutionContext, ToolExecutionResult, ToolModule };
export { uploadDiary };

const TOOL_MODULES: ToolModule[] = [
  askUserTool,
  messageReactionTool,
  conversationWindowsTool,
  accountingTool,
  memoryVaultTool,
  webSearchTool,
  hotboardTool,
  runCommandTool,
  shizukuShellTool,
  sshArtifactTransferTool,
  mcpRemoteTool,
  webViewTool,
  conversationArtifactsTool,
  nativeDeviceTool,
  voiceCallTool,
  botMessagingTool,
  discordBotTool,
];

const TOOL_LABELS: Record<string, string> = TOOL_MODULES.reduce(
  (labels, toolModule) => ({ ...labels, ...toolModule.labels }),
  {}
);

export function getToolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__').filter(Boolean);
    if (parts.length >= 3) {
      const serverId = parts[1];
      const rawToolName = parts.slice(2).join('__');
      return `MCP ${serverId}: ${rawToolName}`;
    }
  }
  if (toolName.startsWith('mcp_resource__')) {
    const parts = toolName.split('__').filter(Boolean);
    if (parts.length >= 2) {
      return `MCP ${parts[1]}: 读取资源`;
    }
  }
  return toolName;
}

/**
 * 根据启用状态返回 tool 定义列表。
 */
export function getToolDefinitions(config: ToolDefinitionConfig): ToolDefinition[] {
  return TOOL_MODULES.flatMap((toolModule) => toolModule.getDefinitions(config));
}

/**
 * 执行指定工具并返回结果文本。
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  try {
    for (const toolModule of TOOL_MODULES) {
      const result = await toolModule.execute(toolName, args, context);
      if (result !== undefined) {
        return result;
      }
    }
    return `未知工具: ${toolName}`;
  } catch (err: any) {
    return `工具执行失败: ${err.message || '未知错误'}`;
  }
}
