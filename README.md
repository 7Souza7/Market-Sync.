# ERP Pro

ERP completo com IA para criação de anúncios, gestão de lojas, CRM, financeiro e emissão de NF-e.

## Stack

**Frontend:** React 18 + TypeScript + Vite + Zustand + React Query + Recharts  
**Backend:** Node.js + Fastify + Prisma ORM + PostgreSQL  
**IA:** Anthropic Claude (streaming) via `@anthropic-ai/sdk`  
**NF-e:** eNotas API  

---

## Estrutura

```
erp-pro/
├── frontend/          # React + TypeScript
│   └── src/
│       ├── pages/     # Dashboard, Ads, AI, CRM, Finance, Invoices, Analytics, Stores
│       ├── components/
│       │   ├── layout/ # AppLayout com sidebar
│       │   └── ui/     # Card, Btn, Input, Badge, Table, MetricCard...
│       ├── services/  # api.ts (axios + todos os endpoints)
│       └── store/     # auth.ts (Zustand)
└── backend/           # Fastify + Prisma
    └── src/
        ├── routes/    # auth, ads, ai, customers, finance, invoices, stores, analytics
        ├── services/  # invoice.service.ts (eNotas)
        ├── middleware/ # auth.ts (JWT)
        └── lib/       # prisma.ts (singleton)
```

---

## Setup

### 1. Pré-requisitos
- Node.js 20+
- PostgreSQL rodando localmente

### 2. Instalar dependências
```bash
npm run install:all
```

### 3. Configurar variáveis de ambiente
```bash
cp backend/.env.example backend/.env
# Edite backend/.env com suas credenciais
```

Variáveis obrigatórias:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/erp_pro"
JWT_SECRET="chave-secreta-longa-e-aleatoria"
ANTHROPIC_API_KEY="sk-ant-..."
```

Variáveis opcionais (para NF-e real):
```env
ENOTAS_API_KEY="..."
ENOTAS_EMPRESA_ID="..."
```

### 4. Criar banco de dados e rodar migrations
```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

### 5. Rodar em desenvolvimento
```bash
# Na raiz do projeto
npm run dev
```

- Frontend: http://localhost:  
- Backend: http://localhost:3001  
- Prisma Studio: `cd backend && npm run db:studio`

---

## Módulos

| Módulo | Rota | Descrição |
|--------|------|-----------|
| Dashboard | `/dashboard` | Métricas consolidadas de todas as lojas |
| Propaganda | `/ads` | Criação e gestão de campanhas Meta/Google/TikTok |
| IA Criativa | `/ai` | Chat com Claude para copys, headlines e pesquisa |
| CRM | `/crm` | Gestão de clientes com segmentação |
| Financeiro | `/finance` | Lançamentos de receitas e despesas |
| Notas Fiscais | `/invoices` | Emissão de NF-e via eNotas |
| Analytics | `/analytics` | Gráficos de receita, ROAS, CTR por plataforma |
| Lojas | `/stores` | Shopify, Shopee, ML, Amazon vinculados |

---

## API Endpoints

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/ads
POST   /api/ads
PATCH  /api/ads/:id
PATCH  /api/ads/:id/status
DELETE /api/ads/:id

POST   /api/ai/chat          (SSE streaming)
POST   /api/ai/generate-ad
GET    /api/ai/chats

GET    /api/customers
POST   /api/customers
PATCH  /api/customers/:id

GET    /api/finance
GET    /api/finance/summary
POST   /api/finance
DELETE /api/finance/:id

GET    /api/invoices
POST   /api/invoices
GET    /api/invoices/:id
POST   /api/invoices/:id/cancel

GET    /api/stores
POST   /api/stores
PATCH  /api/stores/:id
DELETE /api/stores/:id

GET    /api/analytics/overview
GET    /api/analytics/revenue-chart
GET    /api/analytics/stores
GET    /api/analytics/ads-performance
```

---

## Próximos passos sugeridos

- [ ] Webhooks das plataformas (Shopify, Shopee) para sincronizar pedidos em tempo real
- [ ] Geração de imagens com DALL-E na IA Criativa
- [ ] Integração com Meta Ads API para publicar anúncios diretamente
- [ ] Integração com Google Ads API
- [ ] Relatórios exportáveis em PDF
- [ ] Dashboard multi-usuário / permissões por papel
- [ ] Notificações por e-mail (quedas de ROAS, notas emitidas)
- [ ] App mobile com React Native

---

## Módulos adicionados (v2)

### Webhooks em tempo real
- Recebe e processa eventos de Shopify, Shopee, Mercado Livre e Amazon
- Verificação HMAC para Shopify
- Atualização automática de pedidos e métricas da loja
- Painel de monitoramento com status, reprocessamento e URLs prontas

**Configurar nas plataformas:**
```
Shopify:       POST /api/webhooks/shopify/:storeId
Shopee:        POST /api/webhooks/shopee/:storeId
Mercado Livre: POST /api/webhooks/mercadolivre/:storeId
Amazon:        POST /api/webhooks/amazon/:storeId
```

### Geração de Imagens com DALL-E 3
Requer `OPENAI_API_KEY` no `.env`

- Geração de imagem única com prompt customizado
- Modo "4 variações A/B" — gera 4 ângulos diferentes automaticamente
- Prompt automático otimizado por plataforma (Meta, Google, TikTok)
- Histórico de imagens salvo no banco

### Meta Ads API
Requer `META_APP_ID` e `META_APP_SECRET` no `.env`

Criar app em: https://developers.facebook.com

Permissões necessárias: `ads_management`, `ads_read`, `business_management`, `pages_read_engagement`

Funcionalidades:
- Autenticação OAuth com Meta Business
- Criar campanhas completas (Campaign → AdSet → Creative → Ad)
- Ver métricas de ROAS, CTR, CPC, conversões por campanha
- Pausar/ativar campanhas
- Buscar interesses para segmentação

### Exportação de Relatórios PDF
Requer puppeteer: `npm install puppeteer -w backend`

- Relatório completo (todos os módulos)
- Relatório por módulo: visão geral, ads, financeiro, CRM
- Seleção de período (mês/ano)
- Template profissional com logo, tabelas e métricas
- Download direto no browser
