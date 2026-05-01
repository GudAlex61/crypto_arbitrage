import { BinanceExchange } from './exchanges/binance';
import { BybitExchange } from './exchanges/bybit';
import { OKXExchange } from './exchanges/okx';
import { GateExchange } from './exchanges/gate';
import { KuCoinExchange } from './exchanges/kucoin';
import { MEXCExchange } from './exchanges/mexc';
import { BitgetExchange } from './exchanges/bitget';
import { ArbitrageAnalyzer } from './arbitrage';
import { TelegramService } from './services/telegram';
import { WebSocketService } from './services/websocket';
import { RedisService } from './services/redis';
import {
  ENABLE_TELEGRAM,
  EXCHANGES,
  INITIAL_DELAY_MS,
  MAX_NET_PROFIT_PCT,
  MIN_NET_PROFIT_PCT,
  ORDERBOOK_CONCURRENCY,
  ORDERBOOK_DEPTH_LIMIT,
  ORDERBOOK_ENABLED,
  ORDERBOOK_FETCH_TIMEOUT_MS,
  ORDERBOOK_TRADE_AMOUNT_USDT,
  ORDERBOOK_VERIFICATION_LIMIT,
  PRICE_UPDATE_INTERVAL,
} from './config';
import { ArbitrageOpportunity, ExchangeRuntimeStatus, MarketType, OrderBook, PriceData } from './types';
import { BaseExchange } from './exchanges/base';

type AnyExchange = BaseExchange;

type RefreshTriggerResult = {
  accepted: boolean;
  running: boolean;
  queued: boolean;
  message: string;
  lastCheckStartedAt?: number;
  lastCheckFinishedAt?: number;
};

class ArbitrageBot {
  private exchanges: Map<string, AnyExchange> = new Map();
  private analyzer: ArbitrageAnalyzer;
  private telegramService: TelegramService;
  private webSocketService: WebSocketService;
  private redisService: RedisService;
  private commonSpotPairs: Set<string> = new Set();
  private commonFuturesPairs: Set<string> = new Set();
  private isChecking = false;
  private manualRefreshQueued = false;
  private autoTimer: NodeJS.Timeout | null = null;
  private lastCheckStartedAt?: number;
  private lastCheckFinishedAt?: number;
  private lastCheckDurationMs?: number;
  private lastCheckReason?: string;
  private skippedAutoCycles = 0;

  private readonly SPOT_COOLDOWN_MS = 5 * 60 * 1000;
  private readonly FUTURES_COOLDOWN_MS = 2 * 60 * 1000;

  constructor() {
    this.analyzer = new ArbitrageAnalyzer(EXCHANGES);
    this.telegramService = new TelegramService();
    this.webSocketService = new WebSocketService(Number(process.env.PORT || '3001'));
    this.webSocketService.setManualRefreshHandler(() => this.triggerManualRefresh());
    this.redisService = new RedisService();
    this.initializeExchanges();
  }

  private initializeExchanges(): void {
    for (const cfg of EXCHANGES) {
      let exchange: AnyExchange | null = null;
      switch (cfg.name) {
        case 'Binance': exchange = new BinanceExchange(cfg); break;
        case 'Bybit': exchange = new BybitExchange(cfg); break;
        case 'OKX': exchange = new OKXExchange(cfg); break;
        case 'Gate': exchange = new GateExchange(cfg); break;
        case 'KuCoin': exchange = new KuCoinExchange(cfg); break;
        case 'MEXC': exchange = new MEXCExchange(cfg); break;
        case 'Bitget': exchange = new BitgetExchange(cfg); break;
      }
      if (exchange) this.exchanges.set(cfg.name, exchange);
    }
    console.log(`Exchanges: ${[...this.exchanges.keys()].join(', ')}`);
    console.log(`Telegram alerts: ${ENABLE_TELEGRAM ? 'enabled' : 'disabled'}`);
    console.log(`Profit filter: ${MIN_NET_PROFIT_PCT}%..${MAX_NET_PROFIT_PCT}% net`);
    console.log(`Auto refresh interval: ${PRICE_UPDATE_INTERVAL}ms`);
    console.log(`Order book verification: ${ORDERBOOK_ENABLED ? `enabled, ${ORDERBOOK_TRADE_AMOUNT_USDT} USDT, depth ${ORDERBOOK_DEPTH_LIMIT}, candidates ${ORDERBOOK_VERIFICATION_LIMIT}, concurrency ${ORDERBOOK_CONCURRENCY}` : 'disabled'}`);
  }

