import WebSocket from 'ws';
import { BaseExchange } from './base';
import { MarketType, OrderBook } from '../types';
import { BLACKLIST } from '../config';

export class BybitExchange extends BaseExchange {
  private readonly BATCH_SIZE = 10;

  connect(): void {
    this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
    this.setupWebSocket(this.spotWs, MarketType.SPOT);

    this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
    this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    ws.on('open', () => {
      console.log(`[Bybit] Connected ${marketType} WebSocket`);
      void this.sendSubscriptions(this.getDesiredSubscriptions(marketType), marketType);
    });

    ws.on('message', (data: Buffer) => this.handleMessage(data, marketType));
    ws.on('error', (err) => console.error(`[Bybit] ${marketType} WS error:`, err));
    ws.on('close', () => {
      console.log(`[Bybit] ${marketType} WS closed, reconnecting...`);
      setTimeout(() => {
        const endpoint = marketType === MarketType.SPOT ? this.config.wsSpotEndpoint : this.config.wsFuturesEndpoint;
        const next = new WebSocket(endpoint);
        if (marketType === MarketType.SPOT) this.spotWs = next;
        else this.futuresWs = next;
        this.setupWebSocket(next, marketType);
      }, 5000);
    });
  }

  private async sendSubscriptions(symbols: string[], marketType: MarketType): Promise<void> {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!symbols.length || !ws || ws.readyState !== WebSocket.OPEN) return;

    const formatted = symbols.map((s) => this.normalizeSymbolKey(s));
    for (let i = 0; i < formatted.length; i += this.BATCH_SIZE) {
      const batch = formatted.slice(i, i + this.BATCH_SIZE);
      ws.send(JSON.stringify({ op: 'subscribe', args: batch.map((s) => `tickers.${s}`) }));
      if (i + this.BATCH_SIZE < formatted.length) await new Promise((r) => setTimeout(r, 100));
    }
    console.log(`[Bybit] Subscribed to ${formatted.length} ${marketType} tickers`);
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
    await this.sendSubscriptions(symbols, marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      if (!data.topic?.startsWith('tickers.')) return;

      const d = data.data;
      const bid = parseFloat(d.bid1Price);
      const ask = parseFloat(d.ask1Price);
      if (bid > 0 && ask > 0) this.updatePrice(d.symbol, bid, ask, marketType);
    } catch (err) {
      console.error(`[Bybit] message parse error (${marketType}):`, err);
    }
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    const response = await this.makeRequest('/v5/market/tickers', 'GET', { category: marketType === MarketType.SPOT ? 'spot' : 'linear' }, marketType);
    const list = response?.result?.list;
    if (!Array.isArray(list)) return;

    for (const ticker of list) {
      const bid = parseFloat(ticker.bid1Price);
      const ask = parseFloat(ticker.ask1Price);
      if (ticker.symbol && this.isUsdtPairSymbol(ticker.symbol)) this.updatePrice(ticker.symbol, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    const response = await this.makeRequest('/v5/market/orderbook', 'GET', {
      category: marketType === MarketType.SPOT ? 'spot' : 'linear',
      symbol: this.compactSymbol(symbol),
      limit,
    }, marketType);
    return this.buildOrderBook(symbol, marketType, response?.result?.b, response?.result?.a);
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.makeRequest('/v5/market/instruments-info', 'GET', { category: marketType === MarketType.SPOT ? 'spot' : 'linear' }, marketType);
        if (!response?.result?.list) throw new Error('Invalid Bybit response');

        const pairs = response.result.list
          .filter((s: any) => s.status === 'Trading' && s.quoteCoin === 'USDT')
          .filter((s: any) => !BLACKLIST.includes(String(s.baseCoin).toUpperCase()))
          .map((s: any) => this.addTradingPair(`${s.baseCoin}/USDT`, marketType));

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[Bybit] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[Bybit] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
