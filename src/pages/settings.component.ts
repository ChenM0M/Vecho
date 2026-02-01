import { Component, signal, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../components/icons';
import { NgClass } from '@angular/common';
import { ConfigService } from '../services/config.service';
import { StateService } from '../services/state.service';
import type { AppSettings } from '../types';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [IconComponent, NgClass, FormsModule],
  template: `
    <!-- Backdrop -->
    <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 dark:bg-black/50 backdrop-blur-sm animate-fade-in" aria-labelledby="settings-modal" role="dialog" aria-modal="true">
      
      <div (click)="close()" class="absolute inset-0"></div>
      
      <!-- Modal Window: Cleaner radius, sharper borders, New Animation Class -->
      <div class="relative bg-white dark:bg-[#0c0c0e] rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-modal-enter z-10">

        <!-- Sidebar -->
        <div class="w-60 bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col py-6">
          <div class="px-5 mb-6">
            <h2 class="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
              {{ config.t().settings.title }}
            </h2>
          </div>
          <nav class="flex-1 overflow-y-auto px-3 space-y-0.5">
            @for(item of menuItems; track item.id) {
              <button
                (click)="activeSection.set(item.id)"
                class="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-lg transition-all text-left btn-press"
                [class]="activeSection() === item.id ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm ring-1 ring-zinc-200 dark:ring-zinc-700' : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'">
                
                <app-icon [name]="item.icon" [size]="14"></app-icon>
                {{ getLabel(item.id) }}
                @if(item.badge) {
                  <span class="ml-auto bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[9px] font-bold px-1.5 py-0.5 rounded">{{item.badge}}</span>
                }
              </button>
            }
          </nav>
        </div>

        <!-- Content -->
        <div class="flex-1 flex flex-col bg-white dark:bg-[#0c0c0e] overflow-hidden">
           <!-- Header -->
           <div class="h-14 flex items-center justify-between px-8 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
             <div class="flex items-center text-sm">
                <span class="text-zinc-500 font-medium">{{ config.t().settings.config }}</span>
                <span class="mx-2 text-zinc-300">/</span>
                <span class="text-zinc-900 dark:text-zinc-100 font-semibold">{{ getActiveLabel() }}</span>
             </div>
             <button (click)="close()" class="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors btn-press">
                <app-icon name="x" [size]="18"></app-icon>
             </button>
           </div>

           <!-- Scroll Area -->
           <div class="flex-1 overflow-y-auto p-8">
             
              <!-- SECTION: General -->
              @if(activeSection() === 'general') {
                <div class="space-y-8 max-w-xl animate-fade-in">
                   <section>
                     <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-4">{{ config.t().settings.appearance }}</label>
                    <div class="grid grid-cols-2 gap-4">
                       <button (click)="config.theme.set('light')" class="border rounded-lg p-3 flex items-center gap-3 transition-all text-left btn-press"
                         [class]="config.theme() === 'light' ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'">
                          <div class="w-8 h-8 rounded-full bg-white border border-zinc-200 shadow-sm flex items-center justify-center text-zinc-600"><app-icon name="sun" [size]="16"></app-icon></div>
                          <div>
                             <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">{{ config.t().settings.general.light }}</div>
                             <div class="text-[10px] text-zinc-500">{{ config.t().settings.general.lightDesc }}</div>
                          </div>
                       </button>
                       <button (click)="config.theme.set('dark')" class="border rounded-lg p-3 flex items-center gap-3 transition-all text-left btn-press"
                         [class]="config.theme() === 'dark' ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/50 dark:bg-blue-900/10' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'">
                          <div class="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200"><app-icon name="moon" [size]="16"></app-icon></div>
                          <div>
                             <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">{{ config.t().settings.general.dark }}</div>
                             <div class="text-[10px] text-zinc-500">{{ config.t().settings.general.darkDesc }}</div>
                          </div>
                       </button>
                    </div>
                   </section>
                </div>
              }

              <!-- SECTION: Workspace -->
              @if(activeSection() === 'workspace') {
                <div class="space-y-8 max-w-xl animate-fade-in">
                  <section class="space-y-4">
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-100">{{ getActiveLabel() }}</label>

                    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
                      <div class="flex items-center justify-between">
                        <div>
                          <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">自动保存</div>
                          <div class="text-[11px] text-zinc-500">在桌面端会保存到本地工作区</div>
                        </div>
                        <button
                          class="h-8 px-3 rounded-lg border text-xs font-bold transition-colors"
                          [class]="settings().workspace.autoSave ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white' : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'"
                          (click)="patchWorkspace({ autoSave: !settings().workspace.autoSave })"
                        >
                          {{ settings().workspace.autoSave ? '已开启' : '已关闭' }}
                        </button>
                      </div>

                      <div class="space-y-2">
                        <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">默认工作区路径</div>
                        <input
                          class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                          [ngModel]="settings().workspace.defaultLocation"
                          (ngModelChange)="patchWorkspace({ defaultLocation: $event })"
                          placeholder="/workspace"
                        />
                        <div class="text-[11px] text-zinc-500">仅用于记录偏好；实际文件会由导入/下载流程决定</div>
                      </div>
                    </div>
                  </section>
                </div>
              }

              <!-- SECTION: Models / BYOK -->
              @if(activeSection() === 'models') {
                <div class="space-y-8 max-w-2xl animate-fade-in">
                  <section class="space-y-4">
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-100">转写</label>
                    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-zinc-500">引擎</div>
                           <select
                             class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                             [ngModel]="settings().transcription.engine"
                             (ngModelChange)="patchTranscription({ engine: $event })"
                           >
                             <option value="local_sherpa_onnx">本地 SenseVoice（sherpa-onnx）</option>
                             <option value="local_whisper_cpp">本地 Whisper（whisper.cpp）</option>
                             <option value="openai_compatible">云端 OpenAI 兼容</option>
                           </select>
                         </div>
                         <div class="space-y-2">
                           <div class="text-[11px] font-semibold text-zinc-500">本地模型</div>
                           <div class="h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 flex items-center text-sm text-zinc-700 dark:text-zinc-200">
                             @if (settings().transcription.engine === 'local_sherpa_onnx') {
                               SenseVoice Small（Float）
                             } @else if (settings().transcription.engine === 'local_whisper_cpp') {
                               Whisper large-v3-turbo（q5_0）
                             } @else {
                               -
                             }
                           </div>
                           @if (settings().transcription.engine === 'local_sherpa_onnx') {
                             <div class="text-[11px] text-zinc-500">首次使用会下载约 900MB 模型（一次性）。</div>
                           } @else if (settings().transcription.engine === 'local_whisper_cpp') {
                             <div class="text-[11px] text-zinc-500">首次使用会下载约 547MB 模型（一次性）。</div>
                           }
                         </div>
                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-zinc-500">语言</div>
                          <select
                            class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                            [ngModel]="settings().transcription.language"
                            (ngModelChange)="patchTranscription({ language: $event })"
                          >
                            <option value="auto">auto</option>
                            <option value="zh">zh</option>
                            <option value="en">en</option>
                            <option value="ja">ja</option>
                            <option value="ko">ko</option>
                            <option value="yue">yue</option>
                          </select>
                        </div>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-zinc-500">本地加速</div>
                           <select
                             class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                             [ngModel]="settings().transcription.localAccelerator"
                             (ngModelChange)="patchTranscription({ localAccelerator: $event })"
                           >
                             <option value="auto">自动</option>
                             <option value="cuda">CUDA（NVIDIA）</option>
                             <option value="cpu">仅 CPU</option>
                           </select>
                           <div class="text-[11px] text-zinc-500">自动/选择 CUDA：检测到 NVIDIA 驱动时会自动下载运行库（一次性）。</div>
                         </div>
                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-zinc-500">线程数</div>
                          <input
                            class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                            type="number"
                            min="0"
                            max="64"
                            [ngModel]="settings().transcription.numThreads"
                            (ngModelChange)="patchTranscription({ numThreads: +$event || 0 })"
                            placeholder="0"
                          />
                          <div class="text-[11px] text-zinc-500">0 表示自动（推荐）。</div>
                        </div>
                      </div>

                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-zinc-500">标点/数字（ITN）</div>
                          <div class="flex items-center justify-between">
                            <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">启用 ITN</div>
                            <button
                              class="h-8 px-3 rounded-lg border text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              [disabled]="settings().transcription.engine !== 'local_sherpa_onnx'"
                              [class]="settings().transcription.useItn ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white' : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800'"
                              (click)="patchTranscription({ useItn: !settings().transcription.useItn })"
                            >
                              {{ settings().transcription.useItn ? '已开启' : '已关闭' }}
                            </button>
                          </div>
                          <div class="text-[11px] text-zinc-500">开启后更容易输出中文标点与数字（推荐）。</div>
                        </div>
                      </div>

                      @if (settings().transcription.engine === 'openai_compatible') {
                        <div class="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                          <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">OpenAI 兼容（转写）</div>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Base URL</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().transcription.openai.baseUrl"
                                (ngModelChange)="patchTranscriptionOpenAI({ baseUrl: $event })"
                                placeholder="https://api.openai.com/v1"
                              />
                            </div>
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Model</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().transcription.openai.model"
                                (ngModelChange)="patchTranscriptionOpenAI({ model: $event })"
                                placeholder="whisper-1"
                              />
                            </div>
                            <div class="sm:col-span-2 space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">API Key</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                type="password"
                                [ngModel]="settings().transcription.openai.apiKey"
                                (ngModelChange)="patchTranscriptionOpenAI({ apiKey: $event })"
                                placeholder="sk-..."
                              />
                              <div class="text-[11px] text-zinc-500">也可填写本地兼容服务（例如 localhost 代理）</div>
                            </div>
                          </div>
                        </div>
                      }
                    </div>
                  </section>

                  <section class="space-y-4">
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-100">AI（总结 / 对话）</label>
                    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div class="space-y-2">
                          <div class="text-[11px] font-semibold text-zinc-500">Provider</div>
                          <select
                            class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                            [ngModel]="settings().ai.provider"
                            (ngModelChange)="patchAI({ provider: $event })"
                          >
                            <option value="openai_compatible">OpenAI 兼容</option>
                            <option value="gemini">Gemini</option>
                          </select>
                        </div>
                      </div>

                      @if (settings().ai.provider === 'openai_compatible') {
                        <div class="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                          <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">OpenAI 兼容（对话 / 总结）</div>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Base URL</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().ai.openai.baseUrl"
                                (ngModelChange)="patchAIOpenAI({ baseUrl: $event })"
                                placeholder="https://api.openai.com/v1"
                              />
                            </div>
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">API Key</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                type="password"
                                [ngModel]="settings().ai.openai.apiKey"
                                (ngModelChange)="patchAIOpenAI({ apiKey: $event })"
                                placeholder="sk-..."
                              />
                            </div>
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Chat Model</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().ai.openai.chatModel"
                                (ngModelChange)="patchAIOpenAI({ chatModel: $event })"
                                placeholder="gpt-4o-mini"
                              />
                            </div>
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Summary Model</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().ai.openai.summaryModel"
                                (ngModelChange)="patchAIOpenAI({ summaryModel: $event })"
                                placeholder="gpt-4o-mini"
                              />
                            </div>
                          </div>
                        </div>
                      }

                      @if (settings().ai.provider === 'gemini') {
                        <div class="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                          <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Gemini</div>
                          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Base URL</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().ai.gemini.baseUrl"
                                (ngModelChange)="patchAIGemini({ baseUrl: $event })"
                                placeholder="https://generativelanguage.googleapis.com"
                              />
                            </div>
                            <div class="space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">Model</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                [ngModel]="settings().ai.gemini.model"
                                (ngModelChange)="patchAIGemini({ model: $event })"
                                placeholder="gemini-1.5-flash"
                              />
                            </div>
                            <div class="sm:col-span-2 space-y-2">
                              <div class="text-[11px] font-semibold text-zinc-500">API Key</div>
                              <input
                                class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                type="password"
                                [ngModel]="settings().ai.gemini.apiKey"
                                (ngModelChange)="patchAIGemini({ apiKey: $event })"
                              />
                            </div>
                          </div>
                        </div>
                      }

                      <div class="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-3">
                        <div class="flex items-center justify-between gap-3">
                          <div class="text-xs font-semibold text-zinc-900 dark:text-zinc-100">总结 Prompt 模板</div>
                          <button
                            class="h-8 px-3 rounded-md text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors btn-press"
                            (click)="addSummaryPrompt()"
                          >
                            新增模板
                          </button>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div class="space-y-2">
                            <div class="text-[11px] font-semibold text-zinc-500">默认模板</div>
                            <select
                              class="w-full h-10 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                              [ngModel]="settings().ai.defaultSummaryPromptId"
                              (ngModelChange)="setDefaultSummaryPrompt($event)"
                            >
                              @for (p of settings().ai.summaryPrompts; track p.id) {
                                <option [value]="p.id">{{ p.name }}</option>
                              }
                            </select>
                            <div class="text-[11px] text-zinc-500">提示词支持变量：{{'{{input}}'}}、{{'{{inputType}}'}}。</div>
                          </div>
                        </div>

                        <div class="space-y-3">
                          @for (p of settings().ai.summaryPrompts; track p.id) {
                            <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 space-y-3">
                              <div class="flex items-center justify-between gap-3">
                                <input
                                  class="flex-1 h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm"
                                  [ngModel]="p.name"
                                  (ngModelChange)="updateSummaryPrompt(p.id, { name: $event })"
                                  placeholder="模板名称"
                                />
                                <button
                                  class="h-9 px-3 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                                  (click)="setDefaultSummaryPrompt(p.id)"
                                  [disabled]="settings().ai.defaultSummaryPromptId === p.id"
                                >
                                  {{ settings().ai.defaultSummaryPromptId === p.id ? '默认' : '设为默认' }}
                                </button>
                                <button
                                  class="h-9 w-9 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                  (click)="deleteSummaryPrompt(p.id)"
                                  [disabled]="settings().ai.summaryPrompts.length <= 1"
                                  title="删除"
                                >
                                  <app-icon name="trash" [size]="16"></app-icon>
                                </button>
                              </div>

                              <textarea
                                class="w-full min-h-[160px] p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-mono"
                                [ngModel]="p.template"
                                (ngModelChange)="updateSummaryPrompt(p.id, { template: $event })"
                                spellcheck="false"
                              ></textarea>
                            </div>
                          }
                        </div>
                      </div>

                    </div>
                  </section>
                </div>
              }
              
              <!-- Other sections (Placeholder logic for brevity, reusing structure) -->
              @if(activeSection() !== 'general' && activeSection() !== 'workspace' && activeSection() !== 'models') {
                 <div class="flex flex-col items-center justify-center h-64 text-zinc-400 animate-fade-in">
                    <app-icon name="settings" [size]="32" class="mb-3 opacity-20"></app-icon>
                    <p class="text-sm">{{ config.t().settings.placeholder }}</p>
                 </div>
              }

           </div>
        </div>
      </div>
    </div>
  `
})
export class SettingsComponent {
  config = inject(ConfigService);
  private state = inject(StateService);

