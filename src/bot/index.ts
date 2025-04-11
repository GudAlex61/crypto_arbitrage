import { BinanceExchange } from './exchanges/binance';
import { BybitExchange } from './exchanges/bybit';
import { MEXCExchange } from './exchanges/mexc';
import { ArbitrageAnalyzer } from './arbitrage';
import { TelegramService } from './services/telegram';
import { EXCHANGES, PRICE_UPDATE_INTERVAL } from './config';
import { PriceData } from './types';

class ArbitrageBot {
  private exchanges: Map<string, BinanceExchange | BybitExchange | MEXCExchange> = new Map();
  private analyzer: ArbitrageAnalyzer;
  private telegramService: TelegramService;
  private commonTradingPairs: Set<string> = new Set();

  constructor() {
    this.analyzer = new ArbitrageAnalyzer();
    this.telegramService = new TelegramService();
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
    for (const exchange of this.exchanges.values()) {
      exchange.connect();
      exchange.subscribeToSymbols(Array.from(this.commonTradingPairs));
    }

    // Start monitoring prices
    setInterval(() => {
      this.checkArbitrageOpportunities();
    }, PRICE_UPDATE_INTERVAL);

    console.log('Arbitrage bot started with Telegram notifications enabled');
  }

  private async checkArbitrageOpportunities() {
    const prices: PriceData[] = [];

    for (const [exchangeName, exchange] of this.exchanges) {
      for (const symbol of this.commonTradingPairs) {
        const price = exchange.getPrice(symbol);
        if (price) {
          prices.push({
            symbol,
            price,
            exchange: exchangeName,
            timestamp: Date.now(),
          });
        }
      }
    }

    const opportunities = this.analyzer.findOpportunities(prices);
    
    for (const opportunity of opportunities) {
      console.log('Arbitrage Opportunity Found!');
      console.log(`Symbol: ${opportunity.symbol}`);
      console.log(`Buy from ${opportunity.buyExchange} at ${opportunity.buyPrice}`);
      console.log(`Sell on ${opportunity.sellExchange} at ${opportunity.sellPrice}`);
      console.log(`Potential profit: ${opportunity.profitPercentage.toFixed(2)}%`);
      console.log('-------------------');

      // Send notification to Telegram
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