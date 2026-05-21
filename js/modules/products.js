import { auth, db, firebaseConfig, storage } from '../../firebase-config.js';
import { collection, addDoc, onSnapshot, deleteDoc, doc, setDoc, getDocsFromServer, runTransaction, query, limit, startAfter, getDocs, where } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js';
import { state } from '../core/state.js';
import { toBase64, loadImageForPDF } from '../core/utils.js';

let hasProductsLoaded = false;
let productsLoadFailed = false;
let productsSyncStarted = false;
let productImagesHydrationStarted = false;
let productsRealtimeStarted = false;
let retryTimer = null;
const PRODUCTS_LOAD_TIMEOUT = 3000;
const PRODUCTS_RETRY_DELAY = 5000;
const PRODUCTS_CACHE_KEY = 'gm_products_cache_v2';
const PRODUCTS_CACHE_TTL = 5 * 60 * 1000;
const productNameCollator = new Intl.Collator('pt-BR', {
    sensitivity: 'base',
    numeric: true,
    ignorePunctuation: true
});

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeProduct(product = {}) {
    return {
        id: String(product.id || ''),
        name: String(product.name || '').trim(),
        price: Number(product.price || 0),
        stock: Number.parseInt(product.stock, 10) || 0,
        image: product.image || '',
        location: String(product.location || '').trim()
    };
}

function sortProductsByName(products = []) {
    return [...products].sort((a, b) => {
        const nameA = String(a.name || '').trim();
        const nameB = String(b.name || '').trim();
        return productNameCollator.compare(nameA, nameB);
    });
}

function mergeProductData(previous = {}, product = {}) {
    const merged = { ...previous, ...product };
    if (!('image' in product) || product.image === '') {
        merged.image = previous.image || '';
    }
    return normalizeProduct(merged);
}

function readProductsCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(PRODUCTS_CACHE_KEY) || 'null');
        if (!cached || !Array.isArray(cached.products)) return false;
        if (Date.now() - Number(cached.savedAt || 0) > PRODUCTS_CACHE_TTL) return false;
        applyProducts(cached.products, true);
        return true;
    } catch (_) {
        return false;
    }
}

function writeProductsCache(products = []) {
    try {
        localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({
            savedAt: Date.now(),
            products
        }));
    } catch (_) {
        // Imagens antigas em base64 podem ultrapassar a cota local; nesse caso seguimos sem cache.
    }
}

function applyProducts(products = [], replace = false) {
    hasProductsLoaded = true;
    productsLoadFailed = false;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    if (replace) {
        const currentProductMap = new Map(state.products.map(p => [p.id, p]));
        const normalized = products
            .map(p => mergeProductData(currentProductMap.get(String(p.id || '')), p))
            .filter(p => p.id);
        state.products = sortProductsByName(normalized);
    } else {
        const productMap = new Map(state.products.map(p => [p.id, p]));
        products.forEach(product => {
            const id = String(product.id || '');
            if (!id) return;
            const previous = productMap.get(id);
            if (!previous && !('name' in product)) return;
            productMap.set(id, mergeProductData(previous, product));
        });
        state.products = sortProductsByName(Array.from(productMap.values()));
    }

    renderShop();
    renderAdminStock(document.getElementById('stock-search')?.value || '');
    hideLoadingScreen();
}