  settings = computed(() => this.state.settings());
  activeSection = signal('general');

  
  menuItems = [
    { id: 'general', icon: 'settings' },
    { id: 'workspace', icon: 'box' },
    { id: 'models', icon: 'cpu' },
    { id: 'plugins', icon: 'layout-grid', badge: '3' },
  ];

  getLabel(id: string): string {
    return (this.config.t().settings.menu as any)[id] || id; 
  }

  getActiveLabel() {
    return this.getLabel(this.activeSection());
  }

  close() {
    this.config.settingsOpen.set(false);
  }

  patchWorkspace(patch: Partial<AppSettings['workspace']>): void {
    this.state.updateSettings((s) => ({
      ...s,
      workspace: { ...s.workspace, ...patch },
    }));
  }

  patchTranscription(patch: Partial<AppSettings['transcription']>): void {
    this.state.updateSettings((s) => ({
      ...s,
      transcription: { ...s.transcription, ...patch },
    }));
  }

  patchTranscriptionOpenAI(patch: Partial<AppSettings['transcription']['openai']>): void {
    this.state.updateSettings((s) => ({
      ...s,
      transcription: {
        ...s.transcription,
        openai: { ...s.transcription.openai, ...patch },
      },
    }));
  }

  patchAI(patch: Partial<AppSettings['ai']>): void {
    this.state.updateSettings((s) => ({
      ...s,
      ai: { ...s.ai, ...patch },
    }));
  }

