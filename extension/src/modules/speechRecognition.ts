import { ChromeRuntimeMessage } from "../models/types";
import { AudioManager } from "./audio";

// Keep your existing speech recognition interfaces
interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechGrammarList {
    length: number;
    item(index: number): SpeechGrammar;
    [index: number]: SpeechGrammar;
    addFromURI(src: string, weight?: number): void;
    addFromString(string: string, weight?: number): void;
}

interface SpeechGrammar {
    src: string;
    weight: number;
}

export interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  serviceURI: string;
  grammars: SpeechGrammarList;
  
  start(): void;
  stop(): void;
  abort(): void;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onsoundstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onsoundend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

interface SpeechRecognizerEvents {
  'speech:started': { timestamp: number };
  'speech:ended': { timestamp: number };
  'speech:error': { error: string; message: string };
  'speech:result': { transcript: string; isFinal: boolean };
  'speech:awake': { timestamp: number };
  'speech:sleep': { timestamp: number };
}

export class SpeechRecognizer extends EventTarget {
    private recognition: SpeechRecognition | null = null;
    private isListening: boolean = false;
    private isCommandDetected: boolean = false;
    private audioManager: AudioManager | null = null;

    constructor(audioManager: AudioManager) {
        super();
        this.audioManager = audioManager;
        this.setupListeners();
    }

