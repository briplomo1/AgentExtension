import json
import uuid
import azure.functions as func
import logging
import azure.durable_functions as df
from openai import AzureOpenAI
import os


app = df.DFApp(http_auth_level=func.AuthLevel.FUNCTION)

def size_chat_window(messages: list):
    """
    Calculate the size of the chat window based on the number of messages.
    Resize the chat window if it exceeds a certain size to keep token costs and utilization below
    model limits.
    """
    # TODO: Drop off oldest messages if the size exceeds a certain limit
    # TODO: Potentially condense existing messages to reduce size using llm

    return messages


@app.entity_trigger(context_name="context")
def Messages(context: df.DurableEntityContext):
    logging.info(f"Chat messages state for entry: {context.entity_key}")
    
    entity_value = context.get_state(lambda: [
        {
            "role": "system", "content": 
            "You are a helpful assistant that backs a browser extension. "
            "You help people who are visually impaired navigate the web through voice "
            "commands which can be interpreted as actions to be taken by the extension on "
            "behalf of the user. Given the following html code and screenshot of the current tab, "
            "interpret each of the user's prompts and see if you have a tool that matches what they need."
            "If you do, call the appropriate tool function with the correct parameters. "
            "IMPORTANT: Always provide a clear but brief conversational response explaining what you're doing, "
            "as this will be read aloud to the user. Your response should be natural and descriptive, "
            "helping the user understand what action you're taking on their behalf."
        }
    ])

    operation = context.operation_name
    if operation == "get":
        logging.info(f"Getting state of conversation entity: {context.entity_name}-{context.entity_key}")
        context.set_result(entity_value)
    elif operation == "add":
        logging.info(f"Adding message to conversation entity: {context.entity_name}-{context.entity_key}\nMessage: {context.get_input()}")
        entity_value.append(context.get_input())
    elif operation == "clear":
        logging.info(f"Clearing conversation entity: {context.entity_name}-{context.entity_key}")
        entity_value = []
    elif operation == "set":
        logging.info(f"Setting state of conversation entity: {context.entity_name}-{context.entity_key}\nState: {context.get_input()}")
        entity_value = context.get_input()
    else:
        logging.warning(f"Unknown operation: {operation} on entity: {context.entity_name}-{context.entity_key}")
    context.set_state(entity_value)
    
    

@app.route(route="orchestrators/{functionName}")
@app.durable_client_input(client_name="client")
async def http_start(req: func.HttpRequest, client: df.DurableOrchestrationClient) -> func.HttpResponse:
    logging.info("HTTP trigger for orchestrator function started")
    function_name = req.route_params.get('functionName')
    if not function_name:
        return func.HttpResponse(
            "Please pass a function name in the route.",
            status_code=400
        )
    
    request_body = req.get_json()
    if not request_body:
        return func.HttpResponse(
            "Please pass a valid JSON body.",
            status_code=400
        )
    
    instance_id = await client.start_new(function_name, None, request_body)
    response = client.create_check_status_response(req, instance_id)
    return response

@app.orchestration_trigger(context_name="context")
def agent_init_orchestrator(context: df.DurableOrchestrationContext):
    logging.info("Starting agent initialization orchestrator")
    
    # Process html and screenshot context
    result = yield context.call_activity("process_chat_context", context.get_input())

    if not result or result.get("status") != "success" or result.get("chat_thread_id") is None:
        logging.error(f"Agent initialization failed: {result}")
        return {
            "status": "error",
            "message": "Failed to initialize chat thread",
            "chat_thread_id": None,
            "error": result.get("error", "Unknown error")
        }
    
    # Initialize chat thread entity
    chat_thread_id = result.get("chat_thread_id")
    entity_id = df.EntityId("Messages", chat_thread_id)

    messages = yield context.call_entity(entity_id, "get")
    messages[0]["content"] += f"\nHTML: {context.get_input().get('html', '')}\nScreenshot: {context.get_input().get('screenshot', '')}"
    updated_messages = yield context.call_entity(entity_id, "set", messages)

    logging.info(f"Orchestrator completed with result: {result}")
    response =  {
        "status": "success",
        "message": "Chat initialization executed successfully",
        "chat_thread_id": chat_thread_id,
        "error": None
    }
    logging.info(f"Agent initialization orchestrator completed with response: {response}")
    return response


