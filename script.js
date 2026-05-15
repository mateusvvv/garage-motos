import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Gerenciamento de Estado Global (LocalStorage)
let products = []; // Agora sincronizado via Firebase
let openOrders = JSON.parse(localStorage.getItem('gm_open_orders')) || [];
let serviceOrders = JSON.parse(localStorage.getItem('gm_orders')) || [];
let appointmentRequests = []; // Sincronizado em tempo real com o Firebase
let pickerCalendar;
let tempSelectedDate = '';
let currentOSDiscounts = [];
let currentUserRole = 'collaborator'; // Valor padrão de segurança

// Configuração de Notificação Sonora
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
notificationSound.loop = true; // Define o som para repetir infinitamente
let isInitialLoad = true;

// Função centralizada para gerenciar o bloqueio de rolagem (Scroll Lock)
function updateScrollLock() {
    const isMenuOpen = !document.getElementById('main-menu')?.classList.contains('hidden');
    const isAdminOpen = !document.getElementById('admin-panel')?.classList.contains('hidden');
    const isPickerOpen = !document.getElementById('appointment-picker-overlay')?.classList.contains('hidden');
    document.body.style.overflow = (isMenuOpen || isAdminOpen || isPickerOpen) ? 'hidden' : '';
}

// Tornar funções globais para o HTML
window.toggleMenu = toggleMenu;
window.toggleAdmin = toggleAdmin;
window.toggleShop = toggleShop;
window.openAppointmentPicker = openAppointmentPicker;
window.closeAppointmentPicker = closeAppointmentPicker;
window.toggleAdminNav = toggleAdminNav;
window.showAdminView = showAdminView;
window.logoutAdmin = logoutAdmin;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.loadOSDraft = loadOSDraft;
window.reserveProduct = reserveProduct;
window.deleteOpenOS = deleteOpenOS;
window.clearOSHistory = clearOSHistory;
window.finalizeOS = finalizeOS;
window.deleteAllProducts = deleteAllProducts;
window.deleteAppointment = deleteAppointment;
window.clearBlockedDates = clearBlockedDates;
window.printLowStockReport = printLowStockReport;
window.addPartRow = addPartRow;
window.applyOSDiscount = applyOSDiscount;
window.editOS = editOS;
window.deleteOS = deleteOS;
window.downloadOSPDF = downloadOSPDF;
window.startAlarm = startAlarm; // Torna a função de início do alarme global
window.stopAlarm = stopAlarm; // Torna a função de parar alarme global

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar')) initCalendar();
    initProductsSync(); // Nova função para sincronizar produtos
    
    // Auxiliar para adicionar listeners apenas se o elemento existir
    const addSafeListener = (id, event, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    };

    addSafeListener('product-form', 'submit', addProduct);
    addSafeListener('os-form', 'submit', saveOSDraft); // Agora o submit salva como rascunho
    addSafeListener('os-close-btn', 'click', finalizeOS); // Botão de conclusão
    addSafeListener('appointment-form', 'submit', scheduleService);
    addSafeListener('block-date-form', 'submit', blockDate);
    addSafeListener('revenue-filter', 'change', renderChart);
    addSafeListener('login-form', 'submit', loginAdmin);
    addSafeListener('stock-search', 'input', (e) => renderAdminStock(e.target.value));
    addSafeListener('os-cancel-edit', 'click', resetOSForm);
    addSafeListener('prod-cancel-edit', 'click', resetProductForm);
    
    addPartRow(); // Inicia com uma linha de peça vazia

    // Inicializa views se os dados locais existirem
    renderHistory();
    renderOpenOrders();
    updateRevenueFilterOptions();
    renderChart(); // Agora com verificação interna de existência

    // Observador de estado de autenticação
    onAuthStateChanged(auth, async (user) => {
        const dashboard = document.getElementById('admin-dashboard-ui');
        const loginUI = document.getElementById('admin-login-ui');
        
        // Verifica se os elementos existem na página atual para evitar erros
        if (!dashboard || !loginUI) return;

        if (user) {
            // Definição de Cargo baseada no e-mail fornecido
            if (user.email === 'leonardo1412goncalves@gmail.com') {
                currentUserRole = 'admin';
            } else if (user.email === 'garagemotos@gmail.com') {
                currentUserRole = 'collaborator';
            } else {
                // Tenta buscar no Firestore para outros usuários, mas não desloga em caso de erro
                try {
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    currentUserRole = userDoc.exists() ? userDoc.data().role : 'collaborator';
                } catch (e) {
                    console.warn("Firestore inacessível, definindo como colaborador por padrão.");
                    currentUserRole = 'collaborator';
                }
            }

            // Atualiza a label de perfil no topo do painel
            const roleLabel = document.getElementById('admin-role-label');
            if (roleLabel) {
                roleLabel.textContent = `Perfil: ${currentUserRole === 'admin' ? 'Administrador' : 'Funcionário'}`;
            }

            // Gerencia visibilidade do botão "Remover Todos" no estoque
            const btnDeleteAll = document.getElementById('btn-delete-all');
            if (btnDeleteAll) btnDeleteAll.style.display = (currentUserRole === 'admin') ? 'block' : 'none';

            dashboard.classList.remove('hidden');
            loginUI.classList.add('hidden');
            renderAdminStock();
            renderAdminAppointments();
            showAdminView('gestao'); // Inicia na aba de gestão
        } else {
            dashboard.classList.add('hidden');
            loginUI.classList.remove('hidden');
        }
    });
});

async function loginAdmin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        console.error("Erro de login:", error.code);
        if (error.code === 'auth/user-not-found') {
            alert('Acesso negado: Este e-mail não foi cadastrado no Firebase.');
        } else if (error.code === 'auth/wrong-password') {
            alert('Acesso negado: Senha incorreta.');
        } else {
            alert('Acesso negado: Credenciais inválidas ou erro de conexão.');
        }
    }
}

