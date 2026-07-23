import { Switch } from 'react-native';
import { ButtonRow, SettingsGroup, SettingsRow, TextEditRow } from '../ui';

export type BuiltInToolCard = {
  key: string;
  name: string;
  intro: string;
  enabled: boolean;
  onValueChange: (value: boolean) => void;
  meta: string;
};

export type BuiltInToolGroup = {
  title: string;
  footer?: string;
  tools: BuiltInToolCard[];
};

type BuiltInToolsSectionProps = {
  colors: any;
  groups: BuiltInToolGroup[];
  onSelectTool: (key: string) => void;
};

type McpToolsSectionProps = {
  colors: any;
  mcpMaxCalls: string;
  mcpServerName: string;
  mcpServerUrl: string;
  mcpServerAuth: string;
  mcpServers: any[];
  onChangeMaxCalls: (value: string) => void;
  onChangeServerName: (value: string) => void;
  onChangeServerUrl: (value: string) => void;
  onChangeServerAuth: (value: string) => void;
  onAddServer: () => void;
  onSelectServer: (id: string) => void;
  onUpdateServer: (id: string, patch: any) => void;
  getEnabledToolCount: (server: any) => number;
  getEnabledResourceCount: (server: any) => number;
};

type OtherFeaturesSectionProps = {
  colors: any;
  tools: BuiltInToolCard[];
  onSelectTool: (key: string) => void;
};

function ToolRow({
  tool,
  colors,
  onSelectTool,
}: {
  tool: BuiltInToolCard;
  colors: any;
  onSelectTool: (key: string) => void;
}) {
  return (
    <SettingsRow
      label={tool.name}
      sublabel={`${tool.intro} · ${tool.meta}`}
      onPress={() => onSelectTool(tool.key)}
      showChevron
      right={
        <Switch
          value={tool.enabled}
          onValueChange={tool.onValueChange}
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      }
    />
  );
}

export function BuiltInToolsSection({ colors, groups, onSelectTool }: BuiltInToolsSectionProps) {
  return (
    <>
      {groups.map((group) => (
        <SettingsGroup key={group.title} header={group.title} footer={group.footer}>
          {group.tools.map((tool) => (
            <ToolRow key={tool.key} tool={tool} colors={colors} onSelectTool={onSelectTool} />
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}

export function McpToolsSection({
  colors,
  mcpMaxCalls,
  mcpServerName,
  mcpServerUrl,
  mcpServerAuth,
  mcpServers,
  onChangeMaxCalls,
  onChangeServerName,
  onChangeServerUrl,
  onChangeServerAuth,
  onAddServer,
  onSelectServer,
  onUpdateServer,
  getEnabledToolCount,
  getEnabledResourceCount,
}: McpToolsSectionProps) {
  return (
    <>
      <SettingsGroup header="MCP 调用" footer="控制 AI 在每轮对话中调用 MCP 工具的次数上限。">
        <TextEditRow
          label="每轮最大调用次数"
          value={mcpMaxCalls}
          keyboardType="number-pad"
          inputPlaceholder="6"
          onSave={onChangeMaxCalls}
        />
      </SettingsGroup>
      <SettingsGroup header="添加 MCP 服务">
        <TextEditRow label="服务名称" value={mcpServerName} inputPlaceholder="服务名称" onSave={onChangeServerName} />
        <TextEditRow label="服务地址" value={mcpServerUrl} inputPlaceholder="https://example.com/mcp" onSave={onChangeServerUrl} />
        <TextEditRow label="授权信息" value={mcpServerAuth} placeholder="可选" secure inputPlaceholder="Bearer ..." onSave={onChangeServerAuth} />
        <ButtonRow label="添加服务" onPress={onAddServer} />
      </SettingsGroup>
      {mcpServers.length === 0 ? (
        <SettingsGroup header="已添加服务">
          <SettingsRow label="尚未添加 MCP 服务" sublabel="在上方填写服务信息后添加。" />
        </SettingsGroup>
      ) : (
        <SettingsGroup header="已添加服务">
          {mcpServers.map((server) => (
            <SettingsRow
              key={server.id}
              label={server.name}
              sublabel={`${server.url} · 工具 ${getEnabledToolCount(server)}/${server.tools.length} · 资源 ${getEnabledResourceCount(server)}/${(server.resources || []).length} · 提示词 ${(server.prompts || []).length}`}
              onPress={() => onSelectServer(server.id)}
              showChevron
              right={
                <Switch
                  value={server.enabled}
                  onValueChange={(value) => onUpdateServer(server.id, { enabled: value })}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor="#FFFFFF"
                />
              }
            />
          ))}
        </SettingsGroup>
      )}
    </>
  );
}

export function OtherFeaturesSection({ colors, tools, onSelectTool }: OtherFeaturesSectionProps) {
  return (
    <SettingsGroup
      header="辅助功能"
      footer="这些能力用于完善本地体验，不会作为工具直接提供给 AI 调用。"
    >
      {tools.map((tool) => (
        <ToolRow key={tool.key} tool={tool} colors={colors} onSelectTool={onSelectTool} />
      ))}
    </SettingsGroup>
  );
}
