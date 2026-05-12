const { useState } = React;

// ─── Utilidad: leer Response en chunks y parsear JSON robusto ─────────────────
async function fetchAndParseJSON(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const contentLength = response.headers.get('Content-Length');
  const total = contentLength ? parseInt(contentLength) : null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let received = 0;
  let chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
    received += value.length;
    if (total && onProgress) {
      onProgress(Math.round((received / total) * 100));
    }
  }

  const fullText = chunks.join('');
  chunks = null; // liberar memoria

  try {
    return JSON.parse(fullText);
  } catch (e) {
    throw new Error(`JSON inválido o descarga incompleta (${received} bytes recibidos). Intenta de nuevo.`);
  }
}

// ─── Utilidad: leer File con FileReader como promesa ─────────────────────────
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsText(file);
  });
}

function ManaboxToMoxfield() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [cardDatabase, setCardDatabase] = useState(null);
  const [downloadLinks, setDownloadLinks] = useState([]);
  const [cardNameIndex, setCardNameIndex] = useState(null);
  const [cardCollectorIndex, setCardCollectorIndex] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);

  const loadScryfallDatabaseAuto = async () => {
    setDbLoading(true);
    setError('');
    setProgress('Conectando con Scryfall...');

    try {
      // Paso 1: obtener lista de bulk data
      const bulkData = await fetchAndParseJSON('https://api.scryfall.com/bulk-data', null);
      
      // Usar default_cards — todas las impresiones, máxima cobertura
      const oracleCards = bulkData.data.find(item => item.type === 'default_cards'); // ~500MB
      if (!oracleCards) throw new Error('No se encontró default_cards en la API de Scryfall');

      const sizeMB = oracleCards.size ? Math.round(oracleCards.size / 1024 / 1024) : '~20';
      setProgress(`Descargando base de datos (~${sizeMB}MB)... 0%`);

      // Paso 2: descargar con progreso chunk a chunk
      const cardsData = await fetchAndParseJSON(
        oracleCards.download_uri,
        (pct) => setProgress(`Descargando base de datos (~${sizeMB}MB)... ${pct}%`)
      );

      setProgress('Procesando base de datos...');
      buildIndexes(cardsData);

    } catch (err) {
      setError(`No se pudo descargar automáticamente: ${err.message}. Por favor usa la Opción B.`);
      setDbLoading(false);
      setProgress('');
    }
  };

  const handleDatabaseUpload = async (event) => {
    const dbFile = event.target.files[0];
    if (!dbFile) return;
    event.target.value = '';

    setProgress('Leyendo archivo...');
    setError('');
    setDbLoading(true);

    try {
      const text = await readFileAsText(dbFile);
      setProgress('Procesando base de datos...');
      
      let cardsData;
      try {
        cardsData = JSON.parse(text);
      } catch (e) {
        throw new Error('El archivo JSON está incompleto o corrupto. Descárgalo de nuevo desde Scryfall.');
      }

      buildIndexes(cardsData);
    } catch (err) {
      setError(`Error al cargar la base de datos: ${err.message}`);
      setDbLoading(false);
      setProgress('');
    }
  };

  const buildIndexes = (cardsData) => {
    if (!Array.isArray(cardsData) || cardsData.length === 0) {
      setError('El archivo no contiene cartas válidas. Asegúrate de usar "Oracle Cards" de Scryfall.');
      setDbLoading(false);
      return;
    }

    const colorMap = {};
    const nameIndex = {};
    const collectorIndex = {};

    cardsData.forEach((card) => {
      if (card.id && card.color_identity !== undefined) {
        colorMap[card.id] = card.color_identity;
      }
      if (card.name && card.set) {
        const key = `${card.name.toLowerCase()}|${card.set.toLowerCase()}`;
        nameIndex[key] = card.color_identity || [];
      }
      if (card.set && card.collector_number) {
        const collectorKey = `${card.set.toLowerCase()}|${card.collector_number}`;
        collectorIndex[collectorKey] = {
          color_identity: card.color_identity || [],
          name: card.name
        };
      }
    });

    console.log(`✅ Indexadas: ${Object.keys(colorMap).length.toLocaleString()} cartas`);

    setCardDatabase(colorMap);
    setCardNameIndex(nameIndex);
    setCardCollectorIndex(collectorIndex);
    setProgress(`✓ Base de datos cargada: ${Object.keys(colorMap).length.toLocaleString()} cartas`);
    setDbLoading(false);
  };

  const parseTxtFormat = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const cards = [];
    lines.forEach(line => {
      const match = line.match(/^(\d+)\s+(.+?)\s+\(([^)]+)\)\s+(\S+)(.*)$/);
      if (match) {
        const [, quantity, name, setCode, collectorNumber, rest] = match;
        cards.push({
          Quantity: quantity,
          Name: name.trim(),
          'Set code': setCode.trim(),
          'Collector number': collectorNumber,
          Foil: rest.includes('*F*') ? 'foil' : 'normal',
          Condition: 'near_mint',
          Language: 'en'
        });
      }
    });
    return cards;
  };

  const handleDownload = (csvContent, filename) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const assignBinder = (colorIdentity) => {
    if (!colorIdentity || colorIdentity.length === 0) return 'incoloro';
    if (colorIdentity.length > 1) return 'multicolor';
    return { 'W': 'blanco', 'U': 'azul', 'B': 'negro', 'R': 'rojo', 'G': 'verde' }[colorIdentity[0]] || 'incoloro';
  };

  const processCards = async (cards) => {
    if (cards.length === 0) throw new Error('El archivo está vacío o no tiene el formato correcto');

    setProgress(`🔍 FASE 1: Procesando ${cards.length} cartas...`);

    const moxfieldData = [];
    const notFoundInPhase1 = [];
    const binderStats = { blanco: 0, azul: 0, negro: 0, rojo: 0, verde: 0, multicolor: 0, incoloro: 0, 'no-catalogadas': 0 };
    let phase1FoundCount = 0;
    let totalCardsCount = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const quantity = parseInt(card.Quantity) || 1;
      totalCardsCount += quantity;

      const scryfallId = card['Scryfall ID']?.trim();
      let binder = 'no-catalogadas';
      let found = false;

      if (scryfallId && cardDatabase[scryfallId] !== undefined) {
        binder = assignBinder(cardDatabase[scryfallId]);
        found = true;
        phase1FoundCount++;
      } else if (card.Name && card['Set code'] && cardNameIndex) {
        const key = `${card.Name.toLowerCase()}|${card['Set code'].toLowerCase()}`;
        if (cardNameIndex[key] !== undefined) {
          binder = assignBinder(cardNameIndex[key]);
          found = true;
          phase1FoundCount++;
        }
      }

      if (!found) notFoundInPhase1.push({ card, index: i });

      binderStats[binder] += quantity;

      const conditionMap = { near_mint: 'Near Mint', lightly_played: 'Lightly Played', moderately_played: 'Moderately Played', heavily_played: 'Heavily Played', damaged: 'Damaged' };

      moxfieldData.push({
        Count: quantity,
        Name: card.Name,
        Edition: card['Set code'],
        Condition: conditionMap[card.Condition] || 'Near Mint',
        Language: (card.Language || 'en').toUpperCase(),
        Foil: card.Foil === 'foil' ? 'foil' : '',
        Tags: binder,
        _tempIndex: i
      });
    }

    // FASE 2: por Set + Número de colección
    let phase2FoundCount = 0;
    if (notFoundInPhase1.length > 0 && cardCollectorIndex) {
      setProgress(`🔍 FASE 2: Búsqueda avanzada de ${notFoundInPhase1.length} cartas...`);
      for (const item of notFoundInPhase1) {
        const { card, index } = item;
        const collectorNumber = card['Collector number']?.toString().trim();
        if (card['Set code'] && collectorNumber) {
          const key = `${card['Set code'].toLowerCase()}|${collectorNumber}`;
          if (cardCollectorIndex[key]) {
            const newBinder = assignBinder(cardCollectorIndex[key].color_identity);
            const entry = moxfieldData.find(c => c._tempIndex === index);
            if (entry) {
              const qty = parseInt(entry.Count) || 1;
              binderStats['no-catalogadas'] -= qty;
              binderStats[newBinder] += qty;
              entry.Tags = newBinder;
              phase2FoundCount++;
            }
          }
        }
      }
    }

    moxfieldData.forEach(card => delete card._tempIndex);

    const totalFound = phase1FoundCount + phase2FoundCount;
    const totalNotFound = cards.length - totalFound;

    setProgress('📝 Generando archivos CSV...');

    const cardsByBinder = { blanco: [], azul: [], negro: [], rojo: [], verde: [], multicolor: [], incoloro: [], 'no-catalogadas': [] };
    moxfieldData.forEach(card => cardsByBinder[card.Tags].push(card));

    const links = [];
    const originalName = file.name.replace(/\.(csv|txt)$/, '');

    Object.entries(cardsByBinder).forEach(([binder, binderCards]) => {
      if (binderCards.length === 0) return;
      const clean = binderCards.map(({ Tags, ...rest }) => rest);
      links.push({
        binder,
        filename: `${originalName}_${binder}.csv`,
        content: Papa.unparse(clean, { quotes: true, header: true }),
        count: binderCards.length
      });
    });

    setDownloadLinks(links);
    setStats(binderStats);
    setCompleted(true);
    setProgress(`🎉 ¡Completado! ${links.length} archivos. ${totalFound}/${cards.length} cartas catalogadas (${totalCardsCount} copias totales)${binderStats['no-catalogadas'] > 0 ? ` | ${totalNotFound} sin catalogar` : ''}`);
    setProcessing(false);
  };

  const processFile = async () => {
    if (!file || !cardDatabase) return;
    setProcessing(true);
    setError('');
    setCompleted(false);
    setProgress('Leyendo archivo...');

    try {
      const text = await readFileAsText(file);
      const isTxt = file.name.endsWith('.txt');

      if (isTxt) {
        const cards = parseTxtFormat(text);
        if (cards.length === 0) throw new Error('No se pudieron leer cartas del archivo TXT');
        await processCards(cards);
      } else {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          complete: async (results) => {
            try { await processCards(results.data); }
            catch (err) { setError(`Error: ${err.message}`); setProcessing(false); }
          },
          error: (err) => { setError(`Error al leer CSV: ${err.message}`); setProcessing(false); }
        });
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
      setProcessing(false);
    }
  };

  // ─── UI ───────────────────────────────────────────────────────────────────
  const colorEmoji = { blanco: '⚪', azul: '🔵', negro: '⚫', rojo: '🔴', verde: '🟢', multicolor: '🌈', incoloro: '⚪', 'no-catalogadas': '❓' };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-slate-800 rounded-lg shadow-2xl p-8 border border-slate-700">
          <h1 className="text-3xl font-bold text-white mb-2">Convertidor Manabox → Moxfield</h1>
          <p className="text-slate-400 mb-6">Convierte tu colección de Manabox a formato Moxfield con binders por color</p>

          <div className="space-y-6">

            {/* Instrucciones */}
            <div className="bg-slate-700 rounded-lg p-4 text-sm text-slate-300">
              <h3 className="font-semibold text-white mb-2">Cómo usar:</h3>
              <ol className="space-y-1 ml-4 list-decimal">
                <li>Carga la base de datos de Scryfall (automática o manual)</li>
                <li>Selecciona tu archivo de Manabox (CSV o TXT)</li>
                <li>Haz clic en "Convertir y Descargar"</li>
                <li>Descarga cada archivo CSV por color e impórtalo en Moxfield</li>
              </ol>
              <p className="mt-2 text-xs text-slate-400">ℹ️ La herramienta acepta tanto archivos .csv como .txt de Manabox.</p>
            </div>

            {/* Paso 1: Base de datos */}
            {!cardDatabase && (
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4">
                <h3 className="text-blue-200 font-semibold mb-3">
                  <i data-lucide="database" className="inline w-4 h-4 mr-2"></i>
                  Paso 1: Cargar base de datos de Scryfall
                </h3>

                {/* Opción A */}
                <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <i data-lucide="zap" className="w-4 h-4 text-yellow-400"></i>
                    <h4 className="text-white font-semibold text-sm">Opción A: Descarga Automática</h4>
                  </div>
                  <p className="text-slate-300 text-xs mb-3">Descarga ~20MB directamente desde Scryfall. Progreso visible.</p>
                  <button
                    onClick={loadScryfallDatabaseAuto}
                    disabled={dbLoading}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <i data-lucide="zap" className="w-4 h-4"></i>
                    {dbLoading ? 'Descargando...' : 'Descargar Automáticamente'}
                  </button>
                </div>

                {/* Opción B */}
                <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center gap-2 mb-1">
                    <i data-lucide="upload" className="w-4 h-4 text-green-400"></i>
                    <h4 className="text-white font-semibold text-sm">Opción B: Carga Manual</h4>
                  </div>
                  <ol className="text-slate-300 text-xs mb-3 ml-4 space-y-1 list-decimal">
                    <li>Abre la página de Scryfall (enlace abajo)</li>
                    <li>Busca <strong>"Oracle Cards"</strong> y descarga el JSON (~20MB)</li>
                    <li>Sube ese archivo aquí</li>
                  </ol>
                  <a href="https://scryfall.com/docs/api/bulk-data" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-300 hover:text-blue-200 text-xs underline mb-3">
                    <i data-lucide="external-link" className="w-3 h-3"></i>
                    Página de descargas de Scryfall
                  </a>
                  <label className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm mt-2">
                    <i data-lucide="upload" className="w-4 h-4"></i>
                    Subir Oracle Cards JSON
                    <input type="file" accept=".json" onChange={handleDatabaseUpload} className="hidden" />
                  </label>
                </div>
              </div>
            )}

            {/* DB cargada */}
            {cardDatabase && (
              <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 flex items-center gap-2">
                <i data-lucide="check-circle" className="w-5 h-5 text-green-400"></i>
                <p className="text-green-200 text-sm">Base de datos cargada. Selecciona tu archivo de Manabox.</p>
              </div>
            )}

            {/* Paso 2: archivo Manabox */}
            <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${cardDatabase ? 'border-slate-600 hover:border-slate-500' : 'border-slate-700 opacity-50'}`}>
              <i data-lucide="upload" className="w-12 h-12 text-slate-400 mx-auto mb-4"></i>
              <label className={cardDatabase ? 'cursor-pointer' : 'cursor-not-allowed'}>
                <span className="text-white font-medium">
                  {file ? file.name : 'Paso 2: Selecciona tu archivo de Manabox (CSV o TXT)'}
                </span>
                <input type="file" accept=".csv,.txt"
                  onChange={(e) => { setFile(e.target.files[0]); setCompleted(false); setError(''); setStats(null); setDownloadLinks([]); }}
                  className="hidden" disabled={processing || !cardDatabase} />
              </label>
              {file && <p className="text-slate-400 text-sm mt-2">{file.name}</p>}
            </div>

            {/* Paso 3: convertir */}
            <button onClick={processFile} disabled={!file || processing || !cardDatabase}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
              <i data-lucide="download" className="w-5 h-5"></i>
              {processing ? 'Procesando...' : 'Paso 3: Convertir y Descargar'}
            </button>

            {/* Progreso */}
            {progress && (
              <div className={`rounded-lg p-4 ${completed ? 'bg-green-900/50 border border-green-700' : 'bg-slate-700'}`}>
                <div className="flex items-center gap-2">
                  {completed && <i data-lucide="check-circle" className="w-5 h-5 text-green-400"></i>}
                  <p className={`text-sm ${completed ? 'text-green-200' : 'text-slate-200'}`}>{progress}</p>
                </div>
              </div>
            )}

            {/* Stats */}
            {stats && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold text-white mb-3">Resumen de la colección:</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {['blanco','azul','negro','rojo','verde','multicolor'].map(c => (
                    <div key={c} className="flex justify-between text-slate-300">
                      <span>{colorEmoji[c]} {c.charAt(0).toUpperCase()+c.slice(1)}:</span>
                      <span className="font-mono">{stats[c]}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-slate-300 col-span-2">
                    <span>⚪ Incoloro:</span><span className="font-mono">{stats.incoloro}</span>
                  </div>
                  {stats['no-catalogadas'] > 0 && (
                    <div className="flex justify-between text-yellow-300 col-span-2 border-t border-slate-600 pt-2">
                      <span>❓ No catalogadas:</span><span className="font-mono">{stats['no-catalogadas']}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Descargas */}
            {downloadLinks.length > 0 && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold text-white mb-3">📥 Archivos generados:</h3>
                <div className="space-y-2">
                  {downloadLinks.map((link, i) => (
                    <button key={i} onClick={() => handleDownload(link.content, link.filename)}
                      className="flex items-center justify-between p-3 bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors w-full text-left">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{colorEmoji[link.binder]}</span>
                        <div>
                          <p className="text-white font-medium">{link.filename}</p>
                          <p className="text-slate-300 text-sm">{link.count} cartas</p>
                        </div>
                      </div>
                      <i data-lucide="download" className="w-5 h-5 text-slate-300"></i>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-400">💡 En Moxfield: importa cada archivo y selecciona el binder correspondiente.</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-900/50 border border-red-700 rounded-lg p-4 flex items-start gap-3">
                <i data-lucide="alert-circle" className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"></i>
                <p className="text-red-200 text-sm">{error}</p>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<ManaboxToMoxfield />, document.getElementById('root'));
setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 100);
