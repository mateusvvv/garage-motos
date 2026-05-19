import { db } from '../../firebase-config.js';
import { addDoc, collection, deleteDoc, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from '../core/state.js';

let financeSyncStarted = false;
const EXPENSES_COLLECTION = 'financeExpenses';

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
    const value = String(date || '');
    if (value.includes('-')) {
        const [year, month, day] = value.split('-');
        if (!day || !month || !year) return null;
        return { day, month, year };
    }
    const [day, month, year] = value.split('/');
    if (!day || !month || !year) return null;
    return { day, month, year };
}

function toBRDate(date = '') {
    const dateParts = getDateParts(date);
    return dateParts ? `${dateParts.day}/${dateParts.month}/${dateParts.year}` : String(date || '');
}

function toMonthKey(date = '') {
    const dateParts = getDateParts(date);
    return dateParts ? `${dateParts.month}/${dateParts.year}` : '';
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeExpense(expense = {}, fallbackId = '') {
    const date = expense.date || new Date().toLocaleDateString('sv-SE');
    return {
        id: String(expense.id || fallbackId || Date.now()),
        date,
        dateLabel: expense.dateLabel || toBRDate(date),
        description: String(expense.description || ''),
        category: String(expense.category || ''),
        amount: Number(expense.amount || 0),
        createdAt: expense.createdAt || new Date().toISOString()
    };
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

function filterExpensesByRevenuePeriod(expenses, filter) {
    if (filter.type !== 'all' && !filter.period) return [];
    if (filter.type === 'day') return expenses.filter(expense => toBRDate(expense.date) === filter.period);
    if (filter.type === 'month') return expenses.filter(expense => toMonthKey(expense.date) === filter.period);
    if (filter.type === 'year') return expenses.filter(expense => getDateParts(expense.date)?.year === filter.period);
    return expenses;
}

function filterExpensesByMonth(monthKey) {
    return state.financeExpenses.filter(expense => toMonthKey(expense.date) === monthKey);
}

function renderChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) {
        updateRevenuePeriodOptions();
        const filter = getCurrentRevenueFilter();
        updateFinanceSummary(
            filterOrdersByRevenuePeriod(state.serviceOrders, filter),
            getRevenueFilterLabel(filter),
            filterExpensesByRevenuePeriod(state.financeExpenses, filter)
        );
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

    updateFinanceSummary(filteredOrders, filterLabel, filterExpensesByRevenuePeriod(state.financeExpenses, filter));
}

function refreshFinanceDashboard() {
    updateRevenueFilterOptions();
    updateRevenuePeriodOptions();
    updateProfitReportOptions();
    renderExpenseList();
    renderChart();
}

function updateFinanceSummary(filteredOrders, filterLabel, filteredExpenses = []) {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const todayOrders = state.serviceOrders.filter(o => o.date === todayStr);
    const todayExpenses = state.financeExpenses.filter(expense => toBRDate(expense.date) === todayStr);

    const calcStats = (orders, expenses = []) => {
        const stats = orders.reduce((acc, os) => {
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
        }, { leo: 0, wandson: 0, parts: 0, pix: 0, avista: 0, cartao: 0, total: 0, expenses: 0, profit: 0 });
        stats.expenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
        stats.profit = stats.total - stats.expenses;
        return stats;
    };

    const statsToday = calcStats(todayOrders, todayExpenses);
    const statsPeriod = calcStats(filteredOrders, filteredExpenses);

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
            <p class="text-[10px] text-neutral-500 font-black uppercase tracking-widest italic">Entradas</p>
            <p class="text-white font-black text-2xl italic">R$ ${stats.total.toFixed(2)}</p>
        </div>
        <div class="col-span-full bg-black border border-red-600/30 p-4 rounded-xl flex justify-between items-center">
            <p class="text-[10px] text-neutral-500 font-black uppercase tracking-widest italic">Saídas</p>
            <p class="text-red-500 font-black text-2xl italic">R$ ${stats.expenses.toFixed(2)}</p>
        </div>
        <div class="col-span-full bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex justify-between items-center">
            <p class="text-[10px] text-neutral-500 font-black uppercase tracking-widest italic">Lucro</p>
            <p class="${stats.profit >= 0 ? 'text-green-500' : 'text-red-500'} font-black text-2xl italic">R$ ${stats.profit.toFixed(2)}</p>
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
    state.financeExpenses.forEach(expense => {
        const dateParts = getDateParts(expense.date);
        if (dateParts) {
            days.add(toBRDate(expense.date));
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



function initFinanceSync() {
    if (financeSyncStarted) {
        refreshFinanceDashboard();
        return;
    }
    financeSyncStarted = true;

    onSnapshot(collection(db, EXPENSES_COLLECTION), (snapshot) => {
        state.financeExpenses = snapshot.docs
            .map(item => normalizeExpense(item.data(), item.id))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        refreshFinanceDashboard();
    }, (error) => {
        console.error('Erro ao sincronizar saídas financeiras:', error);
        refreshFinanceDashboard();
    });
}

async function addExpense(event) {
    event.preventDefault();
    const dateInput = document.getElementById('expense-date');
    const descriptionInput = document.getElementById('expense-description');
    const itemRows = Array.from(document.querySelectorAll('.expense-item-row'));

    const date = dateInput?.value || '';
    const description = descriptionInput?.value.trim() || '';
    const expenseItems = itemRows.map(row => {
        const selectedCategory = row.querySelector('.expense-category-select')?.value.trim() || '';
        const manualCategory = row.querySelector('.expense-manual-category')?.value.trim() || '';
        const category = selectedCategory === 'Digitar manualmente' ? manualCategory : selectedCategory;
        const amount = Number(row.querySelector('.expense-amount-field')?.value || 0);
        return { row, selectedCategory, category, amount };
    }).filter(item => item.selectedCategory || item.category || item.amount > 0);

    if (!date || !description || expenseItems.length === 0) {
        alert('Informe a data, descrição e pelo menos uma saída.');
        return;
    }

    for (const item of expenseItems) {
        if (!item.category) {
            alert('Informe a categoria de cada saída.');
            const target = item.selectedCategory === 'Digitar manualmente'
                ? item.row.querySelector('.expense-manual-category')
                : item.row.querySelector('.expense-category-select');
            target?.focus();
            return;
        }

        if (item.amount <= 0) {
            alert('Informe um valor válido para cada saída.');
            item.row.querySelector('.expense-amount-field')?.focus();
            return;
        }
    }

    try {
        await Promise.all(expenseItems.map(item => addDoc(collection(db, EXPENSES_COLLECTION), {
            date,
            dateLabel: toBRDate(date),
            description,
            category: item.category,
            amount: item.amount,
            createdAt: new Date().toISOString()
        })));
        event.target.reset();
        window.resetExpenseItems?.();
        alert(expenseItems.length === 1 ? 'Saída salva com sucesso.' : 'Saídas salvas com sucesso.');
    } catch (error) {
        console.error('Erro ao salvar saída:', error);
        const detail = error?.code ? ` (${error.code})` : '';
        alert(`Não foi possível salvar a saída${detail}. Verifique a conexão e as permissões.`);
    }
}

async function deleteExpense(id) {
    if (!confirm('Deseja remover esta saída?')) return;
    try {
        await deleteDoc(doc(db, EXPENSES_COLLECTION, String(id)));
    } catch (error) {
        console.error('Erro ao remover saída:', error);
        alert('Não foi possível remover esta saída.');
    }
}

async function clearExpenseHistory() {
    if (state.financeExpenses.length === 0) {
        alert('O histórico de saídas já está vazio.');
        return;
    }

    if (!confirm(`Deseja apagar permanentemente todas as ${state.financeExpenses.length} saídas do histórico?`)) return;

    try {
        await Promise.all(state.financeExpenses.map(expense => deleteDoc(doc(db, EXPENSES_COLLECTION, String(expense.id)))));
        alert('Histórico de saídas limpo com sucesso.');
    } catch (error) {
        console.error('Erro ao limpar histórico de saídas:', error);
        alert('Não foi possível limpar o histórico de saídas.');
    }
}

function renderExpenseList() {
    const list = document.getElementById('expense-list');
    if (!list) return;

    const expenses = [...state.financeExpenses].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    list.innerHTML = expenses.map(expense => `
        <div class="py-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div class="min-w-0">
                <p class="text-red-500 font-black text-[10px] uppercase italic tracking-widest">${escapeHtml(expense.dateLabel || toBRDate(expense.date))}</p>
                <h5 class="font-bold text-sm uppercase truncate text-white">${escapeHtml(expense.description || 'Saída')}</h5>
                <p class="text-[10px] text-neutral-500 uppercase truncate">${escapeHtml(expense.category || 'Sem categoria')}</p>
            </div>
            <div class="flex items-center gap-4 md:justify-end">
                <p class="text-red-500 font-black text-sm whitespace-nowrap">R$ ${Number(expense.amount || 0).toFixed(2)}</p>
                <button onclick="deleteExpense('${expense.id}')" class="text-[10px] text-neutral-500 font-black uppercase tracking-widest hover:text-red-500 transition">Remover</button>
            </div>
        </div>
    `).join('') || '<p class="text-center text-neutral-600 text-xs py-8 uppercase font-bold tracking-[0.2em]">Nenhuma saída lançada</p>';

    if (expenses.length > 0) {
        list.insertAdjacentHTML('afterbegin', `
            <div class="pb-4 flex justify-between items-center text-xs uppercase font-black tracking-widest text-neutral-500">
                <span>${expenses.length} saída(s)</span>
                <span class="text-red-500">Total: R$ ${total.toFixed(2)}</span>
            </div>
        `);
    }
}

function updateProfitReportOptions() {
    const select = document.getElementById('profit-report-month');
    if (!select) return;

    const currentValue = select.value;
    const months = new Set();
    state.serviceOrders.forEach(order => {
        const monthKey = toMonthKey(order.date);
        if (monthKey) months.add(monthKey);
    });
    state.financeExpenses.forEach(expense => {
        const monthKey = toMonthKey(expense.date);
        if (monthKey) months.add(monthKey);
    });

    select.innerHTML = '<option value="">Selecione o mês</option>';
    orderLabels([...months], 'default').reverse().forEach(month => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = month;
        select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === currentValue)) {
        select.value = currentValue;
    }
}

function getOrdersByMonth(monthKey) {
    return state.serviceOrders.filter(order => toMonthKey(order.date) === monthKey);
}

function calculateFinancialStats(orders, expenses) {
    const entries = orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const parts = orders.reduce((sum, order) => sum + Number(order.partsTotal || 0), 0);
    const services = orders.reduce((sum, order) => sum + Number(order.servicesTotal || order.labor || 0), 0);
    const exits = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    return {
        entries,
        parts,
        services,
        exits,
        profit: entries - exits
    };
}

function printProfitReportPDF() {
    const monthKey = document.getElementById('profit-report-month')?.value || '';
    const reportType = document.getElementById('profit-report-type')?.value || 'complete';
    if (!monthKey) {
        alert('Selecione um mês para gerar o relatório.');
        return;
    }

    const orders = getOrdersByMonth(monthKey);
    const expenses = filterExpensesByMonth(monthKey);
    const stats = calculateFinancialStats(orders, expenses);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const money = value => `R$ ${Number(value || 0).toFixed(2)}`;
    const reportTitles = {
        complete: 'RELATORIO COMPLETO',
        expenses: 'RELATORIO DE SAIDAS',
        profit: 'RELATORIO DE LUCRO'
    };
    const reportFileNames = {
        complete: 'relatorio_completo',
        expenses: 'relatorio_saidas',
        profit: 'relatorio_lucro'
    };

    const drawPage = () => {
        doc.setFillColor(250, 250, 250);
        doc.rect(0, 0, 210, 297, 'F');
    };

    const drawFooter = () => {
        doc.setTextColor(115, 115, 115);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.text(`Garage Motos - Relatorio emitido em ${new Date().toLocaleDateString('pt-BR')}`, 14, 282);
    };

    const addPageIfNeeded = (height = 14) => {
        if (y + height <= 265) return;
        drawFooter();
        doc.addPage();
        drawPage();
        y = 22;
    };

    const drawHeader = () => {
        drawPage();
        doc.setFillColor(0, 0, 0);
        doc.rect(0, 0, 210, 38, 'F');
        doc.setFillColor(225, 29, 72);
        doc.rect(0, 38, 210, 2.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(18);
        doc.text(reportTitles[reportType] || reportTitles.complete, 14, 20);
        doc.setFontSize(10);
        doc.setTextColor(225, 29, 72);
        doc.text(`MES ${monthKey}`, 14, 29);
    };

    const drawSectionTitle = (title) => {
        addPageIfNeeded(18);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(11);
        doc.text(title, 14, y);
        y += 10;
    };

    const drawRow = (description, value, color = [0, 0, 0]) => {
        const lines = doc.splitTextToSize(description, 138);
        const rowHeight = Math.max(9, lines.length * 4 + 5);
        addPageIfNeeded(rowHeight + 5);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(0, 0, 0);
        doc.text(lines, 14, y);
        doc.setTextColor(...color);
        doc.text(value, 188, y, { align: 'right' });
        y += rowHeight;
        doc.setDrawColor(235, 235, 235);
        doc.line(14, y, 196, y);
        y += 5;
    };

    drawHeader();

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text('Resumo', 14, 58);

    const summaryRowsByType = {
        expenses: [
            ['Saidas', money(stats.exits)]
        ],
        profit: [
            ['Entradas', money(stats.entries)],
            ['Saidas', money(stats.exits)],
            ['Lucro', money(stats.profit)]
        ],
        complete: [
            ['Entradas', money(stats.entries)],
            ['Servicos', money(stats.services)],
            ['Pecas', money(stats.parts)],
            ['Saidas', money(stats.exits)],
            ['Lucro', money(stats.profit)]
        ]
    };
    const summaryRows = summaryRowsByType[reportType] || summaryRowsByType.complete;

    let y = 72;
    summaryRows.forEach(([label, value]) => {
        doc.setFillColor(label === 'Lucro' ? 245 : 255, label === 'Lucro' ? 245 : 255, label === 'Lucro' ? 245 : 255);
        doc.roundedRect(14, y - 7, 182, 10, 1.5, 1.5, 'F');
        doc.setTextColor(label === 'Saidas' ? 225 : 0, label === 'Saidas' ? 29 : 0, label === 'Saidas' ? 72 : 0);
        doc.setFont(undefined, label === 'Lucro' ? 'bold' : 'normal');
        doc.text(label.toUpperCase(), 20, y);
        doc.text(value, 188, y, { align: 'right' });
        y += 14;
    });

    const shouldShowProfitDetails = reportType === 'profit' || reportType === 'complete';
    const shouldShowExpenseDetails = reportType === 'expenses' || reportType === 'complete';

    if (shouldShowProfitDetails) {
        y += 8;
        drawSectionTitle('Entradas / lucro do mes');
        if (orders.length === 0) {
            drawRow('Nenhuma O.S finalizada neste mes.', '', [115, 115, 115]);
        } else {
            orders
                .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
                .forEach(order => {
                    const description = `${String(order.date || '').toUpperCase()} - O.S #${String(order.osNumber || order.id || '').toUpperCase()} - ${String(order.client || 'CLIENTE').toUpperCase()} - ${String(order.bike || 'MOTO').toUpperCase()}`;
                    drawRow(description, money(order.total), [34, 197, 94]);
                });
        }
    }

    if (shouldShowExpenseDetails) {
        y += 8;
        drawSectionTitle('Saidas do mes');
        if (expenses.length === 0) {
            drawRow('Nenhuma saida lancada neste mes.', '', [115, 115, 115]);
        } else {
            expenses.forEach(expense => {
            const description = `${toBRDate(expense.date)} - ${String(expense.description || 'Saida').toUpperCase()}${expense.category ? ` (${String(expense.category).toUpperCase()})` : ''}`;
                drawRow(description, money(expense.amount), [225, 29, 72]);
            });
        }
    }

    drawFooter();
    doc.save(`${reportFileNames[reportType] || reportFileNames.complete}_${monthKey.replace('/', '_')}.pdf`);
}

window.deleteExpense = deleteExpense;
window.clearExpenseHistory = clearExpenseHistory;
window.printProfitReportPDF = printProfitReportPDF;

export { initFinanceSync, addExpense, deleteExpense, clearExpenseHistory, printProfitReportPDF, renderExpenseList, renderChart, refreshFinanceDashboard, updateFinanceSummary, updateRevenueFilterOptions };
