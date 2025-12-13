import { DEFAULT_SETTINGS, type ModelConfigState, UserSettings } from '../shared/settings';
import { extractMarkdownFromHtml } from './markdownExtractor';

type Coordinates = {
  clientX: number;
  clientY: number;
};

type PreviewElements = {
  overlay: HTMLDivElement;
  blocker: HTMLDivElement;
  panel: HTMLDivElement;
  header: HTMLDivElement;
  title: HTMLSpanElement;
  frame: HTMLIFrameElement;
  resizeHandle: HTMLDivElement;
  openButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  summary: HTMLDivElement;
  summaryStatus: HTMLSpanElement;
  summaryContent: HTMLDivElement;
};

type SummaryState = 'idle' | 'loading' | 'ready' | 'error' | 'blocked';

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

const DEFAULT_THEME_COLOR = DEFAULT_SETTINGS.themeColor;
const DEFAULT_THEME_RGB = (() => {
  const rgb = hexToRgb(DEFAULT_THEME_COLOR);
  return rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '14, 165, 233';
})();

export class PreviewPanel {
  private host: HTMLElement;
  private shadowRoot: ShadowRoot;
  private container: HTMLDivElement | null = null;
  private settings: UserSettings;
  private requestCounter = 0;
  private activeRequestId: number | null = null;
  private lastUrl: string | null = null;
  private elements: PreviewElements | null = null;
  private currentWidth = DEFAULT_SIDE_WIDTH;
  private teardownResize: (() => void) | null = null;
  private cleanupFunctions: Array<() => void> = [];
  private summaryAbortController: AbortController | null = null;
  private pendingSummary: { requestId: number; html: string; url: string } | null = null;
  private summaryState: SummaryState = 'idle';
  private modelConfig: ModelConfigState | null = null;

  constructor(initialSettings: UserSettings = DEFAULT_SETTINGS, initialModel?: ModelConfigState) {
    this.settings = initialSettings;
    // 创建自定义标签元素（不注册为 Web Component）
    this.host = document.createElement('glance-panel') as HTMLElement;
    // 手动 attachShadow
    this.shadowRoot = this.host.attachShadow({ mode: 'open' });
    this.setupShadowDOM();
    this.applyTheme(this.settings.themeColor);
    this.host.dataset.layout = this.settings.panelLayout;
    this.setupEventListeners();
    if (initialModel) {
      this.updateModelConfig(initialModel);
    }
  }

  private setupEventListeners() {
    // Window resize 事件
    const resizeHandler = () => this.applyDimensions();
    window.addEventListener('resize', resizeHandler);
    this.cleanupFunctions.push(() => {
      window.removeEventListener('resize', resizeHandler);
    });
    
    // Document click 事件 - 检测点击是否在 panel 外部
    const documentClickHandler = (event: MouseEvent) => {
      if (!this.elements || this.host.dataset.visible !== 'true') {
        return;
      }
      
      // 检查点击是否在 panel 内部
      const path = event.composedPath();
      const isInsidePanel = path.some(node => {
        if (node === this.host || node === this.shadowRoot || node === this.elements?.panel) {
          return true;
        }
        if (node instanceof Element && this.shadowRoot.contains(node)) {
          return true;
        }
        return false;
      });
      
      // 如果点击在 panel 外部，则关闭
      if (!isInsidePanel) {
        this.close();
      }
    };
    document.addEventListener('click', documentClickHandler, true);
    this.cleanupFunctions.push(() => {
      document.removeEventListener('click', documentClickHandler, true);
    });

    if (!this.elements) {
      return;
    }

    // Panel mouseenter/mouseleave 事件
    const panelMouseEnterHandler = () => {
      this.host.dataset.overlay = 'true';
      this.updateOverlayStyles();
    };
    const panelMouseLeaveHandler = () => {
      this.host.dataset.overlay = 'false';
      this.updateOverlayStyles();
    };
    this.elements.panel.addEventListener('mouseenter', panelMouseEnterHandler);
    this.elements.panel.addEventListener('mouseleave', panelMouseLeaveHandler);
    this.cleanupFunctions.push(() => {
      this.elements?.panel.removeEventListener('mouseenter', panelMouseEnterHandler);
      this.elements?.panel.removeEventListener('mouseleave', panelMouseLeaveHandler);
    });

    // 按钮点击事件
    const openButtonClickHandler = () => this.openInNewTab();
    const closeButtonClickHandler = () => this.close();
    this.elements.openButton.addEventListener('click', openButtonClickHandler);
    this.elements.closeButton.addEventListener('click', closeButtonClickHandler);
    this.cleanupFunctions.push(() => {
      this.elements?.openButton.removeEventListener('click', openButtonClickHandler);
      this.elements?.closeButton.removeEventListener('click', closeButtonClickHandler);
    });

    // Resize handle pointerdown 事件
    const resizeHandlePointerDownHandler = (event: PointerEvent) => this.startResize(event);
    this.elements.resizeHandle.addEventListener('pointerdown', resizeHandlePointerDownHandler);
    this.cleanupFunctions.push(() => {
      this.elements?.resizeHandle.removeEventListener('pointerdown', resizeHandlePointerDownHandler);
    });
  }