async function logoutAdmin() {
    if (confirm('Tem certeza que deseja sair do painel administrativo?')) {
        await signOut(auth);
    }
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
    renderAdminStock(); // Atualiza estoque na visão admin
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
    if (viewName === 'financeiro' && currentUserRole === 'collaborator') {
        alert("Acesso restrito: Apenas administradores podem visualizar a área financeira.");
        return;
    }

    // Esconde/Mostra tabs baseado no cargo
    const financeBtn = document.getElementById('btn-tab-financeiro');
    if (financeBtn) financeBtn.style.display = (currentUserRole === 'admin') ? 'flex' : 'none';

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
    if (viewName === 'financeiro') renderChart();
}

function toggleShop() {
    const panel = document.getElementById('shop-overlay');
    panel.classList.toggle('hidden');
    updateScrollLock();
}

// --- SISTEMA DE PRODUTOS ---
async function addProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const name = document.getElementById('prod-name').value;
    const price = document.getElementById('prod-price').value;
    const stock = document.getElementById('prod-stock').value;
    const location = document.getElementById('prod-location').value;
    const imgFile = document.getElementById('prod-image').files[0];

    let imgBase64 = '';
    if (imgFile) {
        // Validação de tamanho da imagem antes de converter para Base64
        // Firestore tem limite de 1MB por documento. Base64 aumenta o tamanho em ~33%.
        if (imgFile.size > 750 * 1024) { // Aproximadamente 750KB de arquivo bruto
            alert("A imagem é muito grande! Por favor, selecione uma imagem menor (máx. 750KB) para evitar problemas de armazenamento no Firebase.");
            return; // Impede o processamento e o salvamento
        }
        imgBase64 = await toBase64(imgFile);
    }

    const productData = {
        name,
        price: parseFloat(price),
        stock: parseInt(stock),
        image: imgBase64 || '',
        location: location || ''
    };

    try {
        if (id) {
            const product = products.find(p => p.id === id);
            if (!imgBase64 && product) productData.image = product.image;
            await setDoc(doc(db, "products", id), productData);
        } else {
            await addDoc(collection(db, "products"), productData);
        }
        alert("Produto salvo com sucesso!");
        resetProductForm();
    } catch (error) {
        console.error("Erro ao salvar produto no Firestore:", error);
        if (error.code === 'resource-exhausted') {
            alert("Erro: O documento do produto (provavelmente a imagem) é muito grande. Por favor, use uma imagem menor.");
        } else {
            alert("Erro ao salvar o produto. Verifique sua conexão.");
        }
    }
}

function initProductsSync() {
    const productsCol = collection(db, "products");
    onSnapshot(productsCol, (snapshot) => {
        products = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        renderShop();

        // Ocultar tela de carregamento se ela existir (página pecas.html)
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) {
            loadingScreen.classList.add('opacity-0');
            setTimeout(() => {
                loadingScreen.classList.add('hidden');
            }, 500);
        }

        if (auth.currentUser) renderAdminStock();
    });
}

function editProduct(id) {
    const p = products.find(prod => prod.id === id);
    if (!p) return;
    
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-price').value = p.price;
    document.getElementById('prod-stock').value = p.stock;
    document.getElementById('prod-location').value = p.location || '';
    
    document.querySelector('#product-form button[type="submit"]').textContent = 'Atualizar Item';
    document.getElementById('prod-cancel-edit').classList.remove('hidden');
}

async function deleteProduct(id) {
    if (confirm('Deseja realmente excluir este produto do estoque?')) {
        await deleteDoc(doc(db, "products", id));
    }
}

async function deleteAllProducts() {
    if (currentUserRole !== 'admin') {
        alert("Acesso negado: Apenas administradores podem remover todos os itens do estoque.");
        return;
    }

    if (products.length === 0) {
        alert('O estoque já está vazio.');
        return;
    }

    if (!confirm(`Tem certeza que deseja remover todos os ${products.length} itens do estoque? Essa ação não pode ser desfeita.`)) return;

    try {
        await Promise.all(products.map(product => deleteDoc(doc(db, "products", product.id))));
        resetProductForm();
        alert('Todos os itens foram removidos do estoque.');
    } catch (error) {
        console.error("Erro ao remover todos os produtos do Firestore:", error);
        alert('Erro ao remover os itens do estoque. Verifique sua conexão.');
    }
}

function resetProductForm() {
    document.getElementById('product-form').reset();
    document.getElementById('prod-id').value = '';
    document.querySelector('#product-form button[type="submit"]').textContent = 'Adicionar Item';
    document.getElementById('prod-cancel-edit').classList.add('hidden');
}

// --- SISTEMA DE O.S ---
function addPartRow(name = '', price = '') {
    const container = document.getElementById('os-parts-container');
    const div = document.createElement('div');
    div.className = 'flex gap-2 items-center os-part-row';
    div.innerHTML = `
        <input type="text" placeholder="Nome da Peça" class="flex-1 min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-name" value="${name}" oninput="updateDiscountTargets()">
        <input type="number" step="0.01" placeholder="R$" class="w-20 md:w-24 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-price" value="${price}">
        <button type="button" onclick="this.parentElement.remove(); updateDiscountTargets();" class="text-neutral-600 hover:text-red-500 p-1">✕</button>
    `;
    container.appendChild(div);
    updateDiscountTargets();
}

window.updateDiscountTargets = updateDiscountTargets;

function updateDiscountTargets() {
    const targetSelect = document.getElementById('os-discount-target');
    if (!targetSelect) return;

    const selectedValue = targetSelect.value;
    const partRows = Array.from(document.querySelectorAll('.os-part-row'));
    targetSelect.innerHTML = '';

    const laborOption = document.createElement('option');
    laborOption.value = 'labor';
    laborOption.textContent = 'Mão de Obra';
    targetSelect.appendChild(laborOption);

    partRows.forEach((row, index) => {
        const name = row.querySelector('.part-name').value.trim() || `Peça ${index + 1}`;
        const option = document.createElement('option');
        option.value = `part-${index}`;
        option.textContent = name;
        targetSelect.appendChild(option);
    });

    if ([...targetSelect.options].some(option => option.value === selectedValue)) {
        targetSelect.value = selectedValue;
    }
}

