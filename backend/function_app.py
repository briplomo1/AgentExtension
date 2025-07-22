import json
import uuid
import azure.functions as func
import logging
import azure.durable_functions as df
from openai import AzureOpenAI
import os
from azure.cognitiveservices.speech import SpeechConfig, SpeechSynthesizer, SpeechSynthesisOutputFormat, ResultReason
import base64


app = df.DFApp(http_auth_level=func.AuthLevel.FUNCTION)

SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY")
SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
OPEN_AI_API_KEY = os.environ.get("AZURE_OPENAI_API_KEY")
OPEN_AI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT")
OPEN_AI_API_VER = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")
AZURE_OPENAI_DEPLOYMENT_NAME = os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME")

SYSTEM_MESSAGE = ( 
    "You are a helpful assistant that backs a browser extension. "
    "You help people who are visually impaired navigate the web through voice "
    "commands which can be interpreted as actions to be taken by the extension on "
    "behalf of the user. Given the following html code and screenshot of the current tab, "
    "interpret each of the user's prompts and see if you have a tool that matches what they need."
    "If you do, call the appropriate tool function with the correct parameters. "
    "CRITICAL REQUIREMENT: You MUST ALWAYS provide a clear, conversational response message "
    "explaining what you're doing, even when calling tools. This message will be read aloud "
    "to visually impaired users. NEVER return empty or null content - always explain your actions "
    "in a natural, descriptive way that helps the user understand what you're doing on their behalf. Avoid technical "
    "jargon or complex explanations as the user may not be familiar with web development concepts. "
    "Your response should be natural and descriptive, helping the user understand what action "
    "you're taking on their behalf."
)

def size_chat_window(messages: list):
    """
    Calculate the size of the chat window based on the number of messages.
    Resize the chat window if it exceeds a certain size to keep token costs and utilization below
    model limits.
    """
    # TODO: Drop off oldest messages if the size exceeds a certain limit
    # TODO: Potentially condense existing messages to reduce size using llm

    return messages

def text_to_speech(text: str, synthesizer: SpeechSynthesizer, voice_name: str = "en-US-JennyNeural") -> str:
    """
    Convert text to speech using Azure OpenAI's TTS capabilities.
    Returns a base64-encoded string of the audio data.
    """
    try:
        if not text:
            logging.warning("No text provided for speech synthesis")
            return None
        ssml = f"""
        <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
            <voice name='{voice_name}'>
                <prosody rate='0.9' pitch='0%'>
                    {text}
                </prosody>
            </voice>
        </speak>
        """

        result = synthesizer.speak_ssml_async(ssml).get()

        if result.reason == ResultReason.SynthesizingAudioCompleted:
            # Convert audio data to base64 string
            logging.info("Speech synthesis completed successfully")
            return base64.b64encode(result.audio_data).decode('utf-8')
        else:
            raise Exception(f"Speech synthesis failed: {result.reason}")
    except Exception as e:
        logging.error(f"Error occurred during text-to-speech synthesis: {e}")
        raise e

@app.entity_trigger(context_name="context")
def Messages(context: df.DurableEntityContext):
    logging.info(f"Chat messages state for entry: {context.entity_key}")
    # Default to an empty list if no state exists
    # This allows the entity to be created without any initial messages
    entity_value = context.get_state(lambda: [])

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
    
    try:
        result = await client.wait_for_completion_or_create_check_status_response(
            req, instance_id, timeout_in_milliseconds=60000
        )

        # If is an HTTP response, return it directly
        if isinstance(result, func.HttpResponse):
            return result
        
        # Otherwise, return the result as a JSON response
        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json"
        )

    except Exception as e:
        logging.error(f"Error waiting for orchestrator: {e}")
        return func.HttpResponse(
            json.dumps({
                "status": "error",
                "message": "An error occurred while waiting for the orchestrator.",
                "error": str(e)
            }),
            status_code=500,
            mimetype="application/json"
        )


