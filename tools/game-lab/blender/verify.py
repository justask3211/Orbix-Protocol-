"""Repeatable isolated Blender asset + MCP initialization/scene-query check."""
import argparse
import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import time

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def check_mcp(executable, env, errlog):
    params = StdioServerParameters(command=str(executable), env=env)
    async with stdio_client(params, errlog=errlog) as (reader, writer):
        async with ClientSession(reader, writer) as client:
            initialized = await client.initialize()
            listed = await client.list_tools()
            names = [tool.name for tool in listed.tools]
            assert "get_scene_info" in names, names
            scene = await client.call_tool("get_scene_info", {})
            content = "\n".join(block.text for block in scene.content if hasattr(block, "text"))
            assert not scene.isError and "Orbix_Verification_Cube" in content, content
            allowed = await client.call_tool("execute_blender_code", {"code": 'import bpy; print(bpy.app.version_string)'})
            allowed_text = "\n".join(block.text for block in allowed.content if hasattr(block, "text"))
            assert "Code executed successfully" in allowed_text, allowed_text
            rejected = await client.call_tool("execute_blender_code", {"code": "import os"})
            rejected_text = "\n".join(block.text for block in rejected.content if hasattr(block, "text"))
            assert "Rejected by safe mode" in rejected_text, rejected_text
            return {"protocol": initialized.protocolVersion, "tool_count": len(names),
                    "scene_query": content, "allowed_bpy_script": True, "os_import_rejected": True,
                    "server_version": importlib.metadata.version("mcp-for-blender")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blender", type=Path, default=Path(r"C:\Program Files\Blender Foundation\Blender 3.4\blender.exe"))
    parser.add_argument("--output", type=Path, default=Path.home() / ".codex/orbix-tooling/blender-mcp/artifacts")
    args = parser.parse_args()
    output = args.output.resolve()
    # A unique folder avoids consuming a stale readiness file on repeated runs.
    output = output / time.strftime("%Y%m%d-%H%M%S")
    output.mkdir(parents=True, exist_ok=False)
    env = dict(os.environ, PYTHONUTF8="1", DISABLE_TELEMETRY="true", BLENDER_MCP_DISABLE_TELEMETRY="true",
               BLENDER_MCP_SAFE_MODE="1", BLENDER_HOST="127.0.0.1", BLENDER_MCP_APPS="0")
    script = Path(__file__).with_name("verify_scene.py")
    mcp_executable = Path.home() / ".codex/orbix-tooling/blender-mcp/.venv/Scripts/mcp-for-blender.exe"
    with (output / "blender.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen([str(args.blender), "--background", "--factory-startup", "--python", str(script),
                                    "--", "--output", str(output)], env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            ready_path = output / "ready.json"
            while not ready_path.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(f"Blender verification did not become ready; inspect {output / 'blender.log'}")
                time.sleep(0.1)
            report = json.loads(ready_path.read_text(encoding="utf-8"))
            env["BLENDER_PORT"] = str(report["port"])
            with (output / "mcp.log").open("w", encoding="utf-8") as mcp_log:
                report["mcp"] = asyncio.run(asyncio.wait_for(check_mcp(mcp_executable, env, mcp_log), timeout=40))
            report["transport_note"] = "Test-only main-thread bridge; interactive production bridge requires Blender GUI."
            (output / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report, indent=2))
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == "__main__":
    main()
