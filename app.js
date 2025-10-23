const { useState } = React;
const { Upload, Download, AlertCircle, CheckCircle, Database, ExternalLink } = lucide;

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
      const bulkResponse = await fetch('https://api.scryfall.com/bulk-data');
      
      if (!bulkResponse.ok) {
        throw new Error('No se pudo conectar con Scryfall');
      }
      
      const bulkData = await bulkResponse.json();
      const defaultCards = bulkData.data.find(item => item.type === 'default_cards');
      
      if (!defaultCards) {
        throw new Error('No se pudo encontrar la base de datos de cartas');
      }
      
      setProgress('Descargando base de datos completa... esto puede tardar 1-2 minutos (~500MB)');
      
      const cardsResponse = await fetch(defaultCards.download_uri);
      
      if (!cardsResponse.ok) {
        throw new Error('Error al descargar la base de datos');
      }
      
      setProgress('Procesando base de datos...');
      const cardsData = await cardsResponse.json();
      
      const colorMap = {};
      const nameIndex = {};
      const collectorIndex = {};
      
      console.log('📚 Iniciando indexación automática de base de datos...');
      
      cardsData.forEach((card, index) => {
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
        
        if (index % 20000 === 0 && index > 0) {
          console.log(`   Procesadas ${index.toLocaleString()} cartas...`);
        }
      });
      
      console.log('✅ Indexación automática completada:');
      console.log(`   - colorMap: ${Object.keys(colorMap).length.toLocaleString()} cartas`);
      console.log(`   - nameIndex: ${Object.keys(nameIndex).length.toLocaleString()} cartas`);
      console.log(`   - collectorIndex: ${Object.keys(collectorIndex).length.toLocaleString()} cartas`);
      
      setCardDatabase(colorMap);
      setCardNameIndex(nameIndex);
      setCardCollectorIndex(collectorIndex);
      setProgress(`✓ Base de datos cargada: ${Object.keys(colorMap).length.toLocaleString()} cartas`);
      setDbLoading(false);
      
    } catch (err) {
      setError(`No se pudo descargar automáticamente: ${err.message}. Por favor usa la Opción B (Carga Manual).`);
      setDbLoading(false);
      setProgress('');
    }
  };

  const handleDatabaseUpload = async (event) => {
    const dbFile = event.target.files[0];
    if (!dbFile) return;
    
    setProgress('Cargando base de datos...');
    setError('');
    
    try {
      const text = await dbFile.text();
      const cardsData = JSON.parse(text);
      
      const colorMap = {};
      const nameIndex = {};
      const collectorIndex = {};
      
      console.log('📚 Iniciando indexación de base de datos...');
      
      cardsData.forEach((card, index) => {
        // Índice por Scryfall ID
        if (card.id && card.color_identity !== undefined) {
          colorMap[card.id] = card.color_identity;
        }
        
        // Índice por Nombre + Set
        if (card.name && card.set) {
          const key = `${card.name.toLowerCase()}|${card.set.toLowerCase()}`;
          nameIndex[key] = card.color_identity || [];
        }
        
        // Índice por Set + Número de Colección (para búsqueda en Fase 2)
        if (card.set && card.collector_number) {
          const collectorKey = `${card.set.toLowerCase()}|${card.collector_number}`;
          collectorIndex[collectorKey] = {
            color_identity: card.color_identity || [],
            name: card.name
          };
        }
        
        // Progreso cada 20000 cartas
        if (index % 20000 === 0 && index > 0) {
          console.log(`   Procesadas ${index.toLocaleString()} cartas...`);
        }
      });
      
      console.log('✅ Indexación completada:');
      console.log(`   - colorMap: ${Object.keys(colorMap).length.toLocaleString()} cartas`);
      console.log(`   - nameIndex: ${Object.keys(nameIndex).length.toLocaleString()} cartas`);
      console.log(`   - collectorIndex: ${Object.keys(collectorIndex).length.toLocaleString()} cartas`);
      
      setCardDatabase(colorMap);
      setCardNameIndex(nameIndex);
      setCardCollectorIndex(collectorIndex);
      setProgress(`✓ Base de datos cargada: ${Object.keys(colorMap).length.toLocaleString()} cartas`);
      
    } catch (err) {
      setError(`Error al cargar la base de datos: ${err.message}`);
      console.error('❌ Error completo:', err);
    }
  };

  const parseTxtFormat = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const cards = [];
    
    lines.forEach(line => {
      const match = line.match(/^(\d+)\s+(.+?)\s+\(([^)]+)\)\s+(\d+)(.*)$/);
      if (match) {
        const [, quantity, name, setCode, collectorNumber, rest] = match;
        const isFoil = rest.includes('*F*');
        
        cards.push({
          Quantity: quantity,
          Name: name.trim(),
          'Set code': setCode.trim(),
          'Collector number': collectorNumber,
          Foil: isFoil ? 'foil' : 'normal',
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
    
    const colorMap = {
      'W': 'blanco',
      'U': 'azul',
      'B': 'negro',
      'R': 'rojo',
      'G': 'verde'
    };
    
    return colorMap[colorIdentity[0]] || 'incoloro';
  };

  const processCards = async (cards) => {
    if (cards.length === 0) {
      throw new Error('El archivo está vacío o no tiene el formato correcto');
    }
    
    setProgress(`🔍 FASE 1: Búsqueda estándar de ${cards.length} cartas...`);
    
    const moxfieldData = [];
    const notFoundInPhase1 = [];
    const binderStats = {
      blanco: 0,
      azul: 0,
      negro: 0,
      rojo: 0,
      verde: 0,
      multicolor: 0,
      incoloro: 0,
      'no-catalogadas': 0
    };
    let phase1FoundCount = 0;
    let totalCardsCount = 0;
    
    // FASE 1: Búsqueda estándar
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const quantity = parseInt(card.Quantity) || 1;
      totalCardsCount += quantity;
      
      const scryfallId = card['Scryfall ID']?.trim();
      let binder = null;
      let colorIdentity = null;
      let found = false;
      
      if (scryfallId && cardDatabase[scryfallId] !== undefined) {
        colorIdentity = cardDatabase[scryfallId];
        binder = assignBinder(colorIdentity);
        found = true;
        phase1FoundCount++;
      } else if (card.Name && card['Set code'] && cardNameIndex) {
        const key = `${card.Name.toLowerCase()}|${card['Set code'].toLowerCase()}`;
        if (cardNameIndex[key] !== undefined) {
          colorIdentity = cardNameIndex[key];
          binder = assignBinder(colorIdentity);
          found = true;
          phase1FoundCount++;
        }
      }
      
      if (!found) {
        notFoundInPhase1.push({
          card: card,
          index: i
        });
        binder = 'no-catalogadas';
      }
      
      binderStats[binder] += quantity;
      
      const conditionMap = {
        'near_mint': 'Near Mint',
        'lightly_played': 'Lightly Played',
        'moderately_played': 'Moderately Played',
        'heavily_played': 'Heavily Played',
        'damaged': 'Damaged'
      };
      const condition = conditionMap[card.Condition] || 'Near Mint';
      const language = (card.Language || 'en').toUpperCase();
      const foil = card.Foil === 'foil' ? 'foil' : '';
      
      moxfieldData.push({
        Count: quantity,
        Name: card.Name,
        Edition: card['Set code'],
        Condition: condition,
        Language: language,
        Foil: foil,
        Tags: binder,
        _tempIndex: i
      });
    }
    
    console.log(`✅ Fase 1 completada: ${phase1FoundCount} cartas únicas encontradas, ${notFoundInPhase1.length} pendientes`);
    
    // FASE 2: Búsqueda por Set + Número de Colección
    let phase2FoundCount = 0;
    
    if (notFoundInPhase1.length > 0 && cardCollectorIndex) {
      setProgress(`🔍 FASE 2: Búsqueda avanzada de ${notFoundInPhase1.length} cartas por Set + Número...`);
      
      for (const item of notFoundInPhase1) {
        const card = item.card;
        const collectorNumber = card['Collector number']?.toString().trim();
        
        if (card['Set code'] && collectorNumber) {
          const collectorKey = `${card['Set code'].toLowerCase()}|${collectorNumber}`;
          
          if (cardCollectorIndex[collectorKey]) {
            const cardInfo = cardCollectorIndex[collectorKey];
            const colorIdentity = cardInfo.color_identity;
            const newBinder = assignBinder(colorIdentity);
            
            const cardInData = moxfieldData.find(c => c._tempIndex === item.index);
            if (cardInData) {
              const quantity = parseInt(cardInData.Count) || 1;
              
              binderStats['no-catalogadas'] -= quantity;
              cardInData.Tags = newBinder;
              binderStats[newBinder] += quantity;
              
              phase2FoundCount++;
              console.log(`✅ [Fase 2] ${card.Name}: Encontrada por ${card['Set code']}|${collectorNumber} → ${newBinder} (DB: ${cardInfo.name})`);
            }
          }
        }
      }
      
      const stillNotFound = notFoundInPhase1.length - phase2FoundCount;
      console.log(`✅ Fase 2 completada: ${phase2FoundCount} adicionales encontradas, ${stillNotFound} sin catalogar`);
    }
    
    const totalFoundCount = phase1FoundCount + phase2FoundCount;
    const totalNotFoundCount = cards.length - totalFoundCount;
    
    console.log(`📊 Resumen final: ${totalFoundCount}/${cards.length} cartas únicas catalogadas`);
    
    moxfieldData.forEach(card => delete card._tempIndex);
    
    setProgress('📝 Generando archivos CSV por color...');
    
    const cardsByBinder = {
      blanco: [],
      azul: [],
      negro: [],
      rojo: [],
      verde: [],
      multicolor: [],
      incoloro: [],
      'no-catalogadas': []
    };
    
    moxfieldData.forEach(card => {
      cardsByBinder[card.Tags].push(card);
    });
    
    const links = [];
    const originalName = file.name.replace(/\.(csv|txt)$/, '');
    
    Object.entries(cardsByBinder).forEach(([binder, cards]) => {
      if (cards.length === 0) return;
      
      const cardsWithoutTags = cards.map(({ Tags, ...rest }) => rest);
      
      const csvContent = Papa.unparse(cardsWithoutTags, {
        quotes: true,
        header: true
      });
      
      links.push({
        binder,
        filename: `${originalName}_${binder}.csv`,
        content: csvContent,
        count: cards.length
      });
    });
    
    setDownloadLinks(links);
    setStats(binderStats);
    setCompleted(true);
    
    const notFoundCardsCount = binderStats['no-catalogadas'];
    setProgress(`🎉 ¡Completado! ${links.length} archivos generados. ${totalFoundCount}/${cards.length} cartas únicas catalogadas (${totalCardsCount} cartas totales contando cantidades)${notFoundCardsCount > 0 ? `, ${totalNotFoundCount} únicas sin catalogar (${notFoundCardsCount} copias)` : ''}`);
    setProcessing(false);
  };

  const processFile = async () => {
    if (!file || !cardDatabase) return;
    
    setProcessing(true);
    setError('');
    setCompleted(false);
    setProgress('Leyendo archivo...');
    
    try {
      const text = await file.text();
      const isTxtFormat = file.name.endsWith('.txt');
      
      if (isTxtFormat) {
        const cards = parseTxtFormat(text);
        if (cards.length === 0) {
          throw new Error('No se pudieron leer cartas del archivo TXT');
        }
        await processCards(cards);
      } else {
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          complete: async (results) => {
            try {
              await processCards(results.data);
            } catch (err) {
              setError(`Error al procesar: ${err.message}`);
              setProcessing(false);
            }
          },
          error: (err) => {
            setError(`Error al leer el archivo: ${err.message}`);
            setProcessing(false);
          }
        });
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="bg-slate-800 rounded-lg shadow-2xl p-8 border border-slate-700">
          <h1 className="text-3xl font-bold text-white mb-2">
            Convertidor Manabox → Moxfield
          </h1>
          <p className="text-slate-400 mb-6">
            Convierte tu colección de Manabox a formato Moxfield con binders por color
          </p>
          
          <div className="space-y-6">
            <div className="bg-slate-700 rounded-lg p-4 space-y-2 text-sm text-slate-300">
              <h3 className="font-semibold text-white">Cómo usar:</h3>
              <ol className="space-y-2 ml-4 list-decimal">
                <li>Carga la base de datos (automática o manual)</li>
                <li>Selecciona tu archivo de Manabox (CSV o TXT)</li>
                <li>Haz clic en "Convertir y Descargar"</li>
                <li>Descarga cada archivo CSV por color</li>
                <li>Importa cada archivo en Moxfield seleccionando su binder</li>
              </ol>
              <p className="mt-3 text-xs text-slate-400">
                ℹ️ Nota: Si Manabox te exporta archivos .txt en lugar de .csv, ¡no hay problema! La herramienta acepta ambos formatos.
              </p>
            </div>
              <p className="mt-3 text-xs text-slate-400">
                ℹ️ Nota: Si Manabox te exporta archivos .txt en lugar de .csv, ¡no hay problema! La herramienta acepta ambos formatos.
              </p>
            </div>

            {!cardDatabase && (
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <i data-lucide="database" className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5"></i>
                  <div className="flex-1">
                    <h3 className="text-blue-200 font-semibold mb-2">Paso 1: Cargar base de datos de Scryfall</h3>
                    <p className="text-blue-300 text-sm mb-4">
                      Elige una de las dos opciones para cargar la base de datos:
                    </p>
                    
                    <div className="space-y-3">
                      {/* Opción Automática */}
                      <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                        <div className="flex items-center gap-2 mb-2">
                          <i data-lucide="zap" className="w-4 h-4 text-yellow-400"></i>
                          <h4 className="text-white font-semibold text-sm">Opción A: Descarga Automática (Recomendado)</h4>
                        </div>
                        <p className="text-slate-300 text-xs mb-3">
                          Descarga la base de datos directamente desde Scryfall. Requiere buena conexión a internet.
                        </p>
                        <button
                          onClick={loadScryfallDatabaseAuto}
                          disabled={dbLoading}
                          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <i data-lucide="zap" className="w-4 h-4"></i>
                          {dbLoading ? 'Descargando...' : 'Descargar Automáticamente'}
                        </button>
                      </div>
                      
                      {/* Opción Manual */}
                      <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
                        <div className="flex items-center gap-2 mb-2">
                          <i data-lucide="upload" className="w-4 h-4 text-green-400"></i>
                          <h4 className="text-white font-semibold text-sm">Opción B: Carga Manual</h4>
                        </div>
                        <p className="text-slate-300 text-xs mb-2">
                          Si la descarga automática no funciona, descarga el archivo manualmente:
                        </p>
                        <ol className="text-slate-300 text-xs mb-3 ml-4 space-y-1 list-decimal">
                          <li>Haz clic en el enlace de abajo</li>
                          <li>Busca "Default Cards" en la tabla</li>
                          <li>Haz clic en "Download" para descargar el JSON</li>
                          <li>Sube el archivo aquí</li>
                        </ol>
                        <a 
                          href="https://scryfall.com/docs/api/bulk-data"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200 text-xs mb-3 underline"
                        >
                          <i data-lucide="external-link" className="w-3 h-3"></i>
                          Abrir página de descargas de Scryfall
                        </a>
                        <label className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer text-sm mt-3">
                          <i data-lucide="upload" className="w-4 h-4"></i>
                          Subir Archivo JSON Descargado
                          <input
                            type="file"
                            accept=".json"
                            onChange={handleDatabaseUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {cardDatabase && (
              <div className="bg-green-900/30 border border-green-700 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <i data-lucide="check-circle" className="w-5 h-5 text-green-400"></i>
                  <p className="text-green-200 text-sm">
                    Base de datos cargada. Ahora puedes convertir tus archivos CSV o TXT.
                  </p>
                </div>
              </div>
            )}
            
            <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              cardDatabase ? 'border-slate-600 hover:border-slate-500 cursor-pointer' : 'border-slate-700 opacity-50'
            }`}>
              <i data-lucide="upload" className="w-12 h-12 text-slate-400 mx-auto mb-4"></i>
              <label className={cardDatabase ? 'cursor-pointer' : 'cursor-not-allowed'}>
                <span className="text-white font-medium">
                  {file ? file.name : 'Paso 2: Selecciona tu archivo de Manabox (CSV o TXT)'}
                </span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => {
                    setFile(e.target.files[0]);
                    setCompleted(false);
                    setError('');
                    setStats(null);
                    setDownloadLinks([]);
                  }}
                  className="hidden"
                  disabled={processing || !cardDatabase}
                />
              </label>
              {file && (
                <p className="text-slate-400 text-sm mt-2">
                  Archivo seleccionado: {file.name}
                </p>
              )}
            </div>
            
            <button
              onClick={processFile}
              disabled={!file || processing || !cardDatabase}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <i data-lucide="download" className="w-5 h-5"></i>
              {processing ? 'Procesando...' : 'Paso 3: Convertir y Descargar'}
            </button>
            
            {progress && (
              <div className={`rounded-lg p-4 ${completed ? 'bg-green-900/50 border border-green-700' : 'bg-slate-700'}`}>
                <div className="flex items-center gap-2">
                  {completed && <i data-lucide="check-circle" className="w-5 h-5 text-green-400"></i>}
                  <p className={`text-sm ${completed ? 'text-green-200' : 'text-slate-200'}`}>{progress}</p>
                </div>
              </div>
            )}
            
            {stats && (
              <div className="bg-slate-700 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-white mb-3">Resumen de la colección:</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between text-slate-300">
                    <span>⚪ Blanco:</span>
                    <span className="font-mono">{stats.blanco}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>🔵 Azul:</span>
                    <span className="font-mono">{stats.azul}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>⚫ Negro:</span>
                    <span className="font-mono">{stats.negro}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>🔴 Rojo:</span>
                    <span className="font-mono">{stats.rojo}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>🟢 Verde:</span>
                    <span className="font-mono">{stats.verde}</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span>🌈 Multicolor:</span>
                    <span className="font-mono">{stats.multicolor}</span>
                  </div>
                  <div className="flex justify-between text-slate-300 col-span-2">
                    <span>⚪ Incoloro:</span>
                    <span className="font-mono">{stats.incoloro}</span>
                  </div>
                  {stats['no-catalogadas'] > 0 && (
                    <div className="flex justify-between text-yellow-300 col-span-2 border-t border-slate-600 pt-2 mt-2">
                      <span>❓ No catalogadas:</span>
                      <span className="font-mono">{stats['no-catalogadas']}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {downloadLinks.length > 0 && (
              <div className="bg-slate-700 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-white mb-3">📥 Archivos generados - Haz clic para descargar:</h3>
                <div className="space-y-2">
                  {downloadLinks.map((link, index) => {
                    const colorEmoji = {
                      blanco: '⚪',
                      azul: '🔵',
                      negro: '⚫',
                      rojo: '🔴',
                      verde: '🟢',
                      multicolor: '🌈',
                      incoloro: '⚪',
                      'no-catalogadas': '❓'
                    };
                    
                    return (
                      <button
                        key={index}
                        onClick={() => handleDownload(link.content, link.filename)}
                        className="flex items-center justify-between p-3 bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors w-full text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">{colorEmoji[link.binder]}</span>
                          <div>
                            <p className="text-white font-medium">{link.filename}</p>
                            <p className="text-slate-300 text-sm">{link.count} cartas</p>
                          </div>
                        </div>
                        <i data-lucide="download" className="w-5 h-5 text-slate-300"></i>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  💡 Tip: En Moxfield, importa cada archivo y selecciona el binder correspondiente durante la importación
                </p>
              </div>
            )}
            
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

// Renderizar la aplicación
ReactDOM.render(<ManaboxToMoxfield />, document.getElementById('root'));

// Inicializar iconos de Lucide después del render
setTimeout(() => {
  if (window.lucide) {
    lucide.createIcons();
  }
}, 100);
