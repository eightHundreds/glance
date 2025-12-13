import { extractDragUrl } from './utils/url';

type DragPayload = {
  url: string;
  startX: number;
  startY: number;
  triggered: boolean;
};

type TriggerArgs = {
  url: string;
  clientX: number;
  clientY: number;
};

type Options = {
  threshold: number;
  onTrigger: (args: TriggerArgs) => void;
};

/**
 * 初始化拖拽检测器
 */
export function initDragDetector(options: Options) {
  let activeDrag: DragPayload | null = null;

  function handleDragStart(event: DragEvent) {
    const url = extractDragUrl(event);
    if (!url) {
      activeDrag = null;
      return;
    }

    activeDrag = {
      url,
      startX: event.screenX,
      startY: event.screenY,
      triggered: false
    };
  }

  function handleDragOver(event: DragEvent) {
    if (!activeDrag || activeDrag.triggered) {
      return;
    }

    const delta = Math.hypot(
      event.screenX - activeDrag.startX,
      event.screenY - activeDrag.startY
    );

    if (delta >= options.threshold) {
      activeDrag.triggered = true;
      options.onTrigger({
        url: activeDrag.url,
        clientX: event.clientX,
        clientY: event.clientY
      });
    }
  }

  function handleDragEnd() {
    activeDrag = null;
  }

  document.addEventListener('dragstart', handleDragStart, true);
  document.addEventListener('dragover', handleDragOver, true);
  document.addEventListener('dragend', handleDragEnd, true);

  return () => {
    document.removeEventListener('dragstart', handleDragStart, true);
    document.removeEventListener('dragover', handleDragOver, true);
    document.removeEventListener('dragend', handleDragEnd, true);
  };
}