async function addProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const name = document.getElementById('prod-name').value;
    const price = document.getElementById('prod-price').value;
    const stock = document.getElementById('prod-stock').value;
    const location = document.getElementById('prod-location').value;
    const imgFile = document.getElementById('prod-image').files[0];

    let imageUrl = '';
    if (imgFile) {
        const storageRef = ref(storage, `products/${Date.now()}_${imgFile.name}`);
        const uploadResult = await uploadBytes(storageRef, imgFile);
        imageUrl = await getDownloadURL(uploadResult.ref);
    }

    const productData = {
        name,
        price: parseFloat(price),
        stock: parseInt(stock),
        image: imageUrl || '',
        location: location || ''
    };

    try {
        if (id) {
            const product = state.products.find(p => p.id === id);
            if (!imageUrl && product?.image) productData.image = product.image;
            if (!imageUrl && !product?.image) delete productData.image;
            await setDoc(doc(db, "products", id), productData, { merge: true });
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

function initProductsSync(useRealtime = false) {
    if (productsSyncStarted && (!useRealtime || productsRealtimeStarted)) {
        renderShop();
        renderAdminStock(document.getElementById('stock-search')?.value || '');
        return;
    }
    if (!productsSyncStarted) {
        productsSyncStarted = true;
        hasProductsLoaded = false; // Garante estado inicial correto
    }

    // Aumentamos o limite para 500 itens para exibir mais produtos e melhorar a busca local
    const productsCol = collection(db, "products");
    const productsQuery = query(productsCol, limit(500));

    // Adiciona o ouvinte de busca apenas uma vez
    const searchInput = document.getElementById('shop-search');
    if (searchInput && !searchInput.dataset.listener) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            renderShop(); // Filtro local imediato
            
            // Busca remota após 800ms de pausa na digitação
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const term = searchInput.value.trim();
                if (term.length >= 3) performServerSearch(term);
            }, 800);
        });
        searchInput.dataset.listener = 'true';
    }

    const adminSearch = document.getElementById('stock-search');
    if (adminSearch && !adminSearch.dataset.listener) {
        let adminTimeout;
        adminSearch.addEventListener('input', () => {
            renderAdminStock();
            clearTimeout(adminTimeout);
            adminTimeout = setTimeout(() => {
                const term = adminSearch.value.trim();
                if (term.length >= 3) performServerSearch(term);
            }, 800);
        });
        adminSearch.dataset.listener = 'true';
    }

    localStorage.removeItem('gm_products_cache_v1');
    renderShop();
    renderAdminStock(document.getElementById('stock-search')?.value || '');

    if (!hasProductsLoaded && !readProductsCache()) {
        loadProductsFromRest(productsQuery, true);
    }

    if (useRealtime && !productsRealtimeStarted) {
        productsRealtimeStarted = true;
        onSnapshot(productsQuery, (snapshot) => {
            if (snapshot.metadata.fromCache) {
                return;
            }
            // O snapshot representa o resultado completo da consulta atual.
            setProductsFromSnapshot(snapshot, true);
            writeProductsCache(state.products);
            if (auth.currentUser) renderAdminStock(document.getElementById('stock-search')?.value || '');
        }, async (error) => {
            console.error("Erro ao sincronizar produtos em tempo real:", error);
            await loadProductsOnce(productsQuery);
        });
    }
}

function reloadProducts() {
    hasProductsLoaded = false;
    productsLoadFailed = false;
    renderShop();
    renderAdminStock(document.getElementById('stock-search')?.value || '');
    return loadProductsOnce();
}

function setProductsFromSnapshot(snapshot, replace = false) {
    if (snapshot.docs.length > 0) {
        state.lastProductDoc = snapshot.docs[snapshot.docs.length - 1];
    }
    const products = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
    applyProducts(products, replace);
}

async function performServerSearch(term) {
    if (!term || term.length < 3) return;

    const productsCol = collection(db, "products");
    
    // O Firestore é case-sensitive. Tentamos buscar o termo com a primeira letra maiúscula
    // que é o padrão comum de cadastro (ex: "Pneu", "Câmara").
    const capitalizedTerm = term.charAt(0).toUpperCase() + term.slice(1);

    const q = query(
        productsCol,
        where('name', '>=', capitalizedTerm),
        where('name', '<=', capitalizedTerm + '\uf8ff'),
        limit(15)
    );

    try {
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            applyProducts(results); // O applyProducts já faz o merge sem duplicar IDs
        }
    } catch (error) {
        console.error("Erro na busca remota de produtos:", error);
    }
}

async function loadMoreProducts() {
    if (!state.lastProductDoc) return;

    const btn = document.getElementById('load-more-btn');
    if (btn) btn.textContent = 'Carregando...';

    try {
        const productsCol = collection(db, "products");
        const nextQuery = query(
            productsCol, 
            limit(50), 
            startAfter(state.lastProductDoc)
        );

        const snapshot = await getDocs(nextQuery);
        setProductsFromSnapshot(snapshot, false);
        
        if (snapshot.docs.length < 50 && btn) {
            btn.classList.add('hidden');
        }
    } catch (error) {
        console.error("Erro ao carregar mais produtos:", error);
    } finally {
        if (btn && btn.textContent === 'Carregando...') btn.textContent = 'Carregar Mais';
    }
}

