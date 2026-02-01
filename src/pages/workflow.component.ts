import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal, computed } from '@angular/core';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-workflow',
  standalone: true,
  imports: [CommonModule, IconComponent, NgClass],
  styles: [`
    /* Custom scrollbar for steps */
    .no-scrollbar::-webkit-scrollbar { display: none; }
  `],
  template: `
    <div class="h-full w-full bg-white dark:bg-[#0c0c0e] relative overflow-hidden flex flex-col page-enter">
      
       @if (view() === 'list' || !activeItem()) {
         <!-- List View -->
         <div class="h-full flex flex-col p-8 md:p-12">
           <div class="flex justify-between items-end mb-10">
              <div>
                 <h1 class="text-3xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tighter mb-2">{{ config.t().workflow.list.title }}</h1>
                 <p class="text-zinc-500 font-medium">{{ config.t().workflow.desc }}</p>
              </div>
              <div class="flex items-center gap-4">
                  <!-- View Switcher -->
                   <div class="flex gap-1 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg">
                       <button (click)="displayMode.set('table')" class="p-2 rounded-md transition-all shadow-sm" [class.bg-white]="displayMode() === 'table'" [class.dark:bg-zinc-800]="displayMode() === 'table'" [class.text-zinc-900]="displayMode() === 'table'" [class.dark:text-zinc-100]="displayMode() === 'table'" [class.text-zinc-400]="displayMode() !== 'table'"><app-icon name="layout-list" [size]="16"></app-icon></button>
                       <button (click)="displayMode.set('cards')" class="p-2 rounded-md transition-all shadow-sm" [class.bg-white]="displayMode() === 'cards'" [class.dark:bg-zinc-800]="displayMode() === 'cards'" [class.text-zinc-900]="displayMode() === 'cards'" [class.dark:text-zinc-100]="displayMode() === 'cards'" [class.text-zinc-400]="displayMode() !== 'cards'"><app-icon name="grid" [size]="16"></app-icon></button>
                   </div>
                  <!-- Primary Action -->
                  <button class="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-5 py-2.5 rounded-full text-xs font-bold shadow hover:opacity-90 transition-opacity btn-press flex items-center gap-2">
                     <app-icon name="plus" [size]="16"></app-icon> {{ config.t().workflow.list.create }}
                  </button>
              </div>
           </div>

           <!-- Search (Minimal) -->
           <div class="mb-8 relative group max-w-lg">
               <app-icon name="search" [size]="18" class="absolute left-0 top-1/2 -translate-y-1/2 text-zinc-400"></app-icon>
               <input type="text" [placeholder]="config.t().workflow.list.search" class="pl-8 pr-4 py-2 bg-transparent border-b border-zinc-200 dark:border-zinc-800 text-sm w-full focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-100 transition-colors text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400">
           </div>

           @if(displayMode() === 'table') {
            <!-- Table (Flat) -->
            <div class="flex-1 overflow-hidden flex flex-col animate-fade-in">
               <div class="flex items-center text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider pb-4 border-b border-zinc-100 dark:border-zinc-800/50 mb-2">
                   <div class="flex-1">{{ config.t().workflow.list.columns.name }}</div>
                   <div class="w-32">{{ config.t().workflow.list.columns.status }}</div>
                   <div class="w-32">{{ config.t().workflow.list.columns.runs }}</div>
                   <div class="w-48 text-right">{{ config.t().workflow.list.columns.modified }}</div>
               </div>
               
               <div class="overflow-y-auto flex-1 -mx-4 px-4">
                   @for (item of workflows; track item.id) {
                       <div (click)="openEditor(item)" class="flex items-center py-4 border-b border-zinc-50 dark:border-zinc-800/30 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer group rounded-lg px-2 -mx-2">
                           <div class="flex-1 flex items-center gap-4">
                               <div class="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors">
                                   <app-icon name="git-merge" [size]="18"></app-icon>
                               </div>
                               <div>
                                   <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100">{{ item.name }}</div>
                                   <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{{ item.desc }}</div>
                               </div>
                           </div>
                           <div class="w-32">
                               <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
                                   [class]="getStatusTextClass(item.status)">
                                   <span class="w-1.5 h-1.5 rounded-full" [class]="getStatusDotClass(item.status)"></span>
                                   {{ getStatusLabel(item.status) }}
                               </span>
                           </div>
                           <div class="w-32 text-xs font-mono text-zinc-500">{{ item.runs }}</div>
                           <div class="w-48 text-right text-xs text-zinc-500 dark:text-zinc-400 font-medium">{{ item.modified }}</div>
                       </div>
                   }
               </div>
            </div>
           } @else {
             <!-- Cards Grid (Flat) -->
             <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 overflow-y-auto animate-fade-in content-start pb-10">
                @for (item of workflows; track item.id) {
                    <div (click)="openEditor(item)" class="group hover:bg-zinc-50 dark:hover:bg-zinc-900/30 rounded-xl p-4 transition-all cursor-pointer border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800">
                        <div class="flex justify-between items-start mb-4">
                            <div class="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500">
                                <app-icon name="git-merge" [size]="20"></app-icon>
                            </div>
                            <span class="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider" [class]="getStatusTextClass(item.status)">
                                <span class="w-1.5 h-1.5 rounded-full" [class]="getStatusDotClass(item.status)"></span>
                                {{ getStatusLabel(item.status) }}
                            </span>
                        </div>
                        
                        <div class="mb-4">
                            <h3 class="font-bold text-zinc-900 dark:text-zinc-100 mb-1 leading-snug">{{ item.name }}</h3>
                            <p class="text-xs text-zinc-500 dark:text-zinc-400 vecho-clamp-2">{{ item.desc }}</p>
                        </div>

                        <div class="flex items-center justify-between text-[10px] text-zinc-400 font-mono pt-4 border-t border-zinc-100 dark:border-zinc-800/50 group-hover:border-zinc-200 dark:group-hover:border-zinc-700 transition-colors">
                            <span>Runs: {{ item.runs }}</span>
                            <span>{{ item.modified }}</span>
                        </div>
                    </div>
                }
             </div>
           }
        </div>
      } @else {
        <!-- Editor View (Flat & Polished) -->
        <div class="h-full flex flex-col bg-white dark:bg-[#0c0c0e] animate-fade-in">
           <!-- Toolbar -->
           <div class="h-16 flex items-center justify-between px-8 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
              <div class="flex items-center gap-6">
                  <button (click)="view.set('list')" class="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
                     <app-icon name="arrow-left" [size]="18"></app-icon>
                     <span class="text-xs font-bold uppercase tracking-wider">{{ config.t().workflow.back }}</span>
                  </button>
                  <div class="h-4 w-px bg-zinc-200 dark:bg-zinc-800"></div>
                  <div>
                    <h1 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-none">{{ activeItem()?.name }}</h1>
                    <span class="text-[10px] text-zinc-400 font-mono">{{ activeItem()?.id }}</span>
                  </div>
              </div>
              <div class="flex items-center gap-3">
                 <button class="px-4 py-2 rounded-lg text-xs font-bold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors" disabled>
                   保存
                 </button>
                 <button class="px-5 py-2 rounded-full text-xs font-bold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity shadow-sm" disabled>
                   运行
                 </button>
              </div>
           </div>

           <div class="flex-1 min-h-0 flex">
             <!-- Steps Sidebar -->
             <div class="w-[340px] p-6 overflow-y-auto border-r border-zinc-100 dark:border-zinc-800">
               <div class="flex items-center justify-between mb-6">
                  <span class="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Pipeline Steps</span>
                  <button class="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"><app-icon name="plus" [size]="14"></app-icon></button>
               </div>
               
               <div class="relative space-y-3">
                 <!-- Vertical line connecting steps -->
                 <div class="absolute left-[23px] top-6 bottom-6 w-px bg-zinc-200 dark:bg-zinc-800 -z-10"></div>
                 
                 @for (step of steps; track step.id) {
                   <div (click)="activeStepId.set(step.id)"
                     class="group relative flex items-start gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200 border-2"
                     [class.bg-white]="activeStepId() === step.id"
                     [class.dark:bg-zinc-900]="activeStepId() === step.id"
                     [class.border-zinc-900]="activeStepId() === step.id"
                     [class.dark:border-zinc-100]="activeStepId() === step.id"
                     [class.shadow-lg]="activeStepId() === step.id"
                     [class.shadow-zinc-200]="activeStepId() === step.id"
                     [class.dark:shadow-none]="activeStepId() === step.id"
                     [class.border-transparent]="activeStepId() !== step.id"
                     [class.hover:bg-zinc-50]="activeStepId() !== step.id"
                     [class.dark:hover:bg-zinc-900/40]="activeStepId() !== step.id">
                     
                     <!-- Icon Circle -->
                     <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border transition-colors bg-white dark:bg-[#0c0c0e] z-10"
                        [style.margin-top.px]="3"
                        [class.border-transparent]="activeStepId() !== step.id"
                        [class.text-zinc-400]="activeStepId() !== step.id"
                        [class.border-zinc-200]="activeStepId() === step.id"
                        [class.dark:border-zinc-700]="activeStepId() === step.id"
                        [class.text-zinc-900]="activeStepId() === step.id"
                        [class.dark:text-zinc-100]="activeStepId() === step.id">
                         <app-icon [name]="step.icon" [size]="14"></app-icon>
                     </div>
                     
                     <div class="flex-1 min-w-0">
                         <div class="text-sm font-bold leading-tight mb-1" 
                            [class.text-zinc-900]="activeStepId() === step.id"
                            [class.dark:text-zinc-100]="activeStepId() === step.id"
                            [class.text-zinc-500]="activeStepId() !== step.id"
                            [class.dark:text-zinc-400]="activeStepId() !== step.id">{{ step.title }}</div>
                         <div class="text-[11px] leading-normal text-zinc-400 vecho-clamp-2"
                            [class.text-zinc-500]="activeStepId() === step.id"
                            [class.dark:text-zinc-400]="activeStepId() !== step.id">{{ step.desc }}</div>
                     </div>
                   </div>
                 }
               </div>
             </div>

             <!-- Config Panel (Flat with Form) -->
             <div class="flex-1 min-w-0 p-12 overflow-y-auto">
               @if (activeStep()) {
                 <div class="max-w-2xl mx-auto animate-fade-in">
                   <div class="flex items-center gap-4 mb-8">
                     <div class="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-900 dark:text-zinc-100 shadow-sm border border-zinc-200 dark:border-zinc-700">
                        <app-icon [name]="activeStep()!.icon" [size]="24"></app-icon>
                     </div>
                     <div>
                        <h2 class="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">{{ activeStep()!.title }}</h2>
                        <div class="text-xs text-zinc-500 font-mono mt-1">STEP_ID: {{ activeStep()!.id | uppercase }}</div>
                     </div>
                   </div>
                   
                   <!-- Mock Config Form -->
                   <div class="space-y-6">
                      
                      <!-- Channel/Source Input -->
                      <div>
                          <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider mb-2">Input Source</label>
                          <div class="flex gap-2">
                             <div class="relative flex-1">
                                <span class="absolute left-3 top-2.5 text-zinc-400 font-bold text-xs">URL</span>
                                <input type="text" value="https://space.bilibili.com/123456" class="w-full pl-12 pr-4 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 outline-none transition-all">
                             </div>
                             <button class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-xs font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">Test</button>
                          </div>
                          <p class="text-[10px] text-zinc-400 mt-1.5">Supports Bilibili User ID, YouTube Channel ID, or direct playlist URL.</p>
                      </div>

                      <div class="h-px bg-zinc-100 dark:bg-zinc-800 my-6"></div>

                      <!-- Toggles -->
                      <div class="grid grid-cols-2 gap-6">
                          <div class="flex items-start gap-3">
                              <div class="mt-0.5">
                                 <input type="checkbox" checked class="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-zinc-900">
                              </div>
                              <div>
                                  <div class="text-sm font-bold text-zinc-700 dark:text-zinc-200">Auto Download</div>
                                  <div class="text-xs text-zinc-500 mt-0.5">Automatically pull new videos every 24h.</div>
                              </div>
                          </div>
                          <div class="flex items-start gap-3">
                              <div class="mt-0.5">
                                 <input type="checkbox" class="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-zinc-900">
                              </div>
                              <div>
                                  <div class="text-sm font-bold text-zinc-700 dark:text-zinc-200">Skip Shorts</div>
                                  <div class="text-xs text-zinc-500 mt-0.5">Ignore videos under 60 seconds.</div>
                              </div>
                          </div>
                      </div>

                      <div class="h-px bg-zinc-100 dark:bg-zinc-800 my-6"></div>

                      <!-- Advanced -->
                       <div>
                          <label class="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Advanced Config (JSON)</label>
                          <div class="bg-zinc-900 rounded-lg p-4 font-mono text-xs text-zinc-300 overflow-x-auto">
                              <span class="text-purple-400">"filter"</span>: {{ '{' }}<br>
                              &nbsp;&nbsp;<span class="text-blue-400">"min_duration"</span>: 60,<br>
                              &nbsp;&nbsp;<span class="text-blue-400">"whitelist_tags"</span>: [<span class="text-green-400">"Tutorial"</span>, <span class="text-green-400">"Review"</span>]<br>
                              {{ '}' }}
                          </div>
                       </div>

                   </div>
                 </div>
               } @else {
                  <div class="h-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 font-medium">
                    Select a step to configure
                  </div>
                }
              </div>
            </div>
         </div>
       }
    </div>
   `
})
export class WorkflowComponent {
  config = inject(ConfigService);
  view = signal<'list' | 'editor'>('list');
  displayMode = signal<'table' | 'cards'>('table');
  activeItem = signal<any>(null);
  activeStepId = signal<string | null>(null);

