import { Component, inject, signal } from '@angular/core';
import { IconComponent } from '../components/icons';
import { ConfigService } from '../services/config.service';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [IconComponent, NgClass],
  template: `
    <div class="h-full w-full overflow-y-auto bg-[#fafafa] dark:bg-[#0c0c0e] transition-colors duration-300 page-enter">
      
      <!-- Banner -->
      <div class="h-48 w-full relative overflow-hidden">
        <img src="https://picsum.photos/1920/400" class="w-full h-full object-cover" alt="Cover">
        <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
        <button class="absolute top-4 right-4 bg-black/40 hover:bg-black/60 text-white p-2 rounded-lg backdrop-blur-md transition-colors btn-press border border-white/10">
           <app-icon name="camera" [size]="16"></app-icon>
        </button>
      </div>

      <!-- Content Container -->
      <div class="max-w-4xl mx-auto px-6 pb-12 relative -mt-16">
         
         <!-- Profile Header -->
         <div class="flex flex-col md:flex-row items-end md:items-center gap-6 mb-8">
            <div class="relative group">
               <div class="w-32 h-32 rounded-2xl bg-zinc-200 dark:bg-zinc-800 p-1 shadow-2xl ring-4 ring-white dark:ring-[#0c0c0e] overflow-hidden">
                  <img src="https://picsum.photos/100/100" class="w-full h-full object-cover rounded-xl" alt="Avatar">
               </div>
               <button class="absolute bottom-2 right-2 bg-zinc-900 text-white p-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100 btn-press">
                  <app-icon name="edit-3" [size]="14"></app-icon>
               </button>
            </div>
            
            <div class="flex-1 mb-2">
               <h1 class="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">User Name</h1>
               <div class="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 text-sm mt-1">
                  <app-icon name="mail" [size]="14"></app-icon>
                  <span>user&#64;lumina.ai</span>
                  <span class="mx-1">•</span>
                  <app-icon name="map-pin" [size]="14"></app-icon>
                  <span>San Francisco, CA</span>
               </div>
            </div>

            <div class="flex gap-3 mb-4 md:mb-2">
               <button class="px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-sm font-semibold rounded-lg shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors btn-press flex items-center gap-2">
                  <app-icon name="share-2" [size]="16"></app-icon> Share
               </button>
               <button class="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold rounded-lg shadow-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors btn-press flex items-center gap-2">
                  <app-icon name="edit-3" [size]="16"></app-icon> Edit Profile
               </button>
            </div>
         </div>

         <!-- Tabs & Content -->
         <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
            
            <!-- Sidebar Navigation -->
            <div class="md:col-span-1 space-y-1 stagger-enter">
               @for(tab of tabs; track tab.id) {
                  <button (click)="activeTab.set(tab.id)"
                     class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all btn-press text-left"
                     [class]="activeTab() === tab.id 
                        ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-md' 
                        : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'">
                     <app-icon [name]="tab.icon" [size]="18"></app-icon>
                     {{ tab.label }}
                  </button>
               }
               
               <div class="h-px bg-zinc-200 dark:bg-zinc-800 my-4 mx-2"></div>
               
               <button class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all btn-press text-left">
                  <app-icon name="log-out" [size]="18"></app-icon>
                  Log Out
               </button>
            </div>

            <!-- Main Panel -->
            <div class="md:col-span-3 space-y-6 animate-fade-in">
               
               <!-- Section: Personal Info -->
               <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
                  <h2 class="text-lg font-bold text-zinc-900 dark:text-white mb-1">Personal Information</h2>
                  <p class="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Update your personal details and public profile.</p>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div class="space-y-1.5">
                        <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">Display Name</label>
                        <div class="relative">
                           <app-icon name="user" [size]="16" class="absolute left-3 top-2.5 text-zinc-400"></app-icon>
                           <input type="text" value="User Name" class="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500 dark:text-white transition-all">
                        </div>
                     </div>
                     <div class="space-y-1.5">
                        <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">Email Address</label>
                        <div class="relative">
                           <app-icon name="mail" [size]="16" class="absolute left-3 top-2.5 text-zinc-400"></app-icon>
                           <input type="email" value="user@lumina.ai" class="w-full pl-9 pr-3 py-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500 dark:text-white transition-all">
                        </div>
                     </div>
                     <div class="col-span-full space-y-1.5">
                        <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300">Bio</label>
                        <textarea rows="3" class="w-full p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-500/20 focus:border-zinc-500 dark:text-white transition-all resize-none" placeholder="Tell us a little about yourself..."></textarea>
                     </div>
                  </div>
                  
                  <div class="mt-6 flex justify-end">
                     <button class="px-5 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-bold rounded-lg hover:shadow-lg hover:-translate-y-0.5 transition-all btn-press">
                        Save Changes
                     </button>
                  </div>
               </div>

               <!-- Section: Connected Accounts -->
               <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-sm">
                  <h2 class="text-lg font-bold text-zinc-900 dark:text-white mb-6">Connected Accounts</h2>
                  <div class="space-y-4">
                     <div class="flex items-center justify-between p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/20 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                        <div class="flex items-center gap-4">
                           <div class="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 shadow-sm">
                              <app-icon name="globe" [size]="20"></app-icon>
                           </div>
                           <div>
                              <div class="text-sm font-bold text-zinc-900 dark:text-white">Google Account</div>
                              <div class="text-xs text-zinc-500">Connected as user&#64;gmail.com</div>
                           </div>
                        </div>
                        <button class="text-xs font-semibold text-zinc-500 hover:text-red-500 transition-colors btn-press">Disconnect</button>
                     </div>
                     
                     <div class="flex items-center justify-between p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/20 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors">
                        <div class="flex items-center gap-4">
                           <div class="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 shadow-sm">
                              <app-icon name="link" [size]="20"></app-icon>
                           </div>
                           <div>
                              <div class="text-sm font-bold text-zinc-900 dark:text-white">GitHub</div>
                              <div class="text-xs text-zinc-500">Not connected</div>
                           </div>
                        </div>
                        <button class="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors btn-press">Connect</button>
                     </div>
                  </div>
               </div>

            </div>
         </div>
      </div>
    </div>
  `
})
export class ProfileComponent {
  config = inject(ConfigService);
  activeTab = signal('general');

  tabs = [
    { id: 'general', label: 'General', icon: 'user' },
    { id: 'billing', label: 'Billing & Plans', icon: 'credit-card' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'security', label: 'Security', icon: 'shield' },
  ];
}