function readStorageArray(key) {
    try {
        const value = localStorage.getItem(key);
        if (!value) return [];
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error(`Erro ao ler ${key} do LocalStorage:`, error);
        try {
            localStorage.setItem(`${key}_backup_corrompido_${Date.now()}`, localStorage.getItem(key) || '');
        } catch (_) {}
        return [];
    }
}

function readOrdersFromStorage() {
    const syncedCache = readStorageArray('gm_orders_cache');
    return syncedCache.length > 0 ? syncedCache : readStorageArray('gm_orders');
}

function normalizeOrder(order, index = 0) {
    const parts = Array.isArray(order?.parts) ? order.parts : [];
    const services = Array.isArray(order?.services) ? order.services : [];
    const normalizedParts = parts.map(part => ({
        name: String(part?.name || ''),
        price: Number(part?.price || 0),
        productId: String(part?.productId || '')
    }));
    const normalizedServices = services.map(service => ({
        name: String(service?.name || ''),
        price: Number(service?.price || 0)
    }));
    const partsTotal = Number(order?.partsTotal ?? normalizedParts.reduce((sum, part) => sum + part.price, 0));
    const servicesTotal = Number(order?.servicesTotal ?? normalizedServices.reduce((sum, service) => sum + service.price, 0));
    const labor = Number(order?.labor || 0);
    const total = Number(order?.total ?? labor + servicesTotal + partsTotal);
    const id = Number(order?.id) || Date.now() + index;

    return {
        ...order,
        id,
        client: String(order?.client || ''),
        bike: String(order?.bike || ''),
        observations: String(order?.observations || ''),
        mechanic: order?.mechanic || 'leo',
        paymentMethod: order?.paymentMethod || 'pix',
        labor,
        services: normalizedServices,
        servicesTotal,
        parts: normalizedParts,
        partsTotal,
        total,
        discounts: Array.isArray(order?.discounts) ? order.discounts : [],
        discountTotal: Number(order?.discountTotal || 0)
    };
}

// Estado compartilhado entre os módulos da aplicação.
export const state = {
    products: [],
    openOrders: readStorageArray('gm_open_orders').map(normalizeOrder),
    serviceOrders: readOrdersFromStorage().map(normalizeOrder),
    appointmentRequests: [],
    pickerCalendar: null,
    tempSelectedDate: '',
    currentOSDiscounts: [],
    currentUserRole: 'collaborator',
    isInitialLoad: true,
    calendar: null,
    revenueChart: null
};

export const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
notificationSound.loop = true;