  private async fetchAllTradingPairs(): Promise<void> {
    const spotPresence = new Map<string, number>();
    const futuresPresence = new Map<string, number>();

    await Promise.all([...this.exchanges.values()].map(async (exchange) => {
      const [spotPairs, futuresPairs] = await Promise.all([
        exchange.fetchTradingPairs(MarketType.SPOT),
        exchange.fetchTradingPairs(MarketType.FUTURES),
      ]);

      for (const pair of spotPairs) spotPresence.set(pair, (spotPresence.get(pair) ?? 0) + 1);
      for (const pair of futuresPairs) futuresPresence.set(pair, (futuresPresence.get(pair) ?? 0) + 1);
    }));

    this.commonSpotPairs = new Set([...spotPresence.entries()].filter(([, count]) => count >= 2).map(([pair]) => pair));
    this.commonFuturesPairs = new Set([...futuresPresence.entries()].filter(([, count]) => count >= 2).map(([pair]) => pair));

    console.log(`Общих spot-пар на 2+ биржах: ${this.commonSpotPairs.size}`);
    console.log(`Общих futures-пар на 2+ биржах: ${this.commonFuturesPairs.size}`);
    this.broadcastStatus();
  }

  public async start(): Promise<void> {
    await this.fetchAllTradingPairs();

    for (const [name, exchange] of this.exchanges) {
      console.log(`Подключаемся к ${name}...`);
      exchange.connect();
      await exchange.subscribeToSymbols([...this.commonSpotPairs], MarketType.SPOT);
      await exchange.subscribeToSymbols([...this.commonFuturesPairs], MarketType.FUTURES);
    }

    console.log(`Ждём ${INITIAL_DELAY_MS / 1000}с для установки соединений...`);
    await new Promise((r) => setTimeout(r, INITIAL_DELAY_MS));

    void this.runCheckCycle('startup');
    this.autoTimer = setInterval(() => void this.runCheckCycle('auto'), PRICE_UPDATE_INTERVAL);

    console.log('Бот запущен ✓');
  }

  private triggerManualRefresh(): RefreshTriggerResult {
    if (this.isChecking) {
      this.manualRefreshQueued = true;
      this.broadcastStatus();
      return {
        accepted: true,
        running: true,
        queued: true,
        message: 'Текущий цикл ещё идёт. Следующее обновление поставлено в очередь.',
        lastCheckStartedAt: this.lastCheckStartedAt,
        lastCheckFinishedAt: this.lastCheckFinishedAt,
      };
    }

    void this.runCheckCycle('manual');
    return {
      accepted: true,
      running: false,
      queued: false,
      message: 'Принудительное обновление запущено.',
      lastCheckStartedAt: Date.now(),
      lastCheckFinishedAt: this.lastCheckFinishedAt,
    };
  }

  private async runCheckCycle(reason: 'startup' | 'auto' | 'manual' | 'queued' = 'auto'): Promise<void> {
    if (this.isChecking) {
      if (reason === 'auto') this.skippedAutoCycles++;
      return;
    }

    this.isChecking = true;
    this.lastCheckReason = reason;
    this.lastCheckStartedAt = Date.now();
    this.broadcastStatus();

    try {
      await this.refreshTickerSnapshots();
      await Promise.all([
        this.checkOpportunities(MarketType.SPOT),
        this.checkOpportunities(MarketType.FUTURES),
      ]);
    } catch (err) {
      console.error('[Bot] check cycle failed:', err);
    } finally {
      this.lastCheckFinishedAt = Date.now();
      this.lastCheckDurationMs = this.lastCheckStartedAt
        ? this.lastCheckFinishedAt - this.lastCheckStartedAt
        : undefined;
      this.isChecking = false;
      this.broadcastStatus();

      if (this.manualRefreshQueued) {
        this.manualRefreshQueued = false;
        setTimeout(() => void this.runCheckCycle('queued'), 0);
      }
    }
  }

