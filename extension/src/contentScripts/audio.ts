import { ChromeRuntimeMessage } from "../models/types";

// Speech recognition interface
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

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
}

interface SpeechRecognition extends EventTarget {
    // Methods defined by chromium speech recognition api
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

// Audio context, stream, analyzer, and filtering features for Web Audio API
let audioContext: AudioContext | null = null;
let audioAnalyzer: AnalyserNode | null = null;
let mediaStream: MediaStream | null = null;
let noiseGate: GainNode | null = null;
let compressor: DynamicsCompressorNode | null = null;
let highpassFilter: BiquadFilterNode | null = null;
let lowpassFilter: BiquadFilterNode | null = null;

// Speech recognition instance
let recognition: SpeechRecognition | null = null;
// Flag to track if speech recognition is currently active
let isListening = false;
// Flag to track if custom voice detection is active
let isVoiceDetectionActive = false;
// Flag to track if copilot command has been detected
// This is used to prevent multiple detections of the same command
let copilotCommandDetected = false;

async function initializeAudioProcessing(): Promise<void> {
    try {
        // Initialize audio context
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        // Create media stream for audio input
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 24000,
                channelCount: 1
            }
        });

        // Create audio source from media stream
        const audioSource = audioContext.createMediaStreamSource(mediaStream);

        // Create audio analyzer for voice activity detection
        audioAnalyzer = audioContext.createAnalyser();
        audioAnalyzer.fftSize = 2048;
        audioAnalyzer.smoothingTimeConstant = 0.8;

        // Create audio processing nodes to remove useless frequencies, extraneous noise, and compress dynamic range
        highpassFilter = audioContext.createBiquadFilter();
        highpassFilter.type = 'highpass';
        highpassFilter.frequency.setValueAtTime(100, audioContext.currentTime); // Remove sub 100hz freqs
        lowpassFilter = audioContext.createBiquadFilter();
        lowpassFilter.type = 'lowpass';
        lowpassFilter.frequency.setValueAtTime(9000, audioContext.currentTime); // Remove above 9khz freqs

        // Set noise gate threshold to -24 dB
        compressor = audioContext.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, audioContext.currentTime);
        compressor.knee.setValueAtTime(30, audioContext.currentTime);
        compressor.ratio.setValueAtTime(8, audioContext.currentTime);
        compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
        compressor.release.setValueAtTime(0.25, audioContext.currentTime);

        // Set audio processing chain
        audioSource.connect(highpassFilter);
        highpassFilter.connect(lowpassFilter);
        lowpassFilter.connect(compressor);
        compressor.connect(audioAnalyzer);

        console.log('Audio processing initialized successfully');

    } catch (error) {
        console.error('Error initializing audio processing:', error);
        let message: ChromeRuntimeMessage = {
            type: 'AUDIO_CAPTURE_ERROR',
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Failed to initialize audio processing'
        }
        chrome.runtime.sendMessage(message);
    }
}


