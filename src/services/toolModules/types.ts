import {
  ConversationArtifactToolConfig,
  ConversationWindowToolConfig,
  HotboardConfig,
  HtmlArtifactToolConfig,
  McpToolConfig,
  MemoryVaultConfig,
  NativeToolConfig,
  RunCommandConfig,
  QQBotToolConfig,
  WechatClawBotToolConfig,
  WebInteractionConfig,
  WebSearchConfig,
} from '../../stores/settings';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolDefinitionConfig {
  memoryVault: boolean;
  memoryVaultConfig?: MemoryVaultConfig;
  webSearch: boolean;
  webInteraction?: boolean;
  conversationArtifacts?: boolean;
  conversationWindows?: boolean;
  htmlArtifacts?: boolean;
  hotboard?: boolean;
  runCommand?: RunCommandConfig;
  nativeTools?: NativeToolConfig;
  mcpTools?: McpToolConfig;
  voiceCallActive?: boolean;
  qqBotTools?: boolean;
  wechatClawBotTools?: boolean;
}

export interface ToolExecutionContext {
  conversationId?: string;
  messageId?: string;
  memoryVaultConfig: MemoryVaultConfig;
  webSearchConfig: WebSearchConfig;
  webInteractionConfig: WebInteractionConfig;
  conversationArtifactToolConfig: ConversationArtifactToolConfig;
  conversationWindowToolConfig: ConversationWindowToolConfig;
  htmlArtifactToolConfig: HtmlArtifactToolConfig;
  hotboardConfig: HotboardConfig;
  runCommandConfig: RunCommandConfig;
  nativeToolConfig: NativeToolConfig;
  mcpToolConfig: McpToolConfig;
  qqBotToolConfig?: QQBotToolConfig;
  wechatClawBotToolConfig?: WechatClawBotToolConfig;
  webCruiseEnabled?: boolean;
}

export type ToolExecutionResult =
  | string
  | {
      type: 'image';
      text: string;
      dataUrl: string;
      displayContent?: string;
    };

export interface ToolModule {
  id: string;
  labels: Record<string, string>;
  getDefinitions: (config: ToolDefinitionConfig) => ToolDefinition[];
  execute: (
    toolName: string,
    args: Record<string, any>,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult | undefined>;
}
