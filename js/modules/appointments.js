import { auth, db } from '../../firebase-config.js';
import { collection, addDoc, onSnapshot, deleteDoc, doc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from '../core/state.js';
import { updateScrollLock, startAlarm, updateMenuBadge } from './ui.js';

function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    state.calendar = new FullCalendar.Calendar(calendarEl, {
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
        events: state.appointmentRequests,
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
            
            const isBlocked = state.appointmentRequests.some(e => e.type === 'block' && e.start === info.dateStr);
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
    state.calendar.render();

    // Removido o onSnapshot daqui de dentro para a função global initAppointmentsSync
}

function initAdminCalendar() {
    const calendarEl = document.getElementById('admin-calendar');
    if (!calendarEl || state.adminCalendar) return;

    state.adminCalendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'pt-br',
        contentHeight: 'auto',
        aspectRatio: 1.35,
        headerToolbar: { left: 'title', center: '', right: 'today prev,next' },
        buttonText: { today: 'Hoje' },
        showNonCurrentDates: false, // Mostra apenas os dias do mês atual
        businessHours: { daysOfWeek: [1, 2, 3, 4, 5] },
        events: state.appointmentRequests,
        eventContent: function(arg) {
            const type = arg.event.extendedProps.type;
            if (type === 'request') {
                return { html: `<div class="fc-event-main text-center text-[10px] p-1 bg-red-600/20 rounded border border-red-600/40 truncate" title="${arg.event.title}">🛠️ ${arg.event.title.split(' - ')[0]}</div>` };
            }
            return { html: `<div class="fc-event-main text-center text-[9px] p-1 bg-neutral-800 rounded border border-neutral-700 truncate" style="white-space: normal; line-height: 1;">${arg.event.title}</div>` };
        },
        dateClick: function(info) {
            quickAdminNote(info.dateStr);
        }
    });
    state.adminCalendar.render();
}

function openAdminCalendar() {
    const overlay = document.getElementById('admin-calendar-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    if (!state.adminCalendar) {
        initAdminCalendar();
    }
    
    setTimeout(() => {
        if (state.adminCalendar) {
            state.adminCalendar.render();
            state.adminCalendar.updateSize();
        }
    }, 150);
}

function closeAdminCalendar() {
    const overlay = document.getElementById('admin-calendar-overlay');
    if (overlay) overlay.classList.add('hidden');
    updateScrollLock();
}

async function quickAdminNote(dateStr) {
    const title = prompt(`O que deseja marcar para o dia ${dateStr.split('-').reverse().join('/')}?\n(Ex: 2 Revisões / Feriado / Peças chegando)`);
    if (!title) return;
    try {
        await addDoc(collection(db, "appointments"), {
            title: title.toUpperCase(),
            start: dateStr,
            color: '#262626',
            type: 'block'
        });
    } catch (err) {
        alert('Erro ao salvar no calendário.');
    }
}

function initAppointmentsSync() {
    // Sincronização em tempo real com o Firebase
    onSnapshot(collection(db, "appointments"), (snapshot) => {
        const docChanges = snapshot.docChanges();
        state.appointmentRequests = [];
        const calendarEvents = [];
        snapshot.forEach((doc) => {
            const data = { id: doc.id, ...doc.data() };
            state.appointmentRequests.push(data);
            calendarEvents.push(data);
        });

        // Tocar som se houver um novo agendamento (após carregamento inicial e se o admin estiver logado)
        if (!state.isInitialLoad && auth.currentUser) {
            const isDashboardVisible = !document.getElementById('admin-dashboard-ui')?.classList.contains('hidden');
            
            docChanges.forEach(change => {
                // Dispara apenas para novos agendamentos de clientes se o painel estiver aberto
                if (change.type === 'added' && change.doc.data().type === 'request' && change.doc.data().source === 'client' && isDashboardVisible) {
                    startAlarm(); // Dispara o alarme visual e sonoro repetitivo
                }
            });
        }
        if (state.isInitialLoad && snapshot.docs.length >= 0) state.isInitialLoad = false;

        if (state.calendar) {
            state.calendar.removeAllEvents();
            calendarEvents.forEach(ev => state.calendar.addEvent(ev));
        }
        if (state.adminCalendar) {
            state.adminCalendar.removeAllEvents();
            calendarEvents.forEach(ev => state.adminCalendar.addEvent(ev));
        }
        if (state.pickerCalendar) {
            state.pickerCalendar.removeAllEvents();
            calendarEvents.forEach(ev => state.pickerCalendar.addEvent(ev));
        }
        renderAdminAppointments();
        renderAdminNotes();
    });
}

