import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  EventEmitter,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

import Vditor from 'vditor';
import 'vditor/dist/index.css';

@Component({
  selector: 'app-vditor-note-editor',
  standalone: true,
  template: `
    <div class="vecho-vditor-shell">
      <div #host></div>
    </div>
  `,
  styles: [`
    .vecho-vditor-shell :where(.vditor) {
      border-radius: 10px;
      border: 1px solid rgba(228,228,231,1);
      overflow: hidden;
      background: rgba(255,255,255,1);
    }

    :host-context(.dark) .vecho-vditor-shell :where(.vditor) {
      border-color: rgba(39,39,42,1);
      background: rgba(9,9,11,0.25);
    }

    /* Make toolbar feel lighter and consistent */
    .vecho-vditor-shell :where(.vditor-toolbar) {
      border-bottom: 1px solid rgba(228,228,231,1);
      background: rgba(250,250,250,0.9);
    }
    :host-context(.dark) .vecho-vditor-shell :where(.vditor-toolbar) {
      border-bottom-color: rgba(39,39,42,1);
      background: rgba(9,9,11,0.35);
    }

    .vecho-vditor-shell :where(.vditor-reset) {
      font-size: 14px;
      line-height: 1.75;
    }
  `]
})
export class VditorNoteEditorComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() value: string = '';
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('host', { static: true })
  private host?: ElementRef<HTMLElement>;

  private vditor: any = null;
  private ready = false;
  private lastEmitted = '';
  private suppress = false;
  private themeObserver: MutationObserver | null = null;

  ngAfterViewInit(): void {
    const el = this.host?.nativeElement;
    if (!el) return;

    const isDark = document.documentElement.classList.contains('dark');

    this.vditor = new (Vditor as any)(el, {
      mode: 'wysiwyg',
      theme: isDark ? 'dark' : 'classic',
      height: 'auto',
      minHeight: 260,
      placeholder: '写点想法…',
      cache: { enable: false },
      toolbarConfig: { pin: true },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        '|',
        'quote',
        'list',
        'ordered-list',
        'check',
        '|',
        'link',
        'table',
        '|',
        'code',
        'inline-code',
        '|',
        'undo',
        'redo',
      ],
      preview: {
        mode: 'editor',
        markdown: {
          // Keep features conservative; avoid any CDN-loaded renderers in notes.
          mathBlockPreview: false,
          codeBlockPreview: false,
        },
      },
      input: (md: string) => {
        if (this.suppress) return;
        const next = (md || '').toString();
        if (next === this.lastEmitted) return;
        this.lastEmitted = next;
        this.valueChange.emit(next);
      },
      after: () => {
        this.ready = true;
        const initial = (this.value || '').toString();
        this.lastEmitted = initial;
        try {
          this.vditor?.setValue?.(initial);
        } catch {
          // ignore
        }

        // Paste images as data URLs (offline-friendly).
        try {
          const editorEl: HTMLElement | null = this.vditor?.wysiwyg?.element || this.vditor?.ir?.element || this.vditor?.sv?.element || null;
          if (editorEl) {
            editorEl.addEventListener('paste', (evt: any) => void this.onPaste(evt));
          }
        } catch {
          // ignore
        }

        // Track app theme changes.
        try {
          this.themeObserver?.disconnect();
          this.themeObserver = new MutationObserver(() => {
            const dark = document.documentElement.classList.contains('dark');
            try {
              this.vditor?.setTheme?.(dark ? 'dark' : 'classic');
            } catch {
              // ignore
            }
          });
          this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        } catch {
          // ignore
        }
      },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value']) return;
    if (!this.vditor || !this.ready) return;
    const next = (this.value || '').toString();
    if (next === this.lastEmitted) return;
    try {
      this.suppress = true;
      this.vditor.setValue(next);
      this.lastEmitted = next;
    } catch {
      // ignore
    } finally {
      this.suppress = false;
    }
  }

  ngOnDestroy(): void {
    try {
      this.themeObserver?.disconnect();
      this.themeObserver = null;
      this.vditor?.destroy?.();
    } catch {
      // ignore
    }
    this.vditor = null;
  }

  private async onPaste(evt: ClipboardEvent): Promise<void> {
    const dt = evt.clipboardData;
    if (!dt) return;
    const items = Array.from(dt.items || []);
    const imgItem = items.find(it => it.kind === 'file' && (it.type || '').toLowerCase().startsWith('image/'));
    if (!imgItem) return;

    const file = imgItem.getAsFile();
    if (!file) return;
    evt.preventDefault();

    const dataUrl = await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => resolve('');
      fr.readAsDataURL(file);
    });
    if (!dataUrl) return;

    try {
      this.vditor?.insertValue?.(`\n\n![](${dataUrl})\n\n`);
    } catch {
      // ignore
    }
  }
}
