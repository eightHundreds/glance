import { mount, unmount } from 'svelte';
import { DEFAULT_SETTINGS, type ModelConfigState, type UserSettings } from '../shared/settings';
import PreviewPanelComponent from './PreviewPanel.svelte';

type Coordinates = {
  clientX: number;
  clientY: number;
};

export class PreviewPanel {
  private host: HTMLElement;
  private shadowRoot: ShadowRoot;
  // Svelte 5 mount returns component exports (functions, etc.)
  private component: {
    applySettings: (next: UserSettings) => void;
    updateModelConfig: (next: ModelConfigState) => void;
    show: (url: string, pointer: Coordinates) => number;
    renderHtml: (requestId: number, html: string, url: string) => Promise<void>;
    showError: (requestId: number, message: string) => void;
    close: () => Promise<void>;
    openInNewTab: () => void;
  } | null = null;

  constructor(initialSettings: UserSettings = DEFAULT_SETTINGS, initialModel?: ModelConfigState) {
    // 创建自定义标签元素（不注册为 Web Component）
    this.host = document.createElement('glance-panel') as HTMLElement;
    // 手动 attachShadow
    this.shadowRoot = this.host.attachShadow({ mode: 'open' });
    
    // 在 Shadow DOM 中挂载 Svelte 组件（使用 Svelte 5 mount API）
    const mounted = mount(PreviewPanelComponent, {
      target: this.shadowRoot,
      props: {
        initialSettings,
        initialModel
      }
    });
    this.component = mounted as typeof this.component;
  }

  getHostElement(): HTMLElement {
    return this.host;
  }

  destroy() {
    if (this.component) {
      unmount(this.component);
      this.component = null;
    }
    
    // 移除 host 元素
    if (this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
  }

  applySettings(next: UserSettings) {
    if (this.component) {
      this.component.applySettings(next);
    }
  }

  updateModelConfig(next: ModelConfigState) {
    if (this.component) {
      this.component.updateModelConfig(next);
    }
  }

  show(url: string, pointer: Coordinates): number {
    if (this.component) {
      return this.component.show(url, pointer);
    }
    return 0;
  }

  async renderHtml(requestId: number, html: string, url: string) {
    if (this.component) {
      return this.component.renderHtml(requestId, html, url);
    }
  }

  showError(requestId: number, message: string) {
    if (this.component) {
      this.component.showError(requestId, message);
    }
  }

  async close() {
    if (this.component) {
      return this.component.close();
    }
  }

  openInNewTab() {
    if (this.component) {
      this.component.openInNewTab();
    }
  }
}