@app.orchestration_trigger(context_name="context")
def agent_action_orchestrator(context: df.DurableOrchestrationContext):
    logging.info("Starting agent action orchestrator")
    
    request = context.get_input()
    if not request or not isinstance(request, dict):
        logging.error("Invalid input for agent action orchestrator")
        return {
            "status": "error",
            "message": "Invalid input for agent action orchestrator"
        }
    user_prompt = request.get("user_prompt", "")
    chat_thread_id = request.get("chat_thread_id", "")

    if not user_prompt or not chat_thread_id:
        logging.error("Missing user prompt or chat thread ID in request")
        return {
            "status": "error",
            "message": "Missing user prompt or chat thread ID"
        }
    logging.info(f"Getting agent action for prompt: {user_prompt} and chat thread: {chat_thread_id}")
    
    new_message = [{"role": "user", "content": user_prompt}]
    entity_id = df.EntityId("Messages", chat_thread_id)
    messages = yield context.call_entity(entity_id, "set", new_message)

    # Call the activity function with chat messages
    result = yield context.call_activity("get_action_activity", messages)

    if not result or result.get("status") != "success":
        logging.error(f"Get agent action failed: {result}")
        return {
            "status": "error",
            "message": "Failed to get agent action",
            "error": result.get("error", "Unknown error")
        }
    
    logging.info(f"Agent action orchestrator completed with result: {result}")
    # Return the action from the result
    return result


@app.activity_trigger(input_name="messages")
def get_action_activity(messages: list):
    logging.info("Starting get action activity")
    try:
        from tools import get_tool_definitions
        tool_definitions = get_tool_definitions()
        with AzureOpenAI(api_key=os.environ.get("AZURE_OPENAI_API_KEY"), endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT")) as chat_client:

            response = chat_client.chat.completions.create(
                model=os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME"),
                messages=messages,
                tools=tool_definitions,
            )

            message = response.choices[0].message
            spoken_response = message.content

            if message.tool_calls:
                tool_calls_info = []
                for tool_call in message.tool_calls:
                    action = tool_call.function.name
                    args = json.loads(tool_call.function.arguments)

                    logging.info(f"Tool call detected: {action} with args: {args}")
                    tool_calls_info.append({
                        "action": action,
                        "arguments": args
                    })
                return {
                    "status": "success",
                    "response_type": "tool_calls",
                    "chat_message": spoken_response,
                    "actions": tool_calls_info,
                    "error": None
                }
            else:
                logging.info("No tool calls detected in the response")
                return {
                    "status": "success",
                    "response_type": "message",
                    "chat_message": spoken_response,
                    "actions": [],
                    "error": None
                }

    except Exception as e:
        logging.error(f"Error in get_action_activity: {e}")
        return {
            "status": "error",
            "chat_message": "Im sorry an error ocurred while processing your command!",
            "actions": [],
            "error": str(e)
        }
    # TODO: Feed the user prompt to the agent model to get the action

    # TODO : Get agent tools that can be used to decide the action

    # TODO: Call agent with chat thread and tools
    
    return

@app.activity_trigger(input_name="tab_context")
def process_chat_context(tab_context: dict):
    logging.info("Initializing chat message thread with tab context")

    tab_id = tab_context.get("tabId", "")
    html_content = tab_context.get("html", "")
    screenshot_url = tab_context.get("screenshot", "")
    chat_thread_id = str(uuid.uuid4())


    # TODO: Condense the HTML content and extract relevant information

    # TODO: Compress screenshot if necessary
    
    return {
        "status": "success",
        "chat_thread_id": chat_thread_id,
        "error": None
    }