import { NativeModules, Platform } from 'react-native';
import type { RunCommandConfig } from '../../stores/settings';
import { ToolDefinition, ToolModule } from './types';

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 3600000;
const DEFAULT_MAX_OUTPUT_CHARS = 20000;
const MAX_COMMAND_CHARS = 8000;

const RemoteSshCommand = NativeModules.RemoteSshCommand as
  | {
      connect: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
      command: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
      status: () => Promise<Record<string, unknown>>;
      close: () => Promise<Record<string, unknown>>;
    }
  | undefined;

const SSH_CONNECT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_connect',
    description:
      '连接用户在 Tool 设置中配置的专用 AI SSH 服务器，建立一个持久化 SSH transport。开始操作远程服务器前先调用；如果 session 已存在会直接复用，不要为每个命令重复连接。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const SSH_STATUS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_status',
    description:
      '探测当前持久化 SSH transport 是否仍然可用。需要确认 session 状态时使用；不要为了每条命令都调用 ssh_connect。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const SSH_COMMAND_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_command',
    description:
      '通过当前持久化 SSH transport 执行命令。必须先调用 ssh_connect。工具会尽量保留 cd 后的目录和 export 的环境变量；不要依赖 alias、shell 函数、交互式程序或前台长期进程状态。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要在当前 SSH shell 中执行的完整命令。',
        },
        timeout_ms: {
          type: 'number',
          description: '可选超时时间，单位毫秒。命令长时间不结束时会返回部分输出；前台进程可能仍占用当前 shell。',
        },
      },
      required: ['command'],
    },
  },
};

const SSH_CLOSE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_close',
    description:
      '关闭当前持久化 SSH transport。只有用户明确要求关闭连接、重置远程命令状态，或当前 session 已不可恢复时才调用；普通任务完成后不要自动关闭。',
    parameters: {
      type: 'object',
      properties: {
        confirm: {
          type: 'string',
          description: '必须填写 close_current_ssh_session，表示明确要关闭当前持久 SSH session。',
        },
      },
      required: ['confirm'],
    },
  },
};

export const runCommandTool: ToolModule = {
  id: 'run-command',
  labels: {
    ssh_connect: 'SSH 连接',
    ssh_status: 'SSH 状态',
    ssh_command: 'SSH 命令',
    ssh_close: 'SSH 关闭',
    run_command: '远程命令',
  },
  getDefinitions: (config) =>
    config.runCommand?.enabled ? [SSH_CONNECT_TOOL, SSH_STATUS_TOOL, SSH_COMMAND_TOOL, SSH_CLOSE_TOOL] : [],
  execute: async (toolName, args, context) => {
    if (toolName === 'ssh_connect') {
      return await executeSshConnect(args, context.runCommandConfig);
    }
    if (toolName === 'ssh_status') {
      return await executeSshStatus(context.runCommandConfig);
    }
    if (toolName === 'ssh_command') {
      return await executeSshCommand(args, context.runCommandConfig);
    }
    if (toolName === 'ssh_close') {
      return await executeSshClose(args, context.runCommandConfig);
    }
    if (toolName === 'run_command') {
      return await executeLegacyRunCommand(args, context.runCommandConfig);
    }
    return undefined;
  },
};

async function executeSshConnect(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);
  const result = await ensureRemoteSshCommand().connect({
    ...buildConnectionPayload(config),
    reconnect: false,
    cwd: config.defaultCwd || undefined,
    timeoutMs: normalizeTimeoutMs(args?.timeout_ms, config.timeoutMs),
    maxOutputChars,
  });
  return formatSshResponse('SSH session 连接结果：', result, maxOutputChars);
}

async function executeSshStatus(config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const result = await ensureRemoteSshCommand().status();
  return formatSshResponse('SSH session 状态：', result, normalizeMaxOutputChars(config.maxOutputChars));
}

async function executeSshCommand(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const command = String(args?.command || '').trim();
  if (!command) {
    throw new Error('command 不能为空');
  }
  if (command.length > MAX_COMMAND_CHARS) {
    throw new Error(`command 过长，最多 ${MAX_COMMAND_CHARS} 个字符`);
  }

  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms, config.timeoutMs);
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);
  const result = await ensureRemoteSshCommand().command({
    ...buildConnectionPayload(config),
    autoReconnect: true,
    cwd: config.defaultCwd || undefined,
    command,
    timeoutMs,
    maxOutputChars,
  });
  return formatSshResponse('SSH session 命令结果：', result, maxOutputChars);
}

async function executeSshClose(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  if (String(args?.confirm || '') !== 'close_current_ssh_session') {
    throw new Error('关闭 SSH session 需要 confirm=close_current_ssh_session');
  }
  const result = await ensureRemoteSshCommand().close();
  return formatSshResponse('SSH session 关闭结果：', result, normalizeMaxOutputChars(config.maxOutputChars));
}

