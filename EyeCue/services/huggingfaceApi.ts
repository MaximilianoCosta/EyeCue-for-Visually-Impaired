/**
 * API service for interacting with Hugging Face models via a local backend
 * Handles image processing, speech recognition, and text-to-speech functionality
 */

import axios from "axios";
import * as FileSystem from "expo-file-system";
import { Audio, AVPlaybackStatus } from "expo-av";

// Backend API endpoints
const BACKEND_URL = "http://192.168.1.20:8000";
const BLIP_API_URL = `${BACKEND_URL}/caption`;
const DETR_API_URL = `${BACKEND_URL}/detect`;
const BLIP_VQA_API_URL = `${BACKEND_URL}/vqa`;
const WHISPER_API_URL = `${BACKEND_URL}/transcribe`;
const SPEAK_API_URL = `${BACKEND_URL}/speak`;

// Utility function for async delay
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// API request configuration
const MAX_RETRIES = 6;
const RETRY_DELAY = 3000;
const FALLBACK_MESSAGE = "Error processing your request. Please try again.";

/**
 * Initializes the audio system with optimal settings for the application
 * Configures audio behavior for both iOS and Android platforms
 */
async function initializeAudio() {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
      allowsRecordingIOS: false,
    });
  } catch (error) {
    console.warn("Error initializing audio:", error);
  }
}

// Initialize audio system on module load
initializeAudio();

/**
 * Generic function to send image data to backend endpoints
 * Handles file conversion, form data creation, and request management
 * 
 * @param uri - Local URI of the image file
 * @param endpoint - Target API endpoint
 * @param extraData - Optional additional form data
 * @param signal - Optional abort signal for request cancellation
 * @returns API response data
 */
async function sendImage(
  uri: string,
  endpoint: string,
  extraData?: Record<string, any>,
  signal?: AbortSignal
): Promise<any> {
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  // Verify file exists
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists) throw new Error("File does not exist at URI");

  // Prepare form data
  const formData = new FormData();
  formData.append("file", {
    uri,
    name: "photo.jpg",
    type: "image/jpeg",
  } as any);

  // Add any extra form data
  if (extraData) {
    for (const key in extraData) {
      formData.append(key, extraData[key]);
    }
  }

  try {
    const response = await axios.post(endpoint, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      signal,
    });
    return response.data;
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'Request aborted') {
      throw new Error('Request aborted');
    }
    throw error;
  }
}

/**
 * Converts ArrayBuffer to Base64 string
 * Used for audio data processing
 */
function convertArrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

/**
 * Sends image for captioning using BLIP model
 * Implements retry logic with exponential backoff
 * 
 * @param uri - Local URI of the image file
 * @param signal - Optional abort signal for request cancellation
 * @returns Generated caption text
 */
export async function sendImageForCaptioning(
  uri: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    try {
      const data = await sendImage(uri, BLIP_API_URL, undefined, signal);
      if (data?.caption) {
        return data.caption;
      }
    } catch (error: any) {
      if (error.message === 'Request aborted') {
        throw error;
      }
      console.warn(
        `Caption attempt ${attempt} failed:`,
        error.message || error
      );
      if (attempt < MAX_RETRIES) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }
        await sleep(RETRY_DELAY);
      } else {
        return FALLBACK_MESSAGE;
      }
    }
  }
  return FALLBACK_MESSAGE;
}

/**
 * Sends image for object detection using DETR model
 * Implements retry logic with exponential backoff
 * 
 * @param uri - Local URI of the image file
 * @param signal - Optional abort signal for request cancellation
 * @returns Comma-separated list of detected objects
 */
export async function sendImageForObjectDetection(
  uri: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    try {
      const data = await sendImage(uri, DETR_API_URL, undefined, signal);
      if (data?.labels) {
        return data.labels.join(", ");
      } else {
        return "No objects detected.";
      }
    } catch (error: any) {
      if (error.message === 'Request aborted') {
        throw error;
      }
      console.warn(
        `Detection attempt ${attempt} failed:`,
        error.message || error
      );
      if (attempt < MAX_RETRIES) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }
        await sleep(RETRY_DELAY);
      } else {
        return FALLBACK_MESSAGE;
      }
    }
  }
  return FALLBACK_MESSAGE;
}

/**
 * Sends image and question for visual question answering using BLIP-VQA model
 * Implements retry logic with exponential backoff
 * 
 * @param uri - Local URI of the image file
 * @param question - Question text to ask about the image
 * @param signal - Optional abort signal for request cancellation
 * @returns Generated answer text
 */
export async function sendImageForVQA(
  uri: string,
  question: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    try {
      const data = await sendImage(uri, BLIP_VQA_API_URL, { question }, signal);
      if (data?.answer) {
        return data.answer;
      }
    } catch (error: any) {
      if (error.message === 'Request aborted') {
        throw error;
      }
      console.warn(
        `VQA attempt ${attempt} failed:`,
        error.message || error
      );
      if (attempt < MAX_RETRIES) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }
        await sleep(RETRY_DELAY);
      } else {
        return FALLBACK_MESSAGE;
      }
    }
  }
  return FALLBACK_MESSAGE;
}