  private async refreshTickerSnapshots(): Promise<void> {
    await Promise.all([...this.exchanges.entries()].flatMap(([name, exchange]) => [
      exchange.fetchTickerSnapshot(MarketType.SPOT).catch((err) => console.error(`[${name}] spot snapshot failed:`, err)),
      exchange.fetchTickerSnapshot(MarketType.FUTURES).catch((err) => console.error(`[${name}] futures snapshot failed:`, err)),
    ]));
  }

  private async checkOpportunities(marketType: MarketType): Promise<void> {
    const prices: PriceData[] = [];
    const pairs = marketType === MarketType.SPOT ? this.commonSpotPairs : this.commonFuturesPairs;

    for (const [name, exchange] of this.exchanges) {
      let count = 0;
      let noBidAsk = 0;

      for (const symbol of pairs) {
        const pd = exchange.getPriceData(symbol, marketType);
        if (pd) {
          if (pd.bid > 0 && pd.ask > 0) {
            prices.push(pd);
            count++;
          } else {
            noBidAsk++;
          }
        }
      }
      console.log(`[${name}] ${marketType}: ${count} цен (${noBidAsk} без bid/ask)`);
    }

    const candidates = this.analyzer.findOpportunities(prices, marketType);
    const opportunities = await this.verifyCandidatesWithOrderBooks(candidates, marketType);

    console.log(`[Liquidity] ${marketType}: кандидатов ${candidates.length}, после стакана ${opportunities.length}`);

    for (const opp of opportunities) {
      this.webSocketService.broadcastOpportunity(opp);

      const cooldown = marketType === MarketType.SPOT ? this.SPOT_COOLDOWN_MS : this.FUTURES_COOLDOWN_MS;
      const cooldownKey = `${opp.symbol}:${opp.buyExchange}:${opp.sellExchange}`;
      if (!(await this.redisService.isOnCooldown(cooldownKey, marketType))) {
        const liquidityNote = opp.liquidityChecked
          ? ` | VWAP amount: ${opp.tradeAmountUSDT} USDT | base: ${opp.executableBaseAmount?.toFixed(8)} | levels ${opp.buyLevelsUsed}/${opp.sellLevelsUsed}`
          : '';
        console.log(
          `[ВИЛКА] ${opp.symbol} ${marketType} | ` +
          `Купить ${opp.buyExchange} @ ${opp.buyPrice} | ` +
          `Продать ${opp.sellExchange} @ ${opp.sellPrice} | ` +
          `Gross: ${opp.grossProfitPct.toFixed(3)}% Net: ${opp.netProfitPct.toFixed(3)}%${liquidityNote}`
        );
        await this.redisService.setCooldown(cooldownKey, marketType, cooldown);
      }

      await this.telegramService.sendOpportunityAlert(opp);
    }
  }

  private async verifyCandidatesWithOrderBooks(
    candidates: ArbitrageOpportunity[],
    marketType: MarketType
  ): Promise<ArbitrageOpportunity[]> {
    if (!ORDERBOOK_ENABLED) return candidates;

    const limited = candidates.slice(0, Math.max(1, ORDERBOOK_VERIFICATION_LIMIT));
    const concurrency = Math.max(1, Math.min(ORDERBOOK_CONCURRENCY, limited.length || 1));
    const checked = await this.mapWithConcurrency(limited, concurrency, (candidate) => this.verifyOneCandidate(candidate, marketType));

    return checked
      .filter((opportunity): opportunity is ArbitrageOpportunity => !!opportunity)
      .sort((a, b) => b.netProfitPct - a.netProfitPct);
  }

