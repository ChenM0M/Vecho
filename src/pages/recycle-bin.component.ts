import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';
import { StateService } from '../services/state.service';
import type { DeletedItem } from '../types';

@Component({
  selector: 'app-recycle-bin',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="h-full flex flex-col bg-white dark:bg-[#0c0c0e] transition-colors duration-300 page-enter">
      <div class="px-10 py-8 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <h1 class="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tighter">{{ config.t().recycle.title }}</h1>
            <span class="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-500">{{ filtered().length }} {{ config.t().recycle.misc.items }}</span>
          </div>
          <p class="text-zinc-400 text-xs pl-0.5">{{ config.t().recycle.desc }}</p>
        </div>

        <div class="flex items-center gap-3">
          <div class="relative group">
            <app-icon name="search" [size]="16" class="absolute left-3 top-2.5 text-zinc-400 group-focus-within:text-zinc-800 dark:group-focus-within:text-zinc-200 transition-colors"></app-icon>
            <input
              type="text"
              [(ngModel)]="queryValue"
              (ngModelChange)="query.set($event)"
              [placeholder]="config.t().recycle.search"
              class="pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm w-72 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10 focus:border-zinc-400 dark:focus:border-zinc-600 transition-all text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 shadow-sm"
            />
          </div>

          <button
            (click)="restoreAll()"
            [disabled]="filtered().length === 0"
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <app-icon name="rotate-cw" [size]="14"></app-icon>
            {{ config.t().recycle.restoreAll }}
          </button>

          <button
            (click)="emptyTrash()"
            [disabled]="filtered().length === 0"
            class="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors btn-press disabled:opacity-40 disabled:hover:bg-red-50"
          >
            <app-icon name="trash" [size]="14"></app-icon>
            {{ config.t().recycle.empty }}
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-10">
        @if (filtered().length === 0) {
          <div class="h-[60vh] flex flex-col items-center justify-center text-zinc-400">
            <div class="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center mb-4">
              <app-icon name="trash" [size]="22" class="opacity-60"></app-icon>
            </div>
            <div class="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{{ config.t().recycle.emptyStateTitle }}</div>
            <div class="text-xs text-zinc-500 mt-1">{{ config.t().recycle.emptyStateDesc }}</div>
          </div>
        } @else {
          <div class="border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm">
            <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
              @for (item of filtered(); track item.id) {
                <div class="group flex items-center gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
                  <div class="w-12 h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0 border border-zinc-200/50 dark:border-zinc-700/50 overflow-hidden">
                    @if (item.preview) {
                      <img [src]="item.preview" class="w-full h-full object-cover" />
                    } @else {
                      <app-icon [name]="item.type === 'media' ? 'video' : item.type === 'workflow' ? 'git-merge' : 'folder'" [size]="20"></app-icon>
                    }
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">{{ item.name }}</div>
                      <span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase tracking-wide">{{ typeLabel(item.type) }}</span>
                    </div>
                    <div class="text-[11px] text-zinc-500 mt-1">
                      {{ deletedAgoLabel(item.deletedAt) }}
                    </div>
                  </div>

                  <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button (click)="restore(item.id)" class="p-2 rounded-lg hover:bg-white dark:hover:bg-zinc-700 text-zinc-400 hover:text-green-600 transition-colors shadow-sm ring-1 ring-zinc-200 dark:ring-transparent" [title]="config.t().recycle.actions.restore">
                      <app-icon name="rotate-cw" [size]="16"></app-icon>
                    </button>
                    <button (click)="deleteForever(item.id)" class="p-2 rounded-lg hover:bg-white dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors shadow-sm ring-1 ring-zinc-200 dark:ring-transparent" [title]="config.t().recycle.actions.deleteForever">
                      <app-icon name="x" [size]="16"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `
})
export class RecycleBinComponent {
  config = inject(ConfigService);
  state = inject(StateService);

  query = signal('');
  queryValue = '';

  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const items = [...this.state.deletedItems()];
    items.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    if (!q) return items;
    return items.filter(i => (i.name || '').toLowerCase().includes(q));
  });

  restore(id: string) {
    this.state.restoreFromTrash(id);
  }

  deleteForever(id: string) {
    this.state.permanentlyDelete(id);
  }

  restoreAll() {
    const ids = this.filtered().map(i => i.id);
    for (const id of ids) this.state.restoreFromTrash(id);
  }

  emptyTrash() {
    this.state.emptyTrash();
  }

  typeLabel(type: DeletedItem['type']): string {
    if (this.config.lang() === 'zh') {
      if (type === 'media') return '媒体';
      if (type === 'workflow') return '工作流';
      return '文件夹';
    }
    return type;
  }

  deletedAgoLabel(iso: string): string {
    const t = this.config.t();
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = Date.now();
    const diffDays = Math.max(0, Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24)));
    return t.recycle.deletedAgo(diffDays);
  }
}
