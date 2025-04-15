import { BinanceExchange } from './exchanges/binance';
import { BybitExchange } from './exchanges/bybit';
import { MEXCExchange } from './exchanges/mexc/mexc';
import { ArbitrageAnalyzer } from './arbitrage';
import { TelegramService } from './services/telegram';
import { WebSocketService } from './services/websocket';
import { EXCHANGES, PRICE_UPDATE_INTERVAL } from './config';
import { PriceData } from './types';

class ArbitrageBot {
  private exchanges: Map<string, BinanceExchange | BybitExchange | MEXCExchange> = new Map();
  private analyzer: ArbitrageAnalyzer;
  private telegramService: TelegramService;
  private webSocketService: WebSocketService;
  private commonTradingPairs: Set<string> = new Set();
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
    const allPairsMap = new Map<string, number>();

    // Fetch trading pairs from all exchanges
    for (const exchange of this.exchanges.values()) {
      const pairs = await exchange.fetchTradingPairs();
      pairs.forEach(pair => {
        allPairsMap.set(pair, (allPairsMap.get(pair) || 0) + 1);
      });
    }

    // Find common pairs (available on at least 2 exchanges)
    for (const [pair, count] of allPairsMap.entries()) {
      if (count >= 2) {
        this.commonTradingPairs.add(pair);
      }
    }

    console.log(`Found ${this.commonTradingPairs.size} common trading pairs across exchanges`);
  }

  public async start() {
    // Fetch trading pairs first
    await this.fetchAllTradingPairs();

    // Connect to all exchanges
    for (const [exchangeName, exchange] of this.exchanges) {
      console.log(`Connecting to ${exchangeName}...`);
      exchange.connect();
      const pairs = Array.from(this.commonTradingPairs);
      console.log(`Subscribing to ${pairs.length} pairs on ${exchangeName}`);
      exchange.subscribeToSymbols(pairs);
    }

    // Start monitoring prices
    setInterval(() => {
      this.checkArbitrageOpportunities();
    }, PRICE_UPDATE_INTERVAL);

    console.log('Arbitrage bot started with WebSocket and Telegram notifications enabled');
  }

  private isOnCooldown(symbol: string): boolean {
    const lastTime = this.lastLogTime.get(symbol);
    if (!lastTime) return false;

    const timeSinceLastLog = Date.now() - lastTime;
    return timeSinceLastLog < this.LOG_COOLDOWN;
  }

  private async checkArbitrageOpportunities() {
    const prices: PriceData[] = [];
    const exchangePrices = new Map<string, number>();

    for (const [exchangeName, exchange] of this.exchanges) {
      let exchangePriceCount = 0;
      for (const symbol of this.commonTradingPairs) {
        const price = exchange.getPrice(symbol);
        if (price) {
          prices.push({
            symbol,
            price,
            exchange: exchangeName,
            timestamp: Date.now(),
          });
          exchangePriceCount++;
        }
      }
      exchangePrices.set(exchangeName, exchangePriceCount);
    }

    // Log price update status for each exchange
    console.log('Price update status:');
    for (const [exchangeName, count] of exchangePrices) {
      console.log(`${exchangeName}: ${count} pairs with prices`);
    }

    const opportunities = this.analyzer.findOpportunities(prices);

    for (const opportunity of opportunities) {
      // Broadcast to WebSocket clients regardless of cooldown
      this.webSocketService.broadcastOpportunity(opportunity);

      // Console logging with cooldown
      if (!this.isOnCooldown(opportunity.symbol)) {
        console.log('Arbitrage Opportunity Found!');
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