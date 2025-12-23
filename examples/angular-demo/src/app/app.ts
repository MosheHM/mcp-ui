import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppRendererComponent } from '@mcp-ui/angular-client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AppRendererComponent],
  template: `
    <div style="height: 100vh; display: flex; flex-direction: column;">
      <h1>Angular MCP App Demo</h1>
      <div style="flex: 1; border: 1px solid #ccc; margin: 20px;">
        <mcp-app-renderer
          [sandbox]="{ url: sandboxProxyUrl }"
          [client]="client"
          [toolName]="toolName"
          [toolResourceUri]="toolResourceUri"
        ></mcp-app-renderer>
      </div>
    </div>
  `,
})
export class AppComponent {
  sandboxProxyUrl = new URL('http://localhost:4200/assets/sandbox-proxy.html');
  client: Client;
  toolName = 'weather_dashboard';
  toolResourceUri = 'ui://weather-server/dashboard-template';

  constructor() {
    // Mock client for demo purposes
    this.client = new Client(
      { name: 'AngularDemo', version: '1.0.0' },
      { capabilities: {} }
    );
    // In a real app, you would connect the client here
    // this.client.connect(new WebSocketTransport(...));
  }

  handleError(error: Error) {
    console.error('MCP App Error:', error);
  }
}
