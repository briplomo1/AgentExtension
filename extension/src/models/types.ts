import Stream from "stream";

// This file defines types used across the extension

/**
 * Chrome runtime messages to send and receive
 * These messages are used to communicate between the content script and the background script.
 * Defines the types of messages that can be sent and received.
 */
type ChromeRuntimeMessage =
// Audio processing messages
| {type: "USER_COMMAND_STARTED"; timestamp: number}
| {type: "AUDIO_CAPTURE_STARTED"; timestamp: number}
| {type: "AUDIO_CAPTURE_STOPPED"; timestamp: number}
| {type: "AUDIO_CAPTURE_ERROR"; timestamp: number; error: string; message: string}
| {type: "SPEECH_RECOGNITION_STARTED"; timestamp: number}
| {type: "SPEECH_RECOGNITION_ENDED"; timestamp: number}
| {type: "SPEECH_RECOGNITION_ERROR"; timestamp: number; error: string; message: string}
| {type: "VOICE_ACTIVITY_DETECTED"; timestamp: number}
| {type: "COPILOT_START"; timestamp: number}
| {type: "COPILOT_STOP"; timestamp: number}
| {type: "USER_COMMAND_RESULT"; timestamp: number; transcript: string}
| {type: "START_LISTENING"; timestamp: number}
| {type: "STOP_LISTENING"; timestamp: number}
| {type: "PLAY_AUDIO"; timestamp: number}

// Tab management messages
| {type: "TAB_OPEN"; tabId: number}
| {type: "TAB_CLOSED"; tabId: number}
| {type: "TAB_ACTIVATED"; tabId: number};


/**
 * Interface for the context of the current tab
 */
type TabContext = {
    html: string; // HTML content of the current tab
    screenshotUrl: string; // URL of the screenshot of the current tab
    tabId: number; // ID of the current tab
}


/**
 * Type for the user prompt sent to the LLM
 * This includes the prompt text and the ID of the active tab
 */
type UserPrompt = {
    prompt: string; // The user's prompt to be sent to the LLM
    activeTabId: number; // The ID of the active tab where the prompt was made
}


/**
 * Type for the agent action that can be performed
 */
type AgentActionType = 
    | "SWITCH_TAB"
    | "SEARCH"
    | "SCROLL"
    | "ENTER_TEXT"
    | "CLICK"
    | "DESCRIBE_SCREEN"
    | "ZOOM_IN"
    | "ZOOM_OUT"
    | "GO_TO_SITE";


/**
 * Response sent from agent to the content script which corresponds to a certain
 * action to be performed in the browser on behalf o fhte user.
 * Each action can have different parameters based on the action type
 */
type AgentAction = 
    | {type: AgentActionType; tabIndex: number}
    | {type: AgentActionType; query: string}
    | {type: AgentActionType; direction: 'UP' | 'DOWN', amount: number}
    | {type: AgentActionType; text: string, elementSelector: string}
    | {type: AgentActionType; elementSelector: string}
    | {type: AgentActionType; description: Stream}
    | {type: AgentActionType; amount: number}
    | {type: AgentActionType; amount: number}
    | {type: AgentActionType; url: string};
    
export { TabContext, AgentAction, AgentActionType, UserPrompt, ChromeRuntimeMessage };