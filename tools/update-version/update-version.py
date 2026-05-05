#!/usr/bin/env python3
"""
Actualiza los parámetros de versión en index.html para cache busting
"""

import re
import os
from pathlib import Path
from datetime import datetime

def update_version(project_name=None):
    # Generate timestamp version
    version = int(datetime.now().timestamp() * 1000)
    
    # Get the project root (parent of tools directory)
    script_dir = Path(__file__).parent.parent.parent
    
    # Get project name from argument or directory name
    if not project_name:
        project_name = script_dir.name
    
    html_path = script_dir / 'index.html'
    
    if not html_path.exists():
        print(f"❌ Error: {html_path} no encontrado")
        return
    
    # Read index.html
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()
    
    # Remove existing version parameters
    html = re.sub(r'\?v=\d+', '', html)
    
    # Add version parameter to CSS
    html = re.sub(
        r'(<link[^>]*href=["\'])(styles\.css)(["\'][^>]*>)',
        rf'\1\2?v={version}\3',
        html
    )
    
    # Add version parameter to JS files (except Firebase CDN and external libraries)
    html = re.sub(
        r'(<script[^>]*src=["\'])(modal\.js|auth\.js|tabs/clients\.js|tabs/products\.js|tabs/orders\.js|tabs/catalog\.js|tabs/lunch\.js|app\.js)(["\'][^>]*>)',
        rf'\1\2?v={version}\3',
        html
    )
    
    # Add version parameter to service worker
    html = re.sub(
        r'(serviceWorker\.register\(["\'])(service-worker\.js)(["\'])',
        rf'\1\2?v={version}\3',
        html
    )
    
    # Write back
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)
    
    # Write version.json so the client can validate against server (avoid stale cache)
    import json
    version_path = script_dir / 'version.json'
    with open(version_path, 'w', encoding='utf-8') as f:
        json.dump({'v': version}, f)
    
    print(f"✅ {project_name}: Version updated to: {version}")

if __name__ == "__main__":
    import sys
    # Accept optional project name argument (for compatibility with server.sh)
    project_name = sys.argv[1] if len(sys.argv) > 1 else None
    update_version(project_name)

