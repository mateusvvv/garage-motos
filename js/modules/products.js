import { auth, db, firebaseConfig } from '../../firebase-config.js';
import { collection, addDoc, onSnapshot, deleteDoc, doc, setDoc, getDocs, runTransaction } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from '../core/state.js';
import { toBase64, loadImageForPDF } from '../core/utils.js';

let hasProductsLoaded = false;
let productsLoadFailed = false;
let productsSyncStarted = false;
let retryTimer = null;
const PRODUCTS_LOAD_TIMEOUT = 8000;
const PRODUCTS_RETRY_DELAY = 5000;

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

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
            const product = state.products.find(p => p.id === id);
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
    if (productsSyncStarted) {
        renderShop();
        renderAdminStock(document.getElementById('stock-search')?.value || '');
        return;
    }
    productsSyncStarted = true;

    const productsCol = collection(db, "products");

    // Adiciona o ouvinte de busca apenas uma vez
    const searchInput = document.getElementById('shop-search');
    if (searchInput && !searchInput.dataset.listener) {
        searchInput.addEventListener('input', () => renderShop());
        searchInput.dataset.listener = 'true';
    }

    renderShop();
    renderAdminStock(document.getElementById('stock-search')?.value || '');
    loadProductsOnce(productsCol);

    const fallbackTimer = setTimeout(() => {
        if (!hasProductsLoaded) loadProductsOnce(productsCol);
    }, 3000);

    onSnapshot(productsCol, (snapshot) => {
        clearTimeout(fallbackTimer);
        setProductsFromSnapshot(snapshot);
        if (auth.currentUser) renderAdminStock();
    }, async (error) => {
        clearTimeout(fallbackTimer);
        console.error("Erro ao sincronizar produtos em tempo real:", error);
        await loadProductsOnce(productsCol);
    });
}

function reloadProducts() {
    hasProductsLoaded = false;
    productsLoadFailed = false;
    renderAdminStock(document.getElementById('stock-search')?.value || '');
    return loadProductsOnce();
}

function setProductsFromSnapshot(snapshot) {
    hasProductsLoaded = true;
    productsLoadFailed = false;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    state.products = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    renderShop();
    renderAdminStock(document.getElementById('stock-search')?.value || '');
    hideLoadingScreen();
}

async function loadProductsOnce(productsCol = collection(db, "products")) {
    try {
        const snapshot = await withTimeout(getDocs(productsCol), PRODUCTS_LOAD_TIMEOUT);
        setProductsFromSnapshot(snapshot);
        return true;
    } catch (error) {
        if (hasProductsLoaded && !productsLoadFailed) return true;
        console.error("Erro ao carregar produtos pelo SDK:", error);
        return loadProductsFromRest(productsCol);
    }
}

function withTimeout(promise, timeoutMs) {
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Tempo limite ao carregar produtos.')), timeoutMs);
        })
    ]);
}

