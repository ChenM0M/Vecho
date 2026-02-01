import { Injectable, signal } from '@angular/core';
import type { Toast } from '../types';

/**
 * ToastService - Global notification system
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
    readonly toasts = signal<Toast[]>([]);

    show(type: Toast['type'], message: string, duration: number = 3000): void {
        const toast: Toast = {
            id: `toast-${Date.now()}-${Math.random()}`,
            type,
            message,
            duration
        };

        this.toasts.update(t => [...t, toast]);

        if (duration > 0) {
            setTimeout(() => this.dismiss(toast.id), duration);
        }
    }

    success(message: string, duration?: number): void {
        this.show('success', message, duration);
    }

    error(message: string, duration?: number): void {
        this.show('error', message, duration);
    }

    warning(message: string, duration?: number): void {
        this.show('warning', message, duration);
    }

    info(message: string, duration?: number): void {
        this.show('info', message, duration);
    }

    dismiss(id: string): void {
        this.toasts.update(t => t.filter(toast => toast.id !== id));
    }

    clear(): void {
        this.toasts.set([]);
    }
}