function applyOSDiscount() {
    const target = document.getElementById('os-discount-target').value;
    const type = document.getElementById('os-discount-type').value;
    const discountInput = document.getElementById('os-discount-value');
    const discountValue = parseFloat(discountInput.value) || 0;

    if (discountValue <= 0) {
        alert('Informe um valor de desconto válido.');
        return;
    }

    const targetInput = target === 'labor'
        ? document.getElementById('os-labor')
        : document.querySelectorAll('.os-part-row')[parseInt(target.replace('part-', ''), 10)]?.querySelector('.part-price');

    if (!targetInput) {
        alert('Selecione um item válido para aplicar o desconto.');
        return;
    }

    const currentValue = parseFloat(targetInput.value) || 0;
    const discountAmount = type === 'percent'
        ? currentValue * Math.min(discountValue, 100) / 100
        : discountValue;
    const newValue = Math.max(currentValue - discountAmount, 0);
    const appliedAmount = currentValue - newValue;

    targetInput.value = newValue.toFixed(2);
    currentOSDiscounts.push({
        target: target === 'labor'
            ? 'Mão de Obra'
            : document.getElementById('os-discount-target').selectedOptions[0]?.textContent || 'Peça',
        type,
        value: discountValue,
        amount: appliedAmount
    });
    discountInput.value = '';
    alert(`Desconto aplicado. Novo valor: R$ ${newValue.toFixed(2)}`);
}

// Coleta os dados do formulário de O.S
function getOSFormData() {
    const id = document.getElementById('os-id').value;
    const client = document.getElementById('os-client').value;
    const bike = document.getElementById('os-bike').value;
    const observations = document.getElementById('os-observations').value;
    const mechanic = document.getElementById('os-mechanic').value;
    const paymentMethod = document.getElementById('os-payment').value;
    const labor = parseFloat(document.getElementById('os-labor').value) || 0;
    
    const partRows = document.querySelectorAll('.os-part-row');
    const parts = [];
    let partsTotal = 0;
    
    partRows.forEach(row => {
        const name = row.querySelector('.part-name').value;
        const price = parseFloat(row.querySelector('.part-price').value) || 0;
        if (name || price > 0) {
            parts.push({ name, price });
            partsTotal += price;
        }
    });

    return {
        id: id ? parseInt(id) : Date.now(),
        client,
        bike,
        observations,
        mechanic,
        paymentMethod,
        labor,
        parts,
        partsTotal,
        total: labor + partsTotal,
        discounts: [...currentOSDiscounts],
        discountTotal: currentOSDiscounts.reduce((sum, d) => sum + Number(d.amount || 0), 0)
    };
}

// ETAPA 1: Salvar Rascunho
function saveOSDraft(e) {
    if(e) e.preventDefault();
    const data = getOSFormData();
    
    const index = openOrders.findIndex(o => o.id === data.id);
    
    if (index === -1) {
        if (openOrders.length >= 15) {
            alert("Limite de 15 ordens abertas atingido. Finalize alguma para abrir uma nova.");
            return;
        }
        openOrders.push(data);
    } else {
        openOrders[index] = data;
    }

    saveAndRefresh();
    resetOSForm();
    alert("Rascunho salvo com sucesso!");
}

// ETAPA 2: Finalizar O.S
function finalizeOS() {
    const data = getOSFormData();
    if (!data.client) { alert("Informe o cliente para finalizar."); return; }

    const existingOS = serviceOrders.find(o => o.id === data.id);
    const date = new Date().toLocaleDateString('pt-BR');
    
    const osData = { 
        ...data,
        osNumber: existingOS?.osNumber || getNextOSNumber(),
        date,
        editCount: existingOS ? (existingOS.editCount || 0) + 1 : 0
    };

    if (existingOS) {
        const idx = serviceOrders.findIndex(o => o.id === data.id);
        serviceOrders[idx] = osData;
    } else {
        serviceOrders.push(osData);
    }

    // Remove dos rascunhos se estiver lá
    openOrders = openOrders.filter(o => o.id !== data.id);
    
    downloadOSPDF(osData);
    saveAndRefresh();
    resetOSForm();
}

function getNextOSNumber() {
    return serviceOrders.reduce((max, os, index) => {
        return Math.max(max, Number(os.osNumber) || index + 1);
    }, 0) + 1;
}

function formatOSNumber(os, fallbackIndex = 0, digits = 3) {
    const orderIndex = serviceOrders.findIndex(order => order.id === os.id);
    const number = Number(os.osNumber) || (orderIndex >= 0 ? orderIndex + 1 : fallbackIndex + 1);
    return String(number).padStart(digits, '0');
}

