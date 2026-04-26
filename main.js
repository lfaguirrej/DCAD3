import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { IFCLoader } from 'web-ifc-three/IFCLoader';

let scene, camera, renderer, controls, model, edges;
let pivotGroup, offsetGroup;
let ifcLoader, reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;
let loadedModels = [];
let uiContainer;
let currentModelUrl = null; // Para persistencia

// --- Estado de Alineación de 3 Puntos ---
let modelPoints = [null, null, null];
let realPoints = [null, null, null];
let activePointType = null;
let activePointIdx = null;
let alignMarkers = { model: [], real: [] };
let isAligned = false; // Bloquear reposicionamiento automático por toques de pantalla post-alineación

// Estado de Drag & Drop para puntos del modelo
let dragTarget = null;
let controlsWereEnabled = true;

// Definición robusta del logger global
window.screenLog = function (msg, isError = false) {
    const consoleDiv = document.getElementById('debug-content');
    if (consoleDiv) {
        const entry = document.createElement('div');
        entry.style.color = isError ? '#ff4444' : '#00ff00';
        entry.style.marginBottom = '4px';
        entry.style.borderLeft = `3px solid ${isError ? '#ff4444' : '#00ff00'}`;
        entry.style.paddingLeft = '5px';
        entry.textContent = `> ${msg}`;
        consoleDiv.appendChild(entry);
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
};

// --- Inicialización Directa ---
screenLog('Visor: Iniciando Motor...');
init();

async function init() {
    const container = document.getElementById('canvas-container');
    uiContainer = document.getElementById('ui-container');

    // --- 1. Lógica de Pestañas (Prioritaria) ---
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const targetId = btn.getAttribute('data-tab');
            const targetPanel = document.getElementById(targetId);

            if (targetPanel) {
                tabButtons.forEach(b => b.classList.remove('active'));
                tabPanels.forEach(p => p.classList.remove('active'));

                btn.classList.add('active');
                targetPanel.classList.add('active');
                screenLog(`Cambiando a: ${btn.textContent}`);
            } else {
                screenLog(`Error: No existe el panel ${targetId}`, true);
            }
        };
    });


    // Unified Bottom Bar Controls (Panel | AR | Refresh)
    const btnQuickPanel = document.getElementById('quick-panel-btn');
    const btnStartAR = document.getElementById('start-ar-custom-btn');
    const btnArExit = document.getElementById('ar-exit-btn');
    const btnRefresh = document.getElementById('refresh-btn-unified');

    // Funcción auxiliar para asignar eventos de clic y toque sin doble disparo
    const setUnifiedHandler = (btn, handler) => {
        if (!btn) return;
        
        let lastTrigger = 0;
        const safeHandler = (e) => {
            const now = Date.now();
            if (now - lastTrigger < 250) return; // Bloquear activaciones múltiples en < 250ms
            lastTrigger = now;
            handler(e);
        };

        // Click estándar (Escritorio / Fallback)
        btn.addEventListener('click', (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            safeHandler(e);
        });

        // Touch táctil (Móvil - Respuesta inmediata)
        btn.addEventListener('touchstart', (e) => {
            if (e) { e.stopPropagation(); }
            safeHandler(e);
        }, { passive: true });
    };

    // Mover el botón flotante de refresco a la barra unificada
    setUnifiedHandler(btnRefresh, () => window.location.reload());

    setUnifiedHandler(btnQuickPanel, (e) => {
        // Lógica de "Interruptor": Abre o Cierra el panel de controles
        const isVisible = uiContainer.classList.contains('active') && !uiContainer.classList.contains('ui-minimized');

        if (isVisible) {
            // Si está abierto, lo minimizamos y escondemos
            uiContainer.classList.remove('active');
            uiContainer.classList.add('ui-minimized');
            btnQuickPanel.innerHTML = '📂 Abrir Panel';
            screenLog('📉 Panel oculto');
        } else {
            // Si está cerrado, lo mostramos completo
            uiContainer.classList.add('active');
            uiContainer.classList.remove('ui-minimized');
            btnQuickPanel.innerHTML = '➕ Cerrar';
            screenLog('📈 Panel abierto');
        }
    });

    setUnifiedHandler(btnStartAR, (e) => {
        const realARButton = document.getElementById('ARButton');
        if (realARButton) {
            const isNotSupported = realARButton.tagName.toLowerCase() === 'a' || 
                                 realARButton.textContent.includes('NOT SUPPORTED') || 
                                 realARButton.textContent.includes('AVAILABLE');
            
            if (isNotSupported) {
                alert('Realidad Aumentada (WebXR) no soportada en este dispositivo o navegador (iOS requiere App compatible o Mozilla WebXR Viewer).');
                screenLog('⚠️ Error: AR no soportado nativamente en este navegador', true);
            } else {
                realARButton.click();
            }
        } else {
            screenLog('⚠️ Error: AR no disponible en este dispositivo', true);
            alert('El motor AR aún no se ha iniciado o no está disponible.');
        }
    });

    setUnifiedHandler(btnArExit, (e) => {
        const session = renderer.xr.getSession();
        if (session) {
            session.end();
        }
    });


    // --- 2. Inicialización Three.js ---
    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f172a);

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 2000);
        camera.position.set(5, 5, 5);

        renderer = new THREE.WebGLRenderer({ 
            antialias: true, 
            alpha: true, 
            logarithmicDepthBuffer: false,
            powerPreference: 'high-performance'
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x0f172a, 1);
        renderer.xr.enabled = true;
        renderer.outputColorSpace = THREE.SRGBColorSpace; 
        container.appendChild(renderer.domElement);

        // Ajuste inicial de tamaño (suficiente; onWindowResize solo actualiza aspect+size)
        onWindowResize();
        setTimeout(onWindowResize, 600);

        // AR Setup con Image Tracking (Experimental)
        let arOptions = {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay', 'image-tracking'],
            domOverlay: { root: document.getElementById('ui-wrapper') }
        };

        try {
            // Intentamos cargar el marcador predefinido
            const res = await fetch('/marcador-dcad.png');
            if (res.ok) {
                const blob = await res.blob();
                const bitmap = await createImageBitmap(blob);
                arOptions.trackedImages = [{ image: bitmap, widthInMeters: 0.2 }];
                screenLog('📷 Marcador AR cargado');
            }
        } catch (e) {
            console.warn('Image Tracking no soportado o marcador ausente');
        }

        const arButton = ARButton.createButton(renderer, arOptions);

        // Forzar asignación del ID en caso que sea el fallback anchor <a href> de iOS
        // para que CSS pueda ocultarlo.
        arButton.id = 'ARButton';

        document.body.appendChild(arButton);

        // Luces: ambient 0.7 asegura que el sólido sea visible en cualquier GPU móvil.
        // No reducir más de 0.6 o el sólido se confunde con el fondo oscuro.
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        scene.add(new THREE.HemisphereLight(0xffffff, 0x334466, 0.8));

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(10, 20, 10);
        scene.add(dirLight);

        const pointLight = new THREE.PointLight(0xffffff, 1.5);
        pointLight.position.set(-10, -10, -10);
        scene.add(pointLight);

        // Luz que sigue a la cámara para asegurar iluminación frontal (mejora profundidad)
        const cameraLight = new THREE.PointLight(0xffffff, 1);
        camera.add(cameraLight);
        scene.add(camera);

        // Ayuda visual: Rejilla para referencia de escala y posición
        const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        scene.add(grid);

        // Controls
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // Groups
        pivotGroup = new THREE.Group();
        offsetGroup = new THREE.Group();
        pivotGroup.add(offsetGroup);
        scene.add(pivotGroup);

        initReticle();

        // Loaders
        ifcLoader = new IFCLoader();
        // Usamos ruta relativa vacía para que Vercel encuentre los archivos en la raíz del despliegue 'dist'
        ifcLoader.ifcManager.setWasmPath(''); 
        ifcLoader.ifcManager.useWebWorkers(false);
        screenLog('Motor IFC: Configurado');

        // --- Eventos de Sesión AR para UI ---
        renderer.xr.addEventListener('sessionstart', () => {
            screenLog('🚀 Sesión AR Iniciada');
            
            // CRITICAL: Para que se vea la realidad en iPhone/Android, el fondo debe ser transparente
            scene.background = null;
            renderer.setClearAlpha(0);

            document.body.classList.add('ar-active');
            document.documentElement.classList.add('ar-active');
            uiContainer.classList.add('ar-mode');

            // Forzar visibilidad de la barra inferior
            const bottomBar = document.getElementById('unified-bottom-controls');
            if (bottomBar) {
                bottomBar.style.display = 'flex';
                bottomBar.style.opacity = '1';
                bottomBar.style.visibility = 'visible';
            }
        });

        renderer.xr.addEventListener('sessionend', () => {
            screenLog('🚪 Sesión AR Finalizada');
            cleanupSession();

            // Restaurar fondo original
            scene.background = new THREE.Color(0x0f172a);
            renderer.setClearColor(0x0f172a, 1);

            // Forzar reflow/resize para evitar problemas de layout en iOS tras salir de AR
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                fitCameraToObject(pivotGroup);
            }, 200);
        });

    } catch (err) {
        screenLog('ERR-INIT: ' + err.message, true);
    }

    // --- 3. Handlers de Interfaz ---

    // Nudge controls
    document.querySelectorAll('.nudge-btn').forEach(btn => {
        btn.onclick = () => {
            const axis = btn.dataset.axis;
            const dir = parseFloat(btn.dataset.dir);
            nudgeModel(axis, dir);
        };
    });

    // Shading toggle (Synced)
    const shadeMove = document.getElementById('shading-toggle-move');
    const shadeRotate = document.getElementById('shading-toggle-rotate');
    const shadeScale = document.getElementById('shading-toggle-scale');

    const syncShading = (checked) => {
        if (model) model.visible = checked;
        if (shadeMove) shadeMove.checked = checked;
        if (shadeRotate) shadeRotate.checked = checked;
        if (shadeScale) shadeScale.checked = checked;
    };

    if (shadeMove) shadeMove.onchange = () => syncShading(shadeMove.checked);
    if (shadeRotate) shadeRotate.onchange = () => syncShading(shadeRotate.checked);
    if (shadeScale) shadeScale.onchange = () => syncShading(shadeScale.checked);

    // Upload
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('model-upload');
    if (uploadBtn && fileInput) {
        uploadBtn.onclick = () => fileInput.click();
        fileInput.onchange = handleUpload;
    }

    // --- 4. Handlers de Alineación ---
    setupAlignmentHandlers();

    const purgeBtn = document.getElementById('btn-purge-storage');
    if (purgeBtn) {
        purgeBtn.onclick = () => {
            if (confirm('¿Borrar toda la memoria de alineaciones y escalas? La app se reiniciará.')) {
                localStorage.clear();
                window.location.reload();
            }
        };
    }

    initModelList();
    window.addEventListener('resize', onWindowResize);
    animate();
}

