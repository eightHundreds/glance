export type PanelLayout = 'side' | 'center';

export type ModelProvider = 'openai' | 'deepseek' | 'custom';

export type UserSettings = {
  themeColor: string;
  panelLayout: PanelLayout;
  syncEnabled: boolean;
  modelProvider: ModelProvider;
  modelName: string;
  apiBaseUrl: string;
  summaryPrompt: string;
};

export type StorageBackend = 'sync' | 'local' | 'none';

export type SyncResult = {
  backend: StorageBackend;
  success: boolean;
  timestamp: number;
  message?: string;
};

export type SyncStatus = {
  supported: boolean;
  enabled: boolean;
  usingSync: boolean;
  backend: StorageBackend;
  provider?: 'chrome' | 'edge' | 'firefox' | 'unknown';
  note?: string;
  lastResult?: SyncResult;
  error?: string;
};

export type SettingsState = {
  settings: UserSettings;
  status: SyncStatus;
  model: ModelConfigState;
};

export type ModelTestResult = {
  success: boolean;
  timestamp: number;
  message?: string;
};

export type ModelConnectionParams = {
  apiKey: string;
  apiBaseUrl: string;
  modelName: string;
  provider: ModelProvider;
};

export type ModelConfigState = {
  provider: ModelProvider;
  modelName: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
  ready: boolean;
  note: string;
  lastTest?: ModelTestResult;
  summaryPrompt: SummaryPromptState;
};

const STORAGE_KEY = 'glanceSettings';
const META_KEY = 'glanceSettingsSyncMeta';
const MODEL_SECRET_KEY = 'glanceModelSecrets';
const HEX_COLOR_REGEX = /^#?([0-9a-f]{6})$/i;

const MODEL_PRESETS: Record<ModelProvider, { baseUrl: string; modelName: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o-mini'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    modelName: 'deepseek-chat'
  },
  custom: {
    baseUrl: '',
    modelName: 'gpt-4o-mini'
  }
};

const DEFAULT_SUMMARY_PROMPT = `你是一个浏览网页助手。请：
1. 提炼页面内的重要信息，保持结构化 Markdown；
2. 用简洁的语气概括核心观点；
3. 标注出与用户可能相关的链接或后续动作。`;

export const DEFAULT_SETTINGS: UserSettings = {
  themeColor: '#0ea5e9',
  panelLayout: 'side',
  syncEnabled: true,
  modelProvider: 'openai',
  modelName: MODEL_PRESETS.openai.modelName,
  apiBaseUrl: MODEL_PRESETS.openai.baseUrl,
  summaryPrompt: DEFAULT_SUMMARY_PROMPT
};

type ExtensionPlatform = 'browser' | 'chrome' | 'none';

