import { Component, inject } from '@angular/core';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';

@Component({
  selector: 'app-notes',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="p-10 h-full flex flex-col bg-[#fafafa] dark:bg-[#09090b] transition-colors duration-300 page-enter">
       <div class="flex justify-between items-center mb-10">
          <div class="flex gap-4">
             <div class="relative group">
                <app-icon name="search" [size]="16" class="absolute left-3 top-2.5 text-zinc-400 group-focus-within:text-zinc-800 dark:group-focus-within:text-zinc-200 transition-colors"></app-icon>
                <input type="text" [placeholder]="config.t().notes.search" class="pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm w-80 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10 focus:border-zinc-400 dark:focus:border-zinc-600 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-600 text-zinc-800 dark:text-zinc-200 shadow-sm">
             </div>
             <button class="flex items-center gap-2 px-5 py-2.5 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm font-bold text-zinc-600 dark:text-zinc-400 hover:bg-white dark:hover:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all bg-white/50 dark:bg-zinc-900/50 shadow-sm btn-press">
                <app-icon name="rotate-cw" [size]="14"></app-icon> {{ config.t().notes.lastModified }}
             </button>
          </div>
          <div class="flex gap-2 p-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl border border-zinc-200/50 dark:border-zinc-700/50">
             <button class="p-2 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg shadow-sm transition-all btn-press">
                <app-icon name="layout-grid" [size]="18"></app-icon>
             </button>
             <button class="p-2 hover:bg-white/50 dark:hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg transition-colors btn-press">
                <app-icon name="layout-list" [size]="18"></app-icon>
             </button>
          </div>
       </div>

       <div class="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl m-4 bg-zinc-50/50 dark:bg-zinc-900/20">
           <div class="w-20 h-20 bg-white dark:bg-zinc-800 rounded-full flex items-center justify-center mb-6 text-zinc-300 dark:text-zinc-600 shadow-sm ring-1 ring-zinc-900/5 dark:ring-white/5">
              <app-icon name="file-text" [size]="40"></app-icon>
           </div>
           <span class="text-base font-bold text-zinc-500 dark:text-zinc-400">{{ config.t().notes.emptyTitle }}</span>
           <button class="mt-6 text-white bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 px-6 py-2.5 rounded-xl text-sm font-bold shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all btn-press">{{ config.t().notes.create }}</button>
       </div>
    </div>
  `
})
export class NotesComponent {
  config = inject(ConfigService);
}