let ws;
let reconnectTimer;
let spotOpportunities = new Map();
let futuresOpportunities = new Map();
let currentMarket = 'spot';
let spotLastUpdate = null;
let futuresLastUpdate = null;
let refreshRequestInFlight = false;
let botIsChecking = false;
let manualRefreshQueued = false;
let latestRefreshMessage = '';

const opportunityTemplate = Handlebars.compile(document.getElementById('opportunity-template').innerHTML);

Handlebars.registerHelper('formatPrice', function(price) {
    const value = Number(price);
    if (!Number.isFinite(value)) return '-';
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.01) return value.toFixed(4);
    if (value >= 0.0001) return value.toFixed(6);
    return value.toFixed(8);
});

Handlebars.registerHelper('formatProfit', function(profit) {
    const value = Number(profit);
    if (!Number.isFinite(value)) return '-';
    return value.toFixed(3);
});

Handlebars.registerHelper('formatAmount', function(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '-';
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
});

Handlebars.registerHelper('formatBase', function(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '-';
    if (value >= 1) return value.toFixed(4);
    if (value >= 0.01) return value.toFixed(6);
    return value.toFixed(8);
});

Handlebars.registerHelper('formatTime', function(timestamp) {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString();
});

function connect() {
    clearTimeout(reconnectTimer);
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${window.location.host}/arbitrage`);

    ws.onopen = () => {
        const status = document.getElementById('connection-status');
        status.textContent = 'Connected';
        status.classList.remove('text-red-500');
        status.classList.add('text-green-500');
    };

    ws.onclose = () => {
        const status = document.getElementById('connection-status');
        status.textContent = 'Disconnected. Reconnecting...';
        status.classList.remove('text-green-500');
        status.classList.add('text-red-500');
        reconnectTimer = setTimeout(connect, 1000);
    };

    ws.onerror = (error) => console.error('WebSocket error:', error);

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'opportunity') {
                updateOpportunity(message.data);
                updateLastUpdate(message.data.marketType);
            } else if (message.type === 'snapshot') {
                loadSnapshot(message.data || []);
            } else if (message.type === 'status') {
                updateStatus(message.data);
            }
        } catch (error) {
            console.error('Failed to process WebSocket message:', error);
        }
    };
}

function opportunityKey(opportunity) {
    return `${opportunity.symbol}-${opportunity.buyExchange}-${opportunity.sellExchange}`;
}

function targetMapFor(marketType) {
    return marketType === 'futures' ? futuresOpportunities : spotOpportunities;
}

function normalizeOpportunity(opportunity) {
    return {
        ...opportunity,
        netProfitPct: Number(opportunity.netProfitPct ?? opportunity.profitPercentage ?? 0),
        grossProfitPct: Number(opportunity.grossProfitPct ?? 0),
        buyPrice: Number(opportunity.buyPrice),
        sellPrice: Number(opportunity.sellPrice),
        buyTopPrice: Number(opportunity.buyTopPrice ?? opportunity.buyPrice),
        sellTopPrice: Number(opportunity.sellTopPrice ?? opportunity.sellPrice),
        tradeAmountUSDT: Number(opportunity.tradeAmountUSDT ?? 0),
        executableBaseAmount: Number(opportunity.executableBaseAmount ?? 0),
        buyLevelsUsed: Number(opportunity.buyLevelsUsed ?? 0),
        sellLevelsUsed: Number(opportunity.sellLevelsUsed ?? 0),
        buySlippagePct: Number(opportunity.buySlippagePct ?? 0),
        sellSlippagePct: Number(opportunity.sellSlippagePct ?? 0),
        liquidityChecked: Boolean(opportunity.liquidityChecked),
        timestamp: Number(opportunity.timestamp || Date.now())
    };
}

function updateOpportunity(rawOpportunity) {
    const opportunity = normalizeOpportunity(rawOpportunity);
    const map = targetMapFor(opportunity.marketType);
    const key = opportunityKey(opportunity);
    const isNew = !map.has(key);

    map.set(key, { ...opportunity, isNew });
    updateCounts();
    updateTable();
}

function loadSnapshot(opportunities) {
    spotOpportunities.clear();
    futuresOpportunities.clear();
    for (const raw of opportunities) {
        const opportunity = normalizeOpportunity(raw);
        targetMapFor(opportunity.marketType).set(opportunityKey(opportunity), { ...opportunity, isNew: false });
        updateLastUpdate(opportunity.marketType, opportunity.timestamp);
    }
    updateCounts();
    updateTable();
}

function updateTable() {
    const tableBody = document.getElementById('opportunities-table');
    const opportunities = currentMarket === 'spot' ? spotOpportunities : futuresOpportunities;
    const sortedOpportunities = Array.from(opportunities.values())
        .sort((a, b) => b.netProfitPct - a.netProfitPct)
        .slice(0, 300);

    if (!sortedOpportunities.length) {
        tableBody.innerHTML = '<tr><td colspan="12" class="py-8 text-center text-gray-500">No opportunities yet</td></tr>';
    } else {
        tableBody.innerHTML = sortedOpportunities.map((opportunity) => opportunityTemplate(opportunity)).join('');
    }

    document.getElementById('opportunity-count').textContent = sortedOpportunities.length;
}

function updateCounts() {
    document.getElementById('spot-count').textContent = spotOpportunities.size;
    document.getElementById('futures-count').textContent = futuresOpportunities.size;
}

function updateLastUpdate(marketType, timestamp = Date.now()) {
    const value = new Date(timestamp).toLocaleString();
    document.getElementById('global-last-update').textContent = value;
    if (marketType === 'spot') {
        spotLastUpdate = value;
        document.getElementById('spot-last-update').textContent = value;
    } else {
        futuresLastUpdate = value;
        document.getElementById('futures-last-update').textContent = value;
    }
}

function updateStatus(status) {
    if (!status) return;
    document.getElementById('common-spot-pairs').textContent = status.commonSpotPairs ?? 0;
    document.getElementById('common-futures-pairs').textContent = status.commonFuturesPairs ?? 0;
    if (status.timestamp) document.getElementById('global-last-update').textContent = new Date(status.timestamp).toLocaleString();

    botIsChecking = Boolean(status.isChecking);
    manualRefreshQueued = Boolean(status.manualRefreshQueued);

    const settings = document.getElementById('bot-settings');
    if (settings) {
        const min = status.minNetProfitPct ?? 0;
        const max = status.maxNetProfitPct ?? 25;
        const amount = status.orderBookTradeAmountUSDT ?? 0;
        const depth = status.orderBookDepthLimit ?? 0;
        const limit = status.orderBookVerificationLimit ?? 0;
        const concurrency = status.orderBookConcurrency ?? 0;
        const interval = status.priceUpdateIntervalMs ?? 0;
        settings.textContent = status.orderBookEnabled
            ? `Net filter: ${min}%..${max}% · VWAP amount: ${amount} · depth: ${depth} · candidates: ${limit} · concurrency: ${concurrency} · interval: ${interval}ms`
            : `Net filter: ${min}%..${max}% · order book verification off · interval: ${interval}ms`;
    }

    const cycleStatus = document.getElementById('cycle-status');
    if (cycleStatus) {
        const duration = Number(status.lastCheckDurationMs || 0);
        const durationText = duration > 0 ? `last ${formatDuration(duration)}` : 'last unknown';
        const reason = status.lastCheckReason ? ` · ${status.lastCheckReason}` : '';
        const skipped = status.skippedAutoCycles ? ` · skipped auto: ${status.skippedAutoCycles}` : '';
        cycleStatus.textContent = botIsChecking
            ? `Cycle: running${reason}`
            : `Cycle: idle · ${durationText}${reason}${skipped}`;
    }

    updateRefreshUi();

    const table = document.getElementById('exchange-status-table');
    const rows = Array.isArray(status.exchanges) ? status.exchanges : [];
    if (!rows.length) {
        table.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-gray-500">No exchange status yet</td></tr>';
        return;
    }

    table.innerHTML = rows.map((exchange) => `
        <tr class="border-b border-gray-700">
            <td class="py-3 px-4 font-medium">${escapeHtml(exchange.exchange)}</td>
            <td class="py-3 px-4">${exchange.spotPairs ?? 0}</td>
            <td class="py-3 px-4">${exchange.futuresPairs ?? 0}</td>
            <td class="py-3 px-4">${exchange.spotPrices ?? 0}</td>
            <td class="py-3 px-4">${exchange.futuresPrices ?? 0}</td>
        </tr>
    `).join('');
}

function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${rest}s`;
}

