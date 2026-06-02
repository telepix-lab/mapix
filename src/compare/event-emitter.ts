/**
 * Browser-compatible EventEmitter.
 * A lightweight event emitter used instead of Node.js's events module.
 */
type EventHandler<T = unknown> = (data: T) => void;

export class EventEmitter {
  private handlers: Map<string, Set<EventHandler>> = new Map<
    string,
    Set<EventHandler>
  >();

  on<T = unknown>(type: string, handler: EventHandler<T>): this {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)?.add(handler as EventHandler);
    return this;
  }

  emit(type: string, data: unknown): this {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach((handler) => {
        handler(data);
      });
    }
    return this;
  }

  removeListener<T = unknown>(type: string, handler: EventHandler<T>): this {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    }
    return this;
  }

  removeAllListeners(type?: string): this {
    if (type) {
      this.handlers.delete(type);
    } else {
      this.handlers.clear();
    }
    return this;
  }
}