async function executeLegacyRunCommand(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  await executeSshConnect({}, config);
  return await executeSshCommand(args, config);
}

function ensureSshConfig(config: RunCommandConfig): void {
  if (!config?.enabled) {
    throw new Error('远程命令工具未启用，请先在「Tool 设置」中打开');
  }
  if (Platform.OS !== 'android') {
    throw new Error('SSH 远程命令当前仅支持 Android development build');
  }

  const sshHost = String(config.sshHost || '').trim();
  const sshUsername = String(config.sshUsername || '').trim();
  if (!sshHost) {
    throw new Error('请先在「Tool 设置」中填写 SSH 主机');
  }
  if (!sshUsername) {
    throw new Error('请先在「Tool 设置」中填写 SSH 用户名');
  }
  if (!String(config.sshPassword || '').trim() && !String(config.sshPrivateKey || '').trim()) {
    throw new Error('请至少配置 SSH 密码或私钥');
  }
}

function ensureRemoteSshCommand(): NonNullable<typeof RemoteSshCommand> {
  if (!RemoteSshCommand) {
    throw new Error('SSH 原生模块未加载，请重新运行 npx expo run:android 安装包含原生模块的新包');
  }
  return RemoteSshCommand;
}

function buildConnectionPayload(config: RunCommandConfig): Record<string, unknown> {
  return {
    host: String(config.sshHost || '').trim(),
    port: normalizePort(config.sshPort),
    username: String(config.sshUsername || '').trim(),
    password: config.sshPassword || undefined,
    privateKey: config.sshPrivateKey || undefined,
    passphrase: config.sshPassphrase || undefined,
    strictHostKeyChecking: !!config.strictHostKeyChecking,
    knownHosts: config.knownHosts || undefined,
  };
}

function normalizeTimeoutMs(input: unknown, fallback: number): number {
  const value = typeof input === 'number' ? input : fallback;
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

function normalizeMaxOutputChars(input: number): number {
  if (!Number.isFinite(input) || input <= 0) return DEFAULT_MAX_OUTPUT_CHARS;
  return Math.min(500000, Math.max(1000, Math.round(input)));
}

function normalizePort(input: number): number {
  if (!Number.isFinite(input)) return 22;
  return Math.min(65535, Math.max(1, Math.round(input)));
}

function formatSshResponse(title: string, data: any, maxOutputChars: number): string {
  const exitCode = data?.exit_code ?? data?.exitCode ?? data?.code;
  const stdout = normalizeOutput(data?.stdout ?? data?.output);
  const stderr = normalizeOutput(data?.stderr ?? data?.error);
  const durationMs = data?.duration_ms ?? data?.durationMs;
  const host = normalizeOutput(data?.host);
  const username = normalizeOutput(data?.username);
  const status = normalizeOutput(data?.status);
  const sessionId = normalizeOutput(data?.session_id ?? data?.sessionId);
  const sessionConnected = data?.session_connected ?? data?.sessionConnected;
  const timedOut = data?.timed_out ?? data?.timedOut;
  const cwd = normalizeOutput(data?.cwd);
  const retriedAfterReconnect = data?.retried_after_reconnect ?? data?.retriedAfterReconnect;
  const reconnectReason = normalizeOutput(data?.reconnect_reason ?? data?.reconnectReason);
  const lastError = normalizeOutput(data?.last_error ?? data?.lastError);

  const lines = [
    title,
    status ? `status: ${status}` : '',
    sessionId ? `session_id: ${sessionId}` : '',
    host ? `host: ${username ? `${username}@` : ''}${host}${data?.port ? `:${data.port}` : ''}` : '',
    cwd ? `cwd: ${cwd}` : '',
    typeof sessionConnected !== 'undefined' ? `session_connected: ${String(!!sessionConnected)}` : '',
    typeof retriedAfterReconnect !== 'undefined'
      ? `retried_after_reconnect: ${String(!!retriedAfterReconnect)}`
      : '',
    reconnectReason ? `reconnect_reason: ${reconnectReason}` : '',
    lastError ? `last_error: ${lastError}` : '',
    typeof exitCode !== 'undefined' ? `exit_code: ${String(exitCode)}` : '',
    typeof timedOut !== 'undefined' ? `timed_out: ${String(!!timedOut)}` : '',
    typeof durationMs !== 'undefined' ? `duration_ms: ${String(durationMs)}` : '',
    stdout ? `\n[stdout]\n${stdout}` : '',
    stderr ? `\n[stderr]\n${stderr}` : '',
  ].filter(Boolean);

  return truncateOutput(lines.join('\n') || 'SSH 操作已完成，未返回输出。', maxOutputChars);
}

function normalizeOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'undefined') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateOutput(output: string, maxOutputChars: number): string {
  if (output.length <= maxOutputChars) return output;
  const omitted = output.length - maxOutputChars;
  return `${output.slice(0, maxOutputChars)}\n\n[输出已截断，省略 ${omitted} 个字符]`;
}