function updateRefreshUi(message = latestRefreshMessage) {
    const button = document.getElementById('refresh-now');
    const state = document.getElementById('refresh-state');
    if (!button || !state) return;

    if (refreshRequestInFlight) {
        button.disabled = true;
        button.textContent = 'Requesting...';
        state.textContent = 'Sending refresh request...';
        return;
    }

    if (manualRefreshQueued) {
        button.disabled = true;
        button.textContent = 'Queued';
        state.textContent = message || 'Refresh queued after current cycle.';
        return;
    }

    button.disabled = false;
    button.textContent = botIsChecking ? 'Queue refresh' : 'Refresh now';
    state.textContent = message || (botIsChecking ? 'Cycle is running. Click to queue one more refresh.' : 'Ready.');
}

async function requestManualRefresh() {
    refreshRequestInFlight = true;
    latestRefreshMessage = '';
    updateRefreshUi();

    try {
        const response = await fetch('/api/refresh', { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        latestRefreshMessage = data.message || (response.ok ? 'Refresh requested.' : 'Refresh failed.');
        if (!response.ok) throw new Error(latestRefreshMessage);
        manualRefreshQueued = Boolean(data.queued);
    } catch (error) {
        console.error('Manual refresh failed:', error);
        latestRefreshMessage = error.message || 'Manual refresh failed.';
    } finally {
        refreshRequestInFlight = false;
        updateRefreshUi();
        setTimeout(() => {
            latestRefreshMessage = '';
            updateRefreshUi();
        }, 5000);
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.getElementById('spot-tab').addEventListener('click', () => {
    currentMarket = 'spot';
    document.getElementById('spot-tab').classList.remove('bg-gray-700', 'text-gray-300');
    document.getElementById('spot-tab').classList.add('bg-blue-600', 'text-white');
    document.getElementById('futures-tab').classList.remove('bg-blue-600', 'text-white');
    document.getElementById('futures-tab').classList.add('bg-gray-700', 'text-gray-300');
    document.getElementById('spot-last-update').classList.remove('hidden');
    document.getElementById('futures-last-update').classList.add('hidden');
    updateTable();
});

document.getElementById('futures-tab').addEventListener('click', () => {
    currentMarket = 'futures';
    document.getElementById('futures-tab').classList.remove('bg-gray-700', 'text-gray-300');
    document.getElementById('futures-tab').classList.add('bg-blue-600', 'text-white');
    document.getElementById('spot-tab').classList.remove('bg-blue-600', 'text-white');
    document.getElementById('spot-tab').classList.add('bg-gray-700', 'text-gray-300');
    document.getElementById('futures-last-update').classList.remove('hidden');
    document.getElementById('spot-last-update').classList.add('hidden');
    updateTable();
});

document.getElementById('refresh-now').addEventListener('click', () => {
    void requestManualRefresh();
});

setInterval(() => {
    const now = Date.now();
    const maxAge = 3 * 60 * 1000;
    for (const [key, opportunity] of spotOpportunities.entries()) {
        if (now - opportunity.timestamp > maxAge) spotOpportunities.delete(key);
    }
    for (const [key, opportunity] of futuresOpportunities.entries()) {
        if (now - opportunity.timestamp > maxAge) futuresOpportunities.delete(key);
    }
    updateCounts();
    updateTable();
}, 30000);

updateRefreshUi();
connect();
