import { Injectable, signal, computed, effect, inject, untracked } from '@angular/core';
import { translations } from '../translations';
import { StateService } from './state.service';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private state = inject(StateService);

  readonly theme = signal<'light' | 'dark'>('light');
  readonly lang = signal<'en' | 'zh'>('zh');
  readonly settingsOpen = signal<boolean>(false);
  readonly aboutOpen = signal<boolean>(false);
  readonly sidebarCollapsed = signal<boolean>(false);

  readonly t = computed(() => translations[this.lang()]);

  constructor() {
    // Sync persisted settings -> UI signals
    effect(() => {
      const s = this.state.settings();
      const a = s.appearance;
      untracked(() => {
        this.theme.set(a.theme);
        this.lang.set(a.language);
        this.sidebarCollapsed.set(a.sidebarCollapsed);
      });
    });

    // Sync UI signals -> persisted settings
    effect(() => {
      const theme = this.theme();
      const language = this.lang();
      const sidebarCollapsed = this.sidebarCollapsed();
      untracked(() => {
        this.state.updateSettings((s) => {
          const a = s.appearance;
          if (a.theme === theme && a.language === language && a.sidebarCollapsed === sidebarCollapsed) {
            return s;
          }
          return {
            ...s,
            appearance: {
              ...a,
              theme,
              language,
              sidebarCollapsed,
            }
          };
        });
      });
    });

    // Sync theme with HTML class
    effect(() => {
      const root = document.documentElement;
      if (this.theme() === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    });
  }

  toggleTheme() {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
  }

  toggleSidebar() {
    this.sidebarCollapsed.update(c => !c);
  }

  setLang(l: 'en' | 'zh') {
    this.lang.set(l);
  }
}
