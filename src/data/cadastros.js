// Fontes públicas de cadastro territorial por município (ArcGIS Server das prefeituras).
// Para adicionar uma cidade, inclua um objeto com o retângulo do município e os serviços MapServer.
export const CADASTROS = [
  {
    id: "londrina",
    nome: "Prefeitura de Londrina (SIGLON / IPPUL)",
    // oeste, sul, leste, norte (graus) – município inteiro, incluindo distritos rurais
    bbox: [-51.45, -23.8, -50.8, -23.0],
    servidor: "https://geo.londrina.pr.gov.br/server/rest/services",
    servicos: [
      { path: "Gerais/Lotes_e_Glebas/MapServer", titulo: "Lote / gleba", principal: true },
      { path: "Gerais/BCarSiglon/MapServer", titulo: "Cadastro urbano (quadra, lote, loteamento)" },
      { path: "IPPUL/IppulLUOSZoneamentoPL1432023/MapServer", titulo: "Zoneamento (uso e ocupação do solo)" },
      { path: "IPPUL/IppulAgrupamentoLotesRurais/MapServer", titulo: "Lotes rurais" },
      { path: "Gerais/MMACARLda/MapServer", titulo: "Cadastro Ambiental Rural (CAR)" },
    ],
    // Camada desenhada sobre o mapa (contorno dos lotes)
    camadaMapa: "Gerais/Lotes_e_Glebas/MapServer",
    cartorios: "Londrina tem 4 Ofícios de Registro de Imóveis; a área de cada um aparece no SIGLON (camada Limites).",
    portal: "https://geo.londrina.pr.gov.br/portal/apps/sites/",
  },
];

export function cadastroFor(lat, lon) {
  return CADASTROS.find(({ bbox: [w, s, e, n] }) => lon >= w && lon <= e && lat >= s && lat <= n) ?? null;
}
