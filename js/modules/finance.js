import { state } from '../core/state.js';

function getPaymentBreakdown(os = {}) {
    const breakdown = { pix: 0, avista: 0, cartao: 0 };
    const services = Array.isArray(os.services) ? os.services : [];

    services.forEach(service => {
        const method = service.paymentMethod || os.paymentMethod || 'pix';
        breakdown[method] = (breakdown[method] || 0) + Number(service.price || 0);
    });

    const partsPaymentMethod = os.paymentMethod || services[0]?.paymentMethod || 'pix';
    breakdown[partsPaymentMethod] = (breakdown[partsPaymentMethod] || 0) + Number(os.partsTotal || 0);
    return breakdown;
}

function getDateParts(date = '') {
    const [day, month, year] = String(date).split('/');
    if (!day || !month || !year) return null;
    return { day, month, year };
}

function getCurrentRevenueFilter() {
    const typeSelect = document.getElementById('revenue-filter');
    const periodSelect = document.getElementById('revenue-period-filter');
    const type = typeSelect?.value || 'all';
    return {
        type,
        period: type === 'all' ? '' : (periodSelect?.value || '')
    };
}

function orderLabels(labels, type) {
    return labels.sort((a, b) => {
        if (type === 'year' || type === 'all') return Number(a) - Number(b);
        if (type === 'month') {
            const [da, ma, ya] = a.split('/').map(Number);
            const [db, mb, yb] = b.split('/').map(Number);
            return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
        }
        if (type === 'day') return 0;

        const [ma, ya] = a.split('/').map(Number);
        const [mb, yb] = b.split('/').map(Number);
        return new Date(ya, ma - 1, 1) - new Date(yb, mb - 1, 1);
    });
}

function getOrderPeriodKey(os, filterType) {
    const dateParts = getDateParts(os.date);
    if (!dateParts) return os.date || '';

    if (filterType === 'year' || filterType === 'all') return dateParts.year;
    if (filterType === 'month') return os.date;
    if (filterType === 'day') return os.date;
    return `${dateParts.month}/${dateParts.year}`;
}

function filterOrdersByRevenuePeriod(orders, filter) {
    if (filter.type !== 'all' && !filter.period) return [];
    if (filter.type === 'day') return orders.filter(os => os.date === filter.period);
    if (filter.type === 'month') return orders.filter(os => {
        const dateParts = getDateParts(os.date);
        return dateParts && `${dateParts.month}/${dateParts.year}` === filter.period;
    });
    if (filter.type === 'year') return orders.filter(os => {
        const dateParts = getDateParts(os.date);
        return dateParts?.year === filter.period;
    });
    return orders;
}

function renderChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) {
        updateRevenuePeriodOptions();
        const filter = getCurrentRevenueFilter();
        updateFinanceSummary(filterOrdersByRevenuePeriod(state.serviceOrders, filter), getRevenueFilterLabel(filter));
        return;
    }
    updateRevenuePeriodOptions();
    const ctx = canvas.getContext('2d');
    const filter = getCurrentRevenueFilter();
    const filterLabel = getRevenueFilterLabel(filter);
    
    const filteredOrders = filterOrdersByRevenuePeriod(state.serviceOrders, filter);

    const revenueData = filteredOrders.reduce((acc, os) => {
        const label = getOrderPeriodKey(os, filter.type);
        if (!acc[label]) acc[label] = { pix: 0, avista: 0, cartao: 0 };
        const breakdown = getPaymentBreakdown(os);
        acc[label].pix += breakdown.pix;
        acc[label].avista += breakdown.avista;
        acc[label].cartao += breakdown.cartao;
        return acc;
    }, {});

    const labels = orderLabels(Object.keys(revenueData), filter.type);

    if (state.revenueChart) state.revenueChart.destroy();

    state.revenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Pix',
                    data: labels.map(l => revenueData[l].pix),
                    backgroundColor: '#a855f7',
                    borderRadius: 4
                },
                {
                    label: 'Espécie',
                    data: labels.map(l => revenueData[l].avista),
                    backgroundColor: '#22c55e',
                    borderRadius: 4
                },
                {
                    label: 'Cartão',
                    data: labels.map(l => revenueData[l].cartao),
                    backgroundColor: '#3b82f6',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#737373', font: { size: 10 } } },
                x: { stacked: true, grid: { display: false }, ticks: { color: '#737373', font: { size: 10 } } }
            },
            plugins: {
                legend: { 
                    display: true, 
                    position: 'top',
                    labels: { color: '#737373', font: { size: 10 }, usePointStyle: true }
                }
            }
        }
    });

    updateFinanceSummary(filteredOrders, filterLabel);
}

