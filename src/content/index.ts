import { TRIGGER_DISTANCE_PX } from './constants';
import { initDragDetector } from './dragDetector';
import { loadDocumentHtml } from './documentLoader';
import { PreviewPanel } from './previewPanel';
import {
  DEFAULT_SETTINGS,
  loadSettingsState,
  loadModelConfigState,
  watchSettings,
  UserSettings,
  type ModelConfigState
} from '../shared/settings';
import { MODEL_CONFIG_UPDATED } from '../shared/messages';

if (window.top === window) {
  void bootstrap();
}

async function bootstrap() {
  // run_at: "document_end" 保证此时 DOM 已解析完成，document.body 一定存在
  // 创建 PreviewPanel 实例（使用自定义标签但不注册为 Web Component）
  let initialSettings: UserSettings = DEFAULT_SETTINGS;
  let initialModelState: ModelConfigState | null = null;
  try {
    const state = await loadSettingsState();
    initialSettings = state.settings;
    initialModelState = state.model;
  } catch (error) {
    console.warn('[Glance] 读取设置失败，使用默认值。', error);
  }
  
  const panel = new PreviewPanel(initialSettings, initialModelState ?? undefined);
  document.body.appendChild(panel.getHostElement());

  watchSettings(next => panel.applySettings(next));

  const refreshModelConfig = async () => {
    try {
      const nextState = await loadModelConfigState();
      panel.updateModelConfig(nextState);
    } catch (error) {
      console.warn('[Glance] 无法刷新模型配置状态', error);
    }
  };

  if (!initialModelState) {
    void refreshModelConfig();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === MODEL_CONFIG_UPDATED) {
        void refreshModelConfig();
      }
    });
  }

  let currentController: AbortController | null = null;
  let activeRequestId: number | null = null;

  initDragDetector({
    threshold: TRIGGER_DISTANCE_PX,
    onTrigger: ({ url, clientX, clientY }) => {
      void refreshModelConfig();
      if (currentController) {
        currentController.abort();
      }
      currentController = new AbortController();

      const requestId = panel.show(url, { clientX, clientY });
      activeRequestId = requestId;

      void panel.startPreview(requestId, url);

      console.debug('[Glance][DOM_CAPTURE] HTTP fallback fetch started', {
        requestId,
        url
      });
      loadDocumentHtml(url, currentController.signal)
        .then(html => {
          console.debug('[Glance][DOM_CAPTURE] HTTP fallback fetch finished', {
            requestId,
            url,
            htmlLength: html.length
          });
          panel.setSummaryFallbackHtml(requestId, html);
        })
        .catch(error => {
          if (currentController?.signal.aborted) {
            return;
          }
          console.warn('[Glance] 总结兜底 HTML 获取失败', {
            requestId,
            url,
            error
          });
          panel.onSummaryFallbackFailed(requestId);
        })
        .finally(() => {
          if (currentController?.signal.aborted) {
            currentController = null;
          } else if (activeRequestId === requestId) {
            currentController = null;
          }
        });
    }
  });

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      void panel.close();
      if (currentController) {
        currentController.abort();
        currentController = null;
      }
    }
  });
}
