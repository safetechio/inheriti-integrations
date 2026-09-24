import { EventEmitter } from 'node:events';

const keyboard = new EventEmitter();

export function requestCliCancel(): void {
  keyboard.emit('cancel');
}

export function registerCliCancel(controller: AbortController): () => void {
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  keyboard.on('cancel', cancel);
  return () => {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    keyboard.off('cancel', cancel);
  };
}
