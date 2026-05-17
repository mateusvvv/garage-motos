import { state } from '../core/state.js';

function renderChart() {
    const canvas = document.getElementById('revenueChart');
    const filterSelect = document.getElementById('revenue-filter');
    const filter = filterSelect?.value || 'all';
    const filterLabel = filterSelect?.selectedOptions[0]?.textContent || 'Total';
    
    let filteredOrders = state.serviceOrders;
    if (filter !== 'all') {
        filteredOrders = state.serviceOrders.filter(os => os.date.endsWith(filter));
    }

    if (!canvas) {
        updateFinanceSummary(filteredOrders, filterLabel);
        return;
    }

    const ctx = canvas.getContext('2d');
    const dailyRevenue = filteredOrders.reduce((acc, os) => {
        acc[os.date] = (acc[os.date] || 0) + os.total;
        return acc;
    }, {});

    const labels = Object.keys(dailyRevenue).sort((a, b) => {
        const [da, ma, ya] = a.split('/').map(Number);
        const [db, mb, yb] = b.split('/').map(Number);
        return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
    });
    const data = labels.map(l => dailyRevenue[l]);

    if (state.revenueChart) state.revenueChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(225, 29, 72, 0.4)');
    gradient.addColorStop(1, 'rgba(225, 29, 72, 0)');

    state.revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Faturamento Total (R$)',
                data: data,
                borderColor: '#e11d48',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#e11d48',
                pointRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#737373', font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { color: '#737373', font: { size: 10 } } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });

    updateFinanceSummary(filteredOrders, filterLabel);
}

function refreshFinanceDashboard() {
    updateRevenueFilterOptions();
    renderChart();
}

function updateFinanceSummary(filteredOrders, filterLabel) {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const todayOrders = state.serviceOrders.filter(o => o.date === todayStr);

    const calcStats = (orders) => {
        return orders.reduce((acc, os) => {
            if (os.mechanic === 'leo') acc.leo += (os.labor || 0);
            if (os.mechanic === 'wandson') acc.wandson += (os.labor || 0);
            acc.parts += (os.partsTotal || 0);
            
            if (os.paymentMethod === 'pix') acc.pix += (os.total || 0);
            else if (os.paymentMethod === 'avista') acc.avista += (os.total || 0);
            else if (os.paymentMethod === 'cartao') acc.cartao += (os.total || 0);
            
            acc.total += (os.total || 0);
            return acc;
        }, { leo: 0, wandson: 0, parts: 0, pix: 0, avista: 0, cartao: 0, total: 0 });
    };

    const statsToday = calcStats(todayOrders);
    const statsPeriod = calcStats(filteredOrders);

    const container = document.getElementById('finance-summary');
    if (!container) return;

    const renderBlock = (title, stats, isMain = false) => `
        <div class="col-span-full mb-2">
            <h5 class="text-[10px] font-black uppercase tracking-[0.3em] ${isMain ? 'text-red-600' : 'text-neutral-500'} italic">${title}</h5>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">M.O Léo</p>
            <p class="text-white font-black text-lg italic">R$ ${stats.leo.toFixed(2)}</p>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">M.O Wandson</p>
            <p class="text-white font-black text-lg italic">R$ ${stats.wandson.toFixed(2)}</p>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">Peças</p>
            <p class="text-white font-black text-lg italic">R$ ${stats.parts.toFixed(2)}</p>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">Pix</p>
            <p class="text-green-500 font-black text-lg italic">R$ ${stats.pix.toFixed(2)}</p>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">À Vista</p>
            <p class="text-green-500 font-black text-lg italic">R$ ${stats.avista.toFixed(2)}</p>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">Cartão</p>
            <p class="text-blue-500 font-black text-lg italic">R$ ${stats.cartao.toFixed(2)}</p>
        </div>
        <div class="col-span-full bg-neutral-900 border border-neutral-800 p-4 rounded-xl flex justify-between items-center">
            <p class="text-[10px] text-neutral-500 font-black uppercase tracking-widest italic">Total Líquido</p>
            <p class="text-white font-black text-2xl italic">R$ ${stats.total.toFixed(2)}</p>
        </div>
    `;

    container.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            ${renderBlock("Hoje (" + todayStr + ")", statsToday, true)}
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mt-8 pt-8 border-t border-neutral-900">
            ${renderBlock("Resumo: " + filterLabel, statsPeriod)}
        </div>
    `;
}


function updateRevenueFilterOptions() {
    const select = document.getElementById('revenue-filter');
    if (!select) return;
    const months = new Set();
    const years = new Set();
    state.serviceOrders.forEach(os => {
        const parts = os.date.split('/');
        if (parts.length === 3) {
            months.add(`${parts[1]}/${parts[2]}`);
            years.add(parts[2]);
        }
    });
    
    const currentValue = select.value;
    select.innerHTML = '<option value="all">Faturamento Total</option>';
    [...years].sort().reverse().forEach(y => {
        const option = document.createElement('option');
        option.value = y; option.textContent = `Ano ${y}`;
        select.appendChild(option);
    });
    [...months].sort().reverse().forEach(m => {
        const option = document.createElement('option');
        option.value = m; option.textContent = m;
        select.appendChild(option);
    });
    select.value = currentValue || 'all';
}



export { renderChart, refreshFinanceDashboard, updateFinanceSummary, updateRevenueFilterOptions };

