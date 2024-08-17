import { pushable, type Pushable } from "it-pushable";

export class PushableQueue<T> {
  public queue: Pushable<T, void, unknown>;

  public constructor() {
    this.queue = pushable({ onEnd: this.onEnd, objectMode: true });
  }

  public push(item: T): void {
    this.queue.push(item);
    (item as any).tracer?.now("local: queued");
  }

  public onEnd(error?: Error): void {
    if (error) {
      console.error("PushableQueue ended with error:", error);
    } else {
      console.log("PushableQueue ended gracefully.");
    }
  }
}
