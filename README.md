# Crypto Arbitrage Bot — dashboard + futures + order-book VWAP

Исправленная версия бота для мониторинга арбитража между CEX-биржами.

## Что исправлено

- Дашборд снова отображает возможности: фронтенд теперь читает `netProfitPct`, а не старое поле `profitPercentage`.
- WebSocket на фронтенде больше не захардкожен на `ws://localhost:3001`; теперь используется текущий host, поэтому Docker/VPS/проксирование работают корректнее.
- При подключении дашборд получает snapshot уже найденных возможностей, а не ждёт только будущих событий.
- OKX spot больше не возвращает `0` пар: для spot используется `quoteCcy`, для futures — `settleCcy`.
- Добавлен REST fallback/snapshot цен для spot и futures, чтобы фьючерсы работали даже если WebSocket-подписка не успела подняться или отвалилась.
- Telegram отключён по умолчанию и больше не ломает запуск без токена.
- Redis получил in-memory fallback: если Redis временно недоступен, бот продолжит работать.
- Добавлены биржи: Binance, Bybit, OKX, Gate, KuCoin, MEXC, Bitget.
- Добавлена таблица статуса бирж: пары и количество полученных цен по spot/futures.
- Добавлен верхний фильтр вилок: по умолчанию `MAX_NET_PROFIT_PCT=25`. Всё выше считается подозрительным и не показывается.
- Добавлена проверка стакана: бот берёт asks на бирже покупки и bids на бирже продажи, считает реальную VWAP-цену исполнения на заданный объём и только после этого показывает вилку.
- В дашборде теперь видны VWAP buy/sell, top-of-book, slippage, размер сделки, base amount и количество уровней стакана.
- Добавлена кнопка `Refresh now`: если цикл свободен — запускает обновление сразу, если цикл уже идёт — ставит одно обновление в очередь.
- Проверка стаканов теперь выполняется параллельно с ограниченной конкуррентностью, а spot и futures проверяются одновременно. Это убирает ситуацию, когда один долгий цикл блокирует обновления почти на минуту.

## Быстрый старт

```bash
cp .env.example .env
npm install
npm start
```

Дашборд: <http://localhost:3001>

## Docker

```bash
cp .env.example .env
docker-compose up --build
```

## Основные настройки `.env`

```env
PORT=3001
MIN_NET_PROFIT_PCT=0
MAX_NET_PROFIT_PCT=25
MAX_PRICE_AGE_MS=45000
PRICE_UPDATE_INTERVAL=5000
REST_REQUEST_TIMEOUT_MS=8000
INITIAL_DELAY_MS=10000

# Проверка стакана / реальной цены исполнения
ORDERBOOK_ENABLED=true
ORDERBOOK_TRADE_AMOUNT_USDT=100
ORDERBOOK_DEPTH_LIMIT=50
ORDERBOOK_VERIFICATION_LIMIT=15
ORDERBOOK_CONCURRENCY=8
ORDERBOOK_FETCH_TIMEOUT_MS=5000
INCLUDE_WITHDRAWAL_FEES=false

# Пусто = все поддерживаемые биржи
ENABLED_EXCHANGES=Binance,Bybit,OKX,Gate,KuCoin,MEXC,Bitget

# Telegram выключен по умолчанию
TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
BLACKLIST=TST,NEIRO
```

## Важно

Это мониторинг, а не торговый движок. Расчёт по стакану показывает примерную исполнимую VWAP-цену для `ORDERBOOK_TRADE_AMOUNT_USDT`, но реальный маркет-ордер может отличаться из-за задержки, изменения стакана, rate limits, funding, разных contract size на фьючерсах, ограничений аккаунта и min/max order size.

Для spot комиссия вывода по умолчанию только показывается, но не вычитается из Net %. Если хочешь вычитать её из расчёта, поставь `INCLUDE_WITHDRAWAL_FEES=true`.

## Почему раньше обновлялось редко

Автоинтервал был `PRICE_UPDATE_INTERVAL=5000`, но проверка стаканов шла последовательно. При `ORDERBOOK_VERIFICATION_LIMIT=50` бот мог сделать до 100 запросов стакана на spot и ещё до 100 на futures, а следующий цикл пропускался, пока текущий не завершится. Теперь:

- `ORDERBOOK_VERIFICATION_LIMIT` по умолчанию снижен до `15`;
- `ORDERBOOK_DEPTH_LIMIT` по умолчанию снижен до `50`;
- добавлен `ORDERBOOK_CONCURRENCY=8`;
- добавлен timeout `ORDERBOOK_FETCH_TIMEOUT_MS=5000`;
- spot и futures анализируются параллельно;
- в дашборде появилась кнопка ручного обновления и статус текущего цикла.

Если нужно ещё быстрее, попробуй:

```env
PRICE_UPDATE_INTERVAL=3000
ORDERBOOK_VERIFICATION_LIMIT=8
ORDERBOOK_DEPTH_LIMIT=20
ORDERBOOK_CONCURRENCY=6
ORDERBOOK_FETCH_TIMEOUT_MS=3000
```
