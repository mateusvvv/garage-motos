import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Gerenciamento de Estado Global (LocalStorage)
let products = []; // Agora sincronizado via Firebase
let serviceOrders = JSON.parse(localStorage.getItem('gm_orders')) || [];
let appointmentRequests = []; // Sincronizado em tempo real com o Firebase
let pickerCalendar;
let tempSelectedDate = '';

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar')) initCalendar();
    initProductsSync(); // Nova função para sincronizar produtos
    renderHistory();
    updateRevenueFilterOptions();
    renderChart();
    
    // Listeners
    document.getElementById('product-form').addEventListener('submit', addProduct);
    document.getElementById('os-form').addEventListener('submit', generateOS);
    document.getElementById('appointment-form').addEventListener('submit', scheduleService);
    document.getElementById('block-date-form').addEventListener('submit', blockDate);
    document.getElementById('revenue-filter').addEventListener('change', renderChart);
    document.getElementById('stock-search').addEventListener('input', (e) => {
        renderAdminStock(e.target.value);
    });
    document.getElementById('login-form').addEventListener('submit', loginAdmin);
    
    addPartRow(); // Inicia com uma linha de peça vazia

    document.getElementById('os-cancel-edit').addEventListener('click', () => {
        resetOSForm();
    });

    document.getElementById('prod-cancel-edit').addEventListener('click', () => {
        resetProductForm();
    });

    // Observador de estado de autenticação
    onAuthStateChanged(auth, (user) => {
        const dashboard = document.getElementById('admin-dashboard-ui');
        const loginUI = document.getElementById('admin-login-ui');
        
        if (user) {
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
        alert('Acesso negado: Credenciais inválidas.');
    }
}

async function logoutAdmin() {
    await signOut(auth);
}

function toggleMenu() {
    const menu = document.getElementById('main-menu');
    menu.classList.toggle('hidden');
}

function toggleAdmin() {
    const panel = document.getElementById('admin-panel');
    panel.classList.toggle('hidden');
    renderAdminStock(); // Atualiza estoque na visão admin
}

// Torna as funções globais para serem acessadas pelo HTML onclick
window.toggleMenu = toggleMenu;
window.toggleAdmin = toggleAdmin;
window.toggleShop = toggleShop;
window.openAppointmentPicker = openAppointmentPicker;
window.closeAppointmentPicker = closeAppointmentPicker;
window.backToCalendar = backToCalendar;
window.toggleAdminNav = toggleAdminNav;
window.showAdminView = showAdminView;
window.logoutAdmin = logoutAdmin;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.deleteAllProducts = deleteAllProducts;
window.deleteAppointment = deleteAppointment;
window.clearBlockedDates = clearBlockedDates;
window.printLowStockReport = printLowStockReport;
window.addPartRow = addPartRow;
window.editOS = editOS;
window.deleteOS = deleteOS;
window.downloadOSPDF = downloadOSPDF;

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
}

// --- SISTEMA DE PRODUTOS ---
async function addProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const name = document.getElementById('prod-name').value;
    const price = document.getElementById('prod-price').value;
    const stock = document.getElementById('prod-stock').value;
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
        image: imgBase64 || ''
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
    
    document.querySelector('#product-form button[type="submit"]').textContent = 'Atualizar Item';
    document.getElementById('prod-cancel-edit').classList.remove('hidden');
}

async function deleteProduct(id) {
    if (confirm('Deseja realmente excluir este produto do estoque?')) {
        await deleteDoc(doc(db, "products", id));
    }
}

