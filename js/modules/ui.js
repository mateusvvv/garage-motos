import { auth } from '../../firebase-config.js';
import { state, notificationSound } from '../core/state.js';

function updateScrollLock() {
    const isMenuOpen = !document.getElementById('main-menu')?.classList.contains('hidden');
    const isAdminOpen = !document.getElementById('admin-panel')?.classList.contains('hidden');
    const isPickerOpen = !document.getElementById('appointment-picker-overlay')?.classList.contains('hidden');
    document.body.style.overflow = (isMenuOpen || isAdminOpen || isPickerOpen) ? 'hidden' : '';
}


function toggleMenu() {
    const menu = document.getElementById('main-menu');
    menu.classList.toggle('hidden');
    toggleMenuShakeAnimation(false); // Para a animação quando o menu é aberto
    updateScrollLock();
}

function toggleAdmin() {
    const panel = document.getElementById('admin-panel');
    panel.classList.toggle('hidden');
    updateScrollLock();
    if (!panel.classList.contains('hidden')) window.GM?.renderAdminAppointments?.();
    window.GM?.renderAdminStock?.(); // Atualiza estoque na visão admin
}

function startAlarm() {
    const alertUI = document.getElementById('new-appointment-alert');
    if (alertUI) {
        alertUI.classList.remove('hidden');
        toggleMenuShakeAnimation(true); // Inicia a animação de shake
        notificationSound.play().catch(e => console.log("Interação necessária para tocar som."));
    }
}

function stopAlarm() {
    const alertUI = document.getElementById('new-appointment-alert');
    if (alertUI) {
        alertUI.classList.add('hidden');
        notificationSound.pause();
        toggleMenuShakeAnimation(false); // Para a animação quando o alarme é desligado
        notificationSound.currentTime = 0; // Reseta o som para o início
    }
}

function toggleAdminNav() {
    const nav = document.getElementById('admin-nav-menu');
    if (!nav) return;
    nav.classList.toggle('hidden');
}

function showAdminView(viewName) {
    // Mapeamento de títulos para o cabeçalho
    const viewTitles = {
        'gestao': 'GESTÃO',
        'estoque': 'ESTOQUE',
        'financeiro': 'FINANCEIRO'
    };

    // Restrição de acesso à área financeira para colaboradores
    if (viewName === 'financeiro' && state.currentUserRole === 'collaborator') {
        alert("Acesso restrito: Apenas administradores podem visualizar a área financeira.");
        return;
    }

    // Esconde/Mostra tabs baseado no cargo
    const financeBtn = document.getElementById('btn-tab-financeiro');
    if (financeBtn) financeBtn.style.display = (state.currentUserRole === 'admin') ? 'flex' : 'none';

    // Esconde todas as views
    document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
    // Remove classe ativa de todos os botões
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    
    // Mostra a view selecionada
    const targetView = document.getElementById(`view-${viewName}`);
    const targetBtn = document.getElementById(`btn-tab-${viewName}`);
    
    if (targetView) targetView.classList.remove('hidden');
    if (targetBtn) targetBtn.classList.add('active');

    // Atualiza o título no topo do painel
    const viewTitle = document.getElementById('admin-view-title');
    if (viewTitle) {
        viewTitle.textContent = viewTitles[viewName] || 'ADMIN';
    }
    
    // Atualiza componentes específicos se necessário
    if (viewName === 'financeiro') {
        window.GM?.refreshFinanceDashboard?.();
        requestAnimationFrame(() => window.GM?.refreshFinanceDashboard?.());
        setTimeout(() => window.GM?.refreshFinanceDashboard?.(), 250);
    }
}

function toggleShop() {
    const panel = document.getElementById('shop-overlay');
    panel.classList.toggle('hidden');
    updateScrollLock();
}

function toggleClosedOrders() {
    const list = document.getElementById('closed-os-list');
    const button = document.getElementById('closed-os-toggle');
    const label = document.getElementById('closed-os-toggle-label');
    if (!list) return;

    const isOpening = list.classList.contains('hidden');
    list.classList.toggle('hidden', !isOpening);
    if (button) button.setAttribute('aria-expanded', String(isOpening));
    if (label) label.textContent = isOpening ? 'Ocultar O.S' : 'Mostrar O.S';
}

function toggleOSHistory() {
    const table = document.getElementById('os-history-table');
    const button = document.getElementById('os-history-toggle');
    if (!table) return;

    const isOpening = table.classList.contains('hidden');
    table.classList.toggle('hidden', !isOpening);
    table.style.display = isOpening ? 'block' : 'none';
    if (button) {
        button.setAttribute('aria-expanded', String(isOpening));
        button.textContent = isOpening ? 'Ocultar O.S' : 'Mostrar O.S';
    }
    if (isOpening) window.GM?.renderHistory?.();
}

function toggleExpenseHistory() {
    const list = document.getElementById('expense-history-list');
    const button = document.getElementById('expense-history-toggle');
    if (!list) return;

    const isOpening = list.classList.contains('hidden');
    list.classList.toggle('hidden', !isOpening);
    list.style.display = isOpening ? 'block' : 'none';
    if (button) {
        button.setAttribute('aria-expanded', String(isOpening));
        button.textContent = isOpening ? 'Ocultar Histórico de Saídas' : 'Mostrar Histórico de Saídas';
    }
    if (isOpening) window.GM?.renderExpenseList?.();
}

function updateMenuBadge(count) {
    const mobileBadge = document.getElementById('menu-badge-mobile');
    const desktopBadge = document.getElementById('menu-badge-desktop');
    const displayCount = count > 9 ? '9+' : count;
    
    // Só exibe se houver agendamentos E o usuário estiver logado (admin ou funcionário)
    if (count > 0 && auth.currentUser) {
        mobileBadge?.classList.remove('hidden');
        desktopBadge?.classList.remove('hidden');
        if (mobileBadge) mobileBadge.textContent = displayCount;
        if (desktopBadge) desktopBadge.textContent = displayCount;
    } else {
        mobileBadge?.classList.add('hidden');
        desktopBadge?.classList.add('hidden');
    }
}

// Função para controlar a animação de shake dos botões de menu
function toggleMenuShakeAnimation(enable) {
    document.querySelectorAll('.menu-shake-target').forEach(button => {
        if (enable) button.classList.add('animate-shake');
        else button.classList.remove('animate-shake');
    });
}

// Exposição Global para botões HTML
window.toggleMenu = toggleMenu;
window.toggleAdmin = toggleAdmin;
window.stopAlarm = stopAlarm;
window.showAdminView = showAdminView;
window.toggleShop = toggleShop;
window.toggleClosedOrders = toggleClosedOrders;
window.toggleOSHistory = toggleOSHistory;
window.toggleExpenseHistory = toggleExpenseHistory;

export { updateScrollLock, toggleMenu, toggleAdmin, startAlarm, stopAlarm, toggleAdminNav, showAdminView, toggleShop, toggleClosedOrders, toggleOSHistory, toggleExpenseHistory, updateMenuBadge, toggleMenuShakeAnimation };
