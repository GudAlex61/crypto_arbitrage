import { BinanceExchange } from './exchanges/binance';
import { BybitExchange } from './exchanges/bybit';
import { MEXCExchange } from './exchanges/mexc/mexc';
import { ArbitrageAnalyzer } from './arbitrage';
import { TelegramService } from './services/telegram';
import { WebSocketService } from './services/websocket';
import { EXCHANGES, PRICE_UPDATE_INTERVAL } from './config';
import { MarketType, PriceData } from './types';

class ArbitrageBot {
  private exchanges: Map<string, BinanceExchange | BybitExchange | MEXCExchange> = new Map();
  private analyzer: ArbitrageAnalyzer;
  private telegramService: TelegramService;
  private webSocketService: WebSocketService;
  private commonTradingPairs: Set<string> = new Set();
  private commonFuturesPairs: Set<string> = new Set();
  private lastLogTime: Map<string, number> = new Map();
  private readonly LOG_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor() {
    this.analyzer = new ArbitrageAnalyzer();
    this.telegramService = new TelegramService();
    this.webSocketService = new WebSocketService(3001);
    this.initializeExchanges();
  }

  private initializeExchanges() {
    for (const config of EXCHANGES) {
      let exchange;
      switch (config.name) {
        case 'Binance':
          exchange = new BinanceExchange(config);
          break;
        case 'Bybit':
          exchange = new BybitExchange(config);
          break;
        case 'MEXC':
          exchange = new MEXCExchange(config);
          break;
        default:
          continue;
      }
      this.exchanges.set(config.name, exchange);
    }
  }

  private async fetchAllTradingPairs() {
    const allPairsMap = new Map<string, { spot: number, futures: number }>();

    // Fetch trading pairs from all exchanges for both spot and futures
    for (const exchange of this.exchanges.values()) {
      // Fetch spot pairs
      const spotPairs = await exchange.fetchTradingPairs(MarketType.SPOT);
      spotPairs.forEach(pair => {
        const counts = allPairsMap.get(pair) || { spot: 0, futures: 0 };
        counts.spot++;
        allPairsMap.set(pair, counts);
      });

      // Fetch futures pairs
      const futuresPairs = await exchange.fetchTradingPairs(MarketType.FUTURES);
      futuresPairs.forEach(pair => {
        const counts = allPairsMap.get(pair) || { spot: 0, futures: 0 };
        counts.futures++;
        allPairsMap.set(pair, counts);
      });
    }

    // Find common pairs (available on at least 2 exchanges for each market type)
    for (const [pair, counts] of allPairsMap.entries()) {
      if (counts.spot >= 2) {
        this.commonTradingPairs.add(pair);
      }
      if (counts.futures >= 2) {
        this.commonFuturesPairs.add(pair);
      }
    }

    console.log(`Found ${this.commonTradingPairs.size} common spot trading pairs across exchanges`);
    console.log(`Found ${this.commonFuturesPairs.size} common futures trading pairs across exchanges`);
  }

  public async start() {
    // Fetch trading pairs first
    await this.fetchAllTradingPairs();

    // Connect to all exchanges
    for (const [exchangeName, exchange] of this.exchanges) {
      console.log(`Connecting to ${exchangeName}...`);
      exchange.connect();
      
      // Subscribe to spot pairs
      const spotPairs = Array.from(this.commonTradingPairs);
      console.log(`Subscribing to ${spotPairs.length} spot pairs on ${exchangeName}`);
      await exchange.subscribeToSymbols(spotPairs, MarketType.SPOT);
      
      // Subscribe to futures pairs
      // const futuresPairs = Array.from(this.commonFuturesPairs);
      // console.log(`Subscribing to ${futuresPairs.length} futures pairs on ${exchangeName}`);
      // await exchange.subscribeToSymbols(futuresPairs, MarketType.FUTURES);
    }

    // Start monitoring prices
    setInterval(() => {
      this.checkArbitrageOpportunities(MarketType.SPOT);
      // this.checkArbitrageOpportunities(MarketType.FUTURES);
    }, PRICE_UPDATE_INTERVAL);

    console.log('Arbitrage bot started with WebSocket and Telegram notifications enabled');
  }

  private isOnCooldown(symbol: string): boolean {
    const lastTime = this.lastLogTime.get(symbol);
    if (!lastTime) return false;

    const timeSinceLastLog = Date.now() - lastTime;
    return timeSinceLastLog < this.LOG_COOLDOWN;
  }

  private async checkArbitrageOpportunities(marketType: MarketType) {
    const prices: PriceData[] = [];
    const exchangePrices = new Map<string, number>();

    for (const [exchangeName, exchange] of this.exchanges) {
      let exchangePriceCount = 0;
      const pairs = marketType === MarketType.SPOT ? this.commonTradingPairs : this.commonFuturesPairs;
      
      for (const symbol of pairs) {
        const price = exchange.getPrice(symbol, marketType);
        if (price) {
          prices.push({
            symbol,
            price,
            exchange: exchangeName,
            marketType,
            timestamp: Date.now(),
          });
          exchangePriceCount++;
        }
      }
      exchangePrices.set(exchangeName, exchangePriceCount);
    }

    // Log price update status for each exchange
    console.log(`${marketType} Price update status:`);
    for (const [exchangeName, count] of exchangePrices) {
      console.log(`${exchangeName}: ${count} pairs with prices`);
    }

    const opportunities = this.analyzer.findOpportunities(prices);

    for (const opportunity of opportunities) {
      // Broadcast to WebSocket clients regardless of cooldown
      this.webSocketService.broadcastOpportunity(opportunity);

      // Console logging with cooldown
      if (!this.isOnCooldown(opportunity.symbol)) {
        console.log(`${marketType} Arbitrage Opportunity Found!`);
        console.log(`Symbol: ${opportunity.symbol}`);
        console.log(`Buy from ${opportunity.buyExchange} at ${opportunity.buyPrice}`);
        console.log(`Sell on ${opportunity.sellExchange} at ${opportunity.sellPrice}`);
        console.log(`Potential profit: ${opportunity.profitPercentage.toFixed(2)}%`);
        console.log('-------------------');

        // Update last log time for this symbol
        this.lastLogTime.set(opportunity.symbol, Date.now());
      }

      // Send notification to Telegram (it has its own cooldown mechanism)
      await this.telegramService.sendOpportunityAlert(opportunity);
    }
  }

  public stop() {
    for (const exchange of this.exchanges.values()) {
      exchange.disconnect();
    }
  }
}

// Start the bot
const bot = new ArbitrageBot();
bot.start();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down bot...');
  bot.stop();
  process.exit(0);
});