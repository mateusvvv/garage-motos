import { state } from '../core/state.js';
import { loadImageForPDF } from '../core/utils.js';
import { renderAdminStock } from './products.js';
import { renderChart, updateRevenueFilterOptions } from './finance.js';

function addPartRow(name = '', price = '') {
    const container = document.getElementById('os-parts-container');
    if (!container) return;

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
    state.currentOSDiscounts.push({
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
        discountTotal: state.currentOSDiscounts.reduce((sum, d) => sum + Number(d.amount || 0), 0)
    };
}

// ETAPA 1: Salvar Rascunho
function saveOSDraft(e) {
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

    saveAndRefresh();
    resetOSForm();
    alert("Rascunho salvo com sucesso!");
}

// ETAPA 2: Finalizar O.S
function finalizeOS() {
    const data = getOSFormData();
    if (!data.client) { alert("Informe o cliente para finalizar."); return; }

    const existingOS = state.serviceOrders.find(o => o.id === data.id);
    const date = new Date().toLocaleDateString('pt-BR');
    
    const osData = { 
        ...data,
        osNumber: existingOS?.osNumber || getNextOSNumber(),
        date,
        editCount: existingOS ? (existingOS.editCount || 0) + 1 : 0
    };

    if (existingOS) {
        const idx = state.serviceOrders.findIndex(o => o.id === data.id);
        state.serviceOrders[idx] = osData;
    } else {
        state.serviceOrders.push(osData);
    }

    // Remove dos rascunhos se estiver lá
    state.openOrders = state.openOrders.filter(o => o.id !== data.id);
    
    downloadOSPDF(osData);
    saveAndRefresh();
    resetOSForm();
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


function saveAndRefresh() {
    try {
        localStorage.setItem('gm_orders', JSON.stringify(state.serviceOrders));
        localStorage.setItem('gm_open_orders', JSON.stringify(state.openOrders));
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

function renderHistory() {
    const body = document.getElementById('os-history-body');
    if (!body) return;
    body.innerHTML = state.serviceOrders.map((os, index) => `
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

    if (countLabel) countLabel.textContent = `${state.openOrders.length} de 15 ordens em andamento`;

    list.innerHTML = state.openOrders.map(os => `
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
    const os = state.openOrders.find(o => o.id === id);
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
    state.currentOSDiscounts = [...(os.discounts || [])];
    
    document.getElementById('os-form').scrollIntoView({ behavior: 'smooth' });
}

function editOS(id) {
    const os = state.serviceOrders.find(o => o.id === id);
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
    state.currentOSDiscounts = [...(os.discounts || [])];
    
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
    state.currentOSDiscounts = [];
    addPartRow();
    document.getElementById('os-discount-value').value = '';
    document.getElementById('os-discount-type').value = 'fixed';
    updateDiscountTargets();
    document.getElementById('os-submit-btn').textContent = 'Salvar Rascunho';
    document.getElementById('os-cancel-edit').classList.add('hidden');
}

function deleteOS(id) {
    if (!confirm('Tem certeza que deseja excluir esta O.S?')) return;
    state.serviceOrders = state.serviceOrders.filter(o => o.id !== id);
    saveAndRefresh();
}

function clearOSHistory() {
    if (state.currentUserRole !== 'admin') {
        alert('Ação negada: Apenas administradores podem limpar o histórico.');
        return;
    }

    if (state.serviceOrders.length === 0) {
        alert('O histórico já está vazio.');
        return;
    }

    if (confirm(`Atenção: Você está prestes a apagar permanentemente todas as ${state.serviceOrders.length} ordens de serviço do histórico. Esta ação não pode ser desfeita. Deseja continuar?`)) {
        state.serviceOrders = [];
        saveAndRefresh();
    }
}

function deleteOpenOS(id) {
    if (!confirm('Deseja descartar este rascunho?')) return;
    state.openOrders = state.openOrders.filter(o => o.id !== id);
    saveAndRefresh();
}


export { addPartRow, updateDiscountTargets, applyOSDiscount, getOSFormData, saveOSDraft, finalizeOS, getNextOSNumber, formatOSNumber, downloadOSPDF, saveAndRefresh, renderHistory, renderOpenOrders, loadOSDraft, editOS, resetOSForm, deleteOS, clearOSHistory, deleteOpenOS };
