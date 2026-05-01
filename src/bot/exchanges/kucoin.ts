import axios from 'axios';
import WebSocket from 'ws';
import { BaseExchange } from './base';
import { MarketType, OrderBook } from '../types';
import { BLACKLIST } from '../config';

export class KuCoinExchange extends BaseExchange {
  private readonly BATCH_SIZE = 50;
  private futuresPairToContract = new Map<string, string>();
  private futuresContractToPair = new Map<string, string>();

  connect(): void {
    void this.initConnection(MarketType.SPOT);
    void this.initConnection(MarketType.FUTURES);
  }

  private async initConnection(marketType: MarketType): Promise<void> {
    try {
      const { token, endpoint } = await this.fetchWsToken(marketType);
      const ws = new WebSocket(`${endpoint}?token=${token}`);
      if (marketType === MarketType.SPOT) this.spotWs = ws;
      else this.futuresWs = ws;
      this.setupWebSocket(ws, marketType);
    } catch (err) {
      console.error(`[KuCoin] initConnection ${marketType} failed:`, err);
      setTimeout(() => this.initConnection(marketType), 5000);
    }
  }

  private async fetchWsToken(marketType: MarketType): Promise<{ token: string; endpoint: string }> {
    const url = marketType === MarketType.SPOT
      ? `${this.config.restSpotEndpoint}/api/v1/bullet-public`
      : `${this.config.restFuturesEndpoint}/api/v1/bullet-public`;

    const response = await axios.post(url, undefined, { timeout: 15_000 });
    const data = response.data?.data;
    if (!data?.token || !data?.instanceServers?.length) throw new Error('Invalid KuCoin bullet-public response');
    return { token: data.token, endpoint: data.instanceServers[0].endpoint };
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    let pingInterval: NodeJS.Timeout | null = null;

    ws.on('open', () => {
      console.log(`[KuCoin] Connected ${marketType} WebSocket`);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
      }, 18000);
      void this.sendSubscriptions(this.getDesiredSubscriptions(marketType), marketType);
    });

    ws.on('message', (data: Buffer) => this.handleMessage(data, marketType));
    ws.on('error', (err) => console.error(`[KuCoin] ${marketType} WS error:`, err));
    ws.on('close', () => {
      if (pingInterval) clearInterval(pingInterval);
      console.log(`[KuCoin] ${marketType} WS closed, reconnecting...`);
      setTimeout(() => this.initConnection(marketType), 5000);
    });
  }

  private toKuCoinSpotSymbol(pair: string): string {
    return pair.replace('/', '-');
  }

  private toKuCoinFuturesContract(pair: string): string {
    return this.futuresPairToContract.get(pair) || this.normalizeSymbolKey(pair);
  }

  private async sendSubscriptions(symbols: string[], marketType: MarketType): Promise<void> {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!symbols.length || !ws || ws.readyState !== WebSocket.OPEN) return;

    const kcSymbols = marketType === MarketType.SPOT
      ? symbols.map((s) => this.toKuCoinSpotSymbol(s))
      : symbols.map((s) => this.toKuCoinFuturesContract(s)).filter(Boolean);

    for (let i = 0; i < kcSymbols.length; i += this.BATCH_SIZE) {
      const batch = kcSymbols.slice(i, i + this.BATCH_SIZE);
      const topic = marketType === MarketType.SPOT
        ? `/spotMarket/level1:${batch.join(',')}`
        : `/contractMarket/tickerV2:${batch.join(',')}`;

      ws.send(JSON.stringify({ id: Date.now().toString(), type: 'subscribe', topic, privateChannel: false, response: true }));
      if (i + this.BATCH_SIZE < kcSymbols.length) await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`[KuCoin] Subscribed to ${kcSymbols.length} ${marketType} tickers`);
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
    await this.sendSubscriptions(symbols, marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'pong' || data.type === 'ack' || data.type !== 'message') return;

      const d = data.data;
      if (!d) return;

      const bid = parseFloat(d.bestBid || d.bestBidPrice || d.buy || 0);
      const ask = parseFloat(d.bestAsk || d.bestAskPrice || d.sell || 0);
      const subject = data.subject || d.symbol;
      if (!(bid > 0 && ask > 0 && subject)) return;

      const symbol = marketType === MarketType.FUTURES
        ? this.futuresContractToPair.get(subject) || subject
        : subject;
      this.updatePrice(symbol, bid, ask, marketType);
    } catch (err) {
      console.error(`[KuCoin] message parse error (${marketType}):`, err);
    }
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    if (marketType === MarketType.SPOT) {
      const response = await this.makeRequest('/api/v1/market/allTickers', 'GET', {}, marketType);
      const list = response?.data?.ticker;
      if (!Array.isArray(list)) return;
      for (const ticker of list) {
        const bid = parseFloat(ticker.buy);
        const ask = parseFloat(ticker.sell);
        if (ticker.symbol && String(ticker.symbol).endsWith('-USDT')) this.updatePrice(ticker.symbol, bid, ask, marketType);
      }
      return;
    }

    const response = await this.makeRequest('/api/v1/allTickers', 'GET', {}, marketType);
    const list = Array.isArray(response?.data) ? response.data : (response?.data?.ticker || response?.ticker);
    const tickers = Array.isArray(list) ? list : [];
    for (const ticker of tickers) {
      const symbol = ticker.symbol || ticker.contract || ticker.symbolName;
      const mapped = this.futuresContractToPair.get(symbol) || symbol;
      const bid = parseFloat(ticker.bestBidPrice || ticker.buy || ticker.bidPrice || ticker.bid || 0);
      const ask = parseFloat(ticker.bestAskPrice || ticker.sell || ticker.askPrice || ticker.ask || 0);
      if (symbol) this.updatePrice(mapped, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    const depth = limit >= 100 ? 100 : 20;
    if (marketType === MarketType.SPOT) {
      const response = await this.makeRequest(`/api/v1/market/orderbook/level2_${depth}`, 'GET', { symbol: this.toKuCoinSpotSymbol(symbol) }, marketType);
      return this.buildOrderBook(symbol, marketType, response?.data?.bids, response?.data?.asks);
    }

    const response = await this.makeRequest(`/api/v1/level2/depth${depth}`, 'GET', { symbol: this.toKuCoinFuturesContract(symbol) }, marketType);
    return this.buildOrderBook(symbol, marketType, response?.data?.bids, response?.data?.asks);
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const endpoint = marketType === MarketType.SPOT ? '/api/v2/symbols' : '/api/v1/contracts/active';
        const response = await this.makeRequest(endpoint, 'GET', {}, marketType);
        const list = response?.data;
        if (!Array.isArray(list)) throw new Error('Invalid KuCoin symbols response');

        const pairs = list
          .filter((s: any) => {
            if (marketType === MarketType.SPOT) return s.enableTrading && s.quoteCurrency === 'USDT';
            return (s.status === 'Open' || s.status === 'open') && (s.settleCurrency === 'USDT' || s.quoteCurrency === 'USDT');
          })
          .filter((s: any) => {
            const base = s.baseCurrency || s.baseCoin || s.rootSymbol;
            const normalizedBase = String(base || '').toUpperCase() === 'XBT' ? 'BTC' : String(base || '').toUpperCase();
            return normalizedBase && !BLACKLIST.includes(normalizedBase);
          })
          .map((s: any) => {
            const base = s.baseCurrency || s.baseCoin || s.rootSymbol;
            const pair = this.addTradingPair(this.pairFromBase(String(base), 'USDT'), marketType);
            if (marketType === MarketType.FUTURES && s.symbol) {
              this.futuresPairToContract.set(pair, s.symbol);
              this.futuresContractToPair.set(s.symbol, pair);
              this.setOrderBookQuantityMultiplier(pair, marketType, parseFloat(s.multiplier || '1'));
            }
            return pair;
          });

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[KuCoin] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[KuCoin] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
