import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(20);

export function requestDispatch(): void {
  emitter.emit('dispatch');
}

export function onDispatchRequest(listener: () => void): void {
  emitter.on('dispatch', listener);
}