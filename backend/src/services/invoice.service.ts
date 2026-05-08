/// <reference types="node" />
import axios from 'axios'
import type { Invoice } from '@prisma/client'

function getEnotasClient() {
  const key = process.env.ENOTAS_API_KEY ?? ''
  return axios.create({
    baseURL: 'https://api.enotas.com.br/v1',
    headers: {
      Authorization: `Basic ${Buffer.from(key + ':').toString('base64')}`,
      'Content-Type': 'application/json',
    },
  })
}

interface EmitResult {
  externalId: string
  xmlUrl:     string
  pdfUrl:     string
}

export const invoiceService = {

  async emitir(invoice: Invoice): Promise<EmitResult> {
    const apiKey    = process.env.ENOTAS_API_KEY
    const empresaId = process.env.ENOTAS_EMPRESA_ID

    if (!apiKey || !empresaId) {
      throw new Error('ENOTAS_API_KEY e ENOTAS_EMPRESA_ID não configurados no .env')
    }

    const api     = getEnotasClient()
    const payload = {
      tipo:              'NF-e',
      naturezaOperacao:  invoice.nature,
      cfop:              invoice.cfop,
      cliente: {
        nome:    invoice.customerName,
        cpfCnpj: invoice.customerDoc.replace(/\D/g, ''),
      },
      itens: [{
        descricao:     invoice.description,
        valorUnitario: invoice.amount,
        quantidade:    1,
        cfop:          invoice.cfop,
      }],
      valorTotal: invoice.amount,
    }

    const { data } = await api.post(`/empresas/${empresaId}/nfe`, payload)

    return {
      externalId: data.id       as string,
      xmlUrl:     data.linkXml  ?? '',
      pdfUrl:     data.linkPdf  ?? '',
    }
  },

  async consultar(externalId: string): Promise<unknown> {
    const empresaId = process.env.ENOTAS_EMPRESA_ID ?? ''
    const api       = getEnotasClient()
    const { data }  = await api.get(`/empresas/${empresaId}/nfe/${externalId}`)
    return data
  },

  async cancelar(externalId: string, motivo: string): Promise<void> {
    const empresaId = process.env.ENOTAS_EMPRESA_ID ?? ''
    const api       = getEnotasClient()
    await api.delete(`/empresas/${empresaId}/nfe/${externalId}`, { data: { motivo } })
  },
}
