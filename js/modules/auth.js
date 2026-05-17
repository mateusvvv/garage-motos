import { auth, db } from '../../firebase-config.js';
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { state } from '../core/state.js';
import { showAdminView } from './ui.js';
import { renderAdminStock } from './products.js';
import { renderAdminAppointments } from './appointments.js';
import { initOrdersSync } from './orders.js';

function clearLoginForm() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.reset();
        return;
    }

    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
}

export async function loginAdmin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        console.error("Erro de login:", error.code);
        if (error.code === 'auth/user-not-found') {
            alert('Acesso negado: Este e-mail não foi cadastrado no Firebase.');
        } else if (error.code === 'auth/wrong-password') {
            alert('Acesso negado: Senha incorreta.');
        } else {
            alert('Acesso negado: Credenciais inválidas ou erro de conexão.');
        }
    }
}

export async function logoutAdmin() {
    if (confirm('Tem certeza que deseja sair do painel administrativo?')) {
        await signOut(auth);
        clearLoginForm();
    }
}

export function initAuthObserver() {
    onAuthStateChanged(auth, async (user) => {
        const dashboard = document.getElementById('admin-dashboard-ui');
        const loginUI = document.getElementById('admin-login-ui');
        if (!dashboard || !loginUI) return;

        if (user) {
            if (user.email === 'leonardo1412goncalves@gmail.com') {
                state.currentUserRole = 'admin';
            } else if (user.email === 'garagemotos@gmail.com') {
                state.currentUserRole = 'collaborator';
            } else {
                try {
                    const userDoc = await getDoc(doc(db, "users", user.uid));
                    state.currentUserRole = userDoc.exists() ? userDoc.data().role : 'collaborator';
                } catch (e) {
                    console.warn("Firestore inacessível, definindo como colaborador por padrão.");
                    state.currentUserRole = 'collaborator';
                }
            }

            const roleLabel = document.getElementById('admin-role-label');
            if (roleLabel) {
                roleLabel.textContent = `Perfil: ${state.currentUserRole === 'admin' ? 'Administrador' : 'Funcionário'}`;
            }

            const btnDeleteAll = document.getElementById('btn-delete-all');
            if (btnDeleteAll) btnDeleteAll.style.display = (state.currentUserRole === 'admin') ? 'block' : 'none';

            dashboard.classList.remove('hidden');
            loginUI.classList.add('hidden');
            initOrdersSync();
            renderAdminStock();
            renderAdminAppointments();
            showAdminView('gestao');
        } else {
            dashboard.classList.add('hidden');
            loginUI.classList.remove('hidden');
            clearLoginForm();
        }
    });
}
