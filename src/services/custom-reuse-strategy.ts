import { RouteReuseStrategy, ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';
import { Injectable } from '@angular/core';

@Injectable()
export class CustomReuseStrategy implements RouteReuseStrategy {
    private handlers: { [key: string]: DetachedRouteHandle } = {};

    // Decide if we should detach (cache) the current route
    shouldDetach(route: ActivatedRouteSnapshot): boolean {
        // Cache everything by default similar to browser tabs
        // Avoid caching modal routes or temp routes if identified
        return true;
    }

    // Store the detached route handle
    store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
        const url = this.getFullUrl(route);
        if (handle) {
            this.handlers[url] = handle;
        }
    }

    // Decide if we should re-attach a cached handle
    shouldAttach(route: ActivatedRouteSnapshot): boolean {
        const url = this.getFullUrl(route);
        return !!this.handlers[url];
    }

    // Retrieve the cached handle
    retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
        if (!route.routeConfig) return null;
        const url = this.getFullUrl(route);
        return this.handlers[url];
    }

    // Standard reuse check (same component config)
    shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
        return future.routeConfig === curr.routeConfig;
    }

    // Helper to get full URL/key for the route
    private getFullUrl(route: ActivatedRouteSnapshot): string {
        const path = route.pathFromRoot
            .map(v => v.url.map(segment => segment.toString()).join('/'))
            .filter(s => s)
            .join('/');

        // IMPORTANT: include query params in the cache key.
        // Otherwise routes like `/media?collection=a` and `/media?collection=b`
        // will incorrectly reuse the same cached handle.
        const query = this.serializeQueryParams(route.queryParams || {});
        return query ? `${path}?${query}` : path;
    }

    private serializeQueryParams(params: Record<string, any>): string {
        const entries: Array<[string, string]> = [];

        for (const key of Object.keys(params).sort()) {
            const val = (params as any)[key];

            if (val === undefined || val === null) continue;

            // Angular can represent repeated query params as arrays.
            if (Array.isArray(val)) {
                for (const v of val) {
                    if (v === undefined || v === null) continue;
                    entries.push([key, String(v)]);
                }
                continue;
            }

            entries.push([key, String(val)]);
        }

        return entries
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
    }
}
