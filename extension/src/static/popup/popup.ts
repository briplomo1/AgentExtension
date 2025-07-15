/// <reference types="chrome"/>

document.getElementById('helloBtn')?.addEventListener('click', () => {
  alert('Hello from your browser extension!');
});

// Add type declarations for browser APIs and fix TS errors
let recognition: any = null;
let streaming = false;
let abortController: AbortController | null = null;

const responseDiv = document.getElementById('response') as HTMLDivElement;

function setupRecognition() {
  // @ts-ignore
  const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
  if (!SpeechRecognition) {
    responseDiv.textContent = 'Speech recognition not supported.';
    return null;
  }
  const recog = new SpeechRecognition();
  recog.continuous = false;
  recog.interimResults = false;
  recog.lang = 'en-US';
  return recog;
}

function playAudioFromBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
}

function fetchAndPlayAudio(audioUrl: string) {
  fetch(audioUrl)
    .then(res => res.blob())
    .then(playAudioFromBlob)
    .catch(e => {
      responseDiv.textContent = 'Audio playback error: ' + e;
    });
}
function sendToLLM(text: string) {
  abortController = new AbortController();
  responseDiv.textContent = 'Sending: ' + text;
  fetch('https://httpbin.org/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
    signal: abortController.signal
  })
    .then(r => r.json())
    .then(data => {
      // Simulate an audio URL in the response for demo
      const audioUrl = data.json && data.json.audioUrl ? data.json.audioUrl : null;
      if (audioUrl) {
        chrome.runtime.sendMessage({ type: 'PLAY_AUDIO', url: audioUrl });
        responseDiv.textContent = 'Playing audio response...';
      } else {
        responseDiv.textContent = 'No audio URL in response.';
      }
    })
    .catch(e => {
      if (e.name === 'AbortError') {
        responseDiv.textContent = 'Stopped.';
      } else {
        responseDiv.textContent = 'Error: ' + e;
      }
    });
}

window.onload = () => {
  // Stop any playing audio before listening
  chrome.runtime.sendMessage({ type: 'STOP_AUDIO' });
  recognition = setupRecognition();
  if (!recognition) return;
  streaming = true;
  responseDiv.textContent = 'Listening...';
  recognition.onresult = (event: any) => {
    const text = event.results[0][0].transcript;
    responseDiv.textContent = 'Heard: ' + text;
    sendToLLM(text);
  };
  recognition.onend = () => {
    if (streaming) {
      // Restart listening automatically
      recognition!.start();
    }
  };
  recognition.start();
};

// @ts-ignore: Chrome types may not be available
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg.type === 'TAB_SWITCH' || msg.type === 'TAB_CLOSED') {
    if (streaming) {
      if (recognition) recognition.stop();
      if (abortController) abortController.abort();
      streaming = false;
      responseDiv.textContent = 'Stopped due to tab switch.';
    }
  }
});
