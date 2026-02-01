import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import type { AppTab } from '../types';
import { StateService } from './state.service';

@Injectable({
    providedIn: 'root'
})
export class LayoutService {
    private router = inject(Router);
    private state = inject(StateService);

    // Tabs State - All tabs are closable
    readonly tabs = signal<AppTab[]>([
        { id: 'home', title: 'Dashboard', url: '/', icon: 'layout-grid', isActive: true, isClosable: true }
    ]);

    constructor() {
        // Listen to route changes to update active tab or add new one
        this.router.events.pipe(
            filter(event => event instanceof NavigationEnd)
        ).subscribe((event: NavigationEnd) => {
            this.syncTabsWithRoute(event.urlAfterRedirects);
        });

        // Keep the active tab title in sync when the current collection is renamed.
        // (Query param stays the same, so we won't necessarily get a NavigationEnd.)
        effect(() => {
            void this.state.collections();
            void this.state.mediaItems();
            const activeId = this.activeTabId();

            // IMPORTANT: read tabs untracked to avoid an effect loop
            // (updateActiveTabDetails writes to tabs).
            const activeTab = untracked(() => this.tabs().find(t => t.id === activeId));

            // When switching tabs, Router.url is still the previous tab until navigation completes.
            // Use the tab's stored URL so the title/icon won't flash.
            const url = activeTab?.url ?? this.router.url;
            this.updateActiveTabDetails(url);
        });
    }

    private syncTabsWithRoute(url: string) {
        // 核心修改：不再查找并跳转到已存在的 Tab (browser-style behavior)
        // 始终只更新当前活跃的 Tab，这样每个 Tab 都是独立的浏览上下文
        this.updateActiveTabDetails(url);
    }

    // Track active tab ID to update it
    readonly activeTabId = signal<string>('home');

    setActiveTab(id: string) {
        this.activeTabId.set(id);
        const tab = this.tabs().find(t => t.id === id);
        if (tab) {
            this.router.navigateByUrl(tab.url);
        }
    }

    addTab(url?: string) {
        const initialUrl = url ?? this.router.url;
        const details = this.getTabDetailsForUrl(initialUrl);
        const newId = crypto.randomUUID();
        const newTab: AppTab = {
            id: newId,
            title: details.title,
            url: initialUrl,
            icon: details.icon,
            isActive: true,
            isClosable: true
        };

        // Deactivate others
        // this.tabs.update(ts => ts.map(t => ({...t, isActive: false}))); // We use activeTabId instead

        this.tabs.update(ts => [...ts, newTab]);
        this.setActiveTab(newId);
    }

    closeTab(id: string, event: Event) {
        event.stopPropagation();
        const tabs = this.tabs();
        const index = tabs.findIndex(t => t.id === id);

        // Remove the tab
        this.tabs.update(ts => ts.filter(t => t.id !== id));

        // If we closed the last tab, create a new Dashboard tab
        if (tabs.length === 1) {
            const newId = crypto.randomUUID();
            const newHomeTab: AppTab = {
                id: newId,
                title: 'Dashboard',
                url: '/',
                icon: 'layout-grid',
                isActive: true,
                isClosable: true
            };
            this.tabs.set([newHomeTab]);
            this.setActiveTab(newId);
            return;
        }

        // If we closed the active tab, activate a neighbor
        if (this.activeTabId() === id) {
            const newIndex = index === 0 ? 0 : index - 1;
            const newTab = this.tabs()[newIndex];
            this.setActiveTab(newTab.id);
        }
    }

    // Called when router navigates, to sync the internal state of the Tab
    updateActiveTabDetails(url: string) {
        const currentId = this.activeTabId();
        const details = this.getTabDetailsForUrl(url);

        this.tabs.update(ts => ts.map(t =>
            t.id === currentId
                ? (t.title === details.title && t.icon === details.icon && t.url === url)
                    ? t
                    : { ...t, title: details.title, url, icon: details.icon }
                : t
        ));
    }

    private getTabDetailsForUrl(url: string): { title: string; icon: string } {
        const normalizedUrl = this.normalizeUrl(url);

        // Helper to guess title based on URL
        let title = 'Untitled';
        let icon = 'file';

        if (normalizedUrl === '/' || normalizedUrl.startsWith('/dashboard')) {
            title = '仪表盘';
            icon = 'layout-grid';
            return { title, icon };
        }

        if (normalizedUrl.startsWith('/media/')) {
            try {
                const tree = this.router.parseUrl(normalizedUrl);
                const segs = tree.root.children['primary']?.segments || [];
                const mediaId = segs.length >= 2 ? segs[1].path : null;
                if (mediaId) {
                    const item = this.state.mediaItems().find(m => m.id === mediaId);
                    if (item) {
                        title = item.name || '媒体详情';
                        icon = item.type === 'audio' ? 'music' : 'video';
                        return { title, icon };
                    }
                }
            } catch {
                // ignore
            }

            title = '媒体详情';
            icon = 'play-circle';
            return { title, icon };
        }

        if (normalizedUrl.startsWith('/media')) {
            const collectionId = this.getQueryParam(normalizedUrl, 'collection');
            if (collectionId) {
                icon = 'folder';
                const col = this.state.collections().find(c => c.id === collectionId);
                title = col?.name || '收藏夹';
            } else {
                title = '媒体库';
                icon = 'play-circle';
            }
            return { title, icon };
        }

        if (normalizedUrl.startsWith('/workflow')) {
            return { title: '工作流', icon: 'git-merge' };
        }

        if (normalizedUrl.startsWith('/apps')) {
            return { title: '工具箱', icon: 'box' };
        }

        if (normalizedUrl.startsWith('/recycle-bin')) {
            return { title: '回收站', icon: 'trash' };
        }

        return { title, icon };
    }

    private normalizeUrl(url: string): string {
        // HashLocationStrategy may surface URLs containing '#'.
        // Router.parseUrl expects a path-like string.
        const hashIndex = url.indexOf('#');
        if (hashIndex === -1) return url;
        const after = url.slice(hashIndex + 1);
        return after.startsWith('/') ? after : url;
    }

    private getQueryParam(url: string, key: string): string | null {
        try {
            const tree = this.router.parseUrl(url);
            const value = tree.queryParams?.[key];
            return typeof value === 'string' && value.trim() ? value : null;
        } catch {
            return null;
        }
    }
    reorderTabs(fromIndex: number, toIndex: number) {
        this.tabs.update(currentTabs => {
            const tabs = [...currentTabs];
            const [movedTab] = tabs.splice(fromIndex, 1);
            tabs.splice(toIndex, 0, movedTab);
            return tabs;
        });
    }
}
