import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Transport for communicating between a host and a guest UI in an iframe via postMessage.
 */
export class PostMessageTransport implements Transport {
    private _onclose?: () => void;
    private _onerror?: (error: Error) => void;
    private _onmessage?: (message: JSONRPCMessage) => void;
    private _boundHandler: (event: MessageEvent) => void;

    /**
     * Create a new PostMessageTransport.
     *
     * @param _targetWindow - The window to send messages to (e.g., iframe.contentWindow)
     * @param _sourceWindow - The window to receive messages from (e.g., window)
     * @param _targetOrigin - The expected origin of the target window (default: "*")
     */
    constructor(
        private _targetWindow: Window,
        private _sourceWindow: Window,
        private _targetOrigin: string = "*",
    ) {
        this._boundHandler = this._handleMessage.bind(this);
    }

    async start(): Promise<void> {
        this._sourceWindow.addEventListener("message", this._boundHandler);
    }

    async close(): Promise<void> {
        this._sourceWindow.removeEventListener("message", this._boundHandler);
        this._onclose?.();
    }

    async send(message: JSONRPCMessage): Promise<void> {
        this._targetWindow.postMessage(message, this._targetOrigin);
    }

    set onclose(callback: () => void) {
        this._onclose = callback;
    }

    set onerror(callback: (error: Error) => void) {
        this._onerror = callback;
    }

    set onmessage(callback: (message: JSONRPCMessage) => void) {
        this._onmessage = callback;
    }

    private _handleMessage(event: MessageEvent) {
        if (event.source !== this._targetWindow) {
            return;
        }

        // Basic validation to ensure it's a JSON-RPC message
        if (
            event.data &&
            typeof event.data === "object" &&
            ("jsonrpc" in event.data || "method" in event.data || "id" in event.data)
        ) {
            this._onmessage?.(event.data as JSONRPCMessage);
        }
    }
}
