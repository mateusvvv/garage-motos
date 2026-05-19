import { db } from '../../firebase-config.js';
import { collection, deleteDoc, doc, getDocs, getDocsFromServer, onSnapshot, setDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from '../core/state.js';
import { loadImageForPDF } from '../core/utils.js';
import { decrementProductsStock, renderAdminStock } from './products.js';
import { refreshFinanceDashboard } from './finance.js';
import { showAdminView } from './ui.js';

let isFinalizingOS = false;
let ordersSyncStarted = false;
let ordersFallbackTimer = null;
let ordersRefreshInProgress = false;
const SERVICE_ORDERS_COLLECTION = 'serviceOrders';
const OPEN_ORDERS_COLLECTION = 'openOrders';
const ORDERS_MIGRATION_KEY = 'gm_orders_firebase_migrated_v1';
const OPEN_ORDERS_MIGRATION_KEY = 'gm_open_orders_firebase_migrated_v1';
const ORDERS_FALLBACK_REFRESH_INTERVAL = 15000;

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeSyncedOrder(order = {}, fallbackId = '') {
    const parts = Array.isArray(order.parts) ? order.parts : [];
    const services = Array.isArray(order.services) ? order.services : [];
    const normalizedParts = parts.map(part => {
        const quantity = Math.max(Number.parseInt(part?.quantity, 10) || 1, 1);
        const unitPrice = Number(part?.unitPrice ?? (quantity > 1 ? Number(part?.price || 0) / quantity : part?.price || 0));
        return {
            name: String(part?.name || ''),
            quantity,
            unitPrice,
            price: Number(part?.price ?? unitPrice * quantity),
            productId: String(part?.productId || '')
        };
    });
    let normalizedServices = services.map(service => ({
        name: String(service?.name || ''),
        price: Number(service?.price || 0),
        mechanic: service?.mechanic || order.mechanic || 'leo',
        paymentMethod: service?.paymentMethod || order.paymentMethod || 'pix'
    }));
    const legacyLabor = Number(order.labor || 0);
    if (normalizedServices.length === 0 && legacyLabor > 0) {
        normalizedServices = [{
            name: 'Mão de Obra',
            price: legacyLabor,
            mechanic: order.mechanic || 'leo',
            paymentMethod: order.paymentMethod || 'pix'
        }];
    }
    const partsTotal = Number(order.partsTotal ?? normalizedParts.reduce((sum, part) => sum + part.price, 0));
    const servicesTotal = Number(order.servicesTotal ?? normalizedServices.reduce((sum, service) => sum + service.price, 0));
    const labor = normalizedServices.length > 0 ? 0 : legacyLabor;

    return {
        ...order,
        id: Number(order.id) || Number(fallbackId) || Date.now(),
        osNumber: Number(order.osNumber) || 0,
        date: String(order.date || new Date().toLocaleDateString('pt-BR')),
        client: String(order.client || ''),
        bike: String(order.bike || ''),
        observations: String(order.observations || ''),
        mechanic: normalizedServices[0]?.mechanic || order.mechanic || 'leo',
        paymentMethod: normalizedServices[0]?.paymentMethod || order.paymentMethod || 'pix',
        labor,
        services: normalizedServices,
        servicesTotal,
        parts: normalizedParts,
        partsTotal,
        total: Number(order.total ?? labor + servicesTotal + partsTotal),
        discounts: Array.isArray(order.discounts) ? order.discounts : [],
        discountTotal: Number(order.discountTotal || 0),
        editCount: Number(order.editCount || 0)
    };
}

function refreshOrdersUI() {
    renderHistory();
    renderOpenOrders();
    renderClosedOrders();
    renderAdminStock();
    refreshFinanceDashboard();
}

function persistOrdersCache() {
    try {
        localStorage.setItem('gm_orders_cache', JSON.stringify(state.serviceOrders));
        localStorage.setItem('gm_orders', JSON.stringify(state.serviceOrders));
        localStorage.setItem('gm_open_orders', JSON.stringify(state.openOrders));
    } catch (_) {}
}

async function migrateLocalOrdersIfNeeded(snapshot) {
    if (!snapshot.empty || localStorage.getItem(ORDERS_MIGRATION_KEY) === 'true') return false;

    const localOrders = state.serviceOrders.filter(order => order?.id);
    localStorage.setItem(ORDERS_MIGRATION_KEY, 'true');
    if (localOrders.length === 0) return false;

    const batch = writeBatch(db);
    localOrders.forEach(order => {
        const normalized = normalizeSyncedOrder(order, order.id);
        batch.set(doc(db, SERVICE_ORDERS_COLLECTION, String(normalized.id)), normalized);
    });
    await batch.commit();
    return true;
}

async function migrateLocalOpenOrdersIfNeeded(snapshot) {
    if (!snapshot.empty || localStorage.getItem(OPEN_ORDERS_MIGRATION_KEY) === 'true') return false;

    const localOpenOrders = state.openOrders.filter(order => order?.id);
    localStorage.setItem(OPEN_ORDERS_MIGRATION_KEY, 'true');
    if (localOpenOrders.length === 0) return false;

    const batch = writeBatch(db);
    localOpenOrders.forEach(order => {
        const normalized = normalizeSyncedOrder(order, order.id);
        batch.set(doc(db, OPEN_ORDERS_COLLECTION, String(normalized.id)), normalized);
    });
    await batch.commit();
    return true;
}

function initOrdersSync() {
    if (ordersSyncStarted) {
        refreshOrdersUI();
        refreshOrdersFromServer();
        return;
    }
    ordersSyncStarted = true;

    onSnapshot(collection(db, SERVICE_ORDERS_COLLECTION), async (snapshot) => {
        const migrated = await migrateLocalOrdersIfNeeded(snapshot);
        if (migrated) {
            refreshOrdersUI();
            return;
        }

        state.serviceOrders = snapshot.docs.map(item => normalizeSyncedOrder(item.data(), item.id));
        persistOrdersCache();
        refreshOrdersUI();
    }, (error) => {
        console.error('Erro ao sincronizar O.S com o Firestore:', error);
        refreshOrdersUI();
    });

    onSnapshot(collection(db, OPEN_ORDERS_COLLECTION), async (snapshot) => {
        const migrated = await migrateLocalOpenOrdersIfNeeded(snapshot);
        if (migrated) {
            refreshOrdersUI();
            return;
        }

        state.openOrders = snapshot.docs.map(item => normalizeSyncedOrder(item.data(), item.id));
        persistOrdersCache();
        refreshOrdersUI();
    }, (error) => {
        console.error('Erro ao sincronizar O.S em aberto com o Firestore:', error);
        refreshOrdersUI();
    });

    startOrdersFallbackRefresh();
    setTimeout(() => refreshOrdersFromServer(), 5000);
}

async function refreshOrdersFromServer() {
    if (ordersRefreshInProgress) return;
    ordersRefreshInProgress = true;

    try {
        const [serviceSnapshot, openSnapshot] = await Promise.all([
            getDocsFromServer(collection(db, SERVICE_ORDERS_COLLECTION)),
            getDocsFromServer(collection(db, OPEN_ORDERS_COLLECTION))
        ]);

        const migratedServiceOrders = await migrateLocalOrdersIfNeeded(serviceSnapshot);
        const migratedOpenOrders = await migrateLocalOpenOrdersIfNeeded(openSnapshot);

        if (!migratedServiceOrders) {
            state.serviceOrders = serviceSnapshot.docs.map(item => normalizeSyncedOrder(item.data(), item.id));
        }

        if (!migratedOpenOrders) {
            state.openOrders = openSnapshot.docs.map(item => normalizeSyncedOrder(item.data(), item.id));
        }

        persistOrdersCache();
        refreshOrdersUI();
    } catch (error) {
        console.warn('Atualização de segurança das O.S falhou:', error);
    } finally {
        ordersRefreshInProgress = false;
    }
}

function startOrdersFallbackRefresh() {
    if (ordersFallbackTimer) return;

    ordersFallbackTimer = setInterval(() => {
        if (!document.hidden) refreshOrdersFromServer();
    }, ORDERS_FALLBACK_REFRESH_INTERVAL);

    window.addEventListener('focus', () => refreshOrdersFromServer());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(() => refreshOrdersFromServer(), 250);
    });
}

