import { TabContext, UserPrompt, AgentAction } from "./models/types";
import { uploadContext, uploadUserPrompt } from "./api/agent";

let currentTabId: number | null = null;
let currentAudio: HTMLAudioElement | null = null;

/**
 * Listen for tab activation events to update the current tab ID.
 * Upon tab activation, send a message to the content script
 * to capture the DOM and screenshot. Send html and screenshot to backend to intialize LLM
 * conversation thread. Switching tabs resets conversation context.
 */
chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.OnActivatedInfo) => {
	// Update the current tab ID
	let currentTabId: number = activeInfo.tabId;
	// Send a message to the content script to capture the DOM and screenshot
	chrome.tabs.sendMessage(currentTabId, { type: "TAB_ACTIVATED" }, (domResponse: string) => {
		// If the content script responds with the DOM, upload the context
		if (!domResponse) {
			console.error("No DOM response received from content script.");
			return;
		}
		chrome.tabs.captureVisibleTab({ format: "png" }, async (screenshotUrl) => {
			await uploadContext({html: domResponse, screenshotUrl: screenshotUrl, tabId: activeInfo.tabId});
		});
		chrome.runtime.sendMessage({ type: 'TAB_OPEN', tabId: currentTabId });
	});
})

/**
 * Listen for tab removal events to handle tab closure.
 * If the closed tab is the current tab, reset the current tab ID.
 */
chrome.tabs.onRemoved.addListener((tabId: number, removeInfo: chrome.tabs.OnRemovedInfo) => {
	if (tabId === currentTabId) {
		chrome.runtime.sendMessage({ type: 'TAB_CLOSED', tabId });
		currentTabId = null;
	}
});