  getHostElement(): HTMLElement {
    return this.host;
  }

  destroy() {
    // 取消 resize 相关的监听器
    this.cancelResizeListeners();
    this.cancelSummaryParsing();

    // 执行所有清理函数
    this.cleanupFunctions.forEach(cleanup => cleanup());
    this.cleanupFunctions = [];
    
    // 移除 host 元素（frame load 监听器会在 frame 移除时自动清理）
    if (this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
  }

  applySettings(next: UserSettings) {
    const previousLayout = this.settings.panelLayout;
    this.settings = next;
    this.applyTheme(next.themeColor);
    this.host.dataset.layout = next.panelLayout;
    if (previousLayout !== next.panelLayout && next.panelLayout === 'side') {
      this.currentWidth = clamp(this.currentWidth, MIN_WIDTH, Math.min(SIDE_MAX_WIDTH, window.innerWidth - PANEL_MARGIN * 2));
    }
    this.toggleResizeHandle();
    this.applyDimensions();
  }

  updateModelConfig(next: ModelConfigState) {
    this.modelConfig = next;
    if (!next.ready) {
      this.renderModelSetupPrompt(next.note);
      this.setSummaryState('blocked', next.note);
      console.debug('[Glance] Summary prompt blocked (missing model config)');
    } else if (this.summaryState === 'blocked') {
      this.clearSummaryContent();
      this.setSummaryState('idle', '等待预览...');
    }
    const promptSource = next.summaryPrompt?.isDefault ? 'default' : 'custom';
    console.debug('[Glance] Summary prompt ready', {
      source: promptSource,
      length: next.summaryPrompt?.value.length ?? 0
    });
  }

  show(url: string, _pointer: Coordinates): number {
    const elements = this.ensureElements();
    this.requestCounter += 1;
    this.activeRequestId = this.requestCounter;
    this.lastUrl = url;
    this.cancelSummaryParsing();
    this.pendingSummary = null;
    this.clearSummaryContent();
    if (this.canSummarize()) {
      this.setSummaryState('loading', '正在加载页面内容...');
    } else {
      this.setSummaryState('blocked', this.modelConfig?.note ?? '尚未配置大模型');
      this.renderModelSetupPrompt(this.modelConfig?.note);
    }

    elements.panel.dataset.state = 'loading';
    elements.title.textContent = url;
    // elements.frame.srcdoc = '';
    this.applyDimensions();
    this.host.dataset.visible = 'true';
    this.host.dataset.overlay = 'false';
    if (this.container) {
      this.container.dataset.visible = 'true';
      this.container.style.opacity = '1';
    }

    return this.requestCounter;
  }

  async renderHtml(requestId: number, html: string, url: string) {
    if (!this.isCurrentRequest(requestId) || !this.elements) {
      return;
    }
    if (!this.canSummarize()) {
      return;
    }
    const { frame } = this.elements;
    this.pendingSummary = { requestId, html, url };
    this.setSummaryState('loading', '等待页面加载完成...');

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

    // Frame load 事件监听器（动态添加，自动清理）
    const onLoad = () => {
      if (this.elements && this.isCurrentRequest(requestId)) {
        this.elements.panel.dataset.state = 'ready';
        this.beginSummaryParsing(requestId);
      }
      frame.removeEventListener('load', onLoad);
    };

    frame.addEventListener('load', onLoad);
    frame.src = url;
  }

  showError(requestId: number, message: string) {
    if (!this.isCurrentRequest(requestId)) {
      return;
    }
    if (!this.elements) {
      return;
    }
    this.elements.panel.dataset.state = 'error';
    this.elements.title.textContent = message;
    this.pendingSummary = null;
    this.cancelSummaryParsing();
    if (!this.canSummarize()) {
      this.renderModelSetupPrompt(this.modelConfig?.note ?? message);
      this.setSummaryState('blocked', this.modelConfig?.note ?? message);
    } else {
      this.clearSummaryContent();
      this.setSummaryState('error', message);
    }
  }

  async close() {
    if (!this.elements) {
      return;
    }
    this.cancelResizeListeners();
    this.host.dataset.visible = 'false';
    this.host.dataset.overlay = 'false';
    this.host.dataset.resizing = 'false';
    if (this.container) {
      this.container.dataset.visible = 'false';
      this.container.style.opacity = '0';
    }
    this.elements.blocker.style.display = 'none';
    this.elements.panel.dataset.state = 'idle';
    this.elements.frame.src = '';
    this.pendingSummary = null;
    this.cancelSummaryParsing();
    this.clearSummaryContent();
    if (this.canSummarize()) {
      this.setSummaryState('idle', '等待预览...');
    } else {
      this.renderModelSetupPrompt(this.modelConfig?.note);
      this.setSummaryState('blocked', this.modelConfig?.note ?? '尚未配置大模型');
    }
    this.activeRequestId = null;

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

  openInNewTab() {
    if (this.lastUrl) {
      window.open(this.lastUrl, '_blank', 'noopener');
    }
  }

  private isCurrentRequest(requestId: number) {
    return this.activeRequestId === requestId;
  }

  private setupShadowDOM() {
    const style = document.createElement('style');
    style.textContent = this.getStyles();

    // 创建 container 元素
    const container = document.createElement('div');
    container.className = `${PANEL_CLASS}__container`;
    Object.assign(container.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 160ms ease'
    });
    this.container = container;

    // 使用模板字符串拼接 HTML
    const html = `
      <div class="${PANEL_CLASS}__overlay"></div>
      <div class="${PANEL_CLASS}__blocker"></div>
      <div class="${PANEL_CLASS}" data-state="idle">
        <div class="${PANEL_CLASS}__resize" title="拖拽以调整宽度"></div>
        <div class="${PANEL_CLASS}__header">
          <span class="${PANEL_CLASS}__title"></span>
          <div class="${PANEL_CLASS}__actions">
            <button type="button" title="在新标签打开">↗</button>
            <button type="button" title="关闭预览">×</button>
          </div>
        </div>
        <iframe class="${PANEL_CLASS}__frame" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"></iframe>
        <div class="${PANEL_CLASS}__summary" data-summary-state="idle">
          <div class="${PANEL_CLASS}__summary-header">
            <span class="${PANEL_CLASS}__summary-title">页面总结</span>
            <span class="${PANEL_CLASS}__summary-status">等待预览...</span>
          </div>
          <div class="${PANEL_CLASS}__summary-content"></div>
        </div>
      </div>
    `;
    const frag = document.createElement('div');
    frag.innerHTML = html;

    const overlay = frag.querySelector(`.${PANEL_CLASS}__overlay`)! as HTMLDivElement;
    const blocker = frag.querySelector(`.${PANEL_CLASS}__blocker`)! as HTMLDivElement;
    const panel = frag.querySelector(`.${PANEL_CLASS}`)! as HTMLDivElement;
    const header = frag.querySelector(`.${PANEL_CLASS}__header`)! as HTMLDivElement;
    const title = frag.querySelector(`.${PANEL_CLASS}__title`)! as HTMLSpanElement;
    const actions = frag.querySelector(`.${PANEL_CLASS}__actions`)! as HTMLDivElement;
    const openButton = actions.querySelector('button[title="在新标签打开"]')! as HTMLButtonElement;
    const closeButton = actions.querySelector('button[title="关闭预览"]')! as HTMLButtonElement;
    const frame = frag.querySelector(`.${PANEL_CLASS}__frame`)! as HTMLIFrameElement;
    const resizeHandle = frag.querySelector(`.${PANEL_CLASS}__resize`)! as HTMLDivElement;
    const summary = frag.querySelector(`.${PANEL_CLASS}__summary`)! as HTMLDivElement;
    const summaryStatus = frag.querySelector(`.${PANEL_CLASS}__summary-status`)! as HTMLSpanElement;
    const summaryContent = frag.querySelector(`.${PANEL_CLASS}__summary-content`)! as HTMLDivElement;

    // 将所有内容添加到 container
    container.append(...frag.childNodes);
    // 将 style 和 container 添加到 shadowRoot
    this.shadowRoot.append(style, container);

    // 保存所有元素引用
    this.elements = {
      overlay,
      blocker,
      panel,
      header,
      title,
      frame,
      resizeHandle,
      openButton,
      closeButton,
      summary,
      summaryStatus,
      summaryContent
    };
    this.host.dataset.overlay = 'false';
    this.host.dataset.resizing = 'false';
    this.toggleResizeHandle();
    this.setSummaryState('idle', '等待预览...');
  }

  private updateOverlayStyles() {
    if (!this.elements) return;
    const isOverlay = this.host.dataset.overlay === 'true' || this.host.dataset.resizing === 'true';
    if (isOverlay) {
      this.elements.overlay.style.opacity = '1';
      this.elements.overlay.style.backdropFilter = 'blur(18px)';
    } else {
      this.elements.overlay.style.opacity = '0';
      this.elements.overlay.style.backdropFilter = 'blur(0px)';
    }
    if (this.host.dataset.resizing === 'true') {
      this.elements.overlay.style.opacity = '0.4';
    }
  }

  private toggleResizeHandle() {
    if (!this.elements) {
      return;
    }
    const shouldShow = this.settings.panelLayout === 'side';
    this.elements.resizeHandle.style.display = shouldShow ? 'block' : 'none';
  }

  private clearSummaryContent() {
    if (!this.elements) {
      return;
    }
    this.elements.summaryContent.textContent = '';
  }

  private renderModelSetupPrompt(note?: string) {
    if (!this.elements) {
      return;
    }
    this.clearSummaryContent();
    const wrapper = document.createElement('div');
    wrapper.className = `${PANEL_CLASS}__summary-setup`;
    const title = document.createElement('p');
    title.className = `${PANEL_CLASS}__summary-setup-title`;
    title.textContent = '尚未配置大模型';
    const desc = document.createElement('p');
    desc.className = `${PANEL_CLASS}__summary-setup-desc`;
    desc.textContent = note ?? '在 Options 页面配置 OpenAI 兼容 API 后即可生成总结。';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = `${PANEL_CLASS}__summary-setup-button`;
    action.textContent = '前往模型设置';
    action.addEventListener('click', () => this.openOptionsPage());
    wrapper.append(title, desc, action);
    this.elements.summaryContent.appendChild(wrapper);
  }

  private openOptionsPage() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      const url = chrome.runtime.getURL('options/page.html');
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    window.open('/options/page.html', '_blank', 'noopener,noreferrer');
  }