  private async verifyOneCandidate(
    candidate: ArbitrageOpportunity,
    marketType: MarketType
  ): Promise<ArbitrageOpportunity | null> {
    const buyExchange = this.exchanges.get(candidate.buyExchange);
    const sellExchange = this.exchanges.get(candidate.sellExchange);
    if (!buyExchange || !sellExchange) return null;

    const [buyBook, sellBook] = await Promise.all([
      this.fetchOrderBookWithTimeout(buyExchange, candidate.symbol, marketType),
      this.fetchOrderBookWithTimeout(sellExchange, candidate.symbol, marketType),
    ]);

    if (!buyBook || !sellBook) {
      console.log(`[Liquidity] skip ${candidate.symbol} ${candidate.buyExchange}->${candidate.sellExchange}: стакан недоступен или timeout ${ORDERBOOK_FETCH_TIMEOUT_MS}ms`);
      return null;
    }

    const checked = this.analyzer.verifyWithOrderBooks(
      candidate,
      buyBook,
      sellBook,
      ORDERBOOK_TRADE_AMOUNT_USDT
    );

    if (!checked) {
      console.log(`[Liquidity] reject ${candidate.symbol} ${candidate.buyExchange}->${candidate.sellExchange}: не хватает глубины или net вне ${MIN_NET_PROFIT_PCT}%..${MAX_NET_PROFIT_PCT}%`);
      return null;
    }

    return checked;
  }

  private async fetchOrderBookWithTimeout(
    exchange: AnyExchange,
    symbol: string,
    marketType: MarketType
  ): Promise<OrderBook | null> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        exchange.fetchOrderBook(symbol, marketType, ORDERBOOK_DEPTH_LIMIT),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ORDERBOOK_FETCH_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        try {
          results[index] = await mapper(items[index], index);
        } catch (error) {
          console.error('[Liquidity] order-book verification failed:', error);
          results[index] = null as R;
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  private broadcastStatus(): void {
    const statuses: ExchangeRuntimeStatus[] = [...this.exchanges.entries()].map(([name, exchange]) => ({
      exchange: name,
      spotPairs: exchange.getTradingPairs(MarketType.SPOT).length,
      futuresPairs: exchange.getTradingPairs(MarketType.FUTURES).length,
      spotPrices: exchange.getPriceCount(MarketType.SPOT),
      futuresPrices: exchange.getPriceCount(MarketType.FUTURES),
      lastUpdated: Date.now(),
    }));

    this.webSocketService.broadcastStatus({
      commonSpotPairs: this.commonSpotPairs.size,
      commonFuturesPairs: this.commonFuturesPairs.size,
      exchanges: statuses,
      telegramEnabled: ENABLE_TELEGRAM,
      minNetProfitPct: MIN_NET_PROFIT_PCT,
      maxNetProfitPct: MAX_NET_PROFIT_PCT,
      orderBookEnabled: ORDERBOOK_ENABLED,
      orderBookTradeAmountUSDT: ORDERBOOK_TRADE_AMOUNT_USDT,
      orderBookDepthLimit: ORDERBOOK_DEPTH_LIMIT,
      orderBookVerificationLimit: ORDERBOOK_VERIFICATION_LIMIT,
      orderBookConcurrency: ORDERBOOK_CONCURRENCY,
      orderBookFetchTimeoutMs: ORDERBOOK_FETCH_TIMEOUT_MS,
      priceUpdateIntervalMs: PRICE_UPDATE_INTERVAL,
      isChecking: this.isChecking,
      manualRefreshQueued: this.manualRefreshQueued,
      lastCheckStartedAt: this.lastCheckStartedAt,
      lastCheckFinishedAt: this.lastCheckFinishedAt,
      lastCheckDurationMs: this.lastCheckDurationMs,
      lastCheckReason: this.lastCheckReason,
      skippedAutoCycles: this.skippedAutoCycles,
      timestamp: Date.now(),
    });
  }

  public async stop(): Promise<void> {
    if (this.autoTimer) clearInterval(this.autoTimer);
    for (const exchange of this.exchanges.values()) exchange.disconnect();
    await this.redisService.disconnect();
  }
}

const bot = new ArbitrageBot();
bot.start().catch(console.error);

process.on('SIGINT', async () => {
  console.log('Завершение...');
  await bot.stop();
  process.exit(0);
});
