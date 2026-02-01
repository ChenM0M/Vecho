import { Component, inject } from '@angular/core';
import { IconComponent } from './icons';
import { ToastService } from '../services/toast.service';
import { NgClass } from '@angular/common';

@Component({
    selector: 'app-toast-container',
    standalone: true,
    imports: [IconComponent, NgClass],
    template: `
    <div class="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      @for (toast of toastService.toasts(); track toast.id) {
        <div 
          class="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-md min-w-[320px] max-w-md animate-fade-in"
          [class]="getToastClass(toast.type)">
          
          <!-- Icon -->
          <div class="mt-0.5 shrink-0">
            @switch (toast.type) {
              @case ('success') {
                <div class="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <app-icon name="check" [size]="14" class="text-emerald-600 dark:text-emerald-400"></app-icon>
                </div>
              }
              @case ('error') {
                <div class="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                  <app-icon name="x" [size]="14" class="text-red-600 dark:text-red-400"></app-icon>
                </div>
              }
              @case ('warning') {
                <div class="w-5 h-5 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <app-icon name="alert-triangle" [size]="14" class="text-orange-600 dark:text-orange-400"></app-icon>
                </div>
              }
              @case ('info') {
                <div class="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <app-icon name="info" [size]="14" class="text-blue-600 dark:text-blue-400"></app-icon>
                </div>
              }
            }
          </div>

          <!-- Message -->
          <div class="flex-1 text-sm font-medium pt-0.5">
            {{ toast.message }}
          </div>

          <!-- Close Button -->
          <button 
            (click)="toastService.dismiss(toast.id)"
            class="shrink-0 p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors btn-press">
            <app-icon name="x" [size]="14" class="text-zinc-500"></app-icon>
          </button>
        </div>
      }
    </div>
  `
})
export class ToastContainerComponent {
    toastService = inject(ToastService);

    getToastClass(type: string): string {
        const base = "border ";
        switch (type) {
            case 'success':
                return base + "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100";
            case 'error':
                return base + "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100";
            case 'warning':
                return base + "bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800 text-orange-900 dark:text-orange-100";
            case 'info':
                return base + "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100";
            default:
                return base + "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100";
        }
    }
}