function refreshFinanceDashboard() {
    updateRevenueFilterOptions();
    updateRevenuePeriodOptions();
    renderChart();
}

function updateFinanceSummary(filteredOrders, filterLabel) {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const todayOrders = state.serviceOrders.filter(o => o.date === todayStr);

    const calcStats = (orders) => {
        return orders.reduce((acc, os) => {
            const services = Array.isArray(os.services) ? os.services : [];
            services.forEach(service => {
                if (service.mechanic === 'leo') acc.leo += Number(service.price || 0);
                if (service.mechanic === 'wandson') acc.wandson += Number(service.price || 0);
            });
            acc.parts += (os.partsTotal || 0);

            const breakdown = getPaymentBreakdown(os);
            acc.pix += breakdown.pix;
            acc.avista += breakdown.avista;
            acc.cartao += breakdown.cartao;
            
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
            <p class="text-purple-500 font-black text-lg italic">R$ ${stats.pix.toFixed(2)}</p>
        </div>
        <div class="bg-black/40 border border-neutral-800 p-4 rounded-xl">
            <p class="text-[9px] text-neutral-500 font-black uppercase tracking-widest mb-1">Espécie</p>
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
    const currentValue = select.value || 'all';
    select.innerHTML = `
        <option value="all">Faturamento Total</option>
        <option value="day">Por dia</option>
        <option value="month">Por mês</option>
        <option value="year">Por ano</option>
    `;
    select.value = ['all', 'day', 'month', 'year'].includes(currentValue) ? currentValue : 'all';
}

function updateRevenuePeriodOptions() {
    const typeSelect = document.getElementById('revenue-filter');
    const periodSelect = document.getElementById('revenue-period-filter');
    if (!typeSelect || !periodSelect) return;

    const type = typeSelect.value || 'all';
    const currentValue = periodSelect.value;

    if (type === 'all') {
        periodSelect.classList.add('hidden');
        periodSelect.innerHTML = '<option value="">Selecione o período</option>';
        return;
    }

    const days = new Set();
    const months = new Set();
    const years = new Set();
    state.serviceOrders.forEach(os => {
        const dateParts = getDateParts(os.date);
        if (dateParts) {
            days.add(os.date);
            months.add(`${dateParts.month}/${dateParts.year}`);
            years.add(dateParts.year);
        }
    });

    const optionsByType = {
        day: {
            placeholder: 'Selecione o dia',
            values: orderLabels([...days], 'month').reverse(),
            prefix: 'Dia '
        },
        month: {
            placeholder: 'Selecione o mês',
            values: orderLabels([...months], 'default').reverse(),
            prefix: 'Mês '
        },
        year: {
            placeholder: 'Selecione o ano',
            values: [...years].sort().reverse(),
            prefix: 'Ano '
        }
    };

    const config = optionsByType[type] || optionsByType.day;
    periodSelect.classList.remove('hidden');
    periodSelect.innerHTML = `<option value="">${config.placeholder}</option>`;
    config.values.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${config.prefix}${value}`;
        periodSelect.appendChild(option);
    });

    if ([...periodSelect.options].some(option => option.value === currentValue)) {
        periodSelect.value = currentValue;
    } else {
        periodSelect.value = '';
    }
}

function getRevenueFilterLabel(filter) {
    const labels = {
        all: 'Faturamento Total',
        day: filter.period ? `Dia ${filter.period}` : 'Selecione um dia',
        month: filter.period ? `Mês ${filter.period}` : 'Selecione um mês',
        year: filter.period ? `Ano ${filter.period}` : 'Selecione um ano'
    };
    return labels[filter.type] || 'Faturamento Total';
}



export { renderChart, refreshFinanceDashboard, updateFinanceSummary, updateRevenueFilterOptions };
