import { ChromeRuntimeMessage } from "../models/types";
import { AudioManager } from "../modules/audio";
import { SpeechRecognizer } from "../modules/speechRecognition";

console.log("Initializing audio content script...");

let audioManager: AudioManager | null = null;
let speechRecognizer: SpeechRecognizer | null = null;
let isInitialized = false;

// TODO: use dispatchEvent from modules, use chrome runtime messages for scripts
function setupAudioEventListeners(): void {
    if (!audioManager || !speechRecognizer) {
        console.error("AudioManager or SpeechRecognizer not initialized");
        return;
    }
    chrome.runtime.onMessage.addListener((message: ChromeRuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        console.log(`Received chrome message in audioContent: ${JSON.stringify(message)}`);

        switch (message.type) {
            case "START_LISTENING":
                if (isInitialized) {
                    speechRecognizer?.startListening();
                } else {
                    console.warn("AudioManager or SpeechRecognizer not initialized yet, waiting for user gesture...");
                }
                break;
            case "STOP_LISTENING":
                speechRecognizer?.stopListening();
                break;
            case 'PLAY_AUDIO':
                console.log("Playing audio from content script");
                break;
            case "USER_COMMAND_STARTED":
                console.log("User command detected in audioContent at ", message.timestamp);
                audioManager?.stopAllAudioPlayback();
                break;
            default:
                console.warn(`Unhandled message type in audioContent: ${message.type}`);
                break;
        }
    });

    audioManager.addEventListener('audio:initialized', (event: Event) => {
        console.log("AudioManager initialized");
        speechRecognizer?.initialize();
        audioManager?.startVoiceActivityDetection();
    });

    audioManager.addEventListener('audio:error', (event: Event) => {   
        const customEvent = event as CustomEvent;
        console.error("AudioManager error:", customEvent.detail);
    });

    speechRecognizer.addEventListener('speech:started', (event: Event) => {
        const customEvent = event as CustomEvent;
        console.log("Speech recognition started:", customEvent.detail);
    });

    speechRecognizer.addEventListener('speech:ended', (event: Event) => {
        const customEvent = event as CustomEvent;
        console.log("Speech recognition ended:", customEvent.detail);
    });

    speechRecognizer.addEventListener('speech:result', (event: Event) => {
        const customEvent = event as CustomEvent;
        console.log("Speech recognition result:", customEvent.detail);
        const msg: ChromeRuntimeMessage = {
            type: 'USER_COMMAND_RESULT',
            timestamp: Date.now(),
            transcript: customEvent.detail.transcript
        };
        chrome.runtime.sendMessage(msg);
    });

    speechRecognizer.addEventListener('speech:error', (event: Event) => {
        const customEvent = event as CustomEvent;
        console.error("Speech recognition error:", customEvent.detail);
        const msg: ChromeRuntimeMessage = {
            type: 'SPEECH_RECOGNITION_ERROR',
            timestamp: Date.now(),
            error: customEvent.detail.error,
            message: customEvent.detail.message
        };
        chrome.runtime.sendMessage(msg);
    });

    speechRecognizer.addEventListener('speech:awake', (event: Event) => {
        const customEvent = event as CustomEvent;
        console.log("Speech awake command detected:", customEvent.detail);
        const msg: ChromeRuntimeMessage = {
            type: "USER_COMMAND_STARTED",
            timestamp: Date.now()
        };
        chrome.runtime.sendMessage(msg);
    });

    speechRecognizer.addEventListener('speech:sleep', (event: Event) => {
        const customEvent = event as CustomEvent;
        console.log("Speech sleep command detected:", customEvent.detail);
        const msg: ChromeRuntimeMessage = {
            type: "COPILOT_STOP",
            timestamp: Date.now()
        };
        chrome.runtime.sendMessage(msg);
    });
}

/**
 * After user interaction, initialize the audio manager, speech recognizer, and listeners.
 * This function is called when a user gesture is detected.
 * @returns {Promise<void>} A promise that resolves when the script is initialized.
*/
async function initializeWithUserGesture(): Promise<void> {
    try {
        console.log("User gesture detected, initializing audio script");
        
        audioManager = new AudioManager();
        speechRecognizer = new SpeechRecognizer(audioManager);
        setupAudioEventListeners();
        // This line requires user gesture
        await audioManager.initialize();
        
        isInitialized = true;
        console.log("Audio system initialized successfully");
        
    } catch (error) {
        console.error("Failed to initialize audio:", error);
        
        if (error instanceof Error) {
            if (error.name === 'NotAllowedError') {
                console.log("Microphone permission denied by user");
            } else if (error.name === 'NotFoundError') {
                console.log("No microphone found");
            }
        }
    }
}

// Function to set up user gesture listeners
// This is used to ensure that the audio manager and speech recognizer are initialized only after a user gesture.
function setupUserGestureListeners(): void {
    const events = ["click", "keydown", "touchstart"];

    const initHandler = async() => {
        // Remove event listeners after initialization to prevent multiple initializations
        if (!isInitialized) {
            await initializeWithUserGesture();
            events.forEach(event => {
                document.removeEventListener(event, initHandler);
            });
        }
    };

    events.forEach(event => {
        document.addEventListener(event, initHandler, { once: true });
    });
    console.log("Listening for user gesture for script initialization");
}


function main(): void {
    setupUserGestureListeners();
}

// Immediately invoke the main function to start the content script
main();