  patchAIOpenAI(patch: Partial<AppSettings['ai']['openai']>): void {
    this.state.updateSettings((s) => ({
      ...s,
      ai: {
        ...s.ai,
        openai: { ...s.ai.openai, ...patch },
      }
    }));
  }

  patchAIGemini(patch: Partial<AppSettings['ai']['gemini']>): void {
    this.state.updateSettings((s) => ({
      ...s,
      ai: {
        ...s.ai,
        gemini: { ...s.ai.gemini, ...patch },
      }
    }));
  }

  setDefaultSummaryPrompt(id: string): void {
    const wanted = (id || '').trim();
    if (!wanted) return;
    this.state.updateSettings((s) => {
      const list = s.ai.summaryPrompts || [];
      if (!list.some(p => p.id === wanted)) return s;
      return {
        ...s,
        ai: { ...s.ai, defaultSummaryPromptId: wanted },
      };
    });
  }

  addSummaryPrompt(): void {
    this.state.updateSettings((s) => {
      const id = `sum-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const next = [...(s.ai.summaryPrompts || []), { id, name: '新模板', template: '' }];
      return {
        ...s,
        ai: {
          ...s.ai,
          summaryPrompts: next,
          defaultSummaryPromptId: s.ai.defaultSummaryPromptId || next[0].id,
        },
      };
    });
  }

  updateSummaryPrompt(id: string, patch: Partial<{ name: string; template: string }>): void {
    const pid = (id || '').trim();
    if (!pid) return;
    this.state.updateSettings((s) => {
      const list = s.ai.summaryPrompts || [];
      const idx = list.findIndex(p => p.id === pid);
      if (idx < 0) return s;
      const cur = list[idx];
      const updated = { ...cur, ...patch };
      const next = [...list];
      next[idx] = updated;
      return {
        ...s,
        ai: { ...s.ai, summaryPrompts: next },
      };
    });
  }

  deleteSummaryPrompt(id: string): void {
    const pid = (id || '').trim();
    if (!pid) return;
    this.state.updateSettings((s) => {
      const list = s.ai.summaryPrompts || [];
      if (list.length <= 1) return s;
      const next = list.filter(p => p.id !== pid);
      if (next.length === list.length) return s;
      let def = s.ai.defaultSummaryPromptId;
      if (!next.some(p => p.id === def)) def = next[0]?.id || '';
      return {
        ...s,
        ai: { ...s.ai, summaryPrompts: next, defaultSummaryPromptId: def },
      };
    });
  }
}