async function initModelList() {
    addModelToList('Cercha', '/Ejemplos/A-S-2.ifc', 'ifc', true);
    addModelToList('Caja 30x40x50', 'box-30-40-50', 'shape', true);
    addModelToList('Cilindro Ø60 x 40h', 'cylinder-60-40-1', 'shape', true);
    try {
        const res = await fetch('/models');
        if (res.ok) {
            const list = await res.json();
            list.forEach(m => addModelToList(m.name, m.url, m.type, false));
        }
    } catch (e) { console.warn('No se pudo conectar al servidor de modelos'); }
    loadIFC('/Ejemplos/A-S-2.ifc');
}

function addModelToList(name, url, type, isExample) {
    if (loadedModels.some(m => m.url === url)) return;
    loadedModels.push({ name, url, type, isExample });

    const container = document.getElementById('loaded-models-list');
    if (!container) return;

    const item = document.createElement('div');
    item.className = 'model-item';
    item.innerHTML = `
        <div class="model-info">${name}</div>
        <div class="model-actions">
            <button class="model-action-btn load">Ver</button>
            ${!isExample ? '<button class="model-action-btn delete">X</button>' : ''}
        </div>
    `;

    const loadBtn = item.querySelector('.load');
    const handleAction = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Feedback visual inmediato
        const originalText = loadBtn.textContent;
        loadBtn.textContent = '...';
        loadBtn.style.opacity = '0.5';

        screenLog(`Solicitando carga: ${name}`);

        const onComplete = () => {
            loadBtn.textContent = originalText;
            loadBtn.style.opacity = '1';
        };

        if (type === 'ifc') {
            loadIFC(url).finally(onComplete);
        } else if (type === 'shape') {
            const parts = url.split('-');
            generateShape(parts[0], parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
            onComplete();
        } else {
            loadModel(url); // loadModel no es async aún, pero lo manejamos
            setTimeout(onComplete, 1000);
        }
    };

    loadBtn.onclick = handleAction;
    loadBtn.ontouchstart = handleAction; // Resonancia rápida en celular

    const del = item.querySelector('.delete');
    if (del) del.onclick = (e) => {
        e.stopPropagation();
        item.remove();
        loadedModels = loadedModels.filter(m => m.url !== url);
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };

    container.appendChild(item);
}