function initializeSpeechRecognition(): void {
    try {
        // Check if speech recognition is supported
        if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
            console.error('Speech recognition not supported in this browser');
            return;
        }

        // Create speech recognition instance
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();

        // Configure speech recognition
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        // On recognition service started
        recognition.onstart = () => {
            console.log('Speech recognition started');
            isListening = true;
            let message: ChromeRuntimeMessage = {
                type: 'SPEECH_RECOGNITION_STARTED',
                timestamp: Date.now()
            };
            chrome.runtime.sendMessage(message);
            if (recognition?.continuous) {
                stopVoiceActivityDetection();
            }
        };

        // On audio capture started
        recognition.onaudiostart = () => {
            console.log('Audio capture started');
        };

        // On any sound is detected
        recognition.onsoundstart = () => {
            console.log('Sound detected');
        };

        // On speech detected
        recognition.onspeechstart = () => {
            console.log('Speech detected');
        }

        recognition.onsoundend = () => {
            console.log('Sound ended'); 
        }

        recognition.onspeechend = () => {
            console.log('Speech ended');
        }

        // If continuous mode is enabled, restart listening after speech ends
        // If not continuous, it will stop after speech ends and resume custom voice detection
        // until voice is detected again
        recognition.onend = () => {
            console.log('Speech recognition ended');
            isListening = false;
            copilotCommandDetected = false;
            if (recognition?.continuous) {
                console.log('Restarting speech recognition due to continuous mode');
                startListening();
            } else {
                let message: ChromeRuntimeMessage = {
                    type: 'SPEECH_RECOGNITION_ENDED',
                    timestamp: Date.now()
                };
                chrome.runtime.sendMessage(message);
                console.log('Starting custom voice detection after speech recognition ended');
                startVoiceActivityDetection();
            }
        }

        // On error notify the background script
        recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
            console.error('Speech recognition error:', event.error, event.message);
            isListening = false;
            copilotCommandDetected = false;
            let message: ChromeRuntimeMessage = {
                type: 'SPEECH_RECOGNITION_ERROR',
                timestamp: Date.now(),
                error: event.error,
                message: event.message
            };
            chrome.runtime.sendMessage(message);
            console.log('Restarting custom voice detection after error');
            startVoiceActivityDetection();
        };

        // On speech recognition result obtained.
        // May be a final or interim speech result
        recognition.onresult = async (event: SpeechRecognitionEvent) => {
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

            // Handle interim results
            if (interimTranscript) {
                // If interim transcript contains "hey copilot" or "copilot", stop all audio playback.
                // Send event to background script for further actions.
                console.log('Interim transcript:', interimTranscript);
                if ((interimTranscript.toLowerCase().includes('hey copilot') || 
                interimTranscript.toLowerCase().includes('copilot')) && 
                !copilotCommandDetected) {
                    copilotCommandDetected = true; // Set flag to prevent multiple detections
                    stopAllAudioPlayback();
                    console.log('Wakeword detected in interim transcript');
                    if (recognition?.continuous) {
                        console.log('Enabling continuous mode for speech recognition in interim transcript');
                        recognition!.continuous = true;
                    }
                    let message: ChromeRuntimeMessage = {
                        type: 'USER_COMMAND_STARTED',
                        timestamp: Date.now()
                    };
                    chrome.runtime.sendMessage(message);
                    return;
                }
            }

            // If a user prompt has been completed check for awake or sleep commands
            // If a final transcript is obtained, send it to the background script
            if (finalTranscript) {
                console.log('Final transcript:', finalTranscript);
                // If final transcript contains "hey copilot" or "copilot", stop all audio playback
                // if not already stopped. Enable continuous mode if its not already enabled.
                if ((finalTranscript.toLowerCase().includes('hey copilot') ||
                finalTranscript.toLowerCase().includes('copilot')) &&
                !copilotCommandDetected) {
                    console.log('Wake phrase detected in final transcript');
                    stopAllAudioPlayback();
                    
                    if (recognition?.continuous) {
                        console.log('Enabling continuous mode for speech recognition in final transcript');
                        recognition!.continuous = true;
                    }
                    let message: ChromeRuntimeMessage = {
                        type: 'USER_COMMAND_STARTED',
                        timestamp: Date.now()
                    };
                    chrome.runtime.sendMessage(message);
                    return;
                }
                
                // If final transcript contains "stop copilot" or "copilot stop", disable continuous mode
                // and send a message to the background script to stop copilot.
                if (finalTranscript.toLowerCase().includes('stop copilot') ||
                finalTranscript.toLowerCase().includes('copilot stop')) {
                    console.log('Stop command detected in final transcript');
                    await disableContinuousMode();
                    let message: ChromeRuntimeMessage = {
                        type: 'COPILOT_STOP',
                        timestamp: Date.now()
                    };
                    chrome.runtime.sendMessage(message);
                }

                // Send final transcript to background script
                let message: ChromeRuntimeMessage = {
                    type: 'USER_COMMAND_RESULT',
                    timestamp: Date.now(),
                    transcript: finalTranscript
                };
                chrome.runtime.sendMessage(message);
            }
        };

        console.log('Speech recognition initialized successfully');
    } catch (error) {
        console.error('Failed to initialize speech recognition:', error);
        let message: ChromeRuntimeMessage = {
            type: 'SPEECH_RECOGNITION_ERROR',
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Failed to initialize speech recognition'
        };
        chrome.runtime.sendMessage(message);
    }
}


/**
 * Detect voice activity in the audio stream.
 * This function uses the audio analyzer to check if there is voice activity.
 * It calculates the average volume in the voice activity range (200Hz to 7000Hz)
 * and compares it to a threshold to determine if voice activity is present.
 * Is used to determine if main voice recognition should be started.
 * @returns boolean indicating if voice activity is detected
 */
function detectVoiceActivity(): boolean {
    if (!audioAnalyzer || !audioContext) {
        console.error('Audio analyzer or context not initialized');
        return false;
    }
    const bufferLength = audioAnalyzer.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    audioAnalyzer.getFloatFrequencyData(dataArray);

    // Define voice activity range (e.g., 200Hz to 7000Hz)
    const voiceRangeStart = Math.floor(200 * bufferLength / audioContext.sampleRate / 2);
    const voiceRangeEnd = Math.floor(7000 * bufferLength / audioContext.sampleRate / 2);

    // Calculate average volume
    let totalVolume = 0
    for (let i = voiceRangeStart; i < voiceRangeEnd; i++) {
        totalVolume += Math.pow(10, dataArray[i] / 10);
    }

    const averageVolume = totalVolume / (voiceRangeEnd - voiceRangeStart);
    const threshold = 0.1;
    console.log(`Average volume detected: ${averageVolume}`);

    // TODO: Adjust threshold based on testing
    return averageVolume > threshold;
}

