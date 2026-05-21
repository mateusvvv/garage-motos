import { initProductsSync, addProduct, editProduct, deleteProduct, deleteAllProducts, resetProductForm, renderShop, renderAdminStock, reserveProduct, reloadProducts, printLowStockReport } from './modules/products.js';
import { initCalendar, openAppointmentPicker, closeAppointmentPicker, scheduleService, blockDate, deleteAppointment, clearBlockedDates, renderAdminAppointments, deleteAllAppointments } from './modules/appointments.js';
import { addPartRow, addServiceRow, updateDiscountTargets, applyOSDiscount, saveOSDraft, finalizeOS, loadOSDraft, deleteOpenOS, clearOSHistory, editOS, deleteOS, downloadOSPDF, resetOSForm, renderHistory, renderOpenOrders, renderClosedOrders } from './modules/orders.js';
import { addExpense, deleteExpense, clearExpenseHistory, printProfitReportPDF, renderExpenseList, renderChart, refreshFinanceDashboard } from './modules/finance.js';
import { loginAdmin, logoutAdmin, initAuthObserver } from './modules/auth.js';
import { toggleMenu, toggleAdmin, toggleShop, toggleClosedOrders, toggleOSHistory, toggleExpenseHistory, toggleAdminNav, showAdminView, startAlarm, stopAlarm } from './modules/ui.js';

window.GM = {
    renderAdminStock,
    renderAdminAppointments,
    renderHistory,
    renderExpenseList,
    renderChart,
    refreshFinanceDashboard
};

Object.assign(window, {
    toggleMenu,
    toggleAdmin,
    toggleShop,
    toggleClosedOrders,
    toggleOSHistory,
    toggleExpenseHistory,
    openAppointmentPicker,
    closeAppointmentPicker,
    toggleAdminNav,
    showAdminView,
    logoutAdmin,
    editProduct,
    deleteProduct,
    loadOSDraft,
    reserveProduct,
    reloadProducts,
    deleteOpenOS,
    deleteAllAppointments,
    clearOSHistory,
    finalizeOS,
    deleteAllProducts,
    deleteAppointment,
    clearBlockedDates,
    printLowStockReport,
    addPartRow,
    addServiceRow,
    updateDiscountTargets,
    applyOSDiscount,
    editOS,
    deleteOS,
    downloadOSPDF,
    deleteExpense,
    clearExpenseHistory,
    printProfitReportPDF,
    startAlarm,
    stopAlarm
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar')) initCalendar();
    initProductsSync();

    const addSafeListener = (id, event, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    };

    addSafeListener('product-form', 'submit', addProduct);
    addSafeListener('os-form', 'submit', saveOSDraft);
    addSafeListener('os-close-btn', 'click', finalizeOS);
    addSafeListener('appointment-form', 'submit', scheduleService);
    addSafeListener('block-date-form', 'submit', blockDate);
    addSafeListener('revenue-filter', 'change', renderChart);
    addSafeListener('revenue-period-filter', 'change', renderChart);
    addSafeListener('expense-form', 'submit', addExpense);
    addSafeListener('expense-history-toggle', 'click', toggleExpenseHistory);
    addSafeListener('expense-history-clear', 'click', clearExpenseHistory);

    const bindExpenseItemRow = (row) => {
        const categorySelect = row.querySelector('.expense-category-select');
        const manualInput = row.querySelector('.expense-manual-category');
        const removeButton = row.querySelector('.remove-expense-item');
        categorySelect?.addEventListener('change', () => {
            const shouldShowManual = categorySelect.value === 'Digitar manualmente';
            manualInput?.classList.toggle('hidden', !shouldShowManual);
            if (shouldShowManual) manualInput?.focus();
            else if (manualInput) manualInput.value = '';
        });
        removeButton?.addEventListener('click', () => {
            row.remove();
            updateExpenseRemoveButtons();
        });
    };

    const updateExpenseRemoveButtons = () => {
        const rows = document.querySelectorAll('.expense-item-row');
        rows.forEach(row => {
            row.querySelector('.remove-expense-item')?.classList.toggle('hidden', rows.length === 1);
        });
    };

    const createExpenseItemRow = () => {
        const container = document.getElementById('expense-items-container');
        const firstRow = container?.querySelector('.expense-item-row');
        if (!container || !firstRow) return null;
        const row = firstRow.cloneNode(true);
        row.querySelector('.expense-category-select').value = '';
        row.querySelector('.expense-amount-field').value = '';
        const manualInput = row.querySelector('.expense-manual-category');
        if (manualInput) {
            manualInput.value = '';
            manualInput.classList.add('hidden');
        }
        container.appendChild(row);
        bindExpenseItemRow(row);
        updateExpenseRemoveButtons();
        return row;
    };

    const resetExpenseItems = () => {
        const container = document.getElementById('expense-items-container');
        const rows = Array.from(container?.querySelectorAll('.expense-item-row') || []);
        rows.slice(1).forEach(row => row.remove());
        const firstRow = rows[0];
        if (firstRow) {
            firstRow.querySelector('.expense-category-select').value = '';
            firstRow.querySelector('.expense-amount-field').value = '';
            const manualInput = firstRow.querySelector('.expense-manual-category');
            if (manualInput) {
                manualInput.value = '';
                manualInput.classList.add('hidden');
            }
        }
        updateExpenseRemoveButtons();
    };
    window.resetExpenseItems = resetExpenseItems;

    document.querySelectorAll('.expense-item-row').forEach(bindExpenseItemRow);
    updateExpenseRemoveButtons();
    addSafeListener('add-expense-item', 'click', () => {
        const row = createExpenseItemRow();
        row?.querySelector('.expense-category-select')?.focus();
    });
    addSafeListener('os-history-toggle', 'click', toggleOSHistory);
    addSafeListener('login-form', 'submit', loginAdmin);
    addSafeListener('btn-tab-gestao', 'click', () => showAdminView('gestao'));
    addSafeListener('btn-tab-estoque', 'click', () => showAdminView('estoque'));
    addSafeListener('btn-tab-financeiro', 'click', () => showAdminView('financeiro'));
    addSafeListener('stock-search', 'input', (e) => renderAdminStock(e.target.value));
    addSafeListener('shop-search', 'input', renderShop);
    addSafeListener('os-cancel-edit', 'click', resetOSForm);
    addSafeListener('prod-cancel-edit', 'click', resetProductForm);

    addPartRow();
    renderHistory();
    renderOpenOrders();
    renderClosedOrders();
    refreshFinanceDashboard();
    initAuthObserver();

    const refreshFinanceIfOpen = () => {
        const financeView = document.getElementById('view-financeiro');
        if (financeView && !financeView.classList.contains('hidden')) {
            refreshFinanceDashboard();
        }
    };

    window.addEventListener('resize', refreshFinanceIfOpen);
    window.addEventListener('orientationchange', () => setTimeout(refreshFinanceIfOpen, 250));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshFinanceIfOpen();
    });
});
