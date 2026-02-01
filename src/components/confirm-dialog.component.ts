import { Component, HostListener, inject } from '@angular/core';
import { ConfirmService } from '../services/confirm.service';
import { IconComponent } from './icons';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (confirm.active(); as c) {
      <div class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
           (mousedown)="onBackdrop($event)">
        <div class="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-2xl p-5 animate-modal-enter"
             (mousedown)="$event.stopPropagation()">

          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{{ c.title }}</h3>
              <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{{ c.message }}</p>
            </div>
            <button class="shrink-0 w-8 h-8 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    (click)="confirm.cancel()"
                    title="Close">
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          </div>

          <div class="mt-5 flex items-center justify-end gap-2">
            <button class="px-3 py-2 rounded-md text-sm font-semibold border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    (click)="confirm.cancel()">
              {{ c.cancelText }}
            </button>
            <button class="px-3 py-2 rounded-md text-sm font-semibold transition-colors"
                    [class.bg-red-600]="c.danger"
                    [class.hover:bg-red-700]="c.danger"
                    [class.text-white]="c.danger"
                    [class.bg-zinc-900]="!c.danger"
                    [class.dark:bg-zinc-100]="!c.danger"
                    [class.hover:opacity-90]="!c.danger"
                    [class.text-white]="!c.danger"
                    [class.dark:text-black]="!c.danger"
                    (click)="confirm.accept()">
              {{ c.confirmText }}
            </button>
          </div>
        </div>
      </div>
    }
  `
})
export class ConfirmDialogComponent {
  confirm = inject(ConfirmService);

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.confirm.active()) this.confirm.cancel();
  }

  onBackdrop(event: MouseEvent) {
    event.preventDefault();
    this.confirm.cancel();
  }
}
