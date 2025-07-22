import { ChromeRuntimeMessage } from "../models/types";
import { AudioManager } from "../modules/audio";
import { SpeechRecognizer } from "../modules/speechRecognition";
import { AgentAction } from "../models/types";
import { BrowserActions } from "../actions/actions";

console.log("Initializing audio content script...");

let audioManager: AudioManager | null = null;
let speechRecognizer: SpeechRecognizer | null = null;
let isInitialized = false;

function executeAgentAction(action: AgentAction): void {
    console.log(`Executing agent action: ${JSON.stringify(action)}`);
    
    switch (action.type) {
        case "web_search":
            BrowserActions.webSearch(action.query);
            break;
        case "click_element":
            BrowserActions.click_element(action.selector);
            break;
        case "type_text":
            BrowserActions.typeText(action.text, action.selector);
            break;
        case "scroll_direction":
            BrowserActions.scrollDirection(action.direction, action.amount);
            break;
        case "scroll_position":
            BrowserActions.scrollPosition(action.selector, action.scrollPosition);
            break;
        case "describe_page":
            // Handle describe_page action
            // TODO: Implement the logic to describe the page
            console.log("Describe page action:", action.description);
            break;
        case "go_back":
            BrowserActions.goBack(action.tabIndex);
            break;
        case "go_forward":
            BrowserActions.goForward(action.tabIndex);
            break;
        case "refresh_page":
            BrowserActions.refreshPage(action.tabIndex);
            break;
        case "zoom":
            BrowserActions.zoom(action.level);
            break;
        case "go_to_url":
            BrowserActions.goToUrl(action.url);
            break;
        default:
            // TypeScript sometimes infers 'never' if all cases are covered; ensure AgentAction allows for unknown types.
            console.warn(`Unhandled agent action type: ${(action as AgentAction).type}`);
    }
}

function setupChromeRuntimeListeners(): void {
    chrome.runtime.onMessage.addListener((message: ChromeRuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        console.log(`Received message in audioContent: ${JSON.stringify(message)}`);
        switch (message.type) {
            case "USER_COMMAND_STARTED":
                audioManager?.stopAllAudioPlayback();
                break;
            case "TAB_ACTIVATED":
                try {
                    console.log("Tab activated in audioContent script");
                    // If the tab is activated, we can initialize the audio manager and speech recognizer
                    const htmlContent = getPageContent();
                    console.log("HTML content captured:", htmlContent);
                    sendResponse({html: htmlContent});
                } catch (error) {
                    console.error("Error capturing HTML content:", error);
                    sendResponse({error: "Failed to capture HTML content"});
                }
                
                break;
            case "AGENT_ACTION":
                if (message.action) {
                    executeAgentAction(message.action);
                }
                break;
            default:
                console.warn(`Unhandled message type in audioContent: ${message.type}`);
        }
        return true;
    });
}

// TODO: use dispatchEvent from modules, use chrome runtime messages for scripts
function setupAudioEventListeners(): void {
    if (!audioManager || !speechRecognizer) {
        console.error("AudioManager or SpeechRecognizer not initialized");
        return;
    }

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
 * Get the cleaned-up HTML content of the current page.
 * This function removes unnecessary elements like scripts, styles, and other non-essential content
 * to provide a clean HTML structure for further processing.
 * @returns The HTML content of the current page, cleaned up and ready for processing.
 */
function getPageContent(): string {
    const doc = document.cloneNode(true) as Document;

    const elementsToRemove = [
        'script', 'style', 'link[rel="stylesheet"]', 'meta[name="viewport"]',
        'meta[name="description"]', 'meta[name="keywords"]', 'meta[name="author"]',
        'object', 'embed', 'iframe', 'noscript', 'svg', 'canvas',
    ]
    elementsToRemove.forEach(selector => {
        const elements = doc.querySelectorAll(selector);
        elements.forEach(el => el.remove());
    });

    const body = doc.body;
    if(!body) return '';

    const html = body.innerHTML
    .replace(/\s+/g, ' ') // Remove extra whitespace
    .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
    .replace(/>\s+</g, '><') // Remove whitespace between tags
    .trim(); // Trim leading and trailing whitespace

    return html;
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
    setupChromeRuntimeListeners();
    chrome.runtime.sendMessage({
        type: "SCRIPT_LOADED",
        timestamp: Date.now(),
        url: window.location.href
    });
}

// Immediately invoke the main function to start the content script
main();
