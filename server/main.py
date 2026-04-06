import os
import uuid
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import aspose.cad as cad
import shutil

app = FastAPI()

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure we are working relative to the project root even if run from 'server' folder
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "converted")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Mount static directories to access files directly
app.mount("/static/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/static/converted", StaticFiles(directory=OUTPUT_DIR), name="converted")

@app.get("/models")
async def list_models():
    """Returns a list of all uploaded and converted models."""
    models = []
    
    # Check converted models (from DWG)
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith(".glb"):
            models.append({
                "name": f"Convertido: {f}",
                "url": f"/static/converted/{f}",
                "type": "glb"
            })
            
    # Check manual uploads
    for f in os.listdir(UPLOAD_DIR):
        ext = os.path.splitext(f)[1].lower()[1:]
        if ext in ["ifc", "glb", "gltf"]:
            models.append({
                "name": f,
                "url": f"/static/uploads/{f}",
                "type": ext if ext == "ifc" else "glb"
            })
            
    return models

@app.post("/upload")
async def upload_model(file: UploadFile = File(...)):
    """Saves a model specifically for sharing between devices."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".ifc", ".glb", ".gltf"]:
        raise HTTPException(status_code=400, detail="Extension not supported for persistent upload")
    
    # Save with original name to UPLOAD_DIR
    target_path = os.path.join(UPLOAD_DIR, file.filename)
    
    try:
        with open(target_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        return {
            "name": file.filename,
            "url": f"/static/uploads/{file.filename}",
            "type": "ifc" if ext == ".ifc" else "glb"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/convert")
async def convert_dwg(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".dwg"):
        raise HTTPException(status_code=400, detail="Only .dwg files are supported")
    
    file_id = str(uuid.uuid4())[:8]
    original_name = os.path.splitext(file.filename)[0]
    safe_name = "".join([c for c in original_name if c.isalnum() or c in (" ", "-", "_")]).strip()
    
    input_path = os.path.join(UPLOAD_DIR, f"{file_id}_{file.filename}")
    output_filename = f"{safe_name}_{file_id}.glb"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    
    try:
        with open(input_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        print(f"Loading DWG: {file.filename}")
        image = cad.Image.load(input_path)
        
        rasterization_options = cad.imageoptions.CadRasterizationOptions()
        rasterization_options.page_width = 1600.0
        rasterization_options.page_height = 1600.0
        
        if hasattr(rasterization_options, "type_of_entities"):
            try:
                rasterization_options.type_of_entities = cad.imageoptions.TypeOfEntities.ENTITIES_3D
            except Exception as e:
                print(f"Non-critical: Could not set ENTITIES_3D: {e}")

        gltf_options = cad.imageoptions.GltfOptions()
        gltf_options.vector_rasterization_options = rasterization_options
        
        print(f"Converting to GLB: {output_path}")
        image.save(output_path, gltf_options)
        
        return {
            "name": f"CAD: {original_name}",
            "url": f"/static/converted/{output_filename}",
            "type": "glb"
        }
    
    except Exception as e:
        print(f"Conversion error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error conversion: {str(e)}")
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
