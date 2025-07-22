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
        description="Search the web for information.",
        parameters=[
            ToolParameter(name="query", type="string", description="The search query to use."),
        ]
    ),
    ToolDefinition(
        name="click_element",
        description="Perform a click action on a web element which should be identified by CSS selector and described.",
        parameters=[
            ToolParameter(name="selector", type="string", description="The CSS selector of the element to click.", required=True),
            ToolParameter(name="description", type="string", description="A description of the element to be clicked.")
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
        parameters=[]
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
]

def get_tool_definitions() -> List[Dict[str, Any]]:
    """
    Get OpenAI function tool definitions for all available browser tools.
    
    Returns:
        List[Dict[str, Any]]: List of tool definitions compatible with OpenAI API
    """
    return [tool.to_openai_format() for tool in EXTENSION_TOOLS]
