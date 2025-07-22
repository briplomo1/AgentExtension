import { TabContext, UserPrompt, AgentAction, ChromeRuntimeMessage } from "./models/types";
import { uploadContext, uploadUserPrompt } from "./api/agent";

let currentTabId: number | null = null;
let isAudioPlaying: boolean = false;
const tabChatThreads: Map<number, string> = new Map();


function getTabChatThreadId(tabId: number | null): string | null {
	if (tabId === null) {
		return null;
	}
	return tabChatThreads.get(tabId) || null;
}

function setTabChatThreadId(tabId: number, chatThreadId: string): void {
	tabChatThreads.set(tabId, chatThreadId);
}

function clearTabChatThreadId(tabId: number): void {
	// TODO: delete the chat thread from the backend if necessary
	tabChatThreads.delete(tabId);
}

/**
 * Handle user prompts with the current chat thread.
 */
async function handleUserPrompt(prompt: string): Promise<void> {
	if (!currentTabId) {
        console.error("No active tab");
        return;
    }
    const threadId = getTabChatThreadId(currentTabId);
    if (!threadId) {
        console.error("No active chat thread for current tab");
        return;
    }
    
    try {
        const agentAction = await uploadUserPrompt(prompt, threadId);
        console.log("Agent action received:", agentAction);
        // Send action to content script for execution
		const msg: ChromeRuntimeMessage = {
			type: "AGENT_ACTION",
			action: agentAction,
			timestamp: Date.now(),
		};
        chrome.tabs.sendMessage(currentTabId, msg);
    } catch (error) {
        console.error('Failed to handle user prompt:', error);
    }
}

function setupTabListeners(): void {
	console.log("Setting up Chrome runtime listeners in background script");

	// Listen for tab activation events to update the current tab ID.
	chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.OnActivatedInfo) => {
		console.log(`Tab activated: ${activeInfo.tabId}`);
			processTabActivation(activeInfo.tabId);
		});

	chrome.tabs.onRemoved.addListener((tabId: number, removeInfo: chrome.tabs.OnRemovedInfo) => {
		console.log(`Tab closed: ${tabId}`);
		// Clear the chat thread ID for the closed tab
		clearTabChatThreadId(tabId);
		// Reset current tab ID if the closed tab was the current one
		if (currentTabId === tabId) {
			currentTabId = null;
		}
	});
}


async function processTabActivation(tabId: number): Promise<void> {
	console.log(`Processing tab activation for tab: ${tabId}`);
	currentTabId = tabId;

	const existingThreadId = getTabChatThreadId(currentTabId);
	if (existingThreadId) {
		console.log(`Using existing chat thread ID: ${existingThreadId}`);
		return;
	}

	try {
		// Send a message to the content script to capture the html
		const response = await new Promise<any>((resolve, reject) => {
			chrome.tabs.sendMessage(tabId, { type: "TAB_ACTIVATED", tabId: tabId }, (response) => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
				} else {
					resolve(response);
				}
			});
		});

		if (!response || !response.html) {
			throw new Error("No HTML content received from content script.");
		}
		// Capture a sdcreenshot of the current tab
		const screenshotUrl = await new Promise<string>((resolve, reject) => {
			chrome.tabs.captureVisibleTab({ format: "png" }, (url: string) => {
				if (chrome.runtime.lastError) {
					reject(chrome.runtime.lastError);
				} else {
					resolve(url);
				}
			});
		});

		// Upload initial chat thread context to backend and save chat thread ID
		const chatThreadId = await uploadContext({
			html: response.html,
			screenshotUrl: screenshotUrl,
			tabId: tabId
		});

		setTabChatThreadId(tabId, chatThreadId);
		console.log(`Context uploaded successfully for tab ${tabId}. Chat thread ID: ${chatThreadId}`);

	} catch (error) {
		console.error(`Error processing tab activation for tab ${tabId}:`, error);
	}


}

chrome.runtime.onMessage.addListener((message: ChromeRuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    console.log(`Received message: ${JSON.stringify(message)}`);

    // Handle async cases that need to return true
    if (message.type === "USER_COMMAND_RESULT") {
        console.log("User command result received in background:", message.transcript);
        if (message.transcript) {
            handleUserPrompt(message.transcript)
                .then(() => {
                    sendResponse({ status: "ok" });
                })
                .catch((error) => {
                    console.error("Error handling user prompt:", error);
                    sendResponse({ status: "error", message: error.message || error });
                });
        } else {
            console.error("No transcript found in USER_COMMAND_RESULT message.");
            sendResponse({ status: "error", message: "No transcript found in USER_COMMAND_RESULT message." });
			return false;
        }
        return true; // Keep channel open for async response
    }

    // Handle all other cases synchronously
    switch (message.type) {
        case "SCRIPT_LOADED":
            console.log("Content script loaded at", message.timestamp);
            setupTabListeners();
            if (sender.tab?.id) {
                console.log("Processing current active tab after script load");
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    if (tabs[0] && tabs[0].id === sender.tab?.id) {
                        processTabActivation(tabs[0].id!);
                    }
                });
            }
            break;
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
        case "AUDIO_CAPTURE_STOPPED":
        case "AUDIO_CAPTURE_ERROR":
        case "SPEECH_RECOGNITION_STARTED":
        case "SPEECH_RECOGNITION_ENDED":
        case "SPEECH_RECOGNITION_ERROR":
        case "VOICE_ACTIVITY_DETECTED":
        case "COPILOT_START":
        case "COPILOT_STOP":
        case "START_LISTENING":
        case "STOP_LISTENING":
            console.log(`Handled message: ${message.type}`);
            break;
        case "TAB_OPEN":
        case "TAB_CLOSED":
        case "TAB_ACTIVATED":
            chrome.runtime.sendMessage(message);
            break;
        default:
            console.warn(`Unknown message type: ${message.type}`);
            break;
    }

    // Send synchronous response for all non-async cases
    sendResponse({ status: "ok" });
    return false;
});
