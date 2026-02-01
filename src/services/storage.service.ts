import { Injectable } from '@angular/core';

/**
 * StorageService - Handles localStorage persistence with type safety
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
    private readonly PREFIX = 'vecho_';

    /**
     * Save data to localStorage
     */
    set<T>(key: string, value: T): void {
        try {
            const serialized = JSON.stringify(value);
            localStorage.setItem(this.PREFIX + key, serialized);
        } catch (error) {
            console.error(`Error saving to localStorage (${key}):`, error);
        }
    }

    /**
     * Get data from localStorage
     */
    get<T>(key: string): T | null {
        try {
            const item = localStorage.getItem(this.PREFIX + key);
            return item ? JSON.parse(item) : null;
        } catch (error) {
            console.error(`Error reading from localStorage (${key}):`, error);
            return null;
        }
    }

    /**
     * Remove item from localStorage
     */
    remove(key: string): void {
        localStorage.removeItem(this.PREFIX + key);
    }

    /**
     * Clear all app data from localStorage
     */
    clear(): void {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith(this.PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    }

    /**
     * Check if key exists
     */
    has(key: string): boolean {
        return localStorage.getItem(this.PREFIX + key) !== null;
    }

    /**
     * Get all keys with prefix
     */
    keys(): string[] {
        return Object.keys(localStorage)
            .filter(key => key.startsWith(this.PREFIX))
            .map(key => key.replace(this.PREFIX, ''));
    }
}
