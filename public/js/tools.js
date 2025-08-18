// tools.js - Definição das ferramentas e seus handlers

import { apiRequest, callGenerativeAPI } from './api.js';
import { appState } from './state.js';
import { createCopyButton, getScoreColor, getScoreTextColor, renderScoreCard, hideProgressModal } from './ui.js';
import { log } from './utils.js';

let trendsChartInstance = null;

// --- Definição da Estrutura das Ferramentas ---
export const tools = {
    "pesquisa-e-estrategia": {
        isCategory: true,
        label: "PESQUISA E ESTRATÉGIA"
    },
    "niche-finder": { 
        title: "Localizador de Nichos", 
        desc: "Encontre nichos promissores com base em palavras-chave.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><input type="text" id="niche-keyword" class="w-full px-4 py-3 bg-slate-100 border rounded-lg" placeholder="Palavra-chave (ex: culinária vegana)"><select id="niche-country" class="w-full px-4 py-3 bg-slate-100 border rounded-lg"><option value="BR">Brasil</option><option value="US">EUA</option><option value="PT">Portugal</option></select></div><button id="generate-niches" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">🔎 Encontrar Nichos</button><div id="output" class="mt-6"></div></div>` 
    },
    "subniche-finder": { 
        title: "Explorador de Subnichos", 
        desc: "Descubra subnichos inexplorados a partir de um nicho principal.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><input type="text" id="main-niche" class="w-full px-4 py-3 bg-slate-100 border rounded-lg mb-4" placeholder="Nicho principal (ex: finanças pessoais)"><button id="find-subniches" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">💎 Explorar Subnichos</button><div id="output" class="mt-6"></div></div>` 
    },
    "niche-analysis": { 
        title: "Análise de Nicho", 
        desc: "Analise o potencial, concorrência e tendências de um nicho específico.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"><input type="text" id="analysis-niche" class="w-full px-4 py-3 bg-slate-100 border rounded-lg" placeholder="Nicho a ser analisado"><select id="analysis-country" class="w-full px-4 py-3 bg-slate-100 border rounded-lg"><option value="BR">Brasil</option><option value="US">EUA</option></select></div><button id="analyze-niche" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">📊 Analisar Nicho</button><div id="output" class="mt-6"></div></div>` 
    },
    "video-optimizer": { 
        title: "Analisador de Vídeo", 
        desc: "Otimize títulos, descrições e tags a partir de uma URL do YouTube.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><input type="url" id="video-url" class="w-full px-4 py-3 bg-slate-100 border rounded-lg mb-4" placeholder="https://www.youtube.com/watch?v=..."><button id="analyze-video" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">🚀 Otimizar Vídeo</button><div id="output" class="mt-6"></div></div>` 
    },
    "comment-analyzer": { 
        title: "Análise de Comentários", 
        desc: "Entenda o sentimento do público e extraia ideias dos comentários de um vídeo.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><input type="url" id="comment-video-url" class="w-full px-4 py-3 bg-slate-100 border rounded-lg mb-4" placeholder="URL do vídeo para analisar os comentários"><button id="analyze-comments" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">💬 Analisar Comentários</button><div id="output" class="mt-6"></div></div>` 
    },
    "criacao-e-conteudo": {
        isCategory: true,
        label: "CRIAÇÃO E CONTEÚDO"
    },
    "title-structures": { 
        title: "Estruturas de Títulos", 
        desc: "Gere estruturas de títulos virais com alto potencial de clique.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><input type="text" id="structure-topic" class="w-full px-4 py-3 bg-slate-100 border rounded-lg mb-4" placeholder="Tópico. Ex: Produtividade"><button id="generate-structures" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">🏗️ Gerar Estruturas</button><div id="output" class="mt-6 space-y-4"></div></div>` 
    },
    "thumbnail-prompts": { 
        title: "Prompts de Thumbnail", 
        desc: "Gere prompts otimizados para IAs de imagem (Midjourney, DALL-E 3, etc.).",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><div class="space-y-4"><input type="text" id="thumb-title" class="w-full px-4 py-3 bg-slate-100 border rounded-lg" placeholder="Título do Vídeo"><select id="thumb-platform" class="w-full px-4 py-3 bg-slate-100 border rounded-lg"><option value="Midjourney">Midjourney</option><option value="Leonardo.AI">Leonardo.AI</option><option value="DALL-E 3">DALL-E 3</option></select></div><button id="generate-prompts" class="w-full mt-4 bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">🎨 Gerar Prompts</button><div id="output" class="mt-6 space-y-4"></div></div>` 
    },
    "text-splitter": {
        title: "Divisor de Textos",
        desc: "Divida textos longos em partes menores com contagem de caracteres.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><textarea id="text-to-split" class="w-full px-4 py-3 bg-slate-100 border rounded-lg mb-4" rows="8" placeholder="Cole seu texto longo aqui..."></textarea><div class="grid grid-cols-2 gap-4 mb-4"><input type="number" id="split-length" value="2000" class="w-full px-4 py-3 bg-slate-100 border rounded-lg" placeholder="Caracteres por parte"><div><button id="split-text-btn" class="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">✂️ Dividir Texto</button></div></div><div id="output" class="mt-6 space-y-4"></div></div>`
    },
    "srt-converter": {
        title: "Conversor de SRT",
        desc: "Converta arquivos de legenda (.srt) para texto puro.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border"><label for="srt-file-input" class="block text-sm font-medium text-slate-700 mb-2">Selecione o arquivo .SRT</label><input type="file" id="srt-file-input" accept=".srt" class="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"/><div id="output" class="mt-6"></div></div>`
    },
    "otimizacao-e-gestao": {
        isCategory: true,
        label: "OTIMIZAÇÃO E GESTÃO"
    },
    "channel-organizer": { 
        title: "Organizador de Canais", 
        desc: "Adicione e gerencie as informações e estratégias dos seus canais.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border mb-6"><h3 class="text-lg font-semibold mb-4">Adicionar Novo Canal</h3><form id="channel-form" class="grid grid-cols-1 md:grid-cols-2 gap-4"><input type="text" id="org-channel-name" class="px-4 py-3 bg-slate-100 border rounded-lg" placeholder="Nome do Canal" required><input type="text" id="org-channel-id" class="px-4 py-3 bg-slate-100 border rounded-lg" placeholder="ID do Canal (UC...)" required><input type="text" id="org-channel-niche" class="px-4 py-3 bg-slate-100 border rounded-lg" placeholder="Nicho Principal" required><select id="org-channel-lang" class="px-4 py-3 bg-slate-100 border rounded-lg"><option value="pt-BR">Português (BR)</option><option value="en-US">Inglês (US)</option></select><button type="submit" class="md:col-span-2 w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg">Adicionar Canal</button></form></div><div id="organizer-output" class="space-y-4"></div>` 
    },
    "settings": { 
        title: "Configurações", 
        desc: "Gerencie suas chaves de API para conectar a aplicação aos serviços.",
        content: `<div class="bg-white p-6 rounded-xl shadow-sm border space-y-6"><div><h3 class="text-lg font-semibold">Chaves de API</h3><div class="space-y-4 mt-2"><div><label class="block text-sm font-medium text-slate-700">Gemini API Key (Principal)</label><input type="password" id="gemini-key" class="mt-1 block w-full px-3 py-2 border rounded-md"><a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-xs text-indigo-600 hover:underline">Obter chave do Google AI Studio</a></div><div><label class="block text-sm font-medium text-slate-700">Gemini API Key (Reserva 1)</label><input type="password" id="gemini-key-backup1" class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div><label class="block text-sm font-medium text-slate-700">Gemini API Key (Reserva 2)</label><input type="password" id="gemini-key-backup2" class="mt-1 block w-full px-3 py-2 border rounded-md"></div><div><label class="block text-sm font-medium text-slate-700">OpenRouter API Key (Opcional)</label><input type="password" id="openrouter-key" class="mt-1 block w-full px-3 py-2 border rounded-md"><a href="https://openrouter.ai/keys" target="_blank" class="text-xs text-indigo-600 hover:underline">Obter chave da OpenRouter</a></div><div><label class="block text-sm font-medium text-slate-700">Google API Key (YouTube Data)</label><input type="password" id="google-api-key" class="mt-1 block w-full px-3 py-2 border rounded-md"><p class="text-xs text-slate-500 mt-1">Usada para buscar dados de canais e vídeos do YouTube.</p><a href="https://console.cloud.google.com/apis/credentials" target="_blank" class="text-xs text-indigo-600 hover:underline">Obter chave do Google Cloud (com YouTube Data API v3 ativada)</a></div></div></div><button id="save-settings" class="w-full bg-indigo-800 text-white font-bold py-3 px-4 rounded-lg mt-6">Salvar Configurações</button><div id="settings-feedback" class="mt-4 min-h-[20px]"></div></div>` 
    },
};

