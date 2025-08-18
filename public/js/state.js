// state.js - Módulo para Gerenciamento de Estado Global

// O objeto `appState` centraliza todos os dados dinâmicos da aplicação.
export let appState = {
    currentUser: null,
    token: null,
    apiKeys: {
        gemini: "",
        gemini_backup1: "",
        gemini_backup2: "",
        openrouter: "",
        google_api: ""
    },
    userChannels: [],
    videoIdeas: [],
    currentGeminiKeyIndex: 0 // Para a rotação de chaves
};

/**
 * Atualiza o usuário logado no estado global.
 * @param {object|null} user - O objeto do usuário ou null para deslogar.
 */
export function setCurrentUser(user) {
    appState.currentUser = user;
}

/**
 * Atualiza o token de autenticação no estado global.
 * @param {string|null} token - O token JWT ou null.
 */
export function setToken(token) {
    appState.token = token;
}