function resetAlignmentGroups() {
    offsetGroup.clear();
    offsetGroup.position.set(0, 0, 0);
    offsetGroup.rotation.set(0, 0, 0);
    offsetGroup.scale.set(1, 1, 1);
    pivotGroup.position.set(0, 0, 0);
    pivotGroup.rotation.set(0, 0, 0);
    model = null; edges = null;
    isAligned = false;
}

// --- Lógica de Persistencia ---
function saveModelAlignment() {
    if (!currentModelUrl) return;

    const data = {
        pivot: {
            pos: pivotGroup.position.toArray(),
            rot: pivotGroup.quaternion.toArray(),
            scale: pivotGroup.scale.toArray()
        },
        offset: {
            pos: offsetGroup.position.toArray(),
            rot: offsetGroup.quaternion.toArray(),
            scale: offsetGroup.scale.toArray()
        },
        timestamp: Date.now()
    };

    localStorage.setItem(`dcad_align_${currentModelUrl}`, JSON.stringify(data));
    console.log(`Guardada persistencia para: ${currentModelUrl}`);
}

function restoreModelAlignment(url) {
    const saved = localStorage.getItem(`dcad_align_${url}`);
    if (!saved) return false;

    try {
        const data = JSON.parse(saved);

        // Restaurar Pivot (Alineación 3 puntos)
        pivotGroup.position.fromArray(data.pivot.pos);
        pivotGroup.quaternion.fromArray(data.pivot.rot);
        pivotGroup.scale.fromArray(data.pivot.scale);

        // Restaurar Offset (Ajustes manuales)
        offsetGroup.position.fromArray(data.offset.pos);
        offsetGroup.quaternion.fromArray(data.offset.rot);
        offsetGroup.scale.fromArray(data.offset.scale);

        isAligned = true;
        screenLog('♻️ Alineación restaurada');
        return true;
    } catch (e) {
        console.error('Error restaurando persistencia:', e);
        return false;
    }
}

