import contextlib
import importlib.util
import io
import json
import tempfile
from pathlib import Path

from langchain_core.language_models.fake_chat_models import (
    FakeListChatModel,
    FakeMessagesListChatModel,
)
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage


root = Path(__file__).resolve().parents[2]
worker_path = root / "resources" / "agent" / "worker.py"
spec = importlib.util.spec_from_file_location("refora_agent_worker", worker_path)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


compatible_model = worker._model(
    {
        "model": "compatible-reasoning-model",
        "apiKey": "test",
        "baseUrl": "https://example.test/v1",
        "useResponsesApi": False,
        "modelKwargs": {},
        "temperature": None,
        "maxTokens": None,
    }
)
reasoning_chunk = compatible_model._convert_chunk_to_generation_chunk(
    {
        "choices": [
            {
                "delta": {
                    "role": "assistant",
                    "reasoning_content": "Inspect sources",
                }
            }
        ]
    },
    AIMessageChunk,
    None,
)
assert reasoning_chunk.message.content == ""
assert reasoning_chunk.message.additional_kwargs["reasoning_content"] == "Inspect sources"
reasoning_details_chunk = compatible_model._convert_chunk_to_generation_chunk(
    {
        "choices": [
            {
                "delta": {
                    "role": "assistant",
                    "reasoning_details": [
                        {"type": "reasoning.text", "text": "Compare "},
                        {"type": "reasoning.text", "text": "evidence"},
                    ],
                }
            }
        ]
    },
    AIMessageChunk,
    None,
)
assert reasoning_details_chunk.message.additional_kwargs["reasoning_content"] == "Compare evidence"
roleless_chunk = compatible_model._convert_chunk_to_generation_chunk(
    {
        "choices": [
            {
                "delta": {
                    "content": "Roleless compatible output",
                }
            }
        ]
    },
    AIMessageChunk,
    None,
)
assert roleless_chunk.message.content == "Roleless compatible output"
callback_output = io.StringIO()
with contextlib.redirect_stdout(callback_output):
    worker.EventCallback().on_llm_new_token(
        "",
        chunk=reasoning_chunk,
        run_id="reasoning-run",
    )
callback_event = json.loads(callback_output.getvalue())
assert callback_event["event"]["event"] == "on_chat_model_stream"
assert callback_event["event"]["data"]["chunk"]["additional_kwargs"]["reasoning_content"] == "Inspect sources"


