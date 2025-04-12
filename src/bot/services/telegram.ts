import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_CONFIG } from '../config';
import { ArbitrageOpportunity } from '../types';

export class TelegramService {
  private bot: TelegramBot;
  private messageQueue: Array<{ message: string; timestamp: number }> = [];
  private isProcessingQueue = false;
  private readonly RATE_LIMIT_DELAY = 2000; // 2 seconds between messages
  private readonly NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds
  private lastNotificationTime: Map<string, number> = new Map();

  constructor() {
    if (!TELEGRAM_CONFIG.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
    }
    if (!TELEGRAM_CONFIG.chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not set in environment variables');
    }

    this.bot = new TelegramBot(TELEGRAM_CONFIG.botToken, { polling: false });
    this.startQueueProcessor();
  }

  private startQueueProcessor() {
    setInterval(() => {
      this.processQueue();
    }, this.RATE_LIMIT_DELAY);
  }

  private async processQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      const { message } = this.messageQueue[0];
      await this.bot.sendMessage(TELEGRAM_CONFIG.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });

      // Remove the sent message from queue
      this.messageQueue.shift();
    } catch (error) {
      console.error('Error sending Telegram message:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private isOnCooldown(symbol: string): boolean {
    const lastTime = this.lastNotificationTime.get(symbol);
    if (!lastTime) return false;

    const timeSinceLastNotification = Date.now() - lastTime;
    return timeSinceLastNotification < this.NOTIFICATION_COOLDOWN;
  }

  async sendOpportunityAlert(opportunity: ArbitrageOpportunity): Promise<void> {
    // Check if the symbol is on cooldown
    if (this.isOnCooldown(opportunity.symbol)) {
      console.log(`Skipping notification for ${opportunity.symbol} - on cooldown`);
      return;
    }

    const message = this.formatOpportunityMessage(opportunity);

    // Update last notification time for this symbol
    this.lastNotificationTime.set(opportunity.symbol, Date.now());

    // Add message to queue with timestamp
    this.messageQueue.push({
      message,
      timestamp: Date.now()
    });
  }

  private formatOpportunityMessage(opportunity: ArbitrageOpportunity): string {
    const profitFormatted = opportunity.profitPercentage.toFixed(2);

    // Format prices with appropriate precision based on the price value
    const formatPrice = (price: number): string => {
      if (price >= 1) {
        return price.toFixed(2);
      } else if (price >= 0.01) {
        return price.toFixed(4);
      } else if (price >= 0.0001) {
        return price.toFixed(6);
      } else {
        return price.toFixed(8);
      }
    };

    const buyPriceFormatted = formatPrice(opportunity.buyPrice);
    const sellPriceFormatted = formatPrice(opportunity.sellPrice);

    return `
🔍 <b>Arbitrage Opportunity Found!</b>

💱 <b>Symbol:</b> ${opportunity.symbol}
📈 <b>Profit:</b> ${profitFormatted}%

🔵 <b>Buy:</b>
   Exchange: ${opportunity.buyExchange}
   Price: $${buyPriceFormatted}

🔴 <b>Sell:</b>
   Exchange: ${opportunity.sellExchange}
   Price: $${sellPriceFormatted}

⏰ <b>Time:</b> ${new Date(opportunity.timestamp).toLocaleString()}
`.trim();
  }
}