function openAppointmentPicker() {
    document.getElementById('appointment-picker-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    document.getElementById('picker-step-1').classList.remove('hidden');
    
    if (!state.pickerCalendar) {
        const calendarEl = document.getElementById('picker-calendar');
        state.pickerCalendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'pt-br',
            height: 'auto',
            headerToolbar: { left: 'title', center: '', right: 'today prev,next' },
            buttonText: { today: 'Hoje' },
            validRange: {
                start: new Date().toLocaleDateString('sv-SE') // Define hoje como data mínima (Formato YYYY-MM-DD)
            },
            businessHours: { daysOfWeek: [1, 2, 3, 4, 5] },
            events: state.appointmentRequests,
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
                const isBlocked = state.appointmentRequests.some(e => e.type === 'block' && e.start === info.dateStr);
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
        state.pickerCalendar.removeAllEvents();
        state.appointmentRequests.forEach(ev => state.pickerCalendar.addEvent(ev));
    }
    setTimeout(() => state.pickerCalendar.render(), 100);
}

function closeAppointmentPicker() {
    document.getElementById('appointment-picker-overlay').classList.add('hidden');
    updateScrollLock();
}

async function scheduleService(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn ? submitBtn.textContent : '';

    const name = document.getElementById('client-name').value;
    const phone = document.getElementById('client-phone').value;
    const bike = document.getElementById('bike-info').value;
    const datePart = document.getElementById('service-date-only').value;
    const consent = document.getElementById('privacy-consent')?.checked;

    // Validação de Telefone (Brasil: DDD + Número)
    const cleanPhone = phone.replace(/\D/g, '');
    const phoneRegex = /^[1-9]{2}9?[0-9]{8}$/;
    if (!phoneRegex.test(cleanPhone)) {
        alert("Por favor, insira um telefone válido com DDD (ex: 81 98765-4321).");
        return;
    }

    if (!consent) {
        alert("Para prosseguir, é necessário aceitar o uso de dados para o agendamento.");
        return;
    }

    if (!datePart) {
        alert("Por favor, selecione uma data no calendário antes de solicitar.");
        return;
    }
    
    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Carregando...';
        }

        await addDoc(collection(db, "appointments"), {
            title: `🛠️ ${bike} - ${name}`,
            start: datePart,
            color: '#e11d48',
            clientName: name,
            clientPhone: cleanPhone,
            bikeInfo: bike,
            createdAt: new Date().toISOString(),
            type: 'request',
            source: 'client'
        });
        alert('Solicitação enviada com sucesso! O mecânico verificará sua vaga.');
        e.target.reset();
        
        // Limpeza manual dos campos customizados (Picker)
        document.getElementById('service-date-only').value = '';
        document.getElementById('picker-label').textContent = 'Clique para escolher';
        document.getElementById('picker-selected').textContent = '';
        
    } catch (err) {
        alert('Erro ao agendar. Tente novamente.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
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
    const blockedDates = state.appointmentRequests.filter(e => e.type === 'block');

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


function renderAdminAppointments() {
    const container = document.getElementById('admin-appointments-list');
    const totalSpan = document.getElementById('admin-appointments-total');
    const btnDeleteAll = document.getElementById('btn-delete-all-appointments');
    if (!container) return;

    const requests = state.appointmentRequests.filter(e => e.type === 'request');

    if (totalSpan) totalSpan.textContent = `(${requests.length})`;
    updateMenuBadge(requests.length);
    
    // Gerencia visibilidade do botão "Remover Todos" baseado no cargo e quantidade
    if (btnDeleteAll) {
        btnDeleteAll.style.display = (state.currentUserRole === 'admin' && requests.length > 0) ? 'block' : 'none';
    }

    container.innerHTML = requests.map(e => `
        <div class="bg-black p-4 rounded border border-neutral-800 flex justify-between items-center">
            <div>
                <p class="text-red-500 font-black text-xs uppercase italic">
                    ${e.start.split('-').reverse().join('/')}
                </p>
                <p class="font-bold text-sm uppercase">${e.clientName || 'Cliente'}</p>
                <p class="text-xs text-neutral-500 uppercase tracking-widest">${e.bikeInfo || 'Moto'}</p>
            </div>
            <div class="flex flex-col items-end gap-2">
                <button onclick="deleteAppointment('${e.id}')" class="text-white hover:text-red-600 text-[10px] font-bold uppercase italic transition-colors">REMOVER</button>
                ${e.clientPhone ? `
                    <div class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-400 font-bold">${e.clientPhone}</span>
                        <a href="https://api.whatsapp.com/send?phone=55${e.clientPhone.replace(/\D/g, '')}" target="_blank" class="text-[#25D366] hover:scale-110 transition-transform" title="Chamar no WhatsApp">
                            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35Z"/></svg>
                        </a>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('') || '<p class="text-center text-neutral-500 text-xs py-4">Nenhuma solicitação pendente.</p>';
}

async function deleteAllAppointments() {
    if (state.currentUserRole !== 'admin') {
        alert("Acesso negado: Apenas administradores podem remover todos os agendamentos.");
        return;
    }

    const requests = state.appointmentRequests.filter(e => e.type === 'request');
    if (requests.length === 0) return;

    if (!confirm(`Deseja realmente remover permanentemente todos os ${requests.length} agendamentos?`)) return;

    try {
        await Promise.all(requests.map(e => deleteDoc(doc(db, "appointments", e.id))));
        alert('Todos os agendamentos foram removidos com sucesso.');
    } catch (err) {
        console.error('Erro ao remover agendamentos:', err);
        alert('Houve um erro ao tentar remover os agendamentos.');
    }
}

async function createAppointmentFromOS(osData) {
    if (!osData.appointmentDate) return;
    
    try {
        await addDoc(collection(db, "appointments"), {
            title: `🛠️ ${osData.appointmentDesc || 'Serviço'} - ${osData.client}`,
            start: osData.appointmentDate,
            color: '#e11d48',
            clientName: osData.client,
            bikeInfo: osData.bike,
            createdAt: new Date().toISOString(),
            type: 'request',
            source: 'admin'
        });
    } catch (err) {
        console.error("Erro ao vincular orçamento à agenda:", err);
    }
}

function renderAdminNotes() {
    const container = document.getElementById('admin-notes-list');
    if (!container) return;

    // Filtra apenas bloqueios/notas (type block) e ordena por data
    const notes = state.appointmentRequests
        .filter(e => e.type === 'block')
        .sort((a, b) => a.start.localeCompare(b.start));

    container.innerHTML = notes.map(n => `
        <div class="bg-black/60 p-3 rounded border border-neutral-800 flex justify-between items-center group animate-fade-in">
            <div class="min-w-0">
                <p class="text-red-500 font-black text-[9px] uppercase italic mb-0.5">
                    ${n.start.split('-').reverse().join('/')}
                </p>
                <p class="text-[11px] font-bold text-white uppercase truncate">${n.title.replace('🚫 ', '')}</p>
            </div>
            <button onclick="deleteAppointment('${n.id}')" class="text-neutral-600 hover:text-red-500 transition-colors p-1" title="Remover Nota">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>
    `).join('') || '<p class="text-center text-neutral-600 text-[9px] py-6 uppercase font-bold italic tracking-widest opacity-50">Nenhuma nota cadastrada</p>';
}

// Exposição Global
window.deleteAppointment = deleteAppointment;
window.renderAdminNotes = renderAdminNotes;
window.deleteAllAppointments = deleteAllAppointments;
window.clearBlockedDates = clearBlockedDates;
window.openAdminCalendar = openAdminCalendar;
window.closeAdminCalendar = closeAdminCalendar;

export { initCalendar, initAdminCalendar, initAppointmentsSync, openAppointmentPicker, closeAppointmentPicker, scheduleService, blockDate, deleteAppointment, clearBlockedDates, renderAdminAppointments, deleteAllAppointments, createAppointmentFromOS, renderAdminNotes, openAdminCalendar, closeAdminCalendar };
