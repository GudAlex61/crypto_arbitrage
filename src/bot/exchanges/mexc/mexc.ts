import WebSocket from 'ws';
import { BaseExchange } from '../base.ts';

export class MEXCExchange extends BaseExchange {
  private pendingSubscriptions: string[] = [];
  private readonly BATCH_SIZE = 10; // Maximum symbols per subscription request

  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to MEXC WebSocket');
      if (this.pendingSubscriptions.length > 0) {
        this.sendSubscriptions(this.pendingSubscriptions);
        this.pendingSubscriptions = [];
      }
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('MEXC WebSocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('MEXC WebSocket connection closed. Attempting to reconnect...');
      setTimeout(() => this.connect(), 5000);
    });
  }

  private async sendSubscriptions(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not ready, queueing subscriptions');
      return;
    }

    const formattedSymbols = symbols.map(symbol =>
        symbol.replace('/', '').toLowerCase()
    );

    // Split symbols into batches
    for (let i = 0; i < formattedSymbols.length; i += this.BATCH_SIZE) {
      const batch = formattedSymbols.slice(i, i + this.BATCH_SIZE);
      const subscribeMsg = {
        method: 'SUBSCRIPTION',
        params: batch.map(symbol => `spot@public.kline.v3.api@${symbol.toUpperCase()}@Min1`),
      };

      try {
        this.ws.send(JSON.stringify(subscribeMsg));
        console.log(`Subscribed to batch of ${batch.length} symbols on MEXC (${i + 1}-${Math.min(i + this.BATCH_SIZE, formattedSymbols.length)} of ${formattedSymbols.length})`);

        // Add a small delay between batches to avoid rate limiting
        if (i + this.BATCH_SIZE < formattedSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('Error sending subscription message:', error);
      }
    }
  }

  async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingSubscriptions = symbols;
      return;
    }
    await this.sendSubscriptions(symbols);
  }

  handleMessage(message: Buffer): void {
    try {
      const data = JSON.parse(message.toString());
      if (data.c?.startsWith('spot@public.kline.v3.api@')) {
        // console.log(`Mexc success message `, data)
        const symbol = data.s;
        const price = parseFloat(data.d.k.c);
        this.updatePrice(symbol, price);
      } else {
        console.error('Error handling MEXC message:', message.toString());
      }
    } catch (error) {
      console.error('Error handling MEXC message:', error);
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
}