async function loadProductsOnce(productsCol = collection(db, "products")) {
    try {
        const snapshot = await withTimeout(getDocsFromServer(productsCol), PRODUCTS_LOAD_TIMEOUT);
        setProductsFromSnapshot(snapshot, true);
        return true;
    } catch (error) {
        if (hasProductsLoaded && !productsLoadFailed) return true;
        console.warn("Carregamento pelo SDK demorou demais; tentando fallback REST:", error);
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

async function loadProductsFromRest(productsCol = collection(db, "products"), includeImages = true) {
    try {
        const headers = {};

        if (auth.currentUser) {
            headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
        }

        const products = [];
        let pageToken = '';

        do {
            const params = new URLSearchParams({
                key: firebaseConfig.apiKey,
                pageSize: '500'
            });
            if (!includeImages) {
                ['name', 'price', 'stock', 'location'].forEach(field => {
                    params.append('mask.fieldPaths', field);
                });
            }
            if (pageToken) params.set('pageToken', pageToken);

            const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/products?${params.toString()}`;
            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`REST ${response.status}: ${await response.text()}`);
            }

            const payload = await response.json();
            products.push(...(payload.documents || []).map(doc => ({
                id: doc.name.split('/').pop(),
                ...parseFirestoreFields(doc.fields || {})
            })));
            pageToken = payload.nextPageToken || '';
        } while (pageToken);

        applyProducts(products, true);
        if (includeImages) writeProductsCache(products);
        if (!includeImages) hydrateProductImagesFromRest(products.map(product => product.id));
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

async function hydrateProductImagesFromRest(productIds = []) {
    if (productImagesHydrationStarted) return;

    const idsToHydrate = [...new Set(productIds)]
        .filter(id => id && !state.products.find(product => product.id === id)?.image);

    if (idsToHydrate.length === 0) return;
    productImagesHydrationStarted = true;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (auth.currentUser) {
            headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
        }

        const chunkSize = 40;
        for (let index = 0; index < idsToHydrate.length; index += chunkSize) {
            const chunk = idsToHydrate.slice(index, index + chunkSize);
            const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:batchGet?key=${firebaseConfig.apiKey}`;
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    documents: chunk.map(id => `projects/${firebaseConfig.projectId}/databases/(default)/documents/products/${id}`),
                    mask: { fieldPaths: ['image'] }
                })
            });

            if (!response.ok) {
                throw new Error(`REST imagens ${response.status}: ${await response.text()}`);
            }

            const payload = await response.json();
            const imageUpdates = payload
                .map(item => item.found)
                .filter(Boolean)
                .map(doc => ({
                    id: doc.name.split('/').pop(),
                    ...parseFirestoreFields(doc.fields || {})
                }))
                .filter(product => product.image);

            if (imageUpdates.length > 0) {
                applyProducts(imageUpdates, false);
            }
        }
    } catch (error) {
        console.warn('Não foi possível carregar as imagens do catálogo em segundo plano:', error);
    }
}

