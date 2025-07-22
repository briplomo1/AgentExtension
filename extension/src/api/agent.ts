import{ AgentAction, TabContext } from '../models/types';

const BACKEND_URL = "http://localhost:7071/api/orchestrators"
/**
 * Upon a tab becoming active, this function uploads the tab context to a serverless 
 * function. Context is fed to a LLM to provide background for upcoming user prompts.
 * 
 * @param tabContext The context of the current tab, including HTML, screenshot URL, 
 * and tab ID.
 * @returns Promise that resolves with the agent chat thread ID which is used for
 * subsequent user prompts.
 */
async function uploadContext(tabContext: TabContext): Promise<string> {
    try {
        const response: Response = await fetch(`${BACKEND_URL}/agent_init_orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tabContext)
        });

        if (!response.ok) {
            throw new Error(`Error: ${response.status}, ${response.statusText}`);
        }
        const data = await response.json();
        console.log('Context uploaded successfully:', data);
        return data.chatThreadId;
    } catch (error) {
        throw new Error(`Failed to upload tab activation context: ${error}`);
    }
}

/**
 * Uploads a user prompt to a serverless function backed by an LLM.
 * @param prompt The user prompt to be sent.
 * @returns The action to be performed by the extension on behalf of the user along
 * with corresponding arguements for the action @see ../models/types.ts.
 */
async function uploadUserPrompt(userPrompt: string, chatThreadId: string): Promise<AgentAction> {
    try {
        const response: Response = await fetch(`${BACKEND_URL}/agent_action_orchestrator`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userPrompt, chatThreadId })
        });

        if (!response.ok) {
            throw new Error(`Error: ${response.status}, ${response.statusText}`);
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(`Error: ${data.error}`);
        }
        if (data['response_type'] == 'tool_calls') {
            const actions = data.actions;
            console.log('Actions received:', actions);
            
            // Handle array of actions - take the first one
            if (Array.isArray(actions) && actions.length > 0) {
                const firstAction = actions[0];
                console.log('First action:', firstAction);
                
                // Create the AgentAction object with type and spread the arguments
                const res = {
                    type: firstAction.action,
                    ...firstAction.arguments
                } as AgentAction;
                
                console.log('Agent action to perform:', res);
                return res;
            } else {
                throw new Error('No actions received in tool_calls response');
            }
        }
        return {type: "play_audio", audio: data["chat_audio"]} as AgentAction;
    } catch (error) {
        throw new Error(`Failed to upload user prompt: ${error}`);
    }
}

export { uploadContext, uploadUserPrompt };