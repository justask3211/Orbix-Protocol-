"""Enable the reviewed addon for this Blender process, without saving preferences."""
import importlib.util
import os
from pathlib import Path
import sys

import bpy


def load_addon():
    path = Path(os.environ["APPDATA"]) / "Blender Foundation/Blender/3.4/scripts/addons/blender_mcp.py"
    spec = importlib.util.spec_from_file_location("blender_mcp", path)
    addon = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = addon
    spec.loader.exec_module(addon)
    addon.register()
    scene = bpy.context.scene
    scene.blendermcp_auto_start_server = False
    # Paid generation integrations remain disabled in this session.
    for prop in ("blendermcp_use_hyper3d", "blendermcp_use_hunyuan3d", "blendermcp_use_tripo"):
        if hasattr(scene, prop):
            setattr(scene, prop, False)
    return addon


if __name__ == "__main__":
    load_addon()
    print("Orbix addon loaded for this session. Start its localhost bridge from the MCP sidebar when needed.")