function cleanupSession() {
    screenLog('Limpiando estado de interfaz...');

    // Resetear posición y rotación del modelo al origen original
    if (pivotGroup) {
        pivotGroup.position.set(0, 0, 0);
        pivotGroup.quaternion.set(0, 0, 0, 1);
        pivotGroup.scale.set(1, 1, 1);
    }
    
    // También reseteamos el offset manual si se desea volver al estado "virgen"
    if (offsetGroup) {
        offsetGroup.position.set(0, 0, 0);
        offsetGroup.quaternion.set(0, 0, 0, 1);
    }

    isAligned = false; // Resetear estado de alineación para permitir re-posicionamiento
    
    // Resetear banderas de WebXR para permitir reinicio de sesión
    hitTestSource = null;
    hitTestSourceRequested = false;
    if (reticle) reticle.visible = false;
    
    // Limpiar clases de estado AR/UI
    document.body.classList.remove('ar-active');
    document.documentElement.classList.remove('ar-active');

    if (uiContainer) {
        uiContainer.classList.remove('ar-mode', 'ui-minimized');
        // Asegurarse de que si el panel estaba abierto en AR, conserve su estado o sea visible
        uiContainer.style.display = '';
        uiContainer.style.visibility = '';
        uiContainer.style.opacity = '';
    }

    const uiWrapper = document.getElementById('ui-wrapper');
    if (uiWrapper) {
        uiWrapper.style.display = 'block';
        uiWrapper.style.visibility = 'visible';
        uiWrapper.style.opacity = '1';
        uiWrapper.style.pointerEvents = 'none'; // Permitir toques en el canvas inferior
    }

    const bottomControls = document.getElementById('unified-bottom-controls');
    if (bottomControls) {
        bottomControls.style.display = 'flex';
        bottomControls.style.visibility = 'visible';
        bottomControls.style.opacity = '1';
    }

    // Forzar un reflow global
    window.scrollTo(0, 0);
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        if (pivotGroup) fitCameraToObject(pivotGroup);
    }, 150);
}

function nudgeModel(axis, dir) {
    const moveStepInput = document.getElementById('move-step-input');
    const rotateStepInput = document.getElementById('rotate-step-input');
    const scaleStepInput = document.getElementById('scale-step-input');

    const step = moveStepInput ? parseFloat(moveStepInput.value) : 0.05;
    const rotDeg = rotateStepInput ? parseFloat(rotateStepInput.value) : 5;
    const rotRad = (rotDeg * Math.PI) / 180;
    const scalePct = scaleStepInput ? parseFloat(scaleStepInput.value) : 10;
    const scaleFactor = 1 + (scalePct / 100 * dir);

    if (axis === 'x') offsetGroup.position.x += step * dir;
    if (axis === 'y') offsetGroup.position.y += step * dir;
    if (axis === 'z') offsetGroup.position.z += step * dir;
    if (axis === 'rx') offsetGroup.rotation.x += rotRad * dir;
    if (axis === 'ry') offsetGroup.rotation.y += rotRad * dir;
    if (axis === 'rz') offsetGroup.rotation.z += rotRad * dir;
    if (axis === 's') {
        const newScale = pivotGroup.scale.x * scaleFactor;
        pivotGroup.scale.set(newScale, newScale, newScale);
        screenLog(`📏 Escala: ${(newScale * 100).toFixed(1)}%`);
    }

    saveModelAlignment(); // Persistir ajuste manual
}

function loadModel(url) {
    return new Promise((resolve, reject) => {
        screenLog('📂 Cargando GLB...');
        currentModelUrl = url;
        resetAlignmentGroups();
        new GLTFLoader().load(url, (g) => {
            try {
                model = g.scene;

                // Forzar DoubleSide y desactivar frustumCulled para visibilidad en AR
                model.traverse(c => {
                    if (c.isMesh) {
                        c.material.side = THREE.DoubleSide;
                        c.visible = true;
                        c.frustumCulled = false;
                    }
                });

                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                // Escalar el MODELO (no el offsetGroup) para evitar bugs de propagación
                // de matrices en Vercel. offsetGroup.scale queda siempre en (1,1,1).
                if (size.length() > 500) {
                    model.scale.set(0.001, 0.001, 0.001);
                    model.position.set(-center.x * 0.001, -center.y * 0.001, -center.z * 0.001);
                    screenLog('📏 GLB: Escala mm -> m');
                } else if (size.length() < 0.01) {
                    model.scale.set(100, 100, 100);
                    model.position.set(-center.x * 100, -center.y * 100, -center.z * 100);
                    screenLog('📏 GLB: Escala micro -> m');
                } else {
                    model.scale.set(1, 1, 1);
                    model.position.sub(center);
                }
                offsetGroup.scale.set(1, 1, 1);
                offsetGroup.add(model);

                setTimeout(() => {
                    extractEdges(model);

                    const restored = restoreModelAlignment(url);
                    if (!restored) {
                        fitCameraToObject(offsetGroup);
                        // Segundo ajuste diferido para móvil (viewport puede cambiar al cargar)
                        setTimeout(() => { if (!renderer.xr.isPresenting) fitCameraToObject(offsetGroup); }, 800);

                        if (renderer.xr.isPresenting && reticle.visible) {
                            pivotGroup.position.setFromMatrixPosition(reticle.matrix);
                            pivotGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(reticle.matrix));
                        }
                    }

                    screenLog('✅ GLB Listo');

                    const shadeToggle = document.getElementById('shading-toggle-move');
                    if (shadeToggle) syncShading(shadeToggle.checked);

                    resolve();
                }, 0);
            } catch (e) {
                screenLog(`❌ Error procesando GLB: ${e.message}`, true);
                reject(e);
            }
        }, undefined, (err) => {
            screenLog('❌ Error de red cargando GLB', true);
            reject(err);
        });
    });
}

