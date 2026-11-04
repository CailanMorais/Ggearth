# 🌍 GGEarth

Globo 3D interativo inspirado no Google Earth, feito com [CesiumJS](https://cesium.com/platform/cesiumjs/) e **dados abertos**. Roda inteiramente no navegador, sem servidor próprio.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera a pasta dist/ (site estático, pode ir para GitHub Pages, Netlify, Vercel…)
```

## Funcionalidades

| Google Earth | GGEarth | Fonte de dados |
|---|---|---|
| Globo 3D com imagens de satélite | ✅ Satélite em alta resolução (até ~30 cm em muitas cidades) | Esri World Imagery |
| Relevo 3D | ✅ Montanhas e vales reais + exagero do relevo | AWS Terrain Tiles / Mapzen, aberto e sem chave (ou Cesium World Terrain com token) |
| Cidades 3D fotorrealistas | ✅ Os mesmos tiles 3D do Google Earth | Google Photorealistic 3D Tiles (requer chave) |
| Prédios 3D | ✅ Gerados automaticamente ao aproximar, sem chave (versão otimizada opcional com token Cesium ion) | OpenStreetMap (Overpass API) |
| Pesquisa | ✅ Lugares, endereços, coordenadas, histórico | OpenStreetMap Nominatim |
| Cartões de conhecimento | ✅ Clique em qualquer lugar: o lugar identificado (país, cidade, bairro, prédio… conforme o zoom), endereço e o artigo da Wikipédia vinculado a ele | Nominatim + Wikidata + Wikipédia |
| Camada de lugares | ✅ Marcadores de artigos da Wikipédia perto da vista | Wikipédia GeoSearch |
| Voyager | ✅ 5 passeios guiados (maravilhas, natureza, cidades, Brasil, civilizações antigas) com voo e órbita | Curadoria própria + Wikipédia |
| Estou com sorte | ✅ Lugar aleatório | — |
| Estilo do mapa | ✅ Satélite, ruas, topográfico, OSM, OpenTopoMap, oceanos, Terra à noite, Blue Marble | Esri, OSM, NASA |
| Sobreposições | ✅ Fronteiras e rótulos, estradas, nuvens do dia, focos de incêndio, linhas de grade | Esri, NASA GIBS/FIRMS |
| Imagens históricas | ✅ ~200 versões de imagem de alta resolução desde 2014 + imagem diária do planeta desde 2000 | Esri Wayback, NASA GIBS |
| Sol, sombras, atmosfera, estrelas | ✅ Com escolha de data/hora | CesiumJS |
| Projetos (marcadores, linhas, polígonos) | ✅ Salvos no navegador, editáveis | — |
| Importar KML/KMZ/GeoJSON | ✅ | — |
| Exportar KML/GeoJSON | ✅ | — |
| Medir distância e área | ✅ Geodésico, métrico ou imperial | — |
| Dados do lote (Londrina-PR) | ✅ Ao tocar: inscrição, quadra, lote, loteamento, áreas, zoneamento, CAR – com contorno do lote destacado | ArcGIS Server da Prefeitura de Londrina (SIGLON/IPPUL) |
| Matrícula / proprietário | ↗️ Links para achar o cartório e pedir a certidão oficial (ONR) | Registro de Imóveis do Brasil / RI Digital |
| Street View | ↗️ Abre o Street View / Mapillary no ponto clicado | Google Maps / Mapillary |
| Minha localização | ✅ | Geolocalização do navegador |
| Compartilhar vista | ✅ Link com a posição da câmera (`#@lat,lon,alt,rumo,inclinação`) | — |
| Capturar imagem | ✅ PNG da vista | — |
| Simulador de voo | ✅ Modo voo pelo teclado (tecla **F**) | — |
| Bússola, 2D/3D, zoom, tela cheia | ✅ | — |

### Experiência no celular
- Barra de pesquisa sempre visível no topo, com sugestões enquanto digita e pesquisas recentes
- Barra inferior com Voyager, Camadas, Projetos, Medir e **Mais**
- Cartão de informações em "bottom sheet": toque na alça para expandir, arraste para baixo para fechar
- Painéis e cartão nunca se sobrepõem; ao pesquisar ou iniciar um passeio, o mapa fica visível
- Instalável na tela inicial (manifest + ícones); renderização sob demanda para economizar bateria

### Atalhos
`/` pesquisar · `N` norte · `U` vista de cima/3D · `R` visão do globo · `+`/`-` zoom · `F` modo voo · `M` medir · `Esc` cancelar

## Sobre o "banco de dados" do Google Earth

O acervo do Google Earth (imagens de satélite e aéreas licenciadas, modelos 3D, Street View, índice de lugares) é **proprietário** do Google e de seus fornecedores – não pode ser copiado nem redistribuído. Por isso o GGEarth usa fontes abertas ou com uso gratuito permitido, que cobrem o planeta inteiro:

- **Imagens:** Esri World Imagery (+ Wayback), NASA GIBS, OpenStreetMap, OpenTopoMap
- **Relevo:** AWS Terrain Tiles (SRTM e outros)
- **Cadastro de lotes:** prefeituras que publicam seus dados (Londrina; outras cidades podem ser adicionadas em `src/data/cadastros.js`)
- **Lugares e endereços:** OpenStreetMap (Nominatim)
- **Conhecimento:** Wikipédia
- **3D fotorrealista do Google:** acessado **legalmente** pela [Map Tiles API](https://developers.google.com/maps/documentation/tile/3d-tiles) com a sua própria chave

### Chaves opcionais
Informe em **Configurações** (ficam só no seu navegador) ou em um arquivo `.env`:

```
VITE_GOOGLE_MAPS_API_KEY=AIza...     # Google Photorealistic 3D Tiles
VITE_CESIUM_ION_TOKEN=eyJ...         # Cesium World Terrain + OSM Buildings
```

Respeite as políticas de uso de cada serviço (por exemplo, a do Nominatim limita a ~1 requisição/segundo; para uso intenso hospede sua própria instância).

## Estrutura

```
index.html              interface (barra lateral, painéis, controles)
src/main.js             cria o visualizador e conecta os módulos
src/modules/layers.js   mapas base, sobreposições, relevo, 3D, grade
src/modules/search.js   pesquisa (Nominatim / coordenadas)
src/modules/knowledge.js cartões de informação e camada Wikipédia
src/modules/voyager.js  passeios guiados e "Estou com sorte"
src/modules/projects.js marcadores/linhas/polígonos, KML/GeoJSON
src/modules/measure.js  régua de distância e área
src/modules/history.js  imagens históricas (Wayback e NASA)
src/modules/navigation.js bússola, zoom, modo voo, status, link, captura
src/data/voyager.js     roteiros do Voyager
```