class ToolCapableFakeModel(FakeListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


class ToolCapableFakeMessagesModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


class SequenceModel:
    def __init__(self, responses):
        self.responses = list(responses)
        self.prompts = []

    def invoke(self, prompt):
        self.prompts.append(prompt)
        return self.responses.pop(0)


summary_model = SequenceModel(
    [
        AIMessage(content="Chunk one"),
        AIMessage(content="Chunk two"),
        AIMessage(
            content='```json\n{"core":"Compact core","keyPoints":["one","two"]}\n```'
        ),
    ]
)
worker._model = lambda config: summary_model
summary = worker._generate_summary(
    {
        "provider": {
            "model": "summary-model",
            "apiKey": "test",
            "baseUrl": "https://example.test/v1",
            "useResponsesApi": False,
            "modelKwargs": {},
            "temperature": None,
            "maxTokens": 450,
        },
        "text": "x" * 3100,
    }
)
assert summary == {"core": "Compact core", "keyPoints": ["one", "two"]}
assert len(summary_model.prompts) == 3

title_model = SequenceModel(
    [
        AIMessage(
            content=[],
            additional_kwargs={"reasoning_content": "work\nUseful Research Title"},
        )
    ]
)
worker._model = lambda config: title_model
title = worker._generate_title(
    {
        "provider": {
            "model": "reasoning-model",
            "apiKey": "test",
            "baseUrl": "https://example.test/v1",
            "useResponsesApi": False,
            "modelKwargs": {},
            "temperature": None,
            "maxTokens": 512,
        },
        "userMessage": "Investigate agent migration.",
        "reasoningModel": True,
    }
)
assert title == "Useful Research Title"

global_tools = worker._tool_definitions(False)
workspace_tools = worker._tool_definitions(True)
assert "/research.md" not in global_tools["propose_workspace_memory_update"]["schema"]["properties"]["path"]["enum"]
assert "/research.md" in workspace_tools["propose_workspace_memory_update"]["schema"]["properties"]["path"]["enum"]
assert "read_paper_fulltext" in worker._read_only_tool_names
assert "prepare_paper_ocr" not in worker._read_only_tool_names
connection_defaults = worker._apply_schema_defaults(
    {"connections": [{"sourceItemId": "one", "targetItemId": "two"}]},
    workspace_tools["create_workspace_connections"]["schema"],
)
assert connection_defaults["connections"][0]["sourceAnchor"] == "right"
assert connection_defaults["connections"][0]["targetAnchor"] == "left"


class PolicyRpc(worker.HostRpc):
    def __init__(self):
        super().__init__("run-1", "workspace-1")
        self.effect = None
        self.host_calls = 0

    def call(self, name, arguments, tool_call_id):
        if name == "__tool_effect_get":
            return json.dumps(self.effect)
        if name == "__tool_effect_begin":
            self.effect = {"status": "running", "result": None}
            return "{}"
        if name == "__tool_effect_finish":
            self.effect = {
                "status": arguments["status"],
                "result": arguments["result"],
            }
            return "{}"
        self.host_calls += 1
        return '{"published":true}'


policy_rpc = PolicyRpc()
first_policy_result = policy_rpc.call_tool(
    "publish_workspace_artifacts",
    {"paths": ["outputs/report.md"]},
    "call-1",
)
second_policy_result = policy_rpc.call_tool(
    "publish_workspace_artifacts",
    {"paths": ["outputs/report.md"]},
    "call-1",
)
assert first_policy_result == second_policy_result == '{"published":true}'
assert policy_rpc.host_calls == 1

worker._model = lambda config: ToolCapableFakeModel(responses=["Python Deep Agent ready"])

with tempfile.TemporaryDirectory() as directory:
    request = {
        "mode": "run",
        "runId": "smoke-run",
        "threadId": "smoke-thread",
        "workspaceId": None,
        "checkpointPath": str(Path(directory) / "checkpoints.sqlite"),
        "checkpointBefore": None,
        "provider": {},
        "systemPrompt": "You are Refora.",
        "messages": [{"role": "user", "content": "Respond once."}],
        "enabledToolNames": [],
        "sandboxRoot": None,
        "memories": {"/brief.md": ""},
        "includeResearchMemory": False,
        "recursionLimit": 20,
    }
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        worker._run(request)
    messages = [json.loads(line) for line in output.getvalue().splitlines()]
    complete = next(message for message in messages if message["type"] == "complete")
    assert complete["state"]["config"]["configurable"]["checkpoint_id"]
    assert complete["state"]["values"]["messages"][-1]["content"] == "Python Deep Agent ready"

    artifact_root = Path(directory) / "academic-artifacts"
    serializer = worker.RecoverableAcademicSerializer(
        str(artifact_root),
        {"search_arxiv"},
    )
    checkpoint_value = {
        "messages": [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "id": "academic-call",
                        "name": "search_arxiv",
                        "args": {"query": "private frontier query"},
                        "type": "tool_call",
                    }
                ],
            ),
            ToolMessage(
                content='{"papers":[{"title":"private result"}]}',
                name="search_arxiv",
                tool_call_id="academic-call",
            ),
        ]
    }
    typed = serializer.dumps_typed(checkpoint_value)
    assert b"private frontier query" not in typed[1]
    assert b"private result" not in typed[1]
    restored = serializer.loads_typed(typed)
    assert restored["messages"][0].tool_calls[0]["args"]["query"] == "private frontier query"
    assert "private result" in restored["messages"][1].content
    assert list(artifact_root.rglob("*.json"))

    models = [
        ToolCapableFakeMessagesModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "id": "ocr-call",
                            "name": "prepare_paper_ocr",
                            "args": {"docId": "doc-1"},
                            "type": "tool_call",
                        }
                    ],
                )
            ]
        ),
        ToolCapableFakeMessagesModel(
            responses=[AIMessage(content="Continued without OCR.")]
        ),
    ]
    worker._model = lambda config: models.pop(0)
    approval_request = {
        **request,
        "threadId": "approval-thread",
        "messages": [{"role": "user", "content": "Read the scan."}],
        "enabledToolNames": ["prepare_paper_ocr"],
    }
    interrupted_output = io.StringIO()
    with contextlib.redirect_stdout(interrupted_output):
        worker._run(approval_request)
    interrupted_messages = [
        json.loads(line) for line in interrupted_output.getvalue().splitlines()
    ]
    interrupted = next(
        message for message in interrupted_messages if message["type"] == "complete"
    )
    interrupt_value = interrupted["state"]["tasks"][0]["interrupts"][0]["value"]
    assert interrupt_value["actionRequests"][0]["name"] == "prepare_paper_ocr"
    assert interrupt_value["reviewConfigs"][0]["allowedDecisions"] == [
        "approve",
        "reject",
    ]
    resumed_output = io.StringIO()
    with contextlib.redirect_stdout(resumed_output):
        worker._run(
            {
                **approval_request,
                "mode": "resume",
                "messages": None,
                "decisions": [{"type": "reject", "message": "Rejected in smoke test."}],
            }
        )
    resumed_messages = [
        json.loads(line) for line in resumed_output.getvalue().splitlines()
    ]
    resumed = next(
        message for message in resumed_messages if message["type"] == "complete"
    )
    assert resumed["state"]["values"]["messages"][-1]["content"] == "Continued without OCR."

    memory_backend = worker.ReadonlyMemoryBackend({"/brief.md": "Line one\nLine two"})
    assert memory_backend.read("/brief.md").file_data["content"] == "1: Line one\n2: Line two"
    assert memory_backend.write("/brief.md", "unapproved").error
    assert memory_backend.read("/outside.md").error

    host_calls = []

    class RecordingRpc(worker.HostRpc):
        def __init__(self):
            super().__init__("recording-run", None)

        def call(self, name, arguments, tool_call_id):
            host_calls.append((name, arguments, tool_call_id))
            return '{"ok":true}'

    host_tool = worker._host_tool(
        "search_library",
        RecordingRpc(),
        False,
    )
    host_result = host_tool.invoke(
        {
            "type": "tool_call",
            "id": "tool-call-1",
            "name": "search_library",
            "args": {"query": "agents"},
        }
    )
    assert host_result.content == '{"ok":true}'
    assert host_calls == [
        ("__host_search_library", {"query": "agents"}, "tool-call-1")
    ]
