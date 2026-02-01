import { Component, inject, signal } from '@angular/core';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';
import { NgClass } from '@angular/common';

@Component({
   selector: 'app-apps',
   standalone: true,
   imports: [IconComponent, NgClass],
   template: `
    <div class="flex h-full bg-white dark:bg-[#0c0c0e] transition-colors duration-300">
       <!-- Tools Sidebar (Flat) -->
       <div class="w-64 flex flex-col p-8 border-r border-zinc-100 dark:border-zinc-800">
           <h3 class="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-6">{{ config.t().apps.tools }}</h3>
           
           <div class="space-y-1">
              <button class="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
                 <app-icon name="music" [size]="16"></app-icon>
                 {{ config.t().apps.stem }}
              </button>
              <button class="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 hover:text-zinc-900 dark:hover:text-zinc-200">
                 <app-icon name="mic" [size]="16"></app-icon>
                 {{ config.t().apps.denoise }}
              </button>
              <button class="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 hover:text-zinc-900 dark:hover:text-zinc-200">
                 <app-icon name="languages" [size]="16"></app-icon>
                 {{ config.t().apps.tts }}
              </button>
           </div>

          <div class="mt-auto">
              <div class="flex items-center gap-2 mb-4">
                 <app-icon name="cpu" [size]="14" class="text-zinc-400"></app-icon>
                 <span class="text-xs font-bold text-zinc-500 uppercase tracking-wider">{{ config.t().apps.systemStatus }}</span>
              </div>
              
              <div class="space-y-4">
                 <div>
                    <div class="flex justify-between text-[10px] text-zinc-500 mb-1.5 font-medium">
                      <span>{{ config.t().apps.gpuHelper }}</span>
                      <span class="text-green-600 dark:text-green-400">{{ config.t().apps.idle }}</span>
                    </div>
                    <div class="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                       <div class="h-full bg-green-500 w-[5%] rounded-full"></div>
                    </div>
                 </div>
                 <div>
                    <div class="flex justify-between text-[10px] text-zinc-500 mb-1.5 font-medium">
                      <span>{{ config.t().apps.modelCache }}</span>
                      <span class="text-zinc-700 dark:text-zinc-300">2.4 GB</span>
                    </div>
                   <div class="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div class="h-full bg-zinc-300 dark:bg-zinc-600 w-[40%] rounded-full"></div>
                   </div>
                </div>
             </div>
          </div>
       </div>

       <!-- Workspace (Flat) -->
       <div class="flex-1 flex flex-col overflow-hidden">
          
          <div class="px-10 py-8 flex items-end justify-between shrink-0">
             <div>
                <h1 class="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tighter mb-2">{{ config.t().apps.stemTitle }}</h1>
                <p class="text-zinc-500 text-sm max-w-lg leading-relaxed">{{ config.t().apps.stemDesc }}</p>
             </div>
             <button class="p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
                <app-icon name="settings" [size]="20"></app-icon>
             </button>
          </div>

          <div class="flex-1 overflow-y-auto px-10 pb-10">
             <div class="max-w-4xl space-y-12">
                
                <!-- Drop Zone (Minimal) -->
                <div class="group relative rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 p-12 flex flex-col items-center justify-center text-center transition-all hover:bg-white dark:hover:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 cursor-pointer">
                   <div class="mb-4 p-4 bg-white dark:bg-zinc-800 rounded-full shadow-sm group-hover:scale-110 transition-transform text-zinc-400 group-hover:text-blue-500 px-4">
                       <app-icon name="music" [size]="28" strokeWidth="1.5"></app-icon>
                   </div>
                   <h3 class="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-2">{{ config.t().apps.dropTitle }}</h3>
                   <p class="text-xs text-zinc-500 max-w-sm leading-relaxed">{{ config.t().apps.dropDesc }}</p>
                </div>

                <!-- Recent Jobs -->
                <div>
                   <div class="flex items-center justify-between mb-6 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                      <h3 class="text-xs font-bold text-zinc-400 uppercase tracking-widest">{{ config.t().apps.recentJobs }}</h3>
                      <button class="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors">{{ config.t().apps.clearHistory }}</button>
                   </div>
                   
                   <div class="space-y-2">
                      <!-- Item 1: Processing -->
                      <div class="flex items-center gap-5 p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group">
                         <div class="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500 shrink-0">
                            <app-icon name="music" [size]="18"></app-icon>
                         </div>
                         <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-3 mb-1">
                               <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">Podcast_Ep42_Raw.wav</p>
                               <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider animate-pulse">{{ config.t().apps.processing }}</span>
                            </div>
                            <div class="w-64 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                               <div class="h-full bg-blue-500 w-[45%] rounded-full relative overflow-hidden">
                                  <div class="absolute inset-0 bg-white/30 animate-shimmer"></div>
                               </div>
                            </div>
                         </div>
                         <button class="opacity-0 group-hover:opacity-100 p-2 text-zinc-400 hover:text-red-500 transition-all">
                            <app-icon name="x" [size]="16"></app-icon>
                         </button>
                      </div>

                      <!-- Item 2: Completed -->
                      <div class="flex items-center gap-5 p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group">
                         <div class="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 shrink-0">
                            <app-icon name="check-square" [size]="18"></app-icon>
                         </div>
                         <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-3 mb-1">
                               <p class="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">Demo_Song_Mix.mp3</p>
                               <span class="text-[10px] text-zinc-400 font-mono">2 mins ago</span>
                            </div>
                            <div class="flex items-center gap-3">
                               <span class="text-[10px] font-bold text-green-600 dark:text-green-500 uppercase tracking-wider">{{ config.t().apps.completed }}</span>
                                <span class="text-[10px] text-zinc-400 border-l border-zinc-200 dark:border-zinc-700 pl-3">{{ config.t().apps.separated }} {{ config.lang() === 'zh' ? '人声、鼓、其他' : 'Vocals, Drums, Other' }}</span>
                            </div>
                         </div>
                         <div class="opacity-0 group-hover:opacity-100 flex items-center gap-2">
                            <button class="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" [title]="config.t().apps.openFolder">
                               <app-icon name="folder" [size]="16"></app-icon>
                            </button>
                            <button class="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" [title]="config.t().apps.download">
                               <app-icon name="download" [size]="16"></app-icon>
                            </button>
                         </div>
                      </div>

                   </div>
                </div>

             </div>
          </div>
       </div>
    </div>
   `
})
export class AppsComponent {
   config = inject(ConfigService);
}
