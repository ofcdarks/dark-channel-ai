// auth.js - Módulo para Autenticação

import { apiRequest } from './api.js';
import { appState, setToken, setCurrentUser } from './state.js';
import { ELEMENTS, showLoginScreen, showRegisterScreen, initializeAppUI } from './ui.js';
import { log } from './utils.js';

/**
 * Inicializa os listeners relacionados à autenticação.
 */
export function initializeAuth() {
    ELEMENTS.loginForm.addEventListener('submit', handleLogin);
    ELEMENTS.registerForm.addEventListener('submit', handleRegister);
    ELEMENTS.showRegister.addEventListener('click', (e) => { e.preventDefault(); showRegisterScreen(); });
    ELEMENTS.showLogin.addEventListener('click', (e) => { e.preventDefault(); showLoginScreen(); });
    ELEMENTS.logoutBtn.addEventListener('click', handleLogout);
}

/**
 * Manipula o evento de submit do formulário de login.
 * @param {Event} e - O objeto do evento.
 */
async function handleLogin(e) {
    e.preventDefault();
    log('Tentativa de login com e-mail/senha...');
    ELEMENTS.loginFeedback.textContent = '';
    const email = ELEMENTS.loginForm.querySelector('#login-email').value;
    const password = ELEMENTS.loginForm.querySelector('#login-password').value;

    try {
        const data = await apiRequest('/api/auth/login', 'POST', { email, password });
        await processLoginSuccess(data);
    } catch (error) {
        ELEMENTS.loginFeedback.textContent = error.message;
    }
}

/**
 * Manipula o evento de submit do formulário de registro.
 * @param {Event} e - O objeto do evento.
 */
async function handleRegister(e) {
    e.preventDefault();
    log('Tentativa de registro...');
    ELEMENTS.registerFeedback.textContent = '';
    const email = ELEMENTS.registerForm.querySelector('#register-email').value;
    const password = ELEMENTS.registerForm.querySelector('#register-password').value;

    try {
        const data = await apiRequest('/api/auth/register', 'POST', { email, password });
        await processLoginSuccess(data);
    } catch (error) {
        ELEMENTS.registerFeedback.textContent = error.message;
    }
}

/**
 * Callback para a resposta do Google Sign-In.
 * @param {object} response - O objeto de resposta da API do Google.
 */
export async function handleGoogleCredentialResponse(response) {
    log('Recebida credencial do Google. Enviando para o backend...');
    try {
        const data = await apiRequest('/api/auth/google-login', 'POST', { credential: response.credential });
        await processLoginSuccess(data);
    } catch (error) {
        ELEMENTS.loginFeedback.textContent = 'Falha no login com Google: ' + error.message;
    }
}

/**
 * Processa uma resposta de login/registro bem-sucedida.
 * @param {object} data - Os dados recebidos do backend ({ user, accessToken }).
 */
async function processLoginSuccess(data) {
    if (!data || !data.user || !data.accessToken) {
        throw new Error("Resposta do servidor inválida após autenticação.");
    }
    setCurrentUser(data.user);
    setToken(data.accessToken);
    await initializeApp();
}

/**
 * Manipula o evento de clique no botão de logout.
 */
function handleLogout() {
    log('Usuário deslogado.');
    setCurrentUser(null);
    setToken(null);
    ELEMENTS.appContainer.style.display = 'none';
    showLoginScreen();
    ELEMENTS.loginForm.reset();
}

/**
 * Inicializa a aplicação após o login, buscando as configurações do usuário.
 */
async function initializeApp() {
    if (!appState.currentUser || !appState.token) {
        log('Falha na inicialização: usuário ou token ausente.', 'error');
        return;
    }
    log(`Inicializando aplicação para ${appState.currentUser.email}...`);

    try {
        const settings = await apiRequest(`/api/settings/${appState.currentUser.id}`, 'GET');
        if (settings) {
            // Atualiza o estado com as configurações salvas
            appState.apiKeys = { ...appState.apiKeys, ...settings };
            appState.userChannels = settings.userChannels || [];
            appState.videoIdeas = settings.videoIdeas || [];
        }
        log('Configurações do usuário carregadas.', 'success');
    } catch (error) {
        log(`Não foi possível carregar as configurações: ${error.message}`, 'warn');
    }

    // Inicia a UI principal da aplicação
    initializeAppUI();
}
