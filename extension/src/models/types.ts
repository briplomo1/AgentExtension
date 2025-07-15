import Stream from "stream";

// This file defines types used across the extension

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

    
export { TabContext, AgentAction, AgentActionType, UserPrompt };