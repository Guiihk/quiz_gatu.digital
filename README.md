# Agendador da gatu.digital

Painel e editor de quiz em Next.js e TypeScript, com acesso administrativo e rascunho persistido localmente no SQLite.

## GitHub e VPS

O repositório contém o código, o `Dockerfile`, a configuração do Compose e um workflow do GitHub Actions. O workflow executa os testes e verifica o contêiner em Linux. A implantação e a conexão com a VPS são manuais.

### Subir na VPS com Docker Compose

1. Na VPS Linux com Docker e Compose, clone o repositório e execute `cp .env.example .env.vps`. Preencha apenas na VPS as credenciais das integrações que for usar. O `.env.vps` fica fora do Git e da imagem. Se usar Google Agenda, configure `GOOGLE_CALENDAR_REDIRECT_URI` com o domínio final, por exemplo `https://agendador.seudominio.com/api/google-agenda/callback`, e cadastre o mesmo endereço no Google Cloud.
2. Configure o HTTPS do domínio no seu proxy reverso e encaminhe para `http://127.0.0.1:3020` na VPS. Preserve o `Host` original e encaminhe `X-Forwarded-Proto` e `X-Forwarded-Host`. O cookie administrativo de produção usa HTTPS. Se seu painel de hospedagem já fornece um proxy dentro da rede de contêineres, use o `Dockerfile`, a porta interna `3020` e um volume persistente gravável pelo usuário do contêiner em `/app/data`.
3. Inicie o aplicativo e, para um banco novo, crie o administrador pelo terminal. A senha é solicitada sem aparecer na tela.

```sh
docker compose --env-file .env.vps up -d --build --wait
docker compose --env-file .env.vps exec agendador node scripts/create-admin.mjs voce@empresa.com
```

4. Entre pelo domínio HTTPS e confira os links publicados. Para atualizar depois de trazer o código novo do GitHub, rode novamente o comando `up`. O volume `agendador-data` guarda o SQLite e a chave do token do Meta. Preserve esse volume em atualizações e backups.

Se for migrar o banco local, faça uma cópia consistente com o Agendador parado, inclua a chave `<arquivo-do-banco>.meta-key` se existir e restaure no volume antes de ativar o serviço. O administrador existente já vem no banco. Para um contêiner configurado fora do Compose, mantenha `AGENDADOR_DB_PATH=/app/data/agendador.sqlite` e execute uma instância do Agendador por banco.

## Executar

```sh
npm install
npm run dev
```

Use Node.js 24. Abra http://127.0.0.1:3020 e crie a conta administrativa na primeira visita. Se houver um rascunho anterior nesse navegador, use **Abrir rascunho anterior**, revise e clique em **Salvar rascunho**. O banco fica em `%LOCALAPPDATA%\gatu-agendador\agendador.sqlite` no Windows ou em `$XDG_DATA_HOME/gatu-agendador/agendador.sqlite` no Linux (por padrão, `$HOME/.local/share/...`).

Para validar: `npm run typecheck`, `npm test` e `npm run build`.

## O que funciona nesta etapa

- Navegação do painel e editor de sete telas com uma saída alternativa.
- Edição de abertura, imagem de logotipo, cor, oferta alternativa e nome/duração da reunião.
- Login para um administrador e rascunho salvo no SQLite do servidor local, com proteção contra salvamento sobre uma versão mais recente em outra aba.
- Prévia isolada com validação de contato e encaminhamento por qualificação.
- Respostas de teste ficam somente na memória e são descartadas ao fechar a prévia.

Em **Quizzes**, clique em **Novo quiz** para criar outra página. Cada quiz tem seu próprio rascunho, conteúdo, regras, nome e duração da reunião e aba **Respostas**. Para liberar uma página, salve as alterações e clique em **Publicar quiz**. O caminho usa o nome salvo, por exemplo, `/diagnostico-de-marketing`. Se o endereço já estiver ocupado, o sistema acrescenta um sufixo numérico. Publicações posteriores atualizam o conteúdo no mesmo endereço. Quem tem o link pode responder sem login.

