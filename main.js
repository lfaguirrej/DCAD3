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

document.addEventListener('DOMContentLoaded', () => {
    // Definición robusta del logger antes de nada
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

    screenLog('Iniciando Aplicación...');
    init();
});

function init() {
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

    // Toggle Menu (Mobile)
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle && uiContainer) {
        let lastToggleTime = 0;
        const toggleMenu = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            // Guard against duplicate events (touch + click)
            if (Date.now() - lastToggleTime < 300) return;
            lastToggleTime = Date.now();

            uiContainer.classList.toggle('active');
            const isActive = uiContainer.classList.contains('active');
            menuToggle.innerHTML = isActive ? '✕' : '☰';
            screenLog(isActive ? 'Panel abierto' : 'Panel cerrado');
        };

        menuToggle.onclick = toggleMenu;
        menuToggle.ontouchstart = (e) => {
            toggleMenu(e);
        };
    }

    // Unified Bottom Bar Controls (Panel | AR | Refresh)
    const btnQuickPanel = document.getElementById('quick-panel-btn');
    const btnStartAR = document.getElementById('start-ar-custom-btn');
    const btnArExit = document.getElementById('ar-exit-btn');
    const btnRefresh = document.getElementById('refresh-btn-unified');

    // Mover el botón flotante de refresco a la barra unificada
    if (btnRefresh) {
        btnRefresh.onclick = () => window.location.reload();
    }

    if (btnQuickPanel) {
        btnQuickPanel.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            
            // Lógica de "Interruptor": Abre o Cierra el panel de controles
            const isVisible = uiContainer.classList.contains('active') && !uiContainer.classList.contains('ui-minimized');
            
            if (isVisible) {
                // Si está abierto, lo minimizamos y escondemos
                uiContainer.classList.remove('active');
                uiContainer.classList.add('ui-minimized');
                btnQuickPanel.textContent = '➕ Abrir Panel';
                screenLog('📉 Panel oculto');
            } else {
                // Si está cerrado, lo mostramos completo
                uiContainer.classList.add('active');
                uiContainer.classList.remove('ui-minimized');
                btnQuickPanel.textContent = '📂 Panel';
                screenLog('📈 Panel abierto');
            }
        };
    }

    if (btnStartAR) {
        btnStartAR.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const realARButton = document.getElementById('ARButton');
            if (realARButton) {
                if (realARButton.tagName.toLowerCase() === 'a' || realARButton.textContent.includes('NOT SUPPORTED') || realARButton.textContent.includes('AVAILABLE')) {
                    alert('Realidad Aumentada (WebXR) no soportada en este dispositivo o navegador (iOS requiere App compatible o Mozilla WebXR Viewer).');
                    screenLog('⚠️ Error: AR no soportado nativamente en este navegador', true);
                } else {
                    realARButton.click();
                }
            } else {
                screenLog('⚠️ Error: AR no disponible en este dispositivo', true);
            }
        };
    }

    if (btnArExit) {
        btnArExit.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            const session = renderer.xr.getSession();
            if (session) {
                session.end();
            }
        };
    }

    // Refresh Button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.onclick = () => {
            screenLog('🔄 Recargando aplicación...');
            setTimeout(() => window.location.reload(), 300);
        };
    }

    // --- 2. Inicialización Three.js ---
    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f172a);

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10000);
        camera.position.set(5, 5, 5);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        container.appendChild(renderer.domElement);

        // AR Setup
        const arButton = ARButton.createButton(renderer, {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay'],
            domOverlay: { root: document.getElementById('ui-wrapper') }
        });
        
        // Forzar asignación del ID en caso que sea el fallback anchor <a href> de iOS
        // para que CSS pueda ocultarlo.
        arButton.id = 'ARButton';
        
        document.body.appendChild(arButton);

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 1.5));
        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(10, 20, 10);
        scene.add(dirLight);

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
        // Usamos archivos locales y desactivamos workers para evitar bloqueos en el móvil
        ifcLoader.ifcManager.setWasmPath('/');
        ifcLoader.ifcManager.useWebWorkers(false);
        screenLog('Visor 3D: Motor Local Listo');
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

    // Shading toggle
    const shadeCheck = document.getElementById('shading-toggle');
    if (shadeCheck) shadeCheck.onchange = () => {
        if (model) model.visible = shadeCheck.checked;
    };

    // Upload
    const uploadBtn = document.getElementById('upload-btn');
    const fileInput = document.getElementById('model-upload');
    if (uploadBtn && fileInput) {
        uploadBtn.onclick = () => fileInput.click();
        fileInput.onchange = handleUpload;
    }

    // --- 4. Handlers de Alineación ---
    setupAlignmentHandlers();

    initModelList();
    window.addEventListener('resize', onWindowResize);
    animate();
}