function extractEdges(source) {
    if (!source) return;
    try {
        // Asegurar que las matrices del modelo están actualizadas antes de extraer
        source.updateMatrixWorld(true);

        const mat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        edges = new THREE.Group();

        source.traverse(c => {
            if (c.isMesh) {
                const geo = new THREE.EdgesGeometry(c.geometry);
                const l = new THREE.LineSegments(geo, mat);
                
                // Los añadimos solo como hijos de la malla
                // Así heredan posición, rotación y escala automáticamente
                c.add(l);
                
                // Les asignamos un nombre para poder borrarlos o manipularlos luego si hace falta
                l.name = 'mesh-edges';
            }
        });

        screenLog('🧩 Bordes vinculados');
    } catch (e) {
        console.error('Error extractEdges:', e);
    }
}

function loadIFC(url) {
    return new Promise((resolve, reject) => {
        screenLog(`📂 Abriendo: ${url.split('/').pop()}`);
        currentModelUrl = url;
        resetAlignmentGroups();

        ifcLoader.load(
            url,
            (ifc) => {
                screenLog('📦 Procesando geometría...');
                try {
                    model = ifc;
                    let meshCount = 0;
                    model.traverse(c => {
                        if (c.isMesh) {
                            meshCount++;
                            // Usar MeshStandardMaterial opaco para máxima solidez y percepción de profundidad en 3D
                            c.material = new THREE.MeshStandardMaterial({ 
                                color: 0x94a3b8, // Gris azulado
                                side: THREE.DoubleSide,
                                transparent: false, // Opaque es mejor para percibir profundidad de sólidos
                                roughness: 0.5,
                                metalness: 0.2
                            });
                            c.material.depthWrite = true;
                            c.material.depthTest = true;
                            c.visible = true;
                            c.frustumCulled = false;
                        }
                    });

                    screenLog(`Meshes encontrados: ${meshCount}`);

                    if (meshCount === 0) {
                        screenLog('⚠️ Modelo sin geometría visible', true);
                        return resolve();
                    }

                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());

                    // FIX DEFINITIVO: Escalar el MODELO, no el offsetGroup.
                    // offsetGroup.scale siempre (1,1,1) → sin bugs de propagación de matrices.
                    // La posición se convierte a metros para que el centro quede en el origen.
                    if (size.length() > 500) {
                        model.scale.set(0.001, 0.001, 0.001);
                        model.position.set(-center.x * 0.001, -center.y * 0.001, -center.z * 0.001);
                        screenLog('📏 IFC: mm → m');
                    } else {
                        model.scale.set(1, 1, 1);
                        model.position.sub(center);
                    }
                    offsetGroup.scale.set(1, 1, 1);
                    offsetGroup.add(model);

                    screenLog('✨ ¡PROYECCIÓN LISTA!');

                    setTimeout(() => {
                        extractEdges(model);

                        const restored = restoreModelAlignment(url);
                        if (!restored) {
                            fitCameraToObject(offsetGroup);
                            // Ajustes diferidos para asegurar que el modelo sea visible tras el renderizado de Vercel
                            setTimeout(() => { if (!renderer.xr.isPresenting) fitCameraToObject(offsetGroup); }, 500);
                            setTimeout(() => { if (!renderer.xr.isPresenting) fitCameraToObject(offsetGroup); }, 1500);
                        }

                        // Forzar visibilidad final con un solo golpe de renderizado
                        model.visible = true;
                        model.traverse(c => { if (c.isMesh) c.visible = true; });
                        
                        // Forzar que los bordes también sean visibles
                        if (edges) edges.visible = true;

                        const shadeToggle = document.getElementById('shading-toggle-move');
                        if (shadeToggle) shadeToggle.checked = true;

                        resolve();
                    }, 0);
                } catch (err) {
                    screenLog(`❌ Error 3D: ${err.message}`, true);
                    reject(err);
                }
            },
            (p) => {
                if (p.total > 0) {
                    const pct = Math.round((p.loaded / p.total) * 100);
                    if (pct % 25 === 0) screenLog(`Cargue: ${pct}%`);
                }
            },
            (err) => {
                screenLog(`❌ Error Red: ${err.message || 'Fallo'}`, true);
                reject(err);
            }
        );
    });
}

