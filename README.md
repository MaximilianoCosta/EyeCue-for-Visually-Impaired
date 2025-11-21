# 👁️ EyeCue
*By Khaled Alharbi*  
> *An Intelligent Visual Assistance Application for the Visually Impaired*  
<img src="EyeCue-logo.png" alt="EyeCue logo" width="45%">

---

## 📖 Overview  
EyeCue is a mobile application designed to empower visually impaired individuals by helping them navigate and understand their surroundings independently.
By utilizing the power of Artificial Intelligence and Computer Vision, EyeCue converts visual information into meaningful audio feedback. 
Users can detect objects, understand entire scenes, identify colors, and even ask specific questions about what the camera sees.
The application features a gesture-based interface optimized for accessibility, ensuring a seamless experience without the need for complex on-screen interactions.

---

## 🔍 Features  

### Visual Understanding
- **Object Detection:** Real-time identification of objects (e.g., "cup," "chair," "person").
- **Scene Description:** Generates a full natural language description of the current environment.
- **Color Identification:** Instantly identifies the dominant color in the frame.
- **Visual Question Answering (VQA):** Users can ask voice questions about the scene (e.g., "Is the door open?") and receive AI-generated answers.

### User Interaction
- **Audio Feedback:** All results are read aloud using Text-to-Speech (TTS).
- **Gesture Controls:** Simple swipes and taps to switch modes and capture images.
- **Voice Input:** Integrated speech-to-text for asking questions hands-free.

---

## 🛠 Tech Stack  
- **Frontend:** React Native (Expo), TypeScript  
- **Backend:** Python, FastAPI  
- **AI Models:**  
  - **DETR** (Object Detection)  
  - **BLIP** (Scene Description)  
  - **BLIP VQA** (Visual QA & Color)  
  - **Whisper** (Speech-to-Text)  
- **Tools:** Google TTS (gTTS), PyTorch, Transformers

---

## Setup Notes  
To run the application locally,  
you need to set up both the frontend (mobile application) and the backend (AI server).

### 1. Install required software
Ensure you have the following installed on your machine:  
a. Node.js and npm  
b. Python 3.8+  
c. Expo CLI `npm install -g expo-cli`  
d. Expo Go app on your smartphone (Android or iOS)  

### 2. Set up the Python Backend
Navigate to the backend folder and install the required Python libraries:  
```
pip install fastapi uvicorn transformers torch pillow gTTS
```
### 3. Create and Activate a Virtual Environment
Navigate to the backend folder and set up a virtual environment to isolate dependencies:
```
python -m venv venv
.\venv\Scripts\activate
```

### 4. Start the Backend Server
Run the FastAPI server to host the AI models locally:  
```
uvicorn main:app --host 0.0.0.0 --port 8000
```
Note: Ensure your computer and mobile phone are connected to the same Wi-Fi network.

### 4. Configure the API Endpoint
In the `huggingfaceApi.ts` file, update the base URL to match your computer's local IP address:
```
const API_URL = "http://YOUR_LOCAL_IP:8000";
```

### 5. Install Frontend Dependencies
Navigate to the frontend project folder and run:  
```
npm install
```

### 6. Run the Mobile Application
```
expo start
```
Scan the QR code displayed in the terminal using the Expo Go app on your phone to launch EyeCue.

## 📷 Screenshots
<p align="center">
  <img src="home-page.png" alt="Homepage" width="45%">
  <img src="category-page.png" alt="Category Page" width="45%">
</p>

<p align="center">
  <img src="books-preview2.png" alt="Books Preview 2" width="45%">
  <img src="books-preview1.png" alt="Books Preview 1" width="45%">
</p>

## 📜 Credits
Developed by:     
- **Khaled Alharbi**


Supervised by:  
- **Dr. Asma Badr Abdullah Alsaleh**
