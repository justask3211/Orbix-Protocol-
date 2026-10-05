"""Background compatibility check; temporary main-thread bridge is test-only."""
import argparse
import json
from pathlib import Path
import socket
import sys
import time

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from session import load_addon


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    addon = load_addon()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.mesh.primitive_cube_add()
    mesh = bpy.context.object
    mesh.name = "Orbix_Verification_Cube"
    mat = bpy.data.materials.new("Orbix_Verification_Violet")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.45, 0.08, 0.85, 1.0)
    mesh.data.materials.append(mat)
    glb_path = output / "verification-cube.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", use_selection=True)
    assert glb_path.read_bytes()[:4] == b"glTF", "Invalid GLB header"
    report = {"blender": bpy.app.version_string, "addon_protocol": addon.ADDON_PROTOCOL_VERSION,
              "mesh": mesh.name, "material": mat.name, "glb": str(glb_path), "glb_bytes": glb_path.stat().st_size}
    # Upstream intentionally disables background socket startup because timers
    # cannot drain bpy commands there. This bounded harness instead dispatches
    # commands on this main thread, solely to verify the real MCP transport.
    bridge = addon.BlenderMCPServer(host="127.0.0.1", port=0)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(0.5)
        report["port"] = listener.getsockname()[1]
        (output / "ready.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            try:
                connection, _ = listener.accept()
            except socket.timeout:
                continue
            with connection:
                connection.settimeout(0.5)
                buffered = ""
                while time.monotonic() < deadline:
                    try:
                        data = connection.recv(65536)
                    except socket.timeout:
                        continue
                    if not data:
                        break
                    buffered += data.decode("utf-8")
                    try:
                        command = json.loads(buffered)
                    except json.JSONDecodeError:
                        continue
                    buffered = ""
                    response = bridge.execute_command(command)
                    connection.sendall(json.dumps(response).encode("utf-8"))
    addon.unregister()


main()
