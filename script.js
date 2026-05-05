import { auth, db } from './firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Gerenciamento de Estado Global (LocalStorage)
let products = JSON.parse(localStorage.getItem('gm_products')) || [];
let serviceOrders = JSON.parse(localStorage.getItem('gm_orders')) || [];
let appointmentRequests = []; // Sincronizado em tempo real com o Firebase
let pickerCalendar;
let tempSelectedDate = '';

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('calendar')) initCalendar();
    renderShop();
    renderHistory();
    updateRevenueFilterOptions();
    renderChart();
    
    // Listeners
    document.getElementById('product-form').addEventListener('submit', addProduct);
    document.getElementById('os-form').addEventListener('submit', generateOS);
    document.getElementById('appointment-form').addEventListener('submit', scheduleService);
    document.getElementById('block-date-form').addEventListener('submit', blockDate);
    document.getElementById('revenue-filter').addEventListener('change', renderChart);
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
window.deleteAppointment = deleteAppointment;
window.addPartRow = addPartRow;
window.editOS = editOS;
window.deleteOS = deleteOS;
window.downloadOSPDF = downloadOSPDF;

function toggleAdminNav() {
    const nav = document.getElementById('admin-nav-menu');
    nav.classList.toggle('hidden');
}

function showAdminView(viewName) {
    // Esconde todas as views
    document.querySelectorAll('.admin-view').forEach(v => v.classList.add('hidden'));
    // Remove classe ativa de todos os botões
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    
    // Mostra a view selecionada
    const targetView = document.getElementById(`view-${viewName}`);
    const targetBtn = document.getElementById(`btn-tab-${viewName}`);
    
    if (targetView) targetView.classList.remove('hidden');
    if (targetBtn) targetBtn.classList.add('active');
    
    // Fecha o menu de navegação após selecionar
    document.getElementById('admin-nav-menu').classList.add('hidden');
    
    // Atualiza componentes específicos se necessário
    if (viewName === 'financeiro') renderChart();
    if (viewName === 'agenda' && calendar) calendar.render();
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
        imgBase64 = await toBase64(imgFile);
    }

    if (id) {
        const index = products.findIndex(p => p.id === parseInt(id));
        if (index !== -1) {
            const oldImg = products[index].image;
            products[index] = { 
                id: parseInt(id), 
                name, 
                price, 
                stock, 
                image: imgBase64 || oldImg 
            };
        }
    } else {
        const product = { id: Date.now(), name, price, stock, image: imgBase64 };
        products.push(product);
    }
    
    saveAndRefresh();
    resetProductForm();
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

function deleteProduct(id) {
    if (!confirm('Deseja realmente excluir este produto do estoque?')) return;
    products = products.filter(p => p.id !== id);
    saveAndRefresh();
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

function downloadOSPDF(osOrId) {
    // Busca a O.S se for passado apenas o ID (clique no histórico) 
    // ou usa o objeto direto (geração de nova O.S)
    let os = (typeof osOrId === 'number') ? serviceOrders.find(o => o.id === osOrId) : osOrId;
    if (!os) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // PDF Styling
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(225, 29, 72);
    doc.setFontSize(22);
    doc.text("GARAGE MOTOS", 105, 25, { align: 'center' });
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text(`ORDEM DE SERVIÇO: #${os.id}`, 20, 50);
    doc.text(`DATA: ${os.date}`, 20, 60);
    doc.text(`CLIENTE: ${os.client.toUpperCase()}`, 20, 75);
    doc.text(`MOTO: ${os.bike.toUpperCase()}`, 20, 85);
    
    doc.line(20, 95, 190, 95);
    doc.text(`VALOR MÃO DE OBRA: R$ ${os.labor.toFixed(2)}`, 20, 110);
    
    let currentY = 120;
    os.parts.forEach(part => {
        doc.setFontSize(10);
        doc.text(`- ${part.name}: R$ ${part.price.toFixed(2)}`, 25, currentY);
        currentY += 7;
    });

    doc.setFontSize(16);
    doc.text(`TOTAL: R$ ${os.total.toFixed(2)}`, 20, currentY + 10);
    
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
        businessHours: {
            daysOfWeek: [1, 2, 3, 4, 5], // Segunda a Sexta
        },
        events: []
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
            height: 'auto',
            headerToolbar: { left: 'prev', center: 'title', right: 'next' },
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
        localStorage.setItem('gm_products', JSON.stringify(products));
        localStorage.setItem('gm_orders', JSON.stringify(serviceOrders));
    } catch (e) {
        console.error("Erro ao salvar no LocalStorage: Provavelmente o limite de 5MB foi atingido devido às fotos.");
        alert("Atenção: O limite de armazenamento de fotos foi atingido. Tente usar fotos menores ou remova itens antigos.");
    }
    
    renderShop();
    renderHistory();
    renderAdminStock();
    updateRevenueFilterOptions();
    renderChart();
}

function renderShop() {
    const containers = [
        { el: document.getElementById('shop-container'), limit: 4 },
        { el: document.getElementById('full-shop-container'), limit: 100 }
    ];

    containers.forEach(({ el, limit }) => {
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
                    <p class="text-red-600 font-black text-sm md:text-2xl mb-3 md:mb-4">R$ ${parseFloat(p.price).toFixed(2)}</p>
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

function renderHistory() {
    const body = document.getElementById('os-history-body');
    if (!body) return;
    body.innerHTML = serviceOrders.map((os, index) => `
        <tr class="text-sm">
            <td class="py-4 font-black text-red-600 italic leading-tight">
                #${index + 1} O.S
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

function renderAdminStock() {
    const container = document.getElementById('admin-stock-list');
    if (!container) return;
    
    container.innerHTML = products.map(p => `
        <div class="flex items-center justify-between p-3 border-b border-neutral-800 hover:bg-black/30 transition rounded">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-8 h-8 flex-shrink-0 bg-neutral-800 rounded bg-cover bg-center" style="background-image: url('${p.image || ''}')"></div>
                <div class="truncate">
                    <p class="font-bold text-[10px] md:text-xs uppercase truncate">${p.name}</p>
                    <p class="text-[9px] text-neutral-500 uppercase tracking-tighter">Qtd: ${p.stock} | R$ ${parseFloat(p.price).toFixed(2)}</p>
                </div>
            </div>
            <div class="flex gap-2 ml-2">
                <button onclick="editProduct(${p.id})" class="text-blue-500 hover:text-blue-400 text-[10px] font-black uppercase italic">Editar</button>
                <button onclick="deleteProduct(${p.id})" class="text-neutral-600 hover:text-red-600 text-[10px] font-black uppercase italic">Excluir</button>
            </div>
        </div>
    `).join('') || '<p class="text-center text-neutral-600 text-[10px] uppercase font-bold py-4">Estoque Vazio</p>';
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