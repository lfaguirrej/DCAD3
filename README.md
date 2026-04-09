# Guía de Ejecución - DCAD2 AR

Esta guía explica cómo poner en marcha la aplicación y visualizarla en un dispositivo móvil utilizando un túnel seguro.

## 1. Requisitos Previos
*   Computador y celular conectados a la misma red (opcional si usas el túnel).
*   iPhone: Descargar **WebXR Viewer** (Mozilla) desde la App Store.
*   Android: Chrome actualizado.

## 2. Iniciar Servicios (En el computador)

### Paso A: Backend (API y Conversión)
Abre una terminal y ejecuta:
```powershell
cd server
python main.py
```
*Servicio activo en el puerto 8001.*

### Paso B: Frontend (Vite)
Abre otra terminal y ejecuta:
```powershell
npm run dev
```
*Vite detectará el puerto 5173 y habilitará el modo host.*

### Paso C: Túnel para Celular
Abre una tercera terminal y ejecuta:
```powershell
npx localtunnel --port 5173 --subdomain unal-dcad-ar4
```
### Paso D: Determinar la IP
Abre una cuarta terminal y ejecuta:
```powershell
curl.exe ifconfig.me
```


## 3. Acceder desde el Celular

1.  Abre el navegador (o WebXR Viewer en iPhone).
2.  Entra a la URL: **`https://unal-dcad-ar4.loca.lt`**
3.  **Clave de Acceso (Public IP):**
    Cuando aparezca la pantalla de "Friendly Reminder", usa esta clave:
    # **`181.60.235.103`**
    *(Nota: Si cambia, búscala en Google como "mi ip" desde el PC).*
4.  Presiona **"Submit"**.

## 4. Solución a Problemas Frecuentes

### Pantalla Negra en iPhone (AR)
Si al presionar "START AR" los menús se ven pero la cámara está negra:
*   **Toca la pantalla:** A veces el iPhone requiere una interacción física para activar el flujo de la cámara.
*   **Permisos:** Ve a Ajustes > WebXR Viewer > Cámara (debe estar activo).
*   **Batería:** Desactiva el modo "Ahorro de batería" o "Bajo Consumo".

### El modelo no aparece
*   Asegúrate de haber seleccionado un modelo en la pestaña "Modelos".
*   Mueve el celular lentamente sobre una superficie plana (suelo o mesa) para que aparezca el círculo de posición (retícula).
*   Toca el círculo para colocar el modelo.
