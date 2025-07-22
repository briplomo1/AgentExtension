import { ChromeRuntimeMessage } from "../models/types";

type AudioEvent = {
  'audio:initialized': { audioAnalyzer: AnalyserNode; audioContext: AudioContext };
  'audio:error': { error: string; message: string };
  'audio:detected': { timestamp: number };
  'audio:ended': { timestamp: number };
}

export class AudioManager extends EventTarget{
    private audioContext: AudioContext | null = null;
    private audioAnalyzer: AnalyserNode | null = null;
    private mediaStream: MediaStream | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private highpassFilter: BiquadFilterNode | null = null;
    private lowpassFilter: BiquadFilterNode | null = null;
    private isVoiceDetectionActive = false;

    async initialize(): Promise<void> {
        try {
            // Initialize the audio context and media stream capture
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)(
                { sampleRate: 24000, latencyHint: 'interactive' }
            );

            if (!this.audioContext) {
                throw new Error("AudioContext is not supported in this browser.");
            }

            // Resume audio context if suspended (required by Chrome policy)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 24000,
                    channelCount: 1
                }
            });
            // Create audio processing nodes
            const audioSource: MediaStreamAudioSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.audioAnalyzer = this.audioContext.createAnalyser();
            this.audioAnalyzer.fftSize = 2048;
            this.audioAnalyzer.smoothingTimeConstant = 0.8;

            // Create audio processing nodes to remove useless frequencies, extraneous noise, and compress dynamic range
            this.highpassFilter = this.audioContext.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.setValueAtTime(100, this.audioContext.currentTime); // Remove sub 100hz freqs
            this.lowpassFilter = this.audioContext.createBiquadFilter();
            this.lowpassFilter.type = 'lowpass';
            this.lowpassFilter.frequency.setValueAtTime(9000, this.audioContext.currentTime); // Remove above 9khz freqs
            this.compressor = this.audioContext.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-24, this.audioContext.currentTime);
            this.compressor.knee.setValueAtTime(30, this.audioContext.currentTime);
            this.compressor.ratio.setValueAtTime(8, this.audioContext.currentTime);
            this.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
            this.compressor.release.setValueAtTime(0.25, this.audioContext.currentTime);

            // Set audio processing chain
            audioSource.connect(this.highpassFilter);
            this.highpassFilter.connect(this.lowpassFilter);
            this.lowpassFilter.connect(this.compressor);
            this.compressor.connect(this.audioAnalyzer);
            console.log('Audio processing initialized successfully');
            // Dispatch an event to notify that audio processing is initialized
            this.dispatchEvent(new CustomEvent("audio:initialized", {
                detail: { 
                    audioContext: this.audioContext,
                    audioAnalyzer: this.audioAnalyzer,
                    message: "Audio processing initialized successfully."
                }
            }));
        }
        catch (error) {
            console.error("Error initializing AudioManager:", error);
            this.dispatchEvent(new CustomEvent("audio:error", {
                detail: { message: "Failed to initialize audio processing", error }
            }));
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
    detectVoiceActivity(): boolean {
        if (!this.audioAnalyzer || !this.audioContext) {
            console.error('Audio analyzer or context not initialized');
            return false;
        }
        console.debug('Detecting voice activity...');
        const bufferLength = this.audioAnalyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.audioAnalyzer.getByteFrequencyData(dataArray);

        // Define voice activity range (200Hz to 7000Hz)
        const nyquist = this.audioContext.sampleRate / 2;
        const voiceRangeStart = Math.floor(200 * bufferLength / nyquist);
        const voiceRangeEnd = Math.floor(7000 * bufferLength / nyquist);

        // Calculate average volume
        let totalVolume = 0;
        for (let i = voiceRangeStart; i < voiceRangeEnd; i++) {
            totalVolume += dataArray[i];
        }

        const averageVolume = totalVolume / (voiceRangeEnd - voiceRangeStart);
        const threshold = 60;
        console.debug(`Average volume in voice range: ${averageVolume}, Threshold: ${threshold}`);
        return averageVolume > threshold;
    }

    /**
     * Start custom voice activity detection.
     * This function uses the audio analyzer to detect voice activity in the audio stream.
     * @returns 
     */
    startVoiceActivityDetection(): void {
        if (!this.audioAnalyzer || !this.audioContext) {
            console.error('Audio analyzer or context not initialized');
            return;
        }
        
        if (this.isVoiceDetectionActive) {
            console.log('Voice activity detection already active');
            return;
        }
        
        this.isVoiceDetectionActive = true;

        const detectLoop = () => {
            if (!this.isVoiceDetectionActive) {
                this.dispatchEvent(new CustomEvent('audio:voiceDetectionEnded', {
                    detail: { timestamp: Date.now() }
                }));
                return;
            }

            const isVoiceDetected = this.detectVoiceActivity();
            if (isVoiceDetected) {
                console.log('Voice activity detected by custom detection');
                this.dispatchEvent(new CustomEvent('audio:voiceDetected', {
                    detail: { timestamp: Date.now() }
                }));
            }
            requestAnimationFrame(detectLoop);
        };
        detectLoop();
        console.log('Voice activity detection started');
    }

    /**
     * Stop custom voice activity detection.
     * This function stops the audio analyzer from detecting voice activity.
     * @returns void
     */
    stopVoiceActivityDetection(): void {
        if (!this.isVoiceDetectionActive) {
        // TODO: Handle case where voice detection is not active
        console.log('Voice activity detection not active');
        return;
    }
        this.isVoiceDetectionActive = false;
    }

    /**
     * Stop all audio playback in the current tab.
     * Get all audio and video elements and pause them.
     */
    stopAllAudioPlayback(): void {
        try {
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

    /**
     * Initialize audio playback for the given audio source.
     * @param audioSource The audio source to play.
     */
    startAudioPlayback(audioSource: MediaStream): void {
        try {
        
            // TODO: Implement audio playback initialization
            const audioElement = new Audio();
            audioElement.srcObject = audioSource;
            audioElement.play();

        } catch (error) {
            console.error('Error stopping all audio playback:', error);
        }
    }

    getIsVoiceDetectionActive(): boolean {
        return this.isVoiceDetectionActive;
    }

}