async function loadProductsFromRest(productsCol = collection(db, "products")) {
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/products?key=${firebaseConfig.apiKey}`;
        const headers = {};

        if (auth.currentUser) {
            headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
        }

        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`REST ${response.status}: ${await response.text()}`);
        }

        const payload = await response.json();
        state.products = (payload.documents || []).map(doc => ({
            id: doc.name.split('/').pop(),
            ...parseFirestoreFields(doc.fields || {})
        }));
        hasProductsLoaded = true;
        productsLoadFailed = false;
        renderShop();
        renderAdminStock(document.getElementById('stock-search')?.value || '');
        hideLoadingScreen();
        return true;
    } catch (error) {
        if (hasProductsLoaded && !productsLoadFailed) return true;
        console.error("Erro ao carregar produtos pelo fallback REST:", error);
        hasProductsLoaded = true;
        productsLoadFailed = true;
        renderShopError();
        renderAdminStock(document.getElementById('stock-search')?.value || '');
        hideLoadingScreen();
        scheduleProductsRetry(productsCol);
        return false;
    }
}

function scheduleProductsRetry(productsCol) {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        if (productsLoadFailed) loadProductsOnce(productsCol);
    }, PRODUCTS_RETRY_DELAY);
}

function parseFirestoreFields(fields) {
    return Object.entries(fields).reduce((acc, [key, value]) => {
        acc[key] = parseFirestoreValue(value);
        return acc;
    }, {});
}

function parseFirestoreValue(value) {
    if ('stringValue' in value) return value.stringValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('booleanValue' in value) return Boolean(value.booleanValue);
    if ('nullValue' in value) return null;
    if ('timestampValue' in value) return value.timestampValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(parseFirestoreValue);
    if ('mapValue' in value) return parseFirestoreFields(value.mapValue.fields || {});
    return '';
}

function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (!loadingScreen) return;

    // Garante que o scroll seja liberado no mobile
    document.body.style.overflow = '';
    // Adiciona classe para ignorar eventos de toque enquanto desaparece
    loadingScreen.style.pointerEvents = 'none';
    
    loadingScreen.classList.add('opacity-0');
    setTimeout(() => {
        loadingScreen.classList.add('hidden');
    }, 500);
}

function renderShopError() {
    const container = document.getElementById('full-shop-container');
    if (!container) return;

    container.innerHTML = `
        <p class="col-span-full text-center text-neutral-500 text-xs uppercase font-bold tracking-[0.2em] py-16">
            Não foi possível carregar o estoque agora. Verifique a conexão ou as regras de leitura da coleção products no Firebase.
        </p>
    `;
    // Se deu erro, ainda assim precisamos esconder o loading para mostrar a mensagem
    hideLoadingScreen();
}

function editProduct(id) {
    const p = state.products.find(prod => prod.id === id);
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
    if (state.currentUserRole !== 'admin') {
        alert("Acesso negado: Apenas administradores podem remover todos os itens do estoque.");
        return;
    }

    if (state.products.length === 0) {
        alert('O estoque já está vazio.');
        return;
    }

    if (!confirm(`Tem certeza que deseja remover todos os ${state.products.length} itens do estoque? Essa ação não pode ser desfeita.`)) return;

    try {
        await Promise.all(state.products.map(product => deleteDoc(doc(db, "products", product.id))));
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


function renderShop() {
    const searchInput = document.getElementById('shop-search');
    const searchTerm = searchInput?.value.trim().toLowerCase() || '';

    // Atualiza o texto do catálogo no centro (página de peças)
    const countLabel = document.getElementById('catalog-count-label');
    if (countLabel) {
        const total = state.products.length;
        countLabel.textContent = `Catálogo Completo Garage Motos (${total} ${total === 1 ? 'item disponível' : 'itens disponíveis'})`;
    }

    // Atualiza o selo de quantidade no canto (página de peças)
    const badge = document.getElementById('items-counter-badge');
    if (badge) {
        const count = state.products.length;
        badge.innerHTML = `
            <div class="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></div>
            <span class="text-white text-[9px] font-black uppercase tracking-widest">${count} ${count === 1 ? 'Item' : 'Itens'} no Estoque</span>
        `;
    }

    const containers = [
        { el: document.getElementById('shop-container'), limit: 4, showStock: false },
        { el: document.getElementById('full-shop-container'), limit: 100, showStock: true }
    ];

    containers.forEach(({ el, limit, showStock }) => {
        if (!el) return;

        if (!hasProductsLoaded && !productsLoadFailed) {
            el.innerHTML = `
                <p class="col-span-full text-center text-neutral-500 text-xs uppercase font-bold tracking-[0.2em] py-16">
                    Carregando estoque...
                </p>
            `;
            return;
        }

        const products = [...state.products]
            .sort((a, b) => (a.name || "").localeCompare(b.name || "", 'pt-BR'))
            .filter(p => {
                if (!showStock || !searchTerm) return true;
                const name = String(p.name || '').toLowerCase();
                const location = String(p.location || '').toLowerCase();
                return name.includes(searchTerm) || location.includes(searchTerm);
            })
            .slice(0, limit);

        el.innerHTML = products.map(p => `
            <div class="bg-neutral-900 border border-neutral-800 rounded-lg md:rounded-xl overflow-hidden product-card flex flex-col h-full">
                <div class="h-24 sm:h-32 md:h-44 xl:h-48 bg-neutral-800 flex items-center justify-center p-1.5 md:p-2 overflow-hidden">
                    ${p.image ? 
                        `<img src="${p.image}" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain" alt="${escapeHtml(p.name)}">` :
                        '<div class="text-neutral-600 font-bold uppercase tracking-widest text-[8px] md:text-xs text-center">Sem Foto</div>'
                    }
                </div>
                <div class="p-2 md:p-4 flex flex-col flex-grow">
                    <h5 class="product-card-name font-black text-[8px] sm:text-[10px] md:text-xs uppercase mb-1.5">${escapeHtml(p.name)}</h5>
                    <p class="text-red-600 font-black text-xs sm:text-sm md:text-xl ${showStock ? 'mb-1' : 'mb-2 md:mb-3'}">R$ ${Number(p.price || 0).toFixed(2)}</p>
                    ${showStock ? `<p class="text-[8px] sm:text-[9px] md:text-xs text-neutral-400 uppercase tracking-tight md:tracking-widest font-bold mb-2 md:mb-3 leading-tight">${formatStockLabel(p.stock)}</p>` : ''}
                    <button onclick="window.reserveProduct('${p.id}')" 
                       class="mt-auto w-full bg-white text-black px-1 py-1.5 md:py-2 rounded font-bold uppercase text-[7px] sm:text-[8px] md:text-[10px] text-center leading-tight hover:bg-red-600 hover:text-white transition cursor-pointer">
                       Reservar para Retirada
                    </button>
                </div>
            </div>
        `).join('') || `
            <p class="col-span-full text-center text-neutral-500 text-xs uppercase font-bold tracking-[0.2em] py-16">
                ${searchTerm ? 'Nenhum item encontrado para essa busca.' : 'Nenhum item cadastrado no estoque.'}
            </p>
        `;
    });
}

async function reserveProduct(productId) {
    const product = state.products.find(p => p.id === productId);
    
    if (!product || product.stock <= 0) {
        alert("Desculpe, este produto está sem estoque no momento.");
        return;
    }

    try {
        const message = `Olá! Gostaria de reservar o produto: ${product.name}. Entendo que o pagamento é feito na retirada e que a reserva é válida por 2 horas.`;
        const waUrl = `https://api.whatsapp.com/send?phone=558193735372&text=${encodeURIComponent(message)}`;

        if (auth.currentUser) {
            await decrementProductStock(productId, 1);
        }

        window.open(waUrl, '_blank');
    } catch (error) {
        console.error("Erro ao processar reserva:", error);
        alert("Houve um erro ao reservar o item. Chame a loja pelo WhatsApp para confirmar a disponibilidade.");
    }
}

