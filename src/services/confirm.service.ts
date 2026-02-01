import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface ConfirmState extends Required<Pick<ConfirmOptions, 'message'>> {
  id: string;
  title: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
}

type Resolver = (value: boolean) => void;

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly active = signal<ConfirmState | null>(null);

  private resolver: Resolver | null = null;

  async confirm(options: ConfirmOptions): Promise<boolean> {
    // Cancel any existing dialog.
    if (this.resolver) {
      this.resolver(false);
      this.resolver = null;
    }

    const state: ConfirmState = {
      id: `confirm-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: options.title || '确认操作',
      message: options.message,
      confirmText: options.confirmText || '确认',
      cancelText: options.cancelText || '取消',
      danger: !!options.danger,
    };

    this.active.set(state);

    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  accept(): void {
    const r = this.resolver;
    this.resolver = null;
    this.active.set(null);
    r?.(true);
  }

  cancel(): void {
    const r = this.resolver;
    this.resolver = null;
    this.active.set(null);
    r?.(false);
  }
}
