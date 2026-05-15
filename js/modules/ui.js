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
        notificationSound.play().catch(e => console.log("Interação necessária para tocar som."));
    }
}

function stopAlarm() {
    const alertUI = document.getElementById('new-appointment-alert');
    if (alertUI) {
        alertUI.classList.add('hidden');
        notificationSound.pause();
        notificationSound.currentTime = 0; // Reseta o som para o início
    }
}

function toggleAdminNav() {
    const nav = document.getElementById('admin-nav-menu');
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
    document.getElementById('admin-view-title').textContent = viewTitles[viewName] || 'ADMIN';
    
    // Atualiza componentes específicos se necessário
    if (viewName === 'financeiro') window.GM?.renderChart?.();
}

function toggleShop() {
    const panel = document.getElementById('shop-overlay');
    panel.classList.toggle('hidden');
    updateScrollLock();
}


export { updateScrollLock, toggleMenu, toggleAdmin, startAlarm, stopAlarm, toggleAdminNav, showAdminView, toggleShop };