/**
 * Start custom voice activity detection.
 * This function uses the audio analyzer to detect voice activity in the audio stream.
 * @returns 
 */
function startVoiceActivityDetection(): void {
    if (!audioAnalyzer || !audioContext) {
        console.error('Audio analyzer or context not initialized');
        return;
    }
    if (isVoiceDetectionActive) {
        console.log('Voice activity detection already active');
        return;
    }
    isVoiceDetectionActive = true;

    const detectLoop = () => {
        if (!isVoiceDetectionActive) {
            console.log('Voice activity detection stopped');
            return;
        }

        const isVoiceDetected = detectVoiceActivity();
        // Start speech recognition if speech is detected and not already on
        if (isVoiceDetected && !isListening) {
            console.log('Voice activity detected by custom detection');
            startListening();
        }

        requestAnimationFrame(detectLoop);
    };

    detectLoop();
}

/**
 * Disable continuous mode for speech recognition.
 * This function sets the continuous mode of the speech recognition instance to false.
 * If the recognition is currently active, it will stop listening and restart in non-continuous mode.
 * @returns void
 */
async function disableContinuousMode(): Promise<void> {
    if (recognition?.continuous) {
        recognition.continuous = false;
        console.log('Continuous mode disabled');   
        // If currently listening, restart in non-continuous mode
        if (isListening) {
            await stopListening();
            startListening();
        }
    }
}
/**
 * Stop custom voice activity detection.
 * This function stops the audio analyzer from detecting voice activity.
 * @returns void
 */
function stopVoiceActivityDetection(): void {
    if (!isVoiceDetectionActive) {
        // TODO: Handle case where voice detection is not active
        console.log('Voice activity detection not active');
        return;
    }
    isVoiceDetectionActive = false;
}

/**
 * Start listening with voice recognition chrome api
 */
function startListening(): void {
    if (!recognition) {
        console.error('Speech recognition not initialized');
        return;
    }

    if (isListening) {
        console.log('Already listening');
        return;
    }

    try {
        recognition.start();
        console.log('Started listening for speech');
    } catch (error) {
        console.error('Failed to start speech recognition:', error);
    }
}

/**
 * Stop listening for speech input with voice recognition api.
 * Wait for the recognition to end completely before resolving the promise.
 */
function stopListening(): Promise<void> {
    return new Promise<void>((resolve) => {
        if (!recognition) {
            console.error('Speech recognition not initialized');
            resolve();
            return;
        }

    if (!isListening) {
        console.log('Not currently listening');
        resolve();
        return;
    }
    const handleEnd = () => {
        recognition!.removeEventListener('end', handleEnd);
        resolve();
    };
    recognition.addEventListener('end', handleEnd);
    recognition.stop();
    });
}

/**
 * Check if speech recognition is currently active
 */
function isCurrentlyListening(): boolean {
    return isListening;
}

/**
 * Initialize audio playback for the given audio source.
 * @param audioSource The audio source to play.
 */
function initializeAudioPlayback(audioSource: MediaStream): void {
    try {
    
        // TODO: Implement audio playback initialization
        const audioElement = new Audio();
        audioElement.srcObject = audioSource;
        audioElement.play();

    } catch (error) {
        console.error('Error stopping all audio playback:', error);
    }
}

/**
 * Stop all audio playback in the current tab.
 * Get all audio and video elements and pause them.
 */
function stopAllAudioPlayback(): void {
    try{
        const mediaElements = document.querySelectorAll('audio, video');
        mediaElements.forEach((media) => {
            if (media instanceof HTMLMediaElement && !media.paused) {

                media.pause();
                console.log('Paused media playback:', media);
            }
        });

    } catch (error) {
        console.error('Error stopping all audio playback:', error);
    }
}

function applyNoiseGate(): void {
    if (!noiseGate || !audioContext) {
        console.error('Noise gate not initialized');
        return;
    }
    // Set noise gate threshold to -24 dB
    noiseGate.gain.setValueAtTime(0, audioContext.currentTime);
    console.log('Noise gate applied');
}

//driver code
(async () => {

    chrome.runtime.onMessage.addListener((message: ChromeRuntimeMessage) => {
        switch (message.type) {
            case 'START_LISTENING':
                startListening();
                break;
            case 'STOP_LISTENING':
                stopListening();
                break;
            case 'PLAY_AUDIO':
                console.log('Playing audio');
                break;
            default:
                console.error('Unknown message type:', message.type);
        }
    });

    await initializeAudioProcessing();
    initializeSpeechRecognition();
    startVoiceActivityDetection();
})();
