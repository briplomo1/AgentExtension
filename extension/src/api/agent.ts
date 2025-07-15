import{ AgentAction, TabContext } from '../models/types';

/**
 * Upon a tab becoming active, this function uploads the tab context to a serverless 
 * function. Context is fed to a LLM to provide background for upcoming user prompts.
 * 
 * @param tabContext The context of the current tab, including HTML, screenshot URL, 
 * and tab ID.
 * @returns Promise that resolves when the upload is complete.
 */
async function uploadContext(tabContext: TabContext): Promise<void> {
    try {
        const response: Response = await fetch('https://your-serverless-function-url', {
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
async function uploadUserPrompt(prompt: string): Promise<AgentAction> {
    try {
        const response: Response = await fetch('https://your-serverless-function-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) {
            throw new Error(`Error: ${response.status}, ${response.statusText}`);
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(`Error: ${data.error}`);
        }
        let agentAction: AgentAction = data.action as AgentAction;
        return agentAction;
        console.log('User prompt uploaded successfully:', data);
    } catch (error) {
        throw new Error(`Failed to upload user prompt: ${error}`);
    }
}

export { uploadContext, uploadUserPrompt };