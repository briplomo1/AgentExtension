from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class ToolParameter:
    name: str
    type: str
    description: str
    required: bool = True
    enum_values: List[str] = None
    default: Any = None

@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: List[ToolParameter]

    def to_openai_format(self) -> Dict[str, Any]:
        properties = {}
        required_params = []

        for param in self.parameters:
            param_def = {
                "type": param.type,
                "description": param.description
            }

            if param.enum_values:
                param_def["enum"] = param.enum_values

            if param.default is not None:
                param_def["default"] = param.default
            
            properties[param.name] = param_def

            if param.required:
                required_params.append(param.name)

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required_params
                }
            }
        }

EXTENSION_TOOLS = [
    ToolDefinition(
        name="web_search",
        description="Search the web for information on any user question or query.",
        parameters=[
            ToolParameter(name="query", type="string", description="The search query to use."),
        ]
    ),
    ToolDefinition(
        name="click_element",
        description="Perform a click action on a web element as described by the user. Use the HTML and image of the browser to identify the element and return a identifier. Use standard CSS selectors only - no jQuery selectors like :contains(). Examples: 'button[type=\"submit\"]', '.login-button', '#submit-btn', 'button:first-child', 'a[href*=\"login\"]'." \
        "Use the users description of the element to find the correct element on the screen to click.",
        parameters=[
            ToolParameter(name="selector", type="string", description="The CSS selector of the element to click. Must be valid CSS selector (no :contains, no jQuery). Examples: 'button[type=\"submit\"]', '.btn-login', '#login-button', 'input[value=\"Login\"]'.", required=True),
        ]
    ),
    ToolDefinition(
    name="interact_with_iframe",
    description="Interact with embedded content inside an iframe (videos, forms, maps, documents, games, etc.). Use this when user wants to interact with any embedded content like playing videos, filling forms, navigating maps, or clicking within embedded applications.",
    parameters=[
        ToolParameter(name="iframe_selector", type="string", description="CSS selector for the iframe element (e.g., '#player', 'iframe[src*=\"youtube\"]', 'iframe[title*=\"map\"]')", required=True),
        ToolParameter(name="action", type="string", description="Action to perform with the iframe", required=True, enum_values=[
            "click_play", "click_pause", "toggle_play", 
            "send_spacebar", "send_enter",
            "click_coordinates"
        ]),
    ]
),
    ToolDefinition(
        name="screenshot_capture",
        description="Capture a screenshot of the current page.",
        parameters=[
            ToolParameter(name="full_page", type="boolean", description="Whether to capture the full page or just the visible area.", default=False)
        ]
    ),
    ToolDefinition (
        name="type_text",
        description="Type text into a web element which should be identified by CSS selector.",
        parameters=[
            ToolParameter(name="selector", type="string", description="The CSS selector of the element to type text into.", required=True),
            ToolParameter(name="text", type="string", description="The text to type into the element.", required=True),
        ]
    ),
    ToolDefinition(
        name="scroll_position",
        description="Scroll the page to a specific position or element.",
        parameters=[
            ToolParameter(name="position", type="string", description="The position to scroll to (e.g., 'top', 'bottom', 'element').", required=False),
            ToolParameter(name="selector", type="string", description="The CSS selector of the element to scroll into view.", required=False)
        ]
    ),
    ToolDefinition(
        name="scroll_direction",
        description="Scroll the page in a specific direction and by a specific distance.",
        parameters=[
            ToolParameter(name="direction", type="string", description="The direction to scroll (e.g., 'up', 'down', 'left', 'right').", required=True),
            ToolParameter(name="distance", type="integer", description="The distance to scroll in pixels.", required=False, default=100)
        ]
    ),
    ToolDefinition(
        name="read_text",
        description="Read the text content of a web element.",
        parameters=[
            ToolParameter(name="selector", type="string", description="The CSS selector of the element to read from.", required=True)
        ]
    ),
    ToolDefinition(
        name="describe_page",
        description="Provide a brief description of the current web page and the elements it contains to a layperson.",
        parameters=[
            ToolParameter(name="description", type="string", description="A brief description of the page content and elements. Highlight the interactable elements and keep it brief.", required=False)
        ]
    ),
    ToolDefinition(
        name="go_back",
        description="Navigate back to the previous page in the browser history.",
        parameters=[]
    ),
    ToolDefinition(
        name="go_forward",
        description="Navigate forward to the next page in the browser history.",
        parameters=[]
    ),
    ToolDefinition(
        name="refresh_page",
        description="Refresh the current web page.",
        parameters=[]
    ),
    ToolDefinition(
        name="search_video",
        description="Search for a specific video on the web.",
        parameters=[
            ToolParameter(name="query", type="string", description="The search query to use.", required=True),
        ]
    ),
    ToolDefinition(
        name="search_audio",
        description="Search for a specific audio on the web.",
        parameters=[
            ToolParameter(name="query", type="string", description="The search query to use.", required=True),
        ]
    ),
    ToolDefinition(
        name="zoom",
        description="Zoom in or out on the current page.",
        parameters=[
            ToolParameter(name="level", type="integer", description="The zoom level to set as a percentage (e.g., 100 for 100%).", required=True),
        ]
    ),
    ToolDefinition(
        name="go_to_url",
        description="Navigate to a specific URL as understood by the user's prompt. (e.g., 'go to Bing').",
        parameters=[
            ToolParameter(name="url", type="string", description="The URL to navigate to.", required=True),
        ]
    )
]

def get_tool_definitions() -> List[Dict[str, Any]]:
    """
    Get OpenAI function tool definitions for all available browser tools.
    
    Returns:
        List[Dict[str, Any]]: List of tool definitions compatible with OpenAI API
    """
    return [tool.to_openai_format() for tool in EXTENSION_TOOLS]
