import uuid
import azure.functions as func
import logging
import azure.durable_functions as df

app = df.DFApp(http_auth_level=func.AuthLevel.FUNCTION)

def size_chat_window(messages: list[dict]) -> list[dict]:
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
    
    entity_value = context.get_state(lambda: {"messages": [
        {
            "role": "system", "content": 
            "You are a helpful assistant that backs a browser extension. "
            "You help people who are visually impaired navigate the web through voice "
            "commands which can be interpreted as actions to be taken by the extension on "
            "behalf of the user. Given the following html code and screenshot of the browser, "
            "interpret the each of the user's prompts and see if you have a tool that matches what they need."
            "If you do, return the action that the extension will take using the tool."
        }
    ]})

    operation = context.operation_name
    if operation == "get":
        logging.info(f"Getting state of conversation entity: {context.entity_name}-{context.entity_key}")
        context.set_result(entity_value)
    elif operation == "add":
        logging.info(f"Adding message to conversation entity: {context.entity_name}-{context.entity_key}\nMessage: {context.get_input()}")
        entity_value.get("messages").append(context.get_input())
    elif operation == "clear":
        logging.info(f"Clearing conversation entity: {context.entity_name}-{context.entity_key}")
        entity_value = {"messages": []}
    elif operation == "set":
        logging.info(f"Setting state of conversation entity: {context.entity_name}-{context.entity_key}\nState: {context.get_input()}")
        entity_value = context.get_input()
    else:
        logging.warning(f"Unknown operation: {operation} on entity: {context.entity_name}-{context.entity_key}")
    context.set_state(entity_value)
    
    

@app.route(route="orchestrators/{functionName}")
async def http_start(req: func.HttpRequest, client) -> func.HttpResponse:
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
    
    # Call the activity function
    result = yield context.call_activity("intialize_chat_activity", context.get_input())

    if not result or result.get("status") != "success" or result.get("chat_thread_UUID") is None:
        logging.error(f"Agent initialization failed: {result}")
        return {
            "status": "error",
            "message": "Failed to initialize chat thread",
            "chat_thread_id": None,
            "error": result.get("error", "Unknown error")
        }
    
    logging.info(f"Orchestrator completed with result: {result}")
    response =  {
        "status": "success",
        "message": "Chat initialization executed successfully",
        "chat_thread_id": result.get("chat_thread_UUID"),
        "error": None
    }
    logging.info(f"Agent initialization orchestrator completed with response: {response}")
    return result.get("chat_thread_UUID")


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
    
    # Call the activity function
    result = yield context.call_activity("get_action_activity", request)

    if not result or result.get("status") != "success":
        logging.error(f"Get agent action failed: {result}")
        return {
            "status": "error",
            "message": "Failed to get agent action",
            "error": result.get("error", "Unknown error")
        }
    
    logging.info(f"Agent action orchestrator completed with result: {result}")
    return result.get("action", "No action taken")


@app.activity_trigger(input_name="user_prompt")
def get_action_activity(user_prompt: str):
    logging.info(f"Executing agent action function with user prompt: {user_prompt}")
    # TODO: Get current chat thread ID from entity state

    # TODO: Feed the user prompt to the agent model to get the action

    # TODO : Get agent tools that can be used to decide the action

    # TODO: Call agent with chat thread and tools
    
    return

@app.activity_trigger(input_name="tab_context")
def initialize_chat_activity(tab_context: dict[str, str]):
    logging.info("Initializing chat message thread with tab context")

    tab_id = tab_context.get("tabId", "")
    html_content = tab_context.get("html", "")
    screenshot_url = tab_context.get("screenshot", "")
    chat_thread_id = str(uuid.uuid4())


    # TODO: Condense the HTML content and extract relevant information

    # TODO: Compress screenshot if necessary

    # TODO: Initialize the chat thread with the provided context and chat id
    
    return {
        "status": "success",
        "chat_thread_id": chat_thread_id,
        "error": None
    }