  steps = [
    { id: 'source', icon: 'bell', title: '订阅频道', desc: '绑定 B 站 / YouTube 频道，定期检查更新并拉取历史视频列表。' },
    { id: 'ingest', icon: 'download', title: '获取媒体', desc: '按规则下载视频/音频，提取元信息与封面，写入媒体库。' },
    { id: 'transcribe', icon: 'mic', title: '本地转写', desc: '使用本地 Whisper 模型生成转写文本与时间戳段落。' },
    { id: 'translate', icon: 'languages', title: '翻译与润色', desc: '对生肉进行翻译、术语统一、敏感词审查与质量标注。' },
    { id: 'subtitle', icon: 'file-text', title: '字幕生成', desc: '生成 SRT/VTT/ASS 或 CC 文本，并回写到媒体详情页。' },
    { id: 'report', icon: 'bar-chart-2', title: '知识整理', desc: '提炼要点、章节结构、标签与引用片段，输出为 Markdown/网页素材。' },
    { id: 'publish', icon: 'upload-cloud', title: '发布（可选）', desc: '将字幕或内容发布到指定平台，并记录发布状态。' },
  ];

  activeStep = computed(() => {
    const id = this.activeStepId();
    return this.steps.find(s => s.id === id) || null;
  });
  workflows = [
    { id: 1, name: 'Video Upscaling Pipeline', desc: 'Auto-enhance 1080p footage to 4K', status: 'active', runs: 24, modified: '2 hours ago' },
    { id: 2, name: 'Audio Cleaning', desc: 'Denoise and stem separation', status: 'draft', runs: 0, modified: 'Yesterday' },
    { id: 3, name: 'Character Generation', desc: 'Stable Diffusion LoRA pipeline', status: 'active', runs: 156, modified: '3 days ago' },
    { id: 4, name: 'Storyboard Gen v2', desc: 'Script to SVG storyboard', status: 'active', runs: 12, modified: 'Last week' },
    { id: 5, name: 'Legacy Archive', desc: 'Old project migration', status: 'archiving', runs: 890, modified: '2 months ago' },
  ];

