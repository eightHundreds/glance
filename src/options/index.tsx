import React, { ChangeEvent, StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import useSWR from 'swr';
import {
  DEFAULT_SETTINGS,
  type ModelConfigState,
  type ModelProvider,
  type SettingsState,
  loadSettingsState,
  saveSettingsState,
  saveModelApiKey,
  clearModelApiKey,
  testModelConnection,
  getDefaultSummaryPrompt,
  SyncStatus,
  UserSettings
} from '../shared/settings';
import { MODEL_CONFIG_UPDATED } from '../shared/messages';

type Status = {
  text: string;
  isError: boolean;
};

const INITIAL_STATUS: Status = { text: '尚未加载', isError: false };

const NAV_SECTIONS = [
  {
    id: 'appearance',
    title: '主题与颜色',
    description: '自定义 Glance 的主题风格'
  },
  {
    id: 'layout',
    title: '面板布局',
    description: '选择弹出面板的位置与宽度'
  },
  {
    id: 'sync',
    title: '同步设置',
    description: '控制是否通过浏览器同步 Glance 配置'
  },
  {
    id: 'model',
    title: '大模型设置',
    description: '提前配置 OpenAI 兼容 API 与凭据'
  }
];

const PROVIDER_OPTIONS: Array<{
  value: ModelProvider;
  label: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
  docs?: string;
}> = [
  {
    value: 'openai',
    label: 'OpenAI',
    description: '使用官方 OpenAI API，默认 `https://api.openai.com/v1`。',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    docs: 'https://platform.openai.com/api-keys'
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    description: '连接 DeepSeek Chat/Reasoner，默认 `https://api.deepseek.com/v1`。',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    docs: 'https://platform.deepseek.com/'
  },
  {
    value: 'custom',
    label: '自定义（OpenAI 兼容）',
    description: '适配自托管或其他兼容 OpenAI 协议的 API，需要手动输入 Base URL。',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini'
  }
];

const PROVIDER_HINTS: Record<ModelProvider, string> = {
  openai: '默认使用 https://api.openai.com/v1，可直接填写 `sk-...` 密钥。',
  deepseek: '默认使用 https://api.deepseek.com/v1，需要 DeepSeek Chat API Key。',
  custom: '请输入完整的 HTTPS Base URL（例如 https://example.com/v1）。'
};

const DEFAULT_MODEL_FORM = {
  provider: DEFAULT_SETTINGS.modelProvider,
  modelName: DEFAULT_SETTINGS.modelName,
  apiBaseUrl: DEFAULT_SETTINGS.apiBaseUrl
};

const SUMMARY_PROMPT_LIMIT = 1000;

function OptionsApp() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [status, setStatus] = useState<Status>(INITIAL_STATUS);
  const [activeSection, setActiveSection] = useState(NAV_SECTIONS[0].id);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [modelState, setModelState] = useState<ModelConfigState | null>(null);
  const [modelForm, setModelForm] = useState(DEFAULT_MODEL_FORM);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelMessage, setModelMessage] = useState<Status | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [promptDraft, setPromptDraft] = useState(DEFAULT_SETTINGS.summaryPrompt);
  const [promptStatus, setPromptStatus] = useState<Status | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const customBaseRef = useRef('');
  const hydratedRef = useRef(false);

  const {
    data,
    error,
    isLoading,
    mutate
  } = useSWR<SettingsState>('settings-state', loadSettingsState, {
    revalidateOnFocus: false
  });

  useEffect(() => {
    if (!data) {
      return;
    }
    setSettings(data.settings);
    setSyncStatus(data.status);
    if (data.model) {
      setModelState(data.model);
      setModelForm({
        provider: data.model.provider,
        apiBaseUrl: data.model.apiBaseUrl,
        modelName: data.model.modelName
      });
      if (data.model.provider === 'custom' && data.model.apiBaseUrl) {
        customBaseRef.current = data.model.apiBaseUrl;
      }
      setPromptDraft(data.model.summaryPrompt?.value ?? getDefaultSummaryPrompt());
      setPromptStatus(null);
    }
    if (!hydratedRef.current) {
      const loadedText = data.status.usingSync ? '已从浏览器同步加载' : '已加载本地设置';
      setStatus({ text: loadedText, isError: false });
      hydratedRef.current = true;
    }
  }, [data]);

  useEffect(() => {
    if (error) {
      console.error('[Glance] 无法读取设置', error);
      setStatus({ text: '加载失败，请刷新重试', isError: true });
    } else if (isLoading) {
      setStatus({ text: '加载中…', isError: false });
    }
  }, [error, isLoading]);

  useEffect(() => {
    if (settings) {
      document.body.style.setProperty('--option-theme', settings.themeColor);
    }
  }, [settings?.themeColor]);

  const persistSettings = useCallback(
    async (partial: Partial<UserSettings>) => {
      if (!settings) return;
      setStatus({ text: '保存中…', isError: false });
      try {
        const result = await saveSettingsState(partial, settings);
        setSettings(result.settings);
        setSyncStatus(result.status);
        setModelState(result.model);
        setModelForm({
          provider: result.model.provider,
          apiBaseUrl: result.model.apiBaseUrl,
          modelName: result.model.modelName
        });
        setPromptDraft(result.model.summaryPrompt.value);
        setStatus({
          text: result.status.usingSync ? '已同步到浏览器' : '已保存（本地）',
          isError: false
        });
        void mutate(result, { revalidate: false });
      } catch (error) {
        console.error('[Glance] 保存设置失败', error);
        setStatus({ text: '保存失败，请稍后重试', isError: true });
      }
    },
    [mutate, settings]
  );

  const handleColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setSettings(prev => (prev ? { ...prev, themeColor: value } : prev));
      void persistSettings({ themeColor: value });
    },
    [persistSettings]
  );

  const handleLayoutChange = useCallback(
    (layout: UserSettings['panelLayout']) => {
      setSettings(prev => (prev ? { ...prev, panelLayout: layout } : prev));
      void persistSettings({ panelLayout: layout });
    },
    [persistSettings]
  );

  const layout = settings?.panelLayout ?? DEFAULT_SETTINGS.panelLayout;
  const colorValue = settings?.themeColor ?? DEFAULT_SETTINGS.themeColor;
  const syncEnabled = settings?.syncEnabled ?? DEFAULT_SETTINGS.syncEnabled;
  const disabled = !settings || isLoading;
  const registerSectionRef = useCallback(
    (sectionId: string) => (node: HTMLElement | null) => {
      sectionRefs.current[sectionId] = node;
    },
    []
  );
  const handleSidebarClick = useCallback(
    (sectionId: string) => {
      setActiveSection(sectionId);
      const target = sectionRefs.current[sectionId];
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    []
  );

  const handleSyncToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.checked;
      setSettings(prev => (prev ? { ...prev, syncEnabled: nextValue } : prev));
      void persistSettings({ syncEnabled: nextValue });
    },
    [persistSettings]
  );

  const handleProviderChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextProvider = event.target.value as ModelProvider;
      const preset = PROVIDER_OPTIONS.find(option => option.value === nextProvider);
      if (modelForm.provider === 'custom' && modelForm.apiBaseUrl.trim()) {
        customBaseRef.current = modelForm.apiBaseUrl;
      }
      const nextBase =
        nextProvider === 'custom'
          ? customBaseRef.current || ''
          : preset?.baseUrl ?? '';
      const nextModelName = preset?.defaultModel ?? modelForm.modelName;
      const nextFormState = {
        provider: nextProvider,
        apiBaseUrl: nextBase,
        modelName: nextModelName
      };
      setModelForm(nextFormState);
      setModelMessage(null);
      void persistSettings({
        modelProvider: nextProvider,
        apiBaseUrl: nextBase,
        modelName: nextModelName
      });
    },
    [modelForm.apiBaseUrl, modelForm.modelName, modelForm.provider, persistSettings]
  );

  const handleModelNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setModelForm(prev => ({ ...prev, modelName: value }));
      setModelMessage(null);
      void persistSettings({ modelName: value });
    },
    [persistSettings]
  );

  const handleBaseUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setModelForm(prev => {
        if (prev.provider === 'custom') {
          customBaseRef.current = value;
        }
        return { ...prev, apiBaseUrl: value };
      });
      setModelMessage(null);
      void persistSettings({ apiBaseUrl: value });
    },
    [persistSettings]
  );

  const handleApiKeyInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setApiKeyInput(event.target.value);
  }, []);

  const handlePromptChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (value.length > SUMMARY_PROMPT_LIMIT) {
        setPromptStatus({ text: `超过 ${SUMMARY_PROMPT_LIMIT} 字符，仅保留前 ${SUMMARY_PROMPT_LIMIT} 字符`, isError: true });
        setPromptDraft(value.slice(0, SUMMARY_PROMPT_LIMIT));
      } else {
        setPromptDraft(value);
        setPromptStatus(null);
      }
    },
    []
  );

  const savePrompt = useCallback(
    async (override?: string) => {
      if (!settings) {
        return;
      }
      const raw = typeof override === 'string' ? override : promptDraft;
      const value = raw.trim();
      const payload = value ? value.slice(0, SUMMARY_PROMPT_LIMIT) : '';
      setPromptStatus({ text: '保存中…', isError: false });
      try {
        const result = await saveSettingsState({ summaryPrompt: payload }, settings);
        setSettings(result.settings);
        setSyncStatus(result.status);
        setModelState(result.model);
        setModelForm({
          provider: result.model.provider,
          apiBaseUrl: result.model.apiBaseUrl,
          modelName: result.model.modelName
        });
        setPromptDraft(result.model.summaryPrompt.value);
        setPromptStatus({ text: result.model.summaryPrompt.isDefault ? '已恢复默认' : '已保存', isError: false });
        void mutate(result, { revalidate: false });
      } catch (error) {
        console.error('[Glance] 保存 prompt 失败', error);
        setPromptStatus({ text: '保存失败，请稍后重试', isError: true });
      }
    },
    [mutate, promptDraft, settings]
  );

  const handlePromptBlur = useCallback(() => {
    void savePrompt();
  }, [savePrompt]);

  const handlePromptReset = useCallback(() => {
    const fallback = getDefaultSummaryPrompt();
    setPromptDraft(fallback);
    setPromptStatus({ text: '恢复默认中…', isError: false });
    void savePrompt(fallback);
  }, [savePrompt]);

  const handleTestConnection = useCallback(async () => {
    if (!modelForm.apiBaseUrl.trim()) {
      setModelMessage({ text: 'API Base URL 不能为空', isError: true });
      return;
    }
    const nextKey = apiKeyInput.trim();
    if (!nextKey) {
      setModelMessage({ text: '请先粘贴 API Key', isError: true });
      return;
    }
    setIsTesting(true);
    setModelMessage({ text: '测试中…', isError: false });
    try {
      const testResult = await testModelConnection({
        apiKey: nextKey,
        apiBaseUrl: modelForm.apiBaseUrl,
        modelName: modelForm.modelName,
        provider: modelForm.provider
      });
      const nextModel = await saveModelApiKey(nextKey, testResult);
      setApiKeyInput('');
      setModelState(nextModel);
      setModelForm({
        provider: nextModel.provider,
        apiBaseUrl: nextModel.apiBaseUrl,
        modelName: nextModel.modelName
      });
      setModelMessage({ text: '测试成功，已保存 API Key', isError: false });
      void mutate(
        current => (current ? { ...current, model: nextModel } : current),
        { revalidate: false }
      );
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: MODEL_CONFIG_UPDATED });
      }
    } catch (error) {
      setModelMessage({
        text: error instanceof Error ? error.message : String(error),
        isError: true
      });
    } finally {
      setIsTesting(false);
    }
  }, [apiKeyInput, modelForm.apiBaseUrl, modelForm.modelName, modelForm.provider, mutate]);

  const handleClearApiKey = useCallback(async () => {
    setIsTesting(true);
    setModelMessage({ text: '正在清除本地密钥…', isError: false });
    try {
      const nextModel = await clearModelApiKey();
      setModelState(nextModel);
      setModelForm({
        provider: nextModel.provider,
        apiBaseUrl: nextModel.apiBaseUrl,
        modelName: nextModel.modelName
      });
      setModelMessage({ text: '已清除 API Key', isError: false });
      void mutate(
        current => (current ? { ...current, model: nextModel } : current),
        { revalidate: false }
      );
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: MODEL_CONFIG_UPDATED });
      }
    } catch (error) {
      setModelMessage({
        text: error instanceof Error ? error.message : String(error),
        isError: true
      });
    } finally {
      setIsTesting(false);
    }
  }, [mutate]);

  const syncPillState = (() => {
    if (!syncStatus) {
      return 'loading';
    }
    if (!syncStatus.supported) {
      return 'unsupported';
    }
    if (!syncStatus.usingSync && syncStatus.backend === 'none') {
      return 'unsaved';
    }
    return syncStatus.usingSync ? 'synced' : 'local';
  })();

  const providerLabel = (() => {
    if (!syncStatus?.provider) {
      return '';
    }
    switch (syncStatus.provider) {
      case 'chrome':
        return 'Google 同步';
      case 'edge':
        return 'Microsoft 同步';
      case 'firefox':
        return 'Firefox Sync';
      default:
        return '浏览器同步';
    }
  })();

  const lastResultText = (() => {
    const result = syncStatus?.lastResult;
    if (!result) {
      return '暂无保存记录';
    }
    const dateText = new Date(result.timestamp).toLocaleString();
    const prefix = result.success ? '成功' : '失败';
    return result.message ? `${prefix} · ${result.message}（${dateText}）` : `${prefix}（${dateText}）`;
  })();

  const syncNote = syncStatus?.note ?? '正在检测同步能力…';
  const modelNote = modelState?.note ?? '尚未检测模型配置';
  const modelPillState = modelState?.ready ? 'ready' : 'missing';
  const modelPillText = modelState?.ready ? '已配置' : '未配置';
  const lastModelTestText = (() => {
    const result = modelState?.lastTest;
    if (!result) {
      return '尚未执行连通性测试';
    }
    const dateText = new Date(result.timestamp).toLocaleString();
    return result.message ? `${result.message}（${dateText}）` : `测试记录（${dateText}）`;
  })();
  const currentProviderOption = PROVIDER_OPTIONS.find(option => option.value === modelForm.provider);
  const canTest = Boolean(apiKeyInput.trim()) && Boolean(modelForm.apiBaseUrl.trim());
  const promptCharCount = `${promptDraft.length}/${SUMMARY_PROMPT_LIMIT}`;
  const promptMetaText = modelState?.summaryPrompt?.isDefault ? '使用默认模板，将生成结构化摘要' : '已自定义模板';

  return (
    <main className="page">
      <header className="page-header">
        <h1>Glance</h1>
        <p className="description">自定义预览面板的主题色与弹出布局。</p>
      </header>
      <div className="options-layout">
        <aside className="sidebar" aria-label="配置项大类">
          <div className="sidebar-label">配置项</div>
          <ul>
            {NAV_SECTIONS.map(section => (
              <li key={section.id}>
                <button
                  type="button"
                  className="sidebar-button"
                  data-active={activeSection === section.id}
                  onClick={() => handleSidebarClick(section.id)}
                >
                  <div className="sidebar-button-title">{section.title}</div>
                  <div className="sidebar-button-desc">{section.description}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="options-content">
          <article className="settings-card" id="appearance" ref={registerSectionRef('appearance')}>
            <h2>主题与颜色</h2>
            <p>自定义 Glance 的主色，匹配你的工作流。</p>
            <div className="field">
              <label htmlFor="themeColor">主题色</label>
              <input
                type="color"
                id="themeColor"
                name="themeColor"
                value={colorValue}
                aria-label="主题色"
                disabled={disabled}
                onChange={handleColorChange}
              />
            </div>
          </article>

          <article className="settings-card" id="layout" ref={registerSectionRef('layout')}>
            <h2>面板布局</h2>
            <p>控制 Glance 弹出面板出现的位置与尺寸。</p>
            <div className="field">
              <label>弹出位置与尺寸</label>
              <fieldset>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="panelLayout"
                    value="side"
                    checked={layout === 'side'}
                    disabled={disabled}
                    onChange={() => handleLayoutChange('side')}
                  />
                  <div>
                    <div className="option-title">页面右侧（默认）</div>
                    <div className="option-desc">保持当前布局，可在页面右侧拖拽调整宽度。</div>
                  </div>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="panelLayout"
                    value="center"
                    checked={layout === 'center'}
                    disabled={disabled}
                    onChange={() => handleLayoutChange('center')}
                  />
                  <div>
                    <div className="option-title">页面中央（宽屏）</div>
                    <div className="option-desc">在屏幕中央显示，更宽阔，适合深入阅读。</div>
                  </div>
                </label>
              </fieldset>
            </div>
          </article>

          <article className="settings-card" id="sync" ref={registerSectionRef('sync')}>
            <h2>同步设置</h2>
            <p>尽可能使用浏览器账号同步 Glance 配置，或根据需要仅保留在本地。</p>
            <div className="sync-status-block">
              <div className="sync-status-line">
                <span className="sync-pill" data-state={syncPillState}>
                  {syncPillState === 'loading' && '检测中…'}
                  {syncPillState === 'unsupported' && '未检测到同步'}
                  {syncPillState === 'unsaved' && '未写入存储'}
                  {syncPillState === 'local' && '仅本地保存'}
                  {syncPillState === 'synced' && (providerLabel || '已启用同步')}
                </span>
                <span className="sync-status-note">{syncNote}</span>
              </div>
              <div className="sync-status-meta">
                <span className="sync-status-meta-label">最近记录</span>
                <span>{lastResultText}</span>
              </div>
            </div>
            <div className="field toggle-field">
              <label htmlFor="syncToggle">浏览器同步</label>
              <p className="field-description">开启后会优先通过 chrome.storage.sync / browser.storage.sync 同步；关闭则强制使用本地存储。</p>
              <label className="switch">
                <input
                  id="syncToggle"
                  type="checkbox"
                  checked={syncEnabled}
                  disabled={!syncStatus?.supported || disabled}
                  onChange={handleSyncToggle}
                />
                <span>{syncEnabled ? '已开启' : '未开启'}</span>
              </label>
            </div>
            {!syncStatus?.supported && (
              <p className="sync-warning">当前浏览器未提供同步能力，设置仅会保存在本地。</p>
            )}
            {syncStatus?.error && syncStatus.supported && (
              <p className="sync-warning">同步不可用：{syncStatus.error}</p>
            )}
          </article>

          <article className="settings-card" id="model" ref={registerSectionRef('model')}>
            <h2>大模型设置</h2>
            <p>预先配置 OpenAI 兼容 API，保证第一次提出总结请求时可以直接连通。</p>
            <div className="model-status-block">
              <span className="model-pill" data-state={modelPillState}>
                {modelPillText}
              </span>
              <span className="model-status-note">{modelNote}</span>
            </div>
            <div className="field">
              <label htmlFor="modelProvider">模型供应商</label>
              <select
                id="modelProvider"
                className="text-input"
                value={modelForm.provider}
                onChange={handleProviderChange}
                disabled={disabled}
              >
                {PROVIDER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="field-description">{currentProviderOption?.description}</p>
              {currentProviderOption?.docs && (
                <a className="inline-link" href={currentProviderOption.docs} target="_blank" rel="noreferrer">
                  查看官方申请指引 ↗
                </a>
              )}
            </div>
            <div className="field">
              <label htmlFor="modelBaseUrl">API Base URL</label>
              <input
                id="modelBaseUrl"
                type="text"
                className="text-input"
                value={modelForm.apiBaseUrl}
                disabled={disabled}
                onChange={handleBaseUrlChange}
                placeholder="https://api.openai.com/v1"
              />
              <p className="field-description">{PROVIDER_HINTS[modelForm.provider]}</p>
            </div>
            <div className="field">
              <label htmlFor="modelName">默认模型名称</label>
              <input
                id="modelName"
                type="text"
                className="text-input"
                value={modelForm.modelName}
                disabled={disabled}
                onChange={handleModelNameChange}
                placeholder="gpt-4o-mini"
              />
              <p className="field-description">示例：gpt-4o-mini、deepseek-chat、glm-4，需符合 OpenAI 风格。</p>
            </div>
            <div className="field">
              <label htmlFor="modelApiKey">API Key</label>
              <input
                id="modelApiKey"
                type="password"
                className="text-input"
                value={apiKeyInput}
                onChange={handleApiKeyInputChange}
                placeholder={modelState?.hasApiKey ? '已设置，输入可覆盖' : 'sk-...'}
              />
              <p className="field-description">密钥仅写入本地 `chrome.storage.local`，不会同步到云端。</p>
              <div className="button-row">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleTestConnection}
                  disabled={disabled || isTesting || !canTest}
                >
                  {isTesting ? '测试中…' : '保存并测试'}
                </button>
                {modelState?.hasApiKey && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleClearApiKey}
                    disabled={disabled || isTesting}
                  >
                    清除密钥
                  </button>
                )}
              </div>
            </div>
            <div className="model-meta">
              <span className="model-meta-label">最近测试</span>
              <span>{lastModelTestText}</span>
            </div>
            {modelMessage && (
              <p className="model-warning" data-state={modelMessage.isError ? 'error' : 'ok'}>
                {modelMessage.text}
              </p>
            )}
            <div className="field">
              <label htmlFor="summaryPrompt">总结 Prompt</label>
              <div className="field-subline">
                <p className="field-description">自定义系统提示，控制总结语气、结构与输出格式。</p>
                <span className="field-counter">{promptCharCount}</span>
              </div>
              <textarea
                id="summaryPrompt"
                className="text-area"
                rows={6}
                value={promptDraft}
                onChange={handlePromptChange}
                onBlur={handlePromptBlur}
                placeholder={getDefaultSummaryPrompt()}
                maxLength={SUMMARY_PROMPT_LIMIT}
                disabled={disabled}
              />
              <div className="button-row prompt-actions">
                <button type="button" className="ghost-button" onClick={handlePromptReset} disabled={disabled}>
                  恢复默认
                </button>
              </div>
              <div className="prompt-meta">
                <span>{promptMetaText}</span>
              </div>
              {promptStatus && (
                <p className="prompt-warning" data-state={promptStatus.isError ? 'error' : 'ok'}>
                  {promptStatus.text}
                </p>
              )}
            </div>
          </article>

          <span className="status" data-state={status.isError ? 'error' : 'ok'}>
            {status.text}
          </span>
        </div>
      </div>
    </main>
  );
}

function mount() {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Options 根节点缺失，无法挂载 React 应用。');
  }
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <OptionsApp />
    </StrictMode>
  );
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    mount();
  } catch (error) {
    console.error('[Glance] 初始化 options 页面失败', error);
  }
});