async function downloadOSPDF(osOrId) {
    // Busca a O.S se for passado apenas o ID (clique no histórico) 
    // ou usa o objeto direto (geração de nova O.S)
    let os = (typeof osOrId === 'number') ? serviceOrders.find(o => o.id === osOrId) : osOrId;
    if (!os) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoData = await loadImageForPDF('img/logo.png');
    const parts = os.parts || [];
    const discounts = os.discounts || [];
    const money = value => `R$ ${Number(value || 0).toFixed(2)}`;
    
    doc.setFillColor(250, 250, 250);
    doc.rect(0, 0, 210, 297, 'F');

    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 44, 'F');
    doc.setFillColor(225, 29, 72);
    doc.rect(0, 44, 210, 2.5, 'F');

    if (logoData) {
        doc.addImage(logoData, 'PNG', 14, 7, 70, 31);
    } else {
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.setFont(undefined, 'bolditalic');
        doc.text('GARAGE MOTOS', 16, 26);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(17);
    doc.text('ORDEM DE SERVICO', 196, 19, { align: 'right' });
    doc.setFontSize(10);
    doc.setTextColor(225, 29, 72);
    doc.text(`O.S #${formatOSNumber(os)}`, 196, 29, { align: 'right' });
    doc.setTextColor(210, 210, 210);
    doc.text(`Emitida em ${os.date}`, 196, 36, { align: 'right' });

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 58, 182, 46, 2, 2, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(14, 58, 182, 46, 2, 2, 'S');

    doc.setTextColor(115, 115, 115);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('CLIENTE', 22, 68);
    doc.text('MOTO / PLACA', 112, 68);
    doc.text('OBSERVACOES / DEFEITO RELATADO', 22, 84);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text(String(os.client || '').toUpperCase(), 22, 76, { maxWidth: 78 });
    doc.text(String(os.bike || '').toUpperCase(), 112, 76, { maxWidth: 72 });
    
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    const obsLines = doc.splitTextToSize(String(os.observations || 'NADA CONSTA').toUpperCase(), 170);
    doc.text(obsLines, 22, 90);

    doc.setFillColor(0, 0, 0);
    doc.roundedRect(14, 114, 182, 11, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('DESCRICAO', 20, 121);
    doc.text('VALOR', 186, 121, { align: 'right' });

    let y = 136;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text('Mao de obra', 20, y);
    doc.text(money(os.labor), 186, y, { align: 'right' });
    doc.setDrawColor(235, 235, 235);
    doc.line(20, y + 5, 190, y + 5);
    y += 13;

    if (parts.length > 0) {
        parts.forEach(part => {
            const name = String(part.name || 'Peca').toUpperCase();
            const lines = doc.splitTextToSize(name, 130);
            doc.text(lines, 20, y);
            doc.text(money(part.price), 186, y, { align: 'right' });
            y += Math.max(10, lines.length * 5 + 4);
            doc.setDrawColor(235, 235, 235);
            doc.line(20, y, 190, y);
            y += 6;
        });
    } else {
        doc.setTextColor(115, 115, 115);
        doc.text('Nenhuma peca adicionada.', 20, y);
        y += 11;
    }

    if (discounts.length > 0) {
        doc.setTextColor(225, 29, 72);
        doc.setFont(undefined, 'bold');
        discounts.forEach(discount => {
            const discountText = discount.type === 'percent'
                ? `Desconto em ${discount.target} (${Number(discount.value || 0).toFixed(2)}%)`
                : `Desconto em ${discount.target}`;
            const lines = doc.splitTextToSize(discountText.toUpperCase(), 130);
            doc.text(lines, 20, y);
            doc.text(`- ${money(discount.amount)}`, 186, y, { align: 'right' });
            y += Math.max(10, lines.length * 5 + 4);
            doc.setDrawColor(235, 235, 235);
            doc.line(20, y, 190, y);
            y += 6;
        });
        doc.setFont(undefined, 'normal');
        doc.setTextColor(0, 0, 0);
    }

    const totalsY = Math.max(y + 8, 218);
    const totalsHeight = discounts.length > 0 ? 43 : 34;
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(118, totalsY, 78, totalsHeight, 2, 2, 'F');
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('PECAS', 126, totalsY + 10);
    doc.text(money(os.partsTotal), 188, totalsY + 10, { align: 'right' });
    doc.text('MAO DE OBRA', 126, totalsY + 19);
    doc.text(money(os.labor), 188, totalsY + 19, { align: 'right' });
    if (discounts.length > 0) {
        doc.text('DESCONTO', 126, totalsY + 28);
        doc.text(`- ${money(os.discountTotal)}`, 188, totalsY + 28, { align: 'right' });
    }
    doc.setFillColor(225, 29, 72);
    doc.roundedRect(118, totalsY + (discounts.length > 0 ? 33 : 24), 78, 14, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text('TOTAL', 126, totalsY + (discounts.length > 0 ? 42 : 33));
    doc.text(money(os.total), 188, totalsY + (discounts.length > 0 ? 42 : 33), { align: 'right' });

    doc.setTextColor(115, 115, 115);
    doc.setFontSize(8);
    doc.text('Garage Motos - Acessorios, Pecas e Servicos', 14, 279);
    doc.text('@garagemotosbj', 14, 285);
    doc.setDrawColor(225, 29, 72);
    doc.line(14, 272, 196, 272);
    
    doc.save(`OS_${formatOSNumber(os, 0, 5)}.pdf`);
}

// --- SISTEMA DE AGENDAMENTO ---
let calendar;
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        height: 'auto',
        headerToolbar: { left: 'title', center: '', right: 'today prev,next' },
        buttonText: { today: 'Hoje' },
        validRange: {
            start: new Date().toLocaleDateString('sv-SE') // Impede visualização de datas passadas
        },
        businessHours: {
            daysOfWeek: [1, 2, 3, 4, 5], // Segunda a Sexta
        },
        events: [],
        eventContent: function(arg) {
            const type = arg.event.extendedProps.type;
            if (type === 'request') { // Agendamento de serviço
                return { html: `<div class="fc-event-main text-center" style="font-size: 0.7rem;" title="${arg.event.title}">🛠️</div>` };
            }
            return { html: `<div class="fc-event-main text-center" style="font-size: 0.7rem; white-space: normal; line-height: 1.1;">${arg.event.title}</div>` }; // Bloqueio
        },
        dateClick: function(info) {
            const day = new Date(info.date).getUTCDay();
            if (day === 0 || day === 6) return;
            
            const isBlocked = appointmentRequests.some(e => e.type === 'block' && e.start === info.dateStr);
            if (isBlocked) {
                alert("Desculpe, esta data está indisponível.");
                return;
            }

            // Remove destaque de outros dias e adiciona no clicado
            document.querySelectorAll('.fc-daygrid-day').forEach(el => el.classList.remove('selected-day'));
            info.dayEl.classList.add('selected-day');

            // Seleciona o dia diretamente no formulário
            const parts = info.dateStr.split('-');
            document.getElementById('service-date-only').value = info.dateStr;
            document.getElementById('picker-label').textContent = 'Dia Selecionado:';
            document.getElementById('picker-selected').textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
    });
    calendar.render();

    // Sincronização em tempo real com o Firebase
    onSnapshot(collection(db, "appointments"), (snapshot) => {
        const docChanges = snapshot.docChanges();
        appointmentRequests = [];
        const calendarEvents = [];
        snapshot.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() };
            appointmentRequests.push(data);
            calendarEvents.push(data);
        });

        // Tocar som se houver um novo agendamento (após carregamento inicial e se o admin estiver logado)
        if (!isInitialLoad && auth.currentUser) {
            const isDashboardVisible = !document.getElementById('admin-dashboard-ui')?.classList.contains('hidden');
            
            docChanges.forEach(change => {
                // Dispara apenas para novos agendamentos de clientes se o painel estiver aberto
                if (change.type === 'added' && change.doc.data().type === 'request' && isDashboardVisible) {
                    startAlarm(); // Dispara o alarme visual e sonoro repetitivo
                }
            });
        }
        if (isInitialLoad && snapshot.docs.length >= 0) isInitialLoad = false;

        if (calendar) {
            calendar.removeAllEvents();
            calendarEvents.forEach(ev => calendar.addEvent(ev));
        }
        if (pickerCalendar) {
            pickerCalendar.removeAllEvents();
            calendarEvents.forEach(ev => pickerCalendar.addEvent(ev));
        }
        if (auth.currentUser) renderAdminAppointments();
    });
}