async function deleteAllProducts() {
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
        <input type="text" placeholder="Nome da Peça" class="flex-1 min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-name" value="${name}">
        <input type="number" step="0.01" placeholder="R$" class="w-20 md:w-24 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-price" value="${price}">
        <button type="button" onclick="this.parentElement.remove()" class="text-neutral-600 hover:text-red-500 p-1">✕</button>
    `;
    container.appendChild(div);
}

function generateOS(e) {
    e.preventDefault();
    const id = document.getElementById('os-id').value;
    const existingOS = id ? serviceOrders.find(o => o.id === parseInt(id)) : null;
    const client = document.getElementById('os-client').value;
    const bike = document.getElementById('os-bike').value;
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

    const total = labor + partsTotal;
    const date = new Date().toLocaleDateString('pt-BR');

    const osData = { 
        id: id ? parseInt(id) : Date.now(), 
        osNumber: existingOS?.osNumber || getNextOSNumber(),
        date, 
        client, 
        bike, 
        total, 
        labor,
        parts,
        partsTotal,
        editCount: 0
    };

    if (id) {
        const index = serviceOrders.findIndex(o => o.id === parseInt(id));
        const previousEditCount = serviceOrders[index].editCount || 0;
        osData.editCount = previousEditCount + 1;
        serviceOrders[index] = osData;
    } else {
        serviceOrders.push(osData);
    }
    downloadOSPDF(osData);
    saveAndRefresh();
    resetOSForm();
}

function getNextOSNumber() {
    return serviceOrders.reduce((max, os, index) => {
        return Math.max(max, Number(os.osNumber) || index + 1);
    }, 0) + 1;
}

function formatOSNumber(os, fallbackIndex = 0) {
    const orderIndex = serviceOrders.findIndex(order => order.id === os.id);
    const number = Number(os.osNumber) || (orderIndex >= 0 ? orderIndex + 1 : fallbackIndex + 1);
    return String(number).padStart(3, '0');
}

async function downloadOSPDF(osOrId) {
    // Busca a O.S se for passado apenas o ID (clique no histórico) 
    // ou usa o objeto direto (geração de nova O.S)
    let os = (typeof osOrId === 'number') ? serviceOrders.find(o => o.id === osOrId) : osOrId;
    if (!os) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoData = await loadImageForPDF('logo-branca.png');
    const parts = os.parts || [];
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
    doc.roundedRect(14, 58, 182, 34, 2, 2, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(14, 58, 182, 34, 2, 2, 'S');

    doc.setTextColor(115, 115, 115);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('CLIENTE', 22, 70);
    doc.text('MOTO / PLACA', 112, 70);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(13);
    doc.text(String(os.client || '').toUpperCase(), 22, 80, { maxWidth: 78 });
    doc.text(String(os.bike || '').toUpperCase(), 112, 80, { maxWidth: 72 });

    doc.setFillColor(0, 0, 0);
    doc.roundedRect(14, 104, 182, 11, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text('DESCRICAO', 20, 111);
    doc.text('VALOR', 186, 111, { align: 'right' });

    let y = 126;
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

    const totalsY = Math.max(y + 8, 218);
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(118, totalsY, 78, 34, 2, 2, 'F');
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('PECAS', 126, totalsY + 10);
    doc.text(money(os.partsTotal), 188, totalsY + 10, { align: 'right' });
    doc.text('MAO DE OBRA', 126, totalsY + 19);
    doc.text(money(os.labor), 188, totalsY + 19, { align: 'right' });
    doc.setFillColor(225, 29, 72);
    doc.roundedRect(118, totalsY + 24, 78, 14, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text('TOTAL', 126, totalsY + 33);
    doc.text(money(os.total), 188, totalsY + 33, { align: 'right' });

    doc.setTextColor(115, 115, 115);
    doc.setFontSize(8);
    doc.text('Garage Motos - Acessorios, Pecas e Servicos', 14, 279);
    doc.text('@garagemotosbj', 14, 285);
    doc.setDrawColor(225, 29, 72);
    doc.line(14, 272, 196, 272);
    
    doc.save(`OS_${os.client}_${os.id}.pdf`);
}

// --- SISTEMA DE AGENDAMENTO ---
let calendar;
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        headerToolbar: { left: 'title', center: '', right: 'today prev,next' },
        buttonText: { today: 'Hoje' },
        validRange: {
            start: new Date().toLocaleDateString('sv-SE') // Impede visualização de datas passadas
        },
        businessHours: {
            daysOfWeek: [1, 2, 3, 4, 5], // Segunda a Sexta
        },
        events: [],
        dateClick: function(info) {
            const day = new Date(info.date).getUTCDay();
            if (day === 0 || day === 6) return;
            
            const isBlocked = appointmentRequests.some(e => e.type === 'block' && e.start === info.dateStr);
            if (isBlocked) {
                alert("Desculpe, esta data está indisponível.");
                return;
            }

            // Abre o modal e já pula para a escolha de horário para a data clicada
            openAppointmentPicker();
            tempSelectedDate = info.dateStr;
            const parts = info.dateStr.split('-');
            document.getElementById('picked-day-display').textContent = `Agendando para ${parts[2]}/${parts[1]}`;
            document.getElementById('picker-step-1').classList.add('hidden');
            document.getElementById('picker-step-2').classList.remove('hidden');
            renderClockGrid();
        }
    });
    calendar.render();

    // Sincronização em tempo real com o Firebase
    onSnapshot(collection(db, "appointments"), (snapshot) => {
        appointmentRequests = [];
        const calendarEvents = [];
        snapshot.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() };
            appointmentRequests.push(data);
            calendarEvents.push(data);
        });
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
    document.getElementById('picker-step-1').classList.remove('hidden');
    document.getElementById('picker-step-2').classList.add('hidden');
    
    if (!pickerCalendar) {
        const calendarEl = document.getElementById('picker-calendar');
        pickerCalendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'pt-br',
            headerToolbar: { left: 'title', center: '', right: 'today prev,next' },
            buttonText: { today: 'Hoje' },
            validRange: {
                start: new Date().toLocaleDateString('sv-SE') // Define hoje como data mínima (Formato YYYY-MM-DD)
            },
            businessHours: { daysOfWeek: [1, 2, 3, 4, 5] },
            events: appointmentRequests,
            dateClick: function(info) {
                const day = new Date(info.date).getUTCDay();
                if (day === 0 || day === 6) return;
                
                // Verifica se o dia está bloqueado pelo Admin
                const isBlocked = appointmentRequests.some(e => e.type === 'block' && e.start === info.dateStr);
                if (isBlocked) {
                    alert("Desculpe, esta data está indisponível.");
                    return;
                }

                tempSelectedDate = info.dateStr;
                const parts = info.dateStr.split('-');
                document.getElementById('picked-day-display').textContent = `Agendando para ${parts[2]}/${parts[1]}`;
                document.getElementById('picker-step-1').classList.add('hidden');
                document.getElementById('picker-step-2').classList.remove('hidden');
                renderClockGrid();
            }
        });
    } else {
        pickerCalendar.removeAllEvents();
        appointmentRequests.forEach(ev => pickerCalendar.addEvent(ev));
    }
    setTimeout(() => pickerCalendar.render(), 100);
}

function renderClockGrid() {
    const grid = document.getElementById('clock-grid');
    grid.innerHTML = '';
    // Das 07:00 às 17:00 (último horário disponível para início de serviço)
    for (let h = 7; h <= 17; h++) {
        ['00', '30'].forEach(m => {
            if (h === 17 && m === '30') return;
            const time = `${h.toString().padStart(2, '0')}:${m}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'hour-btn animate-fade-in';
            btn.textContent = time;
            btn.onclick = () => {
                document.getElementById('service-date-only').value = tempSelectedDate;
                document.getElementById('service-time-only').value = time;
                const parts = tempSelectedDate.split('-');
                document.getElementById('picker-label').textContent = 'Selecionado:';
                document.getElementById('picker-selected').textContent = `${parts[2]}/${parts[1]} às ${time}`;
                closeAppointmentPicker();
                document.getElementById('agendamento').scrollIntoView({ behavior: 'smooth' });
            };
            grid.appendChild(btn);
        });
    }
}

