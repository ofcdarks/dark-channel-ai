// main.js - Ponto de Entrada do Frontend

import { initializeAuth, handleGoogleCredentialResponse } from './auth.js';
import { ELEMENTS, initializeUI, renderTabContent } from './ui.js';
import { log } from './utils.js';

// --- Inicialização da Aplicação ---

/**
 * Função principal que é executada quando o DOM está pronto.
 * Configura todos os event listeners globais e inicializa a aplicação.
 */
function main() {
    log('Aplicação iniciada. Configurando listeners...');

    // Disponibiliza a função de callback do Google no escopo global
    window.handleGoogleCredentialResponse = handleGoogleCredentialResponse;

    // Inicializa os listeners de autenticação (formulários, botões de troca)
    initializeAuth();

    // Inicializa os listeners da UI principal (menu, modais, etc.)
    initializeUI();

    // Listener para navegação na sidebar
    ELEMENTS.sidebarNav.addEventListener('click', (event) => {
        const clickedButton = event.target.closest('.sidebar-btn');
        if (clickedButton) {
            ELEMENTS.sidebarNav.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('sidebar-btn-active'));
            clickedButton.classList.add('sidebar-btn-active');
            renderTabContent(clickedButton.getAttribute('data-tab'));
        }
    });

    log('Aplicação pronta.');
}

// Executa a função principal quando o conteúdo do DOM for carregado
document.addEventListener('DOMContentLoaded', main);