function openAppointmentPicker() {
    document.getElementById('appointment-picker-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('picker-step-1').classList.remove('hidden');
    
    if (!pickerCalendar) {
        const calendarEl = document.getElementById('picker-calendar');
        pickerCalendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'pt-br',
            height: 'auto',
            headerToolbar: { left: 'title', center: '', right: 'today prev,next' },
            buttonText: { today: 'Hoje' },
            validRange: {
                start: new Date().toLocaleDateString('sv-SE') // Define hoje como data mínima (Formato YYYY-MM-DD)
            },
            businessHours: { daysOfWeek: [1, 2, 3, 4, 5] },
            events: appointmentRequests,
            eventContent: function(arg) {
                const type = arg.event.extendedProps.type;
                if (type === 'request') { // Agendamento de serviço
                    return { html: `<div class="fc-event-main text-center" style="font-size: 0.7rem;" title="${arg.event.title}">🛠️</div>` };
                }
                return { html: `<div class="fc-event-main text-center" style="font-size: 0.7rem; white-space: normal; line-height: 1.1;">${arg.event.title}</div>` }; // Bloqueio
            },
            dateClick: function(info) {
                const day = new Date(info.date).getUTCDay();
                if (day === 0 || day === 6) return;
                
                // Verifica se o dia está bloqueado pelo Admin
                const isBlocked = appointmentRequests.some(e => e.type === 'block' && e.start === info.dateStr);
                if (isBlocked) {
                    alert("Desculpe, esta data está indisponível.");
                    return;
                }

                // Destaque visual no picker
                document.querySelectorAll('.fc-daygrid-day').forEach(el => el.classList.remove('selected-day'));
                info.dayEl.classList.add('selected-day');

                const parts = info.dateStr.split('-');
                document.getElementById('service-date-only').value = info.dateStr;
                document.getElementById('picker-label').textContent = 'Dia Selecionado:';
                document.getElementById('picker-selected').textContent = `${parts[2]}/${parts[1]}/${parts[0]}`;
                closeAppointmentPicker();
            }
        });
    } else {
        pickerCalendar.removeAllEvents();
        appointmentRequests.forEach(ev => pickerCalendar.addEvent(ev));
    }
    setTimeout(() => pickerCalendar.render(), 100);
}

function closeAppointmentPicker() {
    document.getElementById('appointment-picker-overlay').classList.add('hidden');
    updateScrollLock();
}

async function scheduleService(e) {
    e.preventDefault();
    const name = document.getElementById('client-name').value;
    const bike = document.getElementById('bike-info').value;
    const datePart = document.getElementById('service-date-only').value;

    if (!datePart) return;
    
    try {
        await addDoc(collection(db, "appointments"), {
            title: `🛠️ ${bike} - ${name}`,
            start: datePart,
            color: '#e11d48',
            clientName: name,
            bikeInfo: bike,
            createdAt: new Date().toISOString(),
            type: 'request'
        });
        alert('Solicitação enviada com sucesso! O mecânico verificará sua vaga.');
        e.target.reset();
    } catch (err) {
        alert('Erro ao agendar. Tente novamente.');
    }
}

async function blockDate(e) {
    e.preventDefault();
    const date = document.getElementById('block-date').value;
    const reason = document.getElementById('block-reason').value || 'INDISPONÍVEL';

    try {
        await addDoc(collection(db, "appointments"), {
            title: `🚫 ${reason}`,
            start: date,
            color: '#262626',
            type: 'block'
        });
        e.target.reset();
    } catch (err) {
        alert('Erro ao bloquear data.');
    }
}

async function deleteAppointment(id) {
    if (confirm('Remover este agendamento/bloqueio?')) {
        await deleteDoc(doc(db, "appointments", id));
    }
}

async function clearBlockedDates() {
    const blockedDates = appointmentRequests.filter(e => e.type === 'block');

    if (blockedDates.length === 0) {
        alert('Não há datas bloqueadas para limpar.');
        return;
    }

    if (!confirm(`Deseja remover todas as ${blockedDates.length} datas bloqueadas? Os agendamentos de clientes serão mantidos.`)) return;

    try {
        await Promise.all(blockedDates.map(e => deleteDoc(doc(db, "appointments", e.id))));
        alert('Todas as datas bloqueadas foram removidas.');
    } catch (err) {
        console.error('Erro ao limpar datas bloqueadas:', err);
        alert('Erro ao limpar as datas bloqueadas. Tente novamente.');
    }
}

