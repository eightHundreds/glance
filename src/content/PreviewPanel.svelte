<script lang="ts">
  import { marked } from 'marked';
  import { PreviewCaptureError, waitForPreviewCaptureResult } from './domCaptureBridge';
  import { extractContentFromHtml } from './markdownExtractor';
  import { buildPreviewIframeName } from '../shared/previewCapture';
  import { GENERATE_SUMMARY, SUMMARY_CHUNK, SUMMARY_DONE, SUMMARY_ERROR } from '../shared/messages';
  import {
    DEFAULT_SETTINGS,
    getModelApiKey,
    saveSettingsState,
    type ModelConfigState,
    type UserSettings
  } from '../shared/settings';
  import {
    buildSummaryRequestBody,
    shouldDispatchSummaryRequest,
    type SummaryRequestBody
  } from '../shared/summaryRequest';

  type PanelState = 'idle' | 'loading' | 'ready' | 'error';
  type SummaryState = 'idle' | 'loading' | 'ready' | 'error' | 'blocked';
  type SummarySource = 'http' | 'iframe' | 'http-thin';

  const PANEL_CLASS = 'glance-panel';
  const PANEL_MARGIN = 24;
  const PANEL_HEIGHT_RATIO = 0.9;
  const MIN_WIDTH = 360;
  const SIDE_MAX_WIDTH = 960;
  const MAX_WIDTH = 1400;
  const DEFAULT_SIDE_WIDTH = 520;
  const CENTER_MIN_WIDTH = 640;
  const CENTER_MAX_WIDTH = 1400;
  const CENTER_WIDTH_RATIO = 0.82;
  const DEBUG_PANEL_WIDTH = 380;
  const DEBUG_PANEL_MIN_WIDTH = 240;
  const SUMMARY_PANEL_WIDTH = 360;
  const SUMMARY_PANEL_MIN_WIDTH = 260;
  const DEBUG_PANEL_GAP = 12;

  const DEFAULT_THEME_COLOR = DEFAULT_SETTINGS.themeColor;
  const DEFAULT_THEME_RGB = (() => {
    const rgb = hexToRgb(DEFAULT_THEME_COLOR);
    return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '14, 165, 233';
  })();

  // Props using Svelte 5 runes
  interface Props {
    initialSettings?: UserSettings;
    initialModel?: ModelConfigState;
  }
  let { initialSettings = DEFAULT_SETTINGS, initialModel = undefined }: Props = $props();

  // State - initialize from props using $effect to capture reactive values
  let settings = $state<UserSettings>(DEFAULT_SETTINGS);
  let modelConfig = $state<ModelConfigState | null>(null);

  // Sync props to state when they change
  $effect(() => {
    settings = initialSettings;
  });

  $effect(() => {
    modelConfig = initialModel ?? null;
  });
  let panelState = $state<PanelState>('idle');
  let summaryState = $state<SummaryState>('idle');
  let visible = $state(false);
  let currentUrl = $state<string | null>(null);
  let summaryContent = $state('');
  let summaryStatus = $state('等待预览...');
  let debugRequestBody = $state<SummaryRequestBody | null>(null);
  let debugExtractionInfo = $state<{
    source: SummarySource;
    markdownLength: number;
  } | null>(null);
  let windowWidth = $state(window.innerWidth);
  let currentWidth = $state(DEFAULT_SIDE_WIDTH);
  let isResizing = $state(false);
  let isOverlay = $state(false);
  let requestCounter = $state(0);
  let activeRequestId = $state<number | null>(null);
  let lastUrl = $state<string | null>(null);
  let pendingSummary = $state<{
    requestId: number;
    url: string;
    httpExtracted?: { markdown: string; wordCount: number };
    httpFailed?: boolean;
    iframeMarkdown?: string;
    iframeFailed?: boolean;
    iframeChallenge?: boolean;
  } | null>(null);
  let summaryAbortController = $state<AbortController | null>(null);
  let httpExtractAbortController = $state<AbortController | null>(null);
  let domCaptureAbortController = $state<AbortController | null>(null);
  let resolvedRequestId = $state<number | null>(null);
  let summaryMessageListener = $state<((message: unknown) => void) | null>(null);
  let frameElement = $state<HTMLIFrameElement | null>(null);
  let previewFrameName = $state('');

  // HTTP 抽取出的 Markdown 正文低于该阈值才视为「几乎为空」（典型纯客户端渲染 SPA），
  // 此时才需要等待 iframe DOM 采集兜底；否则只要有正文就立即总结，不再阻塞等待。
  const SUMMARY_EMPTY_MARKDOWN_LENGTH = 200;
  // iframe DOM 采集只是兜底，超时设短一些，失败即快速放弃
  const PREVIEW_CAPTURE_FALLBACK_TIMEOUT_MS = 4000;

  // Derived
  const themeRgb = $derived(() => {
    const rgb = hexToRgb(settings.themeColor);
    return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : DEFAULT_THEME_RGB;
  });

  const canSummarize = $derived(() => !!modelConfig?.ready);

  const debugRequestJson = $derived(() => (
    debugRequestBody ? JSON.stringify(debugRequestBody, null, 2) : ''
  ));

  const debugDispatchModeLabel = $derived(() => (
    settings.debugRequestDispatchEnabled ? '会真实发送请求' : '仅预览，不发送'
  ));

  const debugExtractionSourceLabel = $derived(() => {
    if (!debugExtractionInfo) {
      return '等待提取';
    }
    const labels: Record<SummarySource, string> = {
      http: 'fetch',
      iframe: 'iframe',
      'http-thin': 'fetch-thin'
    };
    return labels[debugExtractionInfo.source];
  });

  const showResizeHandle = $derived(() => settings.panelLayout === 'side');

  const layoutDimensions = $derived(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = windowWidth;
    const height = Math.max(320, Math.round(viewportHeight * PANEL_HEIGHT_RATIO));
    const top = Math.max((viewportHeight - height) / 2, 16);
    const availableWidth = viewportWidth - PANEL_MARGIN * 2;

    const sidePanelGapCount = settings.debugMode ? 2 : 1;
    const sidePanelMinWidth = SUMMARY_PANEL_MIN_WIDTH
      + (settings.debugMode ? DEBUG_PANEL_MIN_WIDTH : 0)
      + DEBUG_PANEL_GAP * sidePanelGapCount;

    {
      const maxPanelWidth = Math.max(
        200,
        Math.min(
          settings.panelLayout === 'center' ? CENTER_MAX_WIDTH : SIDE_MAX_WIDTH,
          availableWidth - sidePanelMinWidth
        )
      );
      const panelMinWidth = Math.min(
        settings.panelLayout === 'center' ? CENTER_MIN_WIDTH : MIN_WIDTH,
        maxPanelWidth
      );
      const idealPanelWidth = settings.panelLayout === 'center'
        ? Math.round(viewportWidth * 0.62)
        : currentWidth;
      const panelWidth = clamp(idealPanelWidth, panelMinWidth, maxPanelWidth);
      const leftAvailableWidth = Math.max(
        0,
        availableWidth - panelWidth - DEBUG_PANEL_GAP * sidePanelGapCount
      );
      const debugWidth = Math.max(
        0,
        settings.debugMode
          ? Math.min(DEBUG_PANEL_WIDTH, leftAvailableWidth - SUMMARY_PANEL_MIN_WIDTH)
          : 0
      );
      const summaryWidth = Math.max(
        0,
        Math.min(SUMMARY_PANEL_WIDTH, leftAvailableWidth - debugWidth)
      );
      const groupWidth = debugWidth
        + (settings.debugMode ? DEBUG_PANEL_GAP : 0)
        + summaryWidth
        + DEBUG_PANEL_GAP
        + panelWidth;
      const groupLeft = settings.panelLayout === 'center'
        ? Math.max(PANEL_MARGIN, Math.round((viewportWidth - groupWidth) / 2))
        : viewportWidth - PANEL_MARGIN - groupWidth;
      const summaryLeft = groupLeft + (settings.debugMode ? debugWidth + DEBUG_PANEL_GAP : 0);

      return {
        panel: {
          width: `${panelWidth}px`,
          height: `${height}px`,
          top: `${top}px`,
          left: `${summaryLeft + summaryWidth + DEBUG_PANEL_GAP}px`,
          right: 'auto',
          transform: 'none'
        },
        summary: {
          width: `${summaryWidth}px`,
          height: `${height}px`,
          top: `${top}px`,
          left: `${summaryLeft}px`,
          right: 'auto',
          transform: 'none'
        },
        debug: settings.debugMode ? {
          width: `${debugWidth}px`,
          height: `${height}px`,
          top: `${top}px`,
          left: `${groupLeft}px`,
          right: 'auto',
          transform: 'none'
        } : null
      };
    }
  });

  const overlayStyle = $derived(() => {
    const isActive = isOverlay || isResizing;
    return {
      opacity: isResizing ? '0.4' : isActive ? '1' : '0',
      backdropFilter: isActive ? 'blur(18px)' : 'blur(0px)'
    };
  });

  // Methods exposed to parent (using Svelte 5 component instance methods)
  export function applySettings(next: UserSettings): void {
    const previousLayout = settings.panelLayout;
    settings = next;
    if (!next.debugMode) {
      clearDebugRequestBody();
      clearDebugExtractionInfo();
    }
    if (previousLayout !== next.panelLayout && next.panelLayout === 'side') {
      currentWidth = clamp(currentWidth, MIN_WIDTH, Math.min(SIDE_MAX_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
    }
  }

  export function updateModelConfig(next: ModelConfigState): void {
    modelConfig = next;
    if (!next.ready) {
      renderModelSetupPrompt(next.note);
      setSummaryState('blocked', next.note);
      console.debug('[Glance] Summary prompt blocked (missing model config)');
    } else if (summaryState === 'blocked') {
      clearSummaryContent();
      setSummaryState('idle', '等待预览...');
    }
    const promptSource = next.summaryPrompt?.isDefault ? 'default' : 'custom';
    console.debug('[Glance] Summary prompt ready', {
      source: promptSource,
      length: next.summaryPrompt?.value.length ?? 0
    });
  }

  export function show(url: string, _pointer: { clientX: number; clientY: number }): number {
    requestCounter += 1;
    activeRequestId = requestCounter;
    lastUrl = url;
    cancelSummaryParsing();
    pendingSummary = null;
    clearSummaryContent();
    clearDebugRequestBody();
    clearDebugExtractionInfo();
    if (canSummarize()) {
      setSummaryState('loading', '正在加载页面内容...');
    } else {
      setSummaryState('blocked', modelConfig?.note ?? '尚未配置大模型');
      renderModelSetupPrompt(modelConfig?.note);
    }

    panelState = 'loading';
    currentUrl = url;
    visible = true;
    isOverlay = false;

    return requestCounter;
  }

  export function onSummaryFallbackFailed(requestId: number): void {
    if (!isCurrentRequest(requestId) || !pendingSummary || pendingSummary.requestId !== requestId) {
      console.debug('[Glance][SUMMARY] ignored HTTP failure for inactive request', {
        requestId,
        activeRequestId,
        hasPendingSummary: !!pendingSummary
      });
      return;
    }
    console.warn('[Glance][SUMMARY] HTTP fetch failed', {
      requestId,
      url: pendingSummary.url
    });
    pendingSummary = { ...pendingSummary, httpFailed: true };
    resolveSummary(requestId);
  }

  export function setSummaryFallbackHtml(requestId: number, html: string): void {
    if (!isCurrentRequest(requestId) || !pendingSummary || pendingSummary.requestId !== requestId) {
      console.debug('[Glance][SUMMARY] ignored HTTP HTML for inactive request', {
        requestId,
        activeRequestId,
        hasPendingSummary: !!pendingSummary
      });
      return;
    }
    console.debug('[Glance][SUMMARY] HTTP HTML ready', {
      requestId,
      url: pendingSummary.url,
      htmlLength: html.length
    });
    void extractHttpContent(requestId, html, pendingSummary.url);
  }

  export async function startPreview(requestId: number, url: string): Promise<void> {
    if (!isCurrentRequest(requestId) || !frameElement) {
      console.debug('[Glance][DOM_CAPTURE] skipped preview start for inactive request', {
        requestId,
        activeRequestId,
        hasFrameElement: !!frameElement
      });
      return;
    }

    console.debug('[Glance][DOM_CAPTURE] preview start', { requestId, url });
    if (canSummarize()) {
      pendingSummary = { requestId, url };
      setSummaryState('loading', '等待页面加载完成...');
    }

    // 使用 declarativeNetRequest 移除 CSP 限制
    if (chrome.runtime?.id) {
      try {
        await chrome.runtime.sendMessage({
          type: 'ADD_CSP_BYPASS',
          url
        });
      } catch (error) {
        console.warn('[Glance] Failed to add CSP bypass rule:', error);
      }
    }

    previewFrameName = buildPreviewIframeName(requestId);
    frameElement.setAttribute('name', previewFrameName);
    try {
      frameElement.contentWindow!.name = previewFrameName;
    } catch (error) {
      console.debug('[Glance][PREVIEW_CAPTURE] unable to set iframe window.name before navigation', {
        requestId,
        error
      });
    }

    const onLoad = () => {
      console.debug('[Glance][PREVIEW_CAPTURE] iframe load event', {
        requestId,
        frameSrc: frameElement?.src,
        url
      });
      if (isCurrentRequest(requestId)) {
        panelState = 'ready';
      }
      frameElement?.removeEventListener('load', onLoad);
    };

    if (canSummarize()) {
      setSummaryState('loading', '正在获取页面内容...');
      void collectIframeCapture(requestId);
    }

    frameElement.addEventListener('load', onLoad);
    frameElement.src = url;
  }

  export function showError(requestId: number, message: string): void {
    if (!isCurrentRequest(requestId)) {
      return;
    }
    panelState = 'error';
    currentUrl = message;
    pendingSummary = null;
    cancelSummaryParsing();
    if (!canSummarize()) {
      renderModelSetupPrompt(modelConfig?.note ?? message);
      setSummaryState('blocked', modelConfig?.note ?? message);
    } else {
      clearSummaryContent();
      setSummaryState('error', message);
    }
  }

  export async function close(): Promise<void> {
    cancelResizeListeners();
    visible = false;
    isOverlay = false;
    isResizing = false;
    panelState = 'idle';
    if (frameElement) {
      frameElement.src = '';
    }
    previewFrameName = '';
    pendingSummary = null;
    cancelSummaryParsing();
    clearSummaryContent();
    clearDebugRequestBody();
    clearDebugExtractionInfo();
    if (canSummarize()) {
      setSummaryState('idle', '等待预览...');
    } else {
      renderModelSetupPrompt(modelConfig?.note);
      setSummaryState('blocked', modelConfig?.note ?? '尚未配置大模型');
    }
    activeRequestId = null;

    // 清理 CSP bypass 规则
    if (chrome.runtime?.id) {
      try {
        await chrome.runtime.sendMessage({
          type: 'CLEAR_CSP_BYPASS'
        });
      } catch (error) {
        console.warn('[Glance] Failed to clear CSP bypass rules:', error);
      }
    }
  }

  export function openInNewTab(): void {
    if (lastUrl) {
      window.open(lastUrl, '_blank', 'noopener');
    }
  }

  function openSettings(): void {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  }

  async function handleDebugRequestDispatchToggle(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement | null;
    if (!input) {
      return;
    }

    const previousSettings = settings;
    const nextValue = input.checked;
    settings = {
      ...previousSettings,
      debugRequestDispatchEnabled: nextValue
    };

    try {
      const result = await saveSettingsState(
        { debugRequestDispatchEnabled: nextValue },
        previousSettings
      );
      settings = result.settings;
    } catch (error) {
      settings = previousSettings;
      console.error('[Glance] 保存请求发送调试开关失败', error);
    }
  }

  function isCurrentRequest(requestId: number) {
    return activeRequestId === requestId;
  }

  function setSummaryState(state: SummaryState, message?: string) {
    summaryState = state;
    const fallbackMessages: Record<SummaryState, string> = {
      idle: '等待预览...',
      loading: '正在解析页面内容...',
      ready: '已生成初步总结',
      error: '暂时无法解析该页面',
      blocked: '尚未配置模型'
    };
    summaryStatus = message || fallbackMessages[state];
  }

  function clearSummaryContent() {
    summaryContent = '';
  }

  function clearDebugRequestBody() {
    debugRequestBody = null;
  }

  function clearDebugExtractionInfo() {
    debugExtractionInfo = null;
  }

  function getMarkdownContentLength(markdown: string): number {
    return markdown.replace(/\s/g, '').length;
  }

  function renderDebugPreviewOnlyMessage() {
    clearSummaryContent();
    const content = `
      <div class="${PANEL_CLASS}__summary-setup">
        <p class="${PANEL_CLASS}__summary-setup-title">已生成请求入参</p>
        <p class="${PANEL_CLASS}__summary-setup-desc">当前处于仅预览模式，本次不会向模型发送请求。打开“发送请求”后，再次触发预览即可生成总结。</p>
      </div>
    `;
    summaryContent = content;
  }

  function renderModelSetupPrompt(note?: string) {
    clearSummaryContent();
    const content = `
      <div class="${PANEL_CLASS}__summary-setup">
        <p class="${PANEL_CLASS}__summary-setup-title">尚未配置大模型</p>
        <p class="${PANEL_CLASS}__summary-setup-desc">${note ?? '在 Options 页面配置 OpenAI 兼容 API 后即可生成总结。'}</p>
      </div>
    `;
    summaryContent = content;
  }

  function renderSummaryContent(markdown: string) {
    try {
      const html = marked.parse(markdown, { breaks: true });
      summaryContent = typeof html === 'string' ? html : String(html);
    } catch (error) {
      console.warn('[Glance] Markdown 解析失败，使用纯文本显示', error);
      summaryContent = markdown;
    }
  }

  function getSummaryPromptInfo(): { value: string; source: 'default' | 'custom' } {
    const prompt = modelConfig?.summaryPrompt?.value ?? DEFAULT_SETTINGS.summaryPrompt;
    const isDefault = modelConfig?.summaryPrompt?.isDefault !== false;
    const source: 'default' | 'custom' = isDefault ? 'default' : 'custom';
    return { value: prompt, source };
  }

  function cancelDomCapture() {
    if (domCaptureAbortController) {
      domCaptureAbortController.abort();
      domCaptureAbortController = null;
    }
  }

  async function collectIframeCapture(requestId: number) {
    if (!isCurrentRequest(requestId) || !frameElement) {
      return;
    }
    if (!canSummarize() || !pendingSummary || pendingSummary.requestId !== requestId) {
      return;
    }

    cancelDomCapture();
    const controller = new AbortController();
    domCaptureAbortController = controller;
    console.debug('[Glance][PREVIEW_CAPTURE] collecting iframe capture (fallback)', {
      requestId,
      url: pendingSummary.url,
      frameName: frameElement.name
    });

    try {
      const markdown = await waitForPreviewCaptureResult(requestId, frameElement, {
        signal: controller.signal,
        timeoutMs: PREVIEW_CAPTURE_FALLBACK_TIMEOUT_MS
      });
      if (!isCurrentRequest(requestId) || controller.signal.aborted) {
        return;
      }
      if (pendingSummary && pendingSummary.requestId === requestId) {
        console.debug('[Glance][PREVIEW_CAPTURE] iframe capture ready', {
          requestId,
          markdownLength: getMarkdownContentLength(markdown)
        });
        pendingSummary = { ...pendingSummary, iframeMarkdown: markdown };
        resolveSummary(requestId);
      }
    } catch (error) {
      if (controller.signal.aborted || !isCurrentRequest(requestId)) {
        return;
      }
      const isChallenge = error instanceof PreviewCaptureError && error.isChallengePage;
      console.debug('[Glance][PREVIEW_CAPTURE] iframe capture unavailable', {
        requestId,
        isChallenge,
        error
      });
      if (pendingSummary && pendingSummary.requestId === requestId) {
        pendingSummary = { ...pendingSummary, iframeFailed: true, iframeChallenge: isChallenge };
        resolveSummary(requestId);
      }
    } finally {
      if (domCaptureAbortController === controller) {
        domCaptureAbortController = null;
      }
    }
  }

  async function extractHttpContent(requestId: number, html: string, url: string) {
    if (httpExtractAbortController) {
      httpExtractAbortController.abort();
    }
    const controller = new AbortController();
    httpExtractAbortController = controller;

    try {
      const { markdown, wordCount } = await extractContentFromHtml(html, url, {
        signal: controller.signal
      });
      if (!isCurrentRequest(requestId) || controller.signal.aborted) {
        return;
      }
      if (pendingSummary && pendingSummary.requestId === requestId) {
        console.debug('[Glance][SUMMARY] HTTP content extracted', {
          requestId,
          wordCount,
          markdownLength: getMarkdownContentLength(markdown)
        });
        pendingSummary = { ...pendingSummary, httpExtracted: { markdown, wordCount } };
        resolveSummary(requestId);
      }
    } catch (error) {
      if (controller.signal.aborted || !isCurrentRequest(requestId)) {
        return;
      }
      console.warn('[Glance][SUMMARY] HTTP 内容抽取失败', { requestId, url, error });
      if (pendingSummary && pendingSummary.requestId === requestId) {
        pendingSummary = { ...pendingSummary, httpFailed: true };
        resolveSummary(requestId);
      }
    } finally {
      if (httpExtractAbortController === controller) {
        httpExtractAbortController = null;
      }
    }
  }

  function isEmptyContent(extracted: { markdown: string; wordCount: number }): boolean {
    return getMarkdownContentLength(extracted.markdown) < SUMMARY_EMPTY_MARKDOWN_LENGTH;
  }

  // HTTP 优先：只要 HTTP 抽到正文就立即总结，绝不为 iframe 兜底而阻塞等待；
  // 仅当 HTTP 几乎为空或失败时（典型 SPA），才等 iframe DOM 采集补充。
  function resolveSummary(requestId: number) {
    if (!canSummarize() || !isCurrentRequest(requestId)) {
      return;
    }
    const summary = pendingSummary;
    if (!summary || summary.requestId !== requestId || resolvedRequestId === requestId) {
      return;
    }

    const httpReady = summary.httpExtracted !== undefined;
    const httpUsable = httpReady && !isEmptyContent(summary.httpExtracted!);
    const iframeReady = summary.iframeMarkdown !== undefined;
    const iframeDone = iframeReady || summary.iframeFailed === true;

    // 快路径：HTTP 抽到正文 → 立即总结，不等 iframe
    if (httpUsable) {
      startSummary(requestId, summary.httpExtracted!.markdown, 'http');
      return;
    }

    // HTTP 几乎为空或失败：此时才需要 iframe DOM 采集兜底
    if (httpReady || summary.httpFailed) {
      if (iframeReady) {
        startSummary(requestId, summary.iframeMarkdown!, 'iframe');
        return;
      }
      if (!iframeDone) {
        setSummaryState('loading', '正在等待页面渲染补充内容...');
        return;
      }
      // iframe 也没拿到：尽力使用 HTTP 抽取到的（即便很薄）正文
      if (httpReady && summary.httpExtracted!.markdown.trim()) {
        startSummary(requestId, summary.httpExtracted!.markdown, 'http-thin');
        return;
      }
      resolvedRequestId = requestId;
      pendingSummary = null;
      clearSummaryContent();
      setSummaryState(
        'error',
        summary.iframeChallenge
          ? '页面有访问验证，暂时无法解析，↗ 在新标签中查看'
          : '未能提取该页面的正文，↗ 在新标签中查看'
      );
      return;
    }

    // HTTP 仍在抽取中：HTTP 优先，继续等待其结果
    setSummaryState('loading', '正在获取页面内容...');
  }

  function startSummary(requestId: number, markdown: string, source: SummarySource) {
    if (!canSummarize() || !isCurrentRequest(requestId)) {
      return;
    }
    const trimmed = markdown.trim();
    if (!trimmed) {
      resolvedRequestId = requestId;
      pendingSummary = null;
      clearSummaryContent();
      setSummaryState('error', '未能提取该页面的正文，↗ 在新标签中查看');
      return;
    }
    const markdownContentLength = getMarkdownContentLength(markdown);

    debugExtractionInfo = {
      source,
      markdownLength: markdownContentLength
    };

    resolvedRequestId = requestId;
    cancelDomCapture();
    if (httpExtractAbortController) {
      httpExtractAbortController.abort();
      httpExtractAbortController = null;
    }
    if (summaryAbortController) {
      summaryAbortController.abort();
    }
    const controller = new AbortController();
    summaryAbortController = controller;

    const promptInfo = getSummaryPromptInfo();
    setSummaryState('loading', '正在生成总结...');
    console.debug('[Glance][SUMMARY] start summary', {
      requestId,
      source,
      markdownLength: markdownContentLength,
      promptSource: promptInfo.source
    });
    void generateSummaryWithAI(requestId, trimmed, promptInfo.value, controller);
  }

  async function generateSummaryWithAI(
    requestId: number,
    markdown: string,
    prompt: string,
    controller: AbortController
  ) {
    if (!modelConfig || !isCurrentRequest(requestId) || controller.signal.aborted) {
      return;
    }

    try {
      const requestBody = buildSummaryRequestBody({
        modelName: modelConfig.modelName,
        prompt,
        markdown
      });
      if (settings.debugMode) {
        debugRequestBody = requestBody;
      }

      if (!shouldDispatchSummaryRequest({
        debugMode: settings.debugMode,
        debugRequestDispatchEnabled: settings.debugRequestDispatchEnabled
      })) {
        renderDebugPreviewOnlyMessage();
        setSummaryState('ready', '调试模式：未发送请求');
        pendingSummary = null;
        if (summaryAbortController === controller) {
          summaryAbortController = null;
        }
        return;
      }

      const apiKey = await getModelApiKey();
      if (!apiKey) {
        setSummaryState('error', 'API Key 未配置，请在设置中配置');
        pendingSummary = null;
        return;
      }

      removeSummaryMessageListener();

      let accumulatedContent = '';
      const messageListener = (message: unknown) => {
        if (controller.signal.aborted || !isCurrentRequest(requestId)) {
          return;
        }

        if (typeof message !== 'object' || message === null) {
          return;
        }

        const msg = message as { type?: string; chunk?: string; error?: string };

        if (msg.type === SUMMARY_CHUNK && typeof msg.chunk === 'string') {
          accumulatedContent += msg.chunk;
          renderSummaryContent(accumulatedContent);
          setSummaryState('loading', '正在生成总结...');
        } else if (msg.type === SUMMARY_DONE) {
          setSummaryState('ready', '已生成总结');
          removeSummaryMessageListener();
          pendingSummary = null;
          if (summaryAbortController === controller) {
            summaryAbortController = null;
          }
        } else if (msg.type === SUMMARY_ERROR) {
          const errorMsg = typeof msg.error === 'string' ? msg.error : '生成总结失败';
          console.warn('[Glance] AI 总结失败', errorMsg);
          clearSummaryContent();
          setSummaryState('error', errorMsg);
          removeSummaryMessageListener();
          pendingSummary = null;
          if (summaryAbortController === controller) {
            summaryAbortController = null;
          }
        }
      };

      summaryMessageListener = messageListener;

      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(messageListener);
      }

      setSummaryState('loading', '正在调用 AI 生成总结...');
      clearSummaryContent();

      chrome.runtime.sendMessage({
        type: GENERATE_SUMMARY,
        requestBody,
        modelConfig: {
          provider: modelConfig.provider,
          modelName: modelConfig.modelName,
          apiBaseUrl: modelConfig.apiBaseUrl
        },
        apiKey
      });

      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message || '发送消息失败');
      }

      const timeoutId = setTimeout(() => {
        if (!controller.signal.aborted && isCurrentRequest(requestId)) {
          controller.abort();
          removeSummaryMessageListener();
          clearSummaryContent();
          setSummaryState('error', '生成总结超时，请重试');
          pendingSummary = null;
          if (summaryAbortController === controller) {
            summaryAbortController = null;
          }
        }
      }, 60000);

      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        removeSummaryMessageListener();
      }, { once: true });
    } catch (error) {
      if (controller.signal.aborted || !isCurrentRequest(requestId)) {
        return;
      }
      console.warn('[Glance] 调用 AI 总结失败', error);
      removeSummaryMessageListener();
      clearSummaryContent();
      const errorMsg = error instanceof Error ? error.message : '调用 AI 失败';
      setSummaryState('error', errorMsg);
      pendingSummary = null;
      if (summaryAbortController === controller) {
        summaryAbortController = null;
      }
    }
  }

  function removeSummaryMessageListener() {
    if (summaryMessageListener && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(summaryMessageListener);
      summaryMessageListener = null;
    }
  }

  function cancelSummaryParsing() {
    cancelDomCapture();
    if (httpExtractAbortController) {
      httpExtractAbortController.abort();
      httpExtractAbortController = null;
    }
    if (summaryAbortController) {
      summaryAbortController.abort();
      summaryAbortController = null;
    }
    resolvedRequestId = null;
    removeSummaryMessageListener();
  }

  let teardownResize: (() => void) | null = null;

  function startResize(event: PointerEvent) {
    if (settings.panelLayout !== 'side') {
      return;
    }
    event.preventDefault();
    cancelResizeListeners();
    isResizing = true;

    const onMove = (moveEvent: PointerEvent) => {
      const viewportWidth = window.innerWidth;
      const candidate = viewportWidth - moveEvent.clientX - PANEL_MARGIN;
      currentWidth = clamp(candidate, MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - PANEL_MARGIN * 2));
    };

    const onUp = () => {
      cancelResizeListeners();
      isResizing = false;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    teardownResize = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }

  function cancelResizeListeners() {
    if (teardownResize) {
      teardownResize();
      teardownResize = null;
    }
  }

  function getCenteredWidth(viewportWidth: number) {
    const ideal = Math.round(viewportWidth * CENTER_WIDTH_RATIO);
    const available = Math.max(MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    const min = Math.min(Math.max(CENTER_MIN_WIDTH, MIN_WIDTH), available);
    const max = Math.max(min, Math.min(CENTER_MAX_WIDTH, available));
    return clamp(ideal, min, max);
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeColor(input: string | null | undefined) {
    if (!input) {
      return null;
    }
    const match = input.trim().match(/^#?([0-9a-f]{6})$/i);
    if (!match) {
      return null;
    }
    return `#${match[1].toLowerCase()}`;
  }

  function hexToRgb(value: string) {
    const normalized = normalizeColor(value);
    if (!normalized) {
      return null;
    }
    const hex = normalized.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b };
  }

  // Handle window resize - clamp currentWidth when window size or layout changes
  $effect(() => {
    const layout = settings.panelLayout;
    const viewportWidth = windowWidth;
    
    if (layout === 'side') {
      const availableWidth = viewportWidth - PANEL_MARGIN * 2;
      const maxWidth = Math.min(SIDE_MAX_WIDTH, availableWidth);
      if (currentWidth > maxWidth || currentWidth < MIN_WIDTH) {
        currentWidth = clamp(currentWidth, MIN_WIDTH, maxWidth);
      }
    }
  });

  // Listen to window resize events
  $effect(() => {
    const handler = () => {
      windowWidth = window.innerWidth;
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  });

  // Handle document click (close on outside click)
  $effect(() => {
    if (!visible) return;

    const handler = (event: MouseEvent) => {
      const path = event.composedPath();
      const isInsidePanel = path.some(node => {
        return (
          node instanceof Element &&
          (node as HTMLElement).closest(`.${PANEL_CLASS}, .${PANEL_CLASS}__debug, .${PANEL_CLASS}__summary`) !== null
        );
      });

      if (!isInsidePanel) {
        close();
      }
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  });

  // Update theme CSS variables - these are set via inline styles on the container
</script>

<div
  class="glance-panel__container"
  data-visible={visible}
  style="position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; --glance-theme: {settings.themeColor}; --glance-theme-rgb: {themeRgb()};"
>
  <div class="glance-panel__overlay" style="opacity: {overlayStyle().opacity}; backdrop-filter: {overlayStyle().backdropFilter};"></div>
  <div
    class="glance-panel__blocker"
    style="display: {isResizing ? 'block' : 'none'}; cursor: {isResizing ? 'ew-resize' : 'default'}; pointer-events: {isResizing ? 'auto' : 'none'};"
  ></div>
  {#if settings.debugMode && layoutDimensions().debug}
    <aside
      class="glance-panel__debug"
      style="width: {layoutDimensions().debug?.width}; height: {layoutDimensions().debug?.height}; top: {layoutDimensions().debug?.top}; left: {layoutDimensions().debug?.left}; right: {layoutDimensions().debug?.right}; transform: {layoutDimensions().debug?.transform};"
      aria-label="请求调试面板"
      onmouseenter={() => (isOverlay = true)}
      onmouseleave={() => (isOverlay = false)}
    >
      <div class="glance-panel__debug-header">
        <span class="glance-panel__debug-title">请求入参</span>
        <span class="glance-panel__debug-status">最终请求体</span>
      </div>
      <div class="glance-panel__debug-controls">
        <label class="glance-panel__debug-toggle">
          <input
            type="checkbox"
            checked={settings.debugRequestDispatchEnabled}
            onchange={handleDebugRequestDispatchToggle}
          />
          <span class="glance-panel__debug-toggle-track"></span>
          <span class="glance-panel__debug-toggle-label">发送请求</span>
        </label>
        <span class="glance-panel__debug-mode">{debugDispatchModeLabel()}</span>
      </div>
      <div class="glance-panel__debug-extraction">
        <div>
          <span class="glance-panel__debug-meta-label">提取模式</span>
          <span class="glance-panel__debug-meta-value">{debugExtractionSourceLabel()}</span>
        </div>
        <div>
          <span class="glance-panel__debug-meta-label">Markdown 字符</span>
          <span class="glance-panel__debug-meta-value">
            {debugExtractionInfo ? debugExtractionInfo.markdownLength.toLocaleString() : '等待提取'}
          </span>
        </div>
      </div>
      <pre class="glance-panel__debug-content">{debugRequestJson() || '请求生成后会展示在这里'}</pre>
    </aside>
  {/if}
  <aside
    class="glance-panel__summary"
    data-summary-state={summaryState}
    style="width: {layoutDimensions().summary.width}; height: {layoutDimensions().summary.height}; top: {layoutDimensions().summary.top}; left: {layoutDimensions().summary.left}; right: {layoutDimensions().summary.right}; transform: {layoutDimensions().summary.transform};"
    aria-label="页面总结面板"
    onmouseenter={() => (isOverlay = true)}
    onmouseleave={() => (isOverlay = false)}
  >
    <div class="glance-panel__summary-header">
      <span class="glance-panel__summary-title">页面总结</span>
      <span class="glance-panel__summary-status">{summaryStatus}</span>
    </div>
    <div class="glance-panel__summary-content">{@html summaryContent}</div>
  </aside>
  <div
    class="glance-panel"
    data-state={panelState}
    data-layout={settings.panelLayout}
    style="width: {layoutDimensions().panel.width}; height: {layoutDimensions().panel.height}; top: {layoutDimensions().panel.top}; right: {layoutDimensions().panel.right}; left: {layoutDimensions().panel.left}; transform: {layoutDimensions().panel.transform};"
    role="dialog"
    aria-label="预览面板"
    onmouseenter={() => (isOverlay = true)}
    onmouseleave={() => (isOverlay = false)}
  >
    {#if showResizeHandle}
      <div class="glance-panel__resize" title="拖拽以调整宽度" onpointerdown={startResize}></div>
    {/if}
    <div class="glance-panel__header">
      <span class="glance-panel__title">{currentUrl || ''}</span>
      <div class="glance-panel__actions">
        <button type="button" title="打开设置" onclick={openSettings}>⚙</button>
        <button type="button" title="在新标签打开" onclick={openInNewTab}>↗</button>
        <button type="button" title="关闭预览" onclick={close}>×</button>
      </div>
    </div>
    <iframe
      bind:this={frameElement}
      name={previewFrameName}
      class="glance-panel__frame"
      title="预览内容"
    ></iframe>
  </div>
</div>

<style>
  :global(:root) {
    --glance-theme: #0ea5e9;
    --glance-theme-rgb: 14, 165, 233;
  }

  .glance-panel__container {
    visibility: hidden;
    opacity: 0;
    transition: opacity 160ms ease, visibility 0s linear 160ms;
  }

  .glance-panel__container[data-visible='true'] {
    visibility: visible;
    opacity: 1;
    transition: opacity 160ms ease, visibility 0s linear 0s;
  }

  .glance-panel__overlay {
    position: absolute;
    inset: 0;
    background: rgba(255, 255, 255, 0.45);
    transition: opacity 160ms ease, backdrop-filter 160ms ease;
    pointer-events: none;
    z-index: 0;
  }

  .glance-panel__blocker {
    position: absolute;
    inset: 0;
    z-index: 2;
  }

  .glance-panel {
    position: absolute;
    border-radius: 18px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.82);
    box-shadow: 0 30px 60px rgba(15, 23, 42, 0.18);
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(32px) saturate(180%);
    z-index: 1;
    pointer-events: auto;
    transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
  }

  .glance-panel::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: linear-gradient(
      90deg,
      rgba(var(--glance-theme-rgb), 0.25),
      var(--glance-theme),
      rgba(var(--glance-theme-rgb), 0.25)
    );
    opacity: 0;
    transform-origin: left;
    animation: glance-loading 1s linear infinite;
    transition: opacity 120ms ease;
  }

  .glance-panel[data-state='loading']::after {
    opacity: 1;
  }

  .glance-panel[data-state='error'] {
    border-color: rgba(248, 113, 113, 0.7);
    box-shadow: 0 30px 60px rgba(248, 113, 113, 0.3);
  }

  .glance-panel__resize {
    position: absolute;
    left: -6px;
    top: 0;
    width: 12px;
    height: 100%;
    cursor: ew-resize;
    z-index: 2;
  }

  .glance-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 600;
    color: #0f172a;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0.35));
    border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  }

  .glance-panel__title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-right: 12px;
  }

  .glance-panel[data-state='error'] .glance-panel__title {
    color: #b91c1c;
  }

  .glance-panel__actions {
    display: flex;
    gap: 4px;
  }

  .glance-panel__actions button {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: rgba(15, 23, 42, 0.08);
    color: #0f172a;
    cursor: pointer;
    font-size: 14px;
    transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  .glance-panel__actions button:hover {
    background: rgba(var(--glance-theme-rgb), 0.18);
    color: #0f172a;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 8px 16px rgba(15, 23, 42, 0.15);
  }

  .glance-panel__frame {
    flex: 1;
    border: none;
    background: rgba(248, 250, 252, 0.85);
  }

  .glance-panel__summary {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    padding: 12px 14px 16px;
    border: 1px solid rgba(255, 255, 255, 0.68);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 30px 60px rgba(15, 23, 42, 0.16);
    backdrop-filter: blur(32px) saturate(180%);
    overflow: hidden;
    pointer-events: auto;
    z-index: 1;
  }

  .glance-panel__summary-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .glance-panel__summary-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #0f172a;
    text-transform: uppercase;
  }

  .glance-panel__summary-status {
    font-size: 12px;
    color: #475569;
    text-align: right;
  }

  .glance-panel__summary[data-summary-state='loading'] .glance-panel__summary-status {
    color: rgba(var(--glance-theme-rgb), 0.9);
  }

  .glance-panel__summary[data-summary-state='error'] .glance-panel__summary-status {
    color: #b91c1c;
  }

  .glance-panel__summary[data-summary-state='blocked'] .glance-panel__summary-status {
    color: #b45309;
  }

  .glance-panel__summary-content {
    flex: 1;
    overflow-y: auto;
    border-radius: 12px;
    background: rgba(15, 23, 42, 0.04);
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
    color: #0f172a;
    word-break: break-word;
  }
  /* 下面的 css 实际上都有用 */
  .glance-panel__summary-content h1,
  .glance-panel__summary-content h2,
  .glance-panel__summary-content h3,
  .glance-panel__summary-content h4,
  .glance-panel__summary-content h5,
  .glance-panel__summary-content h6 {
    margin: 0.8em 0 0.4em 0;
    font-weight: 600;
    line-height: 1.4;
  }

  .glance-panel__summary-content h1 {
    font-size: 1.4em;
  }
  .glance-panel__summary-content h2 {
    font-size: 1.3em;
  }
  .glance-panel__summary-content h3 {
    font-size: 1.2em;
  }
  .glance-panel__summary-content h4 {
    font-size: 1.1em;
  }
  .glance-panel__summary-content h5,
  .glance-panel__summary-content h6 {
    font-size: 1em;
  }

  .glance-panel__summary-content p {
    margin: 0.6em 0;
  }

  .glance-panel__summary-content ul,
  .glance-panel__summary-content ol {
    margin: 0.6em 0;
    padding-left: 1.5em;
  }

  .glance-panel__summary-content li {
    margin: 0.3em 0;
  }

  .glance-panel__summary-content code {
    background: rgba(15, 23, 42, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 0.9em;
  }

  .glance-panel__summary-content pre {
    background: rgba(15, 23, 42, 0.08);
    padding: 10px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.8em 0;
  }

  .glance-panel__summary-content pre code {
    background: transparent;
    padding: 0;
  }

  .glance-panel__summary-content blockquote {
    border-left: 3px solid rgba(var(--glance-theme-rgb), 0.3);
    padding-left: 12px;
    margin: 0.8em 0;
    color: #475569;
  }

  .glance-panel__summary-content a {
    color: var(--glance-theme);
    text-decoration: none;
  }

  .glance-panel__summary-content a:hover {
    text-decoration: underline;
  }

  .glance-panel__summary-content strong {
    font-weight: 600;
  }

  .glance-panel__summary-content em {
    font-style: italic;
  }

  .glance-panel__summary-content hr {
    border: none;
    border-top: 1px solid rgba(15, 23, 42, 0.1);
    margin: 1em 0;
  }

  .glance-panel__summary-content table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.8em 0;
  }

  .glance-panel__summary-content th,
  .glance-panel__summary-content td {
    border: 1px solid rgba(15, 23, 42, 0.1);
    padding: 6px 10px;
    text-align: left;
  }

  .glance-panel__summary-content th {
    background: rgba(15, 23, 42, 0.05);
    font-weight: 600;
  }

  .glance-panel__summary-content:empty::before {
    content: '内容生成后会展示在这里';
    color: #94a3b8;
  }

  .glance-panel__summary-setup {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: #0f172a;
  }

  .glance-panel__summary-setup-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
  }

  .glance-panel__summary-setup-desc {
    margin: 0;
    color: #475569;
    line-height: 1.5;
  }

  .glance-panel__debug {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    padding: 14px;
    border: 1px solid rgba(255, 255, 255, 0.68);
    border-radius: 18px;
    background: rgba(248, 250, 252, 0.92);
    box-shadow: 0 30px 60px rgba(15, 23, 42, 0.16);
    backdrop-filter: blur(32px) saturate(180%);
    overflow: hidden;
    pointer-events: auto;
    z-index: 1;
  }

  .glance-panel__debug-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .glance-panel__debug-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .glance-panel__debug-toggle {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    color: #0f172a;
    font-size: 12px;
    font-weight: 600;
  }

  .glance-panel__debug-toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .glance-panel__debug-toggle-track {
    position: relative;
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.18);
    transition: background 120ms ease;
    flex-shrink: 0;
  }

  .glance-panel__debug-toggle-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.2);
    transition: transform 120ms ease;
  }

  .glance-panel__debug-toggle input:checked + .glance-panel__debug-toggle-track {
    background: var(--glance-theme);
  }

  .glance-panel__debug-toggle input:checked + .glance-panel__debug-toggle-track::after {
    transform: translateX(16px);
  }

  .glance-panel__debug-toggle-label {
    letter-spacing: 0.02em;
  }

  .glance-panel__debug-mode {
    font-size: 12px;
    color: #64748b;
  }

  .glance-panel__debug-extraction {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .glance-panel__debug-extraction > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    border-radius: 12px;
    background: rgba(15, 23, 42, 0.06);
    padding: 10px;
  }

  .glance-panel__debug-meta-label {
    font-size: 11px;
    color: #64748b;
  }

  .glance-panel__debug-meta-value {
    overflow: hidden;
    color: #0f172a;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .glance-panel__debug-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #0f172a;
    text-transform: uppercase;
  }

  .glance-panel__debug-status {
    font-size: 12px;
    color: #64748b;
  }

  .glance-panel__debug-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0;
    border-radius: 12px;
    background: #0f172a;
    padding: 12px;
    color: #e2e8f0;
    font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  @keyframes glance-loading {
    0% {
      transform: scaleX(0.2);
    }
    50% {
      transform: scaleX(1);
    }
    100% {
      transform: scaleX(0.2);
    }
  }
</style>
