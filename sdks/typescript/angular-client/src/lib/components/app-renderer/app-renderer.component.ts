import {
    Component,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Inject,
    OnInit,
    OnDestroy,
    input,
    output,
    signal,
    computed,
    effect,
    NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
    CallToolRequest,
    CallToolResult,
    ErrorCode,
    ListPromptsRequest,
    ListPromptsResult,
    ListResourcesRequest,
    ListResourcesResult,
    ListResourceTemplatesRequest,
    ListResourceTemplatesResult,
    LoggingMessageNotification,
    McpError,
    ReadResourceRequest,
    ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import {
    AppBridge,
    McpUiHostContext,
    McpUiMessageRequest,
    McpUiMessageResult,
    McpUiOpenLinkRequest,
    McpUiOpenLinkResult,
    McpUiSizeChangeNotification,
    McpUiToolInputPartialNotification,
    RequestHandlerExtra,
    RESOURCE_MIME_TYPE,
} from '../../app-bridge';
import { AppFrameComponent } from '../app-frame/app-frame.component';
import { SandboxConfig } from '../../types';
import { getToolUiResourceUri, readToolUiResourceHtml } from '../../utils/app-host-utils';

export interface AppRendererHandle {
    sendToolListChanged: () => void;
    sendResourceListChanged: () => void;
    sendPromptListChanged: () => void;
    teardownResource: () => void;
}

@Component({
    selector: 'mcp-app-renderer',
    standalone: true,
    imports: [CommonModule, AppFrameComponent],
    templateUrl: './app-renderer.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppRendererComponent
    implements OnInit, OnDestroy, AppRendererHandle {

    client = input<Client>();
    toolName = input.required<string>();
    sandbox = input.required<SandboxConfig>();
    toolResourceUri = input<string>();
    html = input<string>();
    toolInput = input<Record<string, unknown>>(); // AppFrame expects McpUiToolInputNotification["params"] which is wrapper, handled in template? No AppFrame expects {arguments: ...} ?? 
    // Wait, AppFrame expects McpUiToolInputNotification["params"] which is { arguments?: ... }
    // inputs.toolInput here is described as Record<string, unknown> (params). 
    // Standard toolInput meant complete arguments. 
    // Let's verify AppFrame input type: McpUiToolInputNotification["params"] -> { arguments?: Record... }
    // User passes "toolInput" as the arguments object or the text?
    // In React it was usually the arguments object.
    // If input here is the raw arguments, checking usage...

    toolResult = input<CallToolResult>();
    toolInputPartial = input<McpUiToolInputPartialNotification['params']>();
    toolCancelled = input<boolean>();
    hostContext = input<McpUiHostContext>();

    onOpenLink = input<(params: McpUiOpenLinkRequest['params'], extra: RequestHandlerExtra) => Promise<McpUiOpenLinkResult>>();
    onMessage = input<(params: McpUiMessageRequest['params'], extra: RequestHandlerExtra) => Promise<McpUiMessageResult>>();
    onCallTool = input<(params: CallToolRequest['params'], extra: RequestHandlerExtra) => Promise<CallToolResult>>();
    onListResources = input<(params: ListResourcesRequest['params'], extra: RequestHandlerExtra) => Promise<ListResourcesResult>>();
    onListResourceTemplates = input<(params: ListResourceTemplatesRequest['params'], extra: RequestHandlerExtra) => Promise<ListResourceTemplatesResult>>();
    onReadResource = input<(params: ReadResourceRequest['params'], extra: RequestHandlerExtra) => Promise<ReadResourceResult>>();
    onListPrompts = input<(params: ListPromptsRequest['params'], extra: RequestHandlerExtra) => Promise<ListPromptsResult>>();

    loggingMessage = output<LoggingMessageNotification['params']>();
    sizeChanged = output<McpUiSizeChangeNotification['params']>();
    errorOccurred = output<Error>();

    appBridge = signal<AppBridge | null>(null);
    error = signal<Error | null>(null);
    fetchedHtml = signal<string | null>(null);

    mounted = false;

    currentHtml = computed(() => {
        return this.html() || this.fetchedHtml() || undefined;
    });

    constructor(
        // @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef // signals handle checking? OnPush needs markForCheck?
        // Signals automatically mark for check in Angular 18+. I will keep cdr just in case.
        @Inject(ChangeDetectorRef) private cdr: ChangeDetectorRef,
        private ngZone: NgZone
    ) {
        // Effect: Client Change -> Create Bridge
        effect(() => {
            const client = this.client(); // Ref
            // Re-create bridge when client changes
            // logic from ngOnChanges
            this.createBridge();
        });

        // Effect: Fetch HTML triggers
        effect(() => {
            // dependent on client, toolName, toolResourceUri, html
            const client = this.client();
            const uri = this.toolResourceUri();
            const name = this.toolName();
            const explicitHtml = this.html();

            if (!explicitHtml) {
                this.fetchHtml();
            } else {
                this.fetchedHtml.set(null);
            }
        });

        // Effect: Host Context
        effect(() => {
            const context = this.hostContext();
            const bridge = this.appBridge();
            if (bridge && context) {
                bridge.setHostContext(context);
            }
        });

        // Effect: Tool Input Partial
        effect(() => {
            const partial = this.toolInputPartial();
            const bridge = this.appBridge();
            if (bridge && partial) {
                bridge.sendToolInputPartial(partial);
            }
        });

        // Effect: Tool Cancelled
        effect(() => {
            const cancelled = this.toolCancelled();
            const bridge = this.appBridge();
            if (bridge && cancelled) {
                bridge.sendToolCancelled({});
            }
        });
    }

    ngOnInit() {
        this.mounted = true;
        // initial fetch if needed (effect handles it)
    }

    ngOnDestroy() {
        this.mounted = false;
    }

    // --- AppRendererHandle ---
    sendToolListChanged() { this.appBridge()?.sendToolListChanged(); }
    sendResourceListChanged() { this.appBridge()?.sendResourceListChanged(); }
    sendPromptListChanged() { this.appBridge()?.sendPromptListChanged(); }
    teardownResource() { this.appBridge()?.teardownResource({}); }

    // --- Event Handlers ---
    handleSizeChanged(params: McpUiSizeChangeNotification['params']) {
        this.sizeChanged.emit(params);
    }
    handleLoggingMessage(params: LoggingMessageNotification['params']) {
        this.loggingMessage.emit(params);
    }
    handleError(error: Error) {
        this.setError(error);
        this.errorOccurred.emit(error);
    }

    // --- Internals ---
    private createBridge() {
        try {
            const bridge = this.instantiateBridge();
            this.registerDefaultHandlers(bridge);
            this.registerCustomHandlers(bridge);
            this.appBridge.set(bridge);
            this.setError(null);
        } catch (err) {
            console.error('[AppRenderer] Error creating bridge:', err);
            const error = err instanceof Error ? err : new Error(String(err));
            this.handleError(error);
        }
    }

    private instantiateBridge(): AppBridge {
        const client = this.client();
        const serverCapabilities = client?.getServerCapabilities();
        return new AppBridge(
            (client as any) ?? null,
            { name: 'MCP-UI Host', version: '1.0.0' },
            {
                openLinks: {},
                serverTools: serverCapabilities?.tools,
                serverResources: serverCapabilities?.resources,
            },
        );
    }

    private registerDefaultHandlers(bridge: AppBridge) {
        bridge.onmessage = async (params, extra) => {
            const handler = this.onMessage();
            if (handler) return handler(params, extra);
            throw new McpError(ErrorCode.MethodNotFound, 'Method not found');
        };

        bridge.onopenlink = async (params, extra) => {
            const handler = this.onOpenLink();
            if (handler) return handler(params, extra);
            throw new McpError(ErrorCode.MethodNotFound, 'Method not found');
        };

        bridge.onloggingmessage = (params) => {
            // run inside zone if needed, emitter usually handles it?
            // AppBridge callbacks might be outside zone if from event listener?
            // Usually SDK callbacks are async. 
            this.ngZone.run(() => this.loggingMessage.emit(params));
        };
    }

    private registerCustomHandlers(bridge: AppBridge) {
        const callTool = this.onCallTool();
        if (callTool) bridge.oncalltool = (p, e) => callTool(p, e);

        const listResources = this.onListResources();
        if (listResources) bridge.onlistresources = (p, e) => listResources(p, e);

        const listTemplates = this.onListResourceTemplates();
        if (listTemplates) bridge.onlistresourcetemplates = (p, e) => listTemplates(p, e);

        const readResource = this.onReadResource();
        if (readResource) bridge.onreadresource = (p, e) => readResource(p, e);

        const listPrompts = this.onListPrompts();
        if (listPrompts) bridge.onlistprompts = (p, e) => listPrompts(p, e);
    }

    private async fetchHtml() {
        // Check guards
        if (!this.canFetchHtml()) return;
        // In signals, we check immediate values

        try {
            const uri = await this.resolveResourceUri();
            if (!this.mounted) return;

            const htmlContent = await this.fetchResourceContent(uri);
            if (!this.mounted) return;

            this.fetchedHtml.set(htmlContent);
            this.setError(null);

        } catch (err) {
            if (!this.mounted) return;
            const error = err instanceof Error ? err : new Error(String(err));
            this.handleError(error);
        }
    }

    private canFetchHtml(): boolean {
        const client = this.client();
        const hasClient = !!client;
        const uri = this.toolResourceUri();
        const readHandler = this.onReadResource();

        if (!hasClient && (!uri || !readHandler)) {
            return false;
        }
        return true;
    }

    private async resolveResourceUri(): Promise<string> {
        const uri = this.toolResourceUri();
        if (uri) return uri;

        const client = this.client();
        const toolName = this.toolName();
        if (client) {
            const info = await getToolUiResourceUri(client, toolName);
            if (!info) {
                throw new Error(`Tool ${toolName} has no UI resource`);
            }
            return info.uri;
        }
        throw new Error('Cannot determine resource URI');
    }

    private async fetchResourceContent(uri: string): Promise<string> {
        const client = this.client();
        const readHandler = this.onReadResource();

        if (client) {
            return await readToolUiResourceHtml(client, { uri });
        } else if (readHandler) {
            const result = await readHandler({ uri }, {} as RequestHandlerExtra);
            if (!result.contents || result.contents.length !== 1) {
                throw new Error('Unsupported content length');
            }
            const content = result.contents[0];
            // reuse logic... (keeping it simple here for brevity in draft, will copy full logic)
            const isHtml = (t?: string) => t === RESOURCE_MIME_TYPE;
            if ('text' in content && typeof content.text === 'string' && isHtml(content.mimeType)) {
                return content.text;
            }
            if ('blob' in content && typeof content.blob === 'string' && isHtml(content.mimeType)) {
                return atob(content.blob);
            }
            throw new Error('Unsupported format');
        }
        throw new Error('No way to read resource HTML');
    }

    private setError(error: Error | null) {
        this.error.set(error);
        // this.cdr.markForCheck(); // signals auto-mark
    }
}