  private renderSummaryContent(markdown: string) {
    if (!this.elements) {
      return;
    }
    this.elements.summaryContent.textContent = markdown;
  }

  private setSummaryState(state: SummaryState, message?: string) {
    this.summaryState = state;
    if (!this.elements) {
      return;
    }
    this.elements.summary.dataset.summaryState = state;
    const fallbackMessages: Record<SummaryState, string> = {
      idle: '等待预览...',
      loading: '正在解析页面内容...',
      ready: '已生成初步总结',
      error: '暂时无法解析该页面',
      blocked: '尚未配置模型'
    };
    this.elements.summaryStatus.textContent = message || fallbackMessages[state];
  }

  private canSummarize(): boolean {
    return !!this.modelConfig?.ready;
  }

  private getSummaryPromptInfo(): { value: string; source: 'default' | 'custom' } {
    const prompt = this.modelConfig?.summaryPrompt?.value ?? DEFAULT_SETTINGS.summaryPrompt;
    const isDefault = this.modelConfig?.summaryPrompt?.isDefault !== false;
    const source: 'default' | 'custom' = isDefault ? 'default' : 'custom';
    return { value: prompt, source };
  }

  private beginSummaryParsing(requestId: number) {
    if (!this.pendingSummary || this.pendingSummary.requestId !== requestId) {
      return;
    }
    if (!this.canSummarize()) {
      return;
    }
    const { html, url } = this.pendingSummary;
    if (!html) {
      this.setSummaryState('error', '未能获取页面源代码');
      return;
    }

    this.cancelSummaryParsing();
    const controller = new AbortController();
    this.summaryAbortController = controller;
    this.setSummaryState('loading', '正在解析页面内容...');
    const promptInfo = this.getSummaryPromptInfo();
    console.debug('[Glance] 即将使用 summary prompt', {
      source: promptInfo.source,
      length: promptInfo.value.length
    });

    extractMarkdownFromHtml(html, url, { signal: controller.signal })
      .then(markdown => {
        if (!this.isCurrentRequest(requestId) || controller.signal.aborted) {
          return;
        }
        const trimmed = markdown.trim();
        if (trimmed) {
          this.renderSummaryContent(trimmed);
          this.setSummaryState('ready', '已生成初步总结');
        } else {
          this.clearSummaryContent();
          this.setSummaryState('error', '未能提取该页面的正文，↗ 在新标签中查看');
        }
        this.pendingSummary = null;
      })
      .catch(error => {
        if (!this.isCurrentRequest(requestId) || controller.signal.aborted) {
          return;
        }
        console.warn('[Glance] 解析页面总结失败', error);
        this.clearSummaryContent();
        this.setSummaryState('error', '暂时无法解析该页面，↗ 在新标签中查看');
        this.pendingSummary = null;
      })
      .finally(() => {
        if (this.summaryAbortController === controller) {
          this.summaryAbortController = null;
        }
      });
  }