  constructor() {
    // When entering editor view (including route-reuse restore), ensure a step is selected.
    effect(() => {
      const inEditor = this.view() === 'editor';
      const hasWorkflow = !!this.activeItem();
      if (!inEditor || !hasWorkflow) return;

      const current = this.activeStepId();
      const exists = current ? this.steps.some(s => s.id === current) : false;
      if (!exists) {
        this.activeStepId.set(this.steps[0]?.id ?? null);
      }
    });
  }

  openEditor(item: any) {
    this.activeItem.set(item);
    this.view.set('editor');
    this.activeStepId.set(this.steps[0]?.id ?? null);
  }

  getStatusTextClass(status: string) {
    switch (status) {
      case 'active': return 'text-emerald-600 dark:text-emerald-400';
      case 'draft': return 'text-zinc-500 dark:text-zinc-400';
      case 'archiving': return 'text-orange-600 dark:text-orange-400';
      default: return '';
    }
  }

  getStatusDotClass(status: string) {
    switch (status) {
      case 'active': return 'bg-emerald-500';
      case 'draft': return 'bg-zinc-400';
      case 'archiving': return 'bg-orange-500';
      default: return '';
    }
  }

  getStatusLabel(status: string) {
    return (this.config.t().workflow.list.status as any)[status] || status;
  }
}
