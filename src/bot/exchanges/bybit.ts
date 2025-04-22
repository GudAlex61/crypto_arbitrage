import WebSocket from 'ws';
import { BaseExchange } from './base';
import { MarketType } from '../types';

export class BybitExchange extends BaseExchange {
  private pendingSubscriptions: { spot: string[], futures: string[] } = { spot: [], futures: [] };
  private readonly BATCH_SIZE = 10; // Maximum symbols per subscription request

  connect(): void {
    // Connect to spot market
    this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
    this.setupWebSocket(this.spotWs, MarketType.SPOT);

    // Connect to futures market
    this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
    this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    ws.on('open', () => {
      console.log(`Connected to Bybit ${marketType} WebSocket`);
      if (this.pendingSubscriptions[marketType].length > 0) {
        this.sendSubscriptions(this.pendingSubscriptions[marketType], marketType);
        this.pendingSubscriptions[marketType] = [];
      }
    });

    ws.on('message', (data:Buffer) => {
      this.handleMessage(data, marketType);
    });

    ws.on('error', (error) => {
      console.error(`Bybit ${marketType} WebSocket error:`, error);
    });

    ws.on('close', () => {
      console.log(`Bybit ${marketType} WebSocket connection closed. Attempting to reconnect...`);
      setTimeout(() => {
        if (marketType === MarketType.SPOT) {
          this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
          this.setupWebSocket(this.spotWs, MarketType.SPOT);
        } else {
          this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
          this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
        }
      }, 5000);
    });
  }

  private async sendSubscriptions(symbols: string[], marketType: MarketType): Promise<void> {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log(`WebSocket not ready, queueing ${marketType} subscriptions`);
      this.pendingSubscriptions[marketType] = symbols;
      return;
    }

    const formattedSymbols = symbols.map(symbol =>
      symbol.replace('/', '').toUpperCase()
    );

    // Split symbols into batches
    for (let i = 0; i < formattedSymbols.length; i += this.BATCH_SIZE) {
      const batch = formattedSymbols.slice(i, i + this.BATCH_SIZE);
      const subscribeMsg = {
        op: 'subscribe',
        args: batch.map(symbol => `tickers.${symbol}`),
      };

      try {
        ws.send(JSON.stringify(subscribeMsg));
        console.log(`Subscribed to batch of ${batch.length} ${marketType} symbols on Bybit (${i + 1}-${Math.min(i + this.BATCH_SIZE, formattedSymbols.length)} of ${formattedSymbols.length})`);

        // Add a small delay between batches to avoid rate limiting
        if (i + this.BATCH_SIZE < formattedSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`Error sending ${marketType} subscription message:`, error);
      }
    }
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    await this.sendSubscriptions(symbols, marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      if (data.topic?.startsWith('tickers.')) {
        const symbol = data.data.symbol;
        const price = parseFloat(data.data.lastPrice);
        this.updatePrice(symbol, price, marketType);
      } else {
        console.error(`Wrong Bybit ${marketType} message:`, message.toString());
      }
    } catch (error) {
      console.error(`Error handling Bybit ${marketType} message:`, error);
    }
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await this.makeRequest('/v5/market/instruments-info', 'GET', {
          category: marketType === MarketType.SPOT ? 'spot' : 'linear'
        }, marketType);

        if (!response || !response.result || !response.result.list) {
          throw new Error('Invalid response format from Bybit API');
        }

        const pairs = response.result.list
          .filter((symbol: any) => symbol.status === 'Trading')
          .map((symbol: any) => {
            const pair = `${symbol.baseCoin}/${symbol.quoteCoin}`;
            if (marketType === MarketType.SPOT) {
              this.spotTradingPairs.add(pair);
            } else {
              this.futuresTradingPairs.add(pair);
            }
            return pair;
          });

        console.log(`Fetched ${pairs.length} ${marketType} trading pairs from Bybit`);
        return pairs;
      } catch (error) {
        retryCount++;
        console.error(`Error fetching Bybit ${marketType} trading pairs (attempt ${retryCount}/${maxRetries}):`, error);

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