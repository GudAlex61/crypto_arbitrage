// WebSocket connection
let ws;
let spotOpportunities = new Map();
let futuresOpportunities = new Map();
let currentMarket = 'spot';
let spotLastUpdate = null;
let futuresLastUpdate = null;
const opportunityTemplate = Handlebars.compile(document.getElementById('opportunity-template').innerHTML);

// Register Handlebars helpers
Handlebars.registerHelper('formatPrice', function(price) {
    if (price >= 1) {
        return price.toFixed(2);
    } else if (price >= 0.01) {
        return price.toFixed(4);
    } else if (price >= 0.0001) {
        return price.toFixed(6);
    } else {
        return price.toFixed(8);
    }
});

Handlebars.registerHelper('formatProfit', function(profit) {
    return profit.toFixed(2);
});

Handlebars.registerHelper('formatTime', function(timestamp) {
    return new Date(timestamp).toLocaleString();
});

function connect() {
    ws = new WebSocket('ws://localhost:3001/arbitrage');
    
    ws.onopen = () => {
        document.getElementById('connection-status').textContent = 'Connected';
        document.getElementById('connection-status').classList.remove('text-red-500');
        document.getElementById('connection-status').classList.add('text-green-500');
    };

    ws.onclose = () => {
        document.getElementById('connection-status').textContent = 'Disconnected. Reconnecting...';
        document.getElementById('connection-status').classList.remove('text-green-500');
        document.getElementById('connection-status').classList.add('text-red-500');
        setTimeout(connect, 1000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        
        if (message.type === 'opportunity') {
            updateOpportunity(message.data);
            updateLastUpdate(message.data.marketType);
        }
    };
}

function updateOpportunity(opportunity) {
    const key = `${opportunity.symbol}-${opportunity.buyExchange}-${opportunity.sellExchange}`;
    const isNew = !(currentMarket === 'spot' ? spotOpportunities : futuresOpportunities).has(key);
    
    if (opportunity.marketType === 'spot') {
        spotOpportunities.set(key, {
            ...opportunity,
            isNew: isNew
        });
    } else {
        futuresOpportunities.set(key, {
            ...opportunity,
            isNew: isNew
        });
    }
    
    updateTable();
}

function updateTable() {
    const tableBody = document.getElementById('opportunities-table');
    const opportunities = currentMarket === 'spot' ? spotOpportunities : futuresOpportunities;
    const sortedOpportunities = Array.from(opportunities.values())
        .sort((a, b) => b.profitPercentage - a.profitPercentage);
    
    tableBody.innerHTML = sortedOpportunities
        .map(opportunity => opportunityTemplate(opportunity))
        .join('');
    
    document.getElementById('opportunity-count').textContent = opportunities.size;
}

function updateLastUpdate(marketType) {
    const now = new Date().toLocaleString();
    if (marketType === 'spot') {
        spotLastUpdate = now;
        document.getElementById('spot-last-update').textContent = now;
    } else {
        futuresLastUpdate = now;
        document.getElementById('futures-last-update').textContent = now;
    }
}

// Tab switching
document.getElementById('spot-tab').addEventListener('click', () => {
    currentMarket = 'spot';
    document.getElementById('spot-tab').classList.remove('bg-gray-700', 'text-gray-300');
    document.getElementById('spot-tab').classList.add('bg-blue-600', 'text-white');
    document.getElementById('futures-tab').classList.remove('bg-blue-600', 'text-white');
    document.getElementById('futures-tab').classList.add('bg-gray-700', 'text-gray-300');
    updateTable();
    // Update last update display
    document.getElementById('spot-last-update').classList.remove('hidden');
    document.getElementById('futures-last-update').classList.add('hidden');
});

document.getElementById('futures-tab').addEventListener('click', () => {
    currentMarket = 'futures';
    document.getElementById('futures-tab').classList.remove('bg-gray-700', 'text-gray-300');
    document.getElementById('futures-tab').classList.add('bg-blue-600', 'text-white');
    document.getElementById('spot-tab').classList.remove('bg-blue-600', 'text-white');
    document.getElementById('spot-tab').classList.add('bg-gray-700', 'text-gray-300');
    updateTable();
    // Update last update display
    document.getElementById('futures-last-update').classList.remove('hidden');
    document.getElementById('spot-last-update').classList.add('hidden');
});

// Clean up old opportunities periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, opportunity] of spotOpportunities.entries()) {
        if (now - opportunity.timestamp > 5 * 60 * 1000) { // Remove after 5 minutes
            spotOpportunities.delete(key);
        }
    }
    for (const [key, opportunity] of futuresOpportunities.entries()) {
        if (now - opportunity.timestamp > 5 * 60 * 1000) { // Remove after 5 minutes
            futuresOpportunities.delete(key);
        }
    }
    updateTable();
}, 30000);

// Connect to WebSocket
connect();