async function handleUpload(e) {
    const file = e.target.files[0]; if (!file) return;
    const name = file.name.toLowerCase();
    screenLog('Subiendo archivo...');
    const fd = new FormData(); fd.append('file', file);
    const ep = name.endsWith('.dwg') ? '/convert' : '/upload';

    try {
        const res = await fetch(ep, { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        addModelToList(data.name, data.url, data.type);
        screenLog('✅ Guardado en servidor');

        if (data.type === 'ifc') loadIFC(data.url);
        else loadModel(data.url);

    } catch (err) {
        screenLog(`⚠️ Solo sesión local (${err.message})`, true);
        const u = URL.createObjectURL(file);
        const t = name.endsWith('.ifc') ? 'ifc' : 'glb';
        addModelToList(file.name, u, t);
        if (t === 'ifc') loadIFC(u); else loadModel(u);
    }
}

function fitCameraToObject(obj) {
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fovRad = camera.fov * (Math.PI / 180);

    // En portrait (móvil vertical), el FOV horizontal es más estrecho que el vertical.
    // Hay que usar el FOV horizontal efectivo para que el modelo llene la pantalla.
    // aspectCorrection < 1 en portrait → cámara más cerca proporcionalmente.
    const aspectCorrection = Math.min(camera.aspect, 1.0);
    const cameraDistance = (maxDim / 2) / (Math.tan(fovRad / 2) * aspectCorrection) * 1.2;

    // Elevación 0.5: vista diagonal que muestra profundidad 3D sin exageración
    const direction = new THREE.Vector3(1, 0.5, 1).normalize();
    camera.position.copy(center).addScaledVector(direction, cameraDistance);
    camera.lookAt(center);
    if (controls) { controls.target.copy(center); controls.update(); }
}

function generateShape(type, x_cm, y_cm, z_cm) {
    // Convertir de cm a metros para el motor 3D
    const x = x_cm / 100;
    const y = y_cm / 100;
    const z = z_cm / 100;

    resetAlignmentGroups();
    let geo = type === 'box' ? new THREE.BoxGeometry(x, y, z) :
        type === 'cylinder' ? new THREE.CylinderGeometry(x / 2, x / 2, y, 32) :
            new THREE.SphereGeometry(x / 2, 32, 32);
    model = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.7,
        roughness: 0.5,
        metalness: 0.2
    }));
    model.position.set(0, y / 2, 0);
    offsetGroup.add(model);

    // Extraer bordes para proyectar el contorno verde igual que los modelos CAD
    extractEdges(model);

    fitCameraToObject(offsetGroup);
    screenLog(`✅ Figura (m): ${x.toFixed(3)}x${y.toFixed(3)}x${z.toFixed(3)}`);
}

function initReticle() {
    reticle = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.11, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x60a5fa }));
    reticle.matrixAutoUpdate = false; reticle.visible = false;
    scene.add(reticle);
}

function setupAlignmentHandlers() {
    const pointButtons = document.querySelectorAll('.point-btn');
    pointButtons.forEach(btn => {
        btn.onclick = (e) => {
            if (e) e.stopPropagation();
            pointButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            activePointType = btn.dataset.type;
            activePointIdx = parseInt(btn.dataset.idx);

            // Permite editar un punto ya capturado desactivando su estado "OK"
            if (btn.classList.contains('captured')) {
                btn.classList.remove('captured');
                const prefix = activePointType === 'model' ? 'M' : 'R';
                btn.textContent = `${prefix}${activePointIdx + 1}: ---`;

                // Limpiar coordenada de memoria
                if (activePointType === 'model') modelPoints[activePointIdx] = null;
                else realPoints[activePointIdx] = null;

                // Ocultar marca visual anterior
                const marker = alignMarkers[activePointType][activePointIdx];
                if (marker) marker.visible = false;

                isAligned = false; // Requiere recalcular alineación
            }

            screenLog(`Esperando captura de ${activePointType === 'model' ? 'M' : 'R'}${activePointIdx + 1}`);
        };
    });

    const calcBtn = document.getElementById('btn-calculate-align');
    if (calcBtn) calcBtn.onclick = calculateAlignment;

    const resetBtn = document.getElementById('btn-reset-align');
    if (resetBtn) resetBtn.onclick = resetAlignmentPoints;

    // Handlers para Interacción Avanzada y Drag
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerUp);

    // El desfase ahora es un input numérico directo y no requiere sincronización de etiquetas
}

function captureRealPoint() {
    if (activePointIdx === null || !reticle.visible) return;

    const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    realPoints[activePointIdx] = pos.clone();

    // Mostrar el marcador 3D en la realidad
    updateMarker('real', activePointIdx, pos);

    const btn = document.getElementById(`p-real-${activePointIdx + 1}`);
    btn.classList.add('captured');
    btn.textContent = `R${activePointIdx + 1}: OK`;

    screenLog(`R${activePointIdx + 1} capturado: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`);

    // Auto-avanzar al siguiente punto de realidad si no están todos
    if (activePointIdx < 2) {
        setTimeout(() => {
            document.getElementById(`p-real-${activePointIdx + 2}`).click();
        }, 500);
    }
}

function updateMarker(type, idx, position) {
    let marker = alignMarkers[type][idx];
    if (!marker) {
        // Rojo para Modelo (M1,M2,M3), Verde para Realidad (R1,R2,R3)
        const color = type === 'model' ? 0xef4444 : 0x10b981;
        // Esfera de 4cm
        const geo = new THREE.SphereGeometry(0.04, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: 0.8 });
        marker = new THREE.Mesh(geo, mat);
        marker.renderOrder = 999;

        // Asignar ID de rastreo para el arrastre
        marker.userData = { type: type, idx: idx };

        alignMarkers[type][idx] = marker;

        if (type === 'model') {
            pivotGroup.add(marker);
        } else {
            scene.add(marker);
        }
    }
    marker.position.copy(position);
    marker.visible = true;
}

