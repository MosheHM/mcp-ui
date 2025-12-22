import {
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    Output,
    SimpleChanges,
    ViewChild,
    ChangeDetectionStrategy,
    signal,
    effect,
    computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResult, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { AppBridge } from './app-bridge';
import { PostMessageTransport } from './message-transport';
import { UIActionResult } from './types';
import {
    getToolUiResourceUri,
    readToolUiResourceHtml,
    setupSandboxProxyIframe,
} from './utils/app-host-utils';

@Component({
    selector: 'mcp-app-renderer',
    standalone: true,
    imports: [CommonModule],
    template: `
    <div #container class="mcp-app-renderer-container" style="width: 100%; height: 100%; display: flex; flex-direction: column;">
      <div *ngIf="error()" style="color: red; padding: 1rem;">
        Error: {{ error()?.message }}
      </div>
    </div>
  `,
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class McpAppRendererComponent implements OnInit, OnDestroy, OnChanges {
    @Input({ required: true }) sandboxProxyUrl!: URL | string;
    @Input({ required: true }) client!: Client;
    @Input({ required: true }) toolName!: string;
    @Input() toolResourceUri?: string;
    @Input() toolInput?: Record<string, unknown>;
    @Input() toolResult?: CallToolResult;

    @Output() uiAction = new EventEmitter<UIActionResult>();
    @Output() errorOccurred = new EventEmitter<Error>();

    @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLDivElement>;

    private appBridge: AppBridge | null = null;
    private iframe: HTMLIFrameElement | null = null;
    private iframeReady = false;

    // Signals for reactive state
    error = signal<Error | null>(null);

    constructor() { }

    async ngOnInit() {
        await this.setup();
    }

    ngOnChanges(changes: SimpleChanges) {
        if (changes['toolInput'] && this.appBridge && this.iframeReady && this.toolInput) {
            console.log("[Host] Sending tool input:", this.toolInput);
            this.appBridge.sendToolInput({ arguments: this.toolInput });
        }

        if (changes['toolResult'] && this.appBridge && this.iframeReady && this.toolResult) {
            console.log("[Host] Sending tool result:", this.toolResult);
            this.appBridge.sendToolResult(this.toolResult);
        }
    }

    ngOnDestroy() {
        if (this.iframe && this.containerRef?.nativeElement?.contains(this.iframe)) {
            this.containerRef.nativeElement.removeChild(this.iframe);
        }
    }

    private async setup() {
        try {
            const url = this.sandboxProxyUrl instanceof URL ? this.sandboxProxyUrl : new URL(this.sandboxProxyUrl);
            const { iframe, onReady } = await setupSandboxProxyIframe(url);

            this.iframe = iframe;
            if (this.containerRef?.nativeElement) {
                this.containerRef.nativeElement.appendChild(iframe);
            }

            await onReady;

            const serverCapabilities = this.client.getServerCapabilities();
            this.appBridge = new AppBridge(
                this.client,
                {
                    name: "Angular MCP UI Host",
                    version: "1.0.0",
                },
                {
                    openLinks: {},
                    serverTools: serverCapabilities?.tools,
                    serverResources: serverCapabilities?.resources,
                },
            );

            // Register handlers
            this.appBridge.oninitialized = () => {
                console.log("[Host] Inner iframe MCP client initialized");
                this.iframeReady = true;
                // Re-trigger input/result sending if they were waiting
                if (this.toolInput) {
                    this.appBridge?.sendToolInput({ arguments: this.toolInput });
                }
                if (this.toolResult) {
                    this.appBridge?.sendToolResult(this.toolResult);
                }
            };

            this.appBridge.onmessage = async (params, extra) => {
                try {
                    // Emit UI action for prompt
                    // Note: The React implementation maps 'message' to 'prompt' action type.
                    // We should verify if this mapping is desired or if we should emit a 'message' action.
                    // Following React implementation for consistency:
                    const promptText = params.content
                        .map((c: any) => (c.type === "text" ? c.text : ""))
                        .join("\n");

                    this.uiAction.emit({
                        type: "prompt",
                        payload: { prompt: promptText },
                    } as any); // Type assertion needed until types are fully aligned
                    return { isError: false };
                } catch (e) {
                    console.error("[Host] Message handler error:", e);
                    const err = e instanceof Error ? e : new Error(String(e));
                    this.handleError(err);
                    return { isError: true };
                }
            };

            this.appBridge.onopenlink = async (params, extra) => {
                try {
                    this.uiAction.emit({
                        type: "link",
                        payload: { url: params.url },
                    } as any);
                    return { isError: false };
                } catch (e) {
                    console.error("[Host] Open link handler error:", e);
                    const err = e instanceof Error ? e : new Error(String(e));
                    this.handleError(err);
                    return { isError: true };
                }
            };

            this.appBridge.onloggingmessage = (params) => {
                this.uiAction.emit({
                    type: "notify",
                    payload: { message: params["message"] },
                } as any);
            };

            this.appBridge.onsizechange = async ({ width, height }) => {
                if (this.iframe) {
                    if (width !== undefined) {
                        this.iframe.style.width = `${width}px`;
                    }
                    if (height !== undefined) {
                        this.iframe.style.height = `${height}px`;
                    }
                }
            };

            // Connect
            await this.appBridge.connect(
                new PostMessageTransport(
                    iframe.contentWindow!,
                    iframe.contentWindow!,
                ),
            );

            // Fetch and send resource
            await this.fetchAndSendResource();

        } catch (err) {
            console.error("[McpAppRenderer] Error:", err);
            const error = err instanceof Error ? err : new Error(String(err));
            this.handleError(error);
        }
    }

    private async fetchAndSendResource() {
        if (!this.appBridge) return;

        try {
            let resourceInfo: { uri: string };

            if (this.toolResourceUri) {
                resourceInfo = { uri: this.toolResourceUri };
                console.log(`[Host] Using provided resource URI: ${resourceInfo.uri}`);
            } else {
                console.log(`[Host] Fetching resource URI for tool: ${this.toolName}`);
                const info = await getToolUiResourceUri(this.client, this.toolName);
                if (!info) {
                    throw new Error(
                        `Tool ${this.toolName} has no UI resource (no ui/resourceUri or openai/outputTemplate in tool._meta)`,
                    );
                }
                resourceInfo = info;
                console.log(`[Host] Got resource URI: ${resourceInfo.uri}`);
            }

            if (!resourceInfo.uri) {
                throw new Error(`Tool ${this.toolName}: URI is undefined or empty`);
            }

            console.log(`[Host] Reading resource HTML from: ${resourceInfo.uri}`);
            const html = await readToolUiResourceHtml(this.client, {
                uri: resourceInfo.uri,
            });

            console.log("[Host] Sending sandbox resource ready");
            await this.appBridge.sendSandboxResourceReady({ html });

        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.handleError(error);
        }
    }

    private handleError(err: Error) {
        this.error.set(err);
        this.errorOccurred.emit(err);
    }
}
