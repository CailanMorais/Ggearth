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
| Relevo 3D | ✅ Montanhas e vales reais + exagero do relevo | Esri World Elevation (ou Cesium World Terrain com token) |
| Cidades 3D fotorrealistas | ✅ Os mesmos tiles 3D do Google Earth | Google Photorealistic 3D Tiles (requer chave) |
| Prédios 3D | ✅ | OSM Buildings (requer token Cesium ion) |
| Pesquisa | ✅ Lugares, endereços, coordenadas, histórico | OpenStreetMap Nominatim |
| Cartões de conhecimento | ✅ Clique em qualquer lugar: endereço, resumo e foto da Wikipédia, lugares próximos | Nominatim + Wikipédia |
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
| Street View | ↗️ Abre o Street View / Mapillary no ponto clicado | Google Maps / Mapillary |
| Minha localização | ✅ | Geolocalização do navegador |
| Compartilhar vista | ✅ Link com a posição da câmera (`#@lat,lon,alt,rumo,inclinação`) | — |
| Capturar imagem | ✅ PNG da vista | — |
| Simulador de voo | ✅ Modo voo pelo teclado (tecla **F**) | — |
| Bússola, 2D/3D, zoom, tela cheia | ✅ | — |

### Atalhos
`/` pesquisar · `N` norte · `U` vista de cima/3D · `R` visão do globo · `+`/`-` zoom · `F` modo voo · `M` medir · `Esc` cancelar

## Sobre o "banco de dados" do Google Earth

O acervo do Google Earth (imagens de satélite e aéreas licenciadas, modelos 3D, Street View, índice de lugares) é **proprietário** do Google e de seus fornecedores – não pode ser copiado nem redistribuído. Por isso o GGEarth usa fontes abertas ou com uso gratuito permitido, que cobrem o planeta inteiro:

- **Imagens:** Esri World Imagery (+ Wayback), NASA GIBS, OpenStreetMap, OpenTopoMap
- **Relevo:** Esri World Elevation 3D
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
