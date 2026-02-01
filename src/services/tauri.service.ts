import { Injectable, signal } from '@angular/core';

export type UnlistenFn = () => void;

@Injectable({ providedIn: 'root' })
export class TauriService {
  readonly isTauri = signal(false);

  private readonly readyPromise: Promise<void>;
  private dataRootPromise: Promise<string> | null = null;

  constructor() {
    this.readyPromise = this.detectRuntime();
  }

  async ready(): Promise<void> {
    await this.readyPromise;
  }

  private async detectRuntime(): Promise<void> {
    const w = window as any;
    let tauri = false;
    try {
      const core = await import('@tauri-apps/api/core');
      tauri = typeof (core as any).isTauri === 'function' ? !!(core as any).isTauri() : false;
    } catch {
      tauri = false;
    }

    if (!tauri) {
      tauri = !!w.__TAURI_INTERNALS__ || !!w.__TAURI__;
    }

    this.isTauri.set(tauri);
  }

  async invoke<T>(cmd: string, args?: any): Promise<T> {
    const core = await import('@tauri-apps/api/core');
    return core.invoke<T>(cmd, args);
  }

  async listen<T>(eventName: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    const evt = await import('@tauri-apps/api/event');
    return evt.listen<T>(eventName, (event) => handler(event.payload));
  }

  async convertFileSrc(filePath: string, protocol: string = 'asset'): Promise<string> {
    const core = await import('@tauri-apps/api/core');
    return core.convertFileSrc(filePath, protocol);
  }

  async getDataRoot(): Promise<string> {
    await this.ready();
    if (!this.isTauri()) {
      throw new Error('not running in tauri');
    }
    if (!this.dataRootPromise) {
      this.dataRootPromise = this.invoke<string>('get_data_root');
    }
    return this.dataRootPromise;
  }
}