async function saveServiceOrder(osData) {
    await setDoc(doc(db, SERVICE_ORDERS_COLLECTION, String(osData.id)), osData);
}

async function saveOpenOrder(orderData) {
    await setDoc(doc(db, OPEN_ORDERS_COLLECTION, String(orderData.id)), orderData);
}

async function deleteOpenOrderFromCloud(id) {
    await deleteDoc(doc(db, OPEN_ORDERS_COLLECTION, String(id)));
}

function addPartRow(name = '', price = '', productId = '', quantity = 1) {
    const container = document.getElementById('os-parts-container');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'relative grid grid-cols-[minmax(0,1fr)_70px_90px_auto] md:grid-cols-[minmax(0,1fr)_80px_110px_auto] gap-2 items-center os-part-row';
    if (productId) div.dataset.productId = productId;
    div.innerHTML = `
        <input type="text" placeholder="Nome da Peça" class="flex-1 min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-name" value="${escapeHtml(name)}" autocomplete="off">
        <input type="number" min="1" step="1" placeholder="Qtd" class="w-full min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-quantity" value="${escapeHtml(quantity || 1)}">
        <input type="number" step="0.01" placeholder="R$" class="w-full min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs md:text-sm part-price" value="${escapeHtml(price)}">
        <button type="button" onclick="this.parentElement.remove(); updateDiscountTargets();" class="text-neutral-600 hover:text-red-500 p-1">✕</button>
        <div class="part-suggestions hidden absolute left-0 right-10 top-full mt-1 z-20 bg-black border border-neutral-800 rounded-lg shadow-2xl max-h-56 overflow-y-auto"></div>
    `;
    container.appendChild(div);
    bindPartAutocomplete(div);
    updateDiscountTargets();
}

