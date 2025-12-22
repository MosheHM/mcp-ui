import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ZodLiteral, ZodObject } from "zod";

import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
    CallToolRequestSchema,
    CallToolResultSchema,
    Implementation,
    ListPromptsRequestSchema,
    ListPromptsResultSchema,
    ListResourcesRequestSchema,
    ListResourcesResultSchema,
    ListResourceTemplatesRequestSchema,
    ListResourceTemplatesResultSchema,
    LoggingMessageNotification,
    LoggingMessageNotificationSchema,
    Notification,
    PingRequest,
    PingRequestSchema,
    PromptListChangedNotificationSchema,
    ReadResourceRequestSchema,
    ReadResourceResultSchema,
    Request,
    ResourceListChangedNotificationSchema,
    Result,
    ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
    Protocol,
    ProtocolOptions,
    RequestOptions,
} from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
    type McpUiSandboxResourceReadyNotification,
    type McpUiSizeChangeNotification,
    type McpUiToolInputNotification,
    type McpUiToolInputPartialNotification,
    type McpUiToolResultNotification,
    LATEST_PROTOCOL_VERSION,
    McpUiAppCapabilities,
    McpUiHostCapabilities,
    McpUiHostContext,
    McpUiHostContextChangedNotification,
    McpUiInitializedNotification,
    McpUiInitializedNotificationSchema,
    McpUiInitializeRequest,
    McpUiInitializeRequestSchema,
    McpUiInitializeResult,
    McpUiMessageRequest,
    McpUiMessageRequestSchema,
    McpUiMessageResult,
    McpUiOpenLinkRequest,
    McpUiOpenLinkRequestSchema,
    McpUiOpenLinkResult,
    McpUiResourceTeardownRequest,
    McpUiResourceTeardownResultSchema,
    McpUiSandboxProxyReadyNotification,
    McpUiSandboxProxyReadyNotificationSchema,
    McpUiSizeChangeNotificationSchema,
} from "./types";
export * from "./types";
// export { PostMessageTransport } from "./message-transport"; // Commented out as we might not need it or it might be missing

/**
 * Options for configuring AppBridge behavior.
 *
 * @see ProtocolOptions from @modelcontextprotocol/sdk for available options
 */
export type HostOptions = ProtocolOptions & {
    hostContext?: McpUiHostContext;
};

/**
 * Protocol versions supported by this AppBridge implementation.
 *
 * The SDK automatically handles version negotiation during initialization.
 * Hosts don't need to manage protocol versions manually.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION];

/**
 * Extra metadata passed to request handlers.
 *
 * This type represents the additional context provided by the Protocol class
 * when handling requests, including abort signals and session information.
 * It is extracted from the MCP SDK's request handler signature.
 *
 * @internal
 */
type RequestHandlerExtra = Parameters<
    Parameters<AppBridge["setRequestHandler"]>[1]
>[1];

/**
 * Host-side bridge for communicating with a single Guest UI (App).
 */
export class AppBridge extends Protocol<Request, Notification, Result> {
    private _appCapabilities?: McpUiAppCapabilities;
    private _appInfo?: Implementation;
    private _hostContext: McpUiHostContext;

    constructor(
        private _client: Client,
        private _hostInfo: Implementation,
        private _capabilities: McpUiHostCapabilities,
        options?: HostOptions,
    ) {
        super(options);

        this._hostContext = options?.hostContext || {};

        this.setRequestHandler(McpUiInitializeRequestSchema, (request) =>
            this._oninitialize(request as McpUiInitializeRequest),
        );

        this.setRequestHandler(PingRequestSchema, (request, extra) => {
            this.onping?.(request.params, extra);
            return {};
        });
    }

    getAppCapabilities(): McpUiAppCapabilities | undefined {
        return this._appCapabilities;
    }

    getAppVersion(): Implementation | undefined {
        return this._appInfo;
    }

    onping?: (params: PingRequest["params"], extra: RequestHandlerExtra) => void;

    set onsizechange(
        callback: (params: McpUiSizeChangeNotification["params"]) => void,
    ) {
        this.setNotificationHandler(McpUiSizeChangeNotificationSchema, (n) =>
            callback(n.params),
        );
    }

    set onsandboxready(
        callback: (params: McpUiSandboxProxyReadyNotification["params"]) => void,
    ) {
        this.setNotificationHandler(McpUiSandboxProxyReadyNotificationSchema, (n) =>
            callback(n.params),
        );
    }

    set oninitialized(
        callback: (params: McpUiInitializedNotification["params"]) => void,
    ) {
        this.setNotificationHandler(McpUiInitializedNotificationSchema, (n) =>
            callback(n.params),
        );
    }

    set onmessage(
        callback: (
            params: McpUiMessageRequest["params"],
            extra: RequestHandlerExtra,
        ) => Promise<McpUiMessageResult>,
    ) {
        this.setRequestHandler(
            McpUiMessageRequestSchema,
            async (request, extra) => {
                return callback(request["params"], extra);
            },
        );
    }

    set onopenlink(
        callback: (
            params: McpUiOpenLinkRequest["params"],
            extra: RequestHandlerExtra,
        ) => Promise<McpUiOpenLinkResult>,
    ) {
        this.setRequestHandler(
            McpUiOpenLinkRequestSchema,
            async (request, extra) => {
                return callback(request["params"], extra);
            },
        );
    }

