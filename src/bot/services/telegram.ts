import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_CONFIG } from '../config';
import { ArbitrageOpportunity } from '../types';

export class TelegramService {
  private bot: TelegramBot;

  constructor() {
    if (!TELEGRAM_CONFIG.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
    }
    if (!TELEGRAM_CONFIG.chatId) {
      throw new Error('TELEGRAM_CHAT_ID is not set in environment variables');
    }

    this.bot = new TelegramBot(TELEGRAM_CONFIG.botToken, { polling: false });
  }

  async sendOpportunityAlert(opportunity: ArbitrageOpportunity): Promise<void> {
    const message = this.formatOpportunityMessage(opportunity);
    
    try {
      await this.bot.sendMessage(TELEGRAM_CONFIG.chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    } catch (error) {
      console.error('Error sending Telegram message:', error);
    }
  }

  private formatOpportunityMessage(opportunity: ArbitrageOpportunity): string {
    const profitFormatted = opportunity.profitPercentage.toFixed(2);
    const buyPriceFormatted = opportunity.buyPrice.toFixed(2);
    const sellPriceFormatted = opportunity.sellPrice.toFixed(2);
    
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