    /**
     * Setup the speech recognition event handlers.
     * 
     * TODO: decouple recognition and audio manager
     * TODO: Set audio and recognition as predefined event types instead of any string
     * @returns void
     */
    private setupListeners(): void {
        this.audioManager?.addEventListener('audio:voiceDetected', (event: Event) => {
            const customEvent = event as CustomEvent;
            if (!this.isListening) {
                console.log("Voice activity detected, starting speech recognition");
                this.startListening();
            }
        });

        this.audioManager?.addEventListener('audio:voiceDetectionEnded', () => {
            console.log("Custom voice activity detection stopped");
        });
    }
    /**
     * Initialize the speech recognition instance.
     * This function checks for browser support and sets up the speech recognition instance.
     * @returns void
     */
    initialize() : void {
        try {
            if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
                console.error("SpeechRecognition API is not supported in this browser.");
                return;
            }

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();

            this.setupRecognition();
            console.log("SpeechRecognition initialized successfully");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error("Error initializing SpeechRecognition:", error);
            const mesg: ChromeRuntimeMessage = {
                type: "SPEECH_RECOGNITION_ERROR",
                timestamp: Date.now(),
                error: errorMessage,
                message: "Failed to initialize SpeechRecognition API"
            };
            chrome.runtime.sendMessage(mesg);
        }
    }

    /**
     * Setup the speech recognition instance.
     * This function configures the speech recognition instance with the desired settings and event handlers.
     * @returns void
     */
    private setupRecognition(): void {
        if (!this.recognition || !this.audioManager) return;

        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        this.recognition.onstart = () => {
            console.log("Speech recognition started");
            this.dispatchEvent(new CustomEvent('speech:started', {
                detail: { timestamp: Date.now() }
            }));

            if (this.recognition?.continuous) {
                this.audioManager?.stopVoiceActivityDetection();
            }
        };

        this.recognition.onend = () => {
            console.log("Speech recognition ended");
            this.isListening = false;
            this.isCommandDetected = false;
            this.dispatchEvent(new CustomEvent('speech:ended', {
                detail: { timestamp: Date.now() }
            }));

            // Restart recognition if it was continuous
            if (this.recognition?.continuous) {
                console.log("Restarting speech recognition in continuous mode");
                this.startListening();
            } else {
                console.log("Started custom voice activity detection after speech recognition ended");
            this.audioManager?.startVoiceActivityDetection();
            }
        }

        this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            this.isListening = false;
            this.isCommandDetected = false;
            if (this.recognition?.continuous) {
                switch(event.error) {
                    case 'no-speech':
                        console.log("No speech detected...listening again");
                        if (!this.isListening) {
                            this.startListening();
                        }
                        break;
                    case 'aborted':
                        console.log("Speech recognition aborted");
                        break;
                    case 'not-allowed':
                    case 'audio-capture':
                        console.error("Critical error. Stopping recognition and disabling continuous mode. ", event.error);
                        this.recognition.continuous = false;
                        this.audioManager?.startVoiceActivityDetection();
                        this.dispatchEvent(new CustomEvent('speech:error', {
                            detail: { timestamp: Date.now(), error: event.error, message: event.message }
                        }));
                        break;
                    case 'network':
                        console.error("Network error, retrying recognition");
                        setTimeout(() => {
                            if (!this.isListening) {
                                this.startListening();
                            }
                        }, 3000);
                        break;
                    default:
                        console.error("Restarting speech recognition after unknown error occurred:", event.error);
                        setTimeout(() => {
                            if (!this.isListening) {
                                this.startListening();
                            }
                        }, 1000);
                        break;
                }
            } else {
                // If not continuous, just start voice activity detection
                console.log("Started voice activity detection after speech recognition error");
                this.audioManager?.startVoiceActivityDetection();
            }
        }


        this.recognition.onresult = async (event: SpeechRecognitionEvent) => {
            let interimTranscript = '';
            let finalTranscript = '';

            // Process speech recognition results
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript;
                if (result.isFinal) {
                finalTranscript += transcript;
                } else {
                interimTranscript += transcript;
                }
            }

            // Handle interim transcript results
            if (interimTranscript) {
                this.dispatchEvent(new CustomEvent('speech:result', {
                detail: { transcript: interimTranscript, isFinal: false }
                }));

                if (this.detectWakeWord(interimTranscript) && !this.isCommandDetected) {
                this.handleWakeup();
                return;
                }
            }

            // Handle final transcript results
            if (finalTranscript) {
                console.log("Final transcript:", finalTranscript);
                this.dispatchEvent(new CustomEvent('speech:result', {
                    detail: { transcript: finalTranscript, isFinal: true }
                }));

                if (this.detectWakeWord(finalTranscript) && !this.isCommandDetected) {
                    this.handleWakeup();
                    return;
                }
                
                if (this.detectSleepCommand(finalTranscript)) {
                    this.handleSleep();
                }
                // Reset command detection state for next transcript
                this.isCommandDetected = false;
            }
        }

        this.recognition.onsoundstart = () => {
            console.log("Sound detected");
            this.audioManager?.stopVoiceActivityDetection();
        }

        this.recognition.onsoundend = () => {
            console.log("Sound ended");
            this.audioManager?.startVoiceActivityDetection();
        }

        this.recognition.onspeechstart = () => {
            console.log("Speech started");
        }

        this.recognition.onspeechend = () => {
            console.log("Speech ended");
        }

        this.recognition.onaudiostart = () => {
            console.log("Audio started");
        }

        this.recognition.onaudioend = () => {
            console.log("Audio ended");
        }
    }

    /**
     * Detect wake word in the transcript.
     * @param transcript The speech transcript to analyze.
     * @returns True if a wake word is detected, false otherwise.
     */
    private detectWakeWord(transcript: string): boolean {
        const wakeWords = ["hey copilot", "ok copilot", "copilot"];
        return wakeWords.some(wakeWord => transcript.toLowerCase().includes(wakeWord));
    }

    /**
     * Detect sleep command in the transcript.
     * @param transcript The speech transcript to analyze.
     * @returns True if a sleep command is detected, false otherwise.
     */
    private detectSleepCommand(transcript: string): boolean {
        const sleepCommands = ["copilot stop", "stop copilot", "copilot exit", "copilot sleep"];
        return sleepCommands.some(command => transcript.toLowerCase().includes(command));
    }

    /**
     * Handle the detection of a wake word.
     * This function starts the speech recognition and dispatches a custom event.
     * It restarts speech recognition in continuous mode if it was not already.
     * It also stops any ongoing audio playback.
     */
    private handleWakeup() : void {
        console.log("Wake word detected, starting speech recognition");
        this.isCommandDetected = true;
        this.audioManager?.stopAllAudioPlayback();
        if (this.recognition && !this.recognition.continuous) {
            this.recognition.continuous = true;
        }
        this.dispatchEvent(new CustomEvent('speech:awake', {
            detail: { timestamp: Date.now() }
        }));
    }

    /**
     * Handle the detection of a sleep command.
     * This function stops the speech recognition, dispatches a custom event, and sends a message
     */
    private async handleSleep(): Promise<void> {
        console.log("Sleep command detected, stopping speech recognition");
        await this.disableContinuousMode();

        this.dispatchEvent(new CustomEvent('speech:sleep', {
            detail: { timestamp: Date.now() }
        }));
    }

    /**
     * Disable continuous mode for speech recognition.
     * This function sets the continuous mode of the speech recognition instance to false.
     * If the recognition is currently active, it will stop listening and restart in non-continuous mode.
     * @returns void
     */    
    async disableContinuousMode(): Promise<void> {
        if (this.recognition?.continuous) {
            this.recognition.continuous = false;
            console.log('Continuous mode disabled');
            if (this.isListening) {
                await this.stopListening();
                this.startListening();
            }
        }
    }

    /**
     * Start listening with voice recognition chrome api
     * @returns void
     * @throws Error if speech recognition is not initialized or already listening
     */
    startListening(): void {
        if (!this.recognition) {
            console.error("Speech recognition is not initialized");
            return;
        }

        if (this.isListening) {
            console.debug("Voice recognition is already listening.");
            return;
        }
        try {
            this.recognition.start();
            this.isListening = true;
            console.log("Speech recognition started");
        } catch (error) {
            console.error("Error starting speech recognition:", error);
        }
    }

    /**
     * Stop listening with voice recognition chrome api
     * @returns Promise<void>
     * @throws Error if speech recognition is not initialized or not currently listening
     */
    stopListening(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.recognition) {
                console.error("Speech recognition is not initialized");
                reject(new Error("Speech recognition is not initialized"));
                return;
            }

            if (!this.isListening) {
                console.warn("Voice recognition is not listening.");
                resolve();
                return;
            }

            try {
                this.recognition.stop();
                console.log("Speech recognition stopped");
                resolve();
            } catch (error) {
                console.error("Error stopping speech recognition:", error);
                reject(error);
            }
        });
    }
    
    /**
     * Check if the recognizer is currently listening.
     * @returns boolean indicating if the recognizer is listening
     */
    isCurrentlyListening(): boolean {
        return this.isListening;
    }

    /**
     * Check if the recognizer is in continuous mode.
     * @returns boolean indicating if the recognizer is in continuous mode
     */
    isContinuous(): boolean {
        return this.recognition ? this.recognition.continuous : false;
    }
}