    set onloggingmessage(
        callback: (params: LoggingMessageNotification["params"]) => void,
    ) {
        this.setNotificationHandler(
            LoggingMessageNotificationSchema,
            async (notification) => {
                callback(notification.params);
            },
        );
    }

    assertCapabilityForMethod(method: Request["method"]): void {
        // TODO
    }

    assertRequestHandlerCapability(method: Request["method"]): void {
        // TODO
    }

    assertNotificationCapability(method: Notification["method"]): void {
        // TODO
    }

    getCapabilities(): McpUiHostCapabilities {
        return this._capabilities;
    }

    private async _oninitialize(
        request: McpUiInitializeRequest,
    ): Promise<McpUiInitializeResult> {
        const requestedVersion = request.params.protocolVersion;

        this._appCapabilities = request.params.appCapabilities;
        this._appInfo = request.params.appInfo;

        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
            requestedVersion,
        )
            ? requestedVersion
            : LATEST_PROTOCOL_VERSION;

        return {
            protocolVersion,
            hostCapabilities: this.getCapabilities(),
            hostInfo: this._hostInfo,
            hostContext: this._hostContext,
        };
    }

    setHostContext(hostContext: McpUiHostContext) {
        const changes: McpUiHostContext = {};
        let hasChanges = false;
        for (const key of Object.keys(hostContext) as Array<
            keyof McpUiHostContext
        >) {
            const oldValue = this._hostContext[key];
            const newValue = hostContext[key];
            if (deepEqual(oldValue, newValue)) {
                continue;
            }
            changes[key] = newValue as any;
            hasChanges = true;
        }
        if (hasChanges) {
            this._hostContext = hostContext;
            this.notification((<McpUiHostContextChangedNotification>{
                method: "ui/notifications/host-context-changed",
                params: changes,
            }) as Notification);
        }
    }

    sendToolInput(params: McpUiToolInputNotification["params"]) {
        return this.notification(<McpUiToolInputNotification>{
            method: "ui/notifications/tool-input",
            params,
        });
    }

    sendToolInputPartial(params: McpUiToolInputPartialNotification["params"]) {
        return this.notification(<McpUiToolInputPartialNotification>{
            method: "ui/notifications/tool-input-partial",
            params,
        });
    }

    sendToolResult(params: McpUiToolResultNotification["params"]) {
        return this.notification(<McpUiToolResultNotification>{
            method: "ui/notifications/tool-result",
            params,
        });
    }

    sendSandboxResourceReady(
        params: McpUiSandboxResourceReadyNotification["params"],
    ) {
        return this.notification(<McpUiSandboxResourceReadyNotification>{
            method: "ui/notifications/sandbox-resource-ready",
            params,
        });
    }

    sendResourceTeardown(
        params: McpUiResourceTeardownRequest["params"],
        options?: RequestOptions,
    ) {
        return this.request(
            <McpUiResourceTeardownRequest>{
                method: "ui/resource-teardown",
                params,
            },
            McpUiResourceTeardownResultSchema,
            options,
        );
    }

    private forwardRequest<
        Req extends ZodObject<{
            method: ZodLiteral<string>;
        }>,
        Res extends ZodObject<{}>,
    >(requestSchema: Req, resultSchema: Res) {
        this.setRequestHandler(requestSchema, async (request, extra) => {
            console.log(`Forwarding request ${request.method} from MCP UI client`);
            return this._client.request(request, resultSchema, {
                signal: extra.signal,
            });
        });
    }
    private forwardNotification<
        N extends ZodObject<{ method: ZodLiteral<string> }>,
    >(notificationSchema: N) {
        this.setNotificationHandler(notificationSchema, async (notification) => {
            console.log(
                `Forwarding notification ${notification.method} from MCP UI client`,
            );
            await this._client.notification(notification);
        });
    }

    override async connect(transport: Transport) {
        const serverCapabilities = this._client.getServerCapabilities();
        if (!serverCapabilities) {
            throw new Error("Client server capabilities not available");
        }

        if (serverCapabilities.tools) {
            this.forwardRequest(CallToolRequestSchema, CallToolResultSchema);
            if (serverCapabilities.tools.listChanged) {
                this.forwardNotification(ToolListChangedNotificationSchema);
            }
        }
        if (serverCapabilities.resources) {
            this.forwardRequest(
                ListResourcesRequestSchema,
                ListResourcesResultSchema,
            );
            this.forwardRequest(
                ListResourceTemplatesRequestSchema,
                ListResourceTemplatesResultSchema,
            );
            this.forwardRequest(ReadResourceRequestSchema, ReadResourceResultSchema);
            if (serverCapabilities.resources.listChanged) {
                this.forwardNotification(ResourceListChangedNotificationSchema);
            }
        }
        if (serverCapabilities.prompts) {
            this.forwardRequest(ListPromptsRequestSchema, ListPromptsResultSchema);
            if (serverCapabilities.prompts.listChanged) {
                this.forwardNotification(PromptListChangedNotificationSchema);
            }
        }

        return super.connect(transport);
    }
}

function deepEqual(a: any, b: any): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