Durante o desenvolvimento, os links rodam em localhost. O domínio da VPS será usado após o deploy. Na aba **Agendamentos**, ative os dias e horários, ajuste a antecedência e salve. Os quizzes compartilham a agenda e o CRM. Uma reserva feita por qualquer página ocupa o horário para as demais. A duração vem da versão publicada de cada quiz. Com todos os dias desativados, os quizzes coletam somente o contato.

### Conectar o Google Agenda localmente

No Google Cloud, habilite a Google Calendar API e crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre exatamente `http://127.0.0.1:3020/api/google-agenda/callback` como URI de redirecionamento. Se o consentimento estiver em teste, adicione a conta Google usada pelo organizador aos usuários de teste. Copie `.env.example` para `.env.local`, preencha o ID e o segredo, reinicie o app e abra **Agendamentos → Conectar Google Agenda** em `http://127.0.0.1:3020`.

Quando conectado, o calendário principal é consultado para listar horários e antes de cada reserva. A reunião é confirmada no SQLite e enviada ao Google como evento do organizador. Se a gravação no Google falhar, a reunião mantém a reserva local e o painel permite sincronizar novamente. A consulta de conflitos e a criação do evento são operações separadas na API do Google. Links do Meet ficam para outra etapa.

### Convite de confirmação pelo Google Agenda

Com o Google Agenda conectado, o Agendador adiciona o e-mail informado na reserva como convidado do mesmo evento e solicita ao Google o envio do convite. Em **Agendamentos → Próximas reuniões**, abra uma reserva para consultar o status e sincronizar novamente se necessário. Eventos antigos que ainda não têm convidado podem receber o convite pelo botão **Enviar convite pelo Google**.

### Acompanhar leads no CRM

O quadro inclui reservas confirmadas, inclusive as anteriores, e começa cada lead em **Agendado**. Arraste o cartão no computador ou abra a ficha e escolha uma etapa. A ficha reúne contato, respostas, horário, anotações e histórico. A origem aparece quando a pessoa abre o quiz com UTMs, por exemplo, `?utm_source=meta&utm_campaign=lancamento`. Respostas sem reserva continuam na aba **Respostas**.

Na ficha do lead, abra **Rastreamento Meta** para consultar os identificadores disponíveis. Com autorização opcional no quiz, novas reservas podem guardar `_fbp`, `_fbc`, `fbclid`, a URL limpa e a identificação do navegador. Um `fbc` pode ser montado a partir do `fbclid` real quando o cookie correspondente não existe.

### Testar a API de Conversões do Meta

1. No Gerenciador de Eventos, selecione a fonte de dados e copie o ID do pixel, um token da API de Conversões e o código de **Testar eventos**.
2. Preencha os dados em **Configurações → Integrações → Meta · API de Conversões** e salve. Ao trocar o pixel, informe o token do novo pixel. Para atualizar só o código de teste, deixe o token em branco para manter o atual.
3. Em **Configurações → Integrações**, confira se aparece **Modo teste** e clique em **Enviar evento de teste**. Busque por `AgendadorTesteConexao` e pelo ID exibido pelo painel em **Testar eventos** no Meta. Esse diagnóstico usa dados fictícios e não cria uma reserva.
4. Para validar o evento de negócio de ponta a ponta, faça uma reserva pelo quiz publicado localmente, marque a autorização opcional e confira o evento `Schedule` em **Testar eventos**. A prévia do editor não gera eventos.

Antes do primeiro salvamento pelo painel, a integração usa as variáveis `META_PIXEL_ID`, `META_CONVERSIONS_ACCESS_TOKEN` e `META_TEST_EVENT_CODE` do ambiente. Depois que a configuração for salva no painel, ela tem prioridade. O token é criptografado no SQLite. Ao migrar a configuração para a VPS, preserve no volume persistente o arquivo de chave `<arquivo-do-banco>.meta-key` ao lado do SQLite.