function onPointerDown(event) {
    if (activePointType !== 'model' || activePointIdx === null || !model) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const offsetSlider = document.getElementById('drag-offset-input');
    const offsetY = offsetSlider ? parseFloat(offsetSlider.value) : 10;
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - offsetY) - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // 1. Revisar si tocamos un marcador existente para arrastrarlo
    const markers = alignMarkers.model.filter(m => m !== undefined);
    const markerIntersects = raycaster.intersectObjects(markers, false);

    if (markerIntersects.length > 0) {
        dragTarget = markerIntersects[0].object;
        dragTarget.userData.isNew = false;
        if (controls) {
            controlsWereEnabled = controls.enabled;
            controls.enabled = false;
        }
        screenLog(`Arrastrando M${dragTarget.userData.idx + 1}...`);
        return; // Detener lógica de creación para arrastrar
    }

    // 2. Si no arrastramos, iniciar punto nuevo y permitir arrastre en el mismo toque
    const intersects = raycaster.intersectObject(offsetGroup, true);
    if (intersects.length > 0) {
        const point = intersects[0].point;
        // Convertir punto de mundo a local del pivotGroup
        const localPoint = pivotGroup.worldToLocal(point.clone());
        modelPoints[activePointIdx] = localPoint;

        // Mostrar el marcador sobre el modelo
        updateMarker('model', activePointIdx, localPoint);

        // Establecer como objetivo de arrastre inmediato
        dragTarget = alignMarkers.model[activePointIdx];
        dragTarget.userData.isNew = true; // Bandera para avanzar botón al soltarlo
        if (controls) {
            controlsWereEnabled = controls.enabled;
            controls.enabled = false;
        }
        screenLog(`Desliza para ubicar M${activePointIdx + 1}...`);
    }
}

function onPointerMove(event) {
    if (!dragTarget || !model) return;

    if (controls) controls.enabled = false;

    const rect = renderer.domElement.getBoundingClientRect();
    const offsetSlider = document.getElementById('drag-offset-input');
    const offsetY = offsetSlider ? parseFloat(offsetSlider.value) : 10;
    const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - offsetY) - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Solo chocamos contra el modelo mientras arrastramos para pegarse a la pared
    const intersects = raycaster.intersectObject(offsetGroup, true);
    if (intersects.length > 0) {
        const point = intersects[0].point;
        const localPoint = pivotGroup.worldToLocal(point.clone());

        // Actualizar variable de alineación y posición de marcador visual
        modelPoints[dragTarget.userData.idx] = localPoint;
        dragTarget.position.copy(localPoint);
    }
}

function onPointerUp(event) {
    if (dragTarget) {
        if (controls) controls.enabled = controlsWereEnabled;
        const idx = dragTarget.userData.idx;
        const pos = modelPoints[idx];
        const isNew = dragTarget.userData.isNew;

        dragTarget.userData.isNew = false;
        dragTarget = null;

        if (isNew) {
            screenLog(`M${idx + 1} fijado: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`);

            const btn = document.getElementById(`p-mod-${idx + 1}`);
            if (btn) {
                btn.classList.add('captured');
                btn.textContent = `M${idx + 1}: OK`;
            }

            // Auto-avanzar solo si estábamos configurando este punto activamente
            if (idx === activePointIdx) {
                if (activePointIdx < 2) {
                    const nextBtn = document.getElementById(`p-mod-${activePointIdx + 2}`);
                    if (nextBtn) nextBtn.click();
                } else {
                    const pReal1 = document.getElementById('p-real-1');
                    if (pReal1) pReal1.click();
                }
            }
        } else {
            screenLog(`M${idx + 1} reubicado: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`);
        }
    }
}

function resetAlignmentPoints() {
    modelPoints = [null, null, null];
    realPoints = [null, null, null];
    activePointIdx = null;
    activePointType = null;
    isAligned = false;

    document.querySelectorAll('.point-btn').forEach((btn, i) => {
        btn.classList.remove('captured', 'selected');
        const type = btn.dataset.type === 'model' ? 'M' : 'R';
        const idx = parseInt(btn.dataset.idx) + 1;
        btn.textContent = `${type}${idx}: ---`;
    });

    // Solo resetear la transformación de pivotGroup, sin borrar el modelo
    pivotGroup.position.set(0, 0, 0);
    pivotGroup.rotation.set(0, 0, 0);
    pivotGroup.scale.set(1, 1, 1);

    // Limpiar marcadores visuales
    ['model', 'real'].forEach(type => {
        alignMarkers[type].forEach(m => {
            if (m && m.parent) m.parent.remove(m);
        });
        alignMarkers[type] = [];
    });

    screenLog('Alineación reseteada');
}

