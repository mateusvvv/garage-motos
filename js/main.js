import { initProductsSync, addProduct, editProduct, deleteProduct, deleteAllProducts, resetProductForm, renderShop, renderAdminStock, reserveProduct, reloadProducts, printLowStockReport } from './modules/products.js';
import { initCalendar, initAppointmentsSync, openAppointmentPicker, closeAppointmentPicker, scheduleService, blockDate, deleteAppointment, clearBlockedDates, renderAdminAppointments, deleteAllAppointments } from './modules/appointments.js';
import { addPartRow, updateDiscountTargets, applyOSDiscount, saveOSDraft, finalizeOS, loadOSDraft, deleteOpenOS, clearOSHistory, editOS, deleteOS, downloadOSPDF, resetOSForm, renderHistory, renderOpenOrders, renderClosedOrders } from './modules/orders.js';
import { renderChart, updateRevenueFilterOptions } from './modules/finance.js';
import { loginAdmin, logoutAdmin, initAuthObserver } from './modules/auth.js';
import { toggleMenu, toggleAdmin, toggleShop, toggleAdminNav, showAdminView, startAlarm, stopAlarm } from './modules/ui.js';

window.GM = {
    renderAdminStock,
    renderAdminAppointments,
    renderChart
};

Object.assign(window, {
    toggleMenu,
    toggleAdmin,
    toggleShop,
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
    updateDiscountTargets,
    applyOSDiscount,
    editOS,
    deleteOS,
    downloadOSPDF,
    startAlarm,
    stopAlarm
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar')) initCalendar();
    initProductsSync();
    initAppointmentsSync();

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
    addSafeListener('login-form', 'submit', loginAdmin);
    addSafeListener('stock-search', 'input', (e) => renderAdminStock(e.target.value));
    addSafeListener('shop-search', 'input', renderShop);
    addSafeListener('os-cancel-edit', 'click', resetOSForm);
    addSafeListener('prod-cancel-edit', 'click', resetProductForm);

    addPartRow();
    renderHistory();
    renderOpenOrders();
    renderClosedOrders();
    updateRevenueFilterOptions();
    renderChart();
    initAuthObserver();
});
