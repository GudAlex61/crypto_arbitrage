import WebSocket from 'ws';
import { BaseExchange } from './base';
import { BLACKLIST } from '../config';
import { MarketType, OrderBook } from '../types';

export class BinanceExchange extends BaseExchange {
  connect(): void {
    this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
    this.setupWebSocket(this.spotWs, MarketType.SPOT);

    this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
    this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    ws.on('open', () => {
      console.log(`[Binance] Connected ${marketType} WebSocket`);
      this.sendSubscriptions(marketType);
    });

    ws.on('message', (data: Buffer) => this.handleMessage(data, marketType));
    ws.on('error', (err) => console.error(`[Binance] ${marketType} WS error:`, err));

    ws.on('close', () => {
      console.log(`[Binance] ${marketType} WS closed, reconnecting...`);
      setTimeout(() => {
        const endpoint = marketType === MarketType.SPOT ? this.config.wsSpotEndpoint : this.config.wsFuturesEndpoint;
        const next = new WebSocket(endpoint);
        if (marketType === MarketType.SPOT) this.spotWs = next;
        else this.futuresWs = next;
        this.setupWebSocket(next, marketType);
      }, 5000);
    });
  }

  private sendSubscriptions(marketType: MarketType): void {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['!bookTicker'], id: Date.now() }));
    console.log(`[Binance] Subscribed to !bookTicker (${marketType})`);
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
    this.sendSubscriptions(marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (!item?.s) continue;
        const bid = parseFloat(item.b ?? item.bidPrice);
        const ask = parseFloat(item.a ?? item.askPrice);
        if (bid > 0 && ask > 0) this.updatePrice(item.s, bid, ask, marketType);
      }
    } catch (err) {
      console.error(`[Binance] message parse error (${marketType}):`, err);
    }
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    const endpoint = marketType === MarketType.SPOT ? '/api/v3/ticker/bookTicker' : '/fapi/v1/ticker/bookTicker';
    const response = await this.makeRequest(endpoint, 'GET', {}, marketType);
    if (!Array.isArray(response)) return;

    for (const ticker of response) {
      const bid = parseFloat(ticker.bidPrice);
      const ask = parseFloat(ticker.askPrice);
      if (ticker.symbol && this.isUsdtPairSymbol(ticker.symbol)) this.updatePrice(ticker.symbol, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    const endpoint = marketType === MarketType.SPOT ? '/api/v3/depth' : '/fapi/v1/depth';
    const response = await this.makeRequest(endpoint, 'GET', { symbol: this.compactSymbol(symbol), limit }, marketType);
    return this.buildOrderBook(symbol, marketType, response?.bids, response?.asks);
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const endpoint = marketType === MarketType.SPOT ? '/api/v3/exchangeInfo' : '/fapi/v1/exchangeInfo';
        const response = await this.makeRequest(endpoint, 'GET', {}, marketType);
        if (!response?.symbols) throw new Error('Invalid response from Binance exchangeInfo');

        const pairs = response.symbols
          .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
          .filter((s: any) => !BLACKLIST.includes(String(s.baseAsset).toUpperCase()))
          .map((s: any) => this.addTradingPair(`${s.baseAsset}/USDT`, marketType));

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[Binance] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[Binance] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
