import { Component, input, output } from '@angular/core';
import { IconComponent } from './icons';

@Component({
    selector: 'app-modal',
    standalone: true,
    imports: [IconComponent],
    template: `
    <div class="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/20 dark:bg-black/50 backdrop-blur-sm animate-fade-in">
      <!-- Backdrop -->
      <div (click)="onClose()" class="absolute inset-0"></div>

      <!-- Modal -->
      <div class="relative bg-white dark:bg-[#0c0c0e] rounded-2xl shadow-2xl w-full border border-zinc-200 dark:border-zinc-800 animate-modal-enter z-10"
           [class]="getSizeClass()">
        
        <!-- Header -->
        @if (title()) {
          <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
            <h2 class="text-lg font-bold text-zinc-900 dark:text-white">{{ title() }}</h2>
            @if (closeable()) {
              <button (click)="onClose()" 
                      class="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors btn-press">
                <app-icon name="x" [size]="18"></app-icon>
              </button>
            }
          </div>
        }

        <!-- Content -->
        <div class="p-6 overflow-y-auto" [style.max-height.px]="maxHeight()">
          <ng-content></ng-content>
        </div>

        <!-- Footer (if has actions) -->
        @if (showFooter()) {
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            @if (showCancel()) {
              <button (click)="cancel.emit()"
                      class="px-4 py-2 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-sm font-semibold rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors btn-press">
                {{ cancelText() || 'Cancel' }}
              </button>
            }
            @if (showConfirm()) {
              <button (click)="confirm.emit()"
                      class="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors btn-press shadow-md">
                {{ confirmText() || 'Confirm' }}
              </button>
            }
          </div>
        }
      </div>
    </div>
  `
})
export class ModalComponent {
    title = input<string>('');
    size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
    closeable = input<boolean>(true);
    showFooter = input<boolean>(false);
    showCancel = input<boolean>(true);
    showConfirm = input<boolean>(true);
    confirmText = input<string>('');
    cancelText = input<string>('');
    maxHeight = input<number>(600);

    close = output<void>();
    confirm = output<void>();
    cancel = output<void>();

    onClose(): void {
        if (this.closeable()) {
            this.close.emit();
        }
    }

    getSizeClass(): string {
        switch (this.size()) {
            case 'sm': return 'max-w-sm';
            case 'md': return 'max-w-md';
            case 'lg': return 'max-w-2xl';
            case 'xl': return 'max-w-4xl';
            default: return 'max-w-md';
        }
    }
}
