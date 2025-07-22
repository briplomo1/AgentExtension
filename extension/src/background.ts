import { TabContext, UserPrompt, AgentAction, ChromeRuntimeMessage } from "./models/types";
import { uploadContext, uploadUserPrompt } from "./api/agent";

let currentTabId: number | null = null;
let isAudioPlaying: boolean = false;


/**
 * Listen for tab activation events to update the current tab ID.
 * Upon tab activation, send a message to the content script
 * to capture the DOM and screenshot. Send html and screenshot to backend to intialize LLM
 * conversation thread. Switching tabs resets conversation context.
 */
chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.OnActivatedInfo) => {
	console.log(`Tab activated: ${activeInfo.tabId}`);
	// Update the current tab ID
	currentTabId = activeInfo.tabId;
	// Send a message to the content script to capture the DOM and screenshot
	// let message: ChromeRuntimeMessage = { type: "TAB_ACTIVATED", tabId: currentTabId };
	// chrome.tabs.sendMessage(currentTabId, message, (domResponse: string) => {
	// 	// If the content script responds with the DOM, upload the context
	// 	if (!domResponse) {
	// 		console.error("No DOM response received from content script.");
	// 		return;
	// 	}
	// 	chrome.tabs.captureVisibleTab({ format: "png" }, async (screenshotUrl) => {
	// 		await uploadContext({html: domResponse, screenshotUrl: screenshotUrl, tabId: activeInfo.tabId});
	// 	});
	// });
})

/**
 * Listen for tab removal events to handle tab closure.
 * If the closed tab is the current tab, reset the current tab ID.
 */
chrome.tabs.onRemoved.addListener((tabId: number, removeInfo: chrome.tabs.OnRemovedInfo) => {
	console.log(`Tab closed: ${tabId}`);
	let msg: ChromeRuntimeMessage = { type: "TAB_CLOSED", tabId: tabId };
	chrome.runtime.sendMessage(msg);
	if (currentTabId === tabId) {
		currentTabId = null;
	}
});

chrome.runtime.onMessage.addListener((message: ChromeRuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
	console.log(`Received message: ${JSON.stringify(message)}`);

	switch (message.type) {
		case "USER_COMMAND_STARTED":
			console.log("User command detected in background at", message.timestamp);
			const msg: ChromeRuntimeMessage = {
				type: "USER_COMMAND_STARTED",
				timestamp: message.timestamp
			};
			if (currentTabId !== null) {
				chrome.tabs.sendMessage(currentTabId, msg);
			} else {
				console.error("No active tab to send USER_COMMAND_STARTED message to.");
			}
			break;
		case "AUDIO_CAPTURE_STARTED":
			console.log("Audio capture started at", message.timestamp);
			break;
		case "AUDIO_CAPTURE_STOPPED":
			console.log("Audio capture stopped at", message.timestamp);
			break;
		case "AUDIO_CAPTURE_ERROR":
			console.error("Audio capture error:", message.error, "Message:", message.message);
			break;
		case "SPEECH_RECOGNITION_STARTED":
			console.log("Speech recognition started at", message.timestamp);
			break;
		case "SPEECH_RECOGNITION_ENDED":
			console.log("Speech recognition ended at", message.timestamp);
			break;
		case "SPEECH_RECOGNITION_ERROR":
			console.error("Speech recognition error:", message.error, "Message:", message.message);
			break;
		case "VOICE_ACTIVITY_DETECTED":
			console.log("Voice activity detected at", message.timestamp);
			break;
		case "COPILOT_START":
			console.log("Copilot started at", message.timestamp);
			break;
		case "COPILOT_STOP":
			console.log("Copilot stopped at", message.timestamp);
			break;
		case "USER_COMMAND_RESULT":
			console.log("User command result received:", message.transcript);
			break;
		case "START_LISTENING":
			console.log("Started listening for user commands");
			break;
		case "STOP_LISTENING":
			console.log("Stopped listening for user commands");
			break;
		// case "PLAY_AUDIO":
		// 	if (currentAudio) {
		// 		currentAudio.play();
		// 		isAudioPlaying = true;
		// 		console.log("Playing audio");
		// 	} else {
		// 		console.warn("No audio to play");
		// 	}
		// 	break;
		case "TAB_OPEN":
		case "TAB_CLOSED":
		case "TAB_ACTIVATED":
			chrome.runtime.sendMessage(message); // Forward tab messages
			break;
		default:
			console.warn(`Unknown message type: ${message.type}`);
	}

	return true; // Keep the messaging channel open for async responses
});
