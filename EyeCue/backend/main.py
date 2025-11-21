import os
os.environ["PATH"] += os.pathsep + r"C:\Users\ka14x\Downloads\ffmpeg-7.1.1-essentials_build\ffmpeg-7.1.1-essentials_build\bin"

import torch
import io
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
from transformers import (
    BlipProcessor, BlipForConditionalGeneration,
    BlipForQuestionAnswering, DetrImageProcessor,
    DetrForObjectDetection, pipeline
)
from PIL import Image

from gtts import gTTS
from fastapi.responses import FileResponse
import uuid
from starlette.background import BackgroundTask
from fastapi import HTTPException


# ✅ Try DirectML if available
try:
    import torch_directml
    device = torch_directml.device()
except ImportError:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

app = FastAPI()

# BLIP
blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
blip_model = BlipForConditionalGeneration.from_pretrained(
    "Salesforce/blip-image-captioning-base",
    torch_dtype=torch.float16
).to(device)

# DETR
detection_processor = DetrImageProcessor.from_pretrained("facebook/detr-resnet-50")
detection_model = DetrForObjectDetection.from_pretrained(
"facebook/detr-resnet-50",
torch_dtype=torch.float32
).to(device)

# BLIP VQA
vqa_processor = BlipProcessor.from_pretrained("Salesforce/blip-vqa-base")
vqa_model = BlipForQuestionAnswering.from_pretrained(
    "Salesforce/blip-vqa-base",
    torch_dtype=torch.float16
).to(device)

# WHISPER
asr_pipeline = pipeline(
    "automatic-speech-recognition",
    model="openai/whisper-small",
    device=0 if torch.cuda.is_available() else -1
)


@app.post("/caption")
async def caption_image(file: UploadFile = File(...)):
    image = Image.open(io.BytesIO(await file.read())).convert("RGB")
    inputs = blip_processor(image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = blip_model.generate(**inputs)
    caption = blip_processor.decode(outputs[0], skip_special_tokens=True)
    return {"caption": caption}

@app.post("/detect")
async def detect_objects(file: UploadFile = File(...)):
    image = Image.open(io.BytesIO(await file.read())).convert("RGB")
    inputs = detection_processor(images=image, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    with torch.no_grad():
        outputs = detection_model(**inputs)

    target_sizes = torch.tensor([image.size[::-1]]).to(device)
    results = detection_processor.post_process_object_detection(
        outputs, target_sizes=target_sizes, threshold=0.8  # raised from 0.5 to 0.8
    )[0]

    labels_ids = results["labels"].tolist()
    scores = results["scores"].tolist()

    # Filter by confidence threshold
    filtered_labels = [
        detection_model.config.id2label[label_id]
        for label_id, score in zip(labels_ids, scores)
        if score >= 0.8
    ]

    unique_labels = sorted(set(filtered_labels))
    return {"labels": unique_labels}


@app.post("/vqa")
async def vqa_image(file: UploadFile = File(...), question: str = Form("")):
    image = Image.open(io.BytesIO(await file.read())).convert("RGB")
    inputs = vqa_processor(image, question, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = vqa_model.generate(**inputs)
    answer = vqa_processor.decode(outputs[0], skip_special_tokens=True)
    return {"answer": answer}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribes speech to English using Whisper, with language forced to English.
    """
    audio_bytes = await file.read()

    # Force transcription in English
    result = asr_pipeline(audio_bytes, generate_kwargs={"language": "en"})
    text = result.get("text", "")
    return {"text": text}


@app.post("/speak")
async def speak_text(text: str = Form(...)):
    try:
        # Generate speech
        tts = gTTS(text=text, lang="en", slow=False)
        
        # Create a unique filename
        filename = f"speech_{uuid.uuid4().hex}.mp3"
        filepath = os.path.join("audio", filename)

        # Ensure audio directory exists
        os.makedirs("audio", exist_ok=True)
        
        # Save the audio file
        tts.save(filepath)
        
        # Verify the file exists and has content
        if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            raise Exception("Failed to generate audio file")

        # Task to delete the file after sending
        delete_task = BackgroundTask(lambda: os.remove(filepath))

        # Return the audio file
        return FileResponse(
            filepath,
            media_type="audio/mpeg",
            filename=filename,
            background=delete_task
        )
    except Exception as e:
        print(f"Error in speak_text: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