// --- SISTEMA DE GRÁFICOS ---
let revenueChart;
function renderChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return; // Importante: evita que o script trave se o gráfico não existir na página
    const ctx = canvas.getContext('2d');
    const filter = document.getElementById('revenue-filter').value;
    const filterLabel = document.getElementById('revenue-filter').selectedOptions[0]?.textContent || 'Total';
    
    let filteredOrders = serviceOrders;
    if (filter !== 'all') {
        filteredOrders = serviceOrders.filter(os => os.date.endsWith(filter));
    }

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

    if (revenueChart) revenueChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(225, 29, 72, 0.4)');
    gradient.addColorStop(1, 'rgba(225, 29, 72, 0)');

    revenueChart = new Chart(ctx, {
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

function updateFinanceSummary(filteredOrders, filterLabel) {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const todayOrders = serviceOrders.filter(o => o.date === todayStr);

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

// --- HELPERS ---
function saveAndRefresh() {
    try {
        localStorage.setItem('gm_orders', JSON.stringify(serviceOrders));
        localStorage.setItem('gm_open_orders', JSON.stringify(openOrders));
    } catch (e) {
        console.error("Erro ao salvar no LocalStorage: Provavelmente o limite de 5MB foi atingido devido às fotos.");
        alert("Atenção: O limite de armazenamento de fotos foi atingido. Tente usar fotos menores ou remova itens antigos.");
    }
    
    renderHistory();
    renderOpenOrders();
    renderAdminStock();
    updateRevenueFilterOptions();
    renderChart();
}

function renderShop() {
    const containers = [
        { el: document.getElementById('shop-container'), limit: 4, showStock: false },
        { el: document.getElementById('full-shop-container'), limit: 100, showStock: true }
    ];

    containers.forEach(({ el, limit, showStock }) => {
        if (!el) return;
        el.innerHTML = products.slice(0, limit).map(p => `
            <div class="bg-neutral-900 border border-neutral-800 rounded-lg md:rounded-xl overflow-hidden product-card flex flex-col h-full">
                <div class="h-40 md:h-56 bg-neutral-800 flex items-center justify-center p-2 overflow-hidden">
                    ${p.image ? 
                        `<img src="${p.image}" class="max-h-full max-w-full object-contain" alt="${p.name}">` : 
                        '<div class="text-neutral-600 font-bold uppercase tracking-widest text-[8px] md:text-xs text-center">Sem Foto</div>'
                    }
                </div>
                <div class="p-3 md:p-5 flex flex-col flex-grow">
                    <h5 class="font-bold text-xs md:text-lg mb-1 truncate uppercase">${p.name}</h5>
                    <p class="text-red-600 font-black text-sm md:text-2xl ${showStock ? 'mb-1' : 'mb-3 md:mb-4'}">R$ ${parseFloat(p.price).toFixed(2)}</p>
                    ${showStock ? `<p class="text-[10px] md:text-xs text-neutral-400 uppercase tracking-widest font-bold mb-3 md:mb-4">${formatStockLabel(p.stock)}</p>` : ''}
                    <button onclick="reserveProduct('${p.id}')" 
                       class="mt-auto w-full bg-white text-black py-2 rounded font-bold uppercase text-[10px] md:text-xs text-center hover:bg-red-600 hover:text-white transition cursor-pointer">
                       Reservar para Retirada
                    </button>
                </div>
            </div>
        `).join('');
    });
}

async function reserveProduct(productId) {
    const product = products.find(p => p.id === productId);
    
    if (!product || product.stock <= 0) {
        alert("Desculpe, este produto está sem estoque no momento.");
        return;
    }

    try {
        // 1. Atualiza o estoque no Firestore diminuindo 1 unidade
        const productRef = doc(db, "products", productId);
        await setDoc(productRef, { ...product, stock: product.stock - 1 });

        // 2. Abre o WhatsApp com a mensagem de reserva
        const message = `Olá! Gostaria de reservar o produto: ${product.name}. Entendo que o pagamento é feito na retirada e que a reserva é válida por 2 horas.`;
        const waUrl = `https://api.whatsapp.com/send?phone=558193735372&text=${encodeURIComponent(message)}`;
        window.open(waUrl, '_blank');
    } catch (error) {
        console.error("Erro ao processar reserva:", error);
        alert("Houve um erro ao reservar o item. Verifique sua conexão.");
    }
}

function formatStockLabel(stock) {
    const quantity = Number.parseInt(stock, 10) || 0;
    return `${quantity} ${quantity === 1 ? 'unidade disponível' : 'unidades disponíveis'}`;
}

function renderHistory() {
    const body = document.getElementById('os-history-body');
    if (!body) return;
    body.innerHTML = serviceOrders.map((os, index) => `
        <tr class="text-sm border-b border-neutral-900/50 hover:bg-white/[0.02] transition-colors">
            <td class="py-6 font-black text-red-600 italic leading-tight">
                O.S #${formatOSNumber(os, index)}
                ${os.editCount > 0 ? `<br><span class="text-[9px] text-neutral-500 not-italic font-bold uppercase tracking-tighter">Editada ${os.editCount}x</span>` : ''}
            </td>
            <td class="py-6 text-neutral-400">${os.date}</td>
            <td class="py-6 font-bold uppercase text-white">${os.client}</td>
            <td class="py-6 italic uppercase text-neutral-500 text-xs">${os.bike}</td>
            <td class="py-6 text-red-500 font-black">R$ ${os.total.toFixed(2)}</td>
            <td class="py-6 flex gap-4">
                <button onclick="editOS(${os.id})" class="text-blue-500 hover:text-blue-400 transition">Editar</button>
                <button onclick="downloadOSPDF(${os.id})" class="text-green-500 hover:text-green-400 transition">Baixar</button>
                <button onclick="deleteOS(${os.id})" class="text-neutral-600 hover:text-red-600 transition">Remover</button>
            </td>
        </tr>
    `).join('');
}

function renderOpenOrders() {
    const list = document.getElementById('open-os-list');
    const countLabel = document.getElementById('open-os-count');
    if (!list) return;

    if (countLabel) countLabel.textContent = `${openOrders.length} de 15 ordens em andamento`;

    list.innerHTML = openOrders.map(os => `
        <div class="bg-black border border-neutral-800 p-4 rounded-xl flex flex-col gap-3 animate-fade-in">
            <div class="flex justify-between items-start">
                <div class="flex-1 truncate mr-2">
                    <p class="text-red-600 font-black text-[9px] uppercase italic tracking-widest mb-1">Rascunho em aberto</p>
                    <h5 class="font-bold text-sm uppercase truncate text-white">${os.client || 'Sem Nome'}</h5>
                    <p class="text-[10px] text-neutral-500 uppercase italic truncate">${os.bike || 'Sem Moto'}</p>
                </div>
                <p class="text-white font-black text-sm">R$ ${os.total.toFixed(2)}</p>
            </div>
            <div class="flex gap-2 border-t border-neutral-900 pt-3">
                <button onclick="loadOSDraft(${os.id})" class="flex-1 bg-neutral-800 py-2 rounded text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition">Carregar</button>
                <button onclick="deleteOpenOS(${os.id})" class="bg-neutral-900 p-2 rounded text-neutral-600 hover:text-red-600 transition">✕</button>
            </div>
        </div>
    `).join('') || '<p class="col-span-full text-center text-neutral-600 text-[10px] py-8 uppercase font-bold tracking-[0.2em]">Nenhum rascunho ativo</p>';
}

function loadOSDraft(id) {
    const os = openOrders.find(o => o.id === id);
    if (!os) return;
    
    // Preenche o formulário
    document.getElementById('os-id').value = os.id;
    document.getElementById('os-client').value = os.client;
    document.getElementById('os-bike').value = os.bike;
    document.getElementById('os-observations').value = os.observations || '';
    document.getElementById('os-mechanic').value = os.mechanic || 'leo';
    document.getElementById('os-payment').value = os.paymentMethod || 'pix';
    document.getElementById('os-labor').value = os.labor;
    
    const container = document.getElementById('os-parts-container');
    container.innerHTML = '';
    os.parts.forEach(p => addPartRow(p.name, p.price));
    if (os.parts.length === 0) addPartRow();
    currentOSDiscounts = [...(os.discounts || [])];
    
    document.getElementById('os-form').scrollIntoView({ behavior: 'smooth' });
}

function editOS(id) {
    const os = serviceOrders.find(o => o.id === id);
    if (!os) return;

    document.getElementById('os-id').value = os.id;
    document.getElementById('os-client').value = os.client;
    document.getElementById('os-bike').value = os.bike;
    document.getElementById('os-observations').value = os.observations || '';
    document.getElementById('os-mechanic').value = os.mechanic || 'leo';
    document.getElementById('os-payment').value = os.paymentMethod || 'pix';
    document.getElementById('os-labor').value = os.labor;
    
    const container = document.getElementById('os-parts-container');
    container.innerHTML = '';
    os.parts.forEach(p => addPartRow(p.name, p.price));
    if (os.parts.length === 0) addPartRow();
    currentOSDiscounts = [...(os.discounts || [])];
    
    document.getElementById('os-submit-btn').textContent = 'Atualizar O.S & Baixar';
    document.getElementById('os-cancel-edit').classList.remove('hidden');
    
    // Troca para a aba de Gestão onde o formulário reside
    showAdminView('gestao');
    
    // Rola suavemente até o formulário
    document.getElementById('os-form').scrollIntoView({ behavior: 'smooth' });
}

function resetOSForm() {
    document.getElementById('os-form').reset();
    document.getElementById('os-id').value = '';
    document.getElementById('os-parts-container').innerHTML = '';
    document.getElementById('os-observations').value = '';
    currentOSDiscounts = [];
    addPartRow();
    document.getElementById('os-discount-value').value = '';
    document.getElementById('os-discount-type').value = 'fixed';
    updateDiscountTargets();
    document.getElementById('os-submit-btn').textContent = 'Salvar Rascunho';
    document.getElementById('os-cancel-edit').classList.add('hidden');
}

function deleteOS(id) {
    if (!confirm('Tem certeza que deseja excluir esta O.S?')) return;
    serviceOrders = serviceOrders.filter(o => o.id !== id);
    saveAndRefresh();
}

function clearOSHistory() {
    if (currentUserRole !== 'admin') {
        alert('Ação negada: Apenas administradores podem limpar o histórico.');
        return;
    }

    if (serviceOrders.length === 0) {
        alert('O histórico já está vazio.');
        return;
    }

    if (confirm(`Atenção: Você está prestes a apagar permanentemente todas as ${serviceOrders.length} ordens de serviço do histórico. Esta ação não pode ser desfeita. Deseja continuar?`)) {
        serviceOrders = [];
        saveAndRefresh();
    }
}

function deleteOpenOS(id) {
    if (!confirm('Deseja descartar este rascunho?')) return;
    openOrders = openOrders.filter(o => o.id !== id);
    saveAndRefresh();
}

function updateRevenueFilterOptions() {
    const select = document.getElementById('revenue-filter');
    if (!select) return;
    const months = new Set();
    const years = new Set();
    serviceOrders.forEach(os => {
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

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

function loadImageForPDF(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => {
            console.error(`Não foi possível carregar a logo para o PDF: ${src}`);
            resolve('');
        };
        img.src = src;
    });
}

function renderAdminStock(searchTerm = '') {
    const container = document.getElementById('admin-stock-list');
    const totalCountElement = document.getElementById('stock-total-count');
    if (!container) return;
    
    const filtered = products.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (totalCountElement) {
        totalCountElement.textContent = `Total de Itens: ${filtered.length}`;
    }

    const isAdmin = currentUserRole === 'admin';

    container.innerHTML = filtered.map(p => `
        <div class="flex items-center justify-between p-4 border-b border-neutral-800 hover:bg-black/30 transition rounded">
            <div class="flex items-center gap-4 overflow-hidden">
                <div class="w-12 h-12 flex-shrink-0 bg-neutral-800 rounded flex items-center justify-center overflow-hidden">
                    ${p.image ? `<img src="${p.image}" class="max-h-full max-w-full object-contain">` : ''}
                </div>
                <div class="truncate">
                    <p class="font-bold text-xs md:text-sm uppercase truncate">${p.name}</p>
                    <p class="text-[11px] md:text-xs text-neutral-500 uppercase tracking-tighter">Qtd: ${p.stock} | R$ ${parseFloat(p.price).toFixed(2)} ${p.location ? `| Loc: ${p.location}` : ''}</p>
                </div>
            </div>
            ${isAdmin ? `
                <div class="flex gap-3 ml-2">
                    <button onclick="editProduct('${p.id}')" class="text-blue-500 hover:text-blue-400 text-xs font-black uppercase italic">Editar</button>
                    <button onclick="deleteProduct('${p.id}')" class="text-neutral-600 hover:text-red-600 text-xs font-black uppercase italic">Excluir</button>
                </div>
            ` : ''}
        </div>
    `).join('') || '<p class="text-center text-neutral-600 text-xs uppercase font-bold py-4">Estoque Vazio</p>';
}

async function printLowStockReport() {
    if (!confirm("Deseja realmente gerar a lista de compras para reposição?")) return;

    const lowStockItems = products.filter(p => parseInt(p.stock) <= 5);
    if (lowStockItems.length === 0) {
        alert("O estoque está em dia! Nenhum item com 5 unidades ou menos.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoData = await loadImageForPDF('img/logo.png');
    const reportDate = new Date().toLocaleDateString('pt-BR');

    doc.setFillColor(250, 250, 250);
    doc.rect(0, 0, 210, 297, 'F');

    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 44, 'F');
    doc.setFillColor(225, 29, 72);
    doc.rect(0, 44, 210, 2.5, 'F');

    if (logoData) {
        doc.addImage(logoData, 'PNG', 14, 7, 70, 31);
    } else {
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.setFont(undefined, 'bolditalic');
        doc.text('GARAGE MOTOS', 16, 26);
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(16);
    doc.text('LISTA DE COMPRAS', 196, 19, { align: 'right' });
    doc.setTextColor(225, 29, 72);
    doc.setFontSize(10);
    doc.text('REPOSICAO DE ESTOQUE', 196, 29, { align: 'right' });
    doc.setTextColor(210, 210, 210);
    doc.text(`Emitida em ${reportDate}`, 196, 36, { align: 'right' });

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 58, 182, 25, 2, 2, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(14, 58, 182, 25, 2, 2, 'S');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text(`${lowStockItems.length} item(ns) precisam de reposicao`, 22, 72);
    doc.setTextColor(115, 115, 115);
    doc.setFontSize(9);
    doc.text('Produtos com 5 unidades ou menos no estoque.', 22, 78);

    doc.setFillColor(0, 0, 0);
    doc.roundedRect(14, 96, 182, 11, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('PRODUTO', 20, 103);
    doc.text('LOCALIZACAO', 80, 103);
    doc.text('QTD', 140, 103);
    doc.text('VALOR UN.', 188, 103, { align: 'right' });
    
    let y = 118;
    lowStockItems.forEach(item => {
        if (y > 265) {
            doc.addPage();
            doc.setFillColor(250, 250, 250);
            doc.rect(0, 0, 210, 297, 'F');
            y = 24;
        }

        const nameLines = doc.splitTextToSize(String(item.name || '').toUpperCase(), 105);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        doc.text(nameLines, 20, y);
        
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(String(item.location || 'N/I').toUpperCase(), 80, y);
        
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'bold');
        doc.text(String(item.stock), 144, y, { align: 'center' });
        doc.text(`R$ ${parseFloat(item.price).toFixed(2)}`, 188, y, { align: 'right' });
        y += Math.max(10, nameLines.length * 5 + 4);
        doc.setDrawColor(235, 235, 235);
        doc.line(20, y, 190, y);
        y += 6;
    });

    doc.setTextColor(115, 115, 115);
    doc.setFontSize(8);
    doc.text('Garage Motos - Acessorios, Pecas e Servicos', 14, 279);
    doc.text('@garagemotosbj', 14, 285);
    doc.setDrawColor(225, 29, 72);
    doc.line(14, 272, 196, 272);

    doc.save(`lista_compras_garage_motos.pdf`);
}

function renderAdminAppointments() {
    const container = document.getElementById('admin-appointments-list');
    if (!container) return;
    
    const requests = appointmentRequests.filter(e => e.type === 'request');

    container.innerHTML = requests.map(e => `
        <div class="bg-black p-4 rounded border border-neutral-800 flex justify-between items-center">
            <div>
                <p class="text-red-500 font-black text-xs uppercase italic">
                    ${e.start.split('-').reverse().join('/')}
                </p>
                <p class="font-bold text-sm uppercase">${e.clientName || 'Cliente'}</p>
                <p class="text-xs text-neutral-500 uppercase tracking-widest">${e.bikeInfo || 'Moto'}</p>
            </div>
            <button onclick="deleteAppointment('${e.id}')" class="text-neutral-600 hover:text-red-600 text-[10px] font-bold uppercase italic">Concluir/Remover</button>
        </div>
    `).join('') || '<p class="text-center text-neutral-500 text-xs py-4">Nenhuma solicitação pendente.</p>';
}
