// api.js - Módulo para todas as chamadas de API

import { appState } from './state.js';
import { log } from './utils.js';
import { showProgressModal, hideProgressModal } from './ui.js';

/**
 * Realiza uma requisição para o backend da aplicação.
 * @param {string} endpoint - O endpoint da API (ex: '/api/auth/login').
 * @param {string} method - O método HTTP (ex: 'POST', 'GET').
 * @param {object|null} body - O corpo da requisição (para POST, PUT, etc.).
 * @returns {Promise<any>} - A resposta da API em formato JSON.
 */
export async function apiRequest(endpoint, method, body = null) {
    log(`Iniciando requisição ${method} para ${endpoint}`);
    const headers = { 'Content-Type': 'application/json' };
    if (appState.token) {
        headers['Authorization'] = `Bearer ${appState.token}`;
    }
    
    const options = { method, headers };
    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(endpoint, options);
        if (!response.ok) {
            // Tenta extrair uma mensagem de erro do corpo da resposta
            const errorData = await response.json().catch(() => ({ message: 'Erro desconhecido no servidor.' }));
            throw new Error(errorData.message || `Erro ${response.status}`);
        }
        
        // Retorna null se a resposta não tiver corpo (ex: status 204)
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const result = await response.json();
            log(`Requisição para ${endpoint} bem-sucedida.`, 'success');
            return result;
        }
        return null;

    } catch (error) {
        log(`Falha na requisição para ${endpoint}: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Obtém as chaves de API Gemini disponíveis do estado da aplicação.
 * @returns {string[]} - Um array de chaves de API válidas.
 */
function getAvailableGeminiKeys() {
    return [
        appState.apiKeys.gemini, 
        appState.apiKeys.gemini_backup1, 
        appState.apiKeys.gemini_backup2
    ].filter(key => key && key.trim() !== '');
}

/**
 * Realiza uma chamada para a API Generativa do Google (Gemini) com rotação de chaves.
 * @param {string} prompt - O prompt a ser enviado para a IA.
 * @param {object|null} schema - O esquema JSON para a resposta (opcional).
 * @returns {Promise<any>} - A resposta da IA, já parseada.
 */
export async function callGenerativeAPI(prompt, schema = null) {
    const availableKeys = getAvailableGeminiKeys();
    if (availableKeys.length === 0) {
        log("Nenhuma chave da API Gemini configurada.", 'error');
        throw new Error("Nenhuma chave da API Gemini encontrada. Adicione nas Configurações.");
    }

    showProgressModal();

    for (let i = 0; i < availableKeys.length; i++) {
        const currentKeyIndex = appState.currentGeminiKeyIndex % availableKeys.length;
        const currentKey = availableKeys[currentKeyIndex];
        log(`Tentando chamada à API Gemini com a chave #${currentKeyIndex + 1}`);

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${currentKey}`;
        const finalPrompt = `Responda em texto puro (plain text), sem usar formatação markdown. Use codificação UTF-8. ${prompt}`;
        
        let payload = { contents: [{ role: "user", parts: [{ text: finalPrompt }] }] };
        if (schema) {
            payload.generationConfig = { response_mime_type: "application/json", response_schema: schema };
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // Timeout de 60 segundos

            const response = await fetch(apiUrl, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify(payload), 
                signal: controller.signal 
            });
            
            clearTimeout(timeoutId);

            if (response.ok) {
                const result = await response.json();
                if (result.candidates?.[0]?.content?.parts?.[0]) {
                    log('API Gemini respondeu com sucesso.', 'success');
                    hideProgressModal();
                    const text = result.candidates[0].content.parts[0].text;
                    try {
                        return schema ? JSON.parse(text) : { text };
                    } catch (jsonError) {
                        log(`Erro ao parsear JSON da API: ${jsonError.message}`, 'error');
                        log(`Resposta de texto recebida: ${text}`, 'info');
                        throw new Error("A IA retornou uma resposta em formato inesperado. Tente novamente.");
                    }
                }
                if (result.candidates?.[0]?.finishReason === 'SAFETY') {
                    throw new Error("A resposta foi bloqueada por políticas de segurança do Google.");
                }
                throw new Error("Resposta da API Gemini inválida ou vazia.");
            }

            // Se a cota foi excedida ou houve erro no servidor, tenta a próxima chave
            if (response.status === 429 || response.status >= 500) {
                log(`Erro ${response.status} com a chave #${currentKeyIndex + 1}. Tentando a próxima...`, 'warn');
                appState.currentGeminiKeyIndex++;
                continue; // Pula para a próxima iteração do loop
            }

            // Para outros erros (ex: 400 Bad Request), lança o erro imediatamente
            const errorBody = await response.json();
            throw new Error(`Erro na API Gemini: ${errorBody.error?.message || 'Verifique sua chave de API.'}`);

        } catch (error) {
            log(`Falha na chamada da API com a chave #${currentKeyIndex + 1}: ${error.message}`, 'error');
            appState.currentGeminiKeyIndex++;
            // Se for o último loop, lança o erro final
            if (i === availableKeys.length - 1) {
                hideProgressModal();
                throw error;
            }
        }
    }

    // Se o loop terminar sem sucesso
    hideProgressModal();
    throw new Error("Todas as chaves da API Gemini falharam.");
}