async function initModelList() {
    addModelToList('Bodega Ejemplo (A-S-2)', '/Ejemplos/A-S-2.ifc', 'ifc', true);
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
    // Limpiar clases de estado AR/UI
    document.body.classList.remove('ar-active', 'ui-overlay-active');
    // Resetear elementos de control
    const controls = document.querySelectorAll('.bottom-controls-bar');
    controls.forEach(c => c.style.display = 'none');
}

function nudgeModel(axis, dir) {
    const step = 0.05, rot = Math.PI / 36;
    if (axis === 'x') offsetGroup.position.x += step * dir;
    if (axis === 'y') offsetGroup.position.y += step * dir;
    if (axis === 'z') offsetGroup.position.z += step * dir;
    if (axis === 'rx') offsetGroup.rotation.x += rot * dir;
    if (axis === 'ry') offsetGroup.rotation.y += rot * dir;
    if (axis === 'rz') offsetGroup.rotation.z += rot * dir;
    
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
                        c.frustumCulled = false; 
                    }
                });

                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                model.position.sub(center);
                
                // Auto-escala para GLB (frecuente en CAD exportado en mm)
                if (size.length() > 500) {
                    offsetGroup.scale.set(0.001, 0.001, 0.001);
                    screenLog('📏 GLB: Escala mm -> m');
                } else if (size.length() < 0.01) {
                    offsetGroup.scale.set(100, 100, 100);
                    screenLog('📏 GLB: Escala micro -> m');
                }

                offsetGroup.add(model);

                setTimeout(() => {
                    extractEdges(model);
                    
                    const restored = restoreModelAlignment(url);
                    if (!restored) {
                        fitCameraToObject(offsetGroup);
                        
                        // Si estamos en AR, ponerlo frente al usuario
                        if (renderer.xr.isPresenting && reticle.visible) {
                            pivotGroup.position.setFromMatrixPosition(reticle.matrix);
                            pivotGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(reticle.matrix));
                        }
                    }
                    
                    screenLog('✅ GLB Listo');
                    resolve();
                }, 100);
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
        const mat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        edges = new THREE.Group();

        source.traverse(c => {
            if (c.isMesh) {
                const geo = new THREE.EdgesGeometry(c.geometry);
                const l = new THREE.LineSegments(geo, mat);

                // Calculamos la matriz relativa al root del modelo para alineación perfecta
                c.updateWorldMatrix(true, false);
                const relativeMatrix = source.matrixWorld.clone().invert().multiply(c.matrixWorld);
                l.applyMatrix4(relativeMatrix);

                edges.add(l);
            }
        });

        // Los bordes deben seguir el mismo desplazamiento que el modelo sólido
        edges.position.copy(source.position);
        offsetGroup.add(edges);
        screenLog('🧩 Bordes alineados');
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
                            c.material = new THREE.MeshPhongMaterial({ color: 0x94a3b8, side: THREE.DoubleSide });
                            c.frustumCulled = false;
                        }
                    });

                    if (meshCount === 0) {
                        screenLog('⚠️ Modelo sin geometría visible', true);
                        return resolve();
                    }

                    const box = new THREE.Box3().setFromObject(model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());

                    model.position.sub(center);
                    offsetGroup.add(model);

                    if (size.length() > 500) {
                        offsetGroup.scale.set(0.001, 0.001, 0.001);
                        screenLog('📏 Escala: Milímetros -> Metros');
                    }

                    screenLog('✨ ¡PROYECCIÓN LISTA!');

                    setTimeout(() => {
                        extractEdges(model);
                        const restored = restoreModelAlignment(url);
                        if (!restored) {
                            fitCameraToObject(offsetGroup);

                            // Si estamos en AR, ponerlo frente al usuario
                            if (renderer.xr.isPresenting && reticle.visible) {
                                pivotGroup.position.setFromMatrixPosition(reticle.matrix);
                                pivotGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(reticle.matrix));
                            }
                        }
                        resolve();
                    }, 300);
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
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const dist = box.getSize(new THREE.Vector3()).length() || 5;
    camera.position.set(center.x + dist, center.y + dist, center.z + dist);
    camera.lookAt(center);
    if (controls) { controls.target.copy(center); controls.update(); }
}

