import puppeteer from 'puppeteer'
import dayjs from 'dayjs'

interface ReportData {
  title: string
  type: string
  data: Record<string, any>
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function buildHTML(report: ReportData): string {
  const { title, data } = report
  const { overview, ads, finance, customers, user, period } = data

  const css = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #7F77DD; }
    .logo { font-size: 22px; font-weight: 700; color: #534AB7; }
    .logo span { color: #7F77DD; }
    .header-info { text-align: right; font-size: 12px; color: #666; }
    h2 { font-size: 16px; font-weight: 700; color: #111; margin: 32px 0 14px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .metric { background: #F5F4FF; border-radius: 8px; padding: 14px; }
    .metric-label { font-size: 11px; color: #666; margin-bottom: 4px; }
    .metric-value { font-size: 20px; font-weight: 700; color: #534AB7; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 24px; }
    th { text-align: left; padding: 8px 10px; background: #F5F4FF; font-weight: 600; color: #534AB7; border-bottom: 2px solid #7F77DD; }
    td { padding: 8px 10px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) td { background: #FAFAFA; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 600; }
    .badge-success { background: #EAF3DE; color: #3B6D11; }
    .badge-warning { background: #FAEEDA; color: #854F0B; }
    .badge-info { background: #E6F1FB; color: #185FA5; }
    .section-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .finance-summary { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-bottom: 16px; }
    .finance-card { border-radius: 8px; padding: 14px; }
    .income { background: #EAF3DE; }
    .expense { background: #FCEBEB; }
    .profit { background: #E6F1FB; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #aaa; text-align: center; }
    .tag { display: inline-block; background: #EEEDFE; color: #534AB7; border-radius: 4px; padding: 1px 6px; font-size: 11px; }
  `

  let body = ''

  // Overview
  if (overview) {
    body += `<h2>Visão Geral</h2>
    <div class="metrics">
      <div class="metric"><div class="metric-label">Receita bruta</div><div class="metric-value">${fmt(overview.revenue)}</div></div>
      <div class="metric"><div class="metric-label">Pedidos</div><div class="metric-value">${overview.orders.toLocaleString('pt-BR')}</div></div>
      <div class="metric"><div class="metric-label">Clientes</div><div class="metric-value">${overview.customers.toLocaleString('pt-BR')}</div></div>
      <div class="metric"><div class="metric-label">Lojas ativas</div><div class="metric-value">${overview.stores?.length ?? 0}</div></div>
    </div>
    ${overview.stores?.length ? `
    <table>
      <thead><tr><th>Loja</th><th>Plataforma</th></tr></thead>
      <tbody>${overview.stores.map((s: any) => `<tr><td>${s.name}</td><td><span class="tag">${s.platform}</span></td></tr>`).join('')}</tbody>
    </table>` : ''}`
  }

  // Ads
  if (ads?.length) {
    body += `<h2>Campanhas de Anúncios</h2>
    <table>
      <thead><tr><th>Nome</th><th>Plataforma</th><th>Gasto</th><th>Receita</th><th>ROAS</th><th>Impressões</th><th>CTR</th></tr></thead>
      <tbody>${ads.map((a: any) => `
        <tr>
          <td>${a.name}</td>
          <td><span class="tag">${a.platform}</span></td>
          <td>${fmt(a.spent)}</td>
          <td>${fmt(a.revenue)}</td>
          <td><span class="badge ${a.roas >= 3 ? 'badge-success' : 'badge-warning'}">${a.roas}x</span></td>
          <td>${(a.impressions ?? 0).toLocaleString('pt-BR')}</td>
          <td>${(a.ctr ?? 0).toFixed(2)}%</td>
        </tr>`).join('')}</tbody>
    </table>`
  }

  // Finance
  if (finance) {
    const profit = finance.income - finance.expense
    body += `<h2>Financeiro</h2>
    <div class="finance-summary">
      <div class="finance-card income"><div class="metric-label">Receita</div><div style="font-size:18px;font-weight:700;color:#3B6D11">${fmt(finance.income)}</div></div>
      <div class="finance-card expense"><div class="metric-label">Despesas</div><div style="font-size:18px;font-weight:700;color:#A32D2D">${fmt(finance.expense)}</div></div>
      <div class="finance-card profit"><div class="metric-label">Lucro</div><div style="font-size:18px;font-weight:700;color:#185FA5">${fmt(profit)}</div></div>
    </div>
    ${finance.transactions?.length ? `
    <table>
      <thead><tr><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th>Data</th></tr></thead>
      <tbody>${finance.transactions.slice(0, 20).map((t: any) => `
        <tr>
          <td>${t.description}</td>
          <td>${t.category}</td>
          <td><span class="badge ${t.type === 'INCOME' ? 'badge-success' : ''}" style="${t.type === 'EXPENSE' ? 'background:#FCEBEB;color:#A32D2D' : ''}">${t.type === 'INCOME' ? 'Entrada' : 'Saída'}</span></td>
          <td style="font-weight:600">${fmt(t.amount)}</td>
          <td>${dayjs(t.date).format('DD/MM/YYYY')}</td>
        </tr>`).join('')}</tbody>
    </table>` : ''}`
  }

  // CRM
  if (customers?.length) {
    body += `<h2>Clientes</h2>
    <table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Segmento</th><th>Total gasto</th><th>Pedidos</th></tr></thead>
      <tbody>${customers.map((c: any) => `
        <tr>
          <td style="font-weight:500">${c.name}</td>
          <td style="color:#666">${c.email ?? '—'}</td>
          <td><span class="badge ${c.segment === 'VIP' ? 'badge-success' : c.segment === 'NEW' ? 'badge-info' : 'badge-warning'}">${c.segment}</span></td>
          <td>${fmt(c.totalSpent)}</td>
          <td>${c.orderCount}</td>
        </tr>`).join('')}</tbody>
    </table>`
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><style>${css}</style></head>
<body>
  <div class="header">
    <div>
      <div class="logo">ERP <span>Pro</span></div>
      <div style="font-size:20px;font-weight:700;margin-top:8px">${title}</div>
      <div style="font-size:12px;color:#666;margin-top:4px">Período: ${dayjs(period).format('MMMM [de] YYYY')}</div>
    </div>
    <div class="header-info">
      <div style="font-weight:600">${user?.name ?? ''}</div>
      <div>${user?.email ?? ''}</div>
      <div>Gerado em ${dayjs().format('DD/MM/YYYY HH:mm')}</div>
    </div>
  </div>
  ${body}
  <div class="footer">ERP Pro — Relatório gerado automaticamente — ${dayjs().format('DD/MM/YYYY')}</div>
</body>
</html>`
}

export const pdfService = {
  async generate(report: ReportData): Promise<Buffer> {
    const html = buildHTML(report)

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    try {
      const page = await browser.newPage()
      await page.setContent(html, { waitUntil: 'networkidle0' })

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        displayHeaderFooter: false,
      })

      return Buffer.from(pdf)
    } finally {
      await browser.close()
    }
  },
}
