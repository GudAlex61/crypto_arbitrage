import WebSocket from 'ws';
import { BaseExchange } from '../base.ts';
import {PushDataV3ApiWrapper, PushDataV3ApiWrapperSchema} from "./proto/pb/PushDataV3ApiWrapper_pb";
import {fromBinary} from "@bufbuild/protobuf";
import {PublicSpotKlineV3Api} from "./proto/pb/PublicSpotKlineV3Api_pb.ts";

export class MEXCExchange extends BaseExchange {
  private connections: WebSocket[] = [];
  private pendingSubscriptions: string[] = [];
  private readonly BATCH_SIZE = 20; // Maximum symbols per WebSocket connection
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  connect(): void {

    if (this.pendingSubscriptions.length > 0) {
      this.sendSubscriptions(this.pendingSubscriptions);
      this.pendingSubscriptions = [];
    }
  }

  private createConnection(): WebSocket {
    const ws = new WebSocket(this.config.wsEndpoint);

    ws.on('error', (error) => {
      console.error('MEXC WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('MEXC WebSocket connection closed. Attempting to reconnect...');
      this.handleReconnect(ws);
    });

    return ws;
  }

  private async handleReconnect(ws: WebSocket, attempt = 0) {
    if (attempt >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached for MEXC WebSocket');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));

    const index = this.connections.indexOf(ws);
    if (index !== -1) {
      const newWs = this.createConnection();
      this.connections[index] = newWs;

      // Wait for connection to be established
      await new Promise<void>(resolve => {
        newWs.once('open', () => {
          // Resubscribe to the batch that was assigned to this connection
          const startIndex = index * this.BATCH_SIZE;
          const batch = this.pendingSubscriptions.slice(startIndex, startIndex + this.BATCH_SIZE);
          if (batch.length > 0) {
            this.subscribeBatch(newWs, batch, index + 1);
          }
          resolve();
        });
      });
    }
  }

  private async sendSubscriptions(symbols: string[]): Promise<void> {
    const formattedSymbols = symbols.map(symbol =>
        symbol.replace('/', '').toUpperCase()
    );

    // Store all symbols for potential resubscription
    this.pendingSubscriptions = formattedSymbols;

    // Calculate total number of connections needed
    const totalConnections = Math.ceil(formattedSymbols.length / this.BATCH_SIZE);

    // Create separate WebSocket connections for each batch
    for (let i = 0; i < totalConnections; i++) {
      const ws = this.createConnection();
      this.connections.push(ws);

      // Wait for connection to be established
      await new Promise<void>(resolve => {
        ws.once('open', () => {
          const startIndex = i * this.BATCH_SIZE;
          const batch = formattedSymbols.slice(startIndex, startIndex + this.BATCH_SIZE);
          this.subscribeBatch(ws, batch, i + 1);
          resolve();
        });
      });

      // Add delay between creating connections to avoid rate limiting
      if (i < totalConnections - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  private subscribeBatch(ws: WebSocket, symbols: string[], batchNumber: number): void {
    const subscribeMsg = {
      method: 'SUBSCRIPTION',
      params: symbols.map(symbol => `spot@public.kline.v3.api.pb@${symbol}@Min1`),
    };

    try {
      ws.send(JSON.stringify(subscribeMsg));
      console.log(`MEXC WebSocket ${batchNumber}: Subscribed to ${symbols.length} symbols`);

      // Set up message handler for this connection
      ws.on('message', (data: string) => {
        this.handleMessage(data);
      });
    } catch (error) {
      console.error(`Error sending subscription message for batch ${batchNumber}:`, error);
    }
  }

  async subscribeToSymbols(symbols: string[]): Promise<void> {
    // Clean up existing connections
    this.disconnect();
    this.connections = [];

    await this.sendSubscriptions(symbols);
  }

  handleMessage(message: Buffer): void {
    try {
      const resp: PushDataV3ApiWrapper = fromBinary(PushDataV3ApiWrapperSchema, message);
      if (resp.body.case === 'publicSpotKline') {
        const symbol = resp.symbol as string;
        const price = parseFloat((resp.body.value as PublicSpotKlineV3Api).closingPrice);
        this.updatePrice(symbol, price);
      } else {
        console.error('Wrong MEXC message:', resp);
      }
    } catch (error) {
      try {
        const jsonData = JSON.parse(message.toString());
        console.log(jsonData);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (jsonError) {
        console.error('Error handling MEXC message:', error);
      }
    }
  }

  async fetchTradingPairs(): Promise<string[]> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await this.makeRequest('/api/v3/exchangeInfo');

        if (!response || !response.symbols) {
          throw new Error('Invalid response format from MEXC API');
        }

        const pairs = response.symbols
            .filter((symbol: any) => symbol.status === '1')
            .map((symbol: any) => {
              const pair = `${symbol.baseAsset}/${symbol.quoteAsset}`;
              this.tradingPairs.add(pair);
              return pair;
            });

        console.log(`Fetched ${pairs.length} trading pairs from MEXC`);
        return pairs;
      } catch (error) {
        retryCount++;
        console.error(`Error fetching MEXC trading pairs (attempt ${retryCount}/${maxRetries}):`, error);

        if (retryCount === maxRetries) {
          console.error('Max retries reached, returning empty array');
          return [];
        }

        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return [];
  }

  public disconnect() {
    for (const ws of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    this.connections = [];
  }
}