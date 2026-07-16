import { Switch } from 'react-native';
import { ButtonRow, SettingsGroup, SettingsRow, TextEditRow } from '../ui';

type BuiltInToolCard = {
  key: string;
  name: string;
  intro: string;
  enabled: boolean;
  onValueChange: (value: boolean) => void;
  meta: string;
};

type BuiltInToolsSectionProps = {
  styles: any;
  colors: any;
  expanded: boolean;
  tools: BuiltInToolCard[];
  onToggleExpanded: () => void;
  onSelectTool: (key: string) => void;
};

type McpToolsSectionProps = {
  styles: any;
  colors: any;
  expanded: boolean;
  mcpMaxCalls: string;
  mcpServerName: string;
  mcpServerUrl: string;
  mcpServerAuth: string;
  mcpServers: any[];
  onToggleExpanded: () => void;
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

type OtherFeaturesSectionProps = BuiltInToolsSectionProps;

function SectionHeader({
  title,
  hint,
  expanded,
  onPress,
}: {
  title: string;
  hint: string;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <SettingsGroup marginBottom={expanded ? 10 : 20}>
      <SettingsRow
        label={title}
        sublabel={hint}
        value={expanded ? '收起' : '展开'}
        showChevron
        onPress={onPress}
      />
    </SettingsGroup>
  );
}

function ToolRows({
  tools,
  colors,
  onSelectTool,
  footer,
}: {
  tools: BuiltInToolCard[];
  colors: any;
  onSelectTool: (key: string) => void;
  footer: string;
}) {
  return (
    <SettingsGroup footer={footer}>
      {tools.map((tool) => (
        <SettingsRow
          key={tool.key}
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
      ))}
    </SettingsGroup>
  );
}

export function BuiltInToolsSection({
  colors,
  expanded,
  tools,
  onToggleExpanded,
  onSelectTool,
}: BuiltInToolsSectionProps) {
  return (
    <>
      <SectionHeader
        title="内置工具"
        hint="按类别管理 AI 可调用的内置能力。"
        expanded={expanded}
        onPress={onToggleExpanded}
      />
      {expanded && (
        <ToolRows
          tools={tools}
          colors={colors}
          onSelectTool={onSelectTool}
          footer="点击设置行可查看和编辑详情；右侧开关变更会自动保存。"
        />
      )}
    </>
  );
}

export function McpToolsSection({
  colors,
  expanded,
  mcpMaxCalls,
  mcpServerName,
  mcpServerUrl,
  mcpServerAuth,
  mcpServers,
  onToggleExpanded,
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
      <SectionHeader
        title="自定义 MCP"
        hint="连接远程 MCP 服务并管理它们暴露的工具与资源。"
        expanded={expanded}
        onPress={onToggleExpanded}
      />
      {expanded && (
        <>
          <SettingsGroup header="MCP 调用">
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
            <SettingsGroup>
              <SettingsRow label="尚未添加 MCP 服务" />
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
      )}
    </>
  );
}

export function OtherFeaturesSection({
  colors,
  expanded,
  tools,
  onToggleExpanded,
  onSelectTool,
}: OtherFeaturesSectionProps) {
  return (
    <>
      <SectionHeader
        title="其他功能"
        hint="管理不属于 AI 工具调用的本地辅助能力。"
        expanded={expanded}
        onPress={onToggleExpanded}
      />
      {expanded && (
        <ToolRows
          tools={tools}
          colors={colors}
          onSelectTool={onSelectTool}
          footer="点击设置行可查看配置详情。"
        />
      )}
    </>
  );
}
