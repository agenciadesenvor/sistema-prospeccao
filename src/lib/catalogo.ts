/**
 * Catálogo de integrações: cada provedor, os campos que ele pede e onde achar
 * cada chave. As telas de instalação e de Conexões são montadas daqui; para
 * ligar um provedor novo, basta descrevê-lo aqui e escrever o cliente dele.
 */

export type Campo = {
  id: string;
  rotulo: string;
  /** Guardado cifrado; a tela só mostra os 4 últimos caracteres. */
  secreto?: boolean;
  tipo?: "texto" | "url" | "email" | "booleano" | "lista";
  dica?: string;
  exemplo?: string;
  opcional?: boolean;
};

export type Provedor = {
  id: string;
  nome: string;
  resumo: string;
  /** Onde pegar as chaves. */
  ondePegar?: { texto: string; link: string };
  campos: Campo[];
  /** Precisa rodar um serviço junto (pasta servicos/). */
  servico?: string;
};

export type Grupo = {
  id: GrupoId;
  nome: string;
  pergunta: string;
  /** Um provedor ativo por vez (checkout, WhatsApp) ou um bloco só. */
  multiplo: boolean;
  provedores: Provedor[];
};

export type GrupoId = "checkout" | "whatsapp" | "rastro" | "email";

export const GRUPOS: Grupo[] = [
  {
    id: "checkout",
    nome: "Checkout",
    pergunta: "Onde você recebe os pagamentos?",
    multiplo: true,
    provedores: [
      {
        id: "mercadopago",
        nome: "Mercado Pago",
        resumo: "Pix na hora e cartão em até 12x. Confirma o pagamento sozinho pelo webhook.",
        ondePegar: { texto: "Suas integrações → Credenciais de produção", link: "https://www.mercadopago.com.br/developers/panel/app" },
        campos: [
          { id: "accessToken", rotulo: "Access token", secreto: true, exemplo: "APP_USR-…" },
          { id: "webhookSecret", rotulo: "Assinatura secreta do webhook", secreto: true, opcional: true, dica: "Em Webhooks → Assinatura secreta. Sem ela, o pagamento é conferido direto na API." },
        ],
      },
      {
        id: "stripe",
        nome: "Stripe",
        resumo: "Cartão do mundo todo, Apple Pay e Google Pay pelo Checkout da Stripe.",
        ondePegar: { texto: "Developers → API keys", link: "https://dashboard.stripe.com/apikeys" },
        campos: [
          { id: "secretKey", rotulo: "Secret key", secreto: true, exemplo: "sk_live_…" },
          { id: "webhookSecret", rotulo: "Signing secret do webhook", secreto: true, opcional: true, exemplo: "whsec_…", dica: "Evento checkout.session.completed apontando para /api/webhooks/stripe." },
          { id: "moeda", rotulo: "Moeda", exemplo: "brl", opcional: true },
        ],
      },
      {
        id: "asaas",
        nome: "Asaas",
        resumo: "Pix, boleto e cartão. Bom para quem já emite nota pelo Asaas.",
        ondePegar: { texto: "Integrações → Chave de API", link: "https://www.asaas.com/customerApiAccessToken/index" },
        campos: [
          { id: "apiKey", rotulo: "Chave de API", secreto: true, exemplo: "$aact_…" },
          { id: "sandbox", rotulo: "Usar o sandbox (teste)", tipo: "booleano", opcional: true },
          { id: "webhookToken", rotulo: "Token do webhook", secreto: true, opcional: true, dica: "O mesmo token que você puser no webhook do Asaas (/api/webhooks/asaas)." },
        ],
      },
      {
        id: "pix_manual",
        nome: "Pix direto",
        resumo: "Sem intermediário: gera o QR do Pix com a sua chave. Você confirma o pagamento à mão.",
        campos: [
          { id: "chave", rotulo: "Chave Pix", exemplo: "e-mail, celular, CPF/CNPJ ou aleatória" },
          { id: "nome", rotulo: "Nome de quem recebe", exemplo: "Maria Souza" },
          { id: "cidade", rotulo: "Cidade", exemplo: "São Paulo" },
        ],
      },
    ],
  },
  {
    id: "whatsapp",
    nome: "WhatsApp",
    pergunta: "Por onde o sistema conversa no WhatsApp?",
    multiplo: true,
    provedores: [
      {
        id: "baileys",
        nome: "Baileys (QR code)",
        resumo: "Seu próprio número, conectado por QR code. Grátis. Roda o serviço servicos/whatsapp junto.",
        servico: "servicos/whatsapp",
        campos: [
          { id: "url", rotulo: "Endereço do serviço", tipo: "url", exemplo: "http://127.0.0.1:4320" },
          { id: "token", rotulo: "Token do serviço", secreto: true, dica: "O mesmo WHATSAPP_TOKEN do servicos/whatsapp/.env (o setup gera os dois iguais)." },
        ],
      },
      {
        id: "evolution",
        nome: "Evolution API",
        resumo: "Servidor de WhatsApp que você já tem rodando (self-hosted ou contratado).",
        ondePegar: { texto: "Documentação da Evolution API", link: "https://doc.evolution-api.com" },
        campos: [
          { id: "url", rotulo: "URL da Evolution", tipo: "url", exemplo: "https://evolution.seudominio.com" },
          { id: "apiKey", rotulo: "API key", secreto: true },
          { id: "instancia", rotulo: "Nome da instância", exemplo: "prospeccao" },
        ],
      },
      {
        id: "meta",
        nome: "API oficial da Meta",
        resumo: "WhatsApp Cloud API. Sem risco de bloqueio, mas a 1ª mensagem precisa de template aprovado.",
        ondePegar: { texto: "Meta for Developers → WhatsApp → Configuração da API", link: "https://developers.facebook.com/apps" },
        campos: [
          { id: "phoneNumberId", rotulo: "Phone number ID", exemplo: "1234567890" },
          { id: "token", rotulo: "Token de acesso permanente", secreto: true },
          { id: "verifyToken", rotulo: "Verify token do webhook", dica: "Qualquer texto; use o mesmo ao cadastrar /api/whatsapp/meta na Meta." },
          { id: "appSecret", rotulo: "App secret", secreto: true, opcional: true, dica: "Confere a assinatura das mensagens que chegam." },
          { id: "template", rotulo: "Template da 1ª mensagem", opcional: true, dica: "Nome do template aprovado na Meta. Vazio = envia texto livre (só funciona com quem respondeu nas últimas 24 h)." },
          { id: "templateTexto", rotulo: "Texto do template", opcional: true, dica: "O texto aprovado, com {{categoria}}, {{cidade}} ou {{nome}} no lugar de {{1}}, {{2}}… na mesma ordem. Vazio = a mensagem inteira vai numa variável só." },
        ],
      },
      {
        id: "zapi",
        nome: "Z-API",
        resumo: "WhatsApp por QR code em servidor brasileiro, pago por instância.",
        ondePegar: { texto: "Painel da Z-API → Instâncias", link: "https://app.z-api.io" },
        campos: [
          { id: "instancia", rotulo: "ID da instância" },
          { id: "token", rotulo: "Token da instância", secreto: true },
          { id: "clientToken", rotulo: "Client-Token (segurança da conta)", secreto: true, opcional: true },
        ],
      },
    ],
  },
  {
    id: "rastro",
    nome: "Rastro",
    pergunta: "Onde roda o Rastro, o buscador do Google Maps?",
    multiplo: false,
    provedores: [
      {
        id: "rastro",
        nome: "Rastro",
        resumo: "Busca negócios no Google Maps com um Chromium de verdade. Roda no seu computador ou na VPS (servicos/rastro).",
        servico: "servicos/rastro",
        campos: [
          { id: "url", rotulo: "Endereço do Rastro", tipo: "url", exemplo: "http://127.0.0.1:4310" },
          { id: "token", rotulo: "Token do Rastro", secreto: true, dica: "O mesmo RASTRO_TOKEN do servicos/rastro/.env." },
        ],
      },
    ],
  },
  {
    id: "email",
    nome: "E-mail",
    pergunta: "Por onde sai o e-mail de recuperar senha?",
    multiplo: false,
    provedores: [
      {
        id: "resend",
        nome: "Resend",
        resumo: "Envia o link de \"esqueci a senha\" e os avisos de pagamento.",
        ondePegar: { texto: "Resend → API Keys", link: "https://resend.com/api-keys" },
        campos: [
          { id: "apiKey", rotulo: "API key", secreto: true, exemplo: "re_…" },
          { id: "remetente", rotulo: "Remetente", tipo: "email", exemplo: "Garimpo <avisos@seudominio.com>", dica: "Domínio verificado no Resend. Para testar: onboarding@resend.dev" },
        ],
      },
    ],
  },
];

export const grupo = (id: GrupoId) => GRUPOS.find((g) => g.id === id)!;
export const provedor = (g: GrupoId, id: string) => grupo(g).provedores.find((p) => p.id === id) ?? null;