function addServiceRow(name = '', price = '', mechanic = 'leo', paymentMethod = 'pix') {
    const container = document.getElementById('os-services-container');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'grid grid-cols-1 md:grid-cols-[minmax(150px,1fr)_minmax(95px,110px)_minmax(115px,120px)_minmax(115px,120px)_auto] gap-2 items-center os-service-row';
    div.innerHTML = `
        <input type="text" placeholder="Tipo de Serviço" class="flex-1 min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs service-name" value="${escapeHtml(name)}" autocomplete="off">
        <input type="number" step="0.01" placeholder="R$" class="w-full min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs service-price" value="${escapeHtml(price)}">
        <select class="w-full min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs outline-none focus:border-red-600 transition service-mechanic">
            <option value="leo" ${mechanic === 'leo' ? 'selected' : ''}>Léo</option>
            <option value="wandson" ${mechanic === 'wandson' ? 'selected' : ''}>Wandson</option>
        </select>
        <select class="w-full min-w-0 bg-black p-2 rounded border border-neutral-800 text-xs outline-none focus:border-red-600 transition service-payment">
            <option value="pix" ${paymentMethod === 'pix' ? 'selected' : ''}>Pix</option>
            <option value="avista" ${paymentMethod === 'avista' ? 'selected' : ''}>Espécie</option>
            <option value="cartao" ${paymentMethod === 'cartao' ? 'selected' : ''}>Cartão</option>
        </select>
        <button type="button" onclick="this.parentElement.remove(); updateDiscountTargets();" class="text-neutral-600 hover:text-red-500 p-1">✕</button>
    `;
    container.appendChild(div);
    updateDiscountTargets();
}

window.updateDiscountTargets = updateDiscountTargets;

function bindPartAutocomplete(row) {
    const nameInput = row.querySelector('.part-name');
    const priceInput = row.querySelector('.part-price');
    const suggestions = row.querySelector('.part-suggestions');
    if (!nameInput || !priceInput || !suggestions) return;

    const hideSuggestions = () => suggestions.classList.add('hidden');
    const selectProduct = (product) => {
        row.dataset.productId = product.id;
        nameInput.value = product.name;
        priceInput.value = Number(product.price || 0).toFixed(2);
        hideSuggestions();
        updateDiscountTargets();
    };

    const renderSuggestions = () => {
        const term = nameInput.value.trim().toLowerCase();
        row.dataset.productId = '';
        updateDiscountTargets();

        if (!term) {
            hideSuggestions();
            return;
        }

        const matches = state.products
            .filter(product => String(product.name || '').toLowerCase().startsWith(term))
            .slice(0, 8);

        if (matches.length === 0) {
            hideSuggestions();
            return;
        }

        suggestions.innerHTML = matches.map(product => `
            <button type="button" data-product-id="${product.id}" class="w-full text-left px-3 py-2 hover:bg-neutral-900 border-b border-neutral-900 last:border-b-0">
                <span class="block text-xs font-black uppercase text-white">${escapeHtml(product.name)}</span>
                <span class="block text-[10px] uppercase tracking-widest text-neutral-500">Qtd: ${Number.parseInt(product.stock, 10) || 0} | R$ ${Number(product.price || 0).toFixed(2)}</span>
            </button>
        `).join('');
        suggestions.classList.remove('hidden');
    };

    nameInput.addEventListener('input', renderSuggestions);
    nameInput.addEventListener('focus', renderSuggestions);
    nameInput.addEventListener('blur', () => {
        setTimeout(() => {
            const exactMatch = state.products.find(product => String(product.name || '').toLowerCase() === nameInput.value.trim().toLowerCase());
            row.dataset.productId = exactMatch?.id || '';
            hideSuggestions();
            updateDiscountTargets();
        }, 150);
    });
    suggestions.addEventListener('mousedown', (event) => {
        const button = event.target.closest('[data-product-id]');
        if (!button) return;
        const product = state.products.find(item => item.id === button.dataset.productId);
        if (product) selectProduct(product);
    });
}

