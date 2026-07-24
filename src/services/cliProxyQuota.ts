export interface ClaudeQuotaWindow {
  key: string;
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string;
}

export interface ClaudeQuotaAccount {
  name: string;
  windows: ClaudeQuotaWindow[];
}

interface AuthFileRecord {
  name?: string;
  type?: string;
  provider?: string;
  disabled?: boolean;
  auth_index?: string | number;
  authIndex?: string | number;
  [key: string]: unknown;
}

const QUOTA_WINDOWS: Array<[string, string]> = [
  ['five_hour', '5 小时'],
  ['seven_day', '7 天'],
  ['seven_day_oauth_apps', '7 天 OAuth'],
  ['seven_day_opus', '7 天 Opus'],
  ['seven_day_sonnet', '7 天 Sonnet'],
  ['seven_day_cowork', '7 天 Cowork'],
];

function managementBaseUrl(value: string): string {
  let base = value.trim().replace(/\/+$/, '');
  base = base.replace(/\/management\.html(?:[?#].*)?$/i, '');
  base = base.replace(/\/v0\/management$/i, '');
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return `${base}/v0/management`;
}

async function managementFetch(
  baseUrl: string,
  password: string,
  path: string,
  init?: RequestInit
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${password}`,
        ...(init?.headers || {}),
      },
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const message = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function isClaudeAuth(file: AuthFileRecord): boolean {
  return `${file.type || ''} ${file.provider || ''}`.toLowerCase().includes('claude') && !file.disabled;
}

function parseQuotaWindows(payload: any): ClaudeQuotaWindow[] {
  return QUOTA_WINDOWS.flatMap(([key, label]) => {
    const item = payload?.[key];
    const utilization = Number(item?.utilization);
    if (!Number.isFinite(utilization)) return [];
    const usedPercent = Math.max(0, Math.min(100, utilization));
    return [{
      key,
      label,
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      resetsAt: typeof item?.resets_at === 'string' ? item.resets_at : undefined,
    }];
  });
}

export async function fetchClaudeQuota(options: {
  serverUrl: string;
  account?: string;
  password: string;
}): Promise<ClaudeQuotaAccount[]> {
  const baseUrl = managementBaseUrl(options.serverUrl);
  const authResponse = await managementFetch(baseUrl, options.password.trim(), '/auth-files');
  const files: AuthFileRecord[] = Array.isArray(authResponse?.files)
    ? authResponse.files
    : Array.isArray(authResponse)
      ? authResponse
      : [];
  const accountQuery = options.account?.trim().toLowerCase();
  const claudeFiles = files.filter((file) => {
    if (!isClaudeAuth(file)) return false;
    if (!accountQuery) return true;
    return JSON.stringify(file).toLowerCase().includes(accountQuery);
  });

  if (claudeFiles.length === 0) {
    throw new Error(accountQuery ? '未找到匹配账号的 Claude 凭据' : '未找到可用的 Claude 凭据');
  }

  const accounts = await Promise.all(claudeFiles.slice(0, 6).map(async (file) => {
    const authIndex = file.auth_index ?? file.authIndex;
    if (authIndex === undefined || authIndex === null || String(authIndex).trim() === '') {
      throw new Error(`${file.name || 'Claude 凭据'}缺少 auth_index`);
    }
    const result = await managementFetch(baseUrl, options.password.trim(), '/api-call', {
      method: 'POST',
      body: JSON.stringify({
        auth_index: String(authIndex),
        method: 'GET',
        url: 'https://api.anthropic.com/api/oauth/usage',
        header: {
          Authorization: 'Bearer $TOKEN$',
          'Content-Type': 'application/json',
          'anthropic-beta': 'oauth-2025-04-20',
        },
      }),
    });
    if (Number(result?.status_code) < 200 || Number(result?.status_code) >= 300) {
      throw new Error(`Claude 额度接口返回 HTTP ${result?.status_code || 0}`);
    }
    let payload = result?.body;
    if (typeof payload === 'string') payload = JSON.parse(payload);
    return {
      name: String(file.name || file.provider || 'Claude'),
      windows: parseQuotaWindows(payload),
    };
  }));

  return accounts.filter((account) => account.windows.length > 0);
}
