import WebSocket from 'ws';
import { BaseExchange } from './base';
import { MarketType, OrderBook } from '../types';
import { BLACKLIST } from '../config';

export class OKXExchange extends BaseExchange {
  private readonly BATCH_SIZE = 100;

  connect(): void {
    this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
    this.setupWebSocket(this.spotWs, MarketType.SPOT);

    this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
    this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    ws.on('open', () => {
      console.log(`[OKX] Connected ${marketType} WebSocket`);
      void this.sendSubscriptions(this.getDesiredSubscriptions(marketType), marketType);
    });
    ws.on('message', (data: Buffer) => this.handleMessage(data, marketType));
    ws.on('error', (err) => console.error(`[OKX] ${marketType} WS error:`, err));
    ws.on('close', () => {
      console.log(`[OKX] ${marketType} WS closed, reconnecting...`);
      setTimeout(() => {
        const next = new WebSocket(marketType === MarketType.SPOT ? this.config.wsSpotEndpoint : this.config.wsFuturesEndpoint);
        if (marketType === MarketType.SPOT) this.spotWs = next;
        else this.futuresWs = next;
        this.setupWebSocket(next, marketType);
      }, 5000);
    });
  }

  private toOKXSymbol(pair: string, marketType: MarketType): string {
    const base = pair.replace('/', '-');
    return marketType === MarketType.FUTURES ? `${base}-SWAP` : base;
  }

  private async sendSubscriptions(symbols: string[], marketType: MarketType): Promise<void> {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!symbols.length || !ws || ws.readyState !== WebSocket.OPEN) return;

    const args = symbols.map((s) => ({ channel: 'tickers', instId: this.toOKXSymbol(s, marketType) }));
    for (let i = 0; i < args.length; i += this.BATCH_SIZE) {
      const batch = args.slice(i, i + this.BATCH_SIZE);
      ws.send(JSON.stringify({ op: 'subscribe', args: batch }));
      if (i + this.BATCH_SIZE < args.length) await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`[OKX] Subscribed to ${symbols.length} ${marketType} tickers`);
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
    await this.sendSubscriptions(symbols, marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      if (data.event === 'subscribe' || data.event === 'error') return;
      if (data.arg?.channel !== 'tickers' || !data.data?.length) return;

      for (const item of data.data) {
        const bid = parseFloat(item.bidPx);
        const ask = parseFloat(item.askPx);
        if (bid > 0 && ask > 0) this.updatePrice(item.instId, bid, ask, marketType);
      }
    } catch (err) {
      console.error(`[OKX] message parse error (${marketType}):`, err);
    }
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    const instType = marketType === MarketType.SPOT ? 'SPOT' : 'SWAP';
    const response = await this.makeRequest('/api/v5/market/tickers', 'GET', { instType }, marketType);
    const list = response?.data;
    if (!Array.isArray(list)) return;

    for (const ticker of list) {
      const instId = String(ticker.instId || '');
      if (marketType === MarketType.SPOT && !instId.endsWith('-USDT')) continue;
      if (marketType === MarketType.FUTURES && !instId.endsWith('-USDT-SWAP')) continue;
      const bid = parseFloat(ticker.bidPx);
      const ask = parseFloat(ticker.askPx);
      this.updatePrice(instId, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    const response = await this.makeRequest('/api/v5/market/books', 'GET', {
      instId: this.toOKXSymbol(symbol, marketType),
      sz: limit,
    }, marketType);
    const book = Array.isArray(response?.data) ? response.data[0] : null;
    return this.buildOrderBook(symbol, marketType, book?.bids, book?.asks);
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const instType = marketType === MarketType.SPOT ? 'SPOT' : 'SWAP';
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.makeRequest('/api/v5/public/instruments', 'GET', { instType }, marketType);
        if (!response?.data) throw new Error('Invalid OKX instruments response');

        const pairs = response.data
          .filter((s: any) => s.state === 'live')
          .filter((s: any) => (marketType === MarketType.SPOT ? s.quoteCcy === 'USDT' : s.settleCcy === 'USDT' && String(s.instId).endsWith('-USDT-SWAP')))
          .filter((s: any) => {
            const base = marketType === MarketType.SPOT ? s.baseCcy : s.ctValCcy;
            return base && !BLACKLIST.includes(String(base).toUpperCase());
          })
          .map((s: any) => {
            const base = marketType === MarketType.SPOT ? s.baseCcy : s.ctValCcy;
            const pair = this.addTradingPair(`${base}/USDT`, marketType);
            if (marketType === MarketType.FUTURES) {
              this.setOrderBookQuantityMultiplier(pair, marketType, parseFloat(s.ctVal || '1'));
            }
            return pair;
          });

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[OKX] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[OKX] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
