import WebSocket from 'ws';
import { BaseExchange } from './base';
import {BLACKLIST} from "../config.ts";

export class BinanceExchange extends BaseExchange {
  private pendingSubscriptions: string[] = [];
  private readonly BATCH_SIZE = 20; // Maximum symbols per subscription request
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to Binance WebSocket');
      // Send any pending subscriptions once connected
      if (this.pendingSubscriptions.length > 0) {
        this.sendSubscriptions(this.pendingSubscriptions);
        this.pendingSubscriptions = [];
      }
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Binance WebSocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('Binance WebSocket connection closed. Attempting to reconnect...');
      setTimeout(() => this.connect(), 5000); // Reconnect after 5 seconds
    });
  }

  private async sendSubscriptions(symbols: string[]): Promise<void> {
    const formattedSymbols = symbols.map(symbol =>
      symbol.toLowerCase().replace('/', '')
    );

    // Store all symbols for potential resubscription
    this.pendingSubscriptions = formattedSymbols;

    // Calculate total number of batches
    const totalBatches = Math.ceil(formattedSymbols.length / this.BATCH_SIZE);
    console.log(`Starting subscription of ${formattedSymbols.length} symbols in ${totalBatches} batches`);

    // Process symbols in batches
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * this.BATCH_SIZE;
      const endIndex = Math.min(startIndex + this.BATCH_SIZE, formattedSymbols.length);
      const batch = formattedSymbols.slice(startIndex, endIndex);
      
      if (batch.length === 0) continue;

      const subscriptions = batch.map(symbol => `${symbol}@ticker`);

      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: subscriptions,
        id: batchIndex + 1,
      };

      try {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(subscribeMsg));
          console.log(`Subscribed to batch ${batchIndex + 1}/${totalBatches} (${batch.length} symbols)`);
          
          // Add delay between batches to avoid rate limiting
          if (batchIndex < totalBatches - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      } catch (error) {
        console.error(`Error sending subscription batch ${batchIndex + 1}:`, error);
      }
    }
  }

  async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Store subscriptions to be sent when connection is ready
      this.pendingSubscriptions = symbols;
      return;
    }
    await this.sendSubscriptions(symbols);
  }

  handleMessage(message: Buffer): void {
    // console.log(`Binance websocket data: ${message}`)
    try {
      const data = JSON.parse(message.toString());
      if (data.e === '24hrTicker') {
        const symbol = data.s;
        const price = parseFloat(data.c);
        this.updatePrice(symbol, price);
      } else {
        console.error('Binance WebSocket error:', message.toString());
      }
    } catch (error) {
      console.error('Error handling Binance message:', error);
    }
  }

  async fetchTradingPairs(): Promise<string[]> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await this.makeRequest('/api/v3/exchangeInfo');

        if (!response || !response.symbols) {
          throw new Error('Invalid response format from Binance API');
        }

        const pairs = response.symbols
            .filter((symbol: any) => symbol.status === 'TRADING')
            .filter((symbol: any) => symbol.quoteAsset === 'USDT')
            .filter((symbol: any) => !BLACKLIST.includes(symbol.baseAsset))
            .map((symbol: any) => {
              const pair = `${symbol.baseAsset}/${symbol.quoteAsset}`;
              this.tradingPairs.add(pair);
              return pair;
            });

        console.log(`Fetched ${pairs.length} trading pairs from Binance`);
        return pairs;
      } catch (error) {
        retryCount++;
        console.error(`Error fetching Binance trading pairs (attempt ${retryCount}/${maxRetries}):`, error);

        if (retryCount === maxRetries) {
          console.error('Max retries reached, returning empty array');
          return [];
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return [];
  }
}