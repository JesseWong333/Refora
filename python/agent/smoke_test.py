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


worker._model = lambda config: ToolCapableFakeModel(responses=["Python Deep Agent ready"])

with tempfile.TemporaryDirectory() as directory:
    request = {
        "mode": "run",
        "threadId": "smoke-thread",
        "workspaceId": None,
        "checkpointPath": str(Path(directory) / "checkpoints.sqlite"),
        "checkpointBefore": None,
        "provider": {},
        "systemPrompt": "You are Refora.",
        "messages": [{"role": "user", "content": "Respond once."}],
        "tools": [],
        "readOnlyToolNames": [],
        "academicToolNames": [],
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
        "tools": [
            {
                "name": "prepare_paper_ocr",
                "description": "Prepare OCR.",
                "schema": {
                    "type": "object",
                    "properties": {"docId": {"type": "string"}},
                    "required": ["docId"],
                },
            }
        ],
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

    class RecordingRpc:
        def call(self, name, arguments, tool_call_id):
            host_calls.append((name, arguments, tool_call_id))
            return '{"ok":true}'

    host_tool = worker._host_tool(
        {
            "name": "search_library",
            "description": "Search papers.",
            "schema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
        RecordingRpc(),
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
        ("search_library", {"query": "agents"}, "tool-call-1")
    ]