  private cancelSummaryParsing() {
    if (this.summaryAbortController) {
      this.summaryAbortController.abort();
      this.summaryAbortController = null;
    }
  }

  private ensureElements(): PreviewElements {
    if (!this.elements) {
      this.setupShadowDOM();
    }
    return this.elements!;
  }

  private applyTheme(color: string) {
    const normalized = normalizeColor(color) ?? DEFAULT_THEME_COLOR;
    const rgb = hexToRgb(normalized);
    const rgbString = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : DEFAULT_THEME_RGB;
    if (this.container) {
      this.container.style.setProperty('--glance-theme', normalized);
      this.container.style.setProperty('--glance-theme-rgb', rgbString);
    }
  }

  private applyDimensions() {
    if (!this.elements) {
      return;
    }
    const { panel } = this.elements;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const height = Math.max(320, Math.round(viewportHeight * PANEL_HEIGHT_RATIO));
    const top = Math.max((viewportHeight - height) / 2, 16);
    const availableWidth = viewportWidth - PANEL_MARGIN * 2;

    if (this.settings.panelLayout === 'center') {
      const width = this.getCenteredWidth(viewportWidth);
      panel.style.width = `${width}px`;
      panel.style.left = '50%';
      panel.style.right = 'auto';
      panel.style.transform = 'translateX(-50%)';
    } else {
      const clampedWidth = clamp(this.currentWidth, MIN_WIDTH, Math.min(SIDE_MAX_WIDTH, availableWidth));
      this.currentWidth = clampedWidth;
      panel.style.width = `${clampedWidth}px`;
      panel.style.right = `${PANEL_MARGIN}px`;
      panel.style.left = 'auto';
      panel.style.transform = 'none';
    }

    panel.style.height = `${height}px`;
    panel.style.top = `${top}px`;
  }