function backToCalendar() {
    document.getElementById('picker-step-2').classList.add('hidden');
    document.getElementById('picker-step-1').classList.remove('hidden');
    pickerCalendar.render();
}

function closeAppointmentPicker() {
    document.getElementById('appointment-picker-overlay').classList.add('hidden');
}

async function scheduleService(e) {
    e.preventDefault();
    const name = document.getElementById('client-name').value;
    const bike = document.getElementById('bike-info').value;
    const datePart = document.getElementById('service-date-only').value;
    const timePart = document.getElementById('service-time-only').value;

    if (!datePart || !timePart) return;
    
    const fullDateTime = `${datePart}T${timePart}`;
    const isDuplicate = appointmentRequests.some(app => app.start === fullDateTime);

    if (isDuplicate) {
        alert("Atenção: Este horário já está reservado para outro cliente. Por favor, selecione outro dia ou hora.");
        return;
    }

    try {
        await addDoc(collection(db, "appointments"), {
            title: `🛠️ ${bike} - ${name}`,
            start: `${datePart}T${timePart}`,
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
            display: 'background',
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
    const ctx = document.getElementById('revenueChart').getContext('2d');
    const filter = document.getElementById('revenue-filter').value;
    
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
}

// --- HELPERS ---
function saveAndRefresh() {
    try {
        localStorage.setItem('gm_orders', JSON.stringify(serviceOrders));
    } catch (e) {
        console.error("Erro ao salvar no LocalStorage: Provavelmente o limite de 5MB foi atingido devido às fotos.");
        alert("Atenção: O limite de armazenamento de fotos foi atingido. Tente usar fotos menores ou remova itens antigos.");
    }
    
    renderHistory();
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
                    <a href="https://api.whatsapp.com/send?phone=558193735372&text=Olá! Gostaria de comprar o produto: ${encodeURIComponent(p.name)}" 
                       target="_blank" 
                       class="mt-auto w-full bg-white text-black py-2 rounded font-bold uppercase text-[10px] md:text-xs text-center hover:bg-red-600 hover:text-white transition">
                       Comprar
                    </a>
                </div>
            </div>
        `).join('');
    });
}

function formatStockLabel(stock) {
    const quantity = Number.parseInt(stock, 10) || 0;
    return `${quantity} ${quantity === 1 ? 'unidade disponível' : 'unidades disponíveis'}`;
}

function renderHistory() {
    const body = document.getElementById('os-history-body');
    if (!body) return;
    body.innerHTML = serviceOrders.map((os, index) => `
        <tr class="text-sm">
            <td class="py-4 font-black text-red-600 italic leading-tight">
                O.S #${formatOSNumber(os, index)}
                ${os.editCount > 0 ? `<br><span class="text-[9px] text-neutral-500 not-italic font-bold uppercase tracking-tighter">Editada ${os.editCount}x</span>` : ''}
            </td>
            <td class="py-4 text-neutral-400">${os.date}</td>
            <td class="py-4 font-bold uppercase">${os.client}</td>
            <td class="py-4 italic uppercase">${os.bike}</td>
            <td class="py-4 text-red-500 font-black">R$ ${os.total.toFixed(2)}</td>
            <td class="py-4 flex gap-3">
                <button onclick="editOS(${os.id})" class="text-blue-500 hover:text-blue-400 transition">Editar</button>
                <button onclick="downloadOSPDF(${os.id})" class="text-green-500 hover:text-green-400 transition">Baixar</button>
                <button onclick="deleteOS(${os.id})" class="text-neutral-600 hover:text-red-600 transition">Remover</button>
            </td>
        </tr>
    `).join('');
}

function editOS(id) {
    const os = serviceOrders.find(o => o.id === id);
    if (!os) return;

    document.getElementById('os-id').value = os.id;
    document.getElementById('os-client').value = os.client;
    document.getElementById('os-bike').value = os.bike;
    document.getElementById('os-labor').value = os.labor;
    
    const container = document.getElementById('os-parts-container');
    container.innerHTML = '';
    os.parts.forEach(p => addPartRow(p.name, p.price));
    if (os.parts.length === 0) addPartRow();
    
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
    addPartRow();
    document.getElementById('os-submit-btn').textContent = 'Gerar PDF & Salvar';
    document.getElementById('os-cancel-edit').classList.add('hidden');
}

function deleteOS(id) {
    if (!confirm('Tem certeza que deseja excluir esta O.S?')) return;
    serviceOrders = serviceOrders.filter(o => o.id !== id);
    saveAndRefresh();
}

function updateRevenueFilterOptions() {
    const select = document.getElementById('revenue-filter');
    if (!select) return;
    const months = new Set();
    serviceOrders.forEach(os => {
        const parts = os.date.split('/');
        if (parts.length === 3) months.add(`${parts[1]}/${parts[2]}`);
    });
    
    const currentValue = select.value;
    select.innerHTML = '<option value="all">Faturamento Total</option>';
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

    container.innerHTML = filtered.map(p => `
        <div class="flex items-center justify-between p-4 border-b border-neutral-800 hover:bg-black/30 transition rounded">
            <div class="flex items-center gap-4 overflow-hidden">
                <div class="w-12 h-12 flex-shrink-0 bg-neutral-800 rounded flex items-center justify-center overflow-hidden">
                    ${p.image ? `<img src="${p.image}" class="max-h-full max-w-full object-contain">` : ''}
                </div>
                <div class="truncate">
                    <p class="font-bold text-xs md:text-sm uppercase truncate">${p.name}</p>
                    <p class="text-[11px] md:text-xs text-neutral-500 uppercase tracking-tighter">Qtd: ${p.stock} | R$ ${parseFloat(p.price).toFixed(2)}</p>
                </div>
            </div>
            <div class="flex gap-3 ml-2">
                <button onclick="editProduct('${p.id}')" class="text-blue-500 hover:text-blue-400 text-xs font-black uppercase italic">Editar</button>
                <button onclick="deleteProduct('${p.id}')" class="text-neutral-600 hover:text-red-600 text-xs font-black uppercase italic">Excluir</button>
            </div>
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
    const logoData = await loadImageForPDF('logo-branca.png');
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
                <p class="text-red-500 font-black text-xs uppercase italic">${new Date(e.start).toLocaleString('pt-BR')}</p>
                <p class="font-bold text-sm uppercase">${e.clientName || 'Cliente'}</p>
                <p class="text-xs text-neutral-500 uppercase tracking-widest">${e.bikeInfo || 'Moto'}</p>
            </div>
            <button onclick="deleteAppointment('${e.id}')" class="text-neutral-600 hover:text-red-600 text-[10px] font-bold uppercase italic">Concluir/Remover</button>
        </div>
    `).join('') || '<p class="text-center text-neutral-500 text-xs py-4">Nenhuma solicitação pendente.</p>';
}