async function decrementProductsStock(parts = []) {
    if (!hasProductsLoaded || productsLoadFailed) {
        await loadProductsOnce();
    }

    const usageByProduct = parts.reduce((acc, part) => {
        const productId = resolveProductId(part);
        if (!productId) return acc;
        acc[productId] = (acc[productId] || 0) + 1;
        return acc;
    }, {});

    const productIds = Object.keys(usageByProduct);
    if (productIds.length === 0) return;

    await Promise.all(productIds.map(productId => decrementProductStock(productId, usageByProduct[productId])));
}

function resolveProductId(part = {}) {
    if (part.productId) return part.productId;
    const partName = String(part.name || '').trim().toLowerCase();
    if (!partName) return '';

    const exactMatch = state.products.find(product => String(product.name || '').trim().toLowerCase() === partName);
    return exactMatch?.id || '';
}

async function decrementProductStock(productId, quantity = 1) {
    const productRef = doc(db, "products", productId);
    const nextStock = await runTransaction(db, async (transaction) => {
        const productDoc = await transaction.get(productRef);
        if (!productDoc.exists()) {
            throw new Error(`Produto ${productId} não encontrado.`);
        }

        const currentStock = Number.parseInt(productDoc.data().stock, 10) || 0;
        const updatedStock = Math.max(currentStock - quantity, 0);
        transaction.update(productRef, { stock: updatedStock });
        return updatedStock;
    });

    const product = state.products.find(p => p.id === productId);
    if (product) product.stock = nextStock;
    renderShop();
    renderAdminStock(document.getElementById('stock-search')?.value || '');
}

