// Gerenciamento de Estado Global (LocalStorage)
let products = JSON.parse(localStorage.getItem('gm_products')) || [];
let serviceOrders = JSON.parse(localStorage.getItem('gm_orders')) || [];
let appointments = JSON.parse(localStorage.getItem('gm_appointments')) || [];

document.addEventListener('DOMContentLoaded', () => {
    initCalendar();
    renderShop();
    renderHistory();
    updateRevenueFilterOptions();
    renderChart();
    
    // Listeners
    document.getElementById('product-form').addEventListener('submit', addProduct);
    document.getElementById('os-form').addEventListener('submit', generateOS);
    document.getElementById('appointment-form').addEventListener('submit', scheduleService);
    document.getElementById('revenue-filter').addEventListener('change', renderChart);
    
    addPartRow(); // Inicia com uma linha de peça vazia

    document.getElementById('os-cancel-edit').addEventListener('click', () => {
        resetOSForm();
    });
});

function toggleMenu() {
    const menu = document.getElementById('main-menu');
    menu.classList.toggle('hidden');
}

function toggleAdmin() {
    const panel = document.getElementById('admin-panel');
    panel.classList.toggle('hidden');
    renderAdminStock(); // Atualiza estoque na visão admin
}

function toggleShop() {
    const panel = document.getElementById('shop-overlay');
    panel.classList.toggle('hidden');
}

// --- SISTEMA DE PRODUTOS ---
async function addProduct(e) {
    e.preventDefault();
    const name = document.getElementById('prod-name').value;
    const price = document.getElementById('prod-price').value;
    const stock = document.getElementById('prod-stock').value;
    const imgFile = document.getElementById('prod-image').files[0];

    let imgBase64 = '';
    if (imgFile) {
        imgBase64 = await toBase64(imgFile);
    }

    const product = { id: Date.now(), name, price, stock, image: imgBase64 };
    products.push(product);
    saveAndRefresh();
    e.target.reset();
}

function deleteProduct(id) {
    products = products.filter(p => p.id !== id);
    saveAndRefresh();
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
        partsTotal
    };

    if (id) {
        const index = serviceOrders.findIndex(o => o.id === parseInt(id));
        serviceOrders[index] = osData;
    } else {
        serviceOrders.push(osData);
    }
    
    downloadOSPDF(osData);
    saveAndRefresh();
    resetOSForm();
}

function downloadOSPDF(os) {
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
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        events: appointments
    });
    calendar.render();
}

function scheduleService(e) {
    e.preventDefault();
    const name = document.getElementById('client-name').value;
    const bike = document.getElementById('bike-info').value;
    const date = document.getElementById('service-date').value;

    const event = { title: `REVISÃO: ${bike} (${name})`, start: date, color: '#e11d48' };
    appointments.push(event);
    localStorage.setItem('gm_appointments', JSON.stringify(appointments));
    calendar.addEvent(event);
    alert('Solicitação recebida! Verifique o calendário.');
    e.target.reset();
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
    localStorage.setItem('gm_products', JSON.stringify(products));
    localStorage.setItem('gm_orders', JSON.stringify(serviceOrders));
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
            <div class="bg-neutral-900 border border-neutral-800 rounded-lg md:rounded-xl overflow-hidden product-card">
                <div class="h-32 md:h-48 bg-neutral-800 bg-cover bg-center" style="background-image: url('${p.image || ''}')">
                    ${!p.image ? '<div class="flex items-center justify-center h-full text-neutral-600 font-bold uppercase tracking-widest text-[8px] md:text-xs text-center">Sem Foto</div>' : ''}
                </div>
                <div class="p-3 md:p-5">
                    <h5 class="font-bold text-xs md:text-lg mb-1 truncate uppercase">${p.name}</h5>
                    <p class="text-red-600 font-black text-sm md:text-2xl mb-3 md:mb-4">R$ ${parseFloat(p.price).toFixed(2)}</p>
                    <button class="w-full bg-white text-black py-1.5 md:py-2 rounded font-bold uppercase text-[8px] md:text-xs tracking-tighter hover:bg-red-600 hover:text-white transition">Comprar</button>
                </div>
            </div>
        `).join('');
    });
}

function renderHistory() {
    const body = document.getElementById('os-history-body');
    body.innerHTML = serviceOrders.map((os, index) => `
        <tr class="text-sm">
            <td class="py-4 font-black text-red-600 italic">#${index + 1} O.S</td>
            <td class="py-4 text-neutral-400">${os.date}</td>
            <td class="py-4 font-bold uppercase">${os.client}</td>
            <td class="py-4 italic uppercase">${os.bike}</td>
            <td class="py-4 text-red-500 font-black">R$ ${os.total.toFixed(2)}</td>
            <td class="py-4 flex gap-3">
                <button onclick='editOS(${JSON.stringify(os)})' class="text-blue-500 hover:text-blue-400 transition">Editar</button>
                <button onclick="downloadOSPDF(${JSON.stringify(os)})" class="text-green-500 hover:text-green-400 transition">Baixar</button>
                <button onclick="deleteOS(${os.id})" class="text-neutral-600 hover:text-red-600 transition">Remover</button>
            </td>
        </tr>
    `).join('');
}

function editOS(os) {
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    // Opcional: Renderizar uma lista simples de edição de estoque aqui
}