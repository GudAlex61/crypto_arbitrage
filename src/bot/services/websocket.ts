import express from 'express';
import expressWs from 'express-ws';
import { WebSocket } from 'ws';
import { ArbitrageOpportunity } from '../types';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import fs from 'fs';

export class WebSocketService {
  private app;
  private wsInstance;
  private clients: Set<WebSocket> = new Set();
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  constructor(private port: number = 3001) {
    this.app = express();
    this.wsInstance = expressWs(this.app);
    this.setupWebSocketServer();
    this.setupStaticRoutes();
  }

  private setupStaticRoutes() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const publicPath = path.join(__dirname, '..', '..', '..', 'public');
    
    this.app.use(express.static(publicPath));
    
    this.app.get('/', (req, res) => {
      const template = fs.readFileSync(path.join(publicPath, 'index.html'), 'utf-8');
      const compiledTemplate = Handlebars.compile(template);
      res.send(compiledTemplate({}));
    });
  }

  private setupWebSocketServer() {
    this.app.ws('/arbitrage', (ws: WebSocket) => {
      console.log('Client connected to arbitrage WebSocket');
      this.clients.add(ws);

      // Setup heartbeat
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, this.HEARTBEAT_INTERVAL);

      ws.on('close', () => {
        console.log('Client disconnected from arbitrage WebSocket');
        this.clients.delete(ws);
        clearInterval(heartbeat);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
        clearInterval(heartbeat);
      });

      // Send initial message
      ws.send(JSON.stringify({
        type: 'info',
        message: 'Connected to arbitrage opportunities stream'
      }));
    });

    this.app.listen(this.port, () => {
      console.log(`WebSocket server is running on port ${this.port}`);
      console.log(`Dashboard available at http://localhost:${this.port}`);
    });
  }

  public broadcastOpportunity(opportunity: ArbitrageOpportunity) {
    const message = JSON.stringify({
      type: 'opportunity',
      data: opportunity,
      timestamp: Date.now()
    });

    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}