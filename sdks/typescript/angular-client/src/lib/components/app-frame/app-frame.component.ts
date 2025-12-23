import {
    Component,
    ElementRef,
    ViewChild,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Inject,
    NgZone,
    input,
    output,
    effect,
    computed,
    OnInit,
    OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { LoggingMessageNotification, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge, McpUiSizeChangeNotification, McpUiToolInputNotification } from '../../app-bridge';
import { SandboxConfig } from '../../types';

@Component({
    selector: 'mcp-app-frame',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './app-frame.component.html',
    styleUrls: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppFrameComponent implements OnInit, OnDestroy {
    sandbox = input.required<SandboxConfig>();
    appBridge = input<AppBridge>();
    html = input<string>();
    toolInput = input<McpUiToolInputNotification["params"]>();
    toolResult = input<CallToolResult>();

    errorOccurred = output<Error>();
    sizeChanged = output<McpUiSizeChangeNotification["params"]>();
    loggingMessage = output<LoggingMessageNotification["params"]>();

    @ViewChild('iframe') iframe?: ElementRef<HTMLIFrameElement>;

    mounted = false;
    error: Error | null = null;

    sandboxUrl = computed(() => {
        const sandbox = this.sandbox();
        if (!sandbox) return undefined;
        return this.sanitizer.bypassSecurityTrustResourceUrl(sandbox.url.href);
    });

    constructor(
        @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef,
        private ngZone: NgZone,
        private sanitizer: DomSanitizer
    ) {
        // Setup Bridge handlers when bridge or sandbox changes
        effect(() => {
            const bridge = this.appBridge();
            if (bridge) {
                this.setupBridge(bridge);
            }
        });

        // Send HTML to sandbox
        effect(() => {
            const html = this.html();
            // In the future: if (html && bridge) ...
            this.sendHtmlToSandbox();
        });

        // Send Tool Input
        effect(() => {
            const input = this.toolInput();
            const bridge = this.appBridge();
            if (input && bridge) {
                bridge.sendToolInput(input);
            }
        });

        // Send Tool Result
        effect(() => {
            const result = this.toolResult();
            const bridge = this.appBridge();
            if (result && bridge) {
                bridge.sendToolResult(result);
            }
        });
    }

    ngOnInit() {
        this.mounted = true;
    }

    ngOnDestroy() {
        this.mounted = false;
        // Cleanup if needed
    }

    private setupBridge(bridge: AppBridge) {
        bridge.onsizechange = (params) => {
            this.ngZone.run(() => {
                this.sizeChanged.emit(params);
            });
        };
        bridge.onloggingmessage = (params) => {
            this.ngZone.run(() => {
                this.loggingMessage.emit(params);
            });
        };
    }

    private sendHtmlToSandbox() {
        // internal logic
    }
}
