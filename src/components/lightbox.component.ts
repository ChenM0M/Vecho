import { Component, ElementRef, HostListener, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { IconComponent } from './icons';
import { LightboxService } from '../services/lightbox.service';

@Component({
  selector: 'app-lightbox',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (lightbox.active(); as lb) {
      <div class="fixed inset-0 z-[180] bg-black/70 backdrop-blur-sm" (mousedown)="onBackdrop($event)">
        <div class="absolute inset-0"></div>

        <div class="absolute inset-0 flex flex-col" (mousedown)="$event.stopPropagation()">
          <div class="h-12 px-4 flex items-center justify-between text-white/90">
            <div class="min-w-0 flex items-center gap-3">
              <div class="text-xs font-semibold truncate">{{ lb.title || (lb.kind === 'image' ? 'Image' : 'Diagram') }}</div>
              <div class="text-[11px] font-mono text-white/60">{{ zoomLabel() }}</div>
            </div>
            <div class="flex items-center gap-2">
              <button class="h-8 w-8 rounded-md hover:bg-white/10 transition-colors" title="Zoom out" (click)="zoomBy(0.85)">
                <app-icon name="minus" [size]="18"></app-icon>
              </button>
              <button class="h-8 w-8 rounded-md hover:bg-white/10 transition-colors" title="Zoom in" (click)="zoomBy(1.15)">
                <app-icon name="plus" [size]="18"></app-icon>
              </button>
              <button class="h-8 px-3 rounded-md hover:bg-white/10 transition-colors text-xs font-semibold" (click)="fitToScreen()">Fit</button>
              <button class="h-8 px-3 rounded-md hover:bg-white/10 transition-colors text-xs font-semibold" (click)="resetTo100()">100%</button>
              <button class="h-8 w-8 rounded-md hover:bg-white/10 transition-colors" title="Close" (click)="lightbox.close()">
                <app-icon name="x" [size]="18"></app-icon>
              </button>
            </div>
          </div>

          <div
            class="flex-1 overflow-hidden"
            (wheel)="onWheel($event)"
            (mousedown)="onPanStart($event)"
            (mousemove)="onPanMove($event)"
            (mouseup)="onPanEnd()"
            (mouseleave)="onPanEnd()"
          >
            <div class="w-full h-full flex items-center justify-center select-none">
              <div
                class="max-w-none max-h-none"
                [style.transform]="transformStyle()"
                [style.transform-origin]="'center center'"
              >
                @if (lb.kind === 'image') {
                  <img [src]="lb.src" class="max-w-none max-h-none" draggable="false" (load)="onImgLoad($event)" />
                } @else {
                   <div #svgHost class="bg-white rounded-lg p-3 shadow-sm" [innerHTML]="safeSvg()"></div>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class LightboxComponent {
  lightbox = inject(LightboxService);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('svgHost')
  private svgHost?: ElementRef<HTMLElement>;

  // view transform state
  private scale = signal(1);
  private tx = signal(0);
  private ty = signal(0);

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  private lastFitScale = 1;

  safeSvg = computed<SafeHtml>(() => {
    const lb = this.lightbox.active();
    if (!lb || lb.kind !== 'svg') return '';
    return this.sanitizer.bypassSecurityTrustHtml(lb.src);
  });

  zoomLabel = computed(() => `${Math.round(this.scale() * 100)}%`);

  transformStyle = computed(() => {
    const s = this.scale();
    const x = this.tx();
    const y = this.ty();
    return `translate(${x}px, ${y}px) scale(${s})`;
  });

  constructor() {
    // When opening a new item, reset transform.
    effect(() => {
      const lb = this.lightbox.active();
      if (!lb) return;
      this.scale.set(1);
      this.tx.set(0);
      this.ty.set(0);
      this.lastFitScale = 1;

      if (lb.kind === 'svg') {
        // Wait for SVG HTML to paint, then compute fit scale.
        setTimeout(() => {
          this.fitSvgOnOpen();
        }, 0);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.lightbox.active()) this.lightbox.close();
  }

  onBackdrop(event: MouseEvent): void {
    event.preventDefault();
    this.lightbox.close();
  }

  resetTo100(): void {
    this.scale.set(1);
    this.tx.set(0);
    this.ty.set(0);
  }

  fitToScreen(): void {
    const s = this.lastFitScale || 1;
    this.scale.set(Math.min(10, Math.max(0.05, s)));
    this.tx.set(0);
    this.ty.set(0);
  }

  zoomBy(factor: number): void {
    const next = (this.scale() * factor);
    this.scale.set(Math.min(10, Math.max(0.05, next)));
  }

  onImgLoad(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;
    const iw = img.naturalWidth || 0;
    const ih = img.naturalHeight || 0;
    if (!iw || !ih) return;
    const headerH = 48;
    const pad = 56;
    const availW = Math.max(200, (window.innerWidth || 1200) - pad * 2);
    const availH = Math.max(200, (window.innerHeight || 800) - headerH - pad * 2);
    const fit = Math.min(availW / iw, availH / ih);
    // allow upscale
    const clamped = Math.min(10, Math.max(0.05, fit));
    this.lastFitScale = clamped;
    this.scale.set(clamped);
    this.tx.set(0);
    this.ty.set(0);
  }

  private fitSvgOnOpen(): void {
    const lb = this.lightbox.active();
    if (!lb || lb.kind !== 'svg') return;

    // Prefer actual DOM metrics; Mermaid sometimes emits SVG without width/height.
    const host = this.svgHost?.nativeElement;
    if (!host) return;
    const svg = host.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    let iw = 0;
    let ih = 0;

    try {
      const vb = svg.viewBox?.baseVal;
      if (vb && vb.width > 0 && vb.height > 0) {
        iw = vb.width;
        ih = vb.height;
      }
    } catch {
      // ignore
    }

    if (!iw || !ih) {
      // Fallback: try width/height attributes.
      const wAttr = (svg.getAttribute('width') || '').trim();
      const hAttr = (svg.getAttribute('height') || '').trim();
      const wNum = parseFloat(wAttr);
      const hNum = parseFloat(hAttr);
      if (Number.isFinite(wNum) && Number.isFinite(hNum) && wNum > 0 && hNum > 0) {
        iw = wNum;
        ih = hNum;
      }
    }

    if (!iw || !ih) {
      // Last resort: rendered size.
      const rect = host.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        iw = rect.width;
        ih = rect.height;
      }
    }

    if (!iw || !ih) return;

    const headerH = 48;
    const pad = 56;
    const availW = Math.max(200, (window.innerWidth || 1200) - pad * 2);
    const availH = Math.max(200, (window.innerHeight || 800) - headerH - pad * 2);
    const fit = Math.min(availW / iw, availH / ih);
    const clamped = Math.min(10, Math.max(0.05, fit));
    this.lastFitScale = clamped;
    this.scale.set(clamped);
    this.tx.set(0);
    this.ty.set(0);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY;
    const factor = delta > 0 ? 0.9 : 1.1;
    this.zoomBy(factor);
  }

  onPanStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }

  onPanMove(event: MouseEvent): void {
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.tx.set(this.tx() + dx);
    this.ty.set(this.ty() + dy);
  }

  onPanEnd(): void {
    this.dragging = false;
  }
}