type BrowserStorageArea = {
  get: (keys?: string | string[] | Record<string, unknown> | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

type StorageAreaAdapter = {
  getKey<T>(key: string): Promise<T | undefined>;
  setKey<T>(key: string, value: T): Promise<void>;
};

type StorageContext = {
  platform: ExtensionPlatform;
  sync: chrome.storage.StorageArea | null;
  local: chrome.storage.StorageArea | null;
};

type AdapterReadResult<T> = {
  value: T | null;
  error?: string;
};

type WriteResult = {
  success: boolean;
  error?: string;
};

type ModelSecretRecord = {
  apiKey?: string;
  updatedAt?: number;
  lastTest?: ModelTestResult;
};

export type SummaryPromptState = {
  value: string;
  isDefault: boolean;
};

function detectPlatform(): ExtensionPlatform {
  if (typeof browser !== 'undefined' && browser?.storage) {
    return 'browser';
  }
  if (typeof chrome !== 'undefined' && chrome?.storage) {
    return 'chrome';
  }
  return 'none';
}

function getStorageContext(): StorageContext {
  const platform = detectPlatform();
  if (platform === 'browser') {
    return {
      platform,
      sync: browser?.storage?.sync ?? null,
      local: browser?.storage?.local ?? null
    };
  }
  if (platform === 'chrome') {
    return {
      platform,
      sync: chrome.storage?.sync ?? null,
      local: chrome.storage?.local ?? null
    };
  }
  return { platform: 'none', sync: null, local: null };
}

function createAdapter(area: chrome.storage.StorageArea | null, platform: ExtensionPlatform): StorageAreaAdapter | null {
  if (!area) {
    return null;
  }
  if (platform === 'browser') {
    const browserArea = area as unknown as BrowserStorageArea;
    return {
      async getKey<T>(key: string) {
        const result = await browserArea.get(key);
        return result?.[key] as T | undefined;
      },
      async setKey<T>(key: string, value: T) {
        await browserArea.set({ [key]: value });
      }
    };
  }
  if (platform === 'chrome') {
    return {
      getKey<T>(key: string) {
        return new Promise<T | undefined>((resolve, reject) => {
          area.get(key, items => {
            if (chrome.runtime?.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            resolve((items ?? ({} as Record<string, unknown>))[key] as T | undefined);
          });
        });
      },
      setKey<T>(key: string, value: T) {
        return new Promise<void>((resolve, reject) => {
          area.set({ [key]: value }, () => {
            if (chrome.runtime?.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            resolve();
          });
        });
      }
    };
  }
  return null;
}

function sanitizeThemeColor(input: string | undefined): string {
  if (!input) {
    return DEFAULT_SETTINGS.themeColor;
  }
  const normalized = input.trim();
  const match = normalized.match(HEX_COLOR_REGEX);
  if (!match) {
    return DEFAULT_SETTINGS.themeColor;
  }
  return `#${match[1].toLowerCase()}`;
}

function sanitizeLayout(layout?: string): PanelLayout {
  return layout === 'center' ? 'center' : 'side';
}

function sanitizeSyncEnabled(value: boolean | undefined): boolean {
  return value === false ? false : true;
}

function sanitizeModelProvider(provider?: string): ModelProvider {
  if (provider === 'deepseek' || provider === 'custom') {
    return provider;
  }
  return 'openai';
}

function normalizeBaseUrl(input?: string): string {
  if (!input) {
    return '';
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }
  try {
    const url = new URL(normalized);
    return url.href.replace(/\/+$/, '');
  } catch {
    return normalized.replace(/\/+$/, '');
  }
}

function sanitizeApiBaseUrl(provider: ModelProvider, url?: string): string {
  const normalized = normalizeBaseUrl(url);
  if (normalized) {
    return normalized;
  }
  const preset = MODEL_PRESETS[provider].baseUrl;
  return preset ? normalizeBaseUrl(preset) : '';
}

function sanitizeModelName(provider: ModelProvider, modelName?: string): string {
  const trimmed = (modelName ?? '').trim();
  if (trimmed) {
    return trimmed;
  }
  return MODEL_PRESETS[provider].modelName;
}

const SUMMARY_PROMPT_LIMIT = 1000;

function sanitizeSummaryPrompt(prompt?: string): { value: string; isDefault: boolean } {
  const trimmed = (prompt ?? '').trim();
  if (!trimmed) {
    return { value: DEFAULT_SUMMARY_PROMPT, isDefault: true };
  }
  const limited = trimmed.slice(0, SUMMARY_PROMPT_LIMIT);
  return {
    value: limited,
    isDefault: limited === DEFAULT_SUMMARY_PROMPT
  };
}

function sanitizeSettings(input?: Partial<UserSettings> | null): UserSettings {
  if (!input) {
    return { ...DEFAULT_SETTINGS };
  }
  const provider = sanitizeModelProvider(input.modelProvider);
  const promptResult = sanitizeSummaryPrompt(input.summaryPrompt);
  return {
    themeColor: sanitizeThemeColor(input.themeColor),
    panelLayout: sanitizeLayout(input.panelLayout),
    syncEnabled: sanitizeSyncEnabled(input.syncEnabled),
    modelProvider: provider,
    modelName: sanitizeModelName(provider, input.modelName),
    apiBaseUrl: sanitizeApiBaseUrl(provider, input.apiBaseUrl),
    summaryPrompt: promptResult.value
  };
}

function sanitizeSyncResult(input: unknown): SyncResult | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const data = input as Partial<SyncResult>;
  if (data.backend !== 'sync' && data.backend !== 'local' && data.backend !== 'none') {
    return null;
  }
  if (typeof data.timestamp !== 'number') {
    return null;
  }
  if (typeof data.success !== 'boolean') {
    return null;
  }
  const message = typeof data.message === 'string' ? data.message : undefined;
  return {
    backend: data.backend,
    success: data.success,
    timestamp: data.timestamp,
    message
  };
}

function sanitizeModelTestResult(input: unknown): ModelTestResult | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const data = input as Partial<ModelTestResult>;
  if (typeof data.success !== 'boolean' || typeof data.timestamp !== 'number') {
    return undefined;
  }
  return {
    success: data.success,
    timestamp: data.timestamp,
    message: typeof data.message === 'string' ? data.message : undefined
  };
}

function sanitizeModelSecretRecord(input: unknown): ModelSecretRecord | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const data = input as Partial<ModelSecretRecord>;
  const apiKey = typeof data.apiKey === 'string' && data.apiKey.trim().length > 0 ? data.apiKey : undefined;
  const updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : undefined;
  const lastTest = sanitizeModelTestResult(data.lastTest);
  if (!apiKey && !updatedAt && !lastTest) {
    return null;
  }
  return {
    apiKey,
    updatedAt,
    lastTest
  };
}

function toErrorMessage(error: unknown): string {
  if (!error) {
    return '未知错误';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function readSettingsFromAdapter(adapter: StorageAreaAdapter | null): Promise<AdapterReadResult<UserSettings>> {
  if (!adapter) {
    return { value: null };
  }
  try {
    const raw = await adapter.getKey<Partial<UserSettings>>(STORAGE_KEY);
    if (!raw) {
      return { value: null };
    }
    return { value: sanitizeSettings(raw) };
  } catch (error) {
    return { value: null, error: toErrorMessage(error) };
  }
}

async function readSyncMetaFromAdapter(adapter: StorageAreaAdapter | null): Promise<AdapterReadResult<SyncResult>> {
  if (!adapter) {
    return { value: null };
  }
  try {
    const raw = await adapter.getKey<SyncResult>(META_KEY);
    if (!raw) {
      return { value: null };
    }
    const sanitized = sanitizeSyncResult(raw);
    return { value: sanitized };
  } catch (error) {
    return { value: null, error: toErrorMessage(error) };
  }
}

async function writeSettingsToAdapter(adapter: StorageAreaAdapter | null, settings: UserSettings): Promise<WriteResult> {
  if (!adapter) {
    return { success: false, error: '存储区域不可用' };
  }
  try {
    await adapter.setKey(STORAGE_KEY, settings);
    return { success: true };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}

async function writeMetaToAdapter(adapter: StorageAreaAdapter | null, meta: SyncResult): Promise<WriteResult> {
  if (!adapter) {
    return { success: false, error: '存储区域不可用' };
  }
  try {
    await adapter.setKey(META_KEY, meta);
    return { success: true };
  } catch (error) {
    return { success: false, error: toErrorMessage(error) };
  }
}

function detectProvider(): SyncStatus['provider'] {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  const ua = navigator.userAgent;
  if (/Firefox/i.test(ua)) {
    return 'firefox';
  }
  if (/Edg/i.test(ua)) {
    return 'edge';
  }
  if (/Chrome/i.test(ua)) {
    return 'chrome';
  }
  return 'unknown';
}

function buildStatusNote(supported: boolean, enabled: boolean, usingSync: boolean, backend: StorageBackend, error?: string): string {
  if (!supported) {
    return '当前浏览器未提供同步服务，设置仅保存到本地。';
  }
  if (!enabled) {
    return '同步已关闭，设置仅保存到本地。';
  }
  if (error) {
    return `同步暂不可用：${error}`;
  }
  if (usingSync) {
    return '设置正通过浏览器账户同步。';
  }
  if (backend === 'local') {
    return '同步已开启，但当前使用本地副本。';
  }
  return '浏览器存储不可用，设置可能无法持久化。';
}

async function readSyncMetadata(context: StorageContext): Promise<SyncResult | null> {
  const adapter = createAdapter(context.local, context.platform);
  const fromLocal = await readSyncMetaFromAdapter(adapter);
  return fromLocal.value ?? null;
}

async function readModelSecret(context: StorageContext): Promise<ModelSecretRecord | null> {
  const adapter = createAdapter(context.local, context.platform);
  if (!adapter) {
    return null;
  }
  try {
    const raw = await adapter.getKey<ModelSecretRecord>(MODEL_SECRET_KEY);
    return sanitizeModelSecretRecord(raw);
  } catch (error) {
    console.warn('[Glance] Failed to read model secret', error);
    return null;
  }
}

async function writeModelSecret(context: StorageContext, record: ModelSecretRecord | null) {
  const adapter = createAdapter(context.local, context.platform);
  if (!adapter) {
    throw new Error('本地存储不可用，无法写入模型密钥');
  }
  const payload: Record<string, unknown> = {};
  if (record?.apiKey) {
    payload.apiKey = record.apiKey;
  }
  if (record?.updatedAt) {
    payload.updatedAt = record.updatedAt;
  }
  if (record?.lastTest) {
    payload.lastTest = record.lastTest;
  }
  await adapter.setKey(MODEL_SECRET_KEY, payload);
}

async function persistSyncMetadata(context: StorageContext, meta: SyncResult) {
  const adapter = createAdapter(context.local, context.platform);
  const result = await writeMetaToAdapter(adapter, meta);
  if (!result.success && result.error) {
    console.warn('[Glance] Failed to write sync metadata:', result.error);
  }
}

async function buildModelConfigState(settings: UserSettings, context: StorageContext): Promise<ModelConfigState> {
  const secret = await readModelSecret(context);
  const hasApiKey = typeof secret?.apiKey === 'string' && secret.apiKey.trim().length > 0;
  const missing: string[] = [];
  if (!hasApiKey) {
    missing.push('API 密钥');
  }
  if (!settings.apiBaseUrl) {
    missing.push('API Base URL');
  }
  if (!settings.modelName) {
    missing.push('模型名称');
  }
  const ready = missing.length === 0;
  const note = ready
    ? '模型配置完整，可直接用于总结。'
    : `缺少 ${missing.join('、')}，请在设置页补全。`;
  const summaryPrompt = sanitizeSummaryPrompt(settings.summaryPrompt);
  return {
    provider: settings.modelProvider,
    modelName: settings.modelName,
    apiBaseUrl: settings.apiBaseUrl,
    hasApiKey,
    ready,
    note,
    lastTest: secret?.lastTest,
    summaryPrompt: {
      value: summaryPrompt.value,
      isDefault: summaryPrompt.isDefault
    }
  };
}

async function resolveSettingsFromStorage(context: StorageContext): Promise<{ settings: UserSettings; backend: StorageBackend; syncError?: string }> {
  const syncAdapter = createAdapter(context.sync, context.platform);
  const localAdapter = createAdapter(context.local, context.platform);

  const localResult = await readSettingsFromAdapter(localAdapter);
  let baseSettings = localResult.value ?? null;
  let sourceBackend: StorageBackend = localResult.value ? 'local' : 'none';
  let syncError: string | undefined;
  const preferSync = (baseSettings?.syncEnabled ?? DEFAULT_SETTINGS.syncEnabled) && !!syncAdapter;

  if (preferSync && syncAdapter) {
    const syncResult = await readSettingsFromAdapter(syncAdapter);
    if (syncResult.error) {
      syncError = syncResult.error;
    } else if (syncResult.value) {
      baseSettings = syncResult.value;
      sourceBackend = 'sync';
    }
  } else if (!context.sync && (baseSettings?.syncEnabled ?? DEFAULT_SETTINGS.syncEnabled)) {
    syncError = '宿主未提供同步能力';
  }

  if (!baseSettings) {
    baseSettings = { ...DEFAULT_SETTINGS };
    sourceBackend = localAdapter ? 'local' : 'none';
  }

  const settings = sanitizeSettings(baseSettings);

  if (localAdapter && sourceBackend !== 'local') {
    void writeSettingsToAdapter(localAdapter, settings);
  }

  return { settings, backend: sourceBackend, syncError };
}

async function persistSettings(settings: UserSettings): Promise<SettingsState> {
  const context = getStorageContext();
  const syncAdapter = createAdapter(context.sync, context.platform);
  const localAdapter = createAdapter(context.local, context.platform);
  const provider = context.sync ? detectProvider() : undefined;

  let usingSync = false;
  let error: string | undefined;

  if (settings.syncEnabled && syncAdapter) {
    const writeResult = await writeSettingsToAdapter(syncAdapter, settings);
    if (writeResult.success) {
      usingSync = true;
    } else {
      error = writeResult.error;
    }
  } else if (settings.syncEnabled && !context.sync) {
    error = '宿主未提供同步能力';
  }

  const localResult = await writeSettingsToAdapter(localAdapter, settings);
  if (!localResult.success && !error) {
    error = localResult.error;
  }
  const backend: StorageBackend = usingSync ? 'sync' : localResult.success ? 'local' : 'none';
  const succeeded = usingSync || localResult.success;

  const meta: SyncResult = {
    backend,
    success: succeeded,
    timestamp: Date.now(),
    message: succeeded
      ? usingSync
        ? '已同步到浏览器服务'
        : '已保存到本地'
      : error ?? '保存设置失败'
  };

  await persistSyncMetadata(context, meta);

  const status: SyncStatus = {
    supported: !!context.sync,
    enabled: settings.syncEnabled,
    usingSync,
    backend,
    provider,
    note: buildStatusNote(!!context.sync, settings.syncEnabled, usingSync, backend, error),
    lastResult: meta,
    error
  };

  const model = await buildModelConfigState(settings, context);
  return { settings, status, model };
}

export async function loadSettingsState(): Promise<SettingsState> {
  const context = getStorageContext();
  const { settings, backend, syncError } = await resolveSettingsFromStorage(context);
  const meta = await readSyncMetadata(context);
  const status: SyncStatus = {
    supported: !!context.sync,
    enabled: settings.syncEnabled,
    usingSync: backend === 'sync',
    backend,
    provider: context.sync ? detectProvider() : undefined,
    note: buildStatusNote(!!context.sync, settings.syncEnabled, backend === 'sync', backend, syncError),
    lastResult: meta ?? undefined,
    error: syncError
  };
  const model = await buildModelConfigState(settings, context);
  return { settings, status, model };
}

export async function saveSettingsState(update: Partial<UserSettings>, base?: UserSettings): Promise<SettingsState> {
  const current = base ?? (await loadSettingsState()).settings;
  const next = sanitizeSettings({ ...current, ...update });
  return persistSettings(next);
}

export async function loadModelConfigState(): Promise<ModelConfigState> {
  const context = getStorageContext();
  const { settings } = await resolveSettingsFromStorage(context);
  return buildModelConfigState(settings, context);
}

export async function saveModelApiKey(apiKey: string, testResult: ModelTestResult): Promise<ModelConfigState> {
  if (!apiKey.trim()) {
    throw new Error('API Key 不能为空');
  }
  const context = getStorageContext();
  await writeModelSecret(context, {
    apiKey: apiKey.trim(),
    updatedAt: Date.now(),
    lastTest: testResult
  });
  const { settings } = await resolveSettingsFromStorage(context);
  return buildModelConfigState(settings, context);
}

export async function clearModelApiKey(): Promise<ModelConfigState> {
  const context = getStorageContext();
  await writeModelSecret(context, null);
  const { settings } = await resolveSettingsFromStorage(context);
  return buildModelConfigState(settings, context);
}

export function getDefaultSummaryPrompt(): string {
  return DEFAULT_SUMMARY_PROMPT;
}

export async function getModelApiKey(): Promise<string | null> {
  const context = getStorageContext();
  const secret = await readModelSecret(context);
  return secret?.apiKey ?? null;
}

export async function testModelConnection(params: ModelConnectionParams): Promise<ModelTestResult> {
  const baseUrl = sanitizeApiBaseUrl(params.provider, params.apiBaseUrl);
  if (!baseUrl) {
    throw new Error('API Base URL 不能为空');
  }
  const apiKey = params.apiKey?.trim();
  if (!apiKey) {
    throw new Error('API Key 不能为空');
  }
  const endpoint = `${baseUrl}/models`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      }
    });
  } catch (error) {
    throw new Error(`网络请求失败：${toErrorMessage(error)}`);
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      const detail =
        typeof body?.error?.message === 'string'
          ? body.error.message
          : typeof body?.message === 'string'
            ? body.message
            : null;
      if (detail) {
        message = `${message} · ${detail}`;
      }
    } catch {
      try {
        const text = await response.text();
        if (text) {
          message = `${message} · ${text.slice(0, 160)}`;
        }
      } catch {
        // ignore
      }
    }
    throw new Error(message);
  }

  return {
    success: true,
    timestamp: Date.now(),
    message: params.modelName ? `已验证 ${params.modelName}` : '模型连通性正常'
  };
}

export function watchSettings(callback: (settings: UserSettings) => void): () => void {
  const changeEvent: chrome.storage.StorageChangedEvent | null =
    typeof chrome !== 'undefined' && chrome.storage?.onChanged
      ? chrome.storage.onChanged
      : typeof browser !== 'undefined' && browser?.storage?.onChanged
        ? (browser.storage.onChanged as unknown as chrome.storage.StorageChangedEvent)
        : null;

  if (!changeEvent) {
    return () => {};
  }

  const handleChange: Parameters<typeof changeEvent.addListener>[0] = changes => {
    const record = changes[STORAGE_KEY];
    if (!record) {
      return;
    }
    callback(sanitizeSettings(record.newValue as Partial<UserSettings>));
  };

  changeEvent.addListener(handleChange);
  return () => changeEvent.removeListener(handleChange);
}
