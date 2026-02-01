import {
  AfterViewInit,
  Component,
  ElementRef,
  OnChanges,
  SimpleChanges,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { LightboxService } from '../services/lightbox.service';

type MermaidMod = typeof import('mermaid');

@Component({
  selector: 'app-markdown',
  standalone: true,
  template: `
    <div #root [class]="rootClass()" [innerHTML]="safeHtml()"></div>
  `,
  styles: [`
    .markdown-root {
      color: inherit;
    }
    .markdown-root :where(p) {
      margin: 0.6rem 0;
    }
    .markdown-root :where(h1,h2,h3,h4,h5,h6) {
      margin: 1rem 0 0.5rem;
      font-weight: 700;
      line-height: 1.25;
    }
    .markdown-root :where(h1) { font-size: 1.35rem; }
    .markdown-root :where(h2) { font-size: 1.2rem; }
    .markdown-root :where(h3) { font-size: 1.05rem; }
    .markdown-root :where(h4) { font-size: 1rem; }
    .markdown-root :where(h5) { font-size: 0.95rem; }
    .markdown-root :where(h6) { font-size: 0.9rem; }

    .markdown-root :where(ul,ol) {
      list-style-position: outside;
      padding-left: 1.25rem;
      margin: 0.6rem 0;
    }
    .markdown-root :where(ul) { list-style-type: disc; }
    .markdown-root :where(ol) { list-style-type: decimal; }
    .markdown-root :where(li) {
      margin: 0.2rem 0;
    }
    .markdown-root :where(blockquote) {
      margin: 0.8rem 0;
      padding: 0.4rem 0.8rem;
      border-left: 3px solid rgba(161,161,170,0.65);
      color: rgba(82,82,91,0.9);
      background: rgba(244,244,245,0.6);
      border-radius: 0.5rem;
    }
    :host-context(.dark) .markdown-root :where(blockquote) {
      border-left-color: rgba(113,113,122,0.9);
      color: rgba(212,212,216,0.9);
      background: rgba(9,9,11,0.35);
    }
    .markdown-root :where(hr) {
      margin: 1rem 0;
      border: 0;
      border-top: 1px solid rgba(228,228,231,1);
    }
    :host-context(.dark) .markdown-root :where(hr) {
      border-top-color: rgba(39,39,42,1);
    }

    .markdown-root :where(pre) {
      padding: 0.75rem;
      border-radius: 0.5rem;
      overflow: auto;
      background: rgba(244, 244, 245, 0.85);
    }
    :host-context(.dark) .markdown-root :where(pre) {
      background: rgba(9, 9, 11, 0.6);
    }
    .markdown-root :where(code) {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.875em;
    }
    .markdown-root :where(:not(pre) > code) {
      padding: 0.08rem 0.35rem;
      border-radius: 0.35rem;
      background: rgba(228,228,231,0.7);
    }
    :host-context(.dark) .markdown-root :where(:not(pre) > code) {
      background: rgba(39,39,42,0.8);
    }
    .markdown-root :where(a) {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .markdown-root :where(.vecho-mermaid svg) {
      max-width: 100%;
      height: auto;
    }

    .markdown-root :where(.vecho-table-wrap) {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin: 0.75rem 0;
      border-radius: 0.5rem;
      border: 1px solid rgba(228,228,231,1);
      background: rgba(255,255,255,0.8);
    }
    :host-context(.dark) .markdown-root :where(.vecho-table-wrap) {
      border-color: rgba(39,39,42,1);
      background: rgba(9,9,11,0.35);
    }
    .markdown-root :where(table) {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      table-layout: auto;
      font-size: 0.95em;
    }
    .markdown-root :where(th, td) {
      border: 1px solid rgba(228,228,231,1);
      padding: 0.45rem 0.6rem;
      vertical-align: top;
      text-align: left;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    :host-context(.dark) .markdown-root :where(th, td) {
      border-color: rgba(39,39,42,1);
    }
    .markdown-root :where(th) {
      font-weight: 700;
      background: rgba(244,244,245,0.9);
    }
    :host-context(.dark) .markdown-root :where(th) {
      background: rgba(24,24,27,0.9);
    }
    .markdown-root :where(tr:nth-child(even) td) {
      background: rgba(244,244,245,0.55);
    }
    :host-context(.dark) .markdown-root :where(tr:nth-child(even) td) {
      background: rgba(24,24,27,0.55);
    }

    /* Compact variant: reduce vertical rhythm */
    .markdown-root.vecho-md-compact :where(p) { margin: 0.25rem 0; }
    .markdown-root.vecho-md-compact :where(h1,h2,h3,h4,h5,h6) { margin: 0.5rem 0 0.25rem; }
    .markdown-root.vecho-md-compact :where(ul,ol) { margin: 0.25rem 0; }
  `],
})
export class MarkdownRendererComponent implements AfterViewInit, OnChanges {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly lightbox = inject(LightboxService);

  content = input<string>('');
  // Optional title used for diagrams in lightbox.
  title = input<string>('');
  variant = input<'prose' | 'compact'>('prose');

  @ViewChild('root', { static: true })
  private root?: ElementRef<HTMLElement>;

  private html = signal<string>('');
  private postSeq = 0;

  private md: MarkdownIt;
  private mermaidInit = false;
  private mermaid: MermaidMod | null = null;

  safeHtml = computed<SafeHtml>(() => {
    // Angular will sanitize [innerHTML] unless we bypass.
    // We already sanitize with DOMPurify first, so bypass is safe and keeps formatting intact.
    return this.sanitizer.bypassSecurityTrustHtml(this.html());
  });

  rootClass = computed(() => {
    const base = 'markdown-root';
    if (this.variant() === 'compact') {
      return `${base} vecho-md-compact text-sm leading-relaxed`;
    }
    return `${base} vecho-md-prose text-sm leading-relaxed`;
  });

  constructor() {
    this.md = new MarkdownIt({
      html: false,
      linkify: true,
      breaks: true,
    });

    // Make links safer.
    const defaultRender = this.md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    this.md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
      return defaultRender(tokens, idx, options, env, self);
    };

    // Re-render when content changes.
    effect(() => {
      const c = this.content();
      this.html.set(this.renderMarkdown(c));
      this.queuePostProcess();
    });
  }

  ngAfterViewInit(): void {
    this.queuePostProcess();
  }

  ngOnChanges(_changes: SimpleChanges): void {
    // input() + effect already handles content; this is for safety.
    this.queuePostProcess();
  }

  private renderMarkdown(markdown: string): string {
    const raw = (markdown || '').toString();
    if (!raw.trim()) return '';
    const rendered = this.md.render(raw);
    // Sanitize HTML to avoid XSS.
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
      // Allow embedded images (paste) and common protocols.
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|sms|ftp):|data:image\/(?:png|jpe?g|gif|webp);base64,|blob:)/i,
    });
  }

  private queuePostProcess(): void {
    const seq = ++this.postSeq;
    // Delay until the HTML is in the DOM.
    setTimeout(() => {
      if (seq !== this.postSeq) return;
      void this.postProcess();
    }, 0);
  }

  private async ensureMermaid(): Promise<MermaidMod> {
    if (!this.mermaid) {
      this.mermaid = await import('mermaid');
    }
    const isDark = document.documentElement.classList.contains('dark');
    // Mermaid uses a global singleton; initialize once, but update theme on demand.
    if (!this.mermaidInit) {
      this.mermaid.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
      });
      this.mermaidInit = true;
    } else {
      try {
        this.mermaid.default.initialize({ theme: isDark ? 'dark' : 'default' } as any);
      } catch {
        // ignore
      }
    }
    return this.mermaid;
  }

  private async postProcess(): Promise<void> {
    const el = this.root?.nativeElement;
    if (!el) return;

    // Images: click to zoom.
    const imgs = Array.from(el.querySelectorAll('img'));
    for (const img of imgs) {
      (img as any).onclick = null;
      img.setAttribute('draggable', 'false');
      (img as HTMLElement).style.cursor = 'zoom-in';
      (img as any).onclick = () => {
        const src = (img.getAttribute('src') || '').trim();
        if (!src) return;
        this.lightbox.openImage(src, this.title() || 'Image');
      };
    }

    // Mermaid blocks: replace ```mermaid code fences with rendered diagrams.
    const codes = Array.from(el.querySelectorAll('pre > code')) as HTMLElement[];
    const mermaidBlocks: Array<{ code: HTMLElement; text: string }> = [];
    for (const code of codes) {
      const cls = (code.getAttribute('class') || '').toLowerCase();
      const isMermaid = cls.includes('language-mermaid') || cls.includes('lang-mermaid') || cls.trim() === 'mermaid';
      if (!isMermaid) continue;
      const text = (code.textContent || '').trim();
      if (!text) continue;
      mermaidBlocks.push({ code, text });
    }
    if (mermaidBlocks.length > 0) {
      const mermaid = await this.ensureMermaid();

      for (let i = 0; i < mermaidBlocks.length; i++) {
        const { code, text } = mermaidBlocks[i];
        const pre = code.parentElement;
        if (!pre) continue;

        const wrapper = document.createElement('div');
        wrapper.className = 'vecho-mermaid my-3';

        const id = `mmd-${Date.now()}-${Math.random().toString(16).slice(2)}-${i}`;
        try {
          let out = await mermaid.default.render(id, text);

          // Retry once for common AI-generated gantt issues (e.g. "Invalid date: 00:00").
          // We keep the first attempt unchanged; only apply a fix if it fails.
          wrapper.innerHTML = out.svg;
          wrapper.style.cursor = 'zoom-in';
          (wrapper as any).onclick = () => {
            this.lightbox.openSvg(out.svg, this.title() || 'Diagram');
          };
        } catch (err: any) {
          const kind = this.detectMermaidKind(text);
          let retrySvg: string | null = null;
          let retryUsed = false;
          let fixedText: string | null = null;

          if (kind === 'gantt') {
            const fixed = this.fixMermaidGanttTimecode(text);
            if (fixed.changed) {
              try {
                const id2 = `${id}-fix`;
                const out2 = await mermaid.default.render(id2, fixed.code);
                retrySvg = out2.svg;
                fixedText = fixed.code;
                retryUsed = true;
              } catch {
                // fall through to error UI
                fixedText = fixed.code;
              }
            }
          }

          if (retrySvg) {
            wrapper.innerHTML = retrySvg;
            wrapper.style.cursor = 'zoom-in';
            (wrapper as any).onclick = () => {
              this.lightbox.openSvg(retrySvg!, this.title() || 'Diagram');
            };
          } else {
            const msg = (err && (err.message || String(err))) ? (err.message || String(err)) : 'render failed';
            wrapper.innerHTML = `
              <div class="rounded-lg border border-red-200 dark:border-red-900/40 bg-white dark:bg-zinc-900 p-3">
                <div class="text-xs font-semibold text-red-700 dark:text-red-300">Mermaid 渲染失败</div>
                <div class="mt-1 text-[11px] text-red-600 dark:text-red-300/80 whitespace-pre-wrap"></div>
              </div>
              <pre class="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 overflow-auto"><code></code></pre>
              ${retryUsed && fixedText ? '<pre class="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 overflow-auto"><code></code></pre>' : ''}
            `;
            const errEl = wrapper.querySelector('div.whitespace-pre-wrap');
            if (errEl) errEl.textContent = retryUsed ? `${msg}\n\n(已尝试自动修复 gantt 时间格式，仍失败)` : msg;
            const codeEls = wrapper.querySelectorAll('pre > code');
            if (codeEls[0]) (codeEls[0] as HTMLElement).textContent = text;
            if (retryUsed && fixedText && codeEls[1]) (codeEls[1] as HTMLElement).textContent = fixedText;
          }
        }

        pre.replaceWith(wrapper);
      }
    }

    // Wrap tables for horizontal scrolling.
    const tables = Array.from(el.querySelectorAll('table')) as HTMLTableElement[];
    for (const table of tables) {
      const parent = table.parentElement;
      if (parent && parent.classList.contains('vecho-table-wrap')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'vecho-table-wrap';
      table.replaceWith(wrap);
      wrap.appendChild(table);
    }
  }

  private detectMermaidKind(code: string): string {
    const first = (code || '').split(/\r?\n/).map(l => l.trim()).find(l => !!l);
    return (first || '').toLowerCase();
  }

  private fixMermaidGanttTimecode(src: string): { code: string; changed: boolean } {
    const raw = (src || '').toString();
    if (!raw.trim()) return { code: raw, changed: false };

    const lines = raw.split(/\r?\n/);
    const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
    if (firstNonEmptyIdx < 0) return { code: raw, changed: false };
    if (lines[firstNonEmptyIdx].trim().toLowerCase() !== 'gantt') return { code: raw, changed: false };

    const hasRealDate = /\b\d{4}-\d{2}-\d{2}\b/.test(raw);
    const timeRe = /\b(\d{1,4}):(\d{2})(?::(\d{2}))?\b/g;
    const hasTimeToken = timeRe.test(raw);
    timeRe.lastIndex = 0;
    if (!hasTimeToken && hasRealDate) return { code: raw, changed: false };

    let changed = false;

    // Ensure dateFormat supports full timestamps.
    const dateFormatIdx = lines.findIndex(l => l.trim().toLowerCase().startsWith('dateformat'));
    const desired = 'dateFormat  YYYY-MM-DD HH:mm:ss';
    if (dateFormatIdx >= 0) {
      if (!lines[dateFormatIdx].includes('YYYY') || !lines[dateFormatIdx].includes('HH')) {
        lines[dateFormatIdx] = lines[dateFormatIdx].replace(/^\s*dateFormat\b.*$/i, desired);
        changed = true;
      }
    } else {
      // Insert right after the `gantt` header.
      lines.splice(firstNonEmptyIdx + 1, 0, `  ${desired}`);
      changed = true;
    }

    const baseDate = '2020-01-01';
    const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

    const toIso = (h: number, m: number, s: number): string => {
      const hh = Math.max(0, Math.floor(h));
      const mm = Math.max(0, Math.floor(m));
      const ss = Math.max(0, Math.floor(s));
      return `${baseDate} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
    };

    const replaceLine = (line: string): string => {
      const t = line.trim().toLowerCase();
      if (t.startsWith('dateformat') || t.startsWith('axisformat')) return line;

      return line.replace(timeRe, (_m, a, b, c) => {
        // a:b(:c)
        const p1 = parseInt(a, 10);
        const p2 = parseInt(b, 10);
        const p3 = c !== undefined ? parseInt(c, 10) : null;
        if (!Number.isFinite(p1) || !Number.isFinite(p2) || (p3 !== null && !Number.isFinite(p3))) {
          return _m;
        }

        // If three parts: treat as HH:MM:SS.
        if (p3 !== null) {
          changed = true;
          return toIso(p1, p2, p3);
        }

        // Two parts: treat as MM:SS (minutes can exceed 59).
        const total = p1 * 60 + p2;
        const hh = Math.floor(total / 3600);
        const rem = total % 3600;
        const mm = Math.floor(rem / 60);
        const ss = rem % 60;
        changed = true;
        return toIso(hh, mm, ss);
      });
    };

    for (let i = 0; i < lines.length; i++) {
      lines[i] = replaceLine(lines[i]);
    }

    return { code: lines.join('\n'), changed };
  }
}
