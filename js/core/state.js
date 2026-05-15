// Estado compartilhado entre os módulos da aplicação.
export const state = {
    products: [],
    openOrders: JSON.parse(localStorage.getItem('gm_open_orders')) || [],
    serviceOrders: JSON.parse(localStorage.getItem('gm_orders')) || [],
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
