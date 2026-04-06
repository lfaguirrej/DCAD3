Terminal 1: El Cerebro (Backend)
Este servicio maneja la conversión de archivos y la lista de modelos.

Escribe: cd server
Escribe: python main.py
(Debe decir: "Uvicorn running on http://0.0.0.0:8001")
Terminal 2: La Interfaz (Frontend)
Este es el servidor de desarrollo de la web.

En la raíz del proyecto, escribe: npm run dev
(Mantén esta ventana abierta).
Terminal 3: El Túnel (Acceso Remoto)
Como la AR requiere una conexión segura (HTTPS), usamos un túnel para que el celular vea tu computadora.

Escribe: npx localtunnel --port 5173 --subdomain unal-dcad-ar4
(Si el subdominio está ocupado, cámbialo por algo único como dcad-tunel-123).
3. Conexión desde el Celular
Abre el navegador en tu celular (o WebXR Viewer si es iPhone).
Entra a la URL que te dio la Terminal 3: https://unal-dcad-ar4.loca.lt (o el que hayas usado).
Clave de Acceso (Public IP):
Al entrar, verás una pantalla de "Friendly Reminder" de localtunnel pidiendo una IP.
En tu computadora, busca en Google "mi ip" y copia los números (ejemplo: 181.60.235.103).
Pégala en el celular y presiona Submit.
4. Cómo usar la app en AR
Carga un Modelo: Ve a la pestaña 📦 Modelos y dale a Ver en el ejemplo de la bodega (o sube tu propio IFC/GLB).
Activa AR: Presiona el botón que dice START AR al final de la página.
Detección de Suelo: Mueve el celular lentamente apuntando al piso. Aparecerá un círculo azul (la retícula).
Colocación: Toca el círculo para fijar el modelo.
Alineación (IMPORTANTE):
Si el modelo no coincide con la realidad, usa la pestaña 📍 Alineación.
Marca 3 puntos en el modelo digital y luego los mismos 3 puntos en el mundo real. Presiona Alinear.
Ajuste Fino: Si necesitas moverlo un poco más, usa la pestaña 🎮 Ajuste.