@app.orchestration_trigger(context_name="context")
def agent_init_orchestrator(context: df.DurableOrchestrationContext):
    logging.info("Starting agent initialization orchestrator")
    
    # Process html and screenshot context
    result = yield context.call_activity("process_chat_context", context.get_input())

    if not result or result.get("status") != "success" or result.get("chatThreadId") is None:
        logging.error(f"Agent initialization failed: {result}")
        return {
            "status": "error",
            "message": "Failed to initialize chat thread",
            "chatThreadId": None,
            "error": result.get("error", "Unknown error")
        }
    
    # Initialize chat thread entity
    chat_thread_id = result.get("chatThreadId")
    entity_id = df.EntityId("Messages", chat_thread_id)

    # Initialize the chat thread with system message, screenshot, and html content if given
    messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
    messages[0]["content"] += f"\n\nHTML Content: {result.get('content', '')}"
    messages[0]["content"] += f"\n\nScreenshot URL: {result.get('screenshot', '')}"
    
    updated_messages = yield context.call_entity(entity_id, "set", messages)

    logging.info(f"Orchestrator completed with result: {result}")
    response =  {
        "status": "success",
        "message": "Chat initialization executed successfully",
        "chatThreadId": chat_thread_id,
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
            "message": "Invalid input for agent action orchestrator",
            "error": "Invalid request parameters"
        }
    user_prompt = request.get("userPrompt", "")
    chat_thread_id = request.get("chatThreadId", "")

    if not user_prompt or not chat_thread_id:
        logging.error("Missing user prompt or chat thread ID in request")
        return {
            "status": "error",
            "message": "Missing user prompt or chat thread ID",
            "error": "Invalid request parameters"
        }
    logging.info(f"Getting agent action for prompt: {user_prompt} and chat thread: {chat_thread_id}")
    # Add user message to the chat thread entity
    new_message = {"role": "user", "content": user_prompt}

    entity_id = df.EntityId("Messages", chat_thread_id)
    current_messages = yield context.call_entity(entity_id, "get")
    logging.info(f"Current messages in chat thread: {current_messages}")
    # If the entity does not exist or has no messages besides the system message, return error status
    if not current_messages or not isinstance(current_messages, list) or len(current_messages) < 1:
        logging.error("Chat thread does not exist or has been cleared")
        return {
            "status": "error",
            "message": "Failed to retrieve messages from chat thread",
            "error": "Invalid messages retrieved from chat history"
        }
    # Add the new user message to the chat thread
    yield context.call_entity(entity_id, "add", new_message)
    current_messages.append(new_message)
    if not current_messages or not isinstance(current_messages, list):
        logging.error("Failed to retrieve messages from entity")
        return {
            "status": "error",
            "message": "Failed to retrieve messages from chat thread",
            "error": "Invalid messages retrieved from chat history"
        }
    
    # Call the activity function with chat messages
    result = yield context.call_activity("get_action_activity", current_messages)

    if not result or result.get("status") != "success":
        logging.error(f"Get agent action failed: {result}")
        return {
            "status": "error",
            "message": "Failed to get agent action",
            "error": result.get("error", "Unknown error")
        }
    
    # Add the assistant message to the chat thread along with any tool calls if present
    assistant_message = {"role": "assistant", "content": result.get("chat_message", "")}
    # TODO: manage tool call history and tool call responses
    # if result.get("response_type") == "tool_calls" and result.get("actions"):
    #     assistant_message["tool_calls"] = []
    #     tool_call_ids = []
    #     for action in result.get("actions", []):
    #         tool_call_id = f"call_{uuid.uuid4().hex[:8]}"
    #         tool_call_ids.append(tool_call_id)
    #         assistant_message["tool_calls"].append({
    #             "id": tool_call_id,  # Generate a simple call ID
    #             "type": "function",
    #             "function": {
    #                 "name": action["action"],
    #                 "arguments": json.dumps(action["arguments"])
    #             }
    #         })
    #     # Add the assistant message with tool calls
    #     yield context.call_entity(entity_id, "add", assistant_message)
        

    #     # Add generic tool response messages for each tool call. Necessary by OpenAI API
    #     for i, tool_call_id in enumerate(tool_call_ids):
    #         action_name = result.get("actions", [])[i]["action"]
    #         tool_response = {
    #             "role": "tool",
    #             "tool_call_id": tool_call_id,
    #             "content": f"Tool {action_name} executed successfully"
    #         }
    #         yield context.call_entity(entity_id, "add", tool_response)
    # else:
    #     # Add the assistant message without tool calls
    #     yield context.call_entity(entity_id, "add", assistant_message)
    yield context.call_entity(entity_id, "add", assistant_message)
    logging.info(f"Added assistant message to chat thread: {assistant_message}")
    return result


@app.activity_trigger(input_name="messages")
def get_action_activity(messages: list):
    logging.info("Starting get action activity")
    try:
        from tools import get_tool_definitions
        tool_definitions = get_tool_definitions()
        speech_config = SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
        speech_config.speech_synthesis_voice_name = "en-US-JennyNeural"
        speech_config.speech_synthesis_output_format = SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3      
        with AzureOpenAI(api_key=OPEN_AI_API_KEY, azure_endpoint=OPEN_AI_ENDPOINT, api_version=OPEN_AI_API_VER) as chat_client:
            synthesizer = SpeechSynthesizer(speech_config=speech_config)
            logging.info(f"Chat messages received: {messages}")
            # Call model with messages and tool definitions
            response = chat_client.chat.completions.create(
                model=AZURE_OPENAI_DEPLOYMENT_NAME,
                messages=messages,
                tools=tool_definitions,
                tool_choice="auto",
            )
            message = response.choices[0].message
            chat_response = message.content
            logging.info(f"Model response: {chat_response}")

             # Ensure we always have content for speech synthesis and user feedback
            if not chat_response and message.tool_calls:
                # Provide a default message when OpenAI returns None content but has tool calls
                chat_response = "I'll help you with that action."
            elif not chat_response:
                # Fallback for any other case where content is None
                chat_response = "I'm here to help you."

            # Get text to speech for model response
            audio_data_b64 = text_to_speech(chat_response, synthesizer, voice_name=speech_config.speech_synthesis_voice_name)

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
                    "chat_message": chat_response,
                    "chat_audio": audio_data_b64,
                    "actions": tool_calls_info,
                    "error": None
                }
            else:
                logging.info("No tool calls detected in the response")
                return {
                    "status": "success",
                    "response_type": "message",
                    "chat_message": chat_response,
                    "chat_audio": audio_data_b64,
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
    

@app.activity_trigger(input_name="tab_context")
def process_chat_context(tab_context: dict):
    logging.info("Initializing chat message thread with tab context")

    tab_id = tab_context.get("tabId")
    html_content = tab_context.get("html")
    screenshot_url = tab_context.get("screenshot")
    chat_thread_id = str(uuid.uuid4())


    # TODO: Condense the HTML content and extract relevant information

    # TODO: Compress screenshot if necessary
    
    return {
        "status": "success",
        "chatThreadId": chat_thread_id,
        "content": "<!DOCTYPE html><html><head><title>Test Page</title></head><body><input type=\"text\" id=\"textField\" placeholder=\"Enter text here\"><button id=\"submitBtn\">Submit</button></body></html>",
        "screenshot": screenshot_url,
        "error": None
    }