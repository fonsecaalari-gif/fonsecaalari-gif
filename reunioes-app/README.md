# Notas de Reunião — mini app de gravação + anotações automáticas

Mini app web (PWA) que funciona **no celular** (instalável na tela inicial) e **no computador**.

## O que faz

- Grava o áudio da reunião pelo microfone (MediaRecorder).
- Transcreve a fala **ao vivo** no navegador (Web Speech API), com escolha de idioma.
- Gera **anotações automáticas** durante a reunião: resumo (frases mais relevantes), tópicos (palavras mais frequentes) e itens de ação (frases com "vou", "precisamos entregar", "deadline", etc.).
- Salva cada reunião localmente (IndexedDB) junto com o áudio: ouvir, baixar áudio, exportar `.md`, copiar ou compartilhar.
- No computador: layout em duas colunas e atalho **Ctrl+Enter** para iniciar/parar a gravação.
- Funciona offline depois de instalado (service worker).

## Como rodar

O microfone exige **contexto seguro** (HTTPS ou `localhost`):

```bash
cd reunioes-app
python3 -m http.server 8000
# abra http://localhost:8000 no computador
```

Para usar **no celular**, publique em qualquer hospedagem gratuita com HTTPS, por exemplo:

- **GitHub Pages**: suba a pasta `reunioes-app` para um repositório e ative o Pages (Settings → Pages).
- **Netlify / Vercel**: arraste a pasta no painel ou use `npx netlify deploy`.
- Alternativa local no Android com cabo USB: `adb reverse tcp:8000 tcp:8000` e abra `http://localhost:8000` no Chrome do celular.

Depois de publicar, no celular abra o link e use **“Adicionar à tela inicial”** para instalar como app.

## Privacidade

Todo o processamento (gravação, transcrição e resumo) acontece **localmente no aparelho**. Nada é enviado para servidores.

## Compatibilidade

- **Transcrição ao vivo**: Chrome/Edge no Android, Windows, macOS e Linux (usa o serviço de voz do navegador; no Android o reconhecimento pode exigir conexão na primeira vez).
- **Firefox e Safari (incluindo iPhone)**: a gravação de áudio funciona, mas a transcrição automática não está disponível nesses navegadores — as anotações são geradas a partir do texto transcrito, então nesse caso o áudio fica salvo para você transcrever depois.
- No computador, abra em `http://localhost:8000` (localhost conta como contexto seguro).

## Estrutura

```
reunioes-app/
├── index.html            # interface (responsiva: 1 coluna no celular, 2 no desktop)
├── styles.css            # tema escuro, botões grandes para toque
├── app.js                # gravação, transcrição, resumo automático, IndexedDB
├── manifest.webmanifest  # instalação como PWA
├── sw.js                 # cache offline
├── icon.svg / icon-*.png # ícones do app
└── README.md
```
