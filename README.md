# Crypto Arbitrage Bot

A real-time cryptocurrency arbitrage bot that monitors price differences across multiple exchanges (Binance, Bybit, and MEXC) for both spot and futures markets.

![Crypto Arbitrage Dashboard](https://github.com/user-attachments/assets/5d7169e1-946a-4edb-b717-513fe70bb7b4)


## Features

- Real-time price monitoring across multiple exchanges
- Support for both spot and futures markets
- WebSocket-based price updates
- Redis-based cooldown system
- Telegram notifications for arbitrage opportunities
- Web dashboard for monitoring opportunities
- Separate tracking for spot and futures markets
- Configurable profit thresholds
- Automatic reconnection to exchanges
- Docker support for easy deployment

## Supported Exchanges

- Binance (Spot & Futures)
- Bybit (Spot & Futures)
- MEXC (Spot)

## Prerequisites

- Node.js 18 or higher
- Redis server
- Docker and Docker Compose (optional)

## Installation

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone https://github.com/ramilexe/crypto-arbitrage-bot.git
cd crypto-arbitrage-bot
```

2. Copy the environment file:
```bash
cp .env.example .env
```

3. Edit the `.env` file with your configuration:
```bash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
REDIS_PASSWORD=your_redis_password
```

4. Start the services:
```bash
docker-compose up -d
```

### Manual Installation

1. Clone the repository:
```bash
git clone https://github.com/ramilexe/crypto-arbitrage-bot.git
cd crypto-arbitrage-bot
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment file:
```bash
cp .env.example .env
```

4. Edit the `.env` file with your configuration

5. Start Redis server:
```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine --requirepass your_redis_password

# Or install and start Redis locally
```

6. Start the bot:
```bash
npm start
```

## Configuration

The bot can be configured through the following files:

- `.env`: Environment variables
- `src/bot/config.ts`: Exchange configurations and other settings

### Environment Variables

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token
- `TELEGRAM_CHAT_ID`: Your Telegram chat ID
- `REDIS_PASSWORD`: Redis server password
- `REDIS_HOST`: Redis server host (default: localhost)
- `REDIS_PORT`: Redis server port (default: 6379)

## Web Dashboard

The bot includes a web dashboard that can be accessed at `http://localhost:3001`. 

The dashboard provides:

- Real-time arbitrage opportunities
- Separate views for spot and futures markets
- Last update timestamps for each market
- Opportunity count
- Connection status

## Architecture

- **Exchange Integration**: Each exchange is implemented as a separate class extending a base exchange class
- **WebSocket Service**: Handles real-time price updates from exchanges
- **Redis Service**: Manages cooldown periods for notifications
- **Telegram Service**: Sends notifications about arbitrage opportunities
- **Arbitrage Analyzer**: Identifies profitable arbitrage opportunities
- **Web Dashboard**: Provides real-time monitoring interface

## Development

### Project Structure

```
src/
├── bot/
│   ├── exchanges/         # Exchange implementations
│   ├── services/          # Redis, Telegram, WebSocket services
│   ├── arbitrage.ts       # Arbitrage analysis logic
│   ├── config.ts          # Configuration
│   ├── index.ts           # Main bot entry point
│   └── types.ts           # Type definitions
public/
├── app.js                 # Dashboard frontend
├── index.html             # Dashboard HTML
└── styles.css             # Dashboard styles
```

### Adding New Exchanges

To add a new exchange:

1. Create a new class in `src/bot/exchanges/` extending `BaseExchange`
2. Implement the required methods:
   - `connect()`
   - `subscribeToSymbols()`
   - `handleMessage()`
   - `fetchTradingPairs()`
3. Add the exchange configuration to `src/bot/config.ts`

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This software is available under a dual-license model:

1. **Personal Use License**: Free for personal, non-commercial use. The web interface must run locally on your personal machine only.

2. **Commercial Use License**: Requires a paid license for any business or revenue-generating use.

For commercial licensing inquiries:
- Email: ramilexe@gmail.com
- Telegram: [@ramilexe](https://t.me/ramilexe)

See the [LICENSE](LICENSE) file for detailed terms and conditions.

## Disclaimer

This bot is for educational purposes only. Use at your own risk. Cryptocurrency trading involves significant risk of loss and is not suitable for all investors. 