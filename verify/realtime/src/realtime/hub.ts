// apps/api/src/realtime/hub.ts — the open streams of this instance
export interface AppEvent {
  tenantId: string;
  type: string;          // 'appointment.changed' | 'notification.created' | 'membership.changed'
  id?: string;
  version?: number;
  userId?: string;       // set: only this user's streams get it
}

export interface Stream {
  tenantId: string;
  userId: string;
  send(event: 'invalidate' | 'resync', data: object): void;
  close(): void;
}

export class Hub {
  readonly #streams = new Set<Stream>();

  add(stream: Stream): () => void {
    this.#streams.add(stream);
    return () => this.#streams.delete(stream);
  }

  publish(event: AppEvent): void {
    for (const s of this.#streams) {
      if (s.tenantId !== event.tenantId) continue;                 // tenant isolation
      if (event.userId && s.userId !== event.userId) continue;     // per-user events
      if (event.type === 'membership.changed') s.close();          // re-authorize: the client reconnects
      else s.send('invalidate', { type: event.type, id: event.id, version: event.version });
    }
  }

  resyncAll(): void { for (const s of this.#streams) s.send('resync', {}); }   // events may be lost
  closeAll(): void { for (const s of [...this.#streams]) s.close(); }           // shutdown

  count(f: { tenantId?: string; userId?: string } = {}): number {
    return [...this.#streams].filter((s) => (!f.tenantId || s.tenantId === f.tenantId) && (!f.userId || s.userId === f.userId)).length;
  }
}