function generateShape(type, x, y, z) {
    resetAlignmentGroups();
    let geo = type === 'box' ? new THREE.BoxGeometry(x, y, z) :
        type === 'cylinder' ? new THREE.CylinderGeometry(x / 2, x / 2, y, 32) :
            new THREE.SphereGeometry(x / 2, 32, 32);
    model = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.7 }));
    model.position.set(0, y / 2, 0);
    offsetGroup.add(model);
    
    // Extraer bordes para proyectar el contorno verde igual que los modelos CAD
    extractEdges(model);
    
    fitCameraToObject(offsetGroup);
    screenLog(`✅ Figura generada: ${x}x${y}x${z}`);
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

    // Initializer slider offset
    const offsetSlider = document.getElementById('drag-offset-input');
    const offsetDisplay = document.getElementById('offset-val-display');
    if (offsetSlider && offsetDisplay) {
        offsetSlider.oninput = (e) => {
            offsetDisplay.textContent = e.target.value;
        };
    }
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

        if (!hitTestSourceRequested) {
            // Preparar escena para AR (Fondo transparente para ver la cámara)
            scene.background = null;
            renderer.setClearColor(0x000000, 0);
            document.body.classList.add('ar-active');
            document.documentElement.classList.add('ar-active');

            session.requestReferenceSpace('viewer').then(rs => session.requestHitTestSource({ space: rs }).then(s => hitTestSource = s));

            session.addEventListener('end', () => {
                hitTestSourceRequested = false;
                hitTestSource = null;
                reticle.visible = false;

                // Limpiar miniatura de AR al salir
                uiContainer.classList.remove('ar-mode', 'ui-minimized');
                const btnArToggle = document.getElementById('ar-toggle-ui-btn');
                if (btnArToggle) btnArToggle.textContent = '➖ Ocultar Panel';

                document.body.classList.remove('ar-active');
                document.documentElement.classList.remove('ar-active');
                // Restaurar fondo original al salir de AR
                scene.background = new THREE.Color(0x0f172a);
                renderer.setClearColor(0x0f172a, 1);

                // Chrome en Android (y otros navegadores WebXR) inyecta 'display: none'
                // al contenedor de domOverlay al finalizar la sesión AR.
                // Restablecemos el display para que vuelva a ser visible todo el UI:
                uiContainer.style.display = '';
                const uiWrapper = document.getElementById('ui-wrapper');
                if (uiWrapper) uiWrapper.style.display = '';
                const bottomControls = document.getElementById('unified-bottom-controls');
                if (bottomControls) bottomControls.style.display = '';

                // Volver a enfocar la cámara al modelo y reactualizar el render para la pantalla normal
                setTimeout(() => {
                    onWindowResize(); // Restaura la relación de aspecto si hubo cambio de rotación de pantalla
                    fitCameraToObject(pivotGroup);
                    if (controls) {
                        controls.enabled = true;
                        controls.update();
                    }
                }, 100);
            });

            uiContainer.classList.add('ar-mode');
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
                        
                        // Posicionamiento normal
                        pivotGroup.position.setFromMatrixPosition(reticle.matrix);
                        pivotGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(reticle.matrix));
                        
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