/**
 * Sends image for color analysis using BLIP-VQA model
 * Implements retry logic with exponential backoff
 * 
 * @param uri - Local URI of the image file
 * @param signal - Optional abort signal for request cancellation
 * @returns Detected color description
 */
export async function sendImageForColorVQA(
  uri: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    try {
      const data = await sendImage(
        uri,
        BLIP_VQA_API_URL,
        { question: "What is the main color?" },
        signal
      );

      if (data?.answer) {
        return data.answer;
      } else {
        console.warn("No color detected. Returning Unknown.");
        return "Unknown";
      }
    } catch (error: any) {
      if (error.message === 'Request aborted') {
        throw error;
      }
      console.warn(
        `Color detection attempt ${attempt} failed:`,
        error.message || error
      );
      if (attempt < MAX_RETRIES) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }
        await sleep(RETRY_DELAY);
      } else {
        return FALLBACK_MESSAGE;
      }
    }
  }
  return FALLBACK_MESSAGE;
}

/**
 * Sends audio for transcription using Whisper model
 * Implements retry logic with exponential backoff
 * 
 * @param audioUri - Local URI of the audio file
 * @param signal - Optional abort signal for request cancellation
 * @returns Transcribed text
 */
export async function sendAudioForTranscription(
  audioUri: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) {
    return ""; // Silently return empty string on abort
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      return ""; // Silently return empty string on abort
    }

    try {
      const formData = new FormData();
      formData.append("file", {
        uri: audioUri,
        type: "audio/wav",
        name: "audio.wav",
      } as any);

      const response = await axios.post(WHISPER_API_URL, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
        signal,
      });

      if (response.data?.text) {
        console.log("Transcription successful:", response.data.text);
        return response.data.text;
      } else {
        console.warn("No transcription generated.");
        return "";
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message === 'Request aborted') {
        return ""; // Silently return empty string on abort
      }
      console.warn(
        `Transcription attempt ${attempt} failed:`,
        error.message || error
      );
      if (attempt < MAX_RETRIES) {
        if (signal?.aborted) {
          return ""; // Silently return empty string on abort
        }
        await sleep(RETRY_DELAY);
      } else {
        return FALLBACK_MESSAGE;
      }
    }
  }
  return FALLBACK_MESSAGE;
}

// Global reference to current speech sound
let currentSound: Audio.Sound | null = null;
export { currentSound };

/**
 * Cancels any ongoing speech playback
 * Ensures proper cleanup of audio resources
 */
export async function cancelSpeakText() {
  if (currentSound) {
    try {
      await currentSound.stopAsync();
      await currentSound.unloadAsync();
    } catch (err) {
      // Ignore cleanup errors
    } finally {
      currentSound = null;
    }
  }
}

/**
 * Converts text to speech and plays it
 * Handles audio file management and playback lifecycle
 * 
 * @param text - Text to convert to speech
 * @throws Error if speech generation or playback fails
 */
export async function speakText(text: string): Promise<void> {
  console.log("Starting text-to-speech for:", text);
  
  try {
    // Cancel any ongoing speech
    await cancelSpeakText();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Calculate timeout based on text length
    const estimatedDuration = Math.max(text.length * 0.1 + 5, 30) * 1000;
    const timeoutDuration = Math.min(estimatedDuration, 120000); // Cap at 2 minutes

    // Set up request timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

    // Request speech generation
    const response = await fetch(`${SPEAK_API_URL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `text=${encodeURIComponent(text)}`,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Process audio data
    const audioData = await response.arrayBuffer();
    if (!audioData || audioData.byteLength === 0) {
      throw new Error("Received empty audio data");
    }

    // Save audio file
    const fileUri = `${FileSystem.documentDirectory}speech.mp3`;
    await FileSystem.writeAsStringAsync(fileUri, convertArrayBufferToBase64(audioData), {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Verify file
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    if (!fileInfo.exists) {
      throw new Error("Failed to write audio file");
    }

    // Create and configure sound object
    const { sound } = await Audio.Sound.createAsync(
      { uri: fileUri },
      { shouldPlay: false }
    );

    // Set up playback completion handling
    const playPromise = new Promise<void>((resolve, reject) => {
      let hasResolved = false;
      let statusUpdateSubscription: { remove: () => void } | undefined;

      // Monitor playback status
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish && !hasResolved) {
          hasResolved = true;
          if (statusUpdateSubscription) {
            statusUpdateSubscription.remove();
            statusUpdateSubscription = undefined;
          }
          sound.unloadAsync().catch(console.warn);
          FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(console.warn);
          resolve();
        }
      });

      // Set playback timeout
      setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          if (statusUpdateSubscription) {
            statusUpdateSubscription.remove();
            statusUpdateSubscription = undefined;
          }
          sound.unloadAsync().catch(console.warn);
          FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(console.warn);
          reject(new Error(`Speech playback timeout after ${timeoutDuration/1000} seconds`));
        }
      }, timeoutDuration);
    });

    // Start playback
    await sound.playAsync();
    await playPromise;

  } catch (error) {
    console.error("Speech error:", error);
    if (error instanceof Error && error.message.includes("timeout")) {
      await cancelSpeakText();
    }
    throw error;
  }
}