// --- Handlers para as Ações das Ferramentas ---
export const toolHandlers = {
    'generate-niches': async (output) => {
        try {
            const keyword = document.getElementById('niche-keyword').value || 'tópicos em alta';
            const country = document.getElementById('niche-country').value;
            const prompt = `Como um especialista em YouTube, gere 3 nichos promissores sobre '${keyword}' para o país ${country}. Para cada nicho, atribua pontuações realistas de 0 a 100 para "Potencial", "Concorrência" (onde 0 é baixo e 100 é alto), e "Volume de Busca". Forneça também uma breve descrição e 3 ideias de subnichos.`;
            const schema = { type: "ARRAY", items: { type: "OBJECT", properties: { niche_name: { type: "STRING" }, description: { type: "STRING" }, subniches: { type: "ARRAY", items: { type: "STRING" } }, scores: { type: "OBJECT", properties: { Potencial: { type: "NUMBER" }, Concorrência: { type: "NUMBER" }, "Volume de Busca": { type: "NUMBER" } } } } } };
            const result = await callGenerativeAPI(prompt, schema);
            
            const html = result.map(item => {
                const concorrenciaInvertida = 100 - (item.scores?.Concorrência ?? 50);
                const scoreGeral = Math.round(((item.scores.Potencial || 0) * 2 + concorrenciaInvertida + (item.scores['Volume de Busca'] || 0)) / 4);
                return `<div class="bg-slate-50 p-4 rounded-lg mb-4 border"><div class="flex flex-col md:flex-row gap-6"><div class="flex-1"><h3 class="font-bold text-lg text-indigo-700 mb-2">${item.niche_name}</h3><p class="text-sm text-slate-700 mb-3">${item.description}</p><p class="text-sm"><strong class="font-semibold">Subnichos Sugeridos:</strong> ${(item.subniches || []).join(', ')}</p></div>${renderScoreCard('Análise Rápida', scoreGeral, { 'Potencial': item.scores.Potencial, 'Concorrência (menor é melhor)': concorrenciaInvertida, 'Volume de Busca': item.scores['Volume de Busca'] })}</div></div>`;
            }).join('');
            output.innerHTML = html;
        } catch(error) { output.innerHTML = `<p class="text-red-500">Erro: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'find-subniches': async (output) => {
        try {
            const mainNiche = document.getElementById('main-niche').value.trim();
            if (!mainNiche) {
                output.innerHTML = `<p class="text-red-500">Por favor, insira um nicho principal.</p>`;
                return;
            }
            const prompt = `Para o nicho principal de "${mainNiche}", gere 3 subnichos criativos e pouco explorados. Para cada um, forneça uma pontuação de 0 a 100 para "Potencial", "Originalidade", e "Concorrência" (onde 0 é baixo), e 3 ideias de vídeo.`;
            const schema = { type: "ARRAY", items: { type: "OBJECT", properties: { subniche_name: { type: "STRING" }, video_ideas: { type: "ARRAY", items: { type: "STRING" } }, scores: { type: "OBJECT", properties: { Potencial: { type: "NUMBER" }, Originalidade: { type: "NUMBER" }, Concorrência: { type: "NUMBER" } } } } } };
            const result = await callGenerativeAPI(prompt, schema);
            const html = result.map(item => {
                 const scoreGeral = Math.round(((item.scores.Potencial || 0) + (item.scores.Originalidade || 0) + (100 - (item.scores.Concorrência || 50))) / 3);
                 return `<div class="bg-slate-50 p-4 rounded-lg mb-4 border"><div class="flex flex-col md:flex-row gap-6"><div class="flex-1"><h3 class="font-bold text-lg text-indigo-700 mb-2">${item.subniche_name}</h3><p class="text-sm"><strong class="font-semibold">Ideias de Vídeo:</strong> ${(item.video_ideas || []).join('; ')}</p></div>${renderScoreCard('Análise Rápida', scoreGeral, { 'Potencial': item.scores.Potencial, 'Originalidade': item.scores.Originalidade, 'Concorrência (menor é melhor)': 100 - item.scores.Concorrência })}</div></div>`;
            }).join('');
            output.innerHTML = html;
        } catch (error) { output.innerHTML = `<p class="text-red-500">Erro: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'analyze-niche': async (output) => {
        const niche = document.getElementById('analysis-niche').value.trim();
        const country = document.getElementById('analysis-country').value;
        if (!niche) { output.innerHTML = `<p class="text-red-500">Insira um nicho para análise.</p>`; return; }
        
        try {
            const [trendsData] = await Promise.all([
                apiRequest(`/api/trends/${encodeURIComponent(niche)}/${country}`, 'GET')
            ]);
            
            let avgInterest = 50, trendsChartHtml = '<p class="text-xs text-slate-500 mt-2">Dados de tendência indisponíveis.</p>', labels = [], values = [];
            if (trendsData?.default?.timelineData?.length > 0) {
                const timelineData = trendsData.default.timelineData;
                labels = timelineData.map(d => new Date(d.time * 1000).toLocaleDateString('pt-BR', { month: 'short' }));
                values = timelineData.map(d => d.value[0]);
                avgInterest = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
                trendsChartHtml = `<div class="h-64 relative"><canvas id="trends-chart"></canvas></div>`;
            }

            const prompt = `Faça uma análise completa do nicho de "${niche}" para o YouTube. Considere a média de interesse de busca de ${avgInterest}/100. Forneça uma análise de público-alvo, potencial de monetização, nível de concorrência (texto: Baixa, Média, Alta), e uma pontuação geral de 0 a 100 para o nicho.`;
            const schema = { type: "OBJECT", properties: { audience_analysis: { type: "STRING" }, monetization_potential: { type: "STRING" }, competition_level: { type: "STRING" }, overall_score: { type: "NUMBER" }, final_recommendation: { type: "STRING" } } };
            const result = await callGenerativeAPI(prompt, schema);
            
            output.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 bg-white p-6 rounded-lg border">
                        <h3 class="font-bold text-xl mb-4">Análise Qualitativa</h3>
                        <div class="space-y-4">
                            <div><h4 class="font-semibold text-slate-800">Público-Alvo</h4><p class="text-sm">${result.audience_analysis}</p></div>
                            <div><h4 class="font-semibold text-slate-800">Potencial de Monetização</h4><p class="text-sm">${result.monetization_potential}</p></div>
                            <div><h4 class="font-semibold text-slate-800">Recomendação Final</h4><p class="text-sm">${result.final_recommendation}</p></div>
                        </div>
                    </div>
                    <div class="space-y-6">
                        ${renderScoreCard('Pontuação Geral', result.overall_score, { 'Nível de Concorrência': result.competition_level, 'Interesse de Busca': `${avgInterest}/100` })}
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold text-slate-800 mb-2">Tendência (12 meses)</h4>
                            ${trendsChartHtml}
                        </div>
                    </div>
                </div>`;
            
            if (values.length > 0) {
                const ctx = document.getElementById('trends-chart').getContext('2d');
                if (trendsChartInstance) trendsChartInstance.destroy();
                trendsChartInstance = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: `Interesse em "${niche}"`, data: values, borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.1)', fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
            }
        } catch (error) { output.innerHTML = `<p class="text-red-500">Erro ao analisar o nicho: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'video-optimizer': async (output) => {
        const url = document.getElementById('video-url').value.trim();
        const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
        if (!videoIdMatch) { output.innerHTML = `<p class="text-red-500">URL inválida.</p>`; return; }
        const videoId = videoIdMatch[1];
        
        try {
            const videoData = await apiRequest(`/api/youtube/video-details/${videoId}`, 'GET');
            const { title, description, tags } = videoData;
            const prompt = `Analise os metadados do vídeo com título "${title}" e descrição "${description}". Dê uma pontuação de 0 a 100 para Título, Descrição e Tags. Depois, crie 3 novos títulos, 1 nova descrição otimizada e 1 novo conjunto de tags.`;
            const schema = { type: "OBJECT", properties: { analysis: { type: "OBJECT", properties: { title_score: { type: "NUMBER" }, description_score: { type: "NUMBER" }, tags_score: { type: "NUMBER" } } }, optimizations: { type: "OBJECT", properties: { new_titles: { type: "ARRAY", items: { type: "STRING" } }, new_description: { type: "STRING" }, new_tags: { type: "ARRAY", items: { type: "STRING" } } } } } };
            const result = await callGenerativeAPI(prompt, schema);
            
            const overallScore = Math.round((result.analysis.title_score + result.analysis.description_score + result.analysis.tags_score) / 3);

            output.innerHTML = `
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div class="lg:col-span-2 space-y-6">
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold mb-2">Títulos Sugeridos</h4>
                            <div class="space-y-2">${result.optimizations.new_titles.map(t => `<div class="bg-slate-100 p-2 rounded flex justify-between items-center text-sm"><span>${t}</span>${createCopyButton(t)}</div>`).join('')}</div>
                        </div>
                        <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold mb-2 flex justify-between items-center"><span>Descrição Otimizada</span>${createCopyButton(result.optimizations.new_description)}</h4>
                            <p class="text-sm whitespace-pre-wrap">${result.optimizations.new_description}</p>
                        </div>
                         <div class="bg-white p-4 rounded-lg border">
                            <h4 class="font-semibold mb-2 flex justify-between items-center"><span>Tags Otimizadas</span>${createCopyButton(result.optimizations.new_tags.join(', '))}</h4>
                            <p class="text-sm text-slate-600">${result.optimizations.new_tags.join(', ')}</p>
                        </div>
                    </div>
                    <div>
                        ${renderScoreCard('Análise Original', overallScore, { 'Título': result.analysis.title_score, 'Descrição': result.analysis.description_score, 'Tags': result.analysis.tags_score })}
                    </div>
                </div>`;
        } catch (error) { output.innerHTML = `<p class="text-red-500">Erro: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'comment-analyzer': async (output) => {
        const url = document.getElementById('comment-video-url').value.trim();
        const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
        if (!videoIdMatch) { output.innerHTML = `<p class="text-red-500">URL inválida.</p>`; return; }
        const videoId = videoIdMatch[1];
        
        try {
            const comments = await apiRequest(`/api/youtube/video-comments/${videoId}`, 'GET');
            if (!comments || comments.length === 0) {
                output.innerHTML = `<p class="text-yellow-600">Nenhum comentário encontrado ou os comentários estão desativados para este vídeo.</p>`;
                hideProgressModal();
                return;
            }
            const prompt = `Analise os seguintes comentários de um vídeo: "${comments.slice(0, 50).join('; ')}". Resuma o sentimento geral (Positivo, Negativo ou Misto), identifique os 3 principais tópicos discutidos e extraia 3 perguntas ou sugestões de conteúdo feitas pelos usuários.`;
            const schema = { type: "OBJECT", properties: { sentiment: { type: "STRING" }, main_topics: { type: "ARRAY", items: { type: "STRING" } }, content_ideas: { type: "ARRAY", items: { type: "STRING" } } } };
            const result = await callGenerativeAPI(prompt, schema);

            const sentimentColor = result.sentiment === 'Positivo' ? 'text-green-600' : result.sentiment === 'Negativo' ? 'text-red-600' : 'text-yellow-600';

            output.innerHTML = `
                <div class="bg-white p-6 rounded-lg border space-y-4">
                    <div><h4 class="font-semibold">Sentimento Geral: <span class="font-bold ${sentimentColor}">${result.sentiment}</span></h4></div>
                    <div><h4 class="font-semibold">Principais Tópicos Discutidos:</h4><ul class="list-disc list-inside text-sm">${result.main_topics.map(t => `<li>${t}</li>`).join('')}</ul></div>
                    <div><h4 class="font-semibold">Ideias e Sugestões do Público:</h4><ul class="list-disc list-inside text-sm">${result.content_ideas.map(t => `<li>${t}</li>`).join('')}</ul></div>
                </div>`;
        } catch (error) { output.innerHTML = `<p class="text-red-500">Erro: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'generate-structures': async (output) => {
        try {
            const topic = document.getElementById('structure-topic').value.trim();
            if (!topic) { output.innerHTML = `<p class="text-red-500">Insira um tópico.</p>`; return; }
            const prompt = `Gere 5 estruturas de títulos virais sobre "${topic}". Para cada uma, explique brevemente por que funciona (gatilho mental, curiosidade, etc.).`;
            const schema = { type: "ARRAY", items: { type: "OBJECT", properties: { structure: { type: "STRING" }, explanation: { type: "STRING" } } } };
            const result = await callGenerativeAPI(prompt, schema);
            const html = result.map(item => `
                <div class="bg-slate-100 p-4 rounded-lg"><h4 class="font-semibold text-indigo-600 mb-1">${item.structure}</h4><p class="text-sm text-slate-700">${item.explanation}</p></div>
            `).join('');
            output.innerHTML = html;
        } catch (error) { output.innerHTML = `<p class="text-red-500">Erro: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'generate-prompts': async (output) => {
        const title = document.getElementById('thumb-title').value.trim();
        const platform = document.getElementById('thumb-platform').value;
        if (!title) { output.innerHTML = `<p class="text-red-500">Insira um título.</p>`; return; }
        try {
            const prompt = `Gere 3 prompts para IA de imagem (${platform}) para uma thumbnail de YouTube com o título "${title}". Os prompts devem ser descritivos, focados em alto CTR e visualmente atraentes.`;
            const schema = { type: "ARRAY", items: { type: "STRING" } };
            const result = await callGenerativeAPI(prompt, schema);
            const html = result.map(p => `
                <div class="bg-slate-100 p-3 rounded-lg flex justify-between items-center"><p class="text-sm flex-1">${p}</p>${createCopyButton(p)}</div>
            `).join('');
            output.innerHTML = html;
        } catch (error) { output.innerHTML = `<p class="text-red-500">Erro: ${error.message}</p>`; }
        finally { hideProgressModal(); }
    },
    'split-text-btn': (output) => {
        const text = document.getElementById('text-to-split').value;
        const length = parseInt(document.getElementById('split-length').value, 10);
        if (!text || !length || length <= 0) {
            output.innerHTML = `<p class="text-red-500">Por favor, insira o texto e um tamanho de divisão válido.</p>`;
            return;
        }
        const parts = [];
        for (let i = 0; i < text.length; i += length) {
            parts.push(text.substring(i, i + length));
        }
        output.innerHTML = parts.map((part, index) => `
            <div class="bg-slate-100 p-4 rounded-lg">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="font-semibold text-slate-700">Parte ${index + 1} (${part.length} caracteres)</h4>
                    ${createCopyButton(part)}
                </div>
                <p class="text-sm text-slate-800 whitespace-pre-wrap">${part}</p>
            </div>
        `).join('');
    },
    'srt-file-input': (output) => {
        const fileInput = document.getElementById('srt-file-input');
        const file = fileInput.files[0];
        if (!file) {
            output.innerHTML = `<p class="text-red-500">Nenhum arquivo selecionado.</p>`;
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const srtContent = event.target.result;
            // Regex para remover timestamps, números de legenda e tags HTML
            const plainText = srtContent
                .replace(/(\d{2}:\d{2}:\d{2},\d{3}\s-->\s\d{2}:\d{2}:\d{2},\d{3})/g, '')
                .replace(/^\d+\s*$/gm, '')
                .replace(/<[^>]*>/g, '')
                .replace(/(\r\n|\n|\r)/gm, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            output.innerHTML = `
                <div class="bg-slate-100 p-4 rounded-lg">
                    <div class="flex justify-between items-center mb-2">
                        <h4 class="font-semibold text-slate-700">Texto Convertido</h4>
                        ${createCopyButton(plainText)}
                    </div>
                    <p class="text-sm text-slate-800">${plainText}</p>
                </div>`;
        };
        reader.readAsText(file);
    },
    'save-settings': async () => {
        const feedbackEl = document.getElementById('settings-feedback');
        appState.apiKeys.gemini = document.getElementById('gemini-key').value.trim();
        appState.apiKeys.gemini_backup1 = document.getElementById('gemini-key-backup1').value.trim();
        appState.apiKeys.gemini_backup2 = document.getElementById('gemini-key-backup2').value.trim();
        appState.apiKeys.openrouter = document.getElementById('openrouter-key').value.trim();
        appState.apiKeys.google_api = document.getElementById('google-api-key').value.trim();
        
        feedbackEl.textContent = 'Salvando...';
        feedbackEl.className = 'text-slate-600 text-sm mt-4';
        try {
            await apiRequest(`/api/settings/${appState.currentUser.id}`, 'POST', { settings: appState.apiKeys });
            feedbackEl.textContent = 'Configurações salvas com sucesso!';
            feedbackEl.className = 'text-green-600 text-sm mt-4';
        } catch (error) {
            feedbackEl.textContent = `Erro ao salvar: ${error.message}`;
            feedbackEl.className = 'text-red-500 text-sm mt-4';
        }
        setTimeout(() => feedbackEl.textContent = '', 3000);
    },
    'channel-form': async (e) => {
        e.preventDefault();
        const form = e.target;
        const newChannel = {
            id: form.querySelector('#org-channel-id').value,
            name: form.querySelector('#org-channel-name').value,
            niche: form.querySelector('#org-channel-niche').value,
            lang: form.querySelector('#org-channel-lang').value,
        };
        appState.userChannels.push(newChannel);
        try {
            await apiRequest(`/api/settings/${appState.currentUser.id}`, 'POST', { settings: { userChannels: appState.userChannels } });
            renderChannels();
            form.reset();
        } catch (error) {
            log(`Erro ao salvar novo canal: ${error.message}`, 'error');
            // Remove o canal adicionado localmente se a API falhar
            appState.userChannels.pop();
        }
    }
};

// --- Funções de Renderização Específicas ---
export function renderChannels() {
    const output = document.getElementById('organizer-output');
    if (!output) return;
    if (appState.userChannels.length === 0) {
        output.innerHTML = `<p class="text-center text-slate-500 py-8">Nenhum canal adicionado.</p>`;
        return;
    }
    output.innerHTML = appState.userChannels.map((ch, index) => `
        <div class="bg-white p-4 rounded-lg shadow-sm border flex justify-between items-center">
            <div>
                <h3 class="text-lg font-semibold">${ch.name}</h3>
                <p class="text-sm text-slate-500 break-all">${ch.id}</p>
            </div>
            <button class="remove-channel text-red-500 hover:text-red-700 text-2xl" data-index="${index}" title="Remover Canal">&times;</button>
        </div>`
    ).join('');

    // Adiciona listeners aos botões de remoção
    output.querySelectorAll('.remove-channel').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const index = parseInt(e.target.dataset.index, 10);
            appState.userChannels.splice(index, 1);
            try {
                await apiRequest(`/api/settings/${appState.currentUser.id}`, 'POST', { settings: { userChannels: appState.userChannels } });
                renderChannels();
            } catch (error) {
                log(`Erro ao remover canal: ${error.message}`, 'error');
            }
        });
    });
}