O servidor envia o evento após a confirmação da reserva com autorização. A API recebe os identificadores disponíveis e o e-mail e o telefone em SHA-256. Cada reserva tem um `event_id` estável nas tentativas de envio. Reservas anteriores à configuração não entram na fila. Em desenvolvimento o código de teste é obrigatório para ativar o envio. Na VPS, retire o código de teste somente quando o envio de produção estiver aprovado.

Para medir um fechamento, salve o **Valor do negócio (R$)** na ficha e mova o card para **Ganho**. Se o valor ainda estiver vazio, o evento `Purchase` entra na fila quando o valor for salvo com o card em **Ganho**. O sistema usa o valor salvo nesse momento em `BRL` e registra uma compra por card. A autorização do quiz precisa incluir vendas. Autorizações anteriores que cobrem somente agendamentos continuam válidas para `Schedule`.

Ao mover um card para **Proposta enviada**, o CRM registra `InitiateCheckout` para o Meta. O evento exige autorização para medir vendas e pode ser enviado mesmo com o valor do negócio em branco. Cada card gera um único evento de proposta, inclusive se voltar a essa etapa mais tarde.

### Avisos de novos agendamentos no navegador

Cada nova reserva confirmada aparece no sino do painel. Para receber o aviso do sistema mesmo com a aba fechada, abra o sino, clique em **Ativar notificações no navegador** e permita as notificações. A ativação vale para o navegador e endereço atuais. Na VPS, use HTTPS, inclua a pasta `public` na imagem e ative novamente no domínio publicado. A entrega com o navegador totalmente fechado depende do navegador e do sistema operacional. O sino mantém os avisos para consulta posterior.

## Regras aprovadas

Uso exclusivo da gatu.digital; uma pessoa recebe as reuniões. Marca sempre em minúsculas.

1. Abertura com logo, headline, subtítulo, suporte e CTA.
2. Nome obrigatório.
3. WhatsApp brasileiro com DDD obrigatório.
4. Instagram da empresa obrigatório.
5. Faturamento: acima de R$ 100 mil; acima de R$ 50 mil até R$ 100 mil; acima de R$ 30 mil até R$ 50 mil; até R$ 30 mil. A última faixa vai direto à oferta alternativa.
6. Investimento mínimo em anúncios de R$ 2.000/mês, excluindo a gestão da gatu.digital. Recusa vai à oferta alternativa.
7. Agenda e coleta de e-mail para confirmação. Apenas leads aprovados nos dois critérios chegam aqui.

Oferta alternativa: estruturação e otimização do Google Meu Negócio. Preço, texto final e link comercial ainda precisam ser definidos pelo usuário. Textos iniciais são editáveis e não representam aprovação de copy.

Duração padrão da reunião: 60 minutos, ajustável nas configurações.

## Sequência de desenvolvimento

1. Painel, editor e prévia do quiz.
2. **Atual:** autenticação administrativa, rascunho e versão publicada no SQLite. Link do quiz na raiz do site com respostas validadas pelo servidor.
3. Disponibilidade semanal, bloqueios por data, antecedência e reservas atômicas no fuso America/Sao_Paulo. Conexão Google Agenda disponível com a configuração OAuth do responsável. Decidir Google Meet com o usuário.
4. Convite de confirmação pelo Google Agenda. Cancelamento e reagendamento com sincronização entram em uma etapa posterior.
5. CRM kanban com leads agendados, respostas, origem e histórico.
6. API de Conversões do Meta com consentimento e evento `Schedule` após a reserva confirmada. Selecionar a fonte de dados e validar o recebimento no Gerenciador de Eventos.
7. Publicação, link público, validação completa e revisão de segurança/privacidade antes de coletar dados reais.

As integrações não devem executar no cliente com segredos. Nunca tratar clique em horário ou abertura do calendário como reserva confirmada.
