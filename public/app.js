// Initialize Handlebars helpers
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
    return new Date(timestamp).toLocaleTimeString();
});

// WebSocket connection
let ws;
let opportunities = new Map();
const opportunityTemplate = Handlebars.compile(document.getElementById('opportunity-template').innerHTML);

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
            updateLastUpdate();
        }
    };
}

function updateOpportunity(opportunity) {
    const key = `${opportunity.symbol}-${opportunity.buyExchange}-${opportunity.sellExchange}`;
    const isNew = !opportunities.has(key);
    
    opportunities.set(key, {
        ...opportunity,
        isNew: isNew
    });
    
    updateTable();
}

function updateTable() {
    const tableBody = document.getElementById('opportunities-table');
    const sortedOpportunities = Array.from(opportunities.values())
        .sort((a, b) => b.profitPercentage - a.profitPercentage);
    
    tableBody.innerHTML = sortedOpportunities
        .map(opportunity => opportunityTemplate(opportunity))
        .join('');
    
    document.getElementById('opportunity-count').textContent = opportunities.size;
}

function updateLastUpdate() {
    document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
}

// Start WebSocket connection
connect();

// Clean up old opportunities periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, opportunity] of opportunities.entries()) {
        if (now - opportunity.timestamp > 5 * 60 * 1000) { // Remove after 5 minutes
            opportunities.delete(key);
        }
    }
    updateTable();
}, 30000);