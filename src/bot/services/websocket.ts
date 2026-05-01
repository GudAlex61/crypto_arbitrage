import express, { Request, Response } from 'express';
import expressWs from 'express-ws';
import { WebSocket } from 'ws';
import { ArbitrageOpportunity } from '../types';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';
import fs from 'fs';

interface DashboardStatusPayload {
  commonSpotPairs: number;
  commonFuturesPairs: number;
  exchanges: unknown[];
  telegramEnabled: boolean;
  minNetProfitPct?: number;
  maxNetProfitPct?: number;
  orderBookEnabled?: boolean;
  orderBookTradeAmountUSDT?: number;
  orderBookDepthLimit?: number;
  orderBookVerificationLimit?: number;
  orderBookConcurrency?: number;
  orderBookFetchTimeoutMs?: number;
  priceUpdateIntervalMs?: number;
  isChecking?: boolean;
  manualRefreshQueued?: boolean;
  lastCheckStartedAt?: number;
  lastCheckFinishedAt?: number;
  lastCheckDurationMs?: number;
  lastCheckReason?: string;
  skippedAutoCycles?: number;
  timestamp: number;
}

type ManualRefreshResult = {
  accepted: boolean;
  running: boolean;
  queued: boolean;
  message: string;
  lastCheckStartedAt?: number;
  lastCheckFinishedAt?: number;
};

type ManualRefreshHandler = () => ManualRefreshResult | Promise<ManualRefreshResult>;

export class WebSocketService {
  private app: express.Application;
  private wsInstance: any;
  private clients: Set<WebSocket> = new Set();
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly MAX_HISTORY_PER_MARKET = 300;
  private readonly MAX_OPPORTUNITY_AGE_MS = 3 * 60 * 1000;
  private opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private lastStatus: DashboardStatusPayload | null = null;
  private manualRefreshHandler: ManualRefreshHandler | null = null;

  constructor(private port: number = 3001) {
    this.app = express();
    this.wsInstance = expressWs(this.app);
    this.setupWebSocketServer();
    this.setupStaticRoutes();
  }

  public setManualRefreshHandler(handler: ManualRefreshHandler): void {
    this.manualRefreshHandler = handler;
  }

  private setupStaticRoutes(): void {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const publicPath = path.join(__dirname, '..', '..', '..', 'public');

    this.app.use(express.json());
    this.app.use(express.static(publicPath));

    this.app.post('/api/refresh', async (_req: Request, res: Response) => {
      if (!this.manualRefreshHandler) {
        res.status(503).json({ accepted: false, running: false, queued: false, message: 'Manual refresh is not ready yet.' });
        return;
      }

      try {
        const result = await this.manualRefreshHandler();
        res.json({ ...result, timestamp: Date.now() });
      } catch (error: any) {
        console.error('[WebSocketService] manual refresh failed:', error);
        res.status(500).json({
          accepted: false,
          running: false,
          queued: false,
          message: error?.message || 'Manual refresh failed.',
          timestamp: Date.now(),
        });
      }
    });

    this.app.get('/', (_req: Request, res: Response) => {
      const template = fs.readFileSync(path.join(publicPath, 'index.html'), 'utf-8');
      const compiledTemplate = Handlebars.compile(template);
      res.send(compiledTemplate({}));
    });
  }

  private setupWebSocketServer(): void {
    this.app.ws('/arbitrage', (ws: WebSocket) => {
      console.log('Client connected to arbitrage WebSocket');
      this.clients.add(ws);

      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
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

      this.send(ws, { type: 'info', message: 'Connected to arbitrage opportunities stream' });
      this.send(ws, { type: 'snapshot', data: Array.from(this.opportunities.values()), timestamp: Date.now() });
      if (this.lastStatus) this.send(ws, { type: 'status', data: this.lastStatus, timestamp: Date.now() });
    });

    this.app.listen(this.port, () => {
      console.log(`WebSocket server is running on port ${this.port}`);
      console.log(`Dashboard available at http://localhost:${this.port}`);
    });
  }

  public broadcastOpportunity(opportunity: ArbitrageOpportunity): void {
    const payload: ArbitrageOpportunity = {
      ...opportunity,
      profitPercentage: opportunity.netProfitPct,
    };

    const key = `${payload.marketType}:${payload.symbol}:${payload.buyExchange}:${payload.sellExchange}`;
    this.opportunities.set(key, payload);
    this.trimHistory(payload.marketType);

    this.broadcast({ type: 'opportunity', data: payload, timestamp: Date.now() });
  }

  public broadcastStatus(status: DashboardStatusPayload): void {
    this.lastStatus = status;
    this.broadcast({ type: 'status', data: status, timestamp: Date.now() });
  }

  private trimHistory(marketType: string): void {
    const entries = Array.from(this.opportunities.entries())
      .filter(([, opp]) => opp.marketType === marketType)
      .sort(([, a], [, b]) => b.timestamp - a.timestamp);

    const now = Date.now();
    for (const [key, opp] of entries) {
      if (now - opp.timestamp > this.MAX_OPPORTUNITY_AGE_MS) this.opportunities.delete(key);
    }

    for (const [key] of entries.slice(this.MAX_HISTORY_PER_MARKET)) this.opportunities.delete(key);
  }

  private broadcast(message: unknown): void {
    const serialized = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(serialized);
    });
  }

  private send(client: WebSocket, message: unknown): void {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  }

  public getConnectedClientsCount(): number {
    return this.clients.size;
  }
}