function updateDiscountTargets() {
    const targetSelect = document.getElementById('os-discount-target');
    if (!targetSelect) return;

    const selectedValue = targetSelect.value;
    const partRows = Array.from(document.querySelectorAll('.os-part-row'));
    const serviceRows = Array.from(document.querySelectorAll('.os-service-row'));
    targetSelect.innerHTML = '';

    serviceRows.forEach((row, index) => {
        const name = row.querySelector('.service-name').value.trim() || `Serviço ${index + 1}`;
        const option = document.createElement('option');
        option.value = `service-${index}`;
        option.textContent = name;
        targetSelect.appendChild(option);
    });

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

    let targetInput = null;
    let targetQuantity = 1;
    if (target.startsWith('service-')) {
        targetInput = document.querySelectorAll('.os-service-row')[parseInt(target.replace('service-', ''), 10)]?.querySelector('.service-price');
    } else if (target.startsWith('part-')) {
        const partRow = document.querySelectorAll('.os-part-row')[parseInt(target.replace('part-', ''), 10)];
        targetInput = partRow?.querySelector('.part-price');
        targetQuantity = Math.max(Number.parseInt(partRow?.querySelector('.part-quantity')?.value, 10) || 1, 1);
    }

    if (!targetInput) {
        alert('Selecione um item válido para aplicar o desconto.');
        return;
    }

    const currentValue = parseFloat(targetInput.value) || 0;
    const discountAmount = type === 'percent'
        ? currentValue * Math.min(discountValue, 100) / 100
        : discountValue;
    const newValue = Math.max(currentValue - discountAmount, 0);
    const appliedAmount = (currentValue - newValue) * targetQuantity;

    targetInput.value = newValue.toFixed(2);
    state.currentOSDiscounts.push({
        target: document.getElementById('os-discount-target').selectedOptions[0]?.textContent || 'Item',
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
    const labor = 0;
    
    const serviceRows = document.querySelectorAll('.os-service-row');
    const services = [];
    let servicesTotal = 0;

    serviceRows.forEach(row => {
        const name = row.querySelector('.service-name').value;
        const price = parseFloat(row.querySelector('.service-price').value) || 0;
        const mechanic = row.querySelector('.service-mechanic')?.value || 'leo';
        const paymentMethod = row.querySelector('.service-payment')?.value || 'pix';
        if (name || price > 0) {
            services.push({ name, price, mechanic, paymentMethod });
            servicesTotal += price;
        }
    });

    const partRows = document.querySelectorAll('.os-part-row');
    const parts = [];
    let partsTotal = 0;
    
    partRows.forEach(row => {
        const name = row.querySelector('.part-name').value;
        const quantity = Math.max(parseInt(row.querySelector('.part-quantity')?.value, 10) || 1, 1);
        const unitPrice = parseFloat(row.querySelector('.part-price').value) || 0;
        const price = unitPrice * quantity;
        const exactProduct = state.products.find(product => String(product.name || '').toLowerCase() === name.trim().toLowerCase());
        const productId = row.dataset.productId || exactProduct?.id || '';
        if (name || unitPrice > 0) {
            parts.push({ name, quantity, unitPrice, price, productId });
            partsTotal += price;
        }
    });

    return {
        id: id ? parseInt(id) : Date.now(),
        client,
        bike,
        observations,
        mechanic: services[0]?.mechanic || 'leo',
        paymentMethod: services[0]?.paymentMethod || 'pix',
        labor,
        services,
        servicesTotal,
        parts,
        partsTotal,
        total: servicesTotal + partsTotal,
        discounts: [...state.currentOSDiscounts],
        discountTotal: state.currentOSDiscounts.reduce((sum, d) => sum + Number(d.amount || 0), 0)
    };
}

// ETAPA 1: Salvar Rascunho
async function saveOSDraft(e) {
    if(e) e.preventDefault();
    const data = getOSFormData();
    
    const index = state.openOrders.findIndex(o => o.id === data.id);
    
    if (index === -1) {
        if (state.openOrders.length >= 15) {
            alert("Limite de 15 ordens abertas atingido. Finalize alguma para abrir uma nova.");
            return;
        }
        state.openOrders.push(data);
    } else {
        state.openOrders[index] = data;
    }

    try {
        await saveOpenOrder(data);
        saveAndRefresh();
        resetOSForm();
        alert("Rascunho salvo com sucesso!");
    } catch (error) {
        console.error('Erro ao salvar O.S em aberto no Firestore:', error);
        saveAndRefresh();
        alert("Rascunho salvo neste aparelho, mas não foi possível sincronizar com a nuvem.");
    }
}

// ETAPA 2: Finalizar O.S
async function finalizeOS() {
    if (isFinalizingOS) return;

    const data = getOSFormData();
    if (!data.client) { alert("Informe o cliente para finalizar."); return; }

    isFinalizingOS = true;
    const closeButton = document.getElementById('os-close-btn');
    if (closeButton) {
        closeButton.disabled = true;
        closeButton.textContent = 'Finalizando...';
    }

    const existingOS = state.serviceOrders.find(o => o.id === data.id);
    const date = new Date().toLocaleDateString('pt-BR');
    
    const osData = { 
        ...data,
        osNumber: existingOS?.osNumber || getNextOSNumber(),
        date,
        editCount: existingOS ? (existingOS.editCount || 0) + 1 : 0
    };

    try {
        if (existingOS) {
            const idx = state.serviceOrders.findIndex(o => o.id === data.id);
            state.serviceOrders[idx] = osData;
        } else {
            state.serviceOrders.push(osData);
        }

        if (!existingOS) {
            await decrementProductsStock(osData.parts);
        }

        await saveServiceOrder(osData);
        await downloadOSPDF(osData);

        // Remove dos rascunhos se estiver lá
        state.openOrders = state.openOrders.filter(o => o.id !== data.id);
        await deleteOpenOrderFromCloud(data.id).catch(() => {});
        saveAndRefresh();
        resetOSForm();
    } catch (error) {
        if (!existingOS) {
            state.serviceOrders = state.serviceOrders.filter(o => o.id !== data.id);
        }
        console.error('Erro ao finalizar O.S:', error);
        alert('Não foi possível finalizar a O.S. Confira a conexão e as permissões do Firebase para dar baixa no estoque.');
    } finally {
        isFinalizingOS = false;
        if (closeButton) {
            closeButton.disabled = false;
            closeButton.textContent = 'Finalizar & Gerar PDF';
        }
    }
}

function getNextOSNumber() {
    return state.serviceOrders.reduce((max, os, index) => {
        return Math.max(max, Number(os.osNumber) || index + 1);
    }, 0) + 1;
}

function formatOSNumber(os, fallbackIndex = 0, digits = 3) {
    const orderIndex = state.serviceOrders.findIndex(order => order.id === os.id);
    const number = Number(os.osNumber) || (orderIndex >= 0 ? orderIndex + 1 : fallbackIndex + 1);
    return String(number).padStart(digits, '0');
}

async function downloadOSPDF(osOrId) {
    // Busca a O.S se for passado apenas o ID (clique no histórico) 
    // ou usa o objeto direto (geração de nova O.S)
    let os = (typeof osOrId === 'number') ? state.serviceOrders.find(o => o.id === osOrId) : osOrId;
    if (!os) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoData = await loadImageForPDF('img/logo.png');
    const parts = os.parts || [];
    const services = os.services || [];
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

    if (services.length > 0) {
        services.forEach(service => {
            const paymentLabels = { pix: 'PIX', avista: 'ESPECIE', cartao: 'CARTAO' };
            const mechanicLabels = { leo: 'LEO', wandson: 'WANDSON' };
            const detail = `${mechanicLabels[service.mechanic] || String(service.mechanic || '').toUpperCase()} | ${paymentLabels[service.paymentMethod] || String(service.paymentMethod || '').toUpperCase()}`;
            const name = `${String(service.name || 'Servico').toUpperCase()} (${detail})`;
            const lines = doc.splitTextToSize(name, 130);
            doc.text(lines, 20, y);
            doc.text(money(service.price), 186, y, { align: 'right' });
            y += Math.max(10, lines.length * 5 + 4);
            doc.setDrawColor(235, 235, 235);
            doc.line(20, y, 190, y);
            y += 6;
        });
    }

    if (parts.length > 0) {
        parts.forEach(part => {
            const quantity = Math.max(Number.parseInt(part.quantity, 10) || 1, 1);
            const unitPrice = Number(part.unitPrice ?? (quantity > 1 ? Number(part.price || 0) / quantity : part.price || 0));
            const quantityLabel = quantity > 1 ? `${quantity}X ` : '';
            const unitLabel = quantity > 1 ? ` (${quantity} x ${money(unitPrice)})` : '';
            const name = `${quantityLabel}${String(part.name || 'Peca').toUpperCase()}${unitLabel}`;
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
    doc.text('SERVICOS', 126, totalsY + 19);
    doc.text(money(os.servicesTotal), 188, totalsY + 19, { align: 'right' });
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


function saveAndRefresh() {
    try {
        localStorage.setItem('gm_orders', JSON.stringify(state.serviceOrders));
        localStorage.setItem('gm_orders_cache', JSON.stringify(state.serviceOrders));
        localStorage.setItem('gm_open_orders', JSON.stringify(state.openOrders));
    } catch (e) {
        console.error("Erro ao salvar no LocalStorage: Provavelmente o limite de 5MB foi atingido devido às fotos.");
        alert("Atenção: O limite de armazenamento de fotos foi atingido. Tente usar fotos menores ou remova itens antigos.");
    }
    
    refreshOrdersUI();
}

function renderHistory() {
    const body = document.getElementById('os-history-body');
    if (!body) return;

    const canDelete = state.currentUserRole === 'admin';
    const ordered = [...state.serviceOrders].sort((a, b) => (Number(b.osNumber) || b.id) - (Number(a.osNumber) || a.id));
    body.innerHTML = ordered.map((os, index) => `
        <tr class="text-sm border-b border-neutral-900/50 hover:bg-white/[0.02] transition-colors">
            <td class="py-6 font-black text-red-600 italic leading-tight">
                O.S #${formatOSNumber(os, index)}
                ${os.editCount > 0 ? `<br><span class="text-[9px] text-neutral-500 not-italic font-bold uppercase tracking-tighter">Editada ${os.editCount}x</span>` : ''}
            </td>
            <td class="py-6 text-neutral-400">${escapeHtml(os.date || '')}</td>
            <td class="py-6 font-bold uppercase text-white">${escapeHtml(os.client || 'Sem Nome')}</td>
            <td class="py-6 italic uppercase text-neutral-500 text-xs">${escapeHtml(os.bike || 'Sem Moto')}</td>
            <td class="py-6 text-green-500 font-black uppercase text-[10px] tracking-widest">Finalizada</td>
            <td class="py-6 text-red-500 font-black">R$ ${Number(os.total || 0).toFixed(2)}</td>
            <td class="py-6 flex gap-4">
                <button onclick="editOS(${os.id})" class="text-blue-500 hover:text-blue-400 transition">Editar</button>
                <button onclick="downloadOSPDF(${os.id})" class="text-green-500 hover:text-green-400 transition">Baixar</button>
                ${canDelete ? `<button onclick="deleteOS(${os.id})" class="text-neutral-600 hover:text-red-600 transition">Remover</button>` : ''}
            </td>
        </tr>
    `).join('') || `
        <tr>
            <td colspan="7" class="py-8 text-center text-neutral-600 text-xs uppercase font-bold tracking-[0.2em]">
                Nenhuma O.S finalizada
            </td>
        </tr>
    `;
}

function renderClosedOrders() {
    const list = document.getElementById('closed-os-list');
    const countLabel = document.getElementById('closed-os-count');
    if (!list) return;

    if (countLabel) countLabel.textContent = `${state.serviceOrders.length} ordens finalizadas`;

    const ordered = [...state.serviceOrders].sort((a, b) => (Number(b.osNumber) || b.id) - (Number(a.osNumber) || a.id));
    list.innerHTML = ordered.map((os, index) => `
        <div class="py-5 flex flex-col md:flex-row md:items-center justify-between gap-3 animate-fade-in hover:bg-white/[0.02] transition-colors">
            <div class="min-w-0 flex items-start gap-3">
                <p class="text-red-600 font-black text-xs uppercase italic leading-tight whitespace-nowrap pt-0.5">
                    O.S #${formatOSNumber(os, index)}
                    ${os.editCount > 0 ? `<br><span class="text-[9px] text-neutral-500 not-italic font-bold uppercase tracking-tighter">Editada ${os.editCount}x</span>` : ''}
                </p>
                <div class="min-w-0">
                    <h5 class="font-bold text-sm uppercase truncate text-white">${escapeHtml(os.client || 'Sem Nome')}</h5>
                    <p class="text-[10px] text-neutral-500 uppercase italic truncate">${escapeHtml(os.bike || 'Sem Moto')} | ${escapeHtml(os.date || '')}</p>
                    <p class="text-green-500 font-black uppercase text-[9px] tracking-widest mt-1">Finalizada</p>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-4 md:justify-end">
                <p class="text-red-500 font-black text-sm whitespace-nowrap">R$ ${Number(os.total || 0).toFixed(2)}</p>
                <button onclick="downloadOSPDF(${os.id})" class="text-[10px] text-green-500 font-black uppercase tracking-widest hover:text-green-400 transition">PDF</button>
                <button onclick="editOS(${os.id})" class="text-[10px] text-blue-500 font-black uppercase tracking-widest hover:text-blue-400 transition">Editar</button>
            </div>
        </div>
    `).join('') || '<p class="text-center text-neutral-600 text-xs py-8 uppercase font-bold tracking-[0.2em]">Nenhuma O.S finalizada</p>';
}

function renderOpenOrders() {
    const list = document.getElementById('open-os-list');
    const countLabel = document.getElementById('open-os-count');
    if (!list) return;

    if (countLabel) countLabel.textContent = `${state.openOrders.length} de 15 ordens em andamento`;

    list.innerHTML = state.openOrders.map(os => `
        <div class="bg-black border border-neutral-800 p-4 rounded-xl flex flex-col gap-3 animate-fade-in">
            <div class="flex justify-between items-start">
                <div class="flex-1 truncate mr-2">
                    <p class="text-red-600 font-black text-[9px] uppercase italic tracking-widest mb-1">Rascunho em aberto</p>
                    <h5 class="font-bold text-sm uppercase truncate text-white">${escapeHtml(os.client || 'Sem Nome')}</h5>
                    <p class="text-[10px] text-neutral-500 uppercase italic truncate">${escapeHtml(os.bike || 'Sem Moto')}</p>
                </div>
                <p class="text-white font-black text-sm">R$ ${Number(os.total || 0).toFixed(2)}</p>
            </div>
            <div class="flex gap-2 border-t border-neutral-900 pt-3">
                <button onclick="loadOSDraft(${os.id})" class="flex-1 bg-neutral-800 py-2 rounded text-[9px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition">Carregar</button>
                <button onclick="deleteOpenOS(${os.id})" class="bg-neutral-900 p-2 rounded text-neutral-600 hover:text-red-600 transition">✕</button>
            </div>
        </div>
    `).join('') || '<p class="col-span-full text-center text-neutral-600 text-[10px] py-8 uppercase font-bold tracking-[0.2em]">Nenhum rascunho ativo</p>';
}

function loadOSDraft(id) {
    const os = state.openOrders.find(o => o.id === id);
    if (!os) return;
    
    // Preenche o formulário
    document.getElementById('os-id').value = os.id;
    document.getElementById('os-client').value = os.client;
    document.getElementById('os-bike').value = os.bike;
    document.getElementById('os-observations').value = os.observations || '';
    const servicesContainer = document.getElementById('os-services-container');
    servicesContainer.innerHTML = '';
    (os.services || []).forEach(service => addServiceRow(service.name, service.price, service.mechanic, service.paymentMethod));

    const container = document.getElementById('os-parts-container');
    container.innerHTML = '';
    (os.parts || []).forEach(p => addPartRow(p.name, p.unitPrice ?? p.price, p.productId, p.quantity || 1));
    if (!os.parts || os.parts.length === 0) addPartRow();
    state.currentOSDiscounts = [...(os.discounts || [])];
    updateDiscountTargets();
    
    document.getElementById('os-form').scrollIntoView({ behavior: 'smooth' });
}

function editOS(id) {
    const os = state.serviceOrders.find(o => o.id === id);
    if (!os) return;

    document.getElementById('os-id').value = os.id;
    document.getElementById('os-client').value = os.client;
    document.getElementById('os-bike').value = os.bike;
    document.getElementById('os-observations').value = os.observations || '';
    const servicesContainer = document.getElementById('os-services-container');
    servicesContainer.innerHTML = '';
    (os.services || []).forEach(service => addServiceRow(service.name, service.price, service.mechanic, service.paymentMethod));

    const container = document.getElementById('os-parts-container');
    container.innerHTML = '';
    (os.parts || []).forEach(p => addPartRow(p.name, p.unitPrice ?? p.price, p.productId, p.quantity || 1));
    if (!os.parts || os.parts.length === 0) addPartRow();
    state.currentOSDiscounts = [...(os.discounts || [])];
    updateDiscountTargets();
    
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
    document.getElementById('os-services-container').innerHTML = '';
    document.getElementById('os-observations').value = '';
    state.currentOSDiscounts = [];
    addPartRow();
    document.getElementById('os-discount-value').value = '';
    document.getElementById('os-discount-type').value = 'fixed';
    updateDiscountTargets();
    document.getElementById('os-submit-btn').textContent = 'Salvar Rascunho';
    document.getElementById('os-cancel-edit').classList.add('hidden');
}

async function deleteOS(id) {
    if (state.currentUserRole !== 'admin') {
        alert('Ação negada: Apenas administradores podem excluir O.S finalizadas.');
        return;
    }

    if (!confirm('Tem certeza que deseja excluir esta O.S?')) return;
    try {
        await deleteDoc(doc(db, SERVICE_ORDERS_COLLECTION, String(id)));
        state.serviceOrders = state.serviceOrders.filter(o => o.id !== id);
        saveAndRefresh();
    } catch (error) {
        console.error('Erro ao excluir O.S no Firestore:', error);
        alert('Não foi possível excluir a O.S. Verifique sua conexão.');
    }
}

async function clearOSHistory() {
    if (state.currentUserRole !== 'admin') {
        alert('Ação negada: Apenas administradores podem limpar o histórico.');
        return;
    }

    if (state.serviceOrders.length === 0) {
        alert('O histórico já está vazio.');
        return;
    }

    if (confirm(`Atenção: Você está prestes a apagar permanentemente todas as ${state.serviceOrders.length} ordens de serviço do histórico. Esta ação não pode ser desfeita. Deseja continuar?`)) {
        try {
            const snapshot = await getDocs(collection(db, SERVICE_ORDERS_COLLECTION));
            const batch = writeBatch(db);
            snapshot.docs.forEach(item => batch.delete(item.ref));
            await batch.commit();
            localStorage.setItem(ORDERS_MIGRATION_KEY, 'true');
            state.serviceOrders = [];
            saveAndRefresh();
        } catch (error) {
            console.error('Erro ao limpar histórico no Firestore:', error);
            alert('Não foi possível limpar o histórico. Verifique sua conexão.');
        }
    }
}

async function deleteOpenOS(id) {
    if (!confirm('Deseja descartar este rascunho?')) return;
    try {
        await deleteOpenOrderFromCloud(id);
        state.openOrders = state.openOrders.filter(o => o.id !== id);
        saveAndRefresh();
    } catch (error) {
        console.error('Erro ao excluir O.S em aberto no Firestore:', error);
        alert('Não foi possível excluir este rascunho. Verifique sua conexão.');
    }
}

// Exposição Global para botões HTML
window.addPartRow = addPartRow;
window.addServiceRow = addServiceRow;
window.applyOSDiscount = applyOSDiscount;
window.saveOSDraft = saveOSDraft;
window.finalizeOS = finalizeOS;
window.loadOSDraft = loadOSDraft;
window.editOS = editOS;
window.deleteOS = deleteOS;
window.clearOSHistory = clearOSHistory;
window.deleteOpenOS = deleteOpenOS;
window.downloadOSPDF = downloadOSPDF;

export { addPartRow, addServiceRow, updateDiscountTargets, applyOSDiscount, getOSFormData, initOrdersSync, saveOSDraft, finalizeOS, getNextOSNumber, formatOSNumber, downloadOSPDF, saveAndRefresh, renderHistory, renderOpenOrders, renderClosedOrders, loadOSDraft, editOS, resetOSForm, deleteOS, clearOSHistory, deleteOpenOS };