  private getCenteredWidth(viewportWidth: number) {
    const ideal = Math.round(viewportWidth * CENTER_WIDTH_RATIO);
    const available = Math.max(MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    const min = Math.min(Math.max(CENTER_MIN_WIDTH, MIN_WIDTH), available);
    const max = Math.max(min, Math.min(CENTER_MAX_WIDTH, available));
    return clamp(ideal, min, max);
  }

  private startResize(event: PointerEvent) {
    if (this.settings.panelLayout !== 'side') {
      return;
    }
    event.preventDefault();
    this.cancelResizeListeners();
    this.setResizing(true);

    const onMove = (moveEvent: PointerEvent) => {
      const viewportWidth = window.innerWidth;
      const candidate = viewportWidth - moveEvent.clientX - PANEL_MARGIN;
      this.currentWidth = clamp(candidate, MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - PANEL_MARGIN * 2));
      this.applyDimensions();
    };

    const onUp = () => {
      this.cancelResizeListeners();
      this.setResizing(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    this.teardownResize = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }

  private cancelResizeListeners() {
    if (this.teardownResize) {
      this.teardownResize();
      this.teardownResize = null;
    }
  }

  private setResizing(value: boolean) {
    if (!this.elements) return;
    this.host.dataset.resizing = value ? 'true' : 'false';
    if (value) {
      this.elements.blocker.style.display = 'block';
      this.elements.blocker.style.pointerEvents = 'auto';
    } else {
      this.elements.blocker.style.display = 'none';
      this.elements.blocker.style.pointerEvents = 'none';
    }
    this.updateOverlayStyles();
  }

  private getStyles(): string {
    return `
      :host {
        --glance-theme: ${DEFAULT_THEME_COLOR};
        --glance-theme-rgb: ${DEFAULT_THEME_RGB};
      }

      .${PANEL_CLASS}__container {
        --glance-theme: ${DEFAULT_THEME_COLOR};
        --glance-theme-rgb: ${DEFAULT_THEME_RGB};
      }

      .${PANEL_CLASS}__overlay {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.45);
        opacity: 0;
        transition: opacity 160ms ease, backdrop-filter 160ms ease;
        pointer-events: none;
        backdrop-filter: blur(0px);
        z-index: 0;
      }

      .${PANEL_CLASS}__blocker {
        position: absolute;
        inset: 0;
        display: none;
        cursor: ew-resize;
        z-index: 2;
        pointer-events: none;
      }

      .${PANEL_CLASS} {
        position: absolute;
        width: ${DEFAULT_SIDE_WIDTH}px;
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

      .${PANEL_CLASS}::after {
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

      .${PANEL_CLASS}[data-state="loading"]::after {
        opacity: 1;
      }

      .${PANEL_CLASS}[data-state="error"] {
        border-color: rgba(248, 113, 113, 0.7);
        box-shadow: 0 30px 60px rgba(248, 113, 113, 0.3);
      }

      .${PANEL_CLASS}__resize {
        position: absolute;
        left: -6px;
        top: 0;
        width: 12px;
        height: 100%;
        cursor: ew-resize;
        z-index: 2;
      }

      .${PANEL_CLASS}__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        background: linear-gradient(135deg, rgba(255,255,255,0.65), rgba(255,255,255,0.35));
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      .${PANEL_CLASS}__title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-right: 12px;
      }

      .${PANEL_CLASS}__actions {
        display: flex;
        gap: 4px;
      }

      .${PANEL_CLASS}__actions button {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: none;
        background: rgba(15, 23, 42, 0.08);
        color: #0f172a;
        cursor: pointer;
        font-size: 14px;
        transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.5);
      }

      .${PANEL_CLASS}__actions button:hover {
        background: rgba(var(--glance-theme-rgb), 0.18);
        color: #0f172a;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.6), 0 8px 16px rgba(15, 23, 42, 0.15);
      }

      .${PANEL_CLASS}[data-state="error"] .${PANEL_CLASS}__title {
        color: #b91c1c;
      }

      .${PANEL_CLASS}__frame {
        flex: 1;
        border: none;
        background: rgba(248, 250, 252, 0.85);
      }

      .${PANEL_CLASS}__summary {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 14px 16px;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
        background: rgba(255, 255, 255, 0.92);
        flex-shrink: 0;
        min-height: 150px;
        max-height: 240px;
      }

      .${PANEL_CLASS}__summary-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .${PANEL_CLASS}__summary-title {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: #0f172a;
        text-transform: uppercase;
      }

      .${PANEL_CLASS}__summary-status {
        font-size: 12px;
        color: #475569;
        text-align: right;
      }

      .${PANEL_CLASS}__summary[data-summary-state="loading"] .${PANEL_CLASS}__summary-status {
        color: rgba(var(--glance-theme-rgb), 0.9);
      }

      .${PANEL_CLASS}__summary[data-summary-state="error"] .${PANEL_CLASS}__summary-status {
        color: #b91c1c;
      }

      .${PANEL_CLASS}__summary[data-summary-state="blocked"] .${PANEL_CLASS}__summary-status {
        color: #b45309;
      }

      .${PANEL_CLASS}__summary-content {
        flex: 1;
        overflow-y: auto;
        border-radius: 12px;
        background: rgba(15, 23, 42, 0.04);
        padding: 12px;
        font-size: 13px;
        line-height: 1.6;
        color: #0f172a;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
      }

      .${PANEL_CLASS}__summary-content:empty::before {
        content: '内容生成后会展示在这里';
        color: #94a3b8;
      }

      .${PANEL_CLASS}__summary-setup {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 13px;
        color: #0f172a;
      }

      .${PANEL_CLASS}__summary-setup-title {
        font-size: 14px;
        font-weight: 600;
        margin: 0;
      }

      .${PANEL_CLASS}__summary-setup-desc {
        margin: 0;
        color: #475569;
        line-height: 1.5;
      }

      .${PANEL_CLASS}__summary-setup-button {
        align-self: flex-start;
        border: none;
        border-radius: 999px;
        padding: 6px 16px;
        font-size: 13px;
        font-weight: 600;
        background: var(--glance-theme);
        color: #fff;
        cursor: pointer;
        transition: opacity 120ms ease, box-shadow 120ms ease;
        box-shadow: 0 8px 16px rgba(var(--glance-theme-rgb), 0.25);
      }

      .${PANEL_CLASS}__summary-setup-button:hover {
        opacity: 0.92;
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
    `;
  }
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
