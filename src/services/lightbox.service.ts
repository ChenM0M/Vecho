import { Injectable, signal } from '@angular/core';

export type LightboxKind = 'image' | 'svg';

export interface LightboxState {
  kind: LightboxKind;
  title?: string;
  src: string;
}

@Injectable({ providedIn: 'root' })
export class LightboxService {
  readonly active = signal<LightboxState | null>(null);

  openImage(url: string, title?: string): void {
    const u = (url || '').trim();
    if (!u) return;
    this.active.set({ kind: 'image', src: u, title });
  }

  openSvg(svg: string, title?: string): void {
    const s = (svg || '').trim();
    if (!s) return;
    this.active.set({ kind: 'svg', src: s, title });
  }

  close(): void {
    this.active.set(null);
  }
}
