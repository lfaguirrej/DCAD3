# Guía Paso a Paso para Actualizar tu Código en GitHub

Este documento explica de forma sencilla y directa los pasos que debes seguir en la consola (terminal) para subir los últimos cambios o actualizaciones de tu proyecto a tu repositorio de GitHub.

## 1. Revisar los cambios realizados
Antes de guardar los cambios es útil ver qué archivos fueron modificados, agregados o eliminados.
Abre tu terminal en la carpeta del proyecto y ejecuta:

```bash
git status
```
*Los archivos en rojo son cambios que aún no se han añadido al listado de cosas por guardar.*

## 2. Agregar los cambios al "Stage" (Preparación)
Para decirle a Git que prepare todos los archivos modificados para ser guardados, debes ejecutar el siguiente comando:

```bash
git add .
```
*Nota: El punto `.` al final es muy importante; significa "agregar absolutamente todos los archivos y carpetas modificados".*

## 3. Crear el Commit (Guardar los cambios)
Una vez que los archivos están añadidos (aparecerían en verde si usas `git status` nuevamente), debes empaquetar estos cambios poniéndoles una etiqueta o título. Esto se conoce como `commit`.

```bash
git commit -m "Descripción de los cambios realizados"
```
*Ejemplo:* `git commit -m "Corrige error de botón WebXR en dispositivos iPhone"`
*Tip: Sé claro en tus descripciones para saber qué actualizaste en el futuro.*

## 4. Subir la actualización a GitHub (Push)
Finalmente, los cambios ya están guardados en tu computadora, pero ahora debes "empujarlos" para que aparezcan en GitHub:

```bash
git push
```
Si es la primera vez que subes esa "rama" (branch), es posible que la terminal te sugiera un comando parecido a `git push --set-upstream origin main`. En ese caso, simplemente cópialo, pégalo y presiona Enter.

---

### Resumen Rápido (Los 3 comandos mágicos)
Si ya sabes lo que modificaste y solo quieres guardarlo rápido, esto es lo que debes usar siempre:

1. `git add .`
2. `git commit -m "Mi actualización"`
3. `git push`

¡Y listo! Tu código estará seguro y actualizado en la nube de GitHub.