function scheduleProductsRetry(productsCol) {
    // Se a falha for por falta de conexão ou cota, evitamos retentativas agressivas
    if (productsLoadFailed && productsSyncStarted) {
        console.warn("Retentativa de carregamento de produtos pausada para evitar consumo de cota.");
        return;
    }

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
        const p = state.products.find(prod => prod.id === id);
        // Se a imagem for um link do Firebase Storage, tentamos deletar o arquivo também
        if (p && p.image && p.image.includes('firebasestorage.googleapis.com')) {
            try {
                const imageRef = ref(storage, p.image);
                await deleteObject(imageRef);
            } catch (err) {
                console.error("Erro ao deletar imagem do storage:", err);
            }
        }
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
        countLabel.textContent = hasProductsLoaded
            ? `Catálogo Completo Garage Motos (${total} ${total === 1 ? 'item disponível' : 'itens disponíveis'})`
            : 'Carregando Catálogo Garage Motos...';
    }

    // Atualiza o selo de quantidade no canto (página de peças)
    const badge = document.getElementById('items-counter-badge');
    if (badge) {
        const count = state.products.length;
        badge.innerHTML = hasProductsLoaded ? `
            <div class="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></div>
            <span class="text-white text-[9px] font-black uppercase tracking-widest">${count} ${count === 1 ? 'Item' : 'Itens'} no Estoque</span>
        ` : `
            <div class="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse"></div>
            <span class="text-white text-[9px] font-black uppercase tracking-widest">Atualizando Estoque</span>
        `;
    }

    const containers = [
        { el: document.getElementById('shop-container'), limit: 4, showStock: false },
        { el: document.getElementById('full-shop-container'), limit: Infinity, showStock: true }
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

        const products = sortProductsByName(state.products)
            .filter(p => {
                if (!showStock || !searchTerm) return true;
                const name = String(p.name || '').toLowerCase();
                const location = String(p.location || '').toLowerCase();
                return name.includes(searchTerm) || location.includes(searchTerm);
            })
            .slice(0, limit);

        el.innerHTML = products.map(p => {
            const outOfStock = isOutOfStock(p.stock);
            return `
            <div class="${outOfStock ? 'bg-red-950/30 border-red-600/60' : 'bg-neutral-900 border-neutral-800'} border rounded-lg md:rounded-xl overflow-hidden product-card flex flex-col h-full relative">
                ${outOfStock ? '<div class="absolute top-2 left-2 z-10 bg-red-600 text-white px-2 py-1 rounded text-[8px] md:text-[9px] font-black uppercase tracking-widest">Reposição</div>' : ''}
                <div class="h-40 md:h-56 ${outOfStock ? 'bg-red-950/40' : 'bg-neutral-800'} flex items-center justify-center p-2 overflow-hidden">
                    ${p.image ? 
                        `<img src="${p.image}" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain ${outOfStock ? 'opacity-45 grayscale' : ''}" alt="${escapeHtml(p.name)}">` :
                        '<div class="text-neutral-600 font-bold uppercase tracking-widest text-[8px] md:text-xs text-center">Sem Foto</div>'
                    }
                </div>
                <div class="p-3 md:p-5 flex flex-col flex-grow">
                    <h5 class="product-card-name font-black text-[10px] md:text-xs uppercase mb-2 ${outOfStock ? 'text-red-200' : ''}">${escapeHtml(p.name)}</h5>
                    <p class="text-red-600 font-black text-sm md:text-2xl ${showStock ? 'mb-1' : 'mb-3 md:mb-4'}">R$ ${Number(p.price || 0).toFixed(2)}</p>
                    ${showStock ? `<p class="text-[10px] md:text-xs ${outOfStock ? 'text-red-400' : 'text-neutral-400'} uppercase tracking-widest font-bold mb-3 md:mb-4">${formatStockLabel(p.stock)}</p>` : ''}
                    <button onclick="window.reserveProduct('${p.id}')" 
                       class="mt-auto w-full ${outOfStock ? 'bg-red-600/20 text-red-300 border border-red-600/50 cursor-not-allowed' : 'bg-white text-black hover:bg-red-600 hover:text-white cursor-pointer'} py-2 rounded font-bold uppercase text-[10px] md:text-xs text-center transition">
                       ${outOfStock ? 'Sem Estoque' : 'Reservar para Retirada'}
                    </button>
                </div>
            </div>
        `;
        }).join('') || `
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
        const quantity = Math.max(Number.parseInt(part.quantity, 10) || 1, 1);
        acc[productId] = (acc[productId] || 0) + quantity;
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
    if (quantity === 0) {
        return '<span class="text-red-400 font-black">Item esgotado</span>';
    }
    return `${quantity} ${quantity === 1 ? 'unidade disponível' : 'unidades disponíveis'}`;
}

function isOutOfStock(stock) {
    return (Number.parseInt(stock, 10) || 0) <= 0;
}

function renderAdminStock(searchTerm = null) {
    const container = document.getElementById('admin-stock-list');
    const searchInput = document.getElementById('stock-search');
    const totalCountElement = document.getElementById('stock-total-count');
    const loadingIndicator = document.getElementById('stock-loading-indicator');
    if (!container) return;
    const activeSearchTerm = searchTerm ?? searchInput?.value ?? '';
    const normalizedSearchTerm = activeSearchTerm.trim().toLowerCase();

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
    
    const filtered = sortProductsByName(state.products.filter(p => {
        if (!normalizedSearchTerm) return true;
        const name = String(p.name || '').toLowerCase();
        const location = String(p.location || '').toLowerCase();
        return name.includes(normalizedSearchTerm) || location.includes(normalizedSearchTerm);
    }));

    if (totalCountElement) {
        totalCountElement.textContent = `Total de Itens: ${filtered.length}`;
    }

    const isAdmin = state.currentUserRole === 'admin';

    container.innerHTML = filtered.map(p => {
        const outOfStock = isOutOfStock(p.stock);
        return `
        <div class="flex items-start justify-between gap-3 p-4 border ${outOfStock ? 'border-red-600/50 bg-red-950/30' : 'border-neutral-800 hover:bg-black/30'} transition rounded">
            <div class="flex items-start gap-4 min-w-0 flex-1">
                <div class="w-12 h-12 flex-shrink-0 ${outOfStock ? 'bg-red-950 border border-red-600/40' : 'bg-neutral-800'} rounded flex items-center justify-center overflow-hidden">
                    ${p.image ? `<img src="${p.image}" loading="lazy" decoding="async" class="max-h-full max-w-full object-contain ${outOfStock ? 'opacity-45 grayscale' : ''}" alt="${escapeHtml(p.name)}">` : ''}
                </div>
                <div class="min-w-0 flex-1">
                    <p class="font-bold text-xs md:text-sm uppercase leading-snug break-words ${outOfStock ? 'text-red-200' : ''}">${escapeHtml(p.name)}</p>
                    <p class="text-[11px] md:text-xs ${outOfStock ? 'text-red-400 font-black' : 'text-neutral-500'} uppercase tracking-normal leading-relaxed break-words mt-1">${formatStockLabel(p.stock)} | R$ ${Number(p.price || 0).toFixed(2)} ${p.location ? `| Loc: ${escapeHtml(p.location)}` : ''}</p>
                </div>
            </div>
            ${isAdmin ? `
                <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 ml-2 flex-shrink-0">
                    <button onclick="editProduct('${p.id}')" class="text-blue-500 hover:text-blue-400 text-xs font-black uppercase italic">Editar</button>
                    <button onclick="deleteProduct('${p.id}')" class="text-neutral-600 hover:text-red-600 text-xs font-black uppercase italic">Excluir</button>
                </div>
            ` : ''}
        </div>
    `;
    }).join('') || '<p class="text-center text-neutral-600 text-xs uppercase font-bold py-4">Estoque Vazio</p>';
}

async function printLowStockReport() {
    if (!confirm("Deseja realmente gerar a lista de compras para reposição?")) return;

    const lowStockItems = sortProductsByName(state.products.filter(p => parseInt(p.stock) <= 5));
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
    doc.text('REPOSIÇÃO DE ESTOQUE', 196, 29, { align: 'right' });
    doc.setTextColor(210, 210, 210);
    doc.text(`Emitida em ${reportDate}`, 196, 36, { align: 'right' });

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 58, 182, 25, 2, 2, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.roundedRect(14, 58, 182, 25, 2, 2, 'S');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.text(`${lowStockItems.length} item(ns) precisam de reposição`, 22, 72);
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
window.loadMoreProducts = loadMoreProducts;
window.reloadProducts = reloadProducts;
window.printLowStockReport = printLowStockReport;
window.deleteAllProducts = deleteAllProducts;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;

export { addProduct, initProductsSync, reloadProducts, editProduct, deleteProduct, deleteAllProducts, resetProductForm, renderShop, reserveProduct, decrementProductsStock, formatStockLabel, renderAdminStock, printLowStockReport, loadMoreProducts };