function formatStockLabel(stock) {
    const quantity = Number.parseInt(stock, 10) || 0;
    return `${quantity} ${quantity === 1 ? 'unidade disponível' : 'unidades disponíveis'}`;
}

function renderAdminStock(searchTerm = '') {
    const container = document.getElementById('admin-stock-list');
    const totalCountElement = document.getElementById('stock-total-count');
    const loadingIndicator = document.getElementById('stock-loading-indicator');
    if (!container) return;

    if (!hasProductsLoaded) {
        if (totalCountElement) totalCountElement.textContent = 'Total de Itens: carregando...';
        if (loadingIndicator) loadingIndicator.classList.remove('hidden');
        container.innerHTML = `
            <p class="col-span-full text-center text-neutral-600 text-[10px] py-8 uppercase font-bold tracking-[0.2em]">
                Aguarde enquanto buscamos as imagens e os itens do estoque.
            </p>
        `;
        return;
    }

    if (loadingIndicator) loadingIndicator.classList.add('hidden');

    if (productsLoadFailed) {
        if (totalCountElement) totalCountElement.textContent = 'Total de Itens: indisponível';
        container.innerHTML = `
            <p class="col-span-full text-center text-red-500 text-[10px] py-8 uppercase font-bold tracking-[0.2em]">
                Não foi possível carregar o estoque. Verifique a conexão e as permissões do Firebase.
            </p>
        `;
        return;
    }
    
    const filtered = state.products.filter(p => 
        String(p.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (totalCountElement) {
        totalCountElement.textContent = `Total de Itens: ${filtered.length}`;
    }

    const isAdmin = state.currentUserRole === 'admin';

    container.innerHTML = filtered.map(p => `
        <div class="flex items-center justify-between p-4 border-b border-neutral-800 hover:bg-black/30 transition rounded">
            <div class="flex items-center gap-4 overflow-hidden">
                <div class="w-12 h-12 flex-shrink-0 bg-neutral-800 rounded flex items-center justify-center overflow-hidden">
                    ${p.image ? `<img src="${p.image}" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain" alt="${escapeHtml(p.name)}">` : ''}
                </div>
                <div class="truncate">
                    <p class="font-bold text-xs md:text-sm uppercase truncate">${escapeHtml(p.name)}</p>
                    <p class="text-[11px] md:text-xs text-neutral-500 uppercase tracking-tighter">Qtd: ${Number.parseInt(p.stock, 10) || 0} | R$ ${Number(p.price || 0).toFixed(2)} ${p.location ? `| Loc: ${escapeHtml(p.location)}` : ''}</p>
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

    const lowStockItems = state.products.filter(p => parseInt(p.stock) <= 5);
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

// Torna as funções acessíveis para os botões HTML (onclick)
window.reserveProduct = reserveProduct;
window.renderShop = renderShop;

export { addProduct, initProductsSync, reloadProducts, editProduct, deleteProduct, deleteAllProducts, resetProductForm, renderShop, reserveProduct, decrementProductsStock, formatStockLabel, renderAdminStock, printLowStockReport };