function calculateAlignment() {
    if (modelPoints.includes(null) || realPoints.includes(null)) {
        screenLog('❌ Faltan puntos para alinear', true);
        return;
    }

    screenLog('📐 Calculando transformación...');

    try {
        // 1. Construir bases
        const getBasis = (p) => {
            const v1 = new THREE.Vector3().subVectors(p[1], p[0]);
            const v2 = new THREE.Vector3().subVectors(p[2], p[0]);

            const x = v1.clone().normalize();
            const z = new THREE.Vector3().crossVectors(v1, v2).normalize();
            const y = new THREE.Vector3().crossVectors(z, x).normalize();

            return { x, y, z, origin: p[0], scaleRef: v1.length() };
        };

        const bM = getBasis(modelPoints);
        const bR = getBasis(realPoints);

        // 2. Escala
        const scale = bR.scaleRef / bM.scaleRef;
        pivotGroup.scale.set(scale, scale, scale);

        // 3. Rotación
        // Matriz de base Modelo
        const matM = new THREE.Matrix4().makeBasis(bM.x, bM.y, bM.z);
        // Matriz de base Realidad
        const matR = new THREE.Matrix4().makeBasis(bR.x, bR.y, bR.z);

        // R = matR * inv(matM)
        const rotationMatrix = matR.clone().multiply(matM.clone().invert());
        pivotGroup.quaternion.setFromRotationMatrix(rotationMatrix);

        // 4. Traslación
        // T = R1 - scale * R * M1
        const rotatedM1 = modelPoints[0].clone().applyMatrix4(rotationMatrix).multiplyScalar(scale);
        const translation = realPoints[0].clone().sub(rotatedM1);
        pivotGroup.position.copy(translation);

        isAligned = true; // Proteger de recolocaciones accidentales
        saveModelAlignment(); // PERSISTENCIA: Guardar tras alinear exitosamente

        screenLog('✅ Alineación Exitosa');
        screenLog(`Escala aplicada: ${scale.toFixed(4)}`);

    } catch (e) {
        screenLog(`❌ Error matemático: ${e.message}`, true);
        console.error(e);
    }
}

function applyImageAlignment(matrixArray) {
    const matrix = new THREE.Matrix4().fromArray(matrixArray);
    
    // El modelo se posiciona exactamente donde está el marcador
    pivotGroup.position.setFromMatrixPosition(matrix);
    pivotGroup.quaternion.setFromRotationMatrix(matrix);
    pivotGroup.scale.set(1, 1, 1);
    
    isAligned = true;
    saveModelAlignment();
    
    // Pequeño feedback sonoro/visual si fuera necesario
    if (!window.lastAutoLog || Date.now() - window.lastAutoLog > 3000) {
        screenLog('📸 Auto-Alineación Exitosa');
        window.lastAutoLog = Date.now();
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() { renderer.setAnimationLoop(render); }



function render(t, frame) {
    if (frame) {
        const session = renderer.xr.getSession();
        const refSpace = renderer.xr.getReferenceSpace();

        // --- 1. Detección Automática por Marcador ---
        if (frame.getTrackedImageResults) {
            const results = frame.getTrackedImageResults();
            const statusSpan = document.getElementById('auto-align-status');

            for (const result of results) {
                if (result.trackingState === 'tracked') {
                    if (statusSpan) {
                        statusSpan.textContent = '¡Marcador Detectado!';
                        statusSpan.style.color = '#4ade80';
                    }
                    const pose = frame.getPose(result.imageSpace, refSpace);
                    if (pose) {
                        // Solo aplicamos la alineación si el usuario está en la pestaña "Auto"
                        const autoTab = document.querySelector('.tab-btn[data-tab="tab-auto"]');
                        if (autoTab && autoTab.classList.contains('active')) {
                            applyImageAlignment(pose.transform.matrix);
                        }
                    }
                } else {
                    if (statusSpan) {
                        statusSpan.textContent = 'Buscando marcador...';
                        statusSpan.style.color = '#f87171';
                    }
                }
            }
        }

        if (!hitTestSourceRequested) {
            session.requestReferenceSpace('viewer').then(rs => session.requestHitTestSource({ space: rs }).then(s => hitTestSource = s));
            hitTestSourceRequested = true;

            session.addEventListener('select', (event) => {
                // Verificar si el toque fue sobre la interfaz DOM para ignorar el movimiento del 3D
                // (WebXR standard check for dom-overlay)
                const isUIInteraction = event.inputSource.targetRayMode === 'screen' &&
                    event.inputSource.domOverlayState &&
                    event.inputSource.domOverlayState.type !== 'none';

                const alignTab = document.querySelector('.tab-btn[data-tab="tab-align"]');
                const isAlignTabActive = alignTab && alignTab.classList.contains('active');

                if (reticle.visible) {
                    if (isAlignTabActive && activePointType === 'real') {
                        captureRealPoint();
                    } else if (!isAlignTabActive && !isAligned) {
                        // Solo permitimos mover el modelo si NO estamos en alineación fina
                        // y el toque NO fue sobre un botón de la interfaz

                        screenLog("📍 Fijando posición...");

                        // Posicionamiento normal: Forzamos escala 1:1 para que midan lo que deben (en metros)
                        pivotGroup.scale.set(1, 1, 1);
                        pivotGroup.position.setFromMatrixPosition(reticle.matrix);
                        pivotGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(reticle.matrix));
                        
                        saveModelAlignment(); // Persistir la nueva posición base

                        // Opcional: Intentar usar Anchors si el navegador lo soporta para mayor estabilidad
                        if (frame.createAnchor) {
                            const pose = results[0].getPose(refSpace);
                            frame.createAnchor(pose.transform).then((anchor) => {
                                screenLog("⚓ Anclaje de precisión activado");
                                // En el futuro podríamos actualizar el pivotGroup basándonos en anchor.anchorSpace
                            }).catch(e => console.warn("No se pudo crear el anclaje", e));
                        }
                    }
                }
            });
        }

        if (hitTestSource) {
            const results = frame.getHitTestResults(hitTestSource);
            if (results.length) {
                const pose = results[0].getPose(refSpace);
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
            } else {
                reticle.visible = false;
            }
        }
    }

    if (!renderer.xr.isPresenting) {
        controls.update();
    }
    renderer.render(scene